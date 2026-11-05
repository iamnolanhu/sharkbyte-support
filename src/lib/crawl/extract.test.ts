import { describe, it, expect } from 'vitest';
import { extractPage } from './extract';

const html = `<html><head><title> My Docs </title><script>var secret = 1;</script></head>
<body><nav><a href="/nav-link">Navigation text</a></nav>
<main><h1>Heading</h1><p>Main   paragraph
with spaces.</p><p>Second paragraph.</p></main>
<script>console.log('hidden code')</script></body></html>`;

describe('extractPage', () => {
  it('keeps main content and drops chrome', () => {
    const page = extractPage(html, 'https://example.com/');
    expect(page.title).toBe('My Docs');
    expect(page.text).toContain('Main paragraph with spaces.');
    expect(page.text).toContain('Second paragraph.');
    expect(page.text).toContain('Heading\n\nMain paragraph');
    expect(page.text).not.toContain('Navigation text');
    expect(page.text).not.toContain('hidden code');
    expect(page.text).not.toContain('secret');
  });

  it('collects nav links before stripping', () => {
    const page = extractPage(html, 'https://example.com/docs/');
    expect(page.links).toContain('https://example.com/nav-link');
  });

  it('falls back to body when there is no main', () => {
    const page = extractPage('<body><div>Plain body text</div></body>', 'https://example.com/');
    expect(page.text).toBe('Plain body text');
    expect(page.title).toBe('');
  });
});
