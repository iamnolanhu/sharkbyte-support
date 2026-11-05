'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, ExternalLink, Trash2, Settings, X, Loader2, History } from 'lucide-react';
import Link from 'next/link';
import { ThemeToggle } from '@/components/theme-toggle';
import { AgentHistory } from '@/components/agent-history';
import { ChatMessage, ChatMessageSkeleton } from '@/components/chat-message';
import { ChatInput } from '@/components/chat-input';
import { SammyAvatar } from '@/components/sammy-avatar';
import { Button } from '@/components/ui/button';
import { Footer } from '@/components/footer';
import { MobileMenu, MobileMenuItem } from '@/components/mobile-menu';
import { useChat } from '@/components/chat';
import type { AgentStatus, AgentStatusResponse, ApiErrorBody, GetAgentResponse, PublicAgent } from '@/types';

const STATUS_POLL_INTERVAL_MS = 5000;
const RETIRED_FALLBACK = 'This Sammy has retired — make a new one on the home page.';

function errorText(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as Partial<ApiErrorBody>).error;
  return typeof error === 'string' && error ? error : null;
}

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.agentId as string;

  const [agent, setAgent] = useState<PublicAgent | null>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [retiredMessage, setRetiredMessage] = useState<string | null>(null);
  const [isFetchingAgent, setIsFetchingAgent] = useState(true);
  const [showIndexingBanner, setShowIndexingBanner] = useState(true);

  const { messages, sendText, clearMessages, isLoading, streamingContent, messagesEndRef } = useChat({
    apiUrl: '/api/chat',
    agentId,
    surface: 'site',
  });

  // A Sammy that no longer exists: show the retired state and forget it in this browser.
  const retire = useCallback(
    (body: unknown) => {
      localStorage.removeItem(`sharkbyte-agent-${agentId}`);
      setRetiredMessage(errorText(body) ?? RETIRED_FALLBACK);
    },
    [agentId],
  );

  // Load the agent's public details
  useEffect(() => {
    async function loadAgent() {
      try {
        const res = await fetch(`/api/agents/${agentId}`);
        const body: unknown = await res.json();
        if (res.status === 404) {
          retire(body);
        } else if (res.ok) {
          const { agent: loaded } = body as GetAgentResponse;
          setAgent(loaded);
          setStatus(loaded.status);
          setStatusError(loaded.lastError);
        } else {
          throw new Error(errorText(body) ?? `Agent request failed (${res.status})`);
        }
      } catch (error) {
        console.error('Failed to fetch agent:', error);
        router.push('/');
      } finally {
        setIsFetchingAgent(false);
      }
    }

    loadAgent();
  }, [agentId, router, retire]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, messagesEndRef]);

  // While Sammy is still reading the site, poll its status until it is ready (or fails)
  useEffect(() => {
    if (status !== 'crawling') return;

    const checkStatus = async () => {
      try {
        const res = await fetch(`/api/agent-status?agentId=${encodeURIComponent(agentId)}`);
        const body: unknown = await res.json();
        if (res.status === 404) {
          retire(body);
          setStatus(null);
          return;
        }
        if (!res.ok) return;
        const next = body as AgentStatusResponse;
        if (next.status !== 'crawling') {
          setStatus(next.status);
          setStatusError(next.error ?? null);
        }
      } catch (err) {
        console.error('Status check error:', err);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [status, agentId, retire]);

  const isAgentReady = status === 'ready';

  const sendMessage = (content: string) => {
    if (isAgentReady) sendText(content);
  };

  if (retiredMessage) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center max-w-md">
          <SammyAvatar size="xl" className="mx-auto mb-4" />
          <p className="text-foreground mb-4">{retiredMessage}</p>
          <Button onClick={() => router.push('/')}>Make a new Sammy</Button>
        </div>
      </div>
    );
  }

  if (isFetchingAgent || !agent) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <SammyAvatar size="xl" className="mx-auto mb-4" />
          <p className="text-muted-foreground">Loading agent...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur-sm">
        <div className="flex items-center justify-between px-2 sm:px-4 py-3 sm:py-4 max-w-4xl mx-auto gap-2">
          {/* Left section */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push(`/agents/${agentId}`)}
              className="rounded-full flex-shrink-0"
              title="Agent Settings"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Link href="/" className="flex-shrink-0">
              <SammyAvatar size="sm" animated={false} />
            </Link>
            <div className="min-w-0">
              <h1 className="font-semibold text-foreground truncate max-w-[150px] sm:max-w-none">
                {agent.name || 'SharkByte Support'}
              </h1>
              <a
                href={agent.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
              >
                <span className="truncate max-w-[130px] sm:max-w-none">
                  {agent.domain}
                </span>
                <ExternalLink className="w-3 h-3 flex-shrink-0" />
              </a>
            </div>
          </div>

          {/* Right section */}
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            {/* Desktop: Show all buttons */}
            <div className="hidden sm:flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={clearMessages}
                title="Clear chat"
                className="rounded-full"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => router.push(`/agents/${agentId}`)}
                title="Agent settings"
                className="rounded-full"
              >
                <Settings className="w-4 h-4" />
              </Button>
              <AgentHistory />
              <ThemeToggle />
            </div>

            {/* Mobile: Hamburger menu */}
            <MobileMenu>
              <MobileMenuItem
                icon={<Trash2 className="w-5 h-5" />}
                label="Clear Chat"
                onClick={clearMessages}
              />
              <MobileMenuItem
                icon={<Settings className="w-5 h-5" />}
                label="Agent Settings"
                onClick={() => router.push(`/agents/${agentId}`)}
              />
              <MobileMenuItem
                icon={<History className="w-5 h-5" />}
                label="Agent History"
                onClick={() => router.push('/')}
              />
            </MobileMenu>
          </div>
        </div>
      </header>

      {/* Crawling Status Banner */}
      {status === 'crawling' && showIndexingBanner && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="bg-[var(--do-blue)]/10 border-b border-[var(--do-blue)]/20 px-4 py-3"
        >
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Loader2 className="w-4 h-4 text-[var(--do-blue)] animate-spin" />
              <span className="text-sm text-foreground">
                Sammy is still learning about this website. Chat opens as soon as the dive is done.
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowIndexingBanner(false)}
              className="h-6 w-6 rounded-full hover:bg-[var(--do-blue)]/20"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </motion.div>
      )}

      {/* Messages */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          {messages.length === 0 && !isLoading ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center py-8 sm:py-16 px-4"
            >
              <SammyAvatar size="lg" className="mb-4" interactive />
              <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-1 sm:mb-2">
                Hi, I&apos;m Sammy!
              </h2>
              <p className="text-sm sm:text-base text-muted-foreground text-center max-w-md mb-4 sm:mb-6">
                I&apos;m your AI support agent for{' '}
                <span className="text-primary font-medium">
                  {agent.domain}
                </span>
                . Ask me anything about this website!
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 sm:gap-3 w-full max-w-md">
                {[
                  'What services do you offer?',
                  'How can I contact support?',
                  'What are your pricing plans?',
                  'Tell me about your company',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => sendMessage(suggestion)}
                    disabled={!isAgentReady}
                    className="p-2.5 sm:p-3 min-h-[44px] text-left text-sm rounded-lg border border-border bg-card hover:bg-accent active:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <div className="py-4">
              {messages.map((message) => (
                <ChatMessage key={message.id} message={message} />
              ))}
              {streamingContent && (
                <ChatMessage
                  message={{ role: 'assistant', content: streamingContent }}
                  isStreaming
                />
              )}
              {isLoading && !streamingContent && <ChatMessageSkeleton />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </main>

      {/* Input */}
      {isAgentReady ? (
        <ChatInput onSend={sendMessage} isLoading={isLoading} />
      ) : (
        <div className="p-4 bg-card border-t border-border">
          {status === 'failed' ? (
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2 text-muted-foreground text-center">
              <span>{statusError ?? "This Sammy couldn't read the site."}</span>
              <Link href={`/agents/${agentId}`} className="text-primary hover:underline">
                Open settings to repair it
              </Link>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Sammy is still reading the site... Chat will be available shortly.</span>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="py-4 border-t border-border bg-card/50">
        <Footer />
      </div>
    </div>
  );
}
