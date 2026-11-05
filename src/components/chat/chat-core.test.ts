import { describe, it, expect } from 'vitest';
import type { UIMessage } from 'ai';
import { COPY } from '@/lib/agent-api';
import { PROVIDERS_DOWN_COPY } from '@/lib/chat/copy';
import {
  LOCAL_ERROR_PREFIX,
  buildChatRequestBody,
  chatErrorCopy,
  toChatMessages,
} from './chat-core';

const REEF = 'Sorry, Sammy hit a reef. Please try again.';

function textMessage(id: string, role: UIMessage['role'], ...texts: string[]): UIMessage {
  return { id, role, parts: texts.map((text) => ({ type: 'text' as const, text })) };
}

describe('chatErrorCopy', () => {
  it('chatErrorCopy surfaces the server copy and rail', () => {
    const error = new Error(
      '{"success":false,"error":"The free demo is resting until tomorrow","rail":"chat_tokens"}',
    );
    expect(chatErrorCopy(error)).toEqual({
      text: 'The free demo is resting until tomorrow',
      rail: 'chat_tokens',
    });
  });

  it('chatErrorCopy surfaces server copy without a rail', () => {
    const error = new Error('{"success":false,"error":"That message is a whale"}');
    expect(chatErrorCopy(error)).toEqual({ text: 'That message is a whale' });
  });

  it('chatErrorCopy shows the providers-down copy when every model failed mid-stream', () => {
    // The server's stream error part carries this copy; the SDK raises it as `new Error(errorText)`.
    expect(chatErrorCopy(new Error(PROVIDERS_DOWN_COPY))).toEqual({ text: PROVIDERS_DOWN_COPY });
    expect(PROVIDERS_DOWN_COPY).toBe(COPY.providersDown);
  });

  it('chatErrorCopy falls back to the reef line', () => {
    expect(chatErrorCopy(new Error('Failed to fetch'))).toEqual({ text: REEF });
    expect(chatErrorCopy(new Error('{"success":true}'))).toEqual({ text: REEF });
    expect(chatErrorCopy(new Error('[1,2]'))).toEqual({ text: REEF });
    expect(chatErrorCopy(new Error(''))).toEqual({ text: REEF });
  });
});

describe('buildChatRequestBody', () => {
  it('buildChatRequestBody drops a rejected user message and its error bubble, then sends the next one', () => {
    const messages = [
      textMessage('u1', 'user', 'x'.repeat(70_000)),
      textMessage(`${LOCAL_ERROR_PREFIX}1`, 'assistant', 'That message is a whale'),
      textMessage('u2', 'user', 'hello again'),
    ];
    const body = buildChatRequestBody('agent-1', messages);
    expect(body.agentId).toBe('agent-1');
    expect(body.messages.map((m) => m.id)).toEqual(['u2']);
  });

  it('buildChatRequestBody keeps a user turn that got a partial answer before the error', () => {
    const messages = [
      textMessage('u1', 'user', 'hi'),
      textMessage('a1', 'assistant', 'Sharks have'),
      textMessage(`${LOCAL_ERROR_PREFIX}1`, 'assistant', REEF),
      textMessage('u2', 'user', 'go on'),
    ];
    expect(buildChatRequestBody('agent-1', messages).messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2']);
  });

  it('buildChatRequestBody drops a user turn whose only reply was an empty assistant and an error', () => {
    const empty: UIMessage = { id: 'a1', role: 'assistant', parts: [{ type: 'step-start' }] };
    const messages = [
      textMessage('u1', 'user', 'hi'),
      empty,
      textMessage(`${LOCAL_ERROR_PREFIX}1`, 'assistant', REEF),
      textMessage('u2', 'user', 'hello?'),
    ];
    expect(buildChatRequestBody('agent-1', messages).messages.map((m) => m.id)).toEqual(['u2']);
  });

  it('buildChatRequestBody sends text parts only and drops messages left empty', () => {
    const answered: UIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        { type: 'reasoning', text: 'Let me think about fins at length…' },
        { type: 'text', text: 'Sharks ' },
        { type: 'text', text: 'have fins.' },
      ],
    };
    const thinkingOnly: UIMessage = {
      id: 'a2',
      role: 'assistant',
      parts: [{ type: 'step-start' }, { type: 'reasoning', text: 'Hmm' }],
    };
    const messages = [
      textMessage('u1', 'user', 'fins?'),
      answered,
      textMessage('u2', 'user', 'more?'),
      thinkingOnly,
      textMessage('u3', 'user', 'hello?'),
    ];
    const body = buildChatRequestBody('agent-1', messages);
    expect(body.messages).toEqual([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'fins?' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'Sharks ' },
          { type: 'text', text: 'have fins.' },
        ],
      },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'more?' }] },
      { id: 'u3', role: 'user', parts: [{ type: 'text', text: 'hello?' }] },
    ]);
  });

  it('buildChatRequestBody keeps the last 20 messages', () => {
    const messages = Array.from({ length: 25 }, (_, i) =>
      textMessage(`m${i}`, i % 2 === 0 ? 'user' : 'assistant', `text ${i}`),
    );
    const body = buildChatRequestBody('agent-1', messages);
    expect(body.messages).toHaveLength(20);
    expect(body.messages[0].id).toBe('m5');
    expect(body.messages[19].id).toBe('m24');
  });
});

describe('toChatMessages', () => {
  it('toChatMessages joins text parts', () => {
    const assistant: UIMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'step-start' },
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'there' },
      ],
    };
    expect(toChatMessages([textMessage('u1', 'user', 'hi'), assistant])).toEqual([
      { id: 'u1', role: 'user', content: 'hi' },
      { id: 'a1', role: 'assistant', content: 'Hello there' },
    ]);
  });

  it('toChatMessages drops system messages and empty turns', () => {
    const empty: UIMessage = { id: 'a0', role: 'assistant', parts: [{ type: 'step-start' }] };
    expect(
      toChatMessages([textMessage('s1', 'system', 'be nice'), empty, textMessage('u1', 'user', 'hi')]),
    ).toEqual([{ id: 'u1', role: 'user', content: 'hi' }]);
  });
});
