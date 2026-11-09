/**
 * Imports the agents of the retired DigitalOcean build into the Postgres backend, keeping their
 * original ids so old embed snippets and links keep resolving. The CLI is `scripts/import-legacy-agents.ts`.
 */

import { DEFAULT_INSTRUCTION, type Limits } from '@/lib/config';
import { createCrawlDeps, runCrawl, type CrawlOutcome } from '@/lib/crawl/run-crawl';
import { releaseCrawlLock, renewCrawlLock, tryLockCrawl } from '@/lib/crawl/start-crawl';
import { domainKey, normalizeSubmittedUrl } from '@/lib/crawl/url-guard';
import type { Db } from '@/lib/db/client';
import {
  getAgentByDomain,
  getAgentById,
  insertAgentWithId,
  isUuid,
  hasPendingPages,
  reopenCrawl,
  replaceUnownedWithId,
  resetForCrawl,
  type AgentWithIdInput,
} from '@/lib/db/agents';
import { REEMBED_REQUIRED_ERROR } from '@/lib/db/schema';
import { embedRailSpent } from '@/lib/rails';
import { ensureCapacity, STALE_CRAWL_ERROR } from '@/lib/sweep';

/** The fields of an exported agent that the import uses. */
export interface LegacyAgent {
  uuid: string;
  name: string;
  domain: string;
  instruction?: string;
  createdAt?: string;
  /** `baseUrl` of the agent's first knowledge base. */
  baseUrl?: string;
}

/** Domains (by `domainKey`) that stay pinned: the site's demo agent and the showcase sites. */
const PINNED_DOMAINS: ReadonlySet<string> = new Set([
  'sharkbyte-support.vercel.app',
  'sigmasynapses.com',
  'dev.nolanhu.com',
]);

/**
 * Domains (by `domainKey`) the import never creates, so a re-run cannot bring them back:
 * globelanguage.com was deleted on purpose; aria.gov.uk failed on DigitalOcean and here.
 */
export const SKIP_DOMAINS: ReadonlySet<string> = new Set(['globelanguage.com', 'aria.gov.uk']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function optionalString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function parseAgent(raw: unknown, index: number): LegacyAgent {
  const at = `agents[${index}]`;
  if (!isRecord(raw)) throw new Error(`${at} is not an object`);
  const { uuid, name, domain } = raw;
  if (typeof uuid !== 'string' || !isUuid(uuid)) throw new Error(`${at}.uuid is missing or not a UUID`);
  if (typeof name !== 'string' || !name.trim()) throw new Error(`${at}.name is missing`);
  if (typeof domain !== 'string' || !domain.trim()) throw new Error(`${at}.domain is missing`);
  const firstKb = Array.isArray(raw.knowledgeBases) ? raw.knowledgeBases[0] : undefined;
  return {
    uuid,
    name,
    domain,
    instruction: optionalString(raw.instruction),
    createdAt: optionalString(raw.createdAt),
    baseUrl: isRecord(firstKb) ? optionalString(firstKb.baseUrl) : undefined,
  };
}

/** Validates the export JSON (`{ agents: [...] }`) and returns the fields the import needs. */
export function parseLegacyExport(json: unknown): LegacyAgent[] {
  if (!isRecord(json) || !Array.isArray(json.agents)) {
    throw new Error('Not a legacy export: expected an object with an "agents" array');
  }
  return json.agents.map(parseAgent);
}

/** Maps one exported agent to the row to insert; throws UnsafeUrlError when its address is unusable. */
export function mapLegacyAgent(agent: LegacyAgent, now: Date, limits: Limits): AgentWithIdInput {
  const url = normalizeSubmittedUrl(agent.baseUrl?.trim() || `https://${agent.domain.trim()}`);
  const domain = domainKey(url);
  const created = agent.createdAt ? new Date(agent.createdAt) : null;
  const instruction = agent.instruction?.trim()
    ? agent.instruction.slice(0, limits.maxInstructionChars)
    : DEFAULT_INSTRUCTION(domain);
  return {
    id: agent.uuid,
    domain,
    url: url.toString(),
    name: agent.name,
    instruction,
    ownerTokenHash: null,
    pinned: PINNED_DOMAINS.has(domain),
    createdAt: created && !Number.isNaN(created.getTime()) ? created : now,
    now,
  };
}

/**
 * `recrawled`: the row already existed, unowned and emptied by an embedding migration, and was
 * crawled again from scratch. `resumed`: an unowned row left `crawling` (e.g. by a paused
 * import) was crawled on from where it stopped.
 */
export type ImportAction = 'inserted' | 'replaced' | 'recrawled' | 'resumed' | 'exists' | 'skipped' | 'conflict';

/** Crawl error (and run stop) when crawls have spent their share of today's embeddings. */
export const EMBED_LIMIT_PAUSE = 'paused: daily embedding limit spent, re-run after 00:00 UTC';
/** Crawl error when a slice added no pages (rate limited); the crawl stays `crawling` for a re-run. */
export const NO_PROGRESS_PAUSE = 'paused: a slice added no pages (rate limited), re-run later';

export interface ImportResult {
  id: string;
  domain: string;
  action: ImportAction;
  note?: string;
  /** Set when the agent was crawled. */
  crawl: CrawlOutcome | null;
  /** Set when the crawl was refused or threw. */
  crawlError?: string;
}

export interface ImportOptions {
  now: Date;
  limits: Limits;
  /** Crawl each inserted or replaced agent, one after another. */
  crawl: boolean;
  /** Report what would happen without writing or crawling. */
  dryRun?: boolean;
  /** Called with each agent's result as soon as it is final. */
  onResult?: (result: ImportResult) => void;
}

export interface ImportSummary {
  results: ImportResult[];
  /** Set when the run stopped early (capacity refused); later agents were neither inserted nor crawled. */
  stopped: string | null;
}

/** Decides and (unless dry-run) performs the write; `stopped` is set when `guard` refuses a write. */
async function place(
  db: Db,
  input: AgentWithIdInput,
  dryRun: boolean,
  guard: () => Promise<string | null>,
): Promise<{ action: ImportAction; note?: string; wrote: boolean; stopped?: string }> {
  if (SKIP_DOMAINS.has(input.domain)) return { action: 'skipped', note: 'skipped: on the skip list', wrote: false };
  const existing = await getAgentById(db, input.id);
  if (existing) {
    // Re-crawled from scratch: rows an embedding migration emptied, and crawls the sweep failed
    // after they stalled (e.g. a paused import). Resumed: unfinished crawls, including partial
    // ones the sweep ended `ready` with URLs still to read. Other rows stay as they are.
    const needsReembed =
      existing.status === 'failed' &&
      (existing.lastError === REEMBED_REQUIRED_ERROR || existing.lastError === STALE_CRAWL_ERROR);
    const unfinished =
      existing.status === 'crawling' || (existing.status === 'ready' && (await hasPendingPages(db, existing.id)));
    if ((!needsReembed && !unfinished) || existing.ownerTokenHash) return { action: 'exists', wrote: false };
    const action: ImportAction = needsReembed ? 'recrawled' : 'resumed';
    if (dryRun) return { action, wrote: false };
    if (needsReembed) {
      const refusal = await guard();
      if (refusal) return { action: 'conflict', wrote: false, stopped: refusal };
    }
    return { action, wrote: true };
  }
  const sameDomain = await getAgentByDomain(db, input.domain);
  if (sameDomain?.ownerTokenHash) {
    return { action: 'conflict', note: 'conflict: owned row kept', wrote: false };
  }
  if (dryRun) return { action: sameDomain ? 'replaced' : 'inserted', wrote: false };
  const refusal = await guard();
  if (refusal) return { action: 'conflict', wrote: false, stopped: refusal };
  // The pre-check above is for reporting; the write itself only removes unowned rows, atomically.
  const row = sameDomain ? await replaceUnownedWithId(db, input) : await insertAgentWithId(db, input);
  if (!row) return { action: 'conflict', note: 'conflict: owned row kept', wrote: false };
  return { action: sameDomain ? 'replaced' : 'inserted', wrote: true };
}

interface LockedCrawl extends Pick<ImportResult, 'crawl' | 'crawlError'> {
  /** Set when the whole run must stop (crawls spent today's embedding share). */
  stopRun?: string;
}

/**
 * Crawls slice after slice (an operator run has no function time limit) until the crawl ends,
 * or pauses: when crawls have spent today's embedding share (the run stops), or when a slice
 * added no pages. A paused crawl stays `crawling`; a later run resumes it.
 */
async function crawlLocked(db: Db, id: string, opts: ImportOptions, reset: boolean): Promise<LockedCrawl> {
  const paused = (crawl: CrawlOutcome | null): LockedCrawl => ({ crawl, crawlError: EMBED_LIMIT_PAUSE, stopRun: EMBED_LIMIT_PAUSE });
  if (await embedRailSpent(db, new Date(), opts.limits, 'crawl')) return paused(null);
  // A fresh time per agent: the run's start time could already be past the lock's lifetime.
  if (!(await tryLockCrawl(db, id, new Date(), opts.limits))) {
    return { crawl: null, crawlError: 'another crawl already holds the lock' };
  }
  try {
    if (reset) await resetForCrawl(db, id, new Date());
    else await reopenCrawl(db, id, new Date());
    const deps = createCrawlDeps();
    let outcome = await runCrawl(id, deps);
    while (outcome.status === 'crawling') {
      if (await embedRailSpent(db, new Date(), opts.limits, 'crawl')) return paused(outcome);
      if (outcome.pagesThisSlice === 0) return { crawl: outcome, crawlError: NO_PROGRESS_PAUSE };
      // Each slice gets a fresh lock lifetime, so a long import never loses the lock mid-crawl.
      await renewCrawlLock(db, id, new Date(), opts.limits);
      outcome = await runCrawl(id, deps);
    }
    return { crawl: outcome };
  } catch (err) {
    return { crawl: null, crawlError: err instanceof Error ? err.message : String(err) };
  } finally {
    await releaseCrawlLock(db, id);
  }
}

/**
 * Imports the agents in order. Crawls run sequentially through the normal crawl path with the lock
 * held and no per-IP or daily rail spent (an operator import, not a visitor).
 */
export async function importLegacyAgents(
  db: Db,
  agents: readonly LegacyAgent[],
  opts: ImportOptions,
): Promise<ImportSummary> {
  const results: ImportResult[] = [];
  /** Before each write when crawling: a full database stops the whole run. */
  const guard = async (): Promise<string | null> => {
    if (!opts.crawl) return null;
    const capacity = await ensureCapacity(db, opts.now, opts.limits);
    return capacity.ok ? null : `Stopped: no room left for another crawl (${capacity.message})`;
  };
  for (const agent of agents) {
    const input = mapLegacyAgent(agent, opts.now, opts.limits);
    const placed = await place(db, input, opts.dryRun === true, guard);
    if (placed.stopped) return { results, stopped: placed.stopped };
    const result: ImportResult = { id: input.id, domain: input.domain, action: placed.action, note: placed.note, crawl: null };
    let stopRun: string | undefined;
    if (placed.wrote && opts.crawl) {
      const { stopRun: stop, ...crawled } = await crawlLocked(db, input.id, opts, placed.action === 'recrawled');
      Object.assign(result, crawled);
      stopRun = stop;
    }
    results.push(result);
    opts.onResult?.(result);
    if (stopRun) return { results, stopped: stopRun };
  }
  return { results, stopped: null };
}
