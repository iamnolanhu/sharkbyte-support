import { describe, it, expect } from 'vitest';
import type { AgentRow } from '@/types';
import { apiError, COPY, toPublicAgent } from './agent-api';

const OWNER_HASH = 'stored-owner-hash';

const ROW: AgentRow = {
  id: '3f1c2a64-6b0e-4f6e-9d57-0c1d2e3f4a5b',
  domain: 'example.com',
  url: 'https://example.com',
  name: 'Sammy - example.com',
  instruction: 'Be kind',
  status: 'ready',
  pagesCrawled: 3,
  pagesTotal: 5,
  chunkCount: 40,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  lastUsedAt: new Date('2026-11-02T00:00:00.000Z'),
  crawlStartedAt: new Date('2026-11-01T00:00:00.000Z'),
  lastError: null,
  pinned: false,
  ownerTokenHash: OWNER_HASH,
};

describe('toPublicAgent', () => {
  it('never exposes the owner hash', () => {
    const result = toPublicAgent(ROW);
    expect(Object.keys(result)).not.toContain('ownerTokenHash');
    expect(JSON.stringify(result)).not.toContain(OWNER_HASH);
    expect(result.createdAt).toBe('2026-11-01T00:00:00.000Z');
    expect(result.lastUsedAt).toBe('2026-11-02T00:00:00.000Z');
    expect(result).not.toHaveProperty('crawlStartedAt');
  });
});

describe('apiError', () => {
  it('returns a JSON error body with the status and headers', async () => {
    const res = apiError(404, COPY.retired('sharkbyte.example'), { 'X-Test': '1' });
    expect(res.status).toBe(404);
    expect(res.headers.get('X-Test')).toBe('1');
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({
      success: false,
      error: 'This Sammy has retired — make a new one at sharkbyte.example',
    });
  });
});

describe('COPY', () => {
  it('uses the fixed ocean copy', () => {
    expect(COPY.badUrl).toBe('That URL is off our map — try a public website like example.com.');
    expect(COPY.tooLong).toBe('That message is a whale — keep it under 2,000 characters.');
  });
});
