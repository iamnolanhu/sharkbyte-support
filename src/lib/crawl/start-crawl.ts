import type { Limits } from '@/lib/config';
import type { Db } from '@/lib/db/client';
import { resetForCrawl } from '@/lib/db/agents';
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
