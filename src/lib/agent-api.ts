import { captureServer } from '@/lib/analytics/server';
import { PROVIDERS_DOWN_COPY } from '@/lib/chat/copy';
import { APP_DOMAIN } from '@/lib/config';
import type { Db } from '@/lib/db/client';
import { getAgentById } from '@/lib/db/agents';
import { isOwner } from '@/lib/owner-token';
import { railResponse, type RailBlocked } from '@/lib/rails';
import type { AgentRow, ApiErrorBody, PublicAgent } from '@/types';

/** The agent as the browser may see it: no owner hash, no crawl internals. */
export function toPublicAgent(row: AgentRow): PublicAgent {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    url: row.url,
    status: row.status,
    pagesCrawled: row.pagesCrawled,
    pagesTotal: row.pagesTotal,
    chunkCount: row.chunkCount,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt.toISOString(),
    pinned: row.pinned,
    instruction: row.instruction,
    lastError: row.lastError,
  };
}

export function apiError(status: number, error: string, headers?: HeadersInit): Response {
  const body: ApiErrorBody = { success: false, error };
  return Response.json(body, { status, headers });
}

/** The 429 for a tripped rail; every one is also reported as `rate_limited`. */
export async function rateLimited(blocked: RailBlocked, headers?: HeadersInit): Promise<Response> {
  await captureServer('rate_limited', { rail: blocked.rail });
  return railResponse(blocked, headers);
}

/** The agent when the request carries its owner token; otherwise the 404 (retired) or 403 to send. */
export async function ownedAgent(db: Db, request: Request, agentId: string): Promise<AgentRow | Response> {
  const agent = await getAgentById(db, agentId);
  if (!agent) return apiError(404, COPY.retired(APP_DOMAIN));
  if (!isOwner(agent, request.headers.get('authorization'))) return apiError(403, COPY.notOwner);
  return agent;
}

/** The request body as a JSON object, or null when it is not one. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Shared ocean-themed copy for API errors. */
export const COPY = {
  retired: (appDomain: string): string => `This Sammy has retired — make a new one at ${appDomain}`,
  badUrl: 'That URL is off our map — try a public website like example.com.',
  notOwner: 'Only the browser that made this Sammy can change it.',
  notReady: "Sammy is still exploring this site — try again once it's ready.",
  crawlFailed: "This Sammy couldn't read the site. Try Repair, or make one for another page.",
  busy: 'Sammy is already diving into that site — try again in a moment.',
  providersDown: PROVIDERS_DOWN_COPY,
  tooLong: 'That message is a whale — keep it under 2,000 characters.',
} as const;
