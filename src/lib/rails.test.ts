import { describe, it, expect, beforeEach } from 'vitest';
import type { Db } from '@/lib/db/client';
import { getLimits } from '@/lib/config';
import { acquireLock, incrementQuota, readQuota, releaseLock } from '@/lib/db/quota';
import {
  addChatTokens,
  checkChatTokenBudget,
  checkRail,
  getClientIp,
  railResponse,
  type RailBlocked,
} from '@/lib/rails';
import { createTestDb, TEST_DB_TIMEOUT_MS } from '@/test/test-db';

const limits = getLimits({});
const IP = { ip: '203.0.113.7' };

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
}, TEST_DB_TIMEOUT_MS);

describe('rails', () => {
  it('fourth create in the same hour is blocked', async () => {
    const now = new Date('2026-11-05T10:15:00.000Z');
    for (let i = 0; i < 3; i++) {
      expect(await checkRail(db, 'create_ip', IP, now, limits)).toEqual({ ok: true });
    }
    const fourth = await checkRail(db, 'create_ip', IP, now, limits);
    expect(fourth).toMatchObject({ ok: false, rail: 'create_ip' });
  });

  it('create window resets next hour', async () => {
    for (let i = 0; i < 3; i++) {
      await checkRail(db, 'create_ip', IP, new Date('2026-11-05T10:20:00.000Z'), limits);
    }
    const blocked = await checkRail(db, 'create_ip', IP, new Date('2026-11-05T10:59:00.000Z'), limits);
    expect(blocked.ok).toBe(false);
    const next = await checkRail(db, 'create_ip', IP, new Date('2026-11-05T11:00:00.000Z'), limits);
    expect(next).toEqual({ ok: true });
  });

  it('21st chat message in a minute is blocked', async () => {
    const now = new Date('2026-11-05T10:15:30.000Z');
    for (let i = 0; i < 20; i++) {
      expect(await checkRail(db, 'chat_ip', IP, now, limits)).toEqual({ ok: true });
    }
    expect(await checkRail(db, 'chat_ip', IP, now, limits)).toMatchObject({ ok: false, rail: 'chat_ip' });
    const later = new Date('2026-11-05T10:16:00.000Z');
    expect(await checkRail(db, 'chat_ip', IP, later, limits)).toEqual({ ok: true });
  });

  it('crawl_daily blocks after MAX_CRAWLS_PER_DAY', async () => {
    const small = getLimits({ MAX_CRAWLS_PER_DAY: '2' });
    const now = new Date('2026-11-05T10:00:00.000Z');
    expect((await checkRail(db, 'crawl_daily', IP, now, small)).ok).toBe(true);
    expect((await checkRail(db, 'crawl_daily', IP, now, small)).ok).toBe(true);
    expect(await checkRail(db, 'crawl_daily', IP, now, small)).toMatchObject({
      ok: false,
      rail: 'crawl_daily',
    });
  });

  it('firecrawl_daily blocks after MAX_FIRECRAWL_PER_DAY', async () => {
    const small = getLimits({ MAX_FIRECRAWL_PER_DAY: '1' });
    const now = new Date('2026-11-05T10:00:00.000Z');
    expect((await checkRail(db, 'firecrawl_daily', IP, now, small)).ok).toBe(true);
    expect(await checkRail(db, 'firecrawl_daily', IP, now, small)).toMatchObject({
      ok: false,
      rail: 'firecrawl_daily',
    });
  });

  it('chat token budget blocks once spent', async () => {
    const now = new Date('2026-11-05T10:00:00.000Z');
    expect(await checkChatTokenBudget(db, now, limits)).toEqual({ ok: true });
    await addChatTokens(db, 500000, now);
    expect(await checkChatTokenBudget(db, now, limits)).toEqual({
      ok: false,
      rail: 'chat_tokens',
      message: 'The free demo is resting until tomorrow',
    });
    expect(await checkChatTokenBudget(db, new Date('2026-11-06T00:00:00.000Z'), limits)).toEqual({
      ok: true,
    });
  });

  it('railResponse is a 429 with the rail in the body', async () => {
    const blocked: RailBlocked = { ok: false, rail: 'chat_ip', message: 'Slow down' };
    const res = railResponse(blocked, { 'Retry-After': '60' });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(await res.json()).toEqual({ success: false, error: 'Slow down', rail: 'chat_ip' });
  });

  it('getClientIp prefers x-real-ip, then first x-forwarded-for, then unknown', () => {
    expect(
      getClientIp(new Headers({ 'x-real-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2, 3.3.3.3' })),
    ).toBe('1.1.1.1');
    expect(getClientIp(new Headers({ 'x-forwarded-for': '2.2.2.2, 3.3.3.3' }))).toBe('2.2.2.2');
    expect(getClientIp(new Headers())).toBe('unknown');
  });
});

describe('quota store', () => {
  const t0 = new Date('2026-11-05T10:00:00.000Z');
  const t1 = new Date('2026-11-05T10:30:00.000Z');

  it('expired quota rows restart at by', async () => {
    const expires = new Date('2026-11-05T10:10:00.000Z');
    expect(await incrementQuota(db, 'k', 1, expires, t0)).toBe(1);
    expect(await incrementQuota(db, 'k', 2, expires, t0)).toBe(3);
    expect(await readQuota(db, 'k', t0)).toBe(3);
    expect(await readQuota(db, 'k', t1)).toBe(0);
    const later = new Date('2026-11-05T11:00:00.000Z');
    expect(await incrementQuota(db, 'k', 5, later, t1)).toBe(5);
    expect(await readQuota(db, 'missing', t0)).toBe(0);
  });

  it('a lock is exclusive until it expires or is released', async () => {
    expect(await acquireLock(db, 'create:example.com', t0, 60_000)).toBe(true);
    expect(await acquireLock(db, 'create:example.com', new Date(t0.getTime() + 1000), 60_000)).toBe(false);
    expect(await acquireLock(db, 'create:example.com', new Date(t0.getTime() + 60_000), 60_000)).toBe(true);
    await releaseLock(db, 'create:example.com');
    expect(await acquireLock(db, 'create:example.com', t0, 60_000)).toBe(true);
  });
});
