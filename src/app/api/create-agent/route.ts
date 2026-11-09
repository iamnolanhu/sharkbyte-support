import { DEFAULT_INSTRUCTION, getLimits } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { deleteAgent, getAgentByDomain, insertAgent } from '@/lib/db/agents';
import { acquireLock, releaseLock } from '@/lib/db/quota';
import { assertPublicUrl, domainKey, normalizeSubmittedUrl, UnsafeUrlError } from '@/lib/crawl/url-guard';
import {
  continueCrawl,
  recrawlWithRails,
  releaseCrawlLock,
  startCrawlOrRelease,
  tryLockCrawl,
} from '@/lib/crawl/start-crawl';
import { checkRail, crawlEmbedRefusal, getClientIp } from '@/lib/rails';
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
 * (no owner token, no quota spent), except an unpinned failed one, which is crawled again
 * under the repair rails; a new one is inserted and crawled after the response.
 */
export async function POST(request: Request) {
  const url = await parseTarget(request);
  if (!url) return apiError(400, COPY.badUrl);

  const db = getDb();
  const limits = getLimits();
  const now = new Date();
  const domain = domainKey(url);

  const ip = getClientIp(request.headers);
  const found = await getAgentByDomain(db, domain);
  if (found) {
    // An unfinished crawl with no slice running picks up where it stopped.
    await continueCrawl(db, found, now, limits);
    const existing = found;
    if (existing.status !== 'failed' || existing.pinned) return agentResponse(existing);
    // Anyone may retry a failed Sammy, under the same rails as repair; its owner stays as it was.
    const result = await recrawlWithRails(db, existing.id, ip, now, limits);
    if (result instanceof Response) return result;
    return agentResponse(result === 'started' ? { ...existing, status: 'crawling' } : existing);
  }

  // Crawls spent their share of today's embeddings: refuse before charging any rail.
  const embedShare = await crawlEmbedRefusal(db, now, limits);
  if (embedShare) return rateLimited(embedShare);
  const createRail = await checkRail(db, 'create_ip', { ip }, now, limits);
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

    try {
      // A brand-new row has no crawl lock yet, so this always succeeds.
      await tryLockCrawl(db, agent.id, now, limits);
      await startCrawlOrRelease(db, agent.id, now);
    } catch {
      // Without its owner token nobody could repair this row: remove it so the domain stays free.
      await deleteAgent(db, agent.id).catch(() => undefined);
      await releaseCrawlLock(db, agent.id).catch(() => undefined);
      console.error(`[create-agent] crawl start failed for ${agent.id}; row removed`);
      return apiError(503, COPY.crawlStartFailed);
    }
    return agentResponse(agent, owner.token);
  } finally {
    await releaseLock(db, lockKey);
  }
}
