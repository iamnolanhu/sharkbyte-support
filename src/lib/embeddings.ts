/**
 * NVIDIA Build embeddings client (OpenAI-compatible `/embeddings` endpoint).
 * Pages are embedded as 'passage', chat questions as 'query'.
 */

import { EMBEDDING_CONFIG } from './config';

export type EmbedFn = (texts: string[], inputType: 'passage' | 'query') => Promise<number[][]>;

const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 30_000;

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

async function embedBatch(texts: string[], inputType: 'passage' | 'query', apiKey: string): Promise<number[][]> {
  const body = JSON.stringify({
    model: EMBEDDING_CONFIG.model,
    input: texts,
    input_type: inputType,
    encoding_format: 'float',
    truncate: 'END',
    dimensions: EMBEDDING_CONFIG.dimensions,
  });
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${EMBEDDING_CONFIG.baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.ok) return parseVectors(await res.json(), texts.length);
    await res.body?.cancel().catch(() => undefined);
    if (attempt === 0 && isRetryable(res.status)) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    throw new Error(`NVIDIA embeddings failed with HTTP ${res.status}`);
  }
}

/** Embeds `texts` in batches of EMBEDDING_CONFIG.batchSize; one vector per text, in order. */
export const embedTexts: EmbedFn = async (texts, inputType) => {
  const apiKey = process.env.NVIDIA_API_KEY?.trim();
  if (!apiKey) throw new Error('NVIDIA_API_KEY is not set');
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBEDDING_CONFIG.batchSize) {
    vectors.push(...(await embedBatch(texts.slice(i, i + EMBEDDING_CONFIG.batchSize), inputType, apiKey)));
  }
  return vectors;
};
