import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { APP_DOMAIN } from '@/lib/config';
import { setDbForTests, type Db } from '@/lib/db/client';
import { finishCrawl, getAgentById, insertAgent, updateCrawlProgress } from '@/lib/db/agents';
import { COPY } from '@/lib/agent-api';
import { runInBackground } from '@/lib/background';
import { tryLockCrawl } from '@/lib/crawl/start-crawl';
import { getLimits } from '@/lib/config';
import { createTestDb, TEST_DB_TIMEOUT_MS } from '@/test/test-db';
import type { AgentRow, AgentStatusResponse, ApiErrorBody } from '@/types';
import { GET, maxDuration } from './route';

vi.mock('@/lib/background', () => ({ runInBackground: vi.fn() }));
vi.mock('@/lib/crawl/run-crawl', () => ({ runCrawl: vi.fn(), createCrawlDeps: vi.fn() }));

const NOW = new Date('2026-11-05T10:15:00.000Z');

let db: Db;

beforeEach(async () => {
  vi.mocked(runInBackground).mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = await createTestDb();
  setDbForTests(db);
}, TEST_DB_TIMEOUT_MS);

afterEach(() => {
  setDbForTests(null);
  vi.useRealTimers();
});

async function makeAgent(startedAt: Date): Promise<AgentRow> {
  const row = await insertAgent(db, {
    domain: 'example.com',
    url: 'https://example.com',
    name: 'Sammy - example.com',
    instruction: 'x',
    ownerTokenHash: null,
    pinned: false,
    now: startedAt,
  });
  if (!row) throw new Error('insert failed');
  return row;
}

function status(query: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/agent-status${query}`));
}

describe('GET /api/agent-status', () => {
  it('reports crawl progress while crawling', async () => {
    const agent = await makeAgent(NOW);
    await updateCrawlProgress(db, agent.id, { pagesCrawled: 3, pagesTotal: 12, chunkCount: 9 });
    const res = await status(`?agentId=${agent.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()) as AgentStatusResponse).toEqual({
      success: true,
      status: 'crawling',
      pagesCrawled: 3,
      pagesTotal: 12,
      chunkCount: 9,
      message: 'Read 3 of 12 pages',
    });
  });

  it('a poll starts the next crawl slice when none is running', async () => {
    const agent = await makeAgent(new Date(NOW.getTime() - 600_000));
    const body = (await (await status(`?agentId=${agent.id}`)).json()) as AgentStatusResponse;
    expect(body.status).toBe('crawling');
    expect(runInBackground).toHaveBeenCalledTimes(1);
    // The slice now holds the crawl lock.
    expect(await tryLockCrawl(db, agent.id, NOW, getLimits())).toBe(false);
  });

  it('a poll while a slice runs starts nothing', async () => {
    const agent = await makeAgent(NOW);
    expect(await tryLockCrawl(db, agent.id, NOW, getLimits())).toBe(true);
    const body = (await (await status(`?agentId=${agent.id}`)).json()) as AgentStatusResponse;
    expect(body.status).toBe('crawling');
    expect(runInBackground).not.toHaveBeenCalled();
    expect((await getAgentById(db, agent.id))?.status).toBe('crawling');
  });

  it('maxDuration fits a crawl slice', () => {
    expect(maxDuration).toBe(getLimits().crawlMaxDurationS);
  });

  it('reports ready and failed agents', async () => {
    const agent = await makeAgent(NOW);
    await finishCrawl(db, agent.id, { status: 'ready', lastError: null });
    const ready = (await (await status(`?agentId=${agent.id}`)).json()) as AgentStatusResponse;
    expect(ready.status).toBe('ready');
    expect(ready.error).toBeUndefined();
    expect(ready.message).toBeTruthy();

    await finishCrawl(db, agent.id, { status: 'failed', lastError: null });
    const failed = (await (await status(`?agentId=${agent.id}`)).json()) as AgentStatusResponse;
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe(COPY.crawlFailed);
  });

  it('an unknown or malformed id is 404 retired', async () => {
    for (const query of ['?agentId=abc', '?agentId=2b1f0e1c-3a4d-4e5f-8a9b-0c1d2e3f4a5b', '']) {
      const res = await status(query);
      expect(res.status).toBe(404);
      expect(((await res.json()) as ApiErrorBody).error).toBe(COPY.retired(APP_DOMAIN));
    }
  });
});
