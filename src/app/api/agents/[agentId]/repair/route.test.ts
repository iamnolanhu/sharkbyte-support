import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLimits } from '@/lib/config';
import { setDbForTests, type Db } from '@/lib/db/client';
import { finishCrawl, getAgentById, insertAgent } from '@/lib/db/agents';
import { countAllChunks, insertChunksWithinCeiling } from '@/lib/db/chunks';
import { incrementQuota, readQuota } from '@/lib/db/quota';
import { runInBackground } from '@/lib/background';
import { runCrawl } from '@/lib/crawl/run-crawl';
import { tryLockCrawl } from '@/lib/crawl/start-crawl';
import { captureServer } from '@/lib/analytics/server';
import { COPY } from '@/lib/agent-api';
import { mintOwnerToken } from '@/lib/owner-token';
import { railKey } from '@/lib/rails';
import { createTestDb, fakeEmbedding, TEST_DB_TIMEOUT_MS } from '@/test/test-db';
import type { AgentRow, ApiErrorBody } from '@/types';
import { POST as createAgent } from '../../../create-agent/route';
import { POST, maxDuration } from './route';

vi.mock('@/lib/background', () => ({ runInBackground: vi.fn() }));
vi.mock('@/lib/crawl/run-crawl', () => ({ runCrawl: vi.fn(), createCrawlDeps: vi.fn() }));
vi.mock('@/lib/analytics/server');
vi.mock('node:dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns')>();
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  return { ...actual, promises: { ...actual.promises, lookup } };
});

const NOW = new Date('2026-11-05T10:15:00.000Z');
const IP = '198.51.100.7';
const DIVING = { success: true, status: 'crawling', message: 'Sammy is diving back in…' };

let db: Db;
const background = vi.mocked(runInBackground);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  background.mockReset();
  vi.mocked(runCrawl).mockReset();
  vi.mocked(runCrawl).mockResolvedValue({} as Awaited<ReturnType<typeof runCrawl>>);
  vi.mocked(captureServer).mockReset();
  vi.mocked(captureServer).mockResolvedValue(undefined);
  db = await createTestDb();
  setDbForTests(db);
}, TEST_DB_TIMEOUT_MS);

afterEach(() => {
  setDbForTests(null);
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

/** A finished agent with two chunks, as if its first crawl had ended. */
async function readyAgent(domain = 'example.com', chunks = 2): Promise<{ agent: AgentRow; token: string }> {
  const owner = mintOwnerToken();
  const agent = await insertAgent(db, {
    domain,
    url: `https://${domain}`,
    name: `Sammy - ${domain}`,
    instruction: 'x',
    ownerTokenHash: owner.hash,
    pinned: false,
    now: NOW,
  });
  if (!agent) throw new Error('insert failed');
  await insertChunksWithinCeiling(
    db,
    agent.id,
    Array.from({ length: chunks }, (_, i) => ({
      url: `https://${domain}`,
      title: 't',
      pos: i,
      content: 'c',
      embedding: fakeEmbedding(i),
    })),
    1000,
  );
  await db.query('UPDATE agents SET chunk_count = $2 WHERE id = $1', [agent.id, chunks]);
  await finishCrawl(db, agent.id, { status: 'ready', lastError: null });
  return { agent, token: owner.token };
}

function repair(agentId: string, token?: string, ip = IP): Promise<Response> {
  const headers = new Headers({ 'x-real-ip': ip });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return POST(new Request(`http://localhost/api/agents/${agentId}/repair`, { method: 'POST', headers }), {
    params: Promise.resolve({ agentId }),
  });
}

const createsThisHour = (): Promise<number> => readQuota(db, railKey('create_ip', IP, NOW), NOW);
const crawlsToday = (): Promise<number> => readQuota(db, railKey('crawl_daily', 'global', NOW), NOW);

/** Uses up the crawls' share (75 % of the default 900) of today's embedding requests. */
async function spendCrawlEmbedShare(): Promise<void> {
  await incrementQuota(db, railKey('embed_daily', 'global', NOW), 675, new Date(NOW.getTime() + 24 * 60 * 60 * 1000), NOW);
}

const lockIsFree = (agentId: string): Promise<boolean> => tryLockCrawl(db, agentId, NOW, getLimits());

describe('POST /api/agents/[agentId]/repair', () => {
  it('repair resets chunks and restarts the crawl for the owner', async () => {
    const { agent, token } = await readyAgent();
    expect(await countAllChunks(db)).toBe(2);

    const res = await repair(agent.id, token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DIVING);

    const row = await getAgentById(db, agent.id);
    expect(row?.status).toBe('crawling');
    expect(row?.chunkCount).toBe(0);
    expect(await countAllChunks(db)).toBe(0);
    expect(background).toHaveBeenCalledTimes(1);
    expect(await createsThisHour()).toBe(1);
    expect(await crawlsToday()).toBe(1);

    await background.mock.calls[0]?.[0]();
    expect(runCrawl).toHaveBeenCalledWith(agent.id, undefined);
  });

  it('repair is owner only and 404 for an unknown agent', async () => {
    const { agent } = await readyAgent();
    for (const token of [undefined, 'wrong']) {
      const res = await repair(agent.id, token);
      expect(res.status).toBe(403);
      expect(((await res.json()) as ApiErrorBody).error).toBe(COPY.notOwner);
    }
    expect((await repair('abc', 'x')).status).toBe(404);
    expect(background).not.toHaveBeenCalled();
    expect(await createsThisHour()).toBe(0);
    expect(await lockIsFree(agent.id)).toBe(true);
  });

  it('repair counts against the hourly create limit', async () => {
    const { agent, token } = await readyAgent();
    for (const d of ['one.example', 'two.example', 'three.example']) {
      const res = await createAgent(
        new Request('http://localhost/api/create-agent', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-real-ip': IP },
          body: JSON.stringify({ url: d }),
        }),
      );
      expect(res.status).toBe(200);
    }
    background.mockReset();

    const res = await repair(agent.id, token);
    expect(res.status).toBe(429);
    expect(((await res.json()) as ApiErrorBody).rail).toBe('create_ip');
    expect(captureServer).toHaveBeenCalledWith('rate_limited', { rail: 'create_ip' });
    expect(background).not.toHaveBeenCalled();
    expect((await getAgentById(db, agent.id))?.status).toBe('ready');
    expect(await countAllChunks(db)).toBe(2);
    expect(await lockIsFree(agent.id)).toBe(true);
  });

  it('repair counts against the daily crawl cap', async () => {
    vi.stubEnv('MAX_CRAWLS_PER_DAY', '1');
    const { agent, token } = await readyAgent();
    expect((await repair(agent.id, token)).status).toBe(200);
    await background.mock.calls[0]?.[0]();

    const res = await repair(agent.id, token, '198.51.100.8');
    expect(res.status).toBe(429);
    expect(((await res.json()) as ApiErrorBody).rail).toBe('crawl_daily');
    expect(background).toHaveBeenCalledTimes(1);
    expect(await lockIsFree(agent.id)).toBe(true);
  });

  it('repair is refused with the spec copy when the demo is full', async () => {
    vi.stubEnv('MAX_TOTAL_CHUNKS', '3');
    vi.stubEnv('MAX_CHUNKS_PER_AGENT', '2');
    // A pinned agent holds the room the sweep cannot free.
    const other = await readyAgent('other.example', 2);
    await db.query('UPDATE agents SET pinned = true WHERE id = $1', [other.agent.id]);
    const { agent, token } = await readyAgent('example.com', 0);

    const res = await repair(agent.id, token);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      success: false,
      error: 'The free demo is full right now — try again tomorrow',
      rail: 'capacity',
    });
    expect(background).not.toHaveBeenCalled();
    expect(await crawlsToday()).toBe(0);
  });

  it('repair is refused once crawls spent their embedding share, keeping the pages', async () => {
    await spendCrawlEmbedShare();
    const { agent, token } = await readyAgent();
    const res = await repair(agent.id, token);
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe('Sammy has read all it can for today — the free demo resets tomorrow.');
    expect(await countAllChunks(db)).toBe(2);
    expect(background).not.toHaveBeenCalled();
    expect(await createsThisHour()).toBe(0);
    expect(await lockIsFree(agent.id)).toBe(true);
  });

  it('during a size mismatch without the opt-in, repair fails before deleting any page', async () => {
    const { agent, token } = await readyAgent();
    vi.stubEnv('EMBEDDING_DIMS', '1536');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await repair(agent.id, token);
    errorSpy.mockRestore();
    expect(res.status).toBe(503);
    expect(await countAllChunks(db)).toBe(2);
    expect((await getAgentById(db, agent.id))?.status).toBe('ready');
    expect(background).not.toHaveBeenCalled();
    expect(await lockIsFree(agent.id)).toBe(true);
  });

  it('an agent the capacity sweep evicts is 404 and leaves no lock', async () => {
    vi.stubEnv('MAX_TOTAL_CHUNKS', '3');
    vi.stubEnv('MAX_CHUNKS_PER_AGENT', '2');
    const { agent, token } = await readyAgent('example.com', 3);

    const res = await repair(agent.id, token);
    expect(res.status).toBe(404);
    expect(((await res.json()) as ApiErrorBody).error.startsWith('This Sammy has retired')).toBe(true);
    expect(await getAgentById(db, agent.id)).toBeNull();
    expect(background).not.toHaveBeenCalled();
    expect(await crawlsToday()).toBe(0);
    expect(await lockIsFree(agent.id)).toBe(true);
  });

  it('second repair while a crawl runs is 409 and spends nothing', async () => {
    const { agent, token } = await readyAgent();
    expect((await repair(agent.id, token)).status).toBe(200);
    expect(await createsThisHour()).toBe(1);

    const res = await repair(agent.id, token);
    expect(res.status).toBe(409);
    expect(((await res.json()) as ApiErrorBody).error).toBe(COPY.busy);
    expect(await createsThisHour()).toBe(1);
    expect(await crawlsToday()).toBe(1);
    expect(background).toHaveBeenCalledTimes(1);
  });

  it('repair works again once the crawl lock is released', async () => {
    const { agent, token } = await readyAgent();
    expect((await repair(agent.id, token)).status).toBe(200);
    await background.mock.calls[0]?.[0]();
    expect((await repair(agent.id, token)).status).toBe(200);
    expect(background).toHaveBeenCalledTimes(2);
  });

  it('a failed crawl start releases the crawl lock', async () => {
    const { agent, token } = await readyAgent();
    background.mockImplementationOnce(() => {
      throw new Error('scheduler down');
    });
    await expect(repair(agent.id, token)).rejects.toThrow('scheduler down');
    expect(await lockIsFree(agent.id)).toBe(true);
  });

  it('maxDuration matches the crawl budget', () => {
    expect(maxDuration).toBe(getLimits().crawlMaxDurationS);
  });
});
