import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BANNED_VENDOR_NAMES } from '@/lib/chat/handle-chat';
import { getLimits } from '@/lib/config';
import type { Db } from '@/lib/db/client';
import { getAgentById, insertAgent } from '@/lib/db/agents';
import { insertChunksWithinCeiling } from '@/lib/db/chunks';
import type { EmbedFn } from '@/lib/embeddings';
import { createTestDb, fakeEmbedding, TEST_DB_TIMEOUT_MS } from '@/test/test-db';
import { KNOWLEDGE_URL, knowledgeChunks, readKnowledgeFile, seedDemoKnowledge } from './demo-knowledge';

const NOW = new Date('2026-11-05T10:00:00.000Z');
const LIMITS = getLimits({});
const PAGE_URL = 'https://demo.example/';

const MARKDOWN = `# Title

A note for maintainers, never seeded.

## First

One body.

## Second

Two body.

## Empty
`;

let db: Db;
let agentId: string;
const embed = vi.fn<EmbedFn>(async (texts) => texts.map((_, i) => fakeEmbedding(i + 1)));

beforeEach(async () => {
  embed.mockClear();
  db = await createTestDb();
  const agent = await insertAgent(db, {
    domain: 'demo.example',
    url: PAGE_URL,
    name: 'Sammy - demo.example',
    instruction: 'x',
    ownerTokenHash: null,
    pinned: true,
    now: NOW,
  });
  if (!agent) throw new Error('insert failed');
  agentId = agent.id;
}, TEST_DB_TIMEOUT_MS);

async function addCrawledChunks(n: number): Promise<void> {
  const chunks = Array.from({ length: n }, (_, i) => ({
    url: PAGE_URL,
    title: 'Home',
    pos: i,
    content: `page ${i}`,
    embedding: fakeEmbedding(100 + i),
  }));
  await insertChunksWithinCeiling(db, agentId, chunks, LIMITS.maxTotalChunks);
}

async function chunksBySource(): Promise<Record<string, number>> {
  const rows = await db.query<{ url: string; n: number | string }>(
    'SELECT url, count(*) AS n FROM chunks WHERE agent_id = $1 GROUP BY url',
    [agentId],
  );
  return Object.fromEntries(rows.map((r) => [r.url, Number(r.n)]));
}

describe('knowledgeChunks', () => {
  it('makes one chunk per section, titled and led by its heading, skipping the preamble and empty sections', () => {
    expect(knowledgeChunks(MARKDOWN, LIMITS)).toEqual([
      { title: 'First', content: 'First\n\nOne body.' },
      { title: 'Second', content: 'Second\n\nTwo body.' },
    ]);
  });

  it('splits a long section like a page', () => {
    const long = `## Long\n\n${'A sentence that keeps going. '.repeat(400)}`;
    const chunks = knowledgeChunks(long, LIMITS);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.content.startsWith('Long\n\n')).toBe(true);
  });

  it('reads the tracked knowledge file into the sections the demo needs', () => {
    const titles = knowledgeChunks(readKnowledgeFile(), LIMITS).map((c) => c.title);
    for (const title of [
      'What SharkByte Support is',
      'How to use SharkByte Support',
      'Embedding Sammy on your website',
      'History and owning an agent',
      'Free demo limits',
      'Privacy',
      'Who built SharkByte Support',
      'Open source',
      'Custom or production agents',
    ]) {
      expect(titles).toContain(title);
    }
    const all = knowledgeChunks(readKnowledgeFile(), LIMITS).map((c) => c.content).join('\n');
    expect(all).toContain('Nolan Hu');
    expect(all).toContain('github.com/iamnolanhu/sharkbyte-support');
    expect(all).toContain('30 pages');
    expect(all).not.toMatch(/Sigma Synapses/i);
    // Sammy never names the AI behind it, so what it knows names none either.
    for (const vendor of [...BANNED_VENDOR_NAMES, 'Gradient']) expect(all).not.toMatch(new RegExp(`\\b${vendor}\\b`));
  });
});

describe('seedDemoKnowledge', () => {
  it('stores the knowledge chunks under knowledge:// next to the crawled ones and recounts the agent', async () => {
    await addCrawledChunks(2);
    expect(await seedDemoKnowledge(db, agentId, { limits: LIMITS, embed, markdown: MARKDOWN })).toBe(2);
    expect(embed).toHaveBeenCalledWith(['First\n\nOne body.', 'Second\n\nTwo body.'], 'passage');
    expect(await chunksBySource()).toEqual({ [PAGE_URL]: 2, [KNOWLEDGE_URL]: 2 });
    expect((await getAgentById(db, agentId))?.chunkCount).toBe(4);
    const rows = await db.query<{ title: string; content: string }>(
      'SELECT title, content FROM chunks WHERE agent_id = $1 AND url = $2 ORDER BY pos',
      [agentId, KNOWLEDGE_URL],
    );
    expect(rows).toEqual([
      { title: 'First', content: 'First\n\nOne body.' },
      { title: 'Second', content: 'Second\n\nTwo body.' },
    ]);
  });

  it('is idempotent: a re-seed replaces only the knowledge chunks', async () => {
    await addCrawledChunks(3);
    await seedDemoKnowledge(db, agentId, { limits: LIMITS, embed, markdown: MARKDOWN });
    await seedDemoKnowledge(db, agentId, { limits: LIMITS, embed, markdown: MARKDOWN });
    expect(await chunksBySource()).toEqual({ [PAGE_URL]: 3, [KNOWLEDGE_URL]: 2 });

    const shorter = '## Only\n\nJust one now.';
    expect(await seedDemoKnowledge(db, agentId, { limits: LIMITS, embed, markdown: shorter })).toBe(1);
    expect(await chunksBySource()).toEqual({ [PAGE_URL]: 3, [KNOWLEDGE_URL]: 1 });
    expect((await getAgentById(db, agentId))?.chunkCount).toBe(4);
  });

  it('fits in what MAX_CHUNKS_PER_AGENT leaves after the crawled chunks', async () => {
    const limits = { ...LIMITS, maxChunksPerAgent: 4 };
    await addCrawledChunks(3);
    expect(await seedDemoKnowledge(db, agentId, { limits, embed, markdown: MARKDOWN })).toBe(1);
    expect(await chunksBySource()).toEqual({ [PAGE_URL]: 3, [KNOWLEDGE_URL]: 1 });
    // The old knowledge chunk's place is free again on a re-seed.
    expect(await seedDemoKnowledge(db, agentId, { limits, embed, markdown: MARKDOWN })).toBe(1);
    expect((await getAgentById(db, agentId))?.chunkCount).toBe(4);
  });

  it('never embeds more chunks than one agent may hold', async () => {
    const limits = { ...LIMITS, maxChunksPerAgent: 1 };
    await seedDemoKnowledge(db, agentId, { limits, embed, markdown: MARKDOWN });
    expect(embed).toHaveBeenCalledWith(['First\n\nOne body.'], 'passage');
  });

  it('stays under the global chunk ceiling', async () => {
    await addCrawledChunks(2);
    const limits = { ...LIMITS, maxTotalChunks: 3 };
    expect(await seedDemoKnowledge(db, agentId, { limits, embed, markdown: MARKDOWN })).toBe(1);
    expect(await chunksBySource()).toEqual({ [PAGE_URL]: 2, [KNOWLEDGE_URL]: 1 });
  });

  it('writes nothing when the embedding fails', async () => {
    await addCrawledChunks(1);
    await seedDemoKnowledge(db, agentId, { limits: LIMITS, embed, markdown: MARKDOWN });
    const failing = vi.fn<EmbedFn>(async () => {
      throw new Error('rate limited');
    });
    await expect(seedDemoKnowledge(db, agentId, { limits: LIMITS, embed: failing, markdown: MARKDOWN })).rejects.toThrow(
      'rate limited',
    );
    expect(await chunksBySource()).toEqual({ [PAGE_URL]: 1, [KNOWLEDGE_URL]: 2 });
  });
});
