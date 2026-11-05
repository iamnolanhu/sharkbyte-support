/**
 * Postgres schema, one statement per entry: the Neon HTTP driver runs one
 * statement per query, and a TS constant ships with every function bundle.
 *
 * There is deliberately no vector index on chunks.embedding: retrieval is an
 * exact search inside one agent's rows (at most a few hundred).
 */
export const SCHEMA_STATEMENTS: readonly string[] = [
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
  embedding halfvec(1024) NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS chunks_agent_id_idx ON chunks (agent_id)`,
  `CREATE TABLE IF NOT EXISTS quota (key text PRIMARY KEY, count bigint NOT NULL, expires_at timestamptz NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS locks (key text PRIMARY KEY, expires_at timestamptz NOT NULL)`,
];
