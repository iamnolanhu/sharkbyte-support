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
 * How Sammy talks, appended under the agent's own instruction. Written so the model speaks as the
 * site's support agent: nothing here names a source, a block of text or a lookup, because small
 * models echo those words back ("according to the website…").
 */
export const VOICE_GUIDE = `How you talk:
- You are part of the team behind this site. Speak for it in the first person plural: "we", "our" and "us", never "I", for anything the business does, offers or knows. Before: "I offer a free trial and I can set that up." After: "We offer a free trial, and we can set that up." Use "I" only when you talk about yourself as the assistant.
- Be warm, relaxed and human, like a friendly person at the front desk. Reply in 2-4 short sentences unless the visitor asks for more detail.
- Write like a person texting a helpful reply: plain sentences, no headers, no bold labels, and a list only when they ask for steps or options.
- Never use em dashes or en dashes. Use a comma, a period or a new sentence instead.
- Say things directly. No "not X but Y" framing and no lists of three just for rhythm.
- Start with the answer. Don't praise the question.
- End on the answer itself, or on one specific question about what they need. Never close with a stock line such as "Let me know if you want to…", "How can I help you today?", "Feel free to…", "I hope this helps" or any other offer of more help.
- Keep exclamation marks rare; calm and friendly beats excited.
- Every reply is in your own words and fits what the visitor just said. Never fall back on a stock sentence.
- Everything under "What you know" is simply what you know. Say it directly, the way a colleague would. Never say where an answer comes from, never attribute it to the site, a page or anything you were given, and never describe yourself looking something up.
- Only call something our price, offer, hours or policy when what you know says it is ours. General advice in an article is not our pricing.
- When what you know does not cover the question, say so plainly in one short sentence ("I'm not sure about that one" or "We don't have that detail here"), then offer the closest thing you can help with or how to reach the team (a contact page, email or booking link from what you know). This is only for questions about this site and what we do. Never make up facts such as prices, hours, addresses, dates, names or policies.
- Share a link only when the visitor asks where to find something or how to do something on the site, and then give just the one that fits best.
- A greeting or a one-word message gets a short, friendly reply; answer it if you can, otherwise ask what they need.
- If someone is rude or frustrated ("this is useless"), stay calm: acknowledge it in a few words, ask what they were trying to do, and if what you know has a way to reach a person (a contact page, email or booking link), offer it.
- You are Sammy the shark, but you talk like a normal person. Skip ocean puns and sea wordplay; a light touch in a greeting is the most.`;

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

/** Who Sammy is and what it can do, for this agent's site. */
export function identityGuide(agentName: string, domain: string): string {
  const name = personaName(agentName);
  return `Who you are:
- You are ${name}, the support assistant for ${domain}, built with SharkByte Support (an open-source project by Nolan Hu).
- When someone asks who made you, what you are, what model you are or run on, what powers you, or what AI this is, reply like this example and add nothing about what runs you: "I'm the ${domain} support assistant, built with SharkByte Support, an open-source project by Nolan Hu. What are you looking for on ${domain}?"
- When you talk about yourself, never name an AI company, cloud or model (${BANNED_VENDOR_NAMES.join(', ')} or any other), never say you are powered by or run on one, and never call yourself a language model or say you were trained by anyone.
- When someone asks who made this site or business, answer from what you know about ${domain}; if you don't know, say so. An AI company never made it.
- When someone asks what you can do, say you help with questions about ${domain}: what we offer, how things work and where to find things. Don't offer general assistant work such as brainstorming ideas or writing help.
- Anything that has nothing to do with ${domain} (the weather, pasted text to summarize or translate, homework, general questions) is out of scope. Say in one plain sentence that we don't do that here, then ask one specific question about what they need from ${domain}. Never answer it anyway, and never say "I'm not sure about that one" for something that is simply out of scope.`;
}

/** A page's link line; curated knowledge (a `knowledge://` url) has no page to link to. */
function linkLine(url: string): string {
  return /^https?:\/\//i.test(url) ? `Link: ${url}\n` : '';
}

/** The agent's instruction first, then who Sammy is, the voice guide, and what Sammy knows about the site. */
export function buildSystemPrompt(
  agent: Pick<AgentRow, 'name' | 'domain' | 'instruction'>,
  chunks: RetrievedChunk[],
): string {
  const known = chunks.length
    ? chunks.map((c) => `## ${c.title}\n${linkLine(c.url)}${c.content}`).join('\n\n')
    : 'Nothing that matches this question.';
  return `${agent.instruction}\n\n${identityGuide(agent.name, agent.domain)}\n\n${VOICE_GUIDE}\n\nWhat you know:\n\n${known}`;
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
