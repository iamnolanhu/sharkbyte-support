import { describe, it, expect } from 'vitest';
import { applySchema, dimsMigrationEnabled, embeddingSizeMismatch } from './client';
import { getAgentByDomain, insertAgent } from './agents';
import { countAllChunks, insertChunksWithinCeiling, searchChunks } from './chunks';
import { REEMBED_REQUIRED_ERROR } from './schema';
import { createEmptyTestDb, fakeEmbedding, TEST_DB_TIMEOUT_MS } from '@/test/test-db';
import type { Db } from './client';

const NOW = new Date('2026-11-09T10:00:00.000Z');

async function columnDims(db: Db): Promise<number> {
  const rows = await db.query<{ dims: number }>(
    `SELECT atttypmod AS dims FROM pg_attribute WHERE attrelid = 'chunks'::regclass AND attname = 'embedding'`,
  );
  return Number(rows[0]?.dims);
}

async function seedAgent(db: Db, domain: string, status: 'ready' | 'crawling' | 'failed', dims: number, chunks: number) {
  const row = await insertAgent(db, {
    domain,
    url: `https://${domain}/`,
    name: `Sammy - ${domain}`,
    instruction: 'x',
    ownerTokenHash: null,
    pinned: false,
    now: NOW,
  });
  if (!row) throw new Error('insert failed');
  await insertChunksWithinCeiling(
    db,
    row.id,
    Array.from({ length: chunks }, (_, i) => ({ url: `https://${domain}/${i}`, title: 't', pos: i, content: 'c', embedding: fakeEmbedding(i + 1, dims) })),
    1_000_000,
  );
  await db.query('UPDATE agents SET status = $2, chunk_count = $3 WHERE id = $1', [row.id, status, chunks]);
  return row.id;
}

describe('embedding dimension migration', () => {
  it(
    'a fresh database gets the configured size and reports no migration',
    async () => {
      const db = await createEmptyTestDb();
      expect(await applySchema(db, 768, false)).toBeNull();
      expect(await columnDims(db)).toBe(768);
      expect(await applySchema(db, 768, true)).toBeNull();
    },
    TEST_DB_TIMEOUT_MS,
  );

  it(
    'without the opt-in a size change touches nothing and is reported as a mismatch',
    async () => {
      const db = await createEmptyTestDb();
      await applySchema(db, 1024, false);
      await seedAgent(db, 'ready.example', 'ready', 1024, 3);

      expect(await applySchema(db, 768, false)).toEqual({ kind: 'mismatch', fromDims: 1024, toDims: 768, agentsMarked: 0 });

      expect(await columnDims(db)).toBe(1024);
      expect(await countAllChunks(db)).toBe(3);
      expect((await getAgentByDomain(db, 'ready.example'))?.status).toBe('ready');
      // EMBEDDING_DIMS defaults to 768 here: writes and searches refuse with a clear message.
      expect(await embeddingSizeMismatch(db)).toMatch(/halfvec\(1024\).*EMBEDDING_DIMS is 768.*EMBEDDING_DIMS_MIGRATE=1/);
    },
    TEST_DB_TIMEOUT_MS,
  );

  it('the opt-in is EMBEDDING_DIMS_MIGRATE=1 only', () => {
    expect(dimsMigrationEnabled({ EMBEDDING_DIMS_MIGRATE: '1' })).toBe(true);
    expect(dimsMigrationEnabled({ EMBEDDING_DIMS_MIGRATE: 'true' })).toBe(false);
    expect(dimsMigrationEnabled({})).toBe(false);
  });

  it(
    'with the opt-in a size change empties chunks, resizes the column and marks every agent for re-embedding',
    async () => {
      const db = await createEmptyTestDb();
      await applySchema(db, 1024, false);
      await seedAgent(db, 'ready.example', 'ready', 1024, 3);
      await seedAgent(db, 'failed.example', 'failed', 1024, 0);
      await seedAgent(db, 'crawling.example', 'crawling', 1024, 2);
      expect(await countAllChunks(db)).toBe(5);

      await db.query(`UPDATE agents SET pages_crawled = 4, crawl_slices = 2, crawl_skipped = 1, crawl_pending = ARRAY['https://crawling.example/x'] WHERE domain = 'crawling.example'`);

      const migration = await applySchema(db, 768, true);

      expect(migration).toEqual({ kind: 'migrated', fromDims: 1024, toDims: 768, agentsMarked: 2 });
      expect(await columnDims(db)).toBe(768);
      expect(await countAllChunks(db)).toBe(0);
      const ready = await getAgentByDomain(db, 'ready.example');
      expect(ready).toMatchObject({ status: 'failed', lastError: REEMBED_REQUIRED_ERROR, chunkCount: 0 });
      expect((await getAgentByDomain(db, 'failed.example'))?.lastError).toBe(REEMBED_REQUIRED_ERROR);
      // A crawl in flight stays crawling, its progress reset (its pages are gone).
      expect(await getAgentByDomain(db, 'crawling.example')).toMatchObject({ status: 'crawling', chunkCount: 0, pagesCrawled: 0 });
      const [crawlState] = await db.query<{ crawl_pending: string[] | null; crawl_slices: number; crawl_skipped: number }>(
        `SELECT crawl_pending, crawl_slices, crawl_skipped FROM agents WHERE domain = 'crawling.example'`,
      );
      expect(crawlState).toEqual({ crawl_pending: null, crawl_slices: 0, crawl_skipped: 0 });

      // New-size vectors store and search; old-size ones are refused.
      const id = await seedAgent(db, 'new.example', 'ready', 768, 8);
      expect(await searchChunks(db, id, fakeEmbedding(1, 768), 6)).toHaveLength(6);
      await expect(seedAgent(db, 'old.example', 'ready', 1024, 1)).rejects.toThrow();

      // Idempotent: the next cold start changes nothing, with or without the opt-in.
      expect(await applySchema(db, 768, true)).toBeNull();
      expect(await applySchema(db, 768, false)).toBeNull();
      expect(await countAllChunks(db)).toBe(8);
    },
    TEST_DB_TIMEOUT_MS,
  );
});
