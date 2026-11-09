import type { PublicAgent, StoredAgent } from '@/types';

/** One row of the header History menu. */
export interface HistoryEntry {
  id: string;
  /** The site's host, e.g. `acme.com`. */
  host: string;
  createdAt: string;
  /** True when this browser made the agent (it is in localStorage). */
  mine: boolean;
  /** Server status; unknown for a browser-only entry the server did not list. */
  status?: PublicAgent['status'];
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * The History menu: this browser's agents first (newest first, as stored), then every listed agent
 * from the server that is not already shown. Deduped by id.
 */
export function mergeHistory(local: readonly StoredAgent[], server: readonly PublicAgent[]): HistoryEntry[] {
  const serverById = new Map(server.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const entries: HistoryEntry[] = [];
  for (const a of local) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    entries.push({ id: a.id, host: hostOf(a.url), createdAt: a.createdAt, mine: true, status: serverById.get(a.id)?.status });
  }
  for (const a of server) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    entries.push({ id: a.id, host: a.domain || hostOf(a.url), createdAt: a.createdAt, mine: false, status: a.status });
  }
  return entries;
}

/** The `agents` array of a `GET /api/agents` body, or [] for anything else. */
export function parseListedAgents(body: unknown): PublicAgent[] {
  if (typeof body !== 'object' || body === null) return [];
  const { success, agents } = body as { success?: unknown; agents?: unknown };
  if (success !== true || !Array.isArray(agents)) return [];
  return agents.filter(
    (a): a is PublicAgent =>
      typeof a === 'object' && a !== null && typeof (a as PublicAgent).id === 'string' && typeof (a as PublicAgent).url === 'string',
  );
}
