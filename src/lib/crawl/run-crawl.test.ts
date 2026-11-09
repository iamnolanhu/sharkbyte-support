import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLimits, type Limits } from '@/lib/config';
import type { Db } from '@/lib/db/client';
import { getAgentById, insertAgent } from '@/lib/db/agents';
import { countAllChunks, insertChunksWithinCeiling } from '@/lib/db/chunks';
import type { captureServer } from '@/lib/analytics/server';
import type { ScrapeResult } from '@/lib/firecrawl';
import { createTestDb, fakeEmbedding, TEST_DB_TIMEOUT_MS } from '@/test/test-db';
import type { EmbedFn } from '@/lib/embeddings';
import type { Fetcher } from './discover';
import { MAX_CRAWL_SLICES, runCrawl, type CrawlDeps } from './run-crawl';
import { EmbeddingQuotaError, EmbeddingRateLimitError } from '@/lib/embedding-errors';

const NOW = new Date('2026-11-05T10:00:00.000Z');
const CAPACITY_COPY = 'The free demo is full right now — try again tomorrow';

let db: Db;
const globalFetch = vi.fn<typeof fetch>();

beforeEach(async () => {
  db = await createTestDb();
  globalFetch.mockReset();
  // The crawler must only reach the network through its injected fetcher.
  vi.stubGlobal('fetch', globalFetch);
}, TEST_DB_TIMEOUT_MS);

afterEach(() => {
  expect(globalFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

async function newAgent(domain: string): Promise<string> {
  const row = await insertAgent(db, {
    domain,
    url: `https://${domain}/`,
    name: `Sammy - ${domain}`,
    instruction: 'Be nice.',
    ownerTokenHash: null,
    pinned: false,
    now: NOW,
  });
  if (!row) throw new Error('insertAgent returned null');
  return row.id;
}

/** ~300 characters: with chunkTargetTokens 100 (400 chars) every paragraph becomes its own chunk. */
function paragraph(label: string): string {
  return `${label}. ${'Sammy the shark swims past the coral reef. '.repeat(7)}`.trim();
}

function pageHtml(title: string, paragraphs: string[]): string {
  return `<html><head><title>${title}</title></head><body><main>${paragraphs
    .map((p) => `<p>${p}</p>`)
    .join('')}</main></body></html>`;
}

/**
 * An in-memory site: `pages` maps a path to its paragraph count (a number) or raw HTML (a string).
 * Every page is listed in /sitemap.xml.
 */
function siteFetcher(domain: string, pages: Record<string, number | string>): Fetcher {
  const origin = `https://${domain}`;
  const bodies = new Map<string, string>();
  for (const [path, spec] of Object.entries(pages)) {
    const html =
      typeof spec === 'string'
        ? spec
        : pageHtml(`${domain}${path}`, Array.from({ length: spec }, (_, i) => paragraph(`${domain}${path} part ${i}`)));
    bodies.set(`${origin}${path}`, html);
  }
  const sitemap = `<?xml version="1.0"?><urlset>${[...bodies.keys()]
    .map((u) => `<url><loc>${u}</loc></url>`)
    .join('')}</urlset>`;
  return async (url, accept) => {
    if (accept === 'xml') {
      return url === `${origin}/sitemap.xml` ? { url, status: 200, contentType: 'application/xml', body: sitemap } : null;
    }
    const body = bodies.get(url);
    return body === undefined ? null : { url, status: 200, contentType: 'text/html', body };
  };
}

function hashText(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) >>> 0;
  return h;
}

const fakeEmbed: EmbedFn = async (texts) => texts.map((t) => fakeEmbedding(hashText(t)));

function testLimits(overrides: Partial<Limits> = {}): Limits {
  return { ...getLimits({}), chunkTargetTokens: 100, chunkOverlapTokens: 0, ...overrides };
}

function makeDeps(overrides: Partial<CrawlDeps> & { fetcher: Fetcher }): CrawlDeps & {
  capture: ReturnType<typeof vi.fn<typeof captureServer>>;
} {
  const capture = vi.fn<typeof captureServer>().mockResolvedValue(undefined);
  return {
    db,
    embed: fakeEmbed,
    scrape: null,
    firecrawlAllowed: async () => true,
    now: () => NOW.getTime(),
    limits: testLimits(),
    ...overrides,
    capture,
  };
}

async function storedChunks(agentId: string): Promise<{ pos: number; content: string }[]> {
  return db.query<{ pos: number; content: string }>(
    'SELECT pos, content FROM chunks WHERE agent_id = $1 ORDER BY pos',
    [agentId],
  );
}

describe('runCrawl', () => {
  it('crawls a small site to ready', async () => {
    const id = await newAgent('reef.example');
    const deps = makeDeps({ fetcher: siteFetcher('reef.example', { '/': 2, '/a': 2, '/b': 2 }) });

    const outcome = await runCrawl(id, deps);

    expect(outcome).toMatchObject({ status: 'ready', pagesCrawled: 3, pagesTotal: 3, chunkCount: 6 });
    const agent = await getAgentById(db, id);
    expect(agent).toMatchObject({ status: 'ready', pagesCrawled: 3, pagesTotal: 3, chunkCount: 6, lastError: null });
    const rows = await storedChunks(id);
    expect(rows.map((r) => r.pos)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(await countAllChunks(db)).toBe(6);

    expect(deps.capture).toHaveBeenCalledTimes(1);
    const [event, props] = deps.capture.mock.calls[0] ?? [];
    expect(event).toBe('crawl_finished');
    expect(props).toMatchObject({ agentId: id, status: 'ready', pages: 3, chunks: 6 });
    expect(Number(props?.db_bytes)).toBeGreaterThan(0);
    expect(typeof props?.seconds).toBe('number');
  });

  it('stops at maxChunksPerAgent', async () => {
    const id = await newAgent('big.example');
    const embed = vi.fn<EmbedFn>(fakeEmbed);
    const deps = makeDeps({
      fetcher: siteFetcher('big.example', { '/': 5, '/a': 5, '/b': 5, '/c': 5 }),
      embed,
      limits: testLimits({ maxChunksPerAgent: 5 }),
    });

    const outcome = await runCrawl(id, deps);

    expect(outcome.status).toBe('ready');
    expect(outcome.chunkCount).toBe(5);
    expect((await getAgentById(db, id))?.chunkCount).toBe(5);
    expect(await countAllChunks(db)).toBe(5);
  });

  it('truncates the last batch to fit maxChunksPerAgent', async () => {
    const id = await newAgent('trim.example');
    const deps = makeDeps({
      fetcher: siteFetcher('trim.example', { '/': 3, '/a': 3 }),
      limits: testLimits({ maxChunksPerAgent: 4, pageFetchConcurrency: 1 }),
    });

    const outcome = await runCrawl(id, deps);

    expect(outcome).toMatchObject({ status: 'ready', chunkCount: 4 });
    expect((await storedChunks(id)).map((r) => r.pos)).toEqual([0, 1, 2, 3]);
  });

  describe('slices', () => {
    /** An embedder that sleeps: a few real ms, and 100 s on the crawl's clock per call. */
    function sleepyEmbedder(clock: { t: number }): EmbedFn {
      return async (texts, inputType) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        clock.t += 100_000;
        return fakeEmbed(texts, inputType);
      };
    }

    async function pending(agentId: string): Promise<string[] | null> {
      const rows = await db.query<{ crawl_pending: string[] | null }>('SELECT crawl_pending FROM agents WHERE id = $1', [
        agentId,
      ]);
      return rows[0]?.crawl_pending ?? null;
    }

    function countingSite(domain: string, pageCount: number): { fetcher: Fetcher; discoveries: () => number } {
      const pages = Object.fromEntries(Array.from({ length: pageCount }, (_, i) => [i === 0 ? '/' : `/p${i}`, 1]));
      const site = siteFetcher(domain, pages);
      let sitemapFetches = 0;
      const fetcher: Fetcher = async (url, accept) => {
        if (accept === 'xml') sitemapFetches++;
        return site(url, accept);
      };
      return { fetcher, discoveries: () => sitemapFetches };
    }

    it('stops a slice at its time budget and later slices finish the remaining pages', async () => {
      const id = await newAgent('slow.example');
      const clock = { t: NOW.getTime() };
      const site = countingSite('slow.example', 7);
      const deps = makeDeps({
        fetcher: site.fetcher,
        embed: sleepyEmbedder(clock),
        now: () => clock.t,
        limits: testLimits({ pageFetchConcurrency: 1 }),
      });

      // Pages start at 0, 100 and 200 s; at 300 s the 240 s slice budget is spent.
      const first = await runCrawl(id, deps);

      expect(first).toMatchObject({ status: 'crawling', pagesCrawled: 3, pagesTotal: 7, chunkCount: 3 });
      expect(await getAgentById(db, id)).toMatchObject({ status: 'crawling', pagesCrawled: 3, pagesTotal: 7, chunkCount: 3 });
      expect(await pending(id)).toHaveLength(4);
      expect(deps.capture).not.toHaveBeenCalled();

      expect(await runCrawl(id, deps)).toMatchObject({ status: 'crawling', pagesCrawled: 6 });
      const last = await runCrawl(id, deps);

      expect(last).toMatchObject({ status: 'ready', pagesCrawled: 7, pagesTotal: 7, chunkCount: 7 });
      expect(last.seconds).toBe(700);
      expect(await getAgentById(db, id)).toMatchObject({ status: 'ready', chunkCount: 7, lastError: null });
      expect(await pending(id)).toBeNull();
      expect(site.discoveries()).toBe(1);
      expect((await storedChunks(id)).map((r) => r.pos)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(deps.capture).toHaveBeenCalledTimes(1);
      expect(deps.capture.mock.calls[0]?.[1]).toMatchObject({ status: 'ready', pages: 7, chunks: 7 });
    });

    it('concurrent pages across slices: every page stored once, positions contiguous', async () => {
      const id = await newAgent('busy.example');
      const clock = { t: NOW.getTime() };
      const site = countingSite('busy.example', 20);
      const deps = makeDeps({ fetcher: site.fetcher, embed: sleepyEmbedder(clock), now: () => clock.t });

      let outcome = await runCrawl(id, deps);
      let slices = 1;
      expect(outcome.status).toBe('crawling');
      while (outcome.status === 'crawling') {
        outcome = await runCrawl(id, deps);
        slices++;
      }

      expect(outcome).toMatchObject({ status: 'ready', pagesCrawled: 20, pagesTotal: 20, chunkCount: 20 });
      expect(slices).toBeGreaterThan(1);
      expect(slices).toBeLessThanOrEqual(MAX_CRAWL_SLICES);
      expect(site.discoveries()).toBe(1);
      const rows = await storedChunks(id);
      expect(rows.map((r) => r.pos)).toEqual(Array.from({ length: 20 }, (_, i) => i));
      expect(new Set(rows.map((r) => r.content)).size).toBe(20);
    });

    it('a crawl out of slices finishes with what it stored', async () => {
      const id = await newAgent('stuck.example');
      const clock = { t: NOW.getTime() };
      const deps = makeDeps({
        fetcher: siteFetcher('stuck.example', { '/': 1, '/a': 1, '/b': 1, '/c': 1, '/d': 1 }),
        embed: sleepyEmbedder(clock),
        now: () => clock.t,
        limits: testLimits({ pageFetchConcurrency: 1 }),
      });
      expect((await runCrawl(id, deps)).status).toBe('crawling');
      await db.query('UPDATE agents SET crawl_slices = $2 WHERE id = $1', [id, MAX_CRAWL_SLICES]);

      const outcome = await runCrawl(id, deps);

      expect(outcome).toMatchObject({ status: 'ready', pagesCrawled: 3, pagesTotal: 5, chunkCount: 3 });
      expect(await pending(id)).toBeNull();
    });

    it('a rate-limited page stays pending and ends the slice; the next slice stores it', async () => {
      const id = await newAgent('limited.example');
      let limited = true;
      const embed: EmbedFn = async (texts, inputType) => {
        if (limited && texts.some((t) => t.includes('limited.example/a '))) {
          throw new EmbeddingRateLimitError('Gemini embeddings failed with HTTP 429');
        }
        return fakeEmbed(texts, inputType);
      };
      const deps = makeDeps({
        fetcher: siteFetcher('limited.example', { '/': 1, '/a': 1, '/b': 1 }),
        embed,
        limits: testLimits({ pageFetchConcurrency: 1 }),
      });
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const first = await runCrawl(id, deps);

      expect(warned).toHaveBeenCalled();
      warned.mockRestore();
      expect(first).toMatchObject({ status: 'crawling', pagesCrawled: 1, chunkCount: 1 });
      expect(await pending(id)).toEqual(['https://limited.example/a', 'https://limited.example/b']);

      limited = false;
      const second = await runCrawl(id, deps);
      expect(second).toMatchObject({ status: 'ready', pagesCrawled: 3, chunkCount: 3 });
    });

    it('a spent daily embedding rail pauses the crawl the same way', async () => {
      const id = await newAgent('quota.example');
      const deps = makeDeps({
        fetcher: siteFetcher('quota.example', { '/': 1, '/a': 1 }),
        embed: async () => {
          throw new EmbeddingQuotaError('spent');
        },
      });
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const outcome = await runCrawl(id, deps);
      warned.mockRestore();
      expect(outcome.status).toBe('crawling');
      expect(await pending(id)).toHaveLength(2);
      expect((await getAgentById(db, id))?.lastError).toBeNull();
    });

    it('a slice that only met rate limits does not count toward the cap or as progress', async () => {
      const id = await newAgent('paused.example');
      const clock = { t: NOW.getTime() };
      let limited = false;
      const deps = makeDeps({
        fetcher: siteFetcher('paused.example', { '/': 1, '/a': 1, '/b': 1, '/c': 1, '/d': 1 }),
        embed: async (texts, inputType) => {
          if (limited) throw new EmbeddingRateLimitError('Gemini embeddings failed with HTTP 429');
          clock.t += 100_000;
          return fakeEmbed(texts, inputType);
        },
        now: () => clock.t,
        limits: testLimits({ pageFetchConcurrency: 1 }),
      });
      const state = async () =>
        (
          await db.query<{ crawl_slices: number; crawl_progress_at: Date }>(
            'SELECT crawl_slices, crawl_progress_at FROM agents WHERE id = $1',
            [id],
          )
        )[0];

      // A normal slice stores pages: it counts.
      expect((await runCrawl(id, deps)).status).toBe('crawling');
      const afterWork = await state();
      expect(afterWork?.crawl_slices).toBe(1);

      // Every later slice is rate limited before any page finishes: none of them count.
      limited = true;
      const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      for (let i = 0; i < MAX_CRAWL_SLICES + 2; i++) {
        clock.t += 60_000;
        expect((await runCrawl(id, deps)).status).toBe('crawling');
      }
      warned.mockRestore();
      const afterPauses = await state();
      expect(afterPauses?.crawl_slices).toBe(1);
      expect(new Date(afterPauses!.crawl_progress_at).getTime()).toBe(new Date(afterWork!.crawl_progress_at).getTime());

      // Once the limit clears, the crawl finishes all its pages.
      limited = false;
      let outcome = await runCrawl(id, deps);
      while (outcome.status === 'crawling') outcome = await runCrawl(id, deps);
      expect(outcome).toMatchObject({ status: 'ready', pagesCrawled: 5 });
    });

    it('stores each page and takes it off the to-do list together', async () => {
      const id = await newAgent('atomic.example');
      await runCrawl(id, makeDeps({ fetcher: siteFetcher('atomic.example', { '/': 2, '/a': 3 }) }));
      const [row] = await db.query<{ chunk_count: number; pages_crawled: number }>(
        'SELECT chunk_count, pages_crawled FROM agents WHERE id = $1',
        [id],
      );
      expect(row).toEqual({ chunk_count: 5, pages_crawled: 2 });
    });

    it('a slice for an agent that is no longer crawling does nothing', async () => {
      const id = await newAgent('done.example');
      await db.query(`UPDATE agents SET status = 'ready' WHERE id = $1`, [id]);
      const embed = vi.fn<EmbedFn>(fakeEmbed);

      const outcome = await runCrawl(id, makeDeps({ fetcher: siteFetcher('done.example', { '/': 1 }), embed }));

      expect(outcome.status).toBe('ready');
      expect(embed).not.toHaveBeenCalled();
      expect(await countAllChunks(db)).toBe(0);
    });
  });

  it('uses Firecrawl only for thin pages and only when allowed', async () => {
    const thin = pageHtml('Loading', ['Loading…']);
    const markdown = `# Rendered\n\n${paragraph('rendered by firecrawl')}`;
    const scrape = vi.fn(
      async (url: string): Promise<ScrapeResult> => ({ success: true, markdown, title: 'Rendered', url }),
    );

    const allowedId = await newAgent('spa.example');
    const allowed = makeDeps({
      fetcher: siteFetcher('spa.example', { '/': 2, '/app': thin }),
      scrape,
      firecrawlAllowed: vi.fn(async () => true),
    });
    const first = await runCrawl(allowedId, allowed);

    expect(first.status).toBe('ready');
    expect(scrape).toHaveBeenCalledTimes(1);
    expect(scrape).toHaveBeenCalledWith('https://spa.example/app');
    expect((await storedChunks(allowedId)).some((r) => r.content.includes('rendered by firecrawl'))).toBe(true);

    scrape.mockClear();
    const deniedId = await newAgent('spa2.example');
    const denied = makeDeps({
      fetcher: siteFetcher('spa2.example', { '/': 2, '/app': thin }),
      scrape,
      firecrawlAllowed: vi.fn(async () => false),
    });
    const second = await runCrawl(deniedId, denied);

    expect(second.status).toBe('ready');
    expect(scrape).not.toHaveBeenCalled();
    expect(denied.firecrawlAllowed).toHaveBeenCalledTimes(1);
  });

  it('fails with ocean copy when nothing is readable', async () => {
    const id = await newAgent('blocked.example');
    const deps = makeDeps({ fetcher: async () => null });

    const outcome = await runCrawl(id, deps);

    expect(outcome.status).toBe('failed');
    expect(outcome.chunkCount).toBe(0);
    const agent = await getAgentById(db, id);
    expect(agent?.status).toBe('failed');
    expect(agent?.lastError).toMatch(/couldn't read/);
    expect(deps.capture.mock.calls[0]?.[1]).toMatchObject({ status: 'failed', chunks: 0 });
  });

  it('skips a page whose embedding throws and finishes ready with the rest', async () => {
    const id = await newAgent('flaky.example');
    const embed = vi.fn<EmbedFn>(async (texts, inputType) => {
      if (texts.some((t) => t.includes('flaky.example/a '))) throw new Error('NVIDIA embeddings failed with HTTP 500');
      return fakeEmbed(texts, inputType);
    });
    const deps = makeDeps({ fetcher: siteFetcher('flaky.example', { '/': 2, '/a': 2, '/b': 2 }), embed });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const outcome = await runCrawl(id, deps);

    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
    expect(outcome).toMatchObject({ status: 'ready', pagesCrawled: 2, pagesTotal: 3, chunkCount: 4 });
    const agent = await getAgentById(db, id);
    expect(agent).toMatchObject({ status: 'ready', chunkCount: 4, lastError: null });
    expect((await storedChunks(id)).some((r) => r.content.includes('flaky.example/a '))).toBe(false);
  });

  it('gives every embedding call the crawl time-budget signal', async () => {
    const id = await newAgent('timed.example');
    const embed = vi.fn<EmbedFn>(fakeEmbed);

    await runCrawl(id, makeDeps({ fetcher: siteFetcher('timed.example', { '/': 1, '/a': 1 }), embed }));

    expect(embed).toHaveBeenCalledTimes(2);
    for (const call of embed.mock.calls) {
      const signal = call[2]?.signal;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(false);
    }
  });

  it('skips a page whose fetch throws', async () => {
    const id = await newAgent('rocky.example');
    const site = siteFetcher('rocky.example', { '/': 2, '/a': 2 });
    const fetcher: Fetcher = async (url, accept) => {
      if (url === 'https://rocky.example/a') throw new Error('socket hang up');
      return site(url, accept);
    };
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const outcome = await runCrawl(id, makeDeps({ fetcher }));

    logged.mockRestore();
    expect(outcome).toMatchObject({ status: 'ready', pagesCrawled: 1, chunkCount: 2 });
  });

  it('marks failed when embedding throws', async () => {
    const id = await newAgent('broken.example');
    const deps = makeDeps({
      fetcher: siteFetcher('broken.example', { '/': 2, '/a': 2 }),
      embed: async () => {
        throw new Error('NVIDIA embeddings failed: 500 internal-detail');
      },
    });

    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const outcome = await runCrawl(id, deps);

    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
    expect(outcome.status).toBe('failed');
    const agent = await getAgentById(db, id);
    expect(agent?.status).toBe('failed');
    expect(agent?.lastError).toBeTruthy();
    expect(agent?.lastError).not.toMatch(/NVIDIA|500|internal-detail/);
    expect(deps.capture.mock.calls[0]?.[1]).toMatchObject({ status: 'failed' });
  });

  it('two concurrent crawls near the ceiling never exceed it', async () => {
    const limits = testLimits({ maxTotalChunks: 50 });
    const filler = await newAgent('filler.example');
    await insertChunksWithinCeiling(
      db,
      filler,
      Array.from({ length: 10 }, (_, i) => ({
        url: 'https://filler.example/',
        title: 'Filler',
        pos: i,
        content: `filler ${i}`,
        embedding: fakeEmbedding(i),
      })),
      limits.maxTotalChunks,
    );
    const a = await newAgent('alpha.example');
    const b = await newAgent('beta.example');
    const pages = { '/': 10, '/a': 10, '/b': 10, '/c': 10 };

    const [outA, outB] = await Promise.all([
      runCrawl(a, makeDeps({ fetcher: siteFetcher('alpha.example', pages), limits })),
      runCrawl(b, makeDeps({ fetcher: siteFetcher('beta.example', pages), limits })),
    ]);

    expect(await countAllChunks(db)).toBe(50);
    expect(outA.status).toBe('ready');
    expect(outB.status).toBe('ready');
    expect(outA.chunkCount + outB.chunkCount).toBe(40);
    expect((await storedChunks(a)).length).toBe(outA.chunkCount);
    expect((await storedChunks(b)).length).toBe(outB.chunkCount);
    expect((await getAgentById(db, a))?.chunkCount).toBe(outA.chunkCount);
  });

  it('fails loudly when stored vectors have another size than EMBEDDING_DIMS', async () => {
    const id = await newAgent('sized.example');
    vi.stubEnv('EMBEDDING_DIMS', '1536');
    const embed = vi.fn<EmbedFn>(fakeEmbed);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const outcome = await runCrawl(id, makeDeps({ fetcher: siteFetcher('sized.example', { '/': 1 }), embed }));

    expect(logged).toHaveBeenCalledWith(expect.stringContaining('failed'), expect.stringContaining('EMBEDDING_DIMS_MIGRATE=1'));
    logged.mockRestore();
    vi.unstubAllEnvs();
    expect(outcome.status).toBe('failed');
    expect(embed).not.toHaveBeenCalled();
  });

  it('a crawl that starts at the ceiling fails with the full-demo copy', async () => {
    const limits = testLimits({ maxTotalChunks: 10 });
    const filler = await newAgent('filler.example');
    await insertChunksWithinCeiling(
      db,
      filler,
      Array.from({ length: 10 }, (_, i) => ({
        url: 'https://filler.example/',
        title: 'Filler',
        pos: i,
        content: `filler ${i}`,
        embedding: fakeEmbedding(i),
      })),
      limits.maxTotalChunks,
    );
    const id = await newAgent('late.example');

    const outcome = await runCrawl(id, makeDeps({ fetcher: siteFetcher('late.example', { '/': 2, '/a': 2 }), limits }));

    expect(outcome.status).toBe('failed');
    expect(outcome.chunkCount).toBe(0);
    expect((await getAgentById(db, id))?.lastError).toBe(CAPACITY_COPY);
    expect(await countAllChunks(db)).toBe(10);
  });
});
