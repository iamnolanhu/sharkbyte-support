import type { Limits } from '@/lib/config';
import type { ChunkInput, RetrievedChunk } from '@/types';
import { isUuid } from './agents';
import type { Db } from './client';

/** Advisory-lock key every chunk write takes, so concurrent crawls cannot cross the ceiling. */
export const CHUNK_CEILING_LOCK_ID = 74210;

/** pgvector text form of an embedding, cast with `::halfvec` in SQL. */
export function toVectorLiteral(v: readonly number[]): string {
  return '[' + v.join(',') + ']';
}

/** A crawled page to record with its chunks: off the crawl's to-do list, counters updated. */
export interface CrawledPage {
  url: string;
  /** Pages crawled including this one. */
  pagesCrawled: number;
  pagesSkipped: number;
  now: Date;
}

/**
 * Inserts chunks in order until the table holds `maxTotalChunks` rows, and
 * returns how many went in. The count and the insert run in one transaction
 * behind CHUNK_CEILING_LOCK_ID, so the ceiling holds across concurrent crawls.
 * With `page`, the same transaction records the page on the agent row, so a
 * stored page is never left on the to-do list (or the reverse).
 */
export async function insertChunksWithinCeiling(
  db: Db,
  agentId: string,
  chunks: ChunkInput[],
  maxTotalChunks: number,
  page?: CrawledPage,
): Promise<number> {
  if (chunks.length === 0 && !page) return 0;
  const record = page
    ? [
        {
          text: `UPDATE agents SET crawl_pending = array_remove(crawl_pending, $2), pages_crawled = $3,
                   chunk_count = (SELECT count(*) FROM chunks WHERE agent_id = $1), crawl_skipped = $4,
                   crawl_progress_at = $5
                 WHERE id = $1`,
          params: [agentId, page.url, page.pagesCrawled, page.pagesSkipped, page.now],
        },
      ]
    : [];
  const results = await db.transaction([
    { text: 'SELECT pg_advisory_xact_lock($1)', params: [CHUNK_CEILING_LOCK_ID] },
    {
      text: `INSERT INTO chunks (agent_id, url, title, pos, content, embedding)
             SELECT $1::uuid, t.url, t.title, t.pos, t.content, t.embedding::halfvec
             FROM unnest($2::text[], $3::text[], $4::int[], $5::text[], $6::text[])
               WITH ORDINALITY AS t(url, title, pos, content, embedding, ord)
             ORDER BY t.ord
             LIMIT GREATEST($7::int - (SELECT count(*) FROM chunks), 0)
             RETURNING id`,
      params: [
        agentId,
        chunks.map((c) => c.url),
        chunks.map((c) => c.title),
        chunks.map((c) => c.pos),
        chunks.map((c) => c.content),
        chunks.map((c) => toVectorLiteral(c.embedding)),
        maxTotalChunks,
      ],
    },
    ...record,
  ]);
  return results[1]?.length ?? 0;
}

/**
 * Replaces the agent's chunks stored under `sourceUrl` (curated knowledge, not a crawled page)
 * with `chunks`, in order, as far as the per-agent cap and the global ceiling allow, and
 * returns how many went in. Other chunks of the agent stay; `chunk_count` is recounted. One
 * transaction behind CHUNK_CEILING_LOCK_ID, like every chunk write.
 */
export async function replaceSourceChunks(
  db: Db,
  agentId: string,
  sourceUrl: string,
  chunks: ChunkInput[],
  limits: Pick<Limits, 'maxChunksPerAgent' | 'maxTotalChunks'>,
): Promise<number> {
  if (!isUuid(agentId)) return 0;
  const results = await db.transaction([
    { text: 'SELECT pg_advisory_xact_lock($1)', params: [CHUNK_CEILING_LOCK_ID] },
    { text: 'DELETE FROM chunks WHERE agent_id = $1 AND url = $2', params: [agentId, sourceUrl] },
    {
      text: `INSERT INTO chunks (agent_id, url, title, pos, content, embedding)
             SELECT $1::uuid, $2, t.title, t.pos, t.content, t.embedding::halfvec
             FROM unnest($3::text[], $4::int[], $5::text[], $6::text[])
               WITH ORDINALITY AS t(title, pos, content, embedding, ord)
             ORDER BY t.ord
             LIMIT GREATEST(LEAST(
               $7::int - (SELECT count(*) FROM chunks WHERE agent_id = $1),
               $8::int - (SELECT count(*) FROM chunks)
             ), 0)
             RETURNING id`,
      params: [
        agentId,
        sourceUrl,
        chunks.map((c) => c.title),
        chunks.map((c) => c.pos),
        chunks.map((c) => c.content),
        chunks.map((c) => toVectorLiteral(c.embedding)),
        limits.maxChunksPerAgent,
        limits.maxTotalChunks,
      ],
    },
    {
      text: 'UPDATE agents SET chunk_count = (SELECT count(*) FROM chunks WHERE agent_id = $1) WHERE id = $1',
      params: [agentId],
    },
  ]);
  return results[2]?.length ?? 0;
}

interface ScoredRow {
  url: string;
  title: string;
  content: string;
  score: number | string;
}

/** Exact nearest-neighbour search (cosine) over one agent's chunks only. */
export async function searchChunks(
  db: Db,
  agentId: string,
  embedding: number[],
  k: number,
): Promise<RetrievedChunk[]> {
  if (!isUuid(agentId)) return [];
  const rows = await db.query<ScoredRow>(
    `WITH c AS MATERIALIZED (SELECT url, title, content, embedding FROM chunks WHERE agent_id = $1)
     SELECT url, title, content, 1 - (embedding <=> $2::halfvec) AS score
     FROM c ORDER BY embedding <=> $2::halfvec LIMIT $3`,
    [agentId, toVectorLiteral(embedding), k],
  );
  return rows.map((r) => ({ url: r.url, title: r.title, content: r.content, score: Number(r.score) }));
}

export async function countAllChunks(db: Db): Promise<number> {
  const rows = await db.query<{ n: number | string | bigint }>('SELECT count(*) AS n FROM chunks');
  return Number(rows[0]?.n ?? 0);
}

/** Bytes the chunks table uses on disk, including its indexes and TOAST. */
export async function chunksTableBytes(db: Db): Promise<number> {
  const rows = await db.query<{ b: number | string | bigint }>(
    `SELECT pg_total_relation_size('chunks')::bigint AS b`,
  );
  return Number(rows[0]?.b ?? 0);
}
