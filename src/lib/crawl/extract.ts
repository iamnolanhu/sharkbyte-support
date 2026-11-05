import * as cheerio from 'cheerio';

export interface ExtractedPage {
  title: string;
  text: string;
  links: string[];
}

const BLOCK_SELECTOR =
  'p, div, section, article, main, header, footer, h1, h2, h3, h4, h5, h6, li, ul, ol, tr, table, pre, blockquote, dd, dt, dl';
const BREAK = '\uE000';

export function extractPage(html: string, baseUrl: string): ExtractedPage {
  const $ = cheerio.load(html);

  const links: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const url = new URL(href, baseUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:') links.push(url.href);
    } catch {
      // unparseable href: ignore
    }
  });

  const title = $('title').first().text().replace(/\s+/g, ' ').trim();

  $('script, style, nav, aside, form, iframe, noscript').remove();

  const root = ['main', 'article', '[role=main]']
    .map((selector) => $(selector).first())
    .find((el) => el.length > 0) ?? $('body');

  root.find('br').replaceWith(BREAK);
  root.find(BLOCK_SELECTOR).each((_, el) => {
    $(el).append(BREAK);
  });

  const text = root
    .text()
    .replace(/\s+/g, ' ')
    .split(BREAK)
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n');

  return { title, text, links };
}
