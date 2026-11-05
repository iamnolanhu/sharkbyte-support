import { APP_DOMAIN, getLimits } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { deleteAgent, getAgentById, updateInstruction } from '@/lib/db/agents';
import { isOwner } from '@/lib/owner-token';
import { apiError, COPY, ownedAgent, readJsonObject, toPublicAgent } from '@/lib/agent-api';
import type { GetAgentResponse } from '@/types';

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

/** GET /api/agents/[agentId]: the public agent, plus whether this browser owns it. */
export async function GET(request: Request, context: RouteContext) {
  const { agentId } = await context.params;
  const agent = await getAgentById(getDb(), agentId);
  if (!agent) return apiError(404, COPY.retired(APP_DOMAIN));
  const body: GetAgentResponse = {
    success: true,
    agent: toPublicAgent(agent),
    isOwner: isOwner(agent, request.headers.get('authorization')),
  };
  return Response.json(body);
}

/** PATCH /api/agents/[agentId] { instruction }: owner only. */
export async function PATCH(request: Request, context: RouteContext) {
  const { agentId } = await context.params;
  const db = getDb();
  const agent = await ownedAgent(db, request, agentId);
  if (agent instanceof Response) return agent;

  const max = getLimits().maxInstructionChars;
  const raw = (await readJsonObject(request))?.instruction;
  const instruction = typeof raw === 'string' ? raw.trim() : '';
  if (!instruction || instruction.length > max) {
    return apiError(400, `Sammy's instructions need between 1 and ${max.toLocaleString('en-US')} characters.`);
  }

  await updateInstruction(db, agent.id, instruction);
  return Response.json({ success: true, agent: toPublicAgent({ ...agent, instruction }) });
}

/** DELETE /api/agents/[agentId]: owner only; the agent's chunks go with it. */
export async function DELETE(request: Request, context: RouteContext) {
  const { agentId } = await context.params;
  const db = getDb();
  const agent = await ownedAgent(db, request, agentId);
  if (agent instanceof Response) return agent;
  await deleteAgent(db, agent.id);
  return Response.json({ success: true });
}
