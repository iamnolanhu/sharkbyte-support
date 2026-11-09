import { describe, it, expect } from 'vitest';
import { DEFAULT_INSTRUCTION, envInt, getLimits, LEGACY_DEFAULT_INSTRUCTION, upgradeLegacyInstruction } from '@/lib/config';

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
    ]).toEqual([30, 300, 40000, 20, 500000, 50]);
    expect(l.maxEmbedRequestsPerDay).toBe(900);
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
  it('names Sammy and the domain, with no canned replies or source talk', () => {
    const text = DEFAULT_INSTRUCTION('example.com');
    expect(text.startsWith('You are Sammy, the friendly support agent for example.com.')).toBe(true);
    expect(text).not.toMatch(/rephrase|provided|knowledge base|ONLY/i);
  });
});

describe('upgradeLegacyInstruction', () => {
  it('moves the untouched DigitalOcean-era default to the current default for its domain', () => {
    expect(upgradeLegacyInstruction(LEGACY_DEFAULT_INSTRUCTION('aria.org.uk'))).toBe(DEFAULT_INSTRUCTION('aria.org.uk'));
    const crlf = LEGACY_DEFAULT_INSTRUCTION('reef.example').replace(/\n/g, '\r\n');
    expect(upgradeLegacyInstruction(`  ${crlf}\n`)).toBe(DEFAULT_INSTRUCTION('reef.example'));
  });

  it('leaves any edited or custom instruction alone', () => {
    const legacy = LEGACY_DEFAULT_INSTRUCTION('reef.example');
    expect(upgradeLegacyInstruction(`${legacy}\n- Always mention our sale`)).toBeNull();
    expect(upgradeLegacyInstruction(legacy.replace('concise', 'brief'))).toBeNull();
    expect(upgradeLegacyInstruction(LEGACY_DEFAULT_INSTRUCTION('reef example'))).toBeNull();
    expect(upgradeLegacyInstruction('Talk like a pirate.')).toBeNull();
    expect(upgradeLegacyInstruction(DEFAULT_INSTRUCTION('reef.example'))).toBeNull();
  });
});
