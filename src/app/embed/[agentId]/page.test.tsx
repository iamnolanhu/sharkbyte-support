import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReactElement } from 'react';
import { setDbForTests, type Db } from '@/lib/db/client';
import { finishCrawl, insertAgent } from '@/lib/db/agents';
import { createTestDb, TEST_DB_TIMEOUT_MS } from '@/test/test-db';
import { EmbedChatWidget } from '@/components/embed-chat-widget';
import EmbedPage from './page';

// The widget is a client component; the page is only checked for what it hands over.
vi.mock('@/components/embed-chat-widget', () => ({ EmbedChatWidget: () => null }));

type EmbedProps = Record<string, unknown>;

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  setDbForTests(db);
}, TEST_DB_TIMEOUT_MS);

afterEach(() => {
  setDbForTests(null);
});

async function renderPage(agentId: string, query: Record<string, string> = {}): Promise<ReactElement<EmbedProps>> {
  return (await EmbedPage({
    params: Promise.resolve({ agentId }),
    searchParams: Promise.resolve(query),
  })) as ReactElement<EmbedProps>;
}

describe('embed page', () => {
  it('embed page renders the retired state', async () => {
    for (const agentId of ['not-a-uuid', '3f0c2a5e-8b4d-4e2a-9c1f-5a6b7c8d9e0f']) {
      const element = await renderPage(agentId, { color: '#FF6B6B' });
      expect(element.type).toBe(EmbedChatWidget);
      expect(String(element.props.retiredMessage)).toMatch(/^This Sammy has retired/);
    }
  });

  it('embed page ignores old endpoint and accessKey params', async () => {
    const agent = await insertAgent(db, {
      domain: 'example.com',
      url: 'https://example.com',
      name: 'Sammy - example.com',
      instruction: 'x',
      ownerTokenHash: null,
      pinned: false,
      now: new Date(),
    });
    if (!agent) throw new Error('insert failed');
    await finishCrawl(db, agent.id, { status: 'ready', lastError: null });

    const element = await renderPage(agent.id, {
      endpoint: 'https://old-agent.example/api/v1',
      accessKey: 'old-access-key-value',
      color: '#FF6B6B',
      position: 'bottom-left',
      welcome: 'Ahoy 100% there',
    });
    expect(element.type).toBe(EmbedChatWidget);
    expect(element.props.agentId).toBe(agent.id);
    expect(element.props).not.toHaveProperty('retiredMessage');
    expect(element.props).not.toHaveProperty('endpoint');
    expect(element.props).not.toHaveProperty('accessKey');
    expect(element.props.primaryColor).toBe('#FF6B6B');
    expect(element.props.position).toBe('bottom-left');
    expect(element.props.welcomeMessage).toBe('Ahoy 100% there');
  });
});
