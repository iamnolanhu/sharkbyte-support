import { describe, it, expect, vi } from 'vitest';
import { getLimits } from '@/lib/config';
import { POST as repair } from '../repair/route';
import { POST, maxDuration } from './route';

vi.mock('@/lib/background', () => ({ runInBackground: vi.fn() }));
vi.mock('@/lib/crawl/run-crawl', () => ({ runCrawl: vi.fn(), createCrawlDeps: vi.fn() }));
vi.mock('@/lib/analytics/server');

describe('POST /api/agents/[agentId]/reindex', () => {
  it('is the repair handler', () => {
    expect(POST).toBe(repair);
  });

  it('maxDuration matches the crawl budget', () => {
    expect(maxDuration).toBe(getLimits().crawlMaxDurationS);
  });
});
