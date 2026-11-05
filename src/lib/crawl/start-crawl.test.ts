import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLimits } from '@/lib/config';
import type { Db } from '@/lib/db/client';
import { getAgentById, insertAgent } from '@/lib/db/agents';
import { countAllChunks, insertChunksWithinCeiling } from '@/lib/db/chunks';
import { runInBackground } from '@/lib/background';
import { createTestDb, fakeEmbedding, TEST_DB_TIMEOUT_MS } from '@/test/test-db';
import type { AgentRow } from '@/types';
import { runCrawl, createCrawlDeps, type CrawlDeps } from './run-crawl';
import { crawlIsStale, releaseCrawlLock, startLockedCrawl, tryLockCrawl } from './start-crawl';

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

describe('crawlIsStale', () => {
  it('only after maxDuration + 30 s', () => {
    const crawling: AgentRow = { ...agent, status: 'crawling', crawlStartedAt: NOW };
    const at = (ms: number) => new Date(NOW.getTime() + ms);
    expect(crawlIsStale(crawling, at(TTL_MS), limits)).toBe(false);
    expect(crawlIsStale(crawling, at(TTL_MS + 1), limits)).toBe(true);
    expect(crawlIsStale({ ...crawling, status: 'ready' }, at(TTL_MS * 2), limits)).toBe(false);
    expect(crawlIsStale({ ...crawling, crawlStartedAt: null }, at(TTL_MS * 2), limits)).toBe(false);
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
