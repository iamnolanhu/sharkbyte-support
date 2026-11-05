import { describe, it, expect } from 'vitest';
import { DEFAULT_INSTRUCTION, envInt, getLimits } from '@/lib/config';

describe('getLimits', () => {
  it('getLimits uses spec defaults', () => {
    const l = getLimits({});
    expect([
      l.maxPagesPerAgent,
      l.maxChunksPerAgent,
      l.maxTotalChunks,
      l.maxCrawlsPerDay,
      l.maxChatTokensPerDay,
      l.maxFirecrawlPerDay,
    ]).toEqual([30, 300, 40000, 50, 500000, 50]);
    expect(l.retentionDays).toBe(14);
    expect(l.crawlMaxDurationS).toBe(300);
    expect(l.maxInstructionChars).toBe(4000);
    expect(l.maxChatBodyBytes).toBe(65536);
    expect(l.failedRetentionHours).toBe(24);
    expect(l.evictTargetRatio).toBe(0.8);
  });

  it('getLimits reads the env overrides', () => {
    const l = getLimits({ MAX_TOTAL_CHUNKS: '100', MAX_PAGES_PER_AGENT: 'lots' });
    expect(l.maxTotalChunks).toBe(100);
    expect(l.maxPagesPerAgent).toBe(30);
  });
});

describe('envInt', () => {
  it('envInt ignores junk', () => {
    expect(envInt({ X: 'abc' }, 'X', 7)).toBe(7);
    expect(envInt({ X: '-3' }, 'X', 7)).toBe(7);
    expect(envInt({ X: '0' }, 'X', 7)).toBe(7);
    expect(envInt({ X: '1.5' }, 'X', 7)).toBe(7);
    expect(envInt({}, 'X', 7)).toBe(7);
    expect(envInt({ X: '12' }, 'X', 7)).toBe(12);
  });
});

describe('DEFAULT_INSTRUCTION', () => {
  it('names Sammy and the domain', () => {
    const text = DEFAULT_INSTRUCTION('example.com');
    expect(text.startsWith('You are Sammy, a friendly and knowledgeable customer support agent for example.com.')).toBe(true);
  });
});
