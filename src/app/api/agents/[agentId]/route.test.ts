import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setDbForTests, type Db } from '@/lib/db/client';
import { getAgentById, insertAgent } from '@/lib/db/agents';
import { countAllChunks, insertChunksWithinCeiling } from '@/lib/db/chunks';
import { COPY } from '@/lib/agent-api';
import { mintOwnerToken } from '@/lib/owner-token';
import { createTestDb, fakeEmbedding, TEST_DB_TIMEOUT_MS } from '@/test/test-db';
import type { AgentRow, ApiErrorBody, GetAgentResponse } from '@/types';
import { DELETE, GET, PATCH } from './route';

const NOW = new Date('2026-11-05T10:15:00.000Z');

let db: Db;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = await createTestDb();
  setDbForTests(db);
}, TEST_DB_TIMEOUT_MS);

afterEach(() => {
  setDbForTests(null);
  vi.useRealTimers();
});

async function makeAgent(domain: string, opts: { pinned?: boolean } = {}): Promise<{ agent: AgentRow; token: string }> {
  const owner = mintOwnerToken();
  const agent = await insertAgent(db, {
    domain,
    url: `https://${domain}`,
    name: `Sammy - ${domain}`,
    instruction: 'Be nice.',
    ownerTokenHash: opts.pinned ? null : owner.hash,
    pinned: opts.pinned ?? false,
    now: NOW,
  });
  if (!agent) throw new Error('insert failed');
  return { agent, token: owner.token };
}

function ctx(agentId: string): { params: Promise<{ agentId: string }> } {
  return { params: Promise.resolve({ agentId }) };
}

function req(method: string, token?: string, body?: unknown): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('http://localhost/api/agents/x', {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('GET /api/agents/[agentId]', () => {
  it('GET unknown agent is 404', async () => {
    for (const id of ['abc', '2b1f0e1c-3a4d-4e5f-8a9b-0c1d2e3f4a5b']) {
      const res = await GET(req('GET'), ctx(id));
      expect(res.status).toBe(404);
      expect(((await res.json()) as ApiErrorBody).error.startsWith('This Sammy has retired')).toBe(true);
    }
  });

  it('GET reports isOwner from the bearer token', async () => {
    const { agent, token } = await makeAgent('example.com');
    const asOwner = (await (await GET(req('GET', token), ctx(agent.id))).json()) as GetAgentResponse;
    expect(asOwner.success).toBe(true);
    expect(asOwner.isOwner).toBe(true);
    expect(asOwner.agent.id).toBe(agent.id);
    expect(asOwner.agent).not.toHaveProperty('ownerTokenHash');

    const asStranger = (await (await GET(req('GET', 'wrong'), ctx(agent.id))).json()) as GetAgentResponse;
    expect(asStranger.isOwner).toBe(false);
    const anonymous = (await (await GET(req('GET'), ctx(agent.id))).json()) as GetAgentResponse;
    expect(anonymous.isOwner).toBe(false);
  });
});

describe('PATCH /api/agents/[agentId]', () => {
  it('PATCH without the owner token is 403', async () => {
    const { agent } = await makeAgent('example.com');
    for (const token of [undefined, 'wrong']) {
      const res = await PATCH(req('PATCH', token, { instruction: 'Be rude.' }), ctx(agent.id));
      expect(res.status).toBe(403);
      expect(((await res.json()) as ApiErrorBody).error).toBe(COPY.notOwner);
    }
    expect((await getAgentById(db, agent.id))?.instruction).toBe('Be nice.');
  });

  it('PATCH the pinned demo agent is 403 for everyone', async () => {
    const { agent, token } = await makeAgent('demo.example', { pinned: true });
    const res = await PATCH(req('PATCH', token, { instruction: 'Be rude.' }), ctx(agent.id));
    expect(res.status).toBe(403);
    expect((await DELETE(req('DELETE', token), ctx(agent.id))).status).toBe(403);
    expect(await getAgentById(db, agent.id)).not.toBeNull();
  });

  it('PATCH updates the instruction for the owner', async () => {
    const { agent, token } = await makeAgent('example.com');
    const res = await PATCH(req('PATCH', token, { instruction: '  Talk like a pirate.  ' }), ctx(agent.id));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; agent: { instruction: string } };
    expect(body.success).toBe(true);
    expect(body.agent.instruction).toBe('Talk like a pirate.');
    expect((await getAgentById(db, agent.id))?.instruction).toBe('Talk like a pirate.');
  });

  it('PATCH rejects an empty, missing or oversized instruction with 400', async () => {
    const { agent, token } = await makeAgent('example.com');
    for (const body of [{ instruction: '   ' }, {}, { instruction: 7 }, { instruction: 'x'.repeat(4001) }]) {
      const res = await PATCH(req('PATCH', token, body), ctx(agent.id));
      expect(res.status).toBe(400);
      expect(((await res.json()) as ApiErrorBody).error).toBeTruthy();
    }
    expect((await PATCH(req('PATCH', token, { instruction: 'x'.repeat(4000) }), ctx(agent.id))).status).toBe(200);
  });

  it('PATCH an unknown agent is 404', async () => {
    const res = await PATCH(req('PATCH', 'any', { instruction: 'x' }), ctx('abc'));
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/agents/[agentId]', () => {
  it('DELETE without the owner token is 403', async () => {
    const { agent } = await makeAgent('example.com');
    const res = await DELETE(req('DELETE', 'wrong'), ctx(agent.id));
    expect(res.status).toBe(403);
    expect(await getAgentById(db, agent.id)).not.toBeNull();
  });

  it('DELETE with the owner token removes agent and chunks', async () => {
    const { agent, token } = await makeAgent('example.com');
    await insertChunksWithinCeiling(
      db,
      agent.id,
      [0, 1].map((i) => ({ url: 'https://example.com', title: 't', pos: i, content: 'c', embedding: fakeEmbedding(i) })),
      100,
    );
    expect(await countAllChunks(db)).toBe(2);
    const res = await DELETE(req('DELETE', token), ctx(agent.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(await getAgentById(db, agent.id)).toBeNull();
    expect(await countAllChunks(db)).toBe(0);
    expect((await GET(req('GET', token), ctx(agent.id))).status).toBe(404);
  });
});
