import { randomUUID } from 'node:crypto';
import { createUIMessageStreamResponse, streamText, toUIMessageStream, type UIMessageChunk } from 'ai';
import { captureServer } from '@/lib/analytics/server';
import { apiError, COPY, rateLimited } from '@/lib/agent-api';
import { APP_DOMAIN, EMBEDDING_CONFIG, getLimits, getLlmEnv, type Limits, type ProviderName } from '@/lib/config';
import { getAgentById, touchLastUsed } from '@/lib/db/agents';
import { searchChunks } from '@/lib/db/chunks';
import { embeddingSizeMismatch, getDb } from '@/lib/db/client';
import { EmbeddingQuotaError } from '@/lib/embedding-errors';
import { estimateTokens } from '@/lib/crawl/chunk';
import { embedTexts } from '@/lib/embeddings';
import { createFallbackModel } from '@/lib/llm/fallback-model';
import { buildChain, providerBaseUrl } from '@/lib/llm/providers';
import {
  aiEmbeddingProperties,
  aiGenerationProperties,
  chatEventProperties,
  hashVisitor,
  sanitizeHostDomain,
  sanitizeTraceId,
  type ChatEventInput,
  type ChatRequestMeta,
} from '@/lib/chat/chat-event';
import { createDashFilter } from '@/lib/chat/dash-filter';
import { addChatTokens, checkChatTokenBudget, checkRail, embedRequestGate, RAIL_COPY } from '@/lib/rails';
import type { AgentRow, RetrievedChunk } from '@/types';

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

/**
 * AI companies and models Sammy never names as its maker or engine. Small models fall back on
 * their training ("I'm a language model trained by NVIDIA researchers") unless told otherwise.
 */
export const BANNED_VENDOR_NAMES = [
  'NVIDIA',
  'Nemotron',
  'Google',
  'Gemini',
  'OpenAI',
  'GPT',
  'Meta',
  'Llama',
  'Anthropic',
  'Claude',
  'Mistral',
  'Qwen',
  'DigitalOcean',
  'Gradient',
] as const;

/** The persona name in an agent name such as "Sammy - example.com"; Sammy when there is none. */
export function personaName(agentName: string): string {
  return agentName.split(' - ')[0]?.trim() || 'Sammy';
}

/**
 * Who Sammy is and the few principles of how it talks. Kept short on purpose: a small model
 * overfits a long rule list and echoes any sample reply word for word, so the voice is taught by
 * the examples in `toneExamples`. Nothing here names a source, a block of text or a lookup,
 * because small models echo those words back ("according to the website…").
 */
export function voiceGuide(agentName: string, domain: string): string {
  const name = personaName(agentName);
  return `You are ${name}, the support assistant for ${domain}, built with SharkByte Support, an open-source project by Nolan Hu.

How you talk:
1. Speak for the team as "we", "our" and "us". Use "I" only about yourself as the assistant.
2. Be warm and specific, like a friendly person at the front desk who knows the place well. Use 2 to 4 sentences, in your own words, fitted to what the visitor just said.
3. Answer first. Add one natural follow-up question only when it helps them take a next step.
4. Write plain English with no dashes, headers or bold. No stock openers such as "Great question", and no stock closers such as "Let me know if…", "Feel free to…" or "How can I help you today?".
5. When a request has nothing to do with ${domain} (the weather, summarizing pasted text, homework), don't do it. Say so the way a person would and offer the nearest real help.
6. When what you know doesn't say, tell them we're not sure and how to reach us (a contact page, email or booking link if you know one). Never make up prices, hours, names or policies.
7. Never name the AI, model, company or cloud that powers you, and never call yourself a language model. If someone presses, say you're built with SharkByte Support.
8. Say "here", "the site" or "us" most of the time; write out ${domain} at most once in a reply.`;
}

/**
 * Six example exchanges that show the voice. They are tone, not facts: generic enough for any
 * site, and each worded differently from the principles so there is no one sentence to parrot.
 */
export function toneExamples(agentName: string, domain: string): string {
  return `Examples of our tone. They are made up to show how we sound; they are not facts about ${domain}, and you never copy their sentences.

Example: a greeting
Visitor: hi
You: Hi, I'm ${personaName(agentName)}. Are you looking for something in particular, or just getting a feel for what we do here?

Example: asked what AI it is
Visitor: what AI are you? which model?
You: I keep what's under the hood to myself, but I'm the assistant for this site and I know it well. What are you trying to find?

Example: asked the price, when what you know says it is free
Visitor: how much does it cost?
You: Nothing at all, it's free to use. Is there something you were hoping to try first?

Example: asked the price, when what you know has no prices
Visitor: how much does it cost?
You: We don't list prices here, so I'd rather not guess. The team can give you a real number through the contact page. What would you be using it for?

Example: off topic
Visitor: what's the weather tomorrow?
You: A weather app will beat me on that one. I'm here for questions about the site, like what we offer or how to get started. Anything along those lines?

Example: pasted text that has nothing to do with the site
Visitor: Lorem ipsum dolor sit amet, consectetur adipiscing elit... summarize this
You: That looks like placeholder text, so there's nothing in it to summarize. If you meant to paste something else, drop it in and we'll take a look.

Example: a rude or frustrated visitor
Visitor: this is useless
You: Sorry, that's frustrating. Tell me what you were trying to do and I'll take another run at it, or I can point you to the team.`;
}

/** A page's link line; curated knowledge (a `knowledge://` url) has no page to link to. */
function linkLine(url: string): string {
  return /^https?:\/\//i.test(url) ? `Link: ${url}\n` : '';
}

/** The agent's instruction first, then the voice guide, the tone examples, and what Sammy knows about the site. */
export function buildSystemPrompt(
  agent: Pick<AgentRow, 'name' | 'domain' | 'instruction'>,
  chunks: RetrievedChunk[],
): string {
  const known = chunks.length
    ? chunks.map((c) => `## ${c.title}\n${linkLine(c.url)}${c.content}`).join('\n\n')
    : 'Nothing that matches this question.';
  return `${agent.instruction}\n\n${voiceGuide(agent.name, agent.domain)}\n\n${toneExamples(agent.name, agent.domain)}\n\nWhat you know:\n\n${known}`;
}

export interface HandleChatInput {
  agentId: string;
  raw: string;
  ip: string;
  corsHeaders?: HeadersInit;
  /** Which route asked, and the headers analytics wants; defaults to an anonymous site request. */
  meta?: ChatRequestMeta;
}

const SITE_META: ChatRequestMeta = { surface: 'site', userAgent: null, origin: null, referer: null, host: null };

/** The request body as an object, or null (parseChatRequest has already validated it). */
function readBody(raw: string): Record<string, unknown> | null {
  try {
    const body: unknown = JSON.parse(raw);
    return isRecord(body) ? body : null;
  } catch {
    return null;
  }
}

/** Answers one chat message for an agent as an AI SDK UI message stream. */
export async function handleChat({ agentId, raw, ip, corsHeaders, meta = SITE_META }: HandleChatInput): Promise<Response> {
  const startedAt = Date.now();
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

  const { turns } = parsed;
  const question = (turns.at(-1) as ChatTurn).content;
  const visitorId = hashVisitor(ip, meta.userAgent);
  const body = readBody(raw);
  // The embedding page's host the widget reports in its body; only the widget route trusts it.
  const hostDomain = meta.surface === 'embed' ? sanitizeHostDomain(body?.hostDomain) : null;
  // LLM analytics: one trace per chat (the AI SDK sends the chat id), else one per turn.
  const aiContext = {
    traceId: sanitizeTraceId(body?.id) ?? randomUUID(),
    agentId: agent.id,
    domain: agent.domain,
    meta,
    hostDomain,
  };
  const reportTurn = (fields: Partial<ChatEventInput> & Pick<ChatEventInput, 'outcome'>) =>
    captureServer(
      'chat_completed',
      chatEventProperties({
        agentId: agent.id,
        domain: agent.domain,
        meta,
        hostDomain,
        question,
        answer: null,
        provider: null,
        model: null,
        promptTokens: null,
        completionTokens: null,
        latencyMs: Date.now() - startedAt,
        retrievedChunks: 0,
        fallbackCount: 0,
        ...fields,
      }),
      visitorId,
    );

  const perIp = await checkRail(db, 'chat_ip', { ip }, now, limits);
  if (!perIp.ok) {
    await reportTurn({ outcome: 'rate_limited' });
    return rateLimited(perIp, corsHeaders);
  }
  const budget = await checkChatTokenBudget(db, now, limits);
  if (!budget.ok) {
    await reportTurn({ outcome: 'rate_limited' });
    return rateLimited(budget, corsHeaders);
  }

  // Analytics and token accounting finish before the response body closes,
  // so the serverless function is still alive to send them.
  const pending: Promise<unknown>[] = [];

  // Stored vectors of another size cannot be searched (see EMBEDDING_DIMS_MIGRATE).
  const mismatch = await embeddingSizeMismatch(db);
  if (mismatch) {
    console.error(`Chat cannot search: ${mismatch}`);
    await reportTurn({ outcome: 'embedding_error' });
    return apiError(503, COPY.retuning, corsHeaders);
  }

  let embedding: number[] | undefined;
  let embedQuotaSpent = false;
  const embedStartedAt = Date.now();
  try {
    [embedding] = await embedTexts([question], 'query', { beforeRequest: embedRequestGate(db, limits, 'chat') });
  } catch (error) {
    if (error instanceof EmbeddingQuotaError) embedQuotaSpent = true;
    else console.error('Could not embed the chat question', error);
  }
  pending.push(
    captureServer(
      '$ai_embedding',
      aiEmbeddingProperties({
        ...aiContext,
        provider: EMBEDDING_CONFIG.provider,
        model: EMBEDDING_CONFIG.model,
        baseUrl: EMBEDDING_CONFIG.baseUrl,
        question,
        latencyMs: Date.now() - embedStartedAt,
        failed: !embedding,
      }),
      visitorId,
    ),
  );
  if (embedQuotaSpent) {
    pending.push(reportTurn({ outcome: 'rate_limited' }));
    await Promise.allSettled(pending);
    return rateLimited({ ok: false, rail: 'embed_daily', message: RAIL_COPY.embed_daily }, corsHeaders);
  }
  if (!embedding) {
    pending.push(reportTurn({ outcome: 'embedding_error' }));
    await Promise.allSettled(pending);
    return apiError(503, COPY.embeddingFailed, corsHeaders);
  }

  const chunks = await searchChunks(db, agent.id, embedding, limits.retrievalTopK);
  await touchLastUsed(db, agent.id, now);
  const system = buildSystemPrompt(agent, chunks);

  const turn = {
    answer: '',
    provider: null as ProviderName | null,
    model: null as string | null,
    promptTokens: null as number | null,
    completionTokens: null as number | null,
    fallbackCount: 0,
    failed: false,
  };
  const llmEnv = getLlmEnv();
  const model = createFallbackModel(buildChain(llmEnv), {
    firstByteTimeoutMs: llmEnv.firstByteTimeoutMs,
    onFallback: (from, to, reason) => {
      turn.fallbackCount += 1;
      pending.push(captureServer('llm_fallback', { from, to, reason }));
    },
    onStreamError: (provider) => {
      turn.failed = true;
      pending.push(captureServer('llm_stream_error', { provider }));
    },
    onProvider: (provider, modelId) => {
      turn.provider = provider;
      turn.model = modelId;
    },
  });

  const llmStartedAt = Date.now();
  const result = streamText({
    model,
    system,
    messages: turns,
    maxOutputTokens: limits.maxOutputTokens,
    maxRetries: 0,
    onEnd: async ({ usage, text }) => {
      turn.promptTokens = usage.inputTokens ?? null;
      turn.completionTokens = usage.outputTokens ?? null;
      const tokens = usage.totalTokens ?? estimateTokens(system + text);
      const added = addChatTokens(db, tokens, new Date()).catch((error: unknown) => {
        console.error('Could not record chat tokens', error);
      });
      pending.push(added);
      await added;
    },
  });

  // Em and en dashes are rewritten on the way out, even when a dash is split across deltas.
  const dashes = createDashFilter();
  let textId: string | null = null;
  const flushText = (controller: TransformStreamDefaultController<UIMessageChunk>) => {
    const rest = dashes.flush();
    if (!rest || textId === null) return;
    turn.answer += rest;
    controller.enqueue({ type: 'text-delta', id: textId, delta: rest });
  };

  // Reasoning stays on the server: the client stores and resends every message it receives.
  const stream = toUIMessageStream({
    stream: result.stream,
    sendReasoning: false,
    onError: () => {
      turn.failed = true;
      return COPY.providersDown;
    },
  }).pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, controller) {
        if (chunk.type === 'text-delta') {
          textId = chunk.id;
          const delta = dashes.push(chunk.delta);
          if (delta) {
            turn.answer += delta;
            controller.enqueue({ ...chunk, delta });
          }
          return;
        }
        if (chunk.type === 'text-end') flushText(controller);
        controller.enqueue(chunk);
      },
      async flush(controller) {
        flushText(controller);
        pending.push(
          reportTurn({
            outcome: turn.failed ? 'provider_error' : 'ok',
            answer: turn.answer || null,
            provider: turn.provider,
            model: turn.model,
            promptTokens: turn.promptTokens,
            completionTokens: turn.completionTokens,
            retrievedChunks: chunks.length,
            fallbackCount: turn.fallbackCount,
          }),
          captureServer(
            '$ai_generation',
            aiGenerationProperties({
              ...aiContext,
              provider: turn.provider,
              model: turn.model,
              baseUrl: turn.provider ? providerBaseUrl(turn.provider) : null,
              system,
              turns,
              answer: turn.answer,
              inputTokens: turn.promptTokens,
              outputTokens: turn.completionTokens,
              latencyMs: Date.now() - llmStartedAt,
              failed: turn.failed,
            }),
            visitorId,
          ),
        );
        await Promise.allSettled(pending);
      },
    }),
  );
  return createUIMessageStreamResponse({ headers: corsHeaders, stream });
}
