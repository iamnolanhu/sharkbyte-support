/**
 * Postgres schema, one statement per entry: the Neon HTTP driver runs one
 * statement per query, and the statements ship with every function bundle.
 *
 * There is deliberately no vector index on chunks.embedding: retrieval is an
 * exact search inside one agent's rows (at most a few hundred).
 *
 * `dims` sizes chunks.embedding for a new database; an existing column of another
 * size is migrated by `embeddingDimsMigration`.
 */
export function schemaStatements(dims: number): readonly string[] {
  assertDims(dims);
  return [
    `CREATE EXTENSION IF NOT EXISTS vector`,
    `CREATE TABLE IF NOT EXISTS agents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    domain text NOT NULL UNIQUE,
    url text NOT NULL,
    name text NOT NULL,
    instruction text NOT NULL,
    status text NOT NULL CHECK (status IN ('crawling','ready','failed')),
    pages_crawled int NOT NULL DEFAULT 0,
    pages_total int NOT NULL DEFAULT 0,
    chunk_count int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now(),
    crawl_started_at timestamptz,
    last_error text,
    pinned boolean NOT NULL DEFAULT false,
    owner_token_hash text
  )`,
    `CREATE INDEX IF NOT EXISTS agents_sweep_idx ON agents (pinned, last_used_at)`,
    `CREATE TABLE IF NOT EXISTS chunks (
    id bigserial PRIMARY KEY,
    agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    url text NOT NULL,
    title text NOT NULL DEFAULT '',
    pos int NOT NULL,
    content text NOT NULL,
    embedding halfvec(${dims}) NOT NULL
  )`,
    `CREATE INDEX IF NOT EXISTS chunks_agent_id_idx ON chunks (agent_id)`,
    `CREATE TABLE IF NOT EXISTS quota (key text PRIMARY KEY, count bigint NOT NULL, expires_at timestamptz NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS locks (key text PRIMARY KEY, expires_at timestamptz NOT NULL)`,
    // Resumable crawls: the URLs still to read (NULL until discovery), pages given up on,
    // slices run so far, and when the crawl last made progress (stall detection). Checked
    // first, so a cold start does not take ALTER TABLE's exclusive lock once they exist.
    `DO $add_crawl_columns$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'agents' AND column_name = 'crawl_progress_at') THEN
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS crawl_pending text[];
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS crawl_skipped int NOT NULL DEFAULT 0;
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS crawl_slices int NOT NULL DEFAULT 0;
    ALTER TABLE agents ADD COLUMN IF NOT EXISTS crawl_progress_at timestamptz;
  END IF;
END
$add_crawl_columns$`,
  ];
}

function assertDims(dims: number): void {
  if (!Number.isInteger(dims) || dims < 1 || dims > 4000) throw new Error(`Invalid embedding dimensions: ${dims}`);
}

/** Last error on agents emptied by an embedding-size migration; the importer and Repair re-crawl them. */
export const REEMBED_REQUIRED_ERROR = 're-embedding required';

/** The current chunks.embedding size (pgvector keeps it in atttypmod) and how many agents a migration would mark. */
export const EMBEDDING_DIMS_PROBE = `SELECT
  (SELECT atttypmod FROM pg_attribute WHERE attrelid = 'chunks'::regclass AND attname = 'embedding') AS dims,
  (SELECT count(*) FROM agents WHERE status <> 'crawling') AS agents`;

/**
 * When chunks.embedding is not halfvec(dims): empties chunks (vectors of another model or size
 * cannot be compared), resizes the column, marks every agent that is not crawling `failed`
 * with REEMBED_REQUIRED_ERROR so it gets re-crawled, and resets the progress of crawling ones
 * (their stored pages are gone). A no-op when the size already matches. Only run with
 * EMBEDDING_DIMS_MIGRATE=1 (see applySchema).
 */
export function embeddingDimsMigration(dims: number): string {
  assertDims(dims);
  return `DO $migrate$
BEGIN
  IF (SELECT atttypmod FROM pg_attribute WHERE attrelid = 'chunks'::regclass AND attname = 'embedding') <> ${dims} THEN
    TRUNCATE chunks;
    ALTER TABLE chunks ALTER COLUMN embedding TYPE halfvec(${dims}) USING NULL;
    UPDATE agents SET status = 'failed', last_error = '${REEMBED_REQUIRED_ERROR}', chunk_count = 0, crawl_pending = NULL
      WHERE status <> 'crawling';
    UPDATE agents SET chunk_count = 0, pages_crawled = 0, crawl_pending = NULL, crawl_slices = 0, crawl_skipped = 0
      WHERE status = 'crawling';
  END IF;
END
$migrate$`;
}
