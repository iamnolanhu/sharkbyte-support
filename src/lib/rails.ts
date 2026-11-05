import type { Db } from '@/lib/db/client';
import { incrementQuota, readQuota } from '@/lib/db/quota';
import type { Limits } from '@/lib/config';

export type RailName =
  | 'create_ip'
  | 'crawl_daily'
  | 'capacity'
  | 'chat_ip'
  | 'chat_tokens'
  | 'firecrawl_daily';

export const RAIL_COPY: Record<RailName, string> = {
  create_ip: 'Whoa, slow your swim! You can make 3 Sammys an hour — try again soon.',
  crawl_daily: 'Sammy has explored enough reefs for today — the free demo resets tomorrow.',
  capacity: 'The free demo is full right now — try again tomorrow',
  chat_ip: 'Easy there, fast fins! Give Sammy a minute to catch up.',
  chat_tokens: 'The free demo is resting until tomorrow',
  // Internal: never shown, it only skips the Firecrawl fallback.
  firecrawl_daily: '',
};

export interface RailBlocked {
  ok: false;
  rail: RailName;
  message: string;
}

export type RailResult = { ok: true } | RailBlocked;

type CountedRail = Exclude<RailName, 'capacity' | 'chat_tokens'>;

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

function blocked(rail: RailName): RailBlocked {
  return { ok: false, rail, message: RAIL_COPY[rail] };
}

function nextUtcMidnight(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

function day(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Quota key for a rail: per-IP rails are bucketed by hour or minute, global ones by UTC day. */
export function railKey(rail: CountedRail | 'chat_tokens', ip: string, now: Date): string {
  const iso = now.toISOString();
  switch (rail) {
    case 'create_ip':
      return `ip:${ip}:create:${iso.slice(0, 13)}`;
    case 'chat_ip':
      return `ip:${ip}:chat:${iso.slice(0, 16)}`;
    case 'crawl_daily':
      return `global:crawls:${day(now)}`;
    case 'chat_tokens':
      return `global:chat_tokens:${day(now)}`;
    case 'firecrawl_daily':
      return `global:firecrawl:${day(now)}`;
  }
}

function expiry(rail: CountedRail | 'chat_tokens', now: Date): Date {
  if (rail === 'create_ip') return new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS + HOUR_MS);
  if (rail === 'chat_ip') return new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS + MINUTE_MS);
  return nextUtcMidnight(now);
}

function limitFor(rail: CountedRail, limits: Limits): number {
  switch (rail) {
    case 'create_ip':
      return limits.createsPerIpPerHour;
    case 'chat_ip':
      return limits.chatMessagesPerIpPerMinute;
    case 'crawl_daily':
      return limits.maxCrawlsPerDay;
    case 'firecrawl_daily':
      return limits.maxFirecrawlPerDay;
  }
}

/** Counts one use of the rail, then compares against its limit. */
export async function checkRail(
  db: Db,
  rail: CountedRail,
  subject: { ip: string },
  now: Date,
  limits: Limits,
): Promise<RailResult> {
  const count = await incrementQuota(db, railKey(rail, subject.ip, now), 1, expiry(rail, now), now);
  return count > limitFor(rail, limits) ? blocked(rail) : { ok: true };
}

/** Read-only: blocks once the day's chat token budget is spent. */
export async function checkChatTokenBudget(db: Db, now: Date, limits: Limits): Promise<RailResult> {
  const spent = await readQuota(db, railKey('chat_tokens', '', now), now);
  return spent >= limits.maxChatTokensPerDay ? blocked('chat_tokens') : { ok: true };
}

export async function addChatTokens(db: Db, tokens: number, now: Date): Promise<void> {
  await incrementQuota(db, railKey('chat_tokens', '', now), tokens, expiry('chat_tokens', now), now);
}

export function getClientIp(headers: Headers): string {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return first || 'unknown';
}

export function railResponse(blockedRail: RailBlocked, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('Content-Type', 'application/json');
  return new Response(
    JSON.stringify({ success: false, error: blockedRail.message, rail: blockedRail.rail }),
    { status: 429, headers },
  );
}
