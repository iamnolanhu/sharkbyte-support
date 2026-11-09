import { getDb } from '@/lib/db/client';
import { listListedAgents } from '@/lib/db/agents';
import { toPublicAgent } from '@/lib/agent-api';
import type { ListAgentsResponse } from '@/types';

/** GET /api/agents: every working Sammy (ready or crawling), pinned first, then newest. Never the owner hash. */
export async function GET() {
  const agents = await listListedAgents(getDb());
  const body: ListAgentsResponse = { success: true, agents: agents.map(toPublicAgent) };
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
