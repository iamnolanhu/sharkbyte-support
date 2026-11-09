import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from '@/lib/db/client';
import { getLimits } from '@/lib/config';
import { RAIL_COPY } from '@/lib/rails';
import { finishCrawl, getAgentByDomain, insertAgent, pinAgent } from '@/lib/db/agents';
import { countAllChunks, insertChunksWithinCeiling } from '@/lib/db/chunks';
import { acquireLock, incrementQuota, readQuota } from '@/lib/db/quota';
import { ensureCapacity, sweep } from '@/lib/sweep';
import { createTestDb, fakeEmbedding, TEST_DB_TIMEOUT_MS } from '@/test/test-db';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const limits = getLimits({});

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
}, TEST_DB_TIMEOUT_MS);

interface SeedOptions {
  chunks?: number;
  lastUsedAgoMs?: number;
  crawlStartedAgoMs?: number;
  progressAgoMs?: number;
  status?: 'crawling' | 'ready' | 'failed';
  pinned?: boolean;
}

async function seed(domain: string, o: SeedOptions = {}): Promise<string> {
  const row = await insertAgent(db, {
    domain,
    url: `https://${domain}`,
    name: `Sammy - ${domain}`,
    instruction: 'Be nice.',
    ownerTokenHash: null,
    pinned: o.pinned ?? false,
    now: NOW,
  });
  if (!row) throw new Error('insertAgent returned null');
  const n = o.chunks ?? 0;
  if (n > 0) {
    await insertChunksWithinCeiling(
      db,
      row.id,
      Array.from({ length: n }, (_, i) => ({
        url: `https://${domain}/p${i}`,
        title: `Page ${i}`,
        pos: i,
        content: `content ${i}`,
        embedding: fakeEmbedding(i + 1),
      })),
      1_000_000,
    );
    await db.query('UPDATE agents SET chunk_count = $2 WHERE id = $1', [row.id, n]);
  }
  const status = o.status ?? 'ready';
  if (status !== 'crawling') await finishCrawl(db, row.id, { status, lastError: null });
  if (o.lastUsedAgoMs !== undefined) {
    await db.query('UPDATE agents SET last_used_at = $2 WHERE id = $1', [
      row.id,
      new Date(NOW.getTime() - o.lastUsedAgoMs),
    ]);
  }
  if (o.crawlStartedAgoMs !== undefined) {
    await db.query('UPDATE agents SET crawl_started_at = $2 WHERE id = $1', [
      row.id,
      new Date(NOW.getTime() - o.crawlStartedAgoMs),
    ]);
  }
  if (o.progressAgoMs !== undefined) {
    await db.query('UPDATE agents SET crawl_progress_at = $2 WHERE id = $1', [
      row.id,
      new Date(NOW.getTime() - o.progressAgoMs),
    ]);
  }
  return row.id;
}

describe('sweep', () => {
  it('removes agents idle past 14 days', async () => {
    await seed('old.test', { lastUsedAgoMs: 15 * DAY, chunks: 2 });
    await seed('recent.test', { lastUsedAgoMs: 13 * DAY, chunks: 2 });
    const result = await sweep(db, NOW, limits);
    expect(result.agentsRemoved).toBe(1);
    expect(await getAgentByDomain(db, 'old.test')).toBeNull();
    expect(await getAgentByDomain(db, 'recent.test')).not.toBeNull();
    expect(result.chunksAfter).toBe(2);
    expect(await countAllChunks(db)).toBe(2);
  });

  it('finishes stalled crawls with what they stored, and fails the empty ones', async () => {
    const stalledMs = (limits.crawlMaxDurationS + 31) * 1000;
    const withPages = await seed('stalled.test', { status: 'crawling', crawlStartedAgoMs: stalledMs, chunks: 5 });
    await seed('empty.test', { status: 'crawling', crawlStartedAgoMs: stalledMs });
    await seed('fresh.test', { status: 'crawling', crawlStartedAgoMs: 10_000, chunks: 3 });
    // Started long ago, but its last slice made progress recently: not stalled.
    await seed('sliced.test', { status: 'crawling', crawlStartedAgoMs: 3 * stalledMs, progressAgoMs: 10_000, chunks: 2 });
    const result = await sweep(db, NOW, limits);
    expect(result.stalledCrawlsFinished).toBe(2);
    const stalledRow = await getAgentByDomain(db, 'stalled.test');
    expect(stalledRow?.id).toBe(withPages);
    expect(stalledRow?.status).toBe('ready');
    expect(stalledRow?.chunkCount).toBe(5);
    expect(stalledRow?.lastError).toBeNull();
    const emptyRow = await getAgentByDomain(db, 'empty.test');
    expect(emptyRow?.status).toBe('failed');
    expect(emptyRow?.lastError).toBe('Sammy ran out of air mid-dive — press Repair to try again.');
    expect((await getAgentByDomain(db, 'fresh.test'))?.status).toBe('crawling');
    expect((await getAgentByDomain(db, 'sliced.test'))?.status).toBe('crawling');
    expect(await countAllChunks(db)).toBe(10);
  });

  it('a stalled partial crawl ends ready but keeps its to-do list for a resume', async () => {
    const id = await seed('partial.test', { status: 'crawling', crawlStartedAgoMs: (limits.crawlMaxDurationS + 31) * 1000, chunks: 2 });
    await db.query(`UPDATE agents SET crawl_pending = ARRAY['https://partial.test/next'] WHERE id = $1`, [id]);
    const empty = await seed('nothing.test', { status: 'crawling', crawlStartedAgoMs: (limits.crawlMaxDurationS + 31) * 1000 });
    await db.query(`UPDATE agents SET crawl_pending = ARRAY['https://nothing.test/'] WHERE id = $1`, [empty]);

    await sweep(db, NOW, limits);

    const rows = await db.query<{ domain: string; status: string; crawl_pending: string[] | null }>(
      `SELECT domain, status, crawl_pending FROM agents WHERE domain IN ('partial.test', 'nothing.test') ORDER BY domain`,
    );
    expect(rows).toEqual([
      { domain: 'nothing.test', status: 'failed', crawl_pending: null },
      { domain: 'partial.test', status: 'ready', crawl_pending: ['https://partial.test/next'] },
    ]);
  });

  it('keeps agents awaiting re-embedding past the failed-agent day, until the idle rule', async () => {
    const waiting = await seed('waiting.test', { status: 'failed', lastUsedAgoMs: 25 * HOUR });
    await db.query(`UPDATE agents SET last_error = 're-embedding required' WHERE id = $1`, [waiting]);
    const idle = await seed('idle.test', { status: 'failed', lastUsedAgoMs: 15 * DAY });
    await db.query(`UPDATE agents SET last_error = 're-embedding required' WHERE id = $1`, [idle]);

    const result = await sweep(db, NOW, limits);

    expect(result.agentsRemoved).toBe(1);
    expect(await getAgentByDomain(db, 'waiting.test')).not.toBeNull();
    expect(await getAgentByDomain(db, 'idle.test')).toBeNull();
  });

  it('deletes failed agents unused for a day', async () => {
    await seed('gone.test', { status: 'failed', lastUsedAgoMs: 25 * HOUR, chunks: 2 });
    await seed('kept.test', { status: 'failed', lastUsedAgoMs: 23 * HOUR, chunks: 2 });
    const pinned = await seed('pinned.test', { status: 'failed', lastUsedAgoMs: 30 * HOUR, chunks: 2 });
    await pinAgent(db, pinned);
    const result = await sweep(db, NOW, limits);
    expect(result.agentsRemoved).toBe(1);
    expect(await getAgentByDomain(db, 'gone.test')).toBeNull();
    const kept = await getAgentByDomain(db, 'kept.test');
    expect(kept).not.toBeNull();
    expect(kept?.chunkCount).toBe(0);
    expect(await getAgentByDomain(db, 'pinned.test')).not.toBeNull();
    expect(await countAllChunks(db)).toBe(0);
  });

  it('spares crawling and pinned agents', async () => {
    const small = { ...limits, maxTotalChunks: 10 };
    await seed('crawling.test', { status: 'crawling', crawlStartedAgoMs: 5_000, lastUsedAgoMs: 40 * DAY, chunks: 6 });
    const pinned = await seed('pinned.test', { lastUsedAgoMs: 40 * DAY, chunks: 6 });
    await pinAgent(db, pinned);
    const result = await sweep(db, NOW, small);
    expect(result.agentsRemoved).toBe(0);
    expect(await getAgentByDomain(db, 'crawling.test')).not.toBeNull();
    expect(await getAgentByDomain(db, 'pinned.test')).not.toBeNull();
    expect(result.chunksAfter).toBe(12);
  });

  it('evicts oldest-used first until under 80%', async () => {
    const small = { ...limits, maxTotalChunks: 100 };
    await seed('a.test', { lastUsedAgoMs: 3 * DAY, chunks: 30 });
    await seed('b.test', { lastUsedAgoMs: 2 * DAY, chunks: 30 });
    await seed('c.test', { lastUsedAgoMs: 1 * DAY, chunks: 30 });
    const result = await sweep(db, NOW, small);
    expect(result.agentsRemoved).toBe(1);
    expect(result.chunksAfter).toBe(60);
    expect(await getAgentByDomain(db, 'a.test')).toBeNull();
    expect(await getAgentByDomain(db, 'b.test')).not.toBeNull();
    expect(await getAgentByDomain(db, 'c.test')).not.toBeNull();
    expect(result.dbBytes).toBeGreaterThan(0);
  });

  it('clears expired quota counters and locks', async () => {
    await incrementQuota(db, 'old', 1, new Date(NOW.getTime() - 1000), new Date(NOW.getTime() - 2000));
    await incrementQuota(db, 'live', 1, new Date(NOW.getTime() + HOUR), NOW);
    await acquireLock(db, 'old-lock', new Date(NOW.getTime() - 10_000), 1000);
    await acquireLock(db, 'live-lock', NOW, HOUR);
    await sweep(db, NOW, limits);
    expect(await readQuota(db, 'live', NOW)).toBe(1);
    const quotaKeys = await db.query<{ key: string }>('SELECT key FROM quota');
    const lockKeys = await db.query<{ key: string }>('SELECT key FROM locks');
    expect(quotaKeys.map((r) => r.key)).toEqual(['live']);
    expect(lockKeys.map((r) => r.key)).toEqual(['live-lock']);
  });
});

describe('ensureCapacity', () => {
  it('sweeps before refusing', async () => {
    const small = { ...limits, maxTotalChunks: 100, maxChunksPerAgent: 20 };
    await seed('stale1.test', { lastUsedAgoMs: 20 * DAY, chunks: 50 });
    await seed('stale2.test', { lastUsedAgoMs: 20 * DAY, chunks: 45 });
    expect(await ensureCapacity(db, NOW, small)).toEqual({ ok: true });
    expect(await countAllChunks(db)).toBe(0);
  });

  it('is ok without sweeping when there is room', async () => {
    const small = { ...limits, maxTotalChunks: 100, maxChunksPerAgent: 20 };
    await seed('stale.test', { lastUsedAgoMs: 20 * DAY, chunks: 10 });
    expect(await ensureCapacity(db, NOW, small)).toEqual({ ok: true });
    expect(await getAgentByDomain(db, 'stale.test')).not.toBeNull();
  });

  it('refuses with the spec copy', async () => {
    const small = { ...limits, maxTotalChunks: 100, maxChunksPerAgent: 20 };
    const pinned = await seed('pinned.test', { chunks: 95 });
    await pinAgent(db, pinned);
    const result = await ensureCapacity(db, NOW, small);
    expect(result).toEqual({ ok: false, rail: 'capacity', message: RAIL_COPY.capacity });
    expect(result.ok === false && result.message).toBe('The free demo is full right now — try again tomorrow');
  });
});
