import { createUIMessageStreamResponse, streamText, toUIMessageStream, type UIMessageChunk } from 'ai';
import { captureServer } from '@/lib/analytics/server';
import { apiError, COPY, rateLimited } from '@/lib/agent-api';
import { APP_DOMAIN, getLimits, getLlmEnv, type Limits } from '@/lib/config';
import { getAgentById, touchLastUsed } from '@/lib/db/agents';
import { searchChunks } from '@/lib/db/chunks';
import { getDb } from '@/lib/db/client';
import { estimateTokens } from '@/lib/crawl/chunk';
import { embedTexts } from '@/lib/embeddings';
import { createFallbackModel } from '@/lib/llm/fallback-model';
import { buildChain } from '@/lib/llm/providers';
import { addChatTokens, checkChatTokenBudget, checkRail } from '@/lib/rails';
import type { RetrievedChunk } from '@/types';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export type ParsedChatRequest =
  | { ok: true; turns: ChatTurn[] }
  | { ok: false; status: 400 | 413; error: string };

const BAD_REQUEST = "Sammy couldn't make sense of that message — try sending it again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The text of one UI or plain message: its `text` parts joined, or its `content` string. */
function messageText(message: Record<string, unknown>): string {
  if (Array.isArray(message.parts)) {
    return message.parts
      .map((part) => (isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }
  return typeof message.content === 'string' ? message.content.trim() : '';
}

/**
 * Validates a chat body before anything costs money: size first, then shape.
 * Only user and assistant text survives; history is cut to `historyMessages`.
 */
export function parseChatRequest(raw: string, limits: Limits): ParsedChatRequest {
  if (Buffer.byteLength(raw, 'utf8') > limits.maxChatBodyBytes) {
    return { ok: false, status: 413, error: COPY.tooLong };
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, error: BAD_REQUEST };
  }
  if (!isRecord(body) || !Array.isArray(body.messages)) return { ok: false, status: 400, error: BAD_REQUEST };

  const turns: ChatTurn[] = [];
  for (const message of body.messages) {
    if (!isRecord(message) || (message.role !== 'user' && message.role !== 'assistant')) continue;
    const content = messageText(message);
    if (content) turns.push({ role: message.role, content });
  }
  const kept = turns.slice(-limits.historyMessages);
  const last = kept.at(-1);
  if (!last || last.role !== 'user') return { ok: false, status: 400, error: BAD_REQUEST };
  if (last.content.length > limits.maxUserMessageChars) return { ok: false, status: 413, error: COPY.tooLong };
  return { ok: true, turns: kept };
}

export function buildSystemPrompt(instruction: string, chunks: RetrievedChunk[]): string {
  const blocks = chunks.map((c, i) => `[${i + 1}] ${c.title} — ${c.url}\n${c.content}`);
  return `${instruction}\n\nWebsite content (cite the page URL when you use it):\n\n${blocks.join('\n\n')}`;
}

export interface HandleChatInput {
  agentId: string;
  raw: string;
  ip: string;
  corsHeaders?: HeadersInit;
}

/** Answers one chat message for an agent as an AI SDK UI message stream. */
export async function handleChat({ agentId, raw, ip, corsHeaders }: HandleChatInput): Promise<Response> {
  const limits = getLimits();
  const parsed = parseChatRequest(raw, limits);
  if (!parsed.ok) return apiError(parsed.status, parsed.error, corsHeaders);

  const db = getDb();
  const now = new Date();
  const agent = await getAgentById(db, agentId);
  if (!agent) return apiError(404, COPY.retired(APP_DOMAIN), corsHeaders);
  if (agent.status !== 'ready') {
    return apiError(409, agent.status === 'failed' ? COPY.crawlFailed : COPY.notReady, corsHeaders);
  }

  const perIp = await checkRail(db, 'chat_ip', { ip }, now, limits);
  if (!perIp.ok) return rateLimited(perIp, corsHeaders);
  const budget = await checkChatTokenBudget(db, now, limits);
  if (!budget.ok) return rateLimited(budget, corsHeaders);

  const { turns } = parsed;
  const question = (turns.at(-1) as ChatTurn).content;
  let embedding: number[] | undefined;
  try {
    [embedding] = await embedTexts([question], 'query');
  } catch (error) {
    console.error('Could not embed the chat question', error);
  }
  if (!embedding) return apiError(503, COPY.providersDown, corsHeaders);

  const chunks = await searchChunks(db, agent.id, embedding, limits.retrievalTopK);
  await touchLastUsed(db, agent.id, now);
  const system = buildSystemPrompt(agent.instruction, chunks);

  // Analytics and token accounting finish before the response body closes,
  // so the serverless function is still alive to send them.
  const pending: Promise<unknown>[] = [];
  const llmEnv = getLlmEnv();
  const model = createFallbackModel(buildChain(llmEnv), {
    firstByteTimeoutMs: llmEnv.firstByteTimeoutMs,
    onFallback: (from, to, reason) => {
      pending.push(captureServer('llm_fallback', { from, to, reason }));
    },
    onStreamError: (provider) => {
      pending.push(captureServer('llm_stream_error', { provider }));
    },
  });

  const result = streamText({
    model,
    system,
    messages: turns,
    maxOutputTokens: limits.maxOutputTokens,
    maxRetries: 0,
    onEnd: async ({ usage, text }) => {
      const tokens = usage.totalTokens ?? estimateTokens(system + text);
      const added = addChatTokens(db, tokens, new Date()).catch((error: unknown) => {
        console.error('Could not record chat tokens', error);
      });
      pending.push(added);
      await added;
    },
  });

  // Reasoning stays on the server: the client stores and resends every message it receives.
  const stream = toUIMessageStream({
    stream: result.stream,
    sendReasoning: false,
    onError: () => COPY.providersDown,
  }).pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      async flush() {
        await Promise.allSettled(pending);
      },
    }),
  );
  return createUIMessageStreamResponse({ headers: corsHeaders, stream });
}
