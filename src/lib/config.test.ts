import { describe, it, expect } from 'vitest';
import {
  DEFAULT_INSTRUCTION,
  envInt,
  getLimits,
  LEGACY_DEFAULT_INSTRUCTION,
  PREVIOUS_DEFAULT_INSTRUCTION,
  upgradeLegacyInstruction,
} from '@/lib/config';

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
  it('names Sammy and the domain once, with no canned replies or source talk', () => {
    const text = DEFAULT_INSTRUCTION('example.com');
    expect(text.startsWith('You are Sammy, the friendly support agent for example.com.')).toBe(true);
    // The domain once: Sammy echoes a domain it sees twice in the prompt.
    expect(text.split('example.com')).toHaveLength(2);
    expect(text).not.toMatch(/rephrase|provided|knowledge base|ONLY/i);
  });
});

describe('upgradeLegacyInstruction', () => {
  it('moves the untouched DigitalOcean-era default to the current default for its domain', () => {
    expect(upgradeLegacyInstruction(LEGACY_DEFAULT_INSTRUCTION('aria.org.uk'))).toBe(DEFAULT_INSTRUCTION('aria.org.uk'));
    const crlf = LEGACY_DEFAULT_INSTRUCTION('reef.example').replace(/\n/g, '\r\n');
    expect(upgradeLegacyInstruction(`  ${crlf}\n`)).toBe(DEFAULT_INSTRUCTION('reef.example'));
  });

  it('moves the untouched previous default (domain named twice) to the current default', () => {
    expect(PREVIOUS_DEFAULT_INSTRUCTION('aria.org.uk')).toBe(
      'You are Sammy, the friendly support agent for aria.org.uk. You help visitors with questions about aria.org.uk and what we offer.',
    );
    expect(upgradeLegacyInstruction(PREVIOUS_DEFAULT_INSTRUCTION('aria.org.uk'))).toBe(DEFAULT_INSTRUCTION('aria.org.uk'));
    expect(upgradeLegacyInstruction(`  ${PREVIOUS_DEFAULT_INSTRUCTION('reef.example')}\r\n`)).toBe(DEFAULT_INSTRUCTION('reef.example'));
  });

  it('leaves an edited previous default alone', () => {
    const previous = PREVIOUS_DEFAULT_INSTRUCTION('reef.example');
    expect(upgradeLegacyInstruction(`${previous} Always mention our sale.`)).toBeNull();
    expect(upgradeLegacyInstruction(previous.replace('friendly', 'cheerful'))).toBeNull();
    expect(
      upgradeLegacyInstruction(
        'You are Sammy, the friendly support agent for reef.example. You help visitors with questions about tide.example and what we offer.',
      ),
    ).toBeNull();
    expect(upgradeLegacyInstruction(PREVIOUS_DEFAULT_INSTRUCTION('reef example'))).toBeNull();
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
