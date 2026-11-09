import { describe, it, expect } from 'vitest';
import { mergeHistory, parseListedAgents } from '@/lib/history-list';
import type { PublicAgent, StoredAgent } from '@/types';

function server(id: string, domain: string, extra: Partial<PublicAgent> = {}): PublicAgent {
  return {
    id,
    name: `Sammy - ${domain}`,
    domain,
    url: `https://${domain}`,
    status: 'ready',
    pagesCrawled: 1,
    pagesTotal: 1,
    chunkCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: '2026-01-01T00:00:00.000Z',
    pinned: false,
    instruction: 'Be nice.',
    lastError: null,
    ...extra,
  };
}

function stored(id: string, url: string, createdAt = '2026-02-01T00:00:00.000Z'): StoredAgent {
  return { id, name: `Sammy - ${url}`, url, createdAt, ownerToken: 'tok' };
}

describe('mergeHistory', () => {
  it('puts this browser\'s agents first, marked as mine, then the server list', () => {
    const entries = mergeHistory(
      [stored('l1', 'https://mine.example/docs')],
      [server('s1', 'pinned.example', { pinned: true }), server('s2', 'other.example')],
    );
    expect(entries.map((e) => [e.id, e.host, e.mine])).toEqual([
      ['l1', 'mine.example', true],
      ['s1', 'pinned.example', false],
      ['s2', 'other.example', false],
    ]);
  });

  it('dedupes by id, keeping the local entry and the server status', () => {
    const entries = mergeHistory(
      [stored('a', 'https://a.example'), stored('a', 'https://a.example')],
      [server('b', 'b.example'), server('a', 'a.example', { status: 'crawling' }), server('b', 'b.example')],
    );
    expect(entries.map((e) => [e.id, e.mine, e.status])).toEqual([
      ['a', true, 'crawling'],
      ['b', false, 'ready'],
    ]);
  });

  it('keeps a local agent the server no longer lists', () => {
    const entries = mergeHistory([stored('gone', 'https://gone.example')], []);
    expect(entries).toEqual([
      { id: 'gone', host: 'gone.example', createdAt: '2026-02-01T00:00:00.000Z', mine: true, status: undefined },
    ]);
  });

  it('is empty only when both lists are empty', () => {
    expect(mergeHistory([], [])).toEqual([]);
    expect(mergeHistory([], [server('s', 's.example')])).toHaveLength(1);
  });
});

describe('parseListedAgents', () => {
  it('reads the agents of a success body and drops malformed entries', () => {
    const good = server('s', 's.example');
    expect(parseListedAgents({ success: true, agents: [good, { id: 5 }, null] })).toEqual([good]);
  });

  it('returns [] for errors and junk', () => {
    for (const body of [null, 'x', { success: false, error: 'no' }, { success: true, agents: 'nope' }]) {
      expect(parseListedAgents(body)).toEqual([]);
    }
  });
});
