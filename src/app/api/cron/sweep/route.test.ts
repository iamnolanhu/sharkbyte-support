import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Db } from '@/lib/db/client';
import { setDbForTests } from '@/lib/db/client';
import { captureServer } from '@/lib/analytics/server';
import { createTestDb, TEST_DB_TIMEOUT_MS } from '@/test/test-db';
import { GET } from './route';

vi.mock('@/lib/analytics/server');

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  setDbForTests(db);
  vi.mocked(captureServer).mockReset();
  vi.mocked(captureServer).mockResolvedValue(undefined);
  vi.stubEnv('CRON_SECRET', 'test-cron-secret');
}, TEST_DB_TIMEOUT_MS);

afterEach(() => {
  setDbForTests(null);
  vi.unstubAllEnvs();
});

function call(authorization?: string): Promise<Response> {
  const headers = new Headers();
  if (authorization) headers.set('authorization', authorization);
  return GET(new Request('http://localhost/api/cron/sweep', { headers }));
}

describe('GET /api/cron/sweep', () => {
  it('rejects a missing or wrong secret', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('Bearer nope')).status).toBe(401);
    expect(captureServer).not.toHaveBeenCalled();
  });

  it('rejects everything when CRON_SECRET is unset', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await call('Bearer ')).status).toBe(401);
    expect((await call('Bearer undefined')).status).toBe(401);
  });

  it('sweeps with the right secret', async () => {
    const res = await call('Bearer test-cron-secret');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ success: true, stalledCrawlsFinished: 0, agentsRemoved: 0, chunksAfter: 0 });
    expect(captureServer).toHaveBeenCalledWith(
      'cron_sweep',
      expect.objectContaining({ stalled_crawls_finished: 0, agents_removed: 0, chunks: 0 }),
    );
  });
});
