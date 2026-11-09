import { APP_DOMAIN, DEFAULT_INSTRUCTION, getLimits, type Limits } from '@/lib/config';
import { getDb, type Db } from '@/lib/db/client';
import { getAgentByDomain, insertAgent, pinAgent } from '@/lib/db/agents';
import { incrementQuota } from '@/lib/db/quota';
import { domainKey } from '@/lib/crawl/url-guard';
import { continueCrawl, releaseCrawlLock, startCrawlOrRelease, tryLockCrawl } from '@/lib/crawl/start-crawl';
import { ensureCapacity } from '@/lib/sweep';
import { rateLimited } from '@/lib/agent-api';
import type { AgentRow, DemoConfigResponse } from '@/types';

/** The crawl runs in `after()` of this invocation; must equal getLimits().crawlMaxDurationS (Next reads it statically). */
export const maxDuration = 300;
// Reads and writes the database on every call; never prerender it at build time.
export const dynamic = 'force-dynamic';

const HOUR_MS = 60 * 60 * 1000;

function siteUrl(): URL {
  return new URL(/^https?:\/\//i.test(APP_DOMAIN) ? APP_DOMAIN : `https://${APP_DOMAIN}`);
}

function config(agent: AgentRow): Response {
  const body: DemoConfigResponse = { success: true, agentId: agent.id, status: agent.status };
  return Response.json(body);
}

/** One re-crawl of the failed demo agent per clock hour, shared by every instance. */
async function demoRecrawlAllowed(db: Db, now: Date): Promise<boolean> {
  const hourStart = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  const key = `global:demo_recrawl:${now.toISOString().slice(0, 13)}`;
  return (await incrementQuota(db, key, 1, new Date(hourStart + HOUR_MS), now)) <= 1;
}

/** The capacity 429 when a full-size crawl no longer fits, else null. */
async function capacityRefusal(db: Db, now: Date, limits: Limits): Promise<Response | null> {
  const capacity = await ensureCapacity(db, now, limits);
  return capacity.ok ? null : rateLimited(capacity);
}

/** Re-crawls the failed demo agent when nobody else is and the hourly allowance has room. */
async function revive(db: Db, agent: AgentRow, now: Date, limits: Limits): Promise<Response> {
  if (!(await tryLockCrawl(db, agent.id, now, limits))) return config(agent);
  let refused: Response | null;
  try {
    refused = (await demoRecrawlAllowed(db, now)) ? await capacityRefusal(db, now, limits) : config(agent);
  } catch (err) {
    await releaseCrawlLock(db, agent.id);
    throw err;
  }
  if (refused) {
    await releaseCrawlLock(db, agent.id);
    return refused;
  }
  await startCrawlOrRelease(db, agent.id, now);
  return config({ ...agent, status: 'crawling' });
}

/** Creates the pinned demo agent and starts its crawl. No IP or daily crawl rails, only capacity. */
async function createDemoAgent(db: Db, domain: string, now: Date, limits: Limits): Promise<Response> {
  const refused = await capacityRefusal(db, now, limits);
  if (refused) return refused;
  const agent = await insertAgent(db, {
    domain,
    url: siteUrl().href,
    name: `Sammy - ${domain}`,
    instruction: DEFAULT_INSTRUCTION(domain),
    ownerTokenHash: null,
    pinned: true,
    now,
  });
  if (!agent) {
    // Another request created it first; that request started the crawl.
    const raced = await getAgentByDomain(db, domain);
    if (!raced) throw new Error('Demo agent insert conflicted but no row exists');
    return config(raced);
  }
  if (await tryLockCrawl(db, agent.id, now, limits)) await startCrawlOrRelease(db, agent.id, now);
  return config(agent);
}

/**
 * GET /api/demo-config: the site's own pinned Sammy for the demo widget. Created on first
 * call; a stranger-made agent for the app domain is adopted (pinned, owner token dropped);
 * a failed one is re-crawled at most once an hour so the demo never stays dead.
 */
export async function GET() {
  const db = getDb();
  const limits = getLimits();
  const now = new Date();
  const domain = domainKey(siteUrl());

  let agent = await getAgentByDomain(db, domain);
  if (!agent) return createDemoAgent(db, domain, now, limits);
  if (!agent.pinned) {
    await pinAgent(db, agent.id);
    agent = { ...agent, pinned: true, ownerTokenHash: null };
  }
  await continueCrawl(db, agent, now, limits);
  return agent.status === 'failed' ? revive(db, agent, now, limits) : config(agent);
}
