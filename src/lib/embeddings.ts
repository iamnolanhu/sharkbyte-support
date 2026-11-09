/**
 * Text embeddings for the crawler (pages, 'passage') and chat retrieval (questions, 'query').
 * The provider comes from EMBEDDING_PROVIDER: Gemini by default, NVIDIA as the fallback.
 */

import { EMBEDDING_CONFIG } from './config';
import { embedTextsGemini } from './embeddings-gemini';
import { embedTextsNvidia } from './embeddings-nvidia';

export interface EmbedOptions {
  /** Aborts the request in flight and stops before the next one (the crawl's time budget). */
  signal?: AbortSignal;
  /**
   * Called before every provider request; throws (EmbeddingQuotaError) to refuse it. Callers
   * pass the daily embedding rail here.
   */
  beforeRequest?: () => Promise<void>;
}

export type EmbedInputType = 'passage' | 'query';

export type EmbedFn = (texts: string[], inputType: EmbedInputType, options?: EmbedOptions) => Promise<number[][]>;

/** A chat question waits at most this long for its embedding, retries included. */
export const QUERY_EMBED_BUDGET_MS = 12_000;

/** One vector of EMBEDDING_CONFIG.dimensions per text, in order. */
export const embedTexts: EmbedFn = (texts, inputType, options = {}) => {
  const budget = inputType === 'query' ? AbortSignal.timeout(QUERY_EMBED_BUDGET_MS) : undefined;
  const signal = budget && options.signal ? AbortSignal.any([budget, options.signal]) : (budget ?? options.signal);
  const opts: EmbedOptions = { ...options, signal };
  return EMBEDDING_CONFIG.provider === 'nvidia'
    ? embedTextsNvidia(texts, inputType, opts)
    : embedTextsGemini(texts, inputType, opts);
};
