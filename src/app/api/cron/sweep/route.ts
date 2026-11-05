import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getDb } from '@/lib/db/client';
import { getLimits } from '@/lib/config';
import { sweep } from '@/lib/sweep';
import { captureServer } from '@/lib/analytics/server';

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** GET /api/cron/sweep: daily storage sweep, called by Vercel Cron with the CRON_SECRET bearer. */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const result = await sweep(getDb(), new Date(), getLimits());
  await captureServer('cron_sweep', {
    stale_crawls_failed: result.staleCrawlsFailed,
    agents_removed: result.agentsRemoved,
    chunks: result.chunksAfter,
    db_bytes: result.dbBytes,
  });
  return NextResponse.json({ success: true, ...result });
}
