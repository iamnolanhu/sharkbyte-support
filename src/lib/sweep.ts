import type { Db } from '@/lib/db/client';
import type { Limits } from '@/lib/config';
import { RAIL_COPY, type RailResult } from '@/lib/rails';
import { chunksTableBytes, countAllChunks } from '@/lib/db/chunks';
import { deleteExpiredLocks, deleteExpiredQuota } from '@/lib/db/quota';

export interface SweepResult {
  stalledCrawlsFinished: number;
  agentsRemoved: number;
  chunksAfter: number;
  dbBytes: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Grace past one slice's time limit before a crawl with no progress counts as stalled. */
const STALE_CRAWL_GRACE_S = 30;

export const STALE_CRAWL_ERROR = 'Sammy ran out of air mid-dive — press Repair to try again.';

/**
 * Finishes crawls that made no progress for a slice's time limit plus grace (nobody polled to
 * start the next slice, or slices kept dying): `ready` with the pages stored so far, or
 * `failed` when nothing was stored.
 */
async function finishStalledCrawls(db: Db, now: Date, limits: Limits): Promise<number> {
  const cutoff = new Date(now.getTime() - (limits.crawlMaxDurationS + STALE_CRAWL_GRACE_S) * 1000);
  const rows = await db.query<{ id: string }>(
    `UPDATE agents
     SET status = CASE WHEN chunk_count > 0 THEN 'ready' ELSE 'failed' END,
         last_error = CASE WHEN chunk_count > 0 THEN NULL ELSE $2 END,
         crawl_pending = NULL
     WHERE status = 'crawling' AND COALESCE(crawl_progress_at, crawl_started_at) < $1
     RETURNING id`,
    [cutoff, STALE_CRAWL_ERROR],
  );
  return rows.length;
}

/** Failed agents keep no chunks; the row stays so its owner can press Repair. */
async function clearFailedChunks(db: Db): Promise<void> {
  await db.transaction([
    { text: `DELETE FROM chunks WHERE agent_id IN (SELECT id FROM agents WHERE status = 'failed')` },
    { text: `UPDATE agents SET chunk_count = 0 WHERE status = 'failed' AND chunk_count <> 0` },
  ]);
}

/** Deletes unpinned agents last used before `cutoff`: failed ones only, or any that is not crawling. */
async function deleteIdleAgents(db: Db, cutoff: Date, onlyFailed: boolean): Promise<number> {
  const rows = await db.query<{ id: string }>(
    `DELETE FROM agents
     WHERE pinned = false AND last_used_at < $1
       AND ${onlyFailed ? `status = 'failed'` : `status <> 'crawling'`}
     RETURNING id`,
    [cutoff],
  );
  return rows.length;
}

/** Deletes the least recently used unpinned, non-crawling agent. False when none is left. */
async function evictOldestAgent(db: Db): Promise<boolean> {
  const rows = await db.query<{ id: string }>(
    `DELETE FROM agents WHERE id = (
       SELECT id FROM agents
       WHERE pinned = false AND status <> 'crawling'
       ORDER BY last_used_at ASC, created_at ASC, id ASC
       LIMIT 1
     )
     RETURNING id`,
  );
  return rows.length > 0;
}

/**
 * Keeps the shared database under its storage ceiling. Never touches a `crawling`
 * or pinned agent in the retention and eviction steps.
 */
export async function sweep(db: Db, now: Date, limits: Limits): Promise<SweepResult> {
  const stalledCrawlsFinished = await finishStalledCrawls(db, now, limits);
  await clearFailedChunks(db);

  let agentsRemoved = await deleteIdleAgents(
    db,
    new Date(now.getTime() - limits.failedRetentionHours * HOUR_MS),
    true,
  );
  agentsRemoved += await deleteIdleAgents(
    db,
    new Date(now.getTime() - limits.retentionDays * DAY_MS),
    false,
  );

  const target = limits.evictTargetRatio * limits.maxTotalChunks;
  while ((await countAllChunks(db)) > target) {
    if (!(await evictOldestAgent(db))) break;
    agentsRemoved += 1;
  }

  await deleteExpiredQuota(db, now);
  await deleteExpiredLocks(db, now);

  return {
    stalledCrawlsFinished,
    agentsRemoved,
    chunksAfter: await countAllChunks(db),
    dbBytes: await chunksTableBytes(db),
  };
}

function hasRoom(chunks: number, limits: Limits): boolean {
  return chunks + limits.maxChunksPerAgent <= limits.maxTotalChunks;
}

/** Ok when a full-size crawl still fits; otherwise sweeps once and re-checks. */
export async function ensureCapacity(db: Db, now: Date, limits: Limits): Promise<RailResult> {
  if (hasRoom(await countAllChunks(db), limits)) return { ok: true };
  await sweep(db, now, limits);
  if (hasRoom(await countAllChunks(db), limits)) return { ok: true };
  return { ok: false, rail: 'capacity', message: RAIL_COPY.capacity };
}
