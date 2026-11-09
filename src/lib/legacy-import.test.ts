import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_INSTRUCTION, getLimits, LEGACY_DEFAULT_INSTRUCTION } from '@/lib/config';
import type { Db } from '@/lib/db/client';
import { finishCrawl, getAgentByDomain, getAgentById, insertAgent, replaceUnownedWithId } from '@/lib/db/agents';
import { countAllChunks, insertChunksWithinCeiling } from '@/lib/db/chunks';
import { releaseCrawlLock, tryLockCrawl } from '@/lib/crawl/start-crawl';
import { runCrawl, type CrawlOutcome } from '@/lib/crawl/run-crawl';
import { createTestDb, fakeEmbedding, TEST_DB_TIMEOUT_MS } from '@/test/test-db';
import {
  importLegacyAgents as importWithSummary,
  mapLegacyAgent,
  parseLegacyExport,
  type ImportOptions,
  type ImportResult,
  type LegacyAgent,
  EMBED_LIMIT_PAUSE,
  NO_PROGRESS_PAUSE,
} from './legacy-import';
import { incrementQuota } from '@/lib/db/quota';
import { railKey } from '@/lib/rails';

/** The per-agent results of an import (the summary's `stopped` is asserted separately). */
async function importLegacyAgents(db: Db, agents: readonly LegacyAgent[], opts: ImportOptions): Promise<ImportResult[]> {
  return (await importWithSummary(db, agents, opts)).results;
}

vi.mock('@/lib/crawl/run-crawl', () => ({ runCrawl: vi.fn(), createCrawlDeps: vi.fn(() => ({})) }));

const NOW = new Date('2026-11-05T10:00:00.000Z');
const limits = getLimits({});
const crawl = vi.mocked(runCrawl);

const ID_A = '11111111-aaaa-11f1-8000-000000000001';
const ID_B = '22222222-bbbb-11f1-8000-000000000002';
const ID_C = '33333333-cccc-11f1-8000-000000000003';

function legacy(over: Partial<LegacyAgent> & { uuid: string; domain: string }): LegacyAgent {
  return {
    name: `Sammy - ${over.domain}`,
    instruction: 'Be kind to sailors.',
    createdAt: '2025-12-01T00:00:00.000Z',
    baseUrl: `https://${over.domain}/docs`,
    ...over,
  };
}

const outcome: CrawlOutcome = {
  status: 'ready',
  pagesCrawled: 3,
  pagesTotal: 3,
  chunkCount: 9,
  seconds: 1,
  pagesThisSlice: 3,
  paused: false,
};

let db: Db;
beforeEach(async () => {
  crawl.mockReset();
  crawl.mockResolvedValue(outcome);
  db = await createTestDb();
}, TEST_DB_TIMEOUT_MS);

describe('parseLegacyExport', () => {
  it('reads the fields it needs and prefers the first knowledge base url', () => {
    const agents = parseLegacyExport({
      agents: [
        {
          uuid: ID_A,
          name: 'Sammy - shells.example',
          domain: 'shells.example',
          instruction: 'hi',
          createdAt: '2025-12-01T00:00:00Z',
          knowledgeBases: [{ baseUrl: 'https://shells.example/help' }],
        },
      ],
    });
    expect(agents).toEqual([
      {
        uuid: ID_A,
        name: 'Sammy - shells.example',
        domain: 'shells.example',
        instruction: 'hi',
        createdAt: '2025-12-01T00:00:00Z',
        baseUrl: 'https://shells.example/help',
      },
    ]);
  });

  it('rejects malformed input with a clear error', () => {
    expect(() => parseLegacyExport(null)).toThrow(/agents/);
    expect(() => parseLegacyExport({})).toThrow(/agents/);
    expect(() => parseLegacyExport({ agents: [{ name: 'x', domain: 'a.example' }] })).toThrow(/agents\[0\]\.uuid/);
    expect(() => parseLegacyExport({ agents: [{ uuid: 'nope', name: 'x', domain: 'a.example' }] })).toThrow(/uuid/);
    expect(() => parseLegacyExport({ agents: [{ uuid: ID_A, name: 'x' }] })).toThrow(/agents\[0\]\.domain/);
  });
});

describe('mapLegacyAgent', () => {
  it('keeps the uuid, name and instruction, with no owner and a crawling start', () => {
    const m = mapLegacyAgent(legacy({ uuid: ID_A, domain: 'shells.example' }), NOW, limits);
    expect(m).toMatchObject({
      id: ID_A,
      name: 'Sammy - shells.example',
      instruction: 'Be kind to sailors.',
      ownerTokenHash: null,
      pinned: false,
      domain: 'shells.example',
      createdAt: new Date('2025-12-01T00:00:00.000Z'),
      now: NOW,
    });
  });

  it('takes the url from the knowledge base and strips www. from the domain', () => {
    const m = mapLegacyAgent(
      legacy({ uuid: ID_A, domain: 'www.reef.example', baseUrl: 'https://www.reef.example/start' }),
      NOW,
      limits,
    );
    expect(m.url).toBe('https://www.reef.example/start');
    expect(m.domain).toBe('reef.example');
  });

  it('falls back to https://<domain> without a knowledge base', () => {
    const m = mapLegacyAgent(legacy({ uuid: ID_A, domain: 'tide.example', baseUrl: undefined }), NOW, limits);
    expect(m.url).toBe('https://tide.example/');
  });

  it('moves the DigitalOcean-era default instruction to the current default', () => {
    const mapped = mapLegacyAgent(
      legacy({ uuid: ID_A, domain: 'tide.example', instruction: LEGACY_DEFAULT_INSTRUCTION('tide.example') }),
      NOW,
      limits,
    );
    expect(mapped.instruction).toBe(DEFAULT_INSTRUCTION('tide.example'));
  });

  it('uses the default instruction when empty and caps long ones', () => {
    const empty = mapLegacyAgent(legacy({ uuid: ID_A, domain: 'tide.example', instruction: '  ' }), NOW, limits);
    expect(empty.instruction).toBe(DEFAULT_INSTRUCTION('tide.example'));
    const long = mapLegacyAgent(
      legacy({ uuid: ID_A, domain: 'tide.example', instruction: 'x'.repeat(limits.maxInstructionChars + 50) }),
      NOW,
      limits,
    );
    expect(long.instruction).toHaveLength(limits.maxInstructionChars);
  });

  it('uses now when createdAt is missing or unparseable', () => {
    expect(mapLegacyAgent(legacy({ uuid: ID_A, domain: 'a.example', createdAt: 'garbage' }), NOW, limits).createdAt).toEqual(NOW);
    expect(mapLegacyAgent(legacy({ uuid: ID_A, domain: 'a.example', createdAt: undefined }), NOW, limits).createdAt).toEqual(NOW);
  });

  it('pins exactly the three demo domains', () => {
    const domains = [
      'sharkbyte-support.vercel.app',
      'sigmasynapses.com',
      'globelanguage.com',
      'dev.nolanhu.com',
      'www.sigmasynapses.com',
      'other.example',
      'nolanhu.com',
    ];
    const pinned = domains
      .filter((d) => mapLegacyAgent(legacy({ uuid: ID_A, domain: d, baseUrl: undefined }), NOW, limits).pinned)
      .sort();
    expect(pinned).toEqual([
      'dev.nolanhu.com',
      'sharkbyte-support.vercel.app',
      'sigmasynapses.com',
      'www.sigmasynapses.com',
    ]);
  });
});

describe('importLegacyAgents', () => {
  const opts = { now: NOW, limits, crawl: false };

  it('inserts with the original id, crawling, read-only', async () => {
    const [r] = await importLegacyAgents(db, [legacy({ uuid: ID_A, domain: 'shells.example' })], opts);
    expect(r).toMatchObject({ action: 'inserted', id: ID_A, domain: 'shells.example', crawl: null });
    const row = await getAgentById(db, ID_A);
    expect(row).toMatchObject({ status: 'crawling', ownerTokenHash: null, pinned: false });
    expect(row?.lastUsedAt).toEqual(NOW);
    expect(row?.crawlStartedAt).toEqual(NOW);
    expect(row?.createdAt).toEqual(new Date('2025-12-01T00:00:00.000Z'));
  });

  it('is idempotent: importing twice inserts once', async () => {
    const agents = [legacy({ uuid: ID_A, domain: 'shells.example' })];
    await importLegacyAgents(db, agents, opts);
    await finishCrawl(db, ID_A, { status: 'ready', lastError: null });
    const second = await importLegacyAgents(db, agents, { ...opts, crawl: true });
    expect(second[0].action).toBe('exists');
    expect(crawl).not.toHaveBeenCalled();
    expect(await db.query('SELECT id FROM agents')).toHaveLength(1);
  });

  it('after the sweep: re-crawls a stale-failed row, resumes a partial ready one, leaves a finished one', async () => {
    const all = [
      legacy({ uuid: ID_A, domain: 'a.example' }),
      legacy({ uuid: ID_B, domain: 'b.example' }),
      legacy({ uuid: ID_C, domain: 'c.example' }),
    ];
    await importLegacyAgents(db, all, opts);
    await finishCrawl(db, ID_A, { status: 'failed', lastError: 'Sammy ran out of air mid-dive — press Repair to try again.' });
    await insertChunksWithinCeiling(
      db,
      ID_B,
      [{ url: 'https://b.example', title: 't', pos: 0, content: 'kept', embedding: fakeEmbedding(1) }],
      limits.maxTotalChunks,
    );
    await db.query(`UPDATE agents SET status = 'ready', chunk_count = 1, crawl_pending = ARRAY['https://b.example/next'] WHERE id = $1`, [ID_B]);
    await finishCrawl(db, ID_C, { status: 'ready', lastError: null });
    const statusAtCrawl: Record<string, string> = {};
    crawl.mockImplementation(async (id) => {
      statusAtCrawl[id] = String((await getAgentById(db, id))?.status);
      return outcome;
    });

    const results = await importLegacyAgents(db, all, { ...opts, crawl: true });

    expect(results.map((r) => r.action)).toEqual(['recrawled', 'resumed', 'exists']);
    // Both are crawling when their slice runs; the resumed one keeps its stored page.
    expect(statusAtCrawl).toEqual({ [ID_A]: 'crawling', [ID_B]: 'crawling' });
    expect(await countAllChunks(db)).toBe(1);
  });

  it('resumes an unowned row left crawling, without resetting it', async () => {
    const agents = [legacy({ uuid: ID_A, domain: 'shells.example' })];
    await importLegacyAgents(db, agents, opts);
    await insertChunksWithinCeiling(
      db,
      ID_A,
      [{ url: 'https://shells.example', title: 't', pos: 0, content: 'kept', embedding: fakeEmbedding(1) }],
      limits.maxTotalChunks,
    );
    const [r] = await importLegacyAgents(db, agents, { ...opts, crawl: true });
    expect(r).toMatchObject({ action: 'resumed', crawl: outcome });
    expect(await countAllChunks(db)).toBe(1);
  });

  it('stops the whole run, crawling nothing, once crawls spent their embedding share', async () => {
    const now = new Date();
    await incrementQuota(db, railKey('embed_daily', 'global', now), 675, new Date(now.getTime() + 86_400_000), now);
    const summary = await importWithSummary(
      db,
      [legacy({ uuid: ID_A, domain: 'a.example' }), legacy({ uuid: ID_B, domain: 'b.example' })],
      { ...opts, crawl: true },
    );
    expect(summary.stopped).toBe(EMBED_LIMIT_PAUSE);
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]).toMatchObject({ domain: 'a.example', crawlError: EMBED_LIMIT_PAUSE });
    expect(crawl).not.toHaveBeenCalled();
    // The row waits as `crawling` for the re-run after midnight UTC.
    expect((await getAgentById(db, ID_A))?.status).toBe('crawling');
  });

  it('stops the run when the share runs out mid-crawl, and pauses a crawl whose slice added no pages', async () => {
    const now = new Date();
    crawl.mockImplementationOnce(async () => {
      await incrementQuota(db, railKey('embed_daily', 'global', now), 675, new Date(now.getTime() + 86_400_000), now);
      return { ...outcome, status: 'crawling', pagesThisSlice: 2 };
    });
    const summary = await importWithSummary(
      db,
      [legacy({ uuid: ID_A, domain: 'a.example' }), legacy({ uuid: ID_B, domain: 'b.example' })],
      { ...opts, crawl: true },
    );
    expect(summary.stopped).toBe(EMBED_LIMIT_PAUSE);
    expect(crawl).toHaveBeenCalledTimes(1);

    crawl.mockReset();
    await db.query('DELETE FROM quota');
    crawl.mockResolvedValue({ ...outcome, status: 'crawling', pagesThisSlice: 0, paused: true });
    const [r] = await importLegacyAgents(db, [legacy({ uuid: ID_C, domain: 'c.example' })], { ...opts, crawl: true });
    expect(r.crawlError).toBe(NO_PROGRESS_PAUSE);
    // No loop: one slice, then the pause.
    expect(crawl).toHaveBeenCalledTimes(1);
  });

  it('locks each agent at the current time, not the run\'s start time', async () => {
    const stale = new Date(Date.now() - 60 * 60 * 1000);
    crawl.mockImplementationOnce(async (id) => {
      // Held right now, though the run started an hour ago (past the lock lifetime).
      expect(await tryLockCrawl(db, id, new Date(), limits)).toBe(false);
      return outcome;
    });
    const [r] = await importLegacyAgents(db, [legacy({ uuid: ID_A, domain: 'a.example' })], {
      ...opts,
      now: stale,
      crawl: true,
    });
    expect(r.crawl).toEqual(outcome);
  });

  it('replaces an unowned row on the same domain, keeping nothing of it', async () => {
    const demo = await insertAgent(db, {
      domain: 'sigmasynapses.com',
      url: 'https://sigmasynapses.com',
      name: 'auto demo',
      instruction: '',
      ownerTokenHash: null,
      pinned: true,
      now: NOW,
    });
    const [r] = await importLegacyAgents(db, [legacy({ uuid: ID_B, domain: 'sigmasynapses.com' })], opts);
    expect(r.action).toBe('replaced');
    expect(await getAgentById(db, demo!.id)).toBeNull();
    expect(await getAgentById(db, ID_B)).toMatchObject({ domain: 'sigmasynapses.com', pinned: true });
  });

  it('keeps an owned row on the same domain and reports a conflict', async () => {
    const owned = await insertAgent(db, {
      domain: 'shells.example',
      url: 'https://shells.example',
      name: 'mine',
      instruction: '',
      ownerTokenHash: 'hash',
      pinned: false,
      now: NOW,
    });
    const [r] = await importLegacyAgents(db, [legacy({ uuid: ID_C, domain: 'shells.example' })], { ...opts, crawl: true });
    expect(r.action).toBe('conflict');
    expect(r.note).toMatch(/owned row kept/);
    expect(await getAgentByDomain(db, 'shells.example')).toMatchObject({ id: owned!.id });
    expect(await getAgentById(db, ID_C)).toBeNull();
    expect(crawl).not.toHaveBeenCalled();
  });

  it('dry-run writes nothing but reports what would happen', async () => {
    const [r] = await importLegacyAgents(db, [legacy({ uuid: ID_A, domain: 'shells.example' })], {
      ...opts,
      crawl: true,
      dryRun: true,
    });
    expect(r.action).toBe('inserted');
    expect(await db.query('SELECT id FROM agents')).toHaveLength(0);
    expect(crawl).not.toHaveBeenCalled();
  });

  it('crawls each new agent once, one at a time, releasing the lock', async () => {
    let running = 0;
    let maxRunning = 0;
    crawl.mockImplementation(async (agentId) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      // The lock is held while the crawl runs.
      expect(await tryLockCrawl(db, agentId, NOW, limits)).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return outcome;
    });
    const results = await importLegacyAgents(
      db,
      [legacy({ uuid: ID_A, domain: 'a.example' }), legacy({ uuid: ID_B, domain: 'b.example' })],
      { ...opts, crawl: true },
    );
    expect(crawl).toHaveBeenCalledTimes(2);
    expect(maxRunning).toBe(1);
    expect(results.map((r) => r.crawl)).toEqual([outcome, outcome]);
    // Lock was released: it can be taken again.
    expect(await tryLockCrawl(db, ID_A, NOW, limits)).toBe(true);
    await releaseCrawlLock(db, ID_A);
  });

  it('never imports a domain on the skip list, even on a re-run', async () => {
    const results = await importLegacyAgents(
      db,
      [
        legacy({ uuid: ID_A, domain: 'globelanguage.com' }),
        legacy({ uuid: ID_B, domain: 'aria.gov.uk' }),
        legacy({ uuid: ID_C, domain: 'aria.org.uk' }),
      ],
      { ...opts, crawl: true },
    );
    expect(results.map((r) => [r.domain, r.action])).toEqual([
      ['globelanguage.com', 'skipped'],
      ['aria.gov.uk', 'skipped'],
      ['aria.org.uk', 'inserted'],
    ]);
    expect(await getAgentById(db, ID_A)).toBeNull();
    expect(await getAgentById(db, ID_B)).toBeNull();
    expect(crawl).toHaveBeenCalledTimes(1);
  });

  it('re-crawls an existing unowned failed row (after an embedding migration), slice after slice', async () => {
    await importLegacyAgents(db, [legacy({ uuid: ID_A, domain: 'a.example' })], opts);
    await insertChunksWithinCeiling(
      db,
      ID_A,
      [{ url: 'https://a.example', title: 't', pos: 0, content: 'old', embedding: fakeEmbedding(1) }],
      limits.maxTotalChunks,
    );
    await finishCrawl(db, ID_A, { status: 'failed', lastError: 're-embedding required' });
    const statusesSeen: string[] = [];
    crawl
      .mockImplementationOnce(async (id) => {
        statusesSeen.push(String((await getAgentById(db, id))?.status));
        return { ...outcome, status: 'crawling' };
      })
      .mockImplementationOnce(async (id) => {
        // The lock was renewed for this slice and is still held.
        expect(await tryLockCrawl(db, id, NOW, limits)).toBe(false);
        return outcome;
      });

    const [r] = await importLegacyAgents(db, [legacy({ uuid: ID_A, domain: 'a.example' })], { ...opts, crawl: true });

    expect(r).toMatchObject({ action: 'recrawled', crawl: outcome });
    expect(crawl).toHaveBeenCalledTimes(2);
    // Reset before the first slice: crawling again, old chunks gone.
    expect(statusesSeen).toEqual(['crawling']);
    expect(await countAllChunks(db)).toBe(0);
    expect(await tryLockCrawl(db, ID_A, NOW, limits)).toBe(true);
  });

  it('leaves ready rows, owned rows and rows that failed for another reason alone', async () => {
    const all = [
      legacy({ uuid: ID_A, domain: 'a.example' }),
      legacy({ uuid: ID_B, domain: 'b.example' }),
      legacy({ uuid: ID_C, domain: 'c.example' }),
    ];
    await importLegacyAgents(db, all, opts);
    await finishCrawl(db, ID_A, { status: 'ready', lastError: null });
    await finishCrawl(db, ID_B, { status: 'failed', lastError: 're-embedding required' });
    await db.query(`UPDATE agents SET owner_token_hash = 'hash' WHERE id = $1`, [ID_B]);
    await finishCrawl(db, ID_C, { status: 'failed', lastError: "Sammy couldn't read any pages" });

    const results = await importLegacyAgents(db, all, { ...opts, crawl: true });

    expect(results.map((r) => r.action)).toEqual(['exists', 'exists', 'exists']);
    expect(crawl).not.toHaveBeenCalled();
  });

  it('releases the lock and records the error when a crawl throws', async () => {
    crawl.mockRejectedValueOnce(new Error('boom'));
    const [r] = await importLegacyAgents(db, [legacy({ uuid: ID_A, domain: 'a.example' })], { ...opts, crawl: true });
    expect(r.crawlError).toBe('boom');
    expect(await tryLockCrawl(db, ID_A, NOW, limits)).toBe(true);
  });

  it('stops crawling with a clear note when capacity refuses', async () => {
    const tight = { ...limits, maxTotalChunks: 1 };
    // Capacity needs a full agent's worth of room; with maxChunksPerAgent > maxTotalChunks it never fits.
    const seen: ImportResult[] = [];
    const summary = await importWithSummary(
      db,
      [legacy({ uuid: ID_A, domain: 'a.example' }), legacy({ uuid: ID_B, domain: 'b.example' })],
      { now: NOW, limits: tight, crawl: true, onResult: (r) => seen.push(r) },
    );
    expect(summary.stopped).toMatch(/no room left/);
    expect(summary.results).toEqual([]);
    expect(seen).toEqual([]);
    expect(crawl).not.toHaveBeenCalled();
    expect(await db.query('SELECT id FROM agents')).toHaveLength(0);
  });

  it('reports each result through onResult as it completes', async () => {
    const seen: string[] = [];
    await importLegacyAgents(db, [legacy({ uuid: ID_A, domain: 'a.example' }), legacy({ uuid: ID_B, domain: 'b.example' })], {
      ...opts,
      onResult: (r) => seen.push(r.domain),
    });
    expect(seen).toEqual(['a.example', 'b.example']);
  });

  it('removes the replaced row chunks with it', async () => {
    const demo = await insertAgent(db, {
      domain: 'sigmasynapses.com',
      url: 'https://sigmasynapses.com',
      name: 'auto demo',
      instruction: '',
      ownerTokenHash: null,
      pinned: true,
      now: NOW,
    });
    await insertChunksWithinCeiling(
      db,
      demo!.id,
      [{ url: 'https://sigmasynapses.com', title: 't', pos: 0, content: 'c', embedding: fakeEmbedding(1) }],
      limits.maxTotalChunks,
    );
    expect(await countAllChunks(db)).toBe(1);
    await importLegacyAgents(db, [legacy({ uuid: ID_B, domain: 'sigmasynapses.com' })], opts);
    expect(await countAllChunks(db)).toBe(0);
  });
});

describe('replaceUnownedWithId', () => {
  const input = {
    id: ID_B,
    domain: 'shells.example',
    url: 'https://shells.example/',
    name: 'legacy',
    instruction: 'x',
    ownerTokenHash: null,
    pinned: false,
    createdAt: NOW,
    now: NOW,
  };

  it('never deletes an owned row, even when called directly', async () => {
    const owned = await insertAgent(db, { ...input, name: 'mine', ownerTokenHash: 'hash' });
    expect(await replaceUnownedWithId(db, input)).toBeNull();
    expect(await getAgentById(db, owned!.id)).toMatchObject({ name: 'mine', ownerTokenHash: 'hash' });
    expect(await getAgentById(db, ID_B)).toBeNull();
  });

  it('replaces an unowned row atomically', async () => {
    const old = await insertAgent(db, { ...input, name: 'old' });
    const row = await replaceUnownedWithId(db, input);
    expect(row).toMatchObject({ id: ID_B, name: 'legacy' });
    expect(await getAgentById(db, old!.id)).toBeNull();
  });
});
