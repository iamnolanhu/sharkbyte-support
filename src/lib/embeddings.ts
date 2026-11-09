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
}

export type EmbedInputType = 'passage' | 'query';

export type EmbedFn = (texts: string[], inputType: EmbedInputType, options?: EmbedOptions) => Promise<number[][]>;

/** One vector of EMBEDDING_CONFIG.dimensions per text, in order. */
export const embedTexts: EmbedFn = (texts, inputType, options) =>
  EMBEDDING_CONFIG.provider === 'nvidia'
    ? embedTextsNvidia(texts, inputType, options)
    : embedTextsGemini(texts, inputType, options);
