'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat as useAiChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { track } from '@/lib/analytics/client';
import { PROVIDERS_DOWN_COPY } from '@/lib/chat/copy';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface UseChatOptions {
  apiUrl: string;
  agentId: string;
  surface: 'site' | 'embed';
  /** The embedding page's hostname, read per request; sent as `hostDomain` for analytics. */
  getHostDomain?: () => string | undefined;
  onError?: (error: Error) => void;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  sendMessage: () => Promise<void>;
  sendText: (text: string) => void;
  clearMessages: () => void;
  isLoading: boolean;
  streamingContent: string;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

/** Id prefix of the assistant bubbles the client adds for errors; they are never sent to the server. */
export const LOCAL_ERROR_PREFIX = 'local-error-';

/** History the server reads: the last 10 turns. */
const MAX_HISTORY_MESSAGES = 20;

const REEF_COPY = 'Sorry, Sammy hit a reef. Please try again.';

const isLocalError = (message: UIMessage): boolean => message.id.startsWith(LOCAL_ERROR_PREFIX);

/**
 * The POST body for /api/chat and /api/widget/[agentId]. Only text parts travel (no
 * reasoning, no step markers), messages left without text are dropped, and a user message
 * answered only by a local error bubble is dropped with it: that request was rejected or
 * never answered, so resending it would fail the same way (a 413 would poison every send).
 */
export function buildChatRequestBody(
  agentId: string,
  messages: UIMessage[],
): { agentId: string; messages: UIMessage[] } {
  const withText: UIMessage[] = [];
  for (const message of messages) {
    const parts = message.parts.filter((part) => part.type === 'text' && part.text.length > 0);
    if (parts.length > 0) withText.push({ id: message.id, role: message.role, parts });
  }
  const history = withText.filter((message, i) => {
    if (isLocalError(message)) return false;
    const next = withText[i + 1];
    return !(message.role === 'user' && next !== undefined && isLocalError(next));
  });
  return { agentId, messages: history.slice(-MAX_HISTORY_MESSAGES) };
}

/**
 * What to show for a failed request. The transport puts the response body in the error
 * message, so an `ApiErrorBody` from the server (rails, retired, not ready) is shown as is;
 * a stream that failed on every provider ends with the providers-down copy as its error text.
 */
export function chatErrorCopy(error: Error): { text: string; rail?: string } {
  if (error.message === PROVIDERS_DOWN_COPY) return { text: PROVIDERS_DOWN_COPY };
  let parsed: unknown;
  try {
    parsed = JSON.parse(error.message);
  } catch {
    return { text: REEF_COPY };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { text: REEF_COPY };
  const body = parsed as Record<string, unknown>;
  if (body.success !== false || typeof body.error !== 'string' || !body.error) return { text: REEF_COPY };
  return typeof body.rail === 'string' ? { text: body.error, rail: body.rail } : { text: body.error };
}

function messageText(message: UIMessage): string {
  return message.parts.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

/** User and assistant turns with their text parts joined; system messages and empty turns are dropped. */
export function toChatMessages(messages: UIMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    const content = messageText(message);
    if (content) out.push({ id: message.id, role: message.role, content });
  }
  return out;
}

/**
 * Shared chat logic: the AI SDK chat over the UI message stream, plus the input box,
 * local error bubbles and scroll-to-bottom behaviour both widgets and the chat page use.
 */
export function useChat({ apiUrl, agentId, surface, getHostDomain, onError }: UseChatOptions): UseChatReturn {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const errorCountRef = useRef(0);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: apiUrl,
        prepareSendMessagesRequest: ({ messages }) => {
          const hostDomain = getHostDomain?.();
          return { body: { ...buildChatRequestBody(agentId, messages), ...(hostDomain ? { hostDomain } : {}) } };
        },
      }),
    [apiUrl, agentId, getHostDomain],
  );

  // The SDK reads the latest transport and callbacks on every request; a new id (another
  // agent) makes it start a fresh chat.
  const chat = useAiChat<UIMessage>({
    id: `${apiUrl}#${agentId}`,
    transport,
    // Batch streamed deltas into one render every 50 ms instead of one per token.
    throttle: 50,
    onError: (error) => {
      console.error('Chat error:', error);
      onError?.(error);
      errorCountRef.current += 1;
      const copy = chatErrorCopy(error);
      if (copy.rail) track('demo_limit_hit', { rail: copy.rail });
      const bubble: UIMessage = {
        id: `${LOCAL_ERROR_PREFIX}${errorCountRef.current}`,
        role: 'assistant',
        parts: [{ type: 'text', text: copy.text }],
      };
      setMessages((prev) => [...prev, bubble]);
    },
  });
  const { setMessages, status } = chat;

  const isLoading = status === 'submitted' || status === 'streaming';
  const last = chat.messages[chat.messages.length - 1];
  const inFlight = status === 'streaming' && last?.role === 'assistant' ? last : undefined;
  const streamingContent = inFlight ? messageText(inFlight) : '';
  const messages = useMemo(
    () => toChatMessages(inFlight ? chat.messages.slice(0, -1) : chat.messages),
    [chat.messages, inFlight],
  );

  // Scroll the messages container to the bottom; the later attempts catch layout shifts after render.
  useEffect(() => {
    const scrollToBottom = () => {
      const container = scrollContainerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    };
    scrollToBottom();
    const timers = [0, 50, 150].map((ms) => setTimeout(scrollToBottom, ms));
    return () => timers.forEach(clearTimeout);
  }, [messages]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (streamingContent && container) container.scrollTop = container.scrollHeight;
  }, [streamingContent]);

  const sendText = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;
    track('chat_message_sent', { surface });
    void chat.sendMessage({ text: trimmed });
  };

  const sendMessage = async (): Promise<void> => {
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setInput('');
    track('chat_message_sent', { surface });
    await chat.sendMessage({ text: trimmed });
  };

  const clearMessages = (): void => {
    void chat.stop();
    setMessages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  return {
    messages,
    input,
    setInput,
    sendMessage,
    sendText,
    clearMessages,
    isLoading,
    streamingContent,
    messagesEndRef,
    scrollContainerRef,
    inputRef,
    handleKeyDown,
  };
}
