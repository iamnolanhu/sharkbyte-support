'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
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
import type { ChatMessage as ChatMessageType, StoredAgent } from '@/types';

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const agentId = params.agentId as string;

  // Check if we arrived here while indexing was still in progress
  const indexingParam = searchParams.get('indexing') === 'true';
  const kbIdParam = searchParams.get('kbId');

  const [agent, setAgent] = useState<StoredAgent | null>(null);
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingAgent, setIsFetchingAgent] = useState(true);
  const [streamingContent, setStreamingContent] = useState('');
  const [showIndexingBanner, setShowIndexingBanner] = useState(indexingParam);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch agent data, reuse accessKey from localStorage if available
  useEffect(() => {
    async function loadAgent() {
      try {
        // Check localStorage for existing accessKey first
        const storedData = localStorage.getItem(`sharkbyte-agent-${agentId}`);
        const storedAgent = storedData ? JSON.parse(storedData) : null;
        const existingKey = storedAgent?.accessKey;

        // Fetch agent data (only request new key if we don't have one stored)
        const needsNewKey = !existingKey;
        const agentRes = await fetch(
          `/api/agents/${agentId}${needsNewKey ? '?includeAccessKey=true&forceNewKey=true' : ''}`
        );
        const agentData = await agentRes.json();

        if (agentData.success && agentData.agent) {
          const agent = agentData.agent;
          // Use existing key or new key from API
          const keyToUse = existingKey || agentData.accessKey || '';

          const fetchedAgent: StoredAgent = {
            id: agent.uuid,
            name: agent.name,
            kbId: agent.knowledgeBases?.[0]?.uuid || '',
            url: `https://${agent.domain}`,
            endpoint: agent.endpoint,
            accessKey: keyToUse,
            createdAt: agent.createdAt,
          };

          // Update localStorage with fresh data (including new key if created)
          localStorage.setItem(
            `sharkbyte-agent-${agentId}`,
            JSON.stringify(fetchedAgent)
          );

          setAgent(fetchedAgent);
        } else {
          // Agent not found - clear stale localStorage and redirect
          localStorage.removeItem(`sharkbyte-agent-${agentId}`);
          router.push(`/agents/${agentId}`);
        }
      } catch (error) {
        console.error('Failed to fetch agent:', error);
        localStorage.removeItem(`sharkbyte-agent-${agentId}`);
        router.push('/');
      } finally {
        setIsFetchingAgent(false);
      }
    }

    loadAgent();
  }, [agentId, router]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Poll for indexing status to auto-dismiss banner and reload agent when ready
  useEffect(() => {
    // Only poll if agent doesn't have endpoint yet, or if showing indexing banner
    const needsPolling = (agent && !agent.endpoint) || showIndexingBanner;
    if (!needsPolling || !kbIdParam) return;

    const checkStatus = async () => {
      try {
        const res = await fetch(
          `/api/agent-status?agentId=${agentId}&kbId=${kbIdParam}`
        );
        const data = await res.json();
        if (data.status === 'ready') {
          setShowIndexingBanner(false);
          // Reload agent to get endpoint if we don't have it yet
          if (!agent?.endpoint) {
            // Check localStorage for existing key - don't create new one
            const storedData = localStorage.getItem(`sharkbyte-agent-${agentId}`);
            const storedAgent = storedData ? JSON.parse(storedData) : null;
            const existingKey = storedAgent?.accessKey || agent?.accessKey;
            const needsNewKey = !existingKey;

            const agentRes = await fetch(
              `/api/agents/${agentId}${needsNewKey ? '?includeAccessKey=true&forceNewKey=true' : ''}`
            );
            const agentData = await agentRes.json();
            if (agentData.success && agentData.agent) {
              const keyToUse = existingKey || agentData.accessKey || '';
              const fetchedAgent: StoredAgent = {
                id: agentData.agent.uuid,
                name: agentData.agent.name,
                kbId: agentData.agent.knowledgeBases?.[0]?.uuid || '',
                url: `https://${agentData.agent.domain}`,
                endpoint: agentData.agent.endpoint,
                accessKey: keyToUse,
                createdAt: agentData.agent.createdAt,
              };
              // Store in localStorage if we created a new key
              if (agentData.accessKey && needsNewKey) {
                localStorage.setItem(`sharkbyte-agent-${agentId}`, JSON.stringify(fetchedAgent));
              }
              setAgent(fetchedAgent);
            }
          }
        }
      } catch (err) {
        console.error('Status check error:', err);
      }
    };

    // Check immediately, then every 5 seconds
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, [showIndexingBanner, agentId, kbIdParam, agent]);

  // Check if agent is ready for chat (has endpoint)
  const isAgentReady = Boolean(agent?.endpoint);

  const sendMessage = async (content: string) => {
    if (!agent) return;

    // Prevent sending if agent doesn't have an endpoint yet
    if (!agent.endpoint) {
      console.error('Cannot send message: Agent endpoint not available yet');
      return;
    }

    const userMessage: ChatMessageType = { role: 'user', content };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setStreamingContent('');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          endpoint: agent.endpoint,
          accessKey: agent.accessKey,
        }),
      });

      if (!response.ok) {
        throw new Error('Chat request failed');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('0:')) {
            try {
              const data = JSON.parse(line.slice(2));
              if (data.textDelta) {
                accumulated += data.textDelta;
                setStreamingContent(accumulated);
              }
            } catch {
              // Ignore parse errors for incomplete JSON
            }
          }
        }
      }

      // Add final assistant message
      const assistantMessage: ChatMessageType = {
        role: 'assistant',
        content: accumulated,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setStreamingContent('');
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: ChatMessageType = {
        role: 'assistant',
        content: "I'm sorry, I encountered an error. Please try again.",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
  };

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
                  {new URL(agent.url).hostname}
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
                onClick={clearChat}
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
                onClick={clearChat}
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

      {/* Indexing Status Banner */}
      {showIndexingBanner && (
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
                Sammy is still learning about this website. Responses may improve shortly.
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
                  {new URL(agent.url).hostname}
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
                    className="p-2.5 sm:p-3 min-h-[44px] text-left text-sm rounded-lg border border-border bg-card hover:bg-accent active:bg-accent transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <div className="py-4">
              {messages.map((message, i) => (
                <ChatMessage key={i} message={message} />
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
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Agent is still deploying... Chat will be available shortly.</span>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="py-4 border-t border-border bg-card/50">
        <Footer />
      </div>
    </div>
  );
}
