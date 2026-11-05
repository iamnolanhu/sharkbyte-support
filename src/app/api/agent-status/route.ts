import { APP_DOMAIN, getLimits } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { getAgentById } from '@/lib/db/agents';
import { failStaleCrawl } from '@/lib/crawl/start-crawl';
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

/** GET /api/agent-status?agentId=: crawl progress; a crawl past its time budget is marked failed first. */
export async function GET(request: Request) {
  const agentId = new URL(request.url).searchParams.get('agentId') ?? '';
  const db = getDb();
  const agent = await getAgentById(db, agentId);
  if (!agent) return apiError(404, COPY.retired(APP_DOMAIN));
  return Response.json(statusBody(await failStaleCrawl(db, agent, new Date(), getLimits())));
}
