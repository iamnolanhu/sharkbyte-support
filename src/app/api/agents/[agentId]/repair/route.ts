import { getLimits } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { recrawlWithRails } from '@/lib/crawl/start-crawl';
import { getClientIp } from '@/lib/rails';
import { apiError, COPY, ownedAgent } from '@/lib/agent-api';

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

  const result = await recrawlWithRails(db, agent.id, getClientIp(request.headers), now, limits);
  if (result === 'busy') return apiError(409, COPY.busy);
  if (result instanceof Response) return result;
  return Response.json({ success: true, status: 'crawling', message: 'Sammy is diving back in…' });
}
