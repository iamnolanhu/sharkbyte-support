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
import { runCrawl, type CrawlDeps } from './run-crawl';

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

  it('stops at the time budget', async () => {
    const id = await newAgent('slow.example');
    let clock = NOW.getTime();
    const limits = testLimits({ pageFetchConcurrency: 1 });
    // The first page's embedding call takes the crawl past its deadline.
    const embed: EmbedFn = async (texts, inputType) => {
      clock += limits.crawlMaxDurationS * 1000;
      return fakeEmbed(texts, inputType);
    };
    const deps = makeDeps({
      fetcher: siteFetcher('slow.example', { '/': 1, '/a': 1, '/b': 1 }),
      embed,
      now: () => clock,
      limits,
    });

    const outcome = await runCrawl(id, deps);

    expect(outcome).toMatchObject({ status: 'ready', pagesCrawled: 1, pagesTotal: 3, chunkCount: 1 });
    expect(outcome.seconds).toBe(limits.crawlMaxDurationS);
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
