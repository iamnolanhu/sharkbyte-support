import { describe, it, expect } from 'vitest';
import { discoverUrls, type Fetcher } from './discover';
import type { SafeFetchResult } from './safe-fetch';

function res(url: string, body: string, contentType = 'text/html'): SafeFetchResult {
  return { url, status: 200, contentType, body };
}

function mapFetcher(pages: Record<string, string>): Fetcher {
  return async (url, accept) => {
    const body = pages[url];
    if (body === undefined) return null;
    return res(url, body, accept === 'xml' ? 'application/xml' : 'text/html');
  };
}

const urlset = (...locs: string[]) =>
  `<?xml version="1.0"?><urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`;

describe('discoverUrls', () => {
  const seed = new URL('https://example.com/');

  it('reads a sitemap index', async () => {
    const fetcher = mapFetcher({
      'https://example.com/sitemap.xml':
        '<sitemapindex><sitemap><loc>https://example.com/s1.xml</loc></sitemap><sitemap><loc>https://example.com/s2.xml</loc></sitemap></sitemapindex>',
      'https://example.com/s1.xml': urlset('https://example.com/a', 'https://example.com/b'),
      'https://example.com/s2.xml': urlset('https://example.com/c', 'https://example.com/d'),
    });
    const urls = await discoverUrls(seed, fetcher, 30);
    expect(urls[0]).toBe('https://example.com/');
    expect(urls).toHaveLength(5);
    expect(urls).toContain('https://example.com/d');
  });

  it('falls back to homepage links', async () => {
    const fetcher = mapFetcher({
      'https://example.com/': '<a href="/docs">Docs</a><a href="https://example.com/blog#top">Blog</a><a href="/logo.png">x</a>',
    });
    const urls = await discoverUrls(seed, fetcher, 30);
    expect(urls).toEqual(['https://example.com/', 'https://example.com/docs', 'https://example.com/blog']);
  });

  it('drops off-site and private locs', async () => {
    const fetcher = mapFetcher({
      'https://example.com/sitemap.xml': urlset(
        'https://other.com/x',
        'http://127.0.0.1/admin',
        'http://10.0.0.5/secret',
        'http://localhost/y',
        'https://www.example.com/ok',
        'https://example.com/file.pdf',
        'https://example.com/pack.xml.gz',
        'https://example.com/fine',
      ),
    });
    const urls = await discoverUrls(seed, fetcher, 30);
    expect(urls).toEqual(['https://example.com/', 'https://www.example.com/ok', 'https://example.com/fine']);
  });

  it('caps at maxPages and dedupes', async () => {
    const fetcher = mapFetcher({
      'https://example.com/sitemap.xml': urlset(
        'https://example.com/',
        'https://example.com/a',
        'https://example.com/a?utm=1',
        'https://example.com/a#frag',
        'https://example.com/b',
        'https://example.com/c',
      ),
    });
    const urls = await discoverUrls(seed, fetcher, 3);
    expect(urls).toEqual(['https://example.com/', 'https://example.com/a', 'https://example.com/b']);
  });

  it('reads at most 5 child sitemaps', async () => {
    const children = Array.from({ length: 7 }, (_, i) => `https://example.com/s${i}.xml`);
    const pages: Record<string, string> = {
      'https://example.com/sitemap.xml': `<sitemapindex>${children.map((c) => `<sitemap><loc>${c}</loc></sitemap>`).join('')}</sitemapindex>`,
    };
    children.forEach((c, i) => {
      pages[c] = urlset(`https://example.com/p${i}`);
    });
    const urls = await discoverUrls(seed, mapFetcher(pages), 50);
    expect(urls).toHaveLength(6);
    expect(urls).not.toContain('https://example.com/p5');
  });
});
