/**
 * The crawl pipeline for one agent: discover → safe fetch → extract → chunk → embed → insert,
 * bounded by the per-agent chunk cap, the global chunk ceiling and the function's time budget.
 */

import { captureServer } from '@/lib/analytics/server';
import { FIRECRAWL_CONFIG, getLimits, type Limits } from '@/lib/config';
import { finishCrawl, getAgentById, updateCrawlProgress } from '@/lib/db/agents';
import { chunksTableBytes, insertChunksWithinCeiling } from '@/lib/db/chunks';
import { getDb, type Db } from '@/lib/db/client';
import { embedTexts, type EmbedFn } from '@/lib/embeddings';
import { scrapeUrl, type ScrapeResult } from '@/lib/firecrawl';
import { RAIL_COPY, checkRail } from '@/lib/rails';
import type { ChunkInput } from '@/types';
import { chunkText } from './chunk';
import { discoverUrls, type Fetcher } from './discover';
import { extractPage } from './extract';
import { CRAWLER_USER_AGENT, safeFetch } from './safe-fetch';

export interface CrawlDeps {
  db: Db;
  fetcher: Fetcher;
  embed: EmbedFn;
  scrape: ((url: string) => Promise<ScrapeResult>) | null;
  firecrawlAllowed: () => Promise<boolean>;
  capture: typeof captureServer;
  now: () => number;
  limits: Limits;
}

export interface CrawlOutcome {
  status: 'ready' | 'failed';
  pagesCrawled: number;
  pagesTotal: number;
  chunkCount: number;
  seconds: number;
}

export const UNREADABLE_COPY =
  "Sammy couldn't read any pages on this site — it may block crawlers or need JavaScript.";
export const CRAWL_ERROR_COPY =
  'Sammy got caught in a riptide while reading this site — hit Repair to try again.';

/** Seconds kept free before the function's maxDuration to finish up and report. */
const FINISH_MARGIN_S = 20;

interface PageText {
  title: string;
  text: string;
}

/** Fetches and extracts one page; Firecrawl renders it when our fetch got a thin (JS-built) page. */
async function readPage(url: string, deps: CrawlDeps): Promise<PageText | null> {
  const res = await deps.fetcher(url, 'html');
  if (!res) return null;
  const page = extractPage(res.body, res.url);
  if (page.text.length < deps.limits.minPageTextChars && deps.scrape && (await deps.firecrawlAllowed())) {
    const scraped = await deps.scrape(url);
    if (scraped.success && scraped.markdown && scraped.markdown.length > page.text.length) {
      return { title: scraped.title || page.title, text: scraped.markdown };
    }
  }
  return { title: page.title, text: page.text };
}

export async function runCrawl(agentId: string, deps: CrawlDeps): Promise<CrawlOutcome> {
  const { db, limits } = deps;
  const start = deps.now();
  const deadline = start + (limits.crawlMaxDurationS - FINISH_MARGIN_S) * 1000;

  let pagesTotal = 0;
  let pagesCrawled = 0;
  let chunkCount = 0;
  /** Stop taking new pages (time budget, a full agent, or a failure); pages in flight still finish. */
  let stopped = false;
  /** No room left (per-agent cap or global ceiling): in-flight pages are dropped. */
  let full = false;
  let ceilingReached = false;
  let failure: unknown = null;

  // Inserts and progress updates run one at a time, so `pos` and the per-agent cap stay exact.
  let writeQueue: Promise<void> = Promise.resolve();
  const serialized = (task: () => Promise<void>): Promise<void> => {
    const run = writeQueue.then(task);
    writeQueue = run.catch(() => undefined);
    return run;
  };

  const storePage = (url: string, page: PageText | null, chunks: string[], vectors: number[][]) =>
    serialized(async () => {
      if (full) return;
      const room = Math.max(0, limits.maxChunksPerAgent - chunkCount);
      const batch: ChunkInput[] = chunks.slice(0, room).map((content, i) => ({
        url,
        title: page?.title || url,
        pos: chunkCount + i,
        content,
        embedding: vectors[i],
      }));
      const inserted = await insertChunksWithinCeiling(db, agentId, batch, limits.maxTotalChunks);
      chunkCount += inserted;
      pagesCrawled += 1;
      if (inserted < batch.length) ceilingReached = true;
      if (ceilingReached || chunkCount >= limits.maxChunksPerAgent) {
        full = true;
        stopped = true;
      }
      await updateCrawlProgress(db, agentId, { pagesCrawled, pagesTotal, chunkCount });
    });

  const crawlPage = async (url: string): Promise<void> => {
    const page = await readPage(url, deps);
    if (full) return;
    const opts = { targetTokens: limits.chunkTargetTokens, overlapTokens: limits.chunkOverlapTokens };
    // Embed only what can still fit under the per-agent cap; storePage trims again in the write queue.
    const chunks = (page ? chunkText(page.text, opts) : []).slice(0, Math.max(0, limits.maxChunksPerAgent - chunkCount));
    const vectors = chunks.length > 0 ? await deps.embed(chunks, 'passage') : [];
    if (vectors.length !== chunks.length) throw new Error('Embedding count mismatch');
    await storePage(url, page, chunks, vectors);
  };

  try {
    const agent = await getAgentById(db, agentId);
    if (!agent) throw new Error('Agent not found');
    const urls = await discoverUrls(new URL(agent.url), deps.fetcher, limits.maxPagesPerAgent);
    pagesTotal = urls.length;
    await updateCrawlProgress(db, agentId, { pagesCrawled, pagesTotal, chunkCount });

    let next = 0;
    const worker = async (): Promise<void> => {
      while (!stopped && failure === null && next < urls.length) {
        if (deps.now() >= deadline) {
          stopped = true;
          break;
        }
        const url = urls[next++];
        try {
          await crawlPage(url);
        } catch (err) {
          failure ??= err;
          stopped = true;
        }
      }
    };
    const workers = Math.max(1, Math.min(limits.pageFetchConcurrency, urls.length));
    await Promise.all(Array.from({ length: workers }, worker));
  } catch (err) {
    failure ??= err;
  }

  let status: CrawlOutcome['status'];
  let lastError: string | null = null;
  if (failure !== null) {
    status = 'failed';
    lastError = CRAWL_ERROR_COPY;
    console.error(`[crawl] ${agentId} failed:`, failure instanceof Error ? failure.message : 'unknown error');
  } else if (chunkCount > 0) {
    status = 'ready';
  } else {
    status = 'failed';
    lastError = ceilingReached ? RAIL_COPY.capacity : UNREADABLE_COPY;
  }

  try {
    await updateCrawlProgress(db, agentId, { pagesCrawled, pagesTotal, chunkCount });
    await finishCrawl(db, agentId, { status, lastError });
  } catch (err) {
    // The row stays `crawling`; agent-status treats a stale crawl as failed.
    console.error(`[crawl] ${agentId} could not record its result:`, err instanceof Error ? err.message : err);
  }

  const seconds = Math.round((deps.now() - start) / 1000);
  let dbBytes: number | null = null;
  try {
    dbBytes = await chunksTableBytes(db);
  } catch {
    // Size is informational only.
  }
  try {
    await deps.capture('crawl_finished', {
      agentId,
      status,
      pages: pagesCrawled,
      chunks: chunkCount,
      seconds,
      db_bytes: dbBytes,
    });
  } catch {
    // Analytics must never break a crawl.
  }

  return { status, pagesCrawled, pagesTotal, chunkCount, seconds };
}

/** Production wiring: guarded fetches, NVIDIA embeddings, Firecrawl when configured and under its daily rail. */
export function createCrawlDeps(): CrawlDeps {
  const db = getDb();
  const limits = getLimits();
  return {
    db,
    fetcher: (url, accept) =>
      safeFetch(url, {
        timeoutMs: limits.pageFetchTimeoutMs,
        maxBytes: limits.pageMaxBytes,
        accept,
        userAgent: CRAWLER_USER_AGENT,
      }),
    embed: embedTexts,
    scrape: FIRECRAWL_CONFIG.IS_ENABLED ? scrapeUrl : null,
    firecrawlAllowed: async () =>
      (await checkRail(db, 'firecrawl_daily', { ip: 'global' }, new Date(), limits)).ok,
    capture: captureServer,
    now: () => Date.now(),
    limits,
  };
}
