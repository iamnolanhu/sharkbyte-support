import { APP_DOMAIN, getLimits, type Limits } from '@/lib/config';
import { getDb, type Db } from '@/lib/db/client';
import { getAgentById } from '@/lib/db/agents';
import { releaseCrawlLock, startCrawlOrRelease, tryLockCrawl } from '@/lib/crawl/start-crawl';
import { checkRail, getClientIp } from '@/lib/rails';
import { ensureCapacity } from '@/lib/sweep';
import { apiError, COPY, ownedAgent, rateLimited } from '@/lib/agent-api';

/** The crawl runs in `after()` of this invocation; must equal getLimits().crawlMaxDurationS (Next reads it statically). */
export const maxDuration = 300;

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

/**
 * POST /api/agents/[agentId]/repair: owner only. Drops the agent's chunks and crawls the site
 * again from scratch, against the same hourly and daily caps as create. Reindex is the same handler.
 */
export async function POST(request: Request, context: RouteContext) {
  const { agentId } = await context.params;
  const db = getDb();
  const limits = getLimits();
  const now = new Date();

  const agent = await ownedAgent(db, request, agentId);
  if (agent instanceof Response) return agent;

  // One crawler per agent: a second press while one runs spends nothing.
  if (!(await tryLockCrawl(db, agent.id, now, limits))) return apiError(409, COPY.busy);

  let refused: Response | null;
  try {
    refused = await refusal(db, agent.id, getClientIp(request.headers), now, limits);
  } catch (err) {
    await releaseCrawlLock(db, agent.id);
    throw err;
  }
  if (refused) {
    await releaseCrawlLock(db, agent.id);
    return refused;
  }

  await startCrawlOrRelease(db, agent.id, now);
  return Response.json({ success: true, status: 'crawling', message: 'Sammy is diving back in…' });
}

/** The response that stops this re-crawl (a rail, or the agent is gone), or null to go ahead. */
async function refusal(db: Db, agentId: string, ip: string, now: Date, limits: Limits): Promise<Response | null> {
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
