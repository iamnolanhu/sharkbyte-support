/**
 * Google Gemini embeddings (`gemini-embedding-001` on the Gemini API free tier), the default
 * provider. Pages are embedded as RETRIEVAL_DOCUMENT, chat questions as RETRIEVAL_QUERY, at
 * EMBEDDING_CONFIG.dimensions (Matryoshka truncation), and every vector is L2-normalised:
 * Gemini only normalises its full 3072-dimension output.
 *
 * Free-tier limits are roughly 100 requests/min, 30k tokens/min and 1,000 requests/day per
 * Google Cloud project, so batches are capped by an estimated token count as well as by
 * EMBEDDING_CONFIG.batchSize (the API's maximum is 100), and a 429 waits (Google's retryDelay
 * when it sends one) and tries again; a 429 that outlasts the retries is an EmbeddingRateLimitError.
 */

import { EMBEDDING_CONFIG } from './config';
import { EmbeddingRateLimitError } from './embedding-errors';
import type { EmbedFn, EmbedInputType, EmbedOptions } from './embeddings';

/**
 * Estimated tokens per request: about 10 full chunks, so the six pages a crawl reads in
 * parallel stay near the 30k tokens/min free-tier budget instead of far past it.
 */
export const MAX_BATCH_TOKENS = 8_000;
const SERVER_ERROR_RETRY_MS = 1_000;

interface RetryPolicy {
  /** Retries after a 429. */
  maxRetries: number;
  /** Longest single wait after a 429. */
  maxWaitMs: number;
  /** Per request. */
  timeoutMs: number;
  /** Retries after a timeout or network error (never after the caller aborted). */
  networkRetries: number;
}

/** Crawls run in the background with a time budget; a chat question cannot wait long. */
const RETRY_POLICY: Readonly<Record<EmbedInputType, RetryPolicy>> = {
  passage: { maxRetries: 6, maxWaitMs: 30_000, timeoutMs: 20_000, networkRetries: 0 },
  query: { maxRetries: 2, maxWaitMs: 5_000, timeoutMs: 5_000, networkRetries: 1 },
};

const TASK_TYPE: Readonly<Record<EmbedInputType, string>> = {
  passage: 'RETRIEVAL_DOCUMENT',
  query: 'RETRIEVAL_QUERY',
};

/** Same estimate as the chunker: about 4 characters per token. */
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/** Splits texts into batches of at most `maxItems` and (unless a single text is larger) `maxTokens`. */
export function planBatches(texts: readonly string[], maxItems: number, maxTokens: number): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let tokens = 0;
  for (const text of texts) {
    const t = estimateTokens(text);
    if (current.length > 0 && (current.length >= maxItems || tokens + t > maxTokens)) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(text);
    tokens += t;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Scales a vector to unit length (a zero vector is returned unchanged). */
export function l2Normalize(v: readonly number[]): number[] {
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  return norm > 0 ? v.map((x) => x / norm) : [...v];
}

function parseVectors(payload: unknown, expected: number, dims: number): number[][] {
  const list = typeof payload === 'object' && payload !== null ? (payload as { embeddings?: unknown }).embeddings : undefined;
  if (!Array.isArray(list) || list.length !== expected) {
    throw new Error('Gemini embeddings returned an unexpected response shape');
  }
  return list.map((item: unknown) => {
    const values = typeof item === 'object' && item !== null ? (item as { values?: unknown }).values : undefined;
    if (!Array.isArray(values) || !values.every((x) => typeof x === 'number')) {
      throw new Error('Gemini embeddings returned an unexpected response shape');
    }
    if (values.length !== dims) {
      throw new Error(`Gemini embeddings returned dimension ${values.length}, expected ${dims}`);
    }
    return l2Normalize(values as number[]);
  });
}

/** Google's suggested wait from a 429 body (`error.details[].retryDelay`, e.g. "37s"), in ms. */
export function retryDelayMs(payload: unknown): number | null {
  const details = (payload as { error?: { details?: unknown } } | null)?.error?.details;
  if (!Array.isArray(details)) return null;
  for (const d of details) {
    const raw = typeof d === 'object' && d !== null ? (d as { retryDelay?: unknown }).retryDelay : undefined;
    const match = typeof raw === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(raw) : null;
    if (match) return Math.ceil(Number(match[1]) * 1000);
  }
  return null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

interface BatchContext {
  inputType: EmbedInputType;
  apiKey: string;
  model: string;
  dims: number;
  signal?: AbortSignal;
  beforeRequest?: () => Promise<void>;
}

class GeminiHttpError extends Error {
  constructor(readonly status: number) {
    super(`Gemini embeddings failed with HTTP ${status}`);
  }
}

/**
 * One batchEmbedContents call, with 429 waits and one retry of a single input's 5xx.
 * The key travels in the x-goog-api-key header, never in the URL.
 */
async function requestBatch(texts: string[], ctx: BatchContext): Promise<number[][]> {
  const modelPath = ctx.model.startsWith('models/') ? ctx.model : `models/${ctx.model}`;
  const body = JSON.stringify({
    requests: texts.map((text) => ({
      model: modelPath,
      content: { parts: [{ text }] },
      taskType: TASK_TYPE[ctx.inputType],
      outputDimensionality: ctx.dims,
    })),
  });
  const policy = RETRY_POLICY[ctx.inputType];
  let rateLimitRetries = 0;
  let networkRetries = 0;
  let serverRetried = false;
  for (;;) {
    ctx.signal?.throwIfAborted();
    await ctx.beforeRequest?.();
    let res: Response;
    try {
      const timeout = AbortSignal.timeout(policy.timeoutMs);
      res = await fetch(`${EMBEDDING_CONFIG.baseUrl}/${modelPath}:batchEmbedContents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': ctx.apiKey },
        body,
        signal: ctx.signal ? AbortSignal.any([timeout, ctx.signal]) : timeout,
      });
    } catch (err) {
      // A timeout or network error; the caller's own abort is final.
      if (ctx.signal?.aborted || networkRetries >= policy.networkRetries) throw err;
      networkRetries++;
      continue;
    }
    if (res.ok) return parseVectors(await res.json(), texts.length, ctx.dims);
    if (res.status === 429 && rateLimitRetries < policy.maxRetries) {
      const suggested = retryDelayMs(await res.json().catch(() => null));
      const backoff = 2_000 * 2 ** rateLimitRetries;
      rateLimitRetries++;
      await sleep(Math.min(suggested ?? backoff, policy.maxWaitMs), ctx.signal);
      continue;
    }
    await res.body?.cancel().catch(() => undefined);
    if (res.status === 429) throw new EmbeddingRateLimitError('Gemini embeddings failed with HTTP 429');
    if (res.status >= 500 && texts.length === 1 && !serverRetried) {
      serverRetried = true;
      await sleep(SERVER_ERROR_RETRY_MS, ctx.signal);
      continue;
    }
    throw new GeminiHttpError(res.status);
  }
}

/** A batch that fails with a 5xx is retried one input at a time; a 4xx is the request's own fault. */
async function embedBatch(texts: string[], ctx: BatchContext): Promise<number[][]> {
  try {
    return await requestBatch(texts, ctx);
  } catch (err) {
    if (!(err instanceof GeminiHttpError) || err.status < 500 || texts.length === 1) throw err;
    const vectors: number[][] = [];
    for (const text of texts) vectors.push(...(await requestBatch([text], ctx)));
    return vectors;
  }
}

/** Embeds `texts` in token- and size-capped batches; one unit vector per text, in order. */
export const embedTextsGemini: EmbedFn = async (texts, inputType, options: EmbedOptions = {}) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const ctx: BatchContext = {
    inputType,
    apiKey,
    model: EMBEDDING_CONFIG.model,
    dims: EMBEDDING_CONFIG.dimensions,
    signal: options.signal,
    beforeRequest: options.beforeRequest,
  };
  const vectors: number[][] = [];
  for (const batch of planBatches(texts, EMBEDDING_CONFIG.batchSize, MAX_BATCH_TOKENS)) {
    vectors.push(...(await embedBatch(batch, ctx)));
  }
  return vectors;
};
