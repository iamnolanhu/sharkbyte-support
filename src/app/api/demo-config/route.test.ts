import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { APP_DOMAIN, getLimits } from '@/lib/config';
import { setDbForTests, type Db } from '@/lib/db/client';
import { finishCrawl, getAgentByDomain, getAgentById, insertAgent } from '@/lib/db/agents';
import { insertChunksWithinCeiling } from '@/lib/db/chunks';
import { runInBackground } from '@/lib/background';
import { runCrawl } from '@/lib/crawl/run-crawl';
import { tryLockCrawl } from '@/lib/crawl/start-crawl';
import { domainKey } from '@/lib/crawl/url-guard';
import { captureServer } from '@/lib/analytics/server';
import { mintOwnerToken } from '@/lib/owner-token';
import { createTestDb, fakeEmbedding, TEST_DB_TIMEOUT_MS } from '@/test/test-db';
import type { AgentRow } from '@/types';
import { GET, maxDuration } from './route';

vi.mock('@/lib/background', () => ({ runInBackground: vi.fn() }));
vi.mock('@/lib/crawl/run-crawl', () => ({ runCrawl: vi.fn(), createCrawlDeps: vi.fn() }));
vi.mock('@/lib/analytics/server');

const NOW = new Date('2026-11-05T10:15:00.000Z');
const DEMO_DOMAIN = domainKey(new URL(/^https?:\/\//i.test(APP_DOMAIN) ? APP_DOMAIN : `https://${APP_DOMAIN}`));

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

interface DemoBody {
  success: boolean;
  agentId?: string;
  status?: string;
  error?: string;
  rail?: string;
}

async function demo(): Promise<{ status: number; body: DemoBody }> {
  const res = await GET();
  return { status: res.status, body: (await res.json()) as DemoBody };
}

async function demoRow(): Promise<AgentRow> {
  const row = await getAgentByDomain(db, DEMO_DOMAIN);
  if (!row) throw new Error('no demo agent');
  return row;
}

async function finishScheduledCrawls(): Promise<void> {
  for (const [job] of background.mock.calls) await job();
}

describe('GET /api/demo-config', () => {
  it('creates the pinned demo agent once', async () => {
    const first = await demo();
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ success: true, status: 'crawling' });
    const second = await demo();
    expect(second.body.agentId).toBe(first.body.agentId);

    const rows = await db.query<{ n: string }>('SELECT count(*) AS n FROM agents');
    expect(Number(rows[0]?.n)).toBe(1);
    const row = await demoRow();
    expect(row.id).toBe(first.body.agentId);
    expect(row.pinned).toBe(true);
    expect(row.ownerTokenHash).toBeNull();
    expect(row.name).toBe(`Sammy - ${DEMO_DOMAIN}`);
    expect(background).toHaveBeenCalledTimes(1);
  });

  it('pins a stranger-made agent for the app domain', async () => {
    const stranger = await insertAgent(db, {
      domain: DEMO_DOMAIN,
      url: `https://${DEMO_DOMAIN}`,
      name: `Sammy - ${DEMO_DOMAIN}`,
      instruction: 'x',
      ownerTokenHash: mintOwnerToken().hash,
      pinned: false,
      now: NOW,
    });
    if (!stranger) throw new Error('insert failed');
    await finishCrawl(db, stranger.id, { status: 'ready', lastError: null });

    const { body } = await demo();
    expect(body).toEqual({ success: true, agentId: stranger.id, status: 'ready' });
    const row = await getAgentById(db, stranger.id);
    expect(row?.pinned).toBe(true);
    expect(row?.ownerTokenHash).toBeNull();
    expect(background).not.toHaveBeenCalled();
  });

  it('re-crawls a failed demo agent at most once an hour', async () => {
    await demo();
    await finishScheduledCrawls();
    const row = await demoRow();
    await finishCrawl(db, row.id, { status: 'failed', lastError: 'boom' });

    expect((await demo()).body.status).toBe('crawling');
    expect(background).toHaveBeenCalledTimes(2);
    await finishScheduledCrawls();

    await finishCrawl(db, row.id, { status: 'failed', lastError: 'boom' });
    expect((await demo()).body.status).toBe('failed');
    expect(background).toHaveBeenCalledTimes(2);
    // The hourly allowance is spent, but the crawl lock is not left behind.
    expect(await tryLockCrawl(db, row.id, NOW, getLimits())).toBe(true);
    await db.query('DELETE FROM locks');

    vi.setSystemTime(new Date(NOW.getTime() + 60 * 60 * 1000));
    expect((await demo()).body.status).toBe('crawling');
    expect(background).toHaveBeenCalledTimes(3);
  });

  it('does not re-crawl a failed demo agent whose crawl lock is held', async () => {
    await demo();
    const row = await demoRow();
    await finishCrawl(db, row.id, { status: 'failed', lastError: 'boom' });
    expect((await demo()).body.status).toBe('failed');
    expect(background).toHaveBeenCalledTimes(1);
  });

  it('continues an unfinished demo crawl when no slice is running', async () => {
    await demo();
    await finishScheduledCrawls();
    vi.setSystemTime(new Date(NOW.getTime() + 331_000));
    const { body } = await demo();
    expect(body.status).toBe('crawling');
    expect(background).toHaveBeenCalledTimes(2);
  });

  it('returns the capacity rail when the demo agent cannot be created', async () => {
    vi.stubEnv('MAX_TOTAL_CHUNKS', '3');
    vi.stubEnv('MAX_CHUNKS_PER_AGENT', '2');
    const full = await insertAgent(db, {
      domain: 'pinned.example',
      url: 'https://pinned.example',
      name: 'Sammy - pinned.example',
      instruction: 'x',
      ownerTokenHash: null,
      pinned: true,
      now: NOW,
    });
    if (!full) throw new Error('insert failed');
    await insertChunksWithinCeiling(
      db,
      full.id,
      [0, 1].map((i) => ({ url: 'https://pinned.example', title: 't', pos: i, content: 'c', embedding: fakeEmbedding(i) })),
      100,
    );

    const { status, body } = await demo();
    expect(status).toBe(429);
    expect(body).toEqual({
      success: false,
      error: 'The free demo is full right now — try again tomorrow',
      rail: 'capacity',
    });
    expect(captureServer).toHaveBeenCalledWith('rate_limited', { rail: 'capacity' });
    expect(await getAgentByDomain(db, DEMO_DOMAIN)).toBeNull();
    expect(background).not.toHaveBeenCalled();
  });

  it('ignores the per-IP and daily crawl rails', async () => {
    vi.stubEnv('MAX_CRAWLS_PER_DAY', '1');
    await db.query(
      `INSERT INTO quota (key, count, expires_at) VALUES ($1, 99, $2)`,
      [`global:crawls:${NOW.toISOString().slice(0, 10)}`, new Date(NOW.getTime() + 86_400_000)],
    );
    const { status, body } = await demo();
    expect(status).toBe(200);
    expect(body.status).toBe('crawling');
  });

  it('maxDuration matches the crawl budget', () => {
    expect(maxDuration).toBe(getLimits().crawlMaxDurationS);
  });
});
