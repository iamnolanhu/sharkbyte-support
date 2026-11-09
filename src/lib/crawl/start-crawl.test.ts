import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLimits } from '@/lib/config';
import type { Db } from '@/lib/db/client';
import { getAgentById, insertAgent } from '@/lib/db/agents';
import { countAllChunks, insertChunksWithinCeiling } from '@/lib/db/chunks';
import { runInBackground } from '@/lib/background';
import { embedRequestGate } from '@/lib/rails';
import { createTestDb, fakeEmbedding, TEST_DB_TIMEOUT_MS } from '@/test/test-db';
import type { AgentRow } from '@/types';
import { runCrawl, createCrawlDeps, type CrawlDeps } from './run-crawl';
import { continueCrawl, releaseCrawlLock, startLockedCrawl, tryLockCrawl } from './start-crawl';

vi.mock('@/lib/background', () => ({ runInBackground: vi.fn() }));
vi.mock('@/lib/crawl/run-crawl', () => ({ runCrawl: vi.fn(), createCrawlDeps: vi.fn() }));

const NOW = new Date('2026-11-05T10:00:00.000Z');
const limits = getLimits({});
const TTL_MS = (limits.crawlMaxDurationS + 30) * 1000;

let db: Db;
let agent: AgentRow;
const background = vi.mocked(runInBackground);
const crawl = vi.mocked(runCrawl);

async function makeAgent(domain: string): Promise<AgentRow> {
  const row = await insertAgent(db, {
    domain,
    url: `https://${domain}`,
    name: `Sammy - ${domain}`,
    instruction: '',
    ownerTokenHash: null,
    pinned: false,
    now: NOW,
  });
  if (!row) throw new Error('insert failed');
  return row;
}

beforeEach(async () => {
  background.mockReset();
  crawl.mockReset();
  vi.mocked(createCrawlDeps).mockReset().mockReturnValue({} as CrawlDeps);
  db = await createTestDb();
  agent = await makeAgent('example.com');
}, TEST_DB_TIMEOUT_MS);

function capturedJob(): () => Promise<void> {
  const fn = background.mock.calls[0]?.[0];
  if (!fn) throw new Error('nothing scheduled');
  return fn;
}

describe('continueCrawl', () => {
  it('starts the next slice of a crawling agent only when no slice holds the lock', async () => {
    crawl.mockResolvedValue({ status: 'crawling' } as Awaited<ReturnType<typeof runCrawl>>);
    expect(agent.status).toBe('crawling');

    expect(await continueCrawl(db, agent, NOW, limits)).toBe(true);
    expect(background).toHaveBeenCalledTimes(1);
    // The slice holds the lock: a second poll starts nothing.
    expect(await continueCrawl(db, agent, NOW, limits)).toBe(false);
    expect(background).toHaveBeenCalledTimes(1);

    await capturedJob()();
    expect(crawl).toHaveBeenCalledWith(agent.id, expect.anything());
    // Lock released after the slice: the next poll continues.
    expect(await continueCrawl(db, agent, NOW, limits)).toBe(true);
  });

  it('skips the lock write while the crawl made progress in the last 10 s', async () => {
    const recent = { ...agent, crawlProgressAt: new Date(NOW.getTime() - 5_000) };
    expect(await continueCrawl(db, recent, NOW, limits)).toBe(false);
    expect(background).not.toHaveBeenCalled();
    expect(await tryLockCrawl(db, agent.id, NOW, limits)).toBe(true);
    await releaseCrawlLock(db, agent.id);
    const quiet = { ...agent, crawlProgressAt: new Date(NOW.getTime() - 11_000) };
    expect(await continueCrawl(db, quiet, NOW, limits)).toBe(true);
  });

  it('starts nothing and touches nothing while the daily embedding rail is spent', async () => {
    const small = { ...limits, maxEmbedRequestsPerDay: 4 };
    const gate = embedRequestGate(db, small, 'crawl');
    for (let i = 0; i < 3; i++) await gate();
    const before = await getAgentById(db, agent.id);

    expect(await continueCrawl(db, agent, new Date(), small)).toBe(false);

    expect(background).not.toHaveBeenCalled();
    expect(await tryLockCrawl(db, agent.id, NOW, limits)).toBe(true);
    const after = await getAgentById(db, agent.id);
    expect(after?.status).toBe('crawling');
    expect(after?.crawlProgressAt).toEqual(before?.crawlProgressAt);
  });

  it('releases the lock when the slice cannot be scheduled', async () => {
    background.mockImplementationOnce(() => {
      throw new Error('after() unavailable');
    });
    await expect(continueCrawl(db, agent, NOW, limits)).rejects.toThrow('after() unavailable');
    expect(await tryLockCrawl(db, agent.id, NOW, limits)).toBe(true);
  });

  it('does nothing for an agent that is not crawling', async () => {
    expect(await continueCrawl(db, { ...agent, status: 'ready' }, NOW, limits)).toBe(false);
    expect(await continueCrawl(db, { ...agent, status: 'failed' }, NOW, limits)).toBe(false);
    expect(background).not.toHaveBeenCalled();
    expect(await tryLockCrawl(db, agent.id, NOW, limits)).toBe(true);
  });
});

describe('tryLockCrawl', () => {
  it('is exclusive per agent until maxDuration + 30 s', async () => {
    const other = await makeAgent('other.example');
    expect(await tryLockCrawl(db, agent.id, NOW, limits)).toBe(true);
    expect(await tryLockCrawl(db, agent.id, NOW, limits)).toBe(false);
    expect(await tryLockCrawl(db, other.id, NOW, limits)).toBe(true);
    expect(await tryLockCrawl(db, agent.id, new Date(NOW.getTime() + TTL_MS - 1), limits)).toBe(false);
    expect(await tryLockCrawl(db, agent.id, new Date(NOW.getTime() + TTL_MS), limits)).toBe(true);
  });
});

describe('startLockedCrawl', () => {
  it('resets the row and schedules the crawl', async () => {
    await insertChunksWithinCeiling(
      db,
      agent.id,
      [{ url: 'https://example.com', title: 't', pos: 0, content: 'c', embedding: fakeEmbedding(1) }],
      1000,
    );
    await db.query(`UPDATE agents SET status = 'ready', chunk_count = 1 WHERE id = $1`, [agent.id]);
    expect(await countAllChunks(db)).toBe(1);
    crawl.mockResolvedValue({ status: 'ready' } as Awaited<ReturnType<typeof runCrawl>>);
    expect(await tryLockCrawl(db, agent.id, NOW, limits)).toBe(true);

    await startLockedCrawl(db, agent.id, NOW);

    const row = await getAgentById(db, agent.id);
    expect(row?.status).toBe('crawling');
    expect(row?.chunkCount).toBe(0);
    expect(await countAllChunks(db)).toBe(0);
    expect(background).toHaveBeenCalledTimes(1);
    expect(crawl).not.toHaveBeenCalled();

    await capturedJob()();
    expect(crawl).toHaveBeenCalledWith(agent.id, expect.anything());
  });

  it('releases the lock when the crawl ends or throws', async () => {
    crawl.mockResolvedValueOnce({ status: 'ready' } as Awaited<ReturnType<typeof runCrawl>>);
    expect(await tryLockCrawl(db, agent.id, NOW, limits)).toBe(true);
    await startLockedCrawl(db, agent.id, NOW);
    expect(await tryLockCrawl(db, agent.id, NOW, limits)).toBe(false);
    await capturedJob()();
    expect(await tryLockCrawl(db, agent.id, NOW, limits)).toBe(true);

    background.mockReset();
    crawl.mockRejectedValueOnce(new Error('boom'));
    await startLockedCrawl(db, agent.id, NOW);
    await expect(capturedJob()()).rejects.toThrow('boom');
    expect(await tryLockCrawl(db, agent.id, NOW, limits)).toBe(true);
    await releaseCrawlLock(db, agent.id);
    expect(await tryLockCrawl(db, agent.id, NOW, limits)).toBe(true);
  });
});
