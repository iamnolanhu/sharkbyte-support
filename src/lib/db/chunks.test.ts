import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from '@/lib/db/client';
import { insertAgent } from '@/lib/db/agents';
import {
  chunksTableBytes,
  countAllChunks,
  insertChunksWithinCeiling,
  searchChunks,
  toVectorLiteral,
} from '@/lib/db/chunks';
import { createTestDb, fakeEmbedding, TEST_DB_TIMEOUT_MS } from '@/test/test-db';
import type { ChunkInput } from '@/types';

const NOW = new Date('2026-11-01T10:00:00.000Z');

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
}, TEST_DB_TIMEOUT_MS);

async function agentId(domain: string): Promise<string> {
  const row = await insertAgent(db, {
    domain,
    url: `https://${domain}`,
    name: `Sammy - ${domain}`,
    instruction: 'Be nice.',
    ownerTokenHash: null,
    pinned: false,
    now: NOW,
  });
  if (!row) throw new Error('insertAgent returned null');
  return row.id;
}

function chunks(domain: string, seeds: number[]): ChunkInput[] {
  return seeds.map((seed, i) => ({
    url: `https://${domain}/p${seed}`,
    title: `Page ${seed}`,
    pos: i,
    content: `content ${seed}`,
    embedding: fakeEmbedding(seed),
  }));
}

describe('chunks repository', () => {
  it('searchChunks returns the nearest chunks of that agent only', async () => {
    const a = await agentId('a.example');
    const b = await agentId('b.example');
    await insertChunksWithinCeiling(db, a, chunks('a.example', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), 1000);
    await insertChunksWithinCeiling(db, b, chunks('b.example', [3, 50, 51]), 1000);

    const results = await searchChunks(db, a, fakeEmbedding(3), 6);

    expect(results).toHaveLength(6);
    expect(results[0]).toMatchObject({ url: 'https://a.example/p3', title: 'Page 3', content: 'content 3' });
    expect(results[0].score).toBeGreaterThan(0.99);
    expect(results.every((r) => r.url.startsWith('https://a.example/'))).toBe(true);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("searchChunks never leaks another agent's chunks", async () => {
    const a = await agentId('a.example');
    const b = await agentId('b.example');
    await insertChunksWithinCeiling(db, a, chunks('a.example', [100, 101, 102, 103, 104, 105, 106, 107]), 100000);
    const query = fakeEmbedding(999);
    // 1000 chunks of agent B, every one identical to the query vector (distance 0).
    await db.query(
      `INSERT INTO chunks (agent_id, url, title, pos, content, embedding)
       SELECT $1::uuid, 'https://b.example/p' || g, '', g, 'b content', $2::halfvec
       FROM generate_series(1, 1000) AS g`,
      [b, toVectorLiteral(query)],
    );
    expect(await countAllChunks(db)).toBe(1008);

    const results = await searchChunks(db, a, query, 6);

    expect(results).toHaveLength(6);
    expect(results.every((r) => r.url.startsWith('https://a.example/'))).toBe(true);
  });

  it('searchChunks returns nothing for a non-uuid agent id', async () => {
    await expect(searchChunks(db, 'not-a-uuid', fakeEmbedding(1), 6)).resolves.toEqual([]);
  });

  it('countAllChunks and chunksTableBytes report totals', async () => {
    expect(await countAllChunks(db)).toBe(0);
    const a = await agentId('a.example');
    const inserted = await insertChunksWithinCeiling(db, a, chunks('a.example', [1, 2, 3, 4, 5, 6, 7]), 1000);
    expect(inserted).toBe(7);
    expect(await countAllChunks(db)).toBe(7);
    const bytes = await chunksTableBytes(db);
    expect(typeof bytes).toBe('number');
    expect(bytes).toBeGreaterThan(0);
  });

  it('insertChunksWithinCeiling inserts only what fits', async () => {
    const a = await agentId('a.example');
    const b = await agentId('b.example');
    expect(await insertChunksWithinCeiling(db, a, chunks('a.example', [1, 2, 3, 4, 5, 6, 7, 8]), 10)).toBe(8);

    const fresh = chunks('b.example', [20, 21, 22, 23, 24]);
    expect(await insertChunksWithinCeiling(db, b, fresh, 10)).toBe(2);
    expect(await countAllChunks(db)).toBe(10);
    const kept = await db.query<{ pos: number }>('SELECT pos FROM chunks WHERE agent_id = $1 ORDER BY pos', [b]);
    expect(kept.map((r) => r.pos)).toEqual([0, 1]);

    expect(await insertChunksWithinCeiling(db, b, fresh, 10)).toBe(0);
    expect(await insertChunksWithinCeiling(db, b, fresh, 5)).toBe(0);
    expect(await countAllChunks(db)).toBe(10);
    expect(await insertChunksWithinCeiling(db, b, [], 10)).toBe(0);
  });

  it('insertChunksWithinCeiling keeps text with quotes, commas and braces intact', async () => {
    const a = await agentId('a.example');
    const tricky = `He said "hi", {then} left\\ it's fine`;
    await insertChunksWithinCeiling(
      db,
      a,
      [{ url: 'https://a.example/q?x=1,2', title: tricky, pos: 0, content: tricky, embedding: fakeEmbedding(1) }],
      10,
    );
    const rows = await db.query<{ url: string; title: string; content: string }>('SELECT url, title, content FROM chunks');
    expect(rows).toEqual([{ url: 'https://a.example/q?x=1,2', title: tricky, content: tricky }]);
  });
});
