/**
 * The crawl pipeline for one agent: discover → safe fetch → extract → chunk → embed → insert,
 * bounded by the per-agent chunk cap and the global chunk ceiling.
 *
 * A crawl runs in slices, one per function invocation: free-tier embeddings (about 30k tokens a
 * minute) can need longer than one maxDuration. The to-do list of URLs lives on the agent row,
 * so each slice reads pages until its time budget is spent and leaves the agent `crawling`;
 * the next slice (started by a status poll, see `continueCrawl`) picks up the remaining URLs.
 */

import { captureServer } from '@/lib/analytics/server';
import { FIRECRAWL_CONFIG, getLimits, type Limits } from '@/lib/config';
import {
  beginCrawlSlice,
  finishCrawl,
  getAgentById,
  recordCrawledPage,
  saveDiscoveredUrls,
  undoCrawlSlice,
  updateCrawlProgress,
} from '@/lib/db/agents';
import { chunksTableBytes, insertChunksWithinCeiling } from '@/lib/db/chunks';
import { embeddingSizeMismatch, getDb, type Db } from '@/lib/db/client';
import { EmbeddingRateLimitError } from '@/lib/embedding-errors';
import { embedTexts, type EmbedFn } from '@/lib/embeddings';
import { scrapeUrl, type ScrapeResult } from '@/lib/firecrawl';
import { RAIL_COPY, checkRail, embedRailSpent, embedRequestGate } from '@/lib/rails';
import { RETUNING_COPY } from '@/lib/chat/copy';
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
  /** `crawling`: this slice ran out of time with pages left; another slice continues it. */
  status: 'ready' | 'failed' | 'crawling';
  /** Pages this slice stored or gave up on (0: rate limited, or the embedding share is spent). */
  pagesThisSlice: number;
  /** True when this slice stopped because of rate limits or the spent daily embedding share. */
  paused: boolean;
  pagesCrawled: number;
  pagesTotal: number;
  chunkCount: number;
  seconds: number;
}

export const UNREADABLE_COPY =
  "Sammy couldn't read any pages on this site — it may block crawlers or need JavaScript.";
export const CRAWL_ERROR_COPY =
  'Sammy got caught in a riptide while reading this site — hit Repair to try again.';

/** A slice starts no new page this close to maxDuration (240 s of a 300 s invocation). */
const SLICE_STOP_MARGIN_S = 60;
/** Embedding calls still in flight are aborted this long before maxDuration, so the finish always runs. */
const EMBED_STOP_MARGIN_S = 10;
/** A crawl still unfinished after this many slices keeps what it has (guards against a page that kills every slice). */
export const MAX_CRAWL_SLICES = 6;

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

/** Runs one slice of the agent's crawl; a no-op when the agent is not `crawling`. */
export async function runCrawl(agentId: string, deps: CrawlDeps): Promise<CrawlOutcome> {
  const { db, limits } = deps;
  const start = deps.now();
  const deadline = start + (limits.crawlMaxDurationS - SLICE_STOP_MARGIN_S) * 1000;
  // Pages only start before `deadline`; this also stops a page's embeddings that run past it.
  const embedSignal = AbortSignal.timeout((limits.crawlMaxDurationS - EMBED_STOP_MARGIN_S) * 1000);

  let pagesTotal = 0;
  let pagesCrawled = 0;
  let chunkCount = 0;
  let pagesSkipped = 0;
  let pending: string[] = [];
  let crawlStart = start;
  /** Stop taking new pages (time budget or a full agent); pages in flight still finish. */
  let stopped = false;
  /** No room left (per-agent cap or global ceiling): in-flight pages are dropped. */
  let full = false;
  let ceilingReached = false;
  /** Out of slices: finish with what is stored. */
  let exhausted = false;
  /** A crawl-level failure (the agent or discovery); a failed page is only skipped. */
  let failure: unknown = null;
  /** Rate limited (provider 429 or the daily embedding rail): the slice ended early. */
  let paused = false;
  /** Pages this slice stored or gave up on. */
  let pagesThisSlice = 0;
  let sliceState: Awaited<ReturnType<typeof beginCrawlSlice>> = null;
  /** The visitor-facing error for a crawl-level failure (defaults to CRAWL_ERROR_COPY). */
  let failureCopy: string | null = null;

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
      const inserted = await insertChunksWithinCeiling(db, agentId, batch, limits.maxTotalChunks, {
        url,
        pagesCrawled: pagesCrawled + 1,
        pagesSkipped,
        now: new Date(deps.now()),
      });
      chunkCount += inserted;
      pagesCrawled += 1;
      pagesThisSlice += 1;
      pending = pending.filter((u) => u !== url);
      if (inserted < batch.length) ceilingReached = true;
      if (ceilingReached || chunkCount >= limits.maxChunksPerAgent) {
        full = true;
        stopped = true;
      }
    });

  // The row is written first: if that fails, the page stays pending here and in the database,
  // so the slice cannot finish the crawl over it and a later slice retries it.
  const skipPage = (url: string) =>
    serialized(async () => {
      await recordCrawledPage(db, agentId, url, { pagesCrawled, chunkCount, pagesSkipped: pagesSkipped + 1 }, new Date(deps.now()));
      pagesSkipped += 1;
      pagesThisSlice += 1;
      pending = pending.filter((u) => u !== url);
    });

  const crawlPage = async (url: string): Promise<void> => {
    const page = await readPage(url, deps);
    if (full) return;
    const opts = { targetTokens: limits.chunkTargetTokens, overlapTokens: limits.chunkOverlapTokens };
    // Embed only what can still fit under the per-agent cap; storePage trims again in the write queue.
    const chunks = (page ? chunkText(page.text, opts) : []).slice(0, Math.max(0, limits.maxChunksPerAgent - chunkCount));
    const vectors = chunks.length > 0 ? await deps.embed(chunks, 'passage', { signal: embedSignal }) : [];
    if (vectors.length !== chunks.length) throw new Error('Embedding count mismatch');
    await storePage(url, page, chunks, vectors);
  };

  try {
    const agent = await getAgentById(db, agentId);
    if (!agent) throw new Error('Agent not found');
    // Vectors of another size cannot be stored: fail loudly instead of crawling for nothing.
    const mismatch = agent.status === 'crawling' ? await embeddingSizeMismatch(db) : null;
    if (mismatch) {
      // Visitors get generic copy; the sizes and the opt-in stay in the log (and PostHog).
      failureCopy = RETUNING_COPY;
      throw new Error(mismatch);
    }
    // No embeddings left for crawls today: fetch nothing, change nothing.
    if (agent.status === 'crawling' && (await embedRailSpent(db, new Date(start), limits, 'crawl'))) {
      return {
        status: 'crawling',
        pagesCrawled: agent.pagesCrawled,
        pagesTotal: agent.pagesTotal,
        chunkCount: agent.chunkCount,
        seconds: 0,
        pagesThisSlice: 0,
        paused: true,
      };
    }
    const state = await beginCrawlSlice(db, agentId, new Date(start));
    sliceState = state;
    if (!state) {
      // Finished (or reset) between the caller's check and this slice.
      return {
        status: agent.status,
        pagesCrawled: agent.pagesCrawled,
        pagesTotal: agent.pagesTotal,
        chunkCount: agent.chunkCount,
        seconds: 0,
        pagesThisSlice: 0,
        paused: false,
      };
    }
    ({ pagesCrawled, pagesTotal, chunkCount, pagesSkipped } = state);
    crawlStart = state.crawlStartedAt?.getTime() ?? start;
    if (state.pending === null) {
      pending = await discoverUrls(new URL(agent.url), deps.fetcher, limits.maxPagesPerAgent);
      pagesTotal = pending.length;
      await saveDiscoveredUrls(db, agentId, pending, new Date(deps.now()));
    } else {
      pending = state.pending;
    }
    if (state.slices > MAX_CRAWL_SLICES) exhausted = true;

    const queue = exhausted ? [] : [...pending];
    let next = 0;
    const worker = async (): Promise<void> => {
      while (!stopped && next < queue.length) {
        if (deps.now() >= deadline) {
          stopped = true;
          break;
        }
        const url = queue[next++];
        try {
          await crawlPage(url);
        } catch (err) {
          // A page cut off by the end of the slice stays on the to-do list for the next one.
          if (embedSignal.aborted) continue;
          if (err instanceof EmbeddingRateLimitError) {
            // Rate limited after every retry (or the daily embedding rail is spent): keep the
            // page pending and end this slice; a later slice tries again.
            console.warn(`[crawl] ${agentId} paused: ${err.message}`);
            paused = true;
            stopped = true;
            continue;
          }
          // One bad page (a fetch error, an embedding 5xx) must not sink the pages already stored.
          console.error(`[crawl] ${agentId} skipped a page:`, err instanceof Error ? err.message : 'unknown error');
          try {
            await skipPage(url);
          } catch (recordErr) {
            // The page stays pending; the next slice retries it.
            console.error(`[crawl] ${agentId} could not record a skipped page:`, recordErr instanceof Error ? recordErr.message : recordErr);
          }
        }
      }
    };
    const workers = Math.max(1, Math.min(limits.pageFetchConcurrency, queue.length));
    await Promise.all(Array.from({ length: workers }, worker));
    await writeQueue;
  } catch (err) {
    failure ??= err;
  }

  const seconds = Math.round((deps.now() - crawlStart) / 1000);
  const finished = failure !== null || full || exhausted || pending.length === 0;
  if (!finished) {
    // Out of time (or rate limited) with pages left: stay `crawling` for the next slice. A slice
    // that only met rate limits is taken back, so it neither uses up the slice cap nor counts
    // as progress (the sweep's no-progress rule can still end the crawl).
    if (paused && pagesThisSlice === 0 && sliceState) {
      try {
        await undoCrawlSlice(db, agentId, sliceState.previousProgressAt);
      } catch (err) {
        console.error(`[crawl] ${agentId} could not take back an empty slice:`, err instanceof Error ? err.message : err);
      }
    }
    return { status: 'crawling', pagesCrawled, pagesTotal, chunkCount, seconds, pagesThisSlice, paused };
  }

  let status: 'ready' | 'failed';
  let lastError: string | null = null;
  if (failure !== null) {
    status = 'failed';
    lastError = failureCopy ?? CRAWL_ERROR_COPY;
    console.error(`[crawl] ${agentId} failed:`, failure instanceof Error ? failure.message : 'unknown error');
  } else if (chunkCount > 0) {
    status = 'ready';
  } else {
    status = 'failed';
    if (ceilingReached) lastError = RAIL_COPY.capacity;
    else lastError = pagesSkipped > 0 ? CRAWL_ERROR_COPY : UNREADABLE_COPY;
  }

  try {
    await updateCrawlProgress(db, agentId, { pagesCrawled, pagesTotal, chunkCount });
    await finishCrawl(db, agentId, { status, lastError });
  } catch (err) {
    // The row stays `crawling`; the next status poll resumes it and the sweep is the backstop.
    console.error(`[crawl] ${agentId} could not record its result:`, err instanceof Error ? err.message : err);
  }

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

  return { status, pagesCrawled, pagesTotal, chunkCount, seconds, pagesThisSlice, paused };
}

/** Production wiring: guarded fetches, the configured embeddings provider, Firecrawl when configured and under its daily rail. */
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
    embed: (texts, inputType, options) =>
      embedTexts(texts, inputType, { ...options, beforeRequest: embedRequestGate(db, limits, 'crawl') }),
    scrape: FIRECRAWL_CONFIG.IS_ENABLED ? scrapeUrl : null,
    firecrawlAllowed: async () =>
      (await checkRail(db, 'firecrawl_daily', { ip: 'global' }, new Date(), limits)).ok,
    capture: captureServer,
    now: () => Date.now(),
    limits,
  };
}
