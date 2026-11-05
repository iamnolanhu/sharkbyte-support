/**
 * Imports the agents of the retired DigitalOcean build into the Postgres backend, keeping their
 * original ids so old embed snippets and links keep resolving. The CLI is `scripts/import-legacy-agents.ts`.
 */

import { DEFAULT_INSTRUCTION, type Limits } from '@/lib/config';
import { createCrawlDeps, runCrawl, type CrawlOutcome } from '@/lib/crawl/run-crawl';
import { releaseCrawlLock, tryLockCrawl } from '@/lib/crawl/start-crawl';
import { domainKey, normalizeSubmittedUrl } from '@/lib/crawl/url-guard';
import type { Db } from '@/lib/db/client';
import {
  deleteAgent,
  getAgentByDomain,
  getAgentById,
  insertAgentWithId,
  isUuid,
  type AgentWithIdInput,
} from '@/lib/db/agents';
import { ensureCapacity } from '@/lib/sweep';

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
  'globelanguage.com',
  'dev.nolanhu.com',
]);

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

export type ImportAction = 'inserted' | 'replaced' | 'exists' | 'conflict';

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
}

/** Decides and (unless dry-run) performs the insert; `null` row means nothing was written. */
async function place(
  db: Db,
  input: AgentWithIdInput,
  dryRun: boolean,
): Promise<{ action: ImportAction; note?: string; wrote: boolean }> {
  if (await getAgentById(db, input.id)) return { action: 'exists', wrote: false };
  const sameDomain = await getAgentByDomain(db, input.domain);
  if (sameDomain?.ownerTokenHash) {
    return { action: 'conflict', note: 'conflict: owned row kept', wrote: false };
  }
  if (dryRun) return { action: sameDomain ? 'replaced' : 'inserted', wrote: false };
  if (sameDomain) await deleteAgent(db, sameDomain.id);
  const row = await insertAgentWithId(db, input);
  if (!row) return { action: 'conflict', note: 'conflict: row appeared during import, skipped', wrote: false };
  return { action: sameDomain ? 'replaced' : 'inserted', wrote: true };
}

async function crawlLocked(db: Db, id: string, opts: ImportOptions): Promise<Pick<ImportResult, 'crawl' | 'crawlError'>> {
  const capacity = await ensureCapacity(db, opts.now, opts.limits);
  if (!capacity.ok) return { crawl: null, crawlError: `capacity refused the crawl: ${capacity.message}` };
  if (!(await tryLockCrawl(db, id, opts.now, opts.limits))) {
    return { crawl: null, crawlError: 'another crawl already holds the lock' };
  }
  try {
    return { crawl: await runCrawl(id, createCrawlDeps()) };
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
): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (const agent of agents) {
    const input = mapLegacyAgent(agent, opts.now, opts.limits);
    const placed = await place(db, input, opts.dryRun === true);
    const result: ImportResult = { id: input.id, domain: input.domain, action: placed.action, note: placed.note, crawl: null };
    if (placed.wrote && opts.crawl) Object.assign(result, await crawlLocked(db, input.id, opts));
    results.push(result);
  }
  return results;
}
