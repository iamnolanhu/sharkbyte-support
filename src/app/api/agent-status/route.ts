import { APP_DOMAIN, getLimits } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { getAgentById } from '@/lib/db/agents';
import { continueCrawl } from '@/lib/crawl/start-crawl';
import { apiError, COPY } from '@/lib/agent-api';
import type { AgentRow, AgentStatusResponse } from '@/types';

function statusBody(agent: AgentRow): AgentStatusResponse {
  const progress = {
    success: true as const,
    status: agent.status,
    pagesCrawled: agent.pagesCrawled,
    pagesTotal: agent.pagesTotal,
    chunkCount: agent.chunkCount,
  };
  switch (agent.status) {
    case 'crawling':
      return { ...progress, message: `Read ${agent.pagesCrawled} of ${agent.pagesTotal} pages` };
    case 'ready':
      return { ...progress, message: `Sammy read ${agent.pagesCrawled} pages and is ready to swim!` };
    case 'failed': {
      const error = agent.lastError ?? COPY.crawlFailed;
      return { ...progress, message: error, error };
    }
  }
}

/** Long enough for the crawl slice a poll may start in the background (see continueCrawl). */
export const maxDuration = 300;

/**
 * GET /api/agent-status?agentId=: crawl progress. Polling also keeps a sliced crawl going: when
 * no slice is running, the poll starts the next one in the background.
 */
export async function GET(request: Request) {
  const agentId = new URL(request.url).searchParams.get('agentId') ?? '';
  const db = getDb();
  const agent = await getAgentById(db, agentId);
  if (!agent) return apiError(404, COPY.retired(APP_DOMAIN));
  await continueCrawl(db, agent, new Date(), getLimits());
  return Response.json(statusBody(agent));
}
