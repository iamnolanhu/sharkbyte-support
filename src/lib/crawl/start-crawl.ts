import { apiError, COPY, rateLimited } from '@/lib/agent-api';
import { APP_DOMAIN, type Limits } from '@/lib/config';
import type { Db } from '@/lib/db/client';
import { finishCrawl, getAgentById, resetForCrawl } from '@/lib/db/agents';
import { checkRail } from '@/lib/rails';
import { ensureCapacity, STALE_CRAWL_ERROR } from '@/lib/sweep';
import { acquireLock, releaseLock } from '@/lib/db/quota';
import { runInBackground } from '@/lib/background';
import type { AgentRow } from '@/types';
import { createCrawlDeps, runCrawl } from './run-crawl';

function crawlLockKey(agentId: string): string {
  return `crawl:${agentId}`;
}

/** A crawl is abandoned (and its lock expires) this long after it started. */
function staleAfterMs(limits: Limits): number {
  return (limits.crawlMaxDurationS + 30) * 1000;
}

/** Takes the per-agent crawl lock; its TTL equals the stale threshold. */
export function tryLockCrawl(db: Db, agentId: string, now: Date, limits: Limits): Promise<boolean> {
  return acquireLock(db, crawlLockKey(agentId), now, staleAfterMs(limits));
}

export function releaseCrawlLock(db: Db, agentId: string): Promise<void> {
  return releaseLock(db, crawlLockKey(agentId));
}

/** True when a crawling agent has outlived the longest a crawl may run. */
export function crawlIsStale(agent: AgentRow, now: Date, limits: Limits): boolean {
  if (agent.status !== 'crawling' || !agent.crawlStartedAt) return false;
  return now.getTime() - agent.crawlStartedAt.getTime() > staleAfterMs(limits);
}

/** Marks a stale crawl failed (what the daily sweep would do) and returns the agent as it now stands. */
export async function failStaleCrawl(db: Db, agent: AgentRow, now: Date, limits: Limits): Promise<AgentRow> {
  if (!crawlIsStale(agent, now, limits)) return agent;
  await finishCrawl(db, agent.id, { status: 'failed', lastError: STALE_CRAWL_ERROR });
  return { ...agent, status: 'failed', lastError: STALE_CRAWL_ERROR };
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
  runInBackground(async () => {
    try {
      await runCrawl(agentId, createCrawlDeps());
    } finally {
      await releaseCrawlLock(db, agentId);
    }
  });
}
