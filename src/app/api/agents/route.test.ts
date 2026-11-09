import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setDbForTests, type Db } from '@/lib/db/client';
import { finishCrawl, insertAgent } from '@/lib/db/agents';
import { mintOwnerToken } from '@/lib/owner-token';
import { createTestDb, TEST_DB_TIMEOUT_MS } from '@/test/test-db';
import type { AgentRow, ListAgentsResponse } from '@/types';
import { GET } from './route';

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  setDbForTests(db);
}, TEST_DB_TIMEOUT_MS);

afterEach(() => {
  setDbForTests(null);
});

async function makeAgent(
  domain: string,
  createdAt: string,
  opts: { pinned?: boolean; status?: 'ready' | 'failed' | 'crawling' } = {},
): Promise<AgentRow> {
  const agent = await insertAgent(db, {
    domain,
    url: `https://${domain}`,
    name: `Sammy - ${domain}`,
    instruction: 'Be nice.',
    ownerTokenHash: opts.pinned ? null : mintOwnerToken().hash,
    pinned: opts.pinned ?? false,
    now: new Date(createdAt),
  });
  if (!agent) throw new Error('insert failed');
  const status = opts.status ?? 'ready';
  if (status !== 'crawling') await finishCrawl(db, agent.id, { status, lastError: status === 'failed' ? 'x' : null });
  return agent;
}

async function list(): Promise<ListAgentsResponse> {
  const res = await GET();
  expect(res.status).toBe(200);
  return (await res.json()) as ListAgentsResponse;
}

describe('GET /api/agents', () => {
  it('lists ready and crawling agents, pinned first, then newest', async () => {
    await makeAgent('old.example', '2026-01-01T00:00:00Z');
    await makeAgent('pinned-old.example', '2025-06-01T00:00:00Z', { pinned: true });
    await makeAgent('new.example', '2026-03-01T00:00:00Z');
    await makeAgent('crawling.example', '2026-02-01T00:00:00Z', { status: 'crawling' });
    await makeAgent('pinned-new.example', '2025-07-01T00:00:00Z', { pinned: true });

    const body = await list();
    expect(body.success).toBe(true);
    expect(body.agents.map((a) => a.domain)).toEqual([
      'pinned-new.example',
      'pinned-old.example',
      'new.example',
      'crawling.example',
      'old.example',
    ]);
  });

  it('never includes the owner hash', async () => {
    await makeAgent('owned.example', '2026-01-01T00:00:00Z');
    const res = await GET();
    const text = await res.text();
    expect(text).not.toMatch(/owner/i);
    const body = JSON.parse(text) as ListAgentsResponse;
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]).not.toHaveProperty('ownerTokenHash');
  });

  it('excludes failed agents', async () => {
    await makeAgent('ok.example', '2026-01-01T00:00:00Z');
    await makeAgent('broken.example', '2026-01-02T00:00:00Z', { status: 'failed' });
    expect((await list()).agents.map((a) => a.domain)).toEqual(['ok.example']);
  });

  it('returns an empty list when there are no agents', async () => {
    expect(await list()).toEqual({ success: true, agents: [] });
  });
});
