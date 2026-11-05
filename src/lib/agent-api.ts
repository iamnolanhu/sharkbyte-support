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

/** Shared ocean-themed copy for API errors. */
export const COPY = {
  retired: (appDomain: string): string => `This Sammy has retired — make a new one at ${appDomain}`,
  badUrl: 'That URL is off our map — try a public website like example.com.',
  notOwner: 'Only the browser that made this Sammy can change it.',
  notReady: "Sammy is still exploring this site — try again once it's ready.",
  crawlFailed: "This Sammy couldn't read the site. Try Repair, or make one for another page.",
  busy: 'Sammy is already diving into that site — try again in a moment.',
  providersDown: "Sammy's fins are tangled — every free model is busy. Try again in a minute.",
  tooLong: 'That message is a whale — keep it under 2,000 characters.',
} as const;
