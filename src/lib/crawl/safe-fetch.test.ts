import { describe, it, expect, vi } from 'vitest';
import { fetch as undiciFetch } from 'undici';
import { createGuardedDispatcher, UnsafeUrlError } from './url-guard';
import { safeFetch, type GuardedFetch } from './safe-fetch';

const publicLookup = async () => ['93.184.216.34'];
const base = { timeoutMs: 1000, maxBytes: 1_000_000, accept: 'html' as const, lookup: publicLookup, userAgent: 'TestBot/1.0' };

function html(body = '<html>ok</html>', type = 'text/html; charset=utf-8'): Response {
  return new Response(body, { status: 200, headers: { 'content-type': type } });
}
function redirect(location: string, status = 301): Response {
  return new Response(null, { status, headers: { location } });
}

describe('safeFetch', () => {
  it('refuses a redirect to a private address', async () => {
    const fetchImpl = vi.fn<GuardedFetch>().mockResolvedValue(redirect('http://169.254.169.254/'));
    const result = await safeFetch('https://example.com/a', { ...base, fetchImpl });
    expect(result).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('follows a same-site redirect', async () => {
    const fetchImpl = vi
      .fn<GuardedFetch>()
      .mockResolvedValueOnce(redirect('https://www.example.com/b'))
      .mockResolvedValueOnce(html());
    const result = await safeFetch('https://example.com/a', { ...base, fetchImpl });
    expect(result?.url).toBe('https://www.example.com/b');
    expect(result?.status).toBe(200);
    expect(result?.body).toBe('<html>ok</html>');
  });

  it('resolves a relative Location against the current URL', async () => {
    const fetchImpl = vi.fn<GuardedFetch>().mockResolvedValueOnce(redirect('/b')).mockResolvedValueOnce(html());
    const result = await safeFetch('https://example.com/a', { ...base, fetchImpl });
    expect(result?.url).toBe('https://example.com/b');
  });

  it('refuses a redirect to another host', async () => {
    const fetchImpl = vi.fn<GuardedFetch>().mockResolvedValue(redirect('https://other.com/', 302));
    const result = await safeFetch('https://example.com/a', { ...base, fetchImpl });
    expect(result).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses a sixth redirect hop', async () => {
    const fetchImpl = vi.fn<GuardedFetch>().mockImplementation(async () => redirect('https://example.com/next'));
    const result = await safeFetch('https://example.com/a', { ...base, fetchImpl });
    expect(result).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it('follows exactly five redirects', async () => {
    const fetchImpl = vi.fn<GuardedFetch>();
    for (let i = 0; i < 5; i++) fetchImpl.mockResolvedValueOnce(redirect(`https://example.com/${i}`));
    fetchImpl.mockResolvedValueOnce(html());
    expect((await safeFetch('https://example.com/a', { ...base, fetchImpl }))?.url).toBe('https://example.com/4');
  });

  it('returns null past maxBytes', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(chunk);
        c.enqueue(chunk);
        c.close();
      },
    });
    const fetchImpl = vi
      .fn<GuardedFetch>()
      .mockResolvedValue(new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(await safeFetch('https://example.com/', { ...base, maxBytes: 1024 * 1024, fetchImpl })).toBeNull();
  });

  it('rejects non-html for accept html', async () => {
    const fetchImpl = vi.fn<GuardedFetch>().mockResolvedValue(html('%PDF', 'application/pdf'));
    expect(await safeFetch('https://example.com/', { ...base, fetchImpl })).toBeNull();
  });

  it('accepts xml and text/plain for accept xml', async () => {
    for (const type of ['application/xml', 'text/xml', 'text/plain']) {
      const fetchImpl = vi.fn<GuardedFetch>().mockResolvedValue(html('<urlset/>', type));
      expect((await safeFetch('https://example.com/sitemap.xml', { ...base, accept: 'xml', fetchImpl }))?.body).toBe('<urlset/>');
    }
  });

  it('returns null on a non-2xx status', async () => {
    const fetchImpl = vi.fn<GuardedFetch>().mockResolvedValue(new Response('no', { status: 404, headers: { 'content-type': 'text/html' } }));
    expect(await safeFetch('https://example.com/', { ...base, fetchImpl })).toBeNull();
  });

  it('times out', async () => {
    const fetchImpl = vi.fn<GuardedFetch>().mockImplementation(() => new Promise<Response>(() => {}));
    expect(await safeFetch('https://example.com/', { ...base, timeoutMs: 50, fetchImpl })).toBeNull();
  });

  it('returns null instead of throwing when fetch rejects', async () => {
    const fetchImpl = vi.fn<GuardedFetch>().mockRejectedValue(new Error('boom'));
    expect(await safeFetch('https://example.com/', { ...base, fetchImpl })).toBeNull();
  });

  it('passes the guarded dispatcher and manual redirect on every hop', async () => {
    const fetchImpl = vi
      .fn<GuardedFetch>()
      .mockResolvedValueOnce(redirect('https://example.com/b'))
      .mockResolvedValueOnce(html());
    await safeFetch('https://example.com/a', { ...base, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [first, second] = fetchImpl.mock.calls.map((c) => c[1]);
    expect(first.dispatcher).toBeDefined();
    expect(second.dispatcher).toBe(first.dispatcher);
    expect(first.redirect).toBe('manual');
    expect(new Headers(first.headers).get('user-agent')).toBe('TestBot/1.0');
  });

  it('rejects a host that resolves to a private address at connect time', async () => {
    const resolve = vi.fn<(host: string) => Promise<string[]>>();
    resolve.mockResolvedValueOnce(['93.184.216.34']).mockResolvedValue(['127.0.0.1']);
    const dispatcher = createGuardedDispatcher(resolve);
    try {
      const result = await safeFetch('http://rebind.test/', { ...base, lookup: resolve, dispatcher });
      expect(result).toBeNull();
      expect(resolve).toHaveBeenCalledTimes(2);

      resolve.mockClear();
      resolve.mockResolvedValue(['127.0.0.1']);
      const err: unknown = await undiciFetch('http://rebind.test/', { dispatcher }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).cause).toBeInstanceOf(UnsafeUrlError);
    } finally {
      await dispatcher.close();
    }
  });
});
