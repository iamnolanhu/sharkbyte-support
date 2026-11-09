import { apiError, COPY, rateLimited } from '@/lib/agent-api';
import { APP_DOMAIN, type Limits } from '@/lib/config';
import type { Db } from '@/lib/db/client';
import { getAgentById, resetForCrawl } from '@/lib/db/agents';
import { checkRail, crawlEmbedRefusal, embedRailSpent } from '@/lib/rails';
import { embeddingSizeMismatch } from '@/lib/db/client';
import { ensureCapacity } from '@/lib/sweep';
import { acquireLock, releaseLock, renewLock } from '@/lib/db/quota';
import { runInBackground } from '@/lib/background';
import type { AgentRow } from '@/types';
import { createCrawlDeps, runCrawl } from './run-crawl';

function crawlLockKey(agentId: string): string {
  return `crawl:${agentId}`;
}

/** A crawl slice is abandoned (and its lock expires) this long after it took the lock. */
function staleAfterMs(limits: Limits): number {
  return (limits.crawlMaxDurationS + 30) * 1000;
}

/** Takes the per-agent crawl lock; its TTL equals the stale threshold. */
export function tryLockCrawl(db: Db, agentId: string, now: Date, limits: Limits): Promise<boolean> {
  return acquireLock(db, crawlLockKey(agentId), now, staleAfterMs(limits));
}

/** Renews a held crawl lock for another slice (the importer runs slices back to back). */
export function renewCrawlLock(db: Db, agentId: string, now: Date, limits: Limits): Promise<void> {
  return renewLock(db, crawlLockKey(agentId), now, staleAfterMs(limits));
}

export function releaseCrawlLock(db: Db, agentId: string): Promise<void> {
  return releaseLock(db, crawlLockKey(agentId));
}

/**
 * Starts the next slice of an unfinished crawl when none is running (its lock is free), in the
 * background. Called by status polls and re-submits; no rail is spent (it is the same crawl).
 * True when a slice started.
 */
export async function continueCrawl(db: Db, agent: AgentRow, now: Date, limits: Limits): Promise<boolean> {
  if (agent.status !== 'crawling') return false;
  // Fresh progress means a slice is running: skip the lock write on every 3-second poll.
  if (agent.crawlProgressAt && now.getTime() - agent.crawlProgressAt.getTime() < RECENT_PROGRESS_MS) return false;
  // No embeddings left today: start nothing and touch nothing; the sweep's no-progress rule
  // is the only thing that can end the crawl meanwhile.
  if (await embedRailSpent(db, now, limits, 'crawl')) return false;
  if (!(await tryLockCrawl(db, agent.id, now, limits))) return false;
  await runSliceInBackground(db, agent.id);
  return true;
}

/** A crawl that made progress this recently has a slice running. */
const RECENT_PROGRESS_MS = 10_000;

/**
 * Runs one crawl slice after the response. The caller holds the crawl lock; it is released when
 * the slice ends, or right away if the slice cannot be scheduled.
 */
async function runSliceInBackground(db: Db, agentId: string): Promise<void> {
  try {
    runInBackground(async () => {
      try {
        await runCrawl(agentId, createCrawlDeps());
      } finally {
        await releaseCrawlLock(db, agentId);
      }
    });
  } catch (err) {
    await releaseCrawlLock(db, agentId);
    throw err;
  }
}

/** `startLockedCrawl` for route handlers: a start that throws frees the lock instead of holding it for the TTL. */
export async function startCrawlOrRelease(db: Db, agentId: string, now: Date): Promise<void> {
  try {
    await startLockedCrawl(db, agentId, now);
  } catch (err) {
    await releaseCrawlLock(db, agentId);
    throw err;
  }
}

/** What `recrawlWithRails` did: started a crawl, found one already holding the lock, or the response that refused it. */
export type RecrawlResult = 'started' | 'busy' | Response;

/**
 * A fresh crawl of an existing agent under the same rails as a new one (owner repair, and a
 * failed agent re-submitted by anyone): the per-agent crawl lock, then the hourly create cap,
 * capacity and the daily crawl cap. A refusal or a throw releases the lock.
 */
export async function recrawlWithRails(
  db: Db,
  agentId: string,
  ip: string,
  now: Date,
  limits: Limits,
): Promise<RecrawlResult> {
  // One crawler per agent: a second request while one runs spends nothing.
  if (!(await tryLockCrawl(db, agentId, now, limits))) return 'busy';
  let refused: Response | null;
  try {
    refused = await railRefusal(db, agentId, ip, now, limits);
  } catch (err) {
    await releaseCrawlLock(db, agentId);
    throw err;
  }
  if (refused) {
    await releaseCrawlLock(db, agentId);
    return refused;
  }
  await startCrawlOrRelease(db, agentId, now);
  return 'started';
}

/** The response that stops a re-crawl (a rail, or the agent is gone), or null to go ahead. */
async function railRefusal(db: Db, agentId: string, ip: string, now: Date, limits: Limits): Promise<Response | null> {
  // Checked before the reset, which would delete the stored pages of a crawl bound to fail.
  const mismatch = await embeddingSizeMismatch(db);
  if (mismatch) {
    console.error(`Re-crawl refused: ${mismatch}`);
    return apiError(503, COPY.retuning);
  }
  const embedShare = await crawlEmbedRefusal(db, now, limits);
  if (embedShare) return rateLimited(embedShare);
  const createRail = await checkRail(db, 'create_ip', { ip }, now, limits);
  if (!createRail.ok) return rateLimited(createRail);
  const capacity = await ensureCapacity(db, now, limits);
  if (!capacity.ok) return rateLimited(capacity);
  // The capacity sweep may have evicted this very agent.
  if (!(await getAgentById(db, agentId))) return apiError(404, COPY.retired(APP_DOMAIN));
  const crawlRail = await checkRail(db, 'crawl_daily', { ip: 'global' }, now, limits);
  if (!crawlRail.ok) return rateLimited(crawlRail);
  return null;
}

/** Resets the agent and crawls in the background. The caller must already hold the crawl lock. */
export async function startLockedCrawl(db: Db, agentId: string, now: Date): Promise<void> {
  await resetForCrawl(db, agentId, now);
  await runSliceInBackground(db, agentId);
}
