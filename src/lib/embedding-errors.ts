/**
 * Embedding failures that callers treat differently from a broken provider: the provider said
 * "too many requests" after every retry, or our own daily embedding rail is spent. Both clear up
 * with time, so a crawl leaves the page pending instead of giving up on it.
 */
export class EmbeddingRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingRateLimitError';
  }
}

/** Our daily embedding rail (`MAX_EMBED_REQUESTS_PER_DAY`) refused another provider request. */
export class EmbeddingQuotaError extends EmbeddingRateLimitError {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingQuotaError';
  }
}
