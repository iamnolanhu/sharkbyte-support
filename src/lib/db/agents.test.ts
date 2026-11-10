import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from '@/lib/db/client';
import {
  deleteAgent,
  finishCrawl,
  getAgentByDomain,
  getAgentById,
  insertAgent,
  isUuid,
  pinAgent,
  resetForCrawl,
  touchLastUsed,
  updateCrawlProgress,
  updateInstruction,
  upgradeLegacyInstructions,
} from '@/lib/db/agents';
import { DEFAULT_INSTRUCTION, LEGACY_DEFAULT_INSTRUCTION, PREVIOUS_DEFAULT_INSTRUCTION } from '@/lib/config';
import { countAllChunks, insertChunksWithinCeiling } from '@/lib/db/chunks';
import { createTestDb, fakeEmbedding, TEST_DB_TIMEOUT_MS } from '@/test/test-db';
import type { AgentRow, ChunkInput } from '@/types';

const T0 = new Date('2026-11-01T10:00:00.000Z');
const T1 = new Date('2026-11-02T12:30:00.000Z');

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
}, TEST_DB_TIMEOUT_MS);

async function newAgent(domain = 'example.com'): Promise<AgentRow> {
  const row = await insertAgent(db, {
    domain,
    url: `https://${domain}`,
    name: `Sammy - ${domain}`,
    instruction: 'Be nice.',
    ownerTokenHash: 'hash-1',
    pinned: false,
    now: T0,
  });
  if (!row) throw new Error('insertAgent returned null');
  return row;
}

function chunks(n: number, base = 'https://example.com'): ChunkInput[] {
  return Array.from({ length: n }, (_, i) => ({
    url: `${base}/p${i}`,
    title: `Page ${i}`,
    pos: i,
    content: `content ${i}`,
    embedding: fakeEmbedding(i),
  }));
}

describe('agents repository', () => {
  it('insertAgent maps every column into an AgentRow', async () => {
    const a = await newAgent();
    expect(isUuid(a.id)).toBe(true);
    expect(a).toMatchObject({
      domain: 'example.com',
      url: 'https://example.com',
      name: 'Sammy - example.com',
      instruction: 'Be nice.',
      status: 'crawling',
      pagesCrawled: 0,
      pagesTotal: 0,
      chunkCount: 0,
      lastError: null,
      pinned: false,
      ownerTokenHash: 'hash-1',
    });
    expect(a.createdAt.toISOString()).toBe(T0.toISOString());
    expect(a.lastUsedAt.toISOString()).toBe(T0.toISOString());
    expect(a.crawlStartedAt?.toISOString()).toBe(T0.toISOString());
    expect(await getAgentByDomain(db, 'example.com')).toEqual(a);
    expect(await getAgentByDomain(db, 'other.com')).toBeNull();
  });

  it('insertAgent returns null on a duplicate domain', async () => {
    await newAgent();
    const second = await insertAgent(db, {
      domain: 'example.com',
      url: 'https://example.com/again',
      name: 'Other',
      instruction: 'x',
      ownerTokenHash: null,
      pinned: false,
      now: T1,
    });
    expect(second).toBeNull();
    const rows = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM agents');
    expect(rows[0].n).toBe(1);
  });

  it('getAgentById returns null for a non-uuid', async () => {
    await newAgent();
    await expect(getAgentById(db, 'not-a-uuid')).resolves.toBeNull();
    await expect(getAgentById(db, crypto.randomUUID())).resolves.toBeNull();
    await expect(getAgentById(db, "1'; DROP TABLE agents; --")).resolves.toBeNull();
  });

  it('updates round-trip: progress, finish, instruction, touch, pin', async () => {
    const a = await newAgent();
    await updateCrawlProgress(db, a.id, { pagesCrawled: 4, pagesTotal: 9, chunkCount: 33 });
    await finishCrawl(db, a.id, { status: 'failed', lastError: 'reef too deep' });
    await updateInstruction(db, a.id, 'Talk like a shark.');
    await touchLastUsed(db, a.id, T1);
    await pinAgent(db, a.id);
    const b = await getAgentById(db, a.id);
    expect(b).toMatchObject({
      pagesCrawled: 4,
      pagesTotal: 9,
      chunkCount: 33,
      status: 'failed',
      lastError: 'reef too deep',
      instruction: 'Talk like a shark.',
      pinned: true,
      ownerTokenHash: null,
    });
    expect(b?.lastUsedAt.toISOString()).toBe(T1.toISOString());
  });

  it('resetForCrawl clears chunks and counters', async () => {
    const a = await newAgent();
    await insertChunksWithinCeiling(db, a.id, chunks(5), 1000);
    await updateCrawlProgress(db, a.id, { pagesCrawled: 5, pagesTotal: 5, chunkCount: 5 });
    await finishCrawl(db, a.id, { status: 'failed', lastError: 'boom' });

    await resetForCrawl(db, a.id, T1);

    expect(await countAllChunks(db)).toBe(0);
    const b = await getAgentById(db, a.id);
    expect(b).toMatchObject({
      status: 'crawling',
      pagesCrawled: 0,
      pagesTotal: 0,
      chunkCount: 0,
      lastError: null,
    });
    expect(b?.crawlStartedAt?.toISOString()).toBe(T1.toISOString());
  });

  it('deleteAgent cascades to chunks', async () => {
    const a = await newAgent();
    const other = await newAgent('other.com');
    await insertChunksWithinCeiling(db, a.id, chunks(4), 1000);
    await insertChunksWithinCeiling(db, other.id, chunks(2, 'https://other.com'), 1000);

    await deleteAgent(db, a.id);

    expect(await getAgentById(db, a.id)).toBeNull();
    expect(await countAllChunks(db)).toBe(2);
    expect(await getAgentById(db, other.id)).not.toBeNull();
  });
});

describe('upgradeLegacyInstructions', () => {
  it('moves untouched DigitalOcean-era and previous defaults to the current one, leaves custom text, then is a no-op', async () => {
    const doEra = await newAgent('aria.org.uk');
    const previous = await newAgent('kelp.example');
    const editedPrevious = await newAgent('coral.example');
    const custom = await newAgent('tide.example');
    await updateInstruction(db, doEra.id, LEGACY_DEFAULT_INSTRUCTION('aria.org.uk'));
    await updateInstruction(db, previous.id, PREVIOUS_DEFAULT_INSTRUCTION('kelp.example'));
    const editedText = `${PREVIOUS_DEFAULT_INSTRUCTION('coral.example')} Mention the spring sale.`;
    await updateInstruction(db, editedPrevious.id, editedText);

    expect(await upgradeLegacyInstructions(db)).toBe(2);
    expect((await getAgentById(db, doEra.id))?.instruction).toBe(DEFAULT_INSTRUCTION('aria.org.uk'));
    expect((await getAgentById(db, previous.id))?.instruction).toBe(DEFAULT_INSTRUCTION('kelp.example'));
    expect((await getAgentById(db, editedPrevious.id))?.instruction).toBe(editedText);
    expect((await getAgentById(db, custom.id))?.instruction).toBe('Be nice.');
    expect(await upgradeLegacyInstructions(db)).toBe(0);
  });

  it('replaces only untouched DigitalOcean-era defaults, once', async () => {
    const legacy = await newAgent('aria.org.uk');
    const edited = await newAgent('reef.example');
    const custom = await newAgent('tide.example');
    await updateInstruction(db, legacy.id, LEGACY_DEFAULT_INSTRUCTION('aria.org.uk'));
    const editedText = `${LEGACY_DEFAULT_INSTRUCTION('reef.example')}\n- Mention the spring sale`;
    await updateInstruction(db, edited.id, editedText);

    expect(await upgradeLegacyInstructions(db)).toBe(1);
    expect((await getAgentById(db, legacy.id))?.instruction).toBe(DEFAULT_INSTRUCTION('aria.org.uk'));
    expect((await getAgentById(db, edited.id))?.instruction).toBe(editedText);
    expect((await getAgentById(db, custom.id))?.instruction).toBe('Be nice.');
    expect(await upgradeLegacyInstructions(db)).toBe(0);
  });
});
