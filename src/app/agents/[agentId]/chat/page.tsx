'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { ArrowLeft, ExternalLink, Trash2, Settings } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { AgentHistory } from '@/components/agent-history';
import { ChatMessage, ChatMessageSkeleton } from '@/components/chat-message';
import { ChatInput } from '@/components/chat-input';
import { SammyAvatar } from '@/components/sammy-avatar';
import { Button } from '@/components/ui/button';
import { Footer } from '@/components/footer';
import type { ChatMessage as ChatMessageType, StoredAgent } from '@/types';

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.agentId as string;

  const [agent, setAgent] = useState<StoredAgent | null>(null);
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingAgent, setIsFetchingAgent] = useState(true);
  const [streamingContent, setStreamingContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Always fetch fresh agent credentials from API
  useEffect(() => {
    async function loadAgent() {
      try {
        // Always fetch fresh credentials from API to avoid stale data
        const [agentRes, keyRes] = await Promise.all([
          fetch(`/api/agents/${agentId}`),
          fetch(`/api/agents/${agentId}`, { method: 'POST' }), // Creates new access key
        ]);

        const agentData = await agentRes.json();
        const keyData = await keyRes.json();

        if (agentData.success && agentData.agent && keyData.success) {
          const agent = agentData.agent;
          const fetchedAgent: StoredAgent = {
            id: agent.uuid,
            name: agent.name,
            kbId: agent.knowledgeBases?.[0]?.uuid || '',
            url: `https://${agent.domain}`,
            endpoint: agent.endpoint,
            accessKey: keyData.accessKey,
            createdAt: agent.createdAt,
          };

          // Update localStorage with fresh data
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

  const sendMessage = async (content: string) => {
    if (!agent) return;

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
        <div className="flex items-center justify-between p-4 max-w-4xl mx-auto">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push(`/agents/${agentId}`)}
              className="rounded-full"
              title="Agent Settings"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <SammyAvatar size="sm" animated={false} />
            <div>
              <h1 className="font-semibold text-foreground">
                {agent.name || 'SharkByte Support'}
              </h1>
              <a
                href={agent.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
              >
                {new URL(agent.url).hostname}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          {messages.length === 0 && !isLoading ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center py-20 px-4"
            >
              <SammyAvatar size="xl" className="mb-6" />
              <h2 className="text-2xl font-semibold text-foreground mb-2">
                Hi, I&apos;m Sammy!
              </h2>
              <p className="text-muted-foreground text-center max-w-md mb-6">
                I&apos;m your AI support agent for{' '}
                <span className="text-primary font-medium">
                  {new URL(agent.url).hostname}
                </span>
                . Ask me anything about this website!
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-md">
                {[
                  'What services do you offer?',
                  'How can I contact support?',
                  'What are your pricing plans?',
                  'Tell me about your company',
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => sendMessage(suggestion)}
                    className="p-3 text-left text-sm rounded-lg border border-border bg-card hover:bg-accent transition-colors"
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
      <ChatInput onSend={sendMessage} isLoading={isLoading} />

      {/* Footer */}
      <div className="py-4 border-t border-border bg-card/50">
        <Footer />
      </div>
    </div>
  );
}
