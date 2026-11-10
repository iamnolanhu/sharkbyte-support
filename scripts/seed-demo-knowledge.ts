/**
 * Re-seeds the demo agent's curated knowledge (`content/sharkbyte-knowledge.md`) without a
 * re-crawl: its knowledge chunks are replaced, its crawled chunks stay. Run it after editing the
 * knowledge file. New and repaired demo agents are seeded on their own (`/api/demo-config`).
 *
 * Usage (DATABASE_URL and the embedding key come from the environment, e.g. `bun --env-file=<file>`):
 *   bun --env-file=<env file> scripts/seed-demo-knowledge.ts
 */

import { getLimits } from '@/lib/config';
import { releaseCrawlLock, tryLockCrawl } from '@/lib/crawl/start-crawl';
import { getAgentByDomain, getAgentById } from '@/lib/db/agents';
import { getDb } from '@/lib/db/client';
import { demoDomain, KNOWLEDGE_URL, seedDemoKnowledge } from '@/lib/demo-knowledge';

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (use bun --env-file=<file>).');
    process.exit(2);
  }
  const db = getDb();
  const limits = getLimits();
  const domain = demoDomain();
  const agent = await getAgentByDomain(db, domain);
  if (!agent) {
    console.error(`No demo agent for ${domain}; /api/demo-config creates (and seeds) it.`);
    process.exit(1);
  }
  // A crawl slice keeps its own chunk count, so seed only while no slice runs.
  if (!(await tryLockCrawl(db, agent.id, new Date(), limits))) {
    console.error(`${domain}: a crawl holds the lock; run again when it has finished.`);
    process.exit(1);
  }
  try {
    const stored = await seedDemoKnowledge(db, agent.id, { limits });
    const after = await getAgentById(db, agent.id);
    const bySource = await db.query<{ source: string; n: number | string }>(
      `SELECT CASE WHEN url = $2 THEN url ELSE 'crawled pages' END AS source, count(*) AS n
       FROM chunks WHERE agent_id = $1 GROUP BY 1 ORDER BY 1`,
      [agent.id, KNOWLEDGE_URL],
    );
    console.log(`${domain} | ${agent.status} | knowledge chunks stored ${stored} | chunk_count ${after?.chunkCount}`);
    for (const row of bySource) console.log(`  ${row.source}: ${Number(row.n)}`);
  } finally {
    await releaseCrawlLock(db, agent.id);
  }
}

main().catch((err: unknown) => {
  console.error(`Seeding failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
