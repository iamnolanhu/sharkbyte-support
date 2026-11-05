// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Vitest runs from the project root; under jsdom `import.meta.url` is not a file URL.
const WIDGET_SOURCE = readFileSync(resolve(process.cwd(), 'public', 'widget.js'), 'utf8');
const ORIGIN = 'https://sharkbyte.example';
const AGENT_ID = '7d6f0a52-1c1e-4b7a-9d55-0d2f3c1b9e11';

/** Run widget.js as if it were loaded by a <script> tag carrying these attributes. */
function runWidget(attributes: Record<string, string>): void {
  const script = document.createElement('script');
  script.src = `${ORIGIN}/widget.js`;
  for (const [name, value] of Object.entries(attributes)) script.setAttribute(name, value);
  Object.defineProperty(document, 'currentScript', { value: script, configurable: true });
  new Function(WIDGET_SOURCE)();
}

function container(): HTMLElement | null {
  return document.getElementById('sharkbyte-widget-container');
}

function iframeUrl(): URL {
  const iframe = container()?.querySelector('iframe');
  if (!iframe) throw new Error('no iframe mounted');
  return new URL(iframe.src);
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  Object.defineProperty(document, 'currentScript', { value: null, configurable: true });
});

describe('widget.js', () => {
  it('an old snippet with endpoint and access key still mounts', () => {
    runWidget({
      'data-agent-id': AGENT_ID,
      'data-endpoint': 'https://old-agent.example/api/v1',
      'data-access-key': 'old-access-key-value',
      'data-primary-color': '#FF6B6B',
      'data-position': 'bottom-left',
    });
    const url = iframeUrl();
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe(`/embed/${AGENT_ID}`);
    expect(url.searchParams.get('color')).toBe('#FF6B6B');
    expect(url.searchParams.get('position')).toBe('bottom-left');
    expect([...url.searchParams.keys()].sort()).toEqual(['color', 'position']);
    expect(url.href).not.toContain('old-access-key-value');
    expect(url.href).not.toContain('old-agent.example');
  });

  it('a new snippet without endpoint mounts', () => {
    runWidget({ 'data-agent-id': AGENT_ID, 'data-welcome-message': 'Ahoy 100% there' });
    const url = iframeUrl();
    expect(url.pathname).toBe(`/embed/${AGENT_ID}`);
    expect(url.searchParams.get('color')).toBe('#0080FF');
    expect(url.searchParams.get('position')).toBe('bottom-right');
    expect(url.searchParams.get('welcome')).toBe('Ahoy 100% there');
    expect([...url.searchParams.keys()].sort()).toEqual(['color', 'position', 'welcome']);
  });

  it('a snippet without data-agent-id mounts nothing', () => {
    runWidget({ 'data-endpoint': 'https://old-agent.example/api/v1' });
    expect(container()).toBeNull();
  });

  it('resize messages from the widget origin resize the container', () => {
    runWidget({ 'data-agent-id': AGENT_ID });
    const box = container();
    if (!box) throw new Error('no container mounted');
    expect(box.style.width).toBe('64px');

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://someone-else.example',
        data: { type: 'sharkbyte:open', payload: { width: 380, height: 500 } },
      }),
    );
    expect(box.style.width).toBe('64px');

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: ORIGIN,
        data: { type: 'sharkbyte:open', payload: { width: 380, height: 500 } },
      }),
    );
    expect(box.style.width).toBe('380px');
    expect(box.style.height).toBe('500px');
  });
});
