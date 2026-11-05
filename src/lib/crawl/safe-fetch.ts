import { fetch as undiciFetch, type Dispatcher } from 'undici';
import { APP_DOMAIN } from '@/lib/config';
import { UnsafeUrlError, assertPublicUrl, domainKey, guardedDispatcher, type LookupFn } from './url-guard';

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

export type GuardedFetch = (url: string, init: RequestInit & { dispatcher: Dispatcher }) => Promise<Response>;

export interface SafeFetchOptions {
  timeoutMs: number;
  maxBytes: number;
  accept: 'html' | 'xml';
  lookup?: LookupFn;
  fetchImpl?: GuardedFetch;
  dispatcher?: Dispatcher;
  userAgent: string;
}

export const CRAWLER_USER_AGENT = `SharkByteBot/1.0 (+https://${APP_DOMAIN})`;

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

// The undici Response and the DOM Response are structurally the same for what we use.
const defaultFetch = undiciFetch as unknown as GuardedFetch;

function contentTypeAllowed(type: string, accept: 'html' | 'xml'): boolean {
  const t = type.toLowerCase();
  return accept === 'html' ? t.includes('text/html') : t.includes('xml') || t.includes('text/plain');
}

async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Fetch one page or sitemap for the crawler. Every hop is checked up front and again at connect time by the
 * guarded dispatcher. Returns null on any failure and never throws.
 */
export async function safeFetch(startUrl: string, opts: SafeFetchOptions): Promise<SafeFetchResult | null> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const dispatcher = opts.dispatcher ?? guardedDispatcher;
  const userAgent = opts.userAgent;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, opts.timeoutMs);
  });

  const run = async (): Promise<SafeFetchResult | null> => {
    let current = new URL(startUrl);
    const startSite = domainKey(current);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicUrl(current, opts.lookup);
      const res = await fetchImpl(current.href, {
        dispatcher,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': userAgent,
          accept: opts.accept === 'html' ? 'text/html,application/xhtml+xml' : 'application/xml,text/xml,text/plain',
        },
      });
      if (REDIRECT_STATUSES.has(res.status)) {
        const location = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!location || hop === MAX_REDIRECTS) throw new UnsafeUrlError('Too many redirects');
        const next = new URL(location, current);
        await assertPublicUrl(next, opts.lookup);
        if (domainKey(next) !== startSite) throw new UnsafeUrlError('Redirect leaves the site');
        current = next;
        continue;
      }
      const contentType = res.headers.get('content-type') ?? '';
      if (!res.ok || !contentTypeAllowed(contentType, opts.accept)) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      const body = await readCapped(res, opts.maxBytes);
      if (body === null) return null;
      return { url: current.href, status: res.status, contentType, body };
    }
    return null;
  };

  try {
    return await Promise.race([run().catch(() => null), timedOut]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}
