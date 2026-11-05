import * as cheerio from 'cheerio';
import { domainKey, normalizeSubmittedUrl } from './url-guard';
import type { SafeFetchResult } from './safe-fetch';

export type Fetcher = (url: string, accept: 'html' | 'xml') => Promise<SafeFetchResult | null>;

const MAX_CHILD_SITEMAPS = 5;
const SKIPPED_EXTENSIONS = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'zip', 'mp4', 'mp3', 'css', 'js', 'json', 'xml', 'gz',
]);

/** Returns a clean same-site page URL, or null if it must not be crawled. */
function toPageUrl(raw: string, base: string, siteKey: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim(), base);
    url.hash = '';
    url.search = '';
    url = normalizeSubmittedUrl(url.href);
  } catch {
    return null;
  }
  if (domainKey(url) !== siteKey) return null;
  const last = url.pathname.split('/').pop() ?? '';
  const dot = last.lastIndexOf('.');
  if (dot > 0 && SKIPPED_EXTENSIONS.has(last.slice(dot + 1).toLowerCase())) return null;
  return url.href;
}

function sitemapLocs(xml: string): { isIndex: boolean; locs: string[] } {
  const $ = cheerio.load(xml, { xml: true });
  const locs = $('loc')
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  return { isIndex: $('sitemapindex').length > 0, locs };
}

export async function discoverUrls(seed: URL, fetcher: Fetcher, maxPages: number): Promise<string[]> {
  const siteKey = domainKey(seed);
  const found = new Set<string>();
  const add = (href: string | null) => {
    if (href && found.size < maxPages) found.add(href);
  };

  const seedHref = new URL(seed.href);
  seedHref.hash = '';
  add(seedHref.href);

  const sitemapUrl = `${seed.origin}/sitemap.xml`;
  const sitemap = await fetcher(sitemapUrl, 'xml');
  if (sitemap) {
    const { isIndex, locs } = sitemapLocs(sitemap.body);
    if (isIndex) {
      const children = locs
        .map((loc) => toSitemapUrl(loc, sitemapUrl, siteKey))
        .filter((u): u is string => u !== null)
        .slice(0, MAX_CHILD_SITEMAPS);
      for (const child of children) {
        const res = await fetcher(child, 'xml');
        if (!res) continue;
        for (const loc of sitemapLocs(res.body).locs) add(toPageUrl(loc, child, siteKey));
      }
    } else {
      for (const loc of locs) add(toPageUrl(loc, sitemapUrl, siteKey));
    }
  }

  if (found.size <= 1) {
    const page = await fetcher(seedHref.href, 'html');
    if (page) {
      const $ = cheerio.load(page.body);
      $('a[href]').each((_, el) => {
        add(toPageUrl($(el).attr('href') ?? '', page.url, siteKey));
      });
    }
  }

  return [...found];
}

/** Child sitemap URLs are fetched too, so they get the same site and safety checks (but keep `.xml`). */
function toSitemapUrl(raw: string, base: string, siteKey: string): string | null {
  try {
    const url = normalizeSubmittedUrl(new URL(raw.trim(), base).href);
    return domainKey(url) === siteKey ? url.href : null;
  } catch {
    return null;
  }
}
