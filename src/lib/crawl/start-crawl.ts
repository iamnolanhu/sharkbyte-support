import type { Limits } from '@/lib/config';
import type { Db } from '@/lib/db/client';
import { finishCrawl, resetForCrawl } from '@/lib/db/agents';
import { STALE_CRAWL_ERROR } from '@/lib/sweep';
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
