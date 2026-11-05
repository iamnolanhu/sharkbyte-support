import type { AgentRow, AgentStatus } from '@/types';
import type { Db } from './client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for any canonical UUID string; guards every `uuid` cast so bad ids never reach Postgres. */
export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

const AGENT_COLUMNS = `id, domain, url, name, instruction, status, pages_crawled, pages_total,
  chunk_count, created_at, last_used_at, crawl_started_at, last_error, pinned, owner_token_hash`;

interface AgentDbRow {
  id: string;
  domain: string;
  url: string;
  name: string;
  instruction: string;
  status: AgentStatus;
  pages_crawled: number | string;
  pages_total: number | string;
  chunk_count: number | string;
  created_at: Date | string;
  last_used_at: Date | string;
  crawl_started_at: Date | string | null;
  last_error: string | null;
  pinned: boolean;
  owner_token_hash: string | null;
}

const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

function toAgentRow(r: AgentDbRow): AgentRow {
  return {
    id: r.id,
    domain: r.domain,
    url: r.url,
    name: r.name,
    instruction: r.instruction,
    status: r.status,
    pagesCrawled: Number(r.pages_crawled),
    pagesTotal: Number(r.pages_total),
    chunkCount: Number(r.chunk_count),
    createdAt: toDate(r.created_at),
    lastUsedAt: toDate(r.last_used_at),
    crawlStartedAt: r.crawl_started_at === null ? null : toDate(r.crawl_started_at),
    lastError: r.last_error,
    pinned: r.pinned,
    ownerTokenHash: r.owner_token_hash,
  };
}

export interface NewAgentInput {
  domain: string;
  url: string;
  name: string;
  instruction: string;
  ownerTokenHash: string | null;
  pinned: boolean;
  now: Date;
}

/** Inserts a new agent in `crawling` state; returns null when the domain already has one. */
export async function insertAgent(db: Db, input: NewAgentInput): Promise<AgentRow | null> {
  const rows = await db.query<AgentDbRow>(
    `INSERT INTO agents (domain, url, name, instruction, status, owner_token_hash, pinned,
       created_at, last_used_at, crawl_started_at)
     VALUES ($1, $2, $3, $4, 'crawling', $5, $6, $7, $7, $7)
     ON CONFLICT (domain) DO NOTHING
     RETURNING ${AGENT_COLUMNS}`,
    [input.domain, input.url, input.name, input.instruction, input.ownerTokenHash, input.pinned, input.now],
  );
  return rows[0] ? toAgentRow(rows[0]) : null;
}

export async function getAgentById(db: Db, id: string): Promise<AgentRow | null> {
  if (!isUuid(id)) return null;
  const rows = await db.query<AgentDbRow>(`SELECT ${AGENT_COLUMNS} FROM agents WHERE id = $1`, [id]);
  return rows[0] ? toAgentRow(rows[0]) : null;
}

export async function getAgentByDomain(db: Db, domain: string): Promise<AgentRow | null> {
  const rows = await db.query<AgentDbRow>(`SELECT ${AGENT_COLUMNS} FROM agents WHERE domain = $1`, [domain]);
  return rows[0] ? toAgentRow(rows[0]) : null;
}

export async function updateInstruction(db: Db, id: string, instruction: string): Promise<void> {
  if (!isUuid(id)) return;
  await db.query('UPDATE agents SET instruction = $2 WHERE id = $1', [id, instruction]);
}

/** Deletes the agent; its chunks go with it (ON DELETE CASCADE). */
export async function deleteAgent(db: Db, id: string): Promise<void> {
  if (!isUuid(id)) return;
  await db.query('DELETE FROM agents WHERE id = $1', [id]);
}

/** Drops the agent's chunks and restarts it as a fresh crawl, in one transaction. */
export async function resetForCrawl(db: Db, id: string, now: Date): Promise<void> {
  if (!isUuid(id)) return;
  await db.transaction([
    { text: 'DELETE FROM chunks WHERE agent_id = $1', params: [id] },
    {
      text: `UPDATE agents SET status = 'crawling', pages_crawled = 0, pages_total = 0, chunk_count = 0,
               last_error = NULL, crawl_started_at = $2
             WHERE id = $1`,
      params: [id, now],
    },
  ]);
}

export async function updateCrawlProgress(
  db: Db,
  id: string,
  p: { pagesCrawled: number; pagesTotal: number; chunkCount: number },
): Promise<void> {
  if (!isUuid(id)) return;
  await db.query(
    'UPDATE agents SET pages_crawled = $2, pages_total = $3, chunk_count = $4 WHERE id = $1',
    [id, p.pagesCrawled, p.pagesTotal, p.chunkCount],
  );
}

export async function finishCrawl(
  db: Db,
  id: string,
  r: { status: 'ready' | 'failed'; lastError: string | null },
): Promise<void> {
  if (!isUuid(id)) return;
  await db.query('UPDATE agents SET status = $2, last_error = $3 WHERE id = $1', [id, r.status, r.lastError]);
}

export async function touchLastUsed(db: Db, id: string, now: Date): Promise<void> {
  if (!isUuid(id)) return;
  await db.query('UPDATE agents SET last_used_at = $2 WHERE id = $1', [id, now]);
}

/** Pins the agent (the sweep never evicts it) and drops its owner token. */
export async function pinAgent(db: Db, id: string): Promise<void> {
  if (!isUuid(id)) return;
  await db.query('UPDATE agents SET pinned = true, owner_token_hash = NULL WHERE id = $1', [id]);
}
