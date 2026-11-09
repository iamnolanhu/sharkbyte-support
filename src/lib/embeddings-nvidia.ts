/**
 * NVIDIA Build embeddings client (OpenAI-compatible `/embeddings` endpoint), the fallback
 * provider (`EMBEDDING_PROVIDER=nvidia`). Pages are embedded as 'passage', chat questions as 'query'.
 */

import { EMBEDDING_CONFIG } from './config';
import type { EmbedFn } from './embeddings';

const RETRY_DELAY_MS = 1000;
/**
 * Per request. A single input that times out, waits and times out again takes 2 × 8 + 1 = 17 s,
 * inside the crawl's 20 s finish margin; the crawl's own signal bounds everything else.
 */
const REQUEST_TIMEOUT_MS = 8_000;

interface EmbeddingItem {
  index: number;
  embedding: number[];
}

function isEmbeddingItem(value: unknown): value is EmbeddingItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as { index?: unknown; embedding?: unknown };
  return (
    typeof item.index === 'number' &&
    Array.isArray(item.embedding) &&
    item.embedding.every((x) => typeof x === 'number')
  );
}

function parseVectors(payload: unknown, expected: number): number[][] {
  const data = typeof payload === 'object' && payload !== null ? (payload as { data?: unknown }).data : undefined;
  if (!Array.isArray(data) || data.length !== expected || !data.every(isEmbeddingItem)) {
    throw new Error('NVIDIA embeddings returned an unexpected response shape');
  }
  const vectors = [...data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
  for (const v of vectors) {
    if (v.length !== EMBEDDING_CONFIG.dimensions) {
      throw new Error(`NVIDIA embeddings returned dimension ${v.length}, expected ${EMBEDDING_CONFIG.dimensions}`);
    }
  }
  return vectors;
}

const isRetryable = (status: number) => status === 429 || status >= 500;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface BatchContext {
  inputType: 'passage' | 'query';
  apiKey: string;
  signal?: AbortSignal;
}

/**
 * Embeds one batch. NVIDIA's hosted embedder answers multi-input requests with intermittent
 * 500s while single inputs succeed, so a batch that gets a 5xx is split in halves and each half
 * retried, down to single inputs. A 429 retries the same batch once (splitting would only add
 * requests); a single input keeps its one retry for any retryable status.
 */
async function embedBatch(texts: string[], ctx: BatchContext): Promise<number[][]> {
  const body = JSON.stringify({
    model: EMBEDDING_CONFIG.model,
    input: texts,
    input_type: ctx.inputType,
    encoding_format: 'float',
    truncate: 'END',
    dimensions: EMBEDDING_CONFIG.dimensions,
  });
  for (let attempt = 0; ; attempt++) {
    ctx.signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const res = await fetch(`${EMBEDDING_CONFIG.baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.apiKey}` },
      body,
      signal: ctx.signal ? AbortSignal.any([timeout, ctx.signal]) : timeout,
    });
    if (res.ok) return parseVectors(await res.json(), texts.length);
    await res.body?.cancel().catch(() => undefined);
    if (res.status >= 500 && texts.length > 1) {
      const half = Math.ceil(texts.length / 2);
      const first = await embedBatch(texts.slice(0, half), ctx);
      return [...first, ...(await embedBatch(texts.slice(half), ctx))];
    }
    if (attempt === 0 && isRetryable(res.status)) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    throw new Error(`NVIDIA embeddings failed with HTTP ${res.status}`);
  }
}

/** Embeds `texts` in batches of EMBEDDING_CONFIG.batchSize; one vector per text, in order. */
export const embedTextsNvidia: EmbedFn = async (texts, inputType, options = {}) => {
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  if (!apiKey) throw new Error('NVIDIA_API_KEY is not set');
  const ctx: BatchContext = { inputType, apiKey, signal: options.signal };
  const size = EMBEDDING_CONFIG.batchSize;
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += size) {
    vectors.push(...(await embedBatch(texts.slice(i, i + size), ctx)));
  }
  return vectors;
};
