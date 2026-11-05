/**
 * Imports the agents of the retired DigitalOcean build, keeping their original ids.
 *
 * Usage (DATABASE_URL and the crawl keys come from the environment, e.g. `bun --env-file=<file>`):
 *   bun --env-file=<env file> scripts/import-legacy-agents.ts <export.json> [--dry-run] [--no-crawl]
 *
 * The export file is internal: keep it out of the repository.
 */

import { readFileSync } from 'node:fs';
import { getLimits } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import {
  importLegacyAgents,
  parseLegacyExport,
  type ImportAction,
  type ImportResult,
} from '@/lib/legacy-import';

function describeCrawl(r: ImportResult): string {
  if (r.crawlError) return `crawl error: ${r.crawlError}`;
  if (!r.crawl) return 'no crawl';
  const c = r.crawl;
  return `crawl ${c.status}, ${c.pagesCrawled} pages, ${c.chunkCount} chunks, ${c.seconds}s`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const crawl = !args.includes('--no-crawl');
  if (!file) {
    console.error('Usage: bun scripts/import-legacy-agents.ts <export.json> [--dry-run] [--no-crawl]');
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set (use bun --env-file=<file>).');
    process.exit(2);
  }

  const agents = parseLegacyExport(JSON.parse(readFileSync(file, 'utf8')));
  console.log(`${dryRun ? '[dry run] ' : ''}${agents.length} agents in the export`);

  const results = await importLegacyAgents(getDb(), agents, {
    now: new Date(),
    limits: getLimits(),
    crawl,
    dryRun,
  });

  const totals: Record<ImportAction, number> = { inserted: 0, replaced: 0, exists: 0, conflict: 0 };
  for (const r of results) {
    totals[r.action]++;
    const crawlPart = r.action === 'inserted' || r.action === 'replaced' ? ` | ${describeCrawl(r)}` : '';
    console.log(`${r.domain} | ${r.id} | ${r.note ?? r.action}${crawlPart}`);
  }
  const crawled = results.filter((r) => r.crawl);
  console.log(
    `Totals: inserted ${totals.inserted}, replaced ${totals.replaced}, exists ${totals.exists}, conflict ${totals.conflict}` +
      ` | crawled ${crawled.length} (ready ${crawled.filter((r) => r.crawl?.status === 'ready').length},` +
      ` failed ${crawled.filter((r) => r.crawl?.status === 'failed').length}),` +
      ` crawl errors ${results.filter((r) => r.crawlError).length}`,
  );
}

main().catch((err: unknown) => {
  console.error(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
