import { createHash } from 'node:crypto';

export type ChatSurface = 'site' | 'embed';
export type ChatOutcome = 'ok' | 'provider_error' | 'rate_limited';

/** What a route knows about the request beyond its body. */
export interface ChatRequestMeta {
  surface: ChatSurface;
  userAgent: string | null;
  origin: string | null;
  referer: string | null;
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

/** The hostname of the page embedding the widget, from Origin, else Referer; null on the site. */
export function embedHost(meta: ChatRequestMeta): string | null {
  if (meta.surface !== 'embed') return null;
  return hostnameOf(meta.origin) ?? hostnameOf(meta.referer);
}

export function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

export interface ChatEventInput {
  agentId: string;
  domain: string;
  meta: ChatRequestMeta;
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
    host_domain: embedHost(input.meta),
  };
}
