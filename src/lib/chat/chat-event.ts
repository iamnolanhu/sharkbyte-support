import { createHash } from 'node:crypto';
import type { AnalyticsValue } from '@/lib/analytics/server';
import { APP_DOMAIN } from '@/lib/config';

export type ChatSurface = 'site' | 'embed';
export type ChatOutcome = 'ok' | 'provider_error' | 'embedding_error' | 'rate_limited';

/** What a route knows about the request beyond its body. */
export interface ChatRequestMeta {
  surface: ChatSurface;
  userAgent: string | null;
  origin: string | null;
  referer: string | null;
  /** The Host header the request arrived on: our own host, never the embedding page's. */
  host: string | null;
}

export const QUESTION_CAP = 2000;
export const ANSWER_CAP = 4000;

const VISITOR_SALT = 'sharkbyte-chat-visitor-v1';

export function chatRequestMeta(headers: Headers, surface: ChatSurface): ChatRequestMeta {
  return {
    surface,
    userAgent: headers.get('user-agent'),
    origin: headers.get('origin'),
    referer: headers.get('referer'),
    host: headers.get('host'),
  };
}

/** A stable anonymous visitor id: the raw IP and user agent never leave the server. */
export function hashVisitor(ip: string, userAgent: string | null): string {
  return createHash('sha256').update(`${VISITOR_SALT}|${ip}|${userAgent ?? ''}`).digest('hex');
}

function hostnameOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname || null;
  } catch {
    return null;
  }
}

const MAX_HOST_CHARS = 253;

/** A bare http(s) hostname from the widget's `hostDomain` body field, or null when it is anything else. */
export function sanitizeHostDomain(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_HOST_CHARS) return null;
  if (/[/?#@\s]/.test(value)) return null;
  try {
    const url = new URL(`https://${value}`);
    return url.hostname && !url.port ? url.hostname : null;
  } catch {
    return null;
  }
}

/**
 * The hostname of the page embedding the widget. The widget's own request comes from our iframe,
 * so its `hostDomain` body field is preferred; Origin, then Referer, count only when they are not
 * our own host. Null on the site route.
 */
export function embedHost(meta: ChatRequestMeta, hostDomain: string | null, appDomain: string): string | null {
  if (meta.surface !== 'embed') return null;
  if (hostDomain) return hostDomain;
  const own = new Set(
    [hostnameOf(`https://${appDomain}`), hostnameOf(`https://${meta.host ?? ''}`)].filter(
      (h): h is string => h !== null,
    ),
  );
  for (const candidate of [hostnameOf(meta.origin), hostnameOf(meta.referer)]) {
    if (candidate && !own.has(candidate)) return candidate;
  }
  return null;
}

export function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

export interface ChatEventInput {
  agentId: string;
  domain: string;
  meta: ChatRequestMeta;
  /** The sanitized `hostDomain` the widget sent, if any. */
  hostDomain: string | null;
  question: string;
  answer: string | null;
  provider: string | null;
  model: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number;
  retrievedChunks: number;
  fallbackCount: number;
  outcome: ChatOutcome;
}

/** The `chat_completed` properties. `chat_surface` avoids the server's own `surface` tag. */
export function chatEventProperties(input: ChatEventInput): Record<string, string | number | boolean | null> {
  return {
    agentId: input.agentId,
    domain: input.domain,
    chat_surface: input.meta.surface,
    question: clip(input.question, QUESTION_CAP),
    answer: input.answer === null ? null : clip(input.answer, ANSWER_CAP),
    provider: input.provider,
    model: input.model,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    latencyMs: input.latencyMs,
    retrievedChunks: input.retrievedChunks,
    fallbackCount: input.fallbackCount,
    outcome: input.outcome,
    host_domain: embedHost(input.meta, input.hostDomain, APP_DOMAIN),
  };
}

/** A chat id the client sent (the AI SDK's `id`), safe to use as an LLM-analytics trace id. */
export function sanitizeTraceId(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_\-:.]{1,128}$/.test(value) ? value : null;
}

/** Our fields on every LLM-analytics event; `chat_surface` avoids the server's own `surface` tag. */
interface AiEventContext {
  traceId: string;
  agentId: string;
  domain: string;
  meta: ChatRequestMeta;
  hostDomain: string | null;
}

function contextProperties(c: AiEventContext): Record<string, AnalyticsValue> {
  return {
    $ai_trace_id: c.traceId,
    agentId: c.agentId,
    domain: c.domain,
    chat_surface: c.meta.surface,
    host_domain: embedHost(c.meta, c.hostDomain, APP_DOMAIN),
  };
}

export interface AiGenerationInput extends AiEventContext {
  /** Provider and model that answered; null when every provider failed before answering. */
  provider: string | null;
  model: string | null;
  baseUrl: string | null;
  /** The system prompt (instruction + retrieved pages) and the conversation, as sent. */
  system: string;
  turns: readonly { role: 'user' | 'assistant'; content: string }[];
  answer: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  failed: boolean;
}

/** PostHog `$ai_generation` properties for one chat turn ($ai_latency in seconds). */
export function aiGenerationProperties(g: AiGenerationInput): Record<string, AnalyticsValue> {
  return {
    ...contextProperties(g),
    $ai_model: g.model ?? 'unknown',
    $ai_provider: g.provider ?? 'unknown',
    $ai_base_url: g.baseUrl,
    $ai_input: [{ role: 'system', content: g.system }, ...g.turns.map((t) => ({ role: t.role, content: t.content }))],
    $ai_output_choices: g.answer ? [{ role: 'assistant', content: g.answer }] : [],
    $ai_input_tokens: g.inputTokens,
    $ai_output_tokens: g.outputTokens,
    $ai_latency: g.latencyMs / 1000,
    $ai_http_status: g.failed ? null : 200,
    $ai_is_error: g.failed,
  };
}

export interface AiEmbeddingInput extends AiEventContext {
  provider: string;
  model: string;
  baseUrl: string;
  question: string;
  latencyMs: number;
  failed: boolean;
}

/** PostHog `$ai_embedding` properties for the chat question's embedding ($ai_latency in seconds). */
export function aiEmbeddingProperties(e: AiEmbeddingInput): Record<string, AnalyticsValue> {
  return {
    ...contextProperties(e),
    $ai_model: e.model,
    $ai_provider: e.provider,
    $ai_base_url: e.baseUrl,
    $ai_input: e.question,
    $ai_latency: e.latencyMs / 1000,
    $ai_is_error: e.failed,
  };
}
