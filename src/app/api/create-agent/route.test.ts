import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLimits } from '@/lib/config';
import { setDbForTests, type Db } from '@/lib/db/client';
import { getAgentByDomain, insertAgent } from '@/lib/db/agents';
import { insertChunksWithinCeiling } from '@/lib/db/chunks';
import { acquireLock, readQuota } from '@/lib/db/quota';
import { runInBackground } from '@/lib/background';
import { runCrawl } from '@/lib/crawl/run-crawl';
import { tryLockCrawl } from '@/lib/crawl/start-crawl';
import { captureServer } from '@/lib/analytics/server';
import { COPY } from '@/lib/agent-api';
import { hashOwnerToken } from '@/lib/owner-token';
import { railKey } from '@/lib/rails';
import { createTestDb, fakeEmbedding, TEST_DB_TIMEOUT_MS } from '@/test/test-db';
import { POST, maxDuration } from './route';

vi.mock('@/lib/background', () => ({ runInBackground: vi.fn() }));
vi.mock('@/lib/crawl/run-crawl', () => ({ runCrawl: vi.fn(), createCrawlDeps: vi.fn() }));
vi.mock('@/lib/analytics/server');
// Every host resolves to a public address except one, so tests never touch real DNS.
vi.mock('node:dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns')>();
  const lookup = async (host: string) => [
    { address: host === 'intranet.example.com' ? '10.0.0.5' : '93.184.216.34', family: 4 },
  ];
  return { ...actual, promises: { ...actual.promises, lookup } };
});

const NOW = new Date('2026-11-05T10:15:00.000Z');
const IP = '198.51.100.7';

let db: Db;
const background = vi.mocked(runInBackground);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  background.mockReset();
  vi.mocked(runCrawl).mockReset();
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

function post(body: unknown, ip = IP): Promise<Response> {
  return POST(
    new Request('http://localhost/api/create-agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-real-ip': ip },
      body: JSON.stringify(body),
    }),
  );
}

interface Body {
  success: boolean;
  agentId?: string;
  agentName?: string;
  status?: string;
  isExisting?: boolean;
  ownerToken?: string;
  error?: string;
  rail?: string;
}

async function create(url: string, ip = IP): Promise<{ status: number; body: Body }> {
  const res = await post({ url }, ip);
  return { status: res.status, body: (await res.json()) as Body };
}

const crawlsToday = (): Promise<number> => readQuota(db, railKey('crawl_daily', 'global', NOW), NOW);
const createsThisHour = (ip = IP): Promise<number> => readQuota(db, railKey('create_ip', ip, NOW), NOW);

describe('POST /api/create-agent', () => {
  it('rejects a private URL with 400', async () => {
    for (const body of [
      { url: 'http://localhost:3000' },
      { url: 'http://10.0.0.1' },
      { url: 'https://intranet.example.com' },
      { url: 'ftp://example.com' },
      { url: 42 },
      {},
    ]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as Body).error).toBe(COPY.badUrl);
    }
    expect(await createsThisHour()).toBe(0);
    expect(background).not.toHaveBeenCalled();
  });

  it('rejects a body that is not JSON with 400', async () => {
    const res = await POST(
      new Request('http://localhost/api/create-agent', { method: 'POST', body: 'not json' }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as Body).error).toBe(COPY.badUrl);
  });

  it('creates an agent and returns an owner token', async () => {
    const { status, body } = await create('https://www.Example.com/about');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      agentName: 'Sammy - example.com',
      status: 'crawling',
      isExisting: false,
    });
    expect(body.ownerToken?.length).toBeGreaterThanOrEqual(40);

    const row = await getAgentByDomain(db, 'example.com');
    expect(row?.id).toBe(body.agentId);
    expect(row?.status).toBe('crawling');
    expect(row?.pinned).toBe(false);
    expect(row?.ownerTokenHash).toBe(hashOwnerToken(body.ownerToken ?? ''));
    expect(row?.instruction).toContain('example.com');

    expect(background).toHaveBeenCalledTimes(1);
    expect(await crawlsToday()).toBe(1);
    expect(await createsThisHour()).toBe(1);
    // The create lock is released once the request is done.
    expect(await acquireLock(db, 'create:example.com', NOW, 1000)).toBe(true);

    vi.mocked(runCrawl).mockResolvedValue({} as Awaited<ReturnType<typeof runCrawl>>);
    await background.mock.calls[0]?.[0]();
    expect(runCrawl).toHaveBeenCalledWith(body.agentId, undefined);
  });

  it('existing domain returns no owner token', async () => {
    const first = await create('example.com');
    const second = await create('https://www.example.com', '198.51.100.99');
    expect(second.status).toBe(200);
    expect(second.body.isExisting).toBe(true);
    expect(second.body.agentId).toBe(first.body.agentId);
    expect(second.body).not.toHaveProperty('ownerToken');
    expect(background).toHaveBeenCalledTimes(1);
    expect(await crawlsToday()).toBe(1);
    expect(await createsThisHour('198.51.100.99')).toBe(0);
  });

  it('re-submitting a known domain spends no hourly create', async () => {
    expect((await create('alpha.example')).status).toBe(200);
    for (const url of ['alpha.example', 'www.alpha.example', 'https://alpha.example/x', 'ALPHA.example', 'http://alpha.example']) {
      const { status, body } = await create(url);
      expect(status).toBe(200);
      expect(body.isExisting).toBe(true);
    }
    expect((await create('beta.example')).status).toBe(200);
    expect((await create('gamma.example')).status).toBe(200);
    const blocked = await create('delta.example');
    expect(blocked.status).toBe(429);
    expect(blocked.body.rail).toBe('create_ip');
  });

  it('fourth create from one IP in an hour is 429', async () => {
    for (const d of ['one.example', 'two.example', 'three.example']) {
      expect((await create(d)).status).toBe(200);
    }
    const { status, body } = await create('four.example');
    expect(status).toBe(429);
    expect(body).toMatchObject({ success: false, rail: 'create_ip' });
    expect(body.error).toBeTruthy();
    expect(captureServer).toHaveBeenCalledWith('rate_limited', { rail: 'create_ip' });
    expect(await getAgentByDomain(db, 'four.example')).toBeNull();
    // A blocked request starts no crawl, so the daily crawl counter does not move.
    expect(await crawlsToday()).toBe(3);
    // Another IP is unaffected.
    expect((await create('four.example', '198.51.100.8')).status).toBe(200);
  });

  it('the daily crawl cap only counts crawls that start', async () => {
    vi.stubEnv('MAX_CRAWLS_PER_DAY', '1');
    expect((await create('one.example', '198.51.100.1')).status).toBe(200);
    expect((await create('one.example', '198.51.100.2')).body.isExisting).toBe(true);
    const { status, body } = await create('two.example', '198.51.100.3');
    expect(status).toBe(429);
    expect(body.rail).toBe('crawl_daily');
    expect(captureServer).toHaveBeenCalledWith('rate_limited', { rail: 'crawl_daily' });
    expect(await getAgentByDomain(db, 'two.example')).toBeNull();
    expect(background).toHaveBeenCalledTimes(1);
  });

  it('full demo returns the spec copy', async () => {
    vi.stubEnv('MAX_TOTAL_CHUNKS', '5');
    vi.stubEnv('MAX_CHUNKS_PER_AGENT', '2');
    const pinned = await insertAgent(db, {
      domain: 'pinned.example',
      url: 'https://pinned.example',
      name: 'Sammy - pinned.example',
      instruction: 'x',
      ownerTokenHash: null,
      pinned: true,
      now: NOW,
    });
    if (!pinned) throw new Error('insert failed');
    await insertChunksWithinCeiling(
      db,
      pinned.id,
      [0, 1, 2, 3].map((i) => ({ url: 'https://pinned.example', title: 't', pos: i, content: 'c', embedding: fakeEmbedding(i) })),
      100,
    );

    const { status, body } = await create('example.com');
    expect(status).toBe(429);
    expect(body).toMatchObject({
      success: false,
      error: 'The free demo is full right now — try again tomorrow',
      rail: 'capacity',
    });
    expect(captureServer).toHaveBeenCalledWith('rate_limited', { rail: 'capacity' });
    expect(await getAgentByDomain(db, 'example.com')).toBeNull();
    expect(await crawlsToday()).toBe(0);
  });

  it('a held create lock is 409 when no agent exists yet', async () => {
    expect(await acquireLock(db, 'create:busy.example', NOW, 60_000)).toBe(true);
    const { status, body } = await create('busy.example');
    expect(status).toBe(409);
    expect(body.error).toBe(COPY.busy);
    expect(background).not.toHaveBeenCalled();
    expect(await crawlsToday()).toBe(0);
  });

  it('a failed crawl start releases both locks', async () => {
    background.mockImplementationOnce(() => {
      throw new Error('scheduler down');
    });
    await expect(post({ url: 'example.com' })).rejects.toThrow('scheduler down');
    const row = await getAgentByDomain(db, 'example.com');
    if (!row) throw new Error('row missing');
    expect(await tryLockCrawl(db, row.id, NOW, getLimits())).toBe(true);
    expect(await acquireLock(db, 'create:example.com', NOW, 1000)).toBe(true);
  });

  it('maxDuration matches the crawl budget', () => {
    expect(maxDuration).toBe(getLimits().crawlMaxDurationS);
  });
});
