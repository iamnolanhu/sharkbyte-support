import { DEFAULT_INSTRUCTION, getLimits } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { getAgentByDomain, insertAgent } from '@/lib/db/agents';
import { acquireLock, releaseLock } from '@/lib/db/quota';
import { assertPublicUrl, domainKey, normalizeSubmittedUrl, UnsafeUrlError } from '@/lib/crawl/url-guard';
import { startCrawlOrRelease, tryLockCrawl } from '@/lib/crawl/start-crawl';
import { checkRail, getClientIp } from '@/lib/rails';
import { ensureCapacity } from '@/lib/sweep';
import { mintOwnerToken } from '@/lib/owner-token';
import { apiError, COPY, rateLimited, readJsonObject } from '@/lib/agent-api';
import type { AgentRow, CreateAgentApiResponse } from '@/types';

/** The crawl runs in `after()` of this invocation; must equal getLimits().crawlMaxDurationS (Next reads it statically). */
export const maxDuration = 300;

/** Longer than any real address; refused before parsing. */
const MAX_URL_CHARS = 2048;

function agentResponse(agent: AgentRow, ownerToken?: string): Response {
  const body: CreateAgentApiResponse = {
    success: true,
    agentId: agent.id,
    agentName: agent.name,
    url: agent.url,
    status: agent.status,
    isExisting: ownerToken === undefined,
    ...(ownerToken === undefined ? {} : { ownerToken }),
  };
  return Response.json(body);
}

/** A submitted URL that is safe to crawl, or null. */
async function parseTarget(request: Request): Promise<URL | null> {
  const body = await readJsonObject(request);
  const raw = body?.url;
  if (typeof raw !== 'string' || raw.length > MAX_URL_CHARS) return null;
  try {
    const url = normalizeSubmittedUrl(raw);
    await assertPublicUrl(url);
    return url;
  } catch (err) {
    if (err instanceof UnsafeUrlError) return null;
    throw err;
  }
}

/**
 * POST /api/create-agent { url }: one Sammy per domain. A known domain is returned as is
 * (no owner token, no quota spent); a new one is inserted and crawled after the response.
 */
export async function POST(request: Request) {
  const url = await parseTarget(request);
  if (!url) return apiError(400, COPY.badUrl);

  const db = getDb();
  const limits = getLimits();
  const now = new Date();
  const domain = domainKey(url);

  const existing = await getAgentByDomain(db, domain);
  if (existing) return agentResponse(existing);

  const createRail = await checkRail(db, 'create_ip', { ip: getClientIp(request.headers) }, now, limits);
  if (!createRail.ok) return rateLimited(createRail);

  const lockKey = `create:${domain}`;
  if (!(await acquireLock(db, lockKey, now, limits.createLockTtlMs))) {
    const raced = await getAgentByDomain(db, domain);
    return raced ? agentResponse(raced) : apiError(409, COPY.busy);
  }

  try {
    const capacity = await ensureCapacity(db, now, limits);
    if (!capacity.ok) return rateLimited(capacity);
    const crawlRail = await checkRail(db, 'crawl_daily', { ip: 'global' }, now, limits);
    if (!crawlRail.ok) return rateLimited(crawlRail);

    const owner = mintOwnerToken();
    const agent = await insertAgent(db, {
      domain,
      url: url.href,
      name: `Sammy - ${domain}`,
      instruction: DEFAULT_INSTRUCTION(domain),
      ownerTokenHash: owner.hash,
      pinned: false,
      now,
    });
    if (!agent) {
      const raced = await getAgentByDomain(db, domain);
      return raced ? agentResponse(raced) : apiError(409, COPY.busy);
    }

    // A brand-new row has no crawl lock yet, so this always succeeds.
    await tryLockCrawl(db, agent.id, now, limits);
    await startCrawlOrRelease(db, agent.id, now);
    return agentResponse(agent, owner.token);
  } finally {
    await releaseLock(db, lockKey);
  }
}
