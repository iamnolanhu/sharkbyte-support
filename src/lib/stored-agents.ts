import type { StoredAgent } from '@/types';

export const STORAGE_PREFIX = 'sharkbyte-agent-';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads one record. Keeps only the fields of the current shape: DO-era records carry
 * `endpoint`/`accessKey`/`kbId`, which are dropped; an `accessKey` is never an owner token.
 */
export function readStoredAgent(storage: Storage, id: string): StoredAgent | null {
  const raw = storage.getItem(`${STORAGE_PREFIX}${id}`);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const { id: storedId, name, url, createdAt, ownerToken } = parsed;
  if (typeof storedId !== 'string' || typeof name !== 'string' || typeof url !== 'string') return null;
  const agent: StoredAgent = {
    id: storedId,
    name,
    url,
    createdAt: typeof createdAt === 'string' ? createdAt : new Date(0).toISOString(),
  };
  if (typeof ownerToken === 'string' && ownerToken) agent.ownerToken = ownerToken;
  return agent;
}

/** Saves a record; an owner token already stored for this id survives a save that has none. */
export function saveStoredAgent(storage: Storage, agent: StoredAgent): void {
  const ownerToken = agent.ownerToken ?? readStoredAgent(storage, agent.id)?.ownerToken;
  const next: StoredAgent = { ...agent, ...(ownerToken ? { ownerToken } : {}) };
  storage.setItem(`${STORAGE_PREFIX}${agent.id}`, JSON.stringify(next));
}

export function removeStoredAgent(storage: Storage, id: string): void {
  storage.removeItem(`${STORAGE_PREFIX}${id}`);
}

/** Every agent this browser knows about, newest first. */
export function listStoredAgents(storage: Storage): StoredAgent[] {
  const agents: StoredAgent[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(STORAGE_PREFIX)) continue;
    const agent = readStoredAgent(storage, key.slice(STORAGE_PREFIX.length));
    if (agent) agents.push(agent);
  }
  return agents.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function ownerHeaders(storage: Storage, id: string): HeadersInit {
  const token = readStoredAgent(storage, id)?.ownerToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
