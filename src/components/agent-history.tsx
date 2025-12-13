'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { History, Globe, Plus, ChevronDown, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import type { AgentWithKBs } from '@/types';

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function AgentHistory() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [agents, setAgents] = useState<AgentWithKBs[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch agents from API when dropdown opens
  useEffect(() => {
    if (isOpen && !hasFetched) {
      setIsLoading(true);
      fetch('/api/agents')
        .then((res) => res.json())
        .then((data) => {
          if (data.success) {
            setAgents(data.agents);
          }
        })
        .catch((err) => {
          console.error('Failed to fetch agents:', err);
        })
        .finally(() => {
          setIsLoading(false);
          setHasFetched(true);
        });
    }
  }, [isOpen, hasFetched]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNavigate = (agentId: string) => {
    setIsOpen(false);
    // Navigate to management page
    router.push(`/agents/${agentId}`);
  };

  const handleCreateNew = () => {
    setIsOpen(false);
    router.push('/');
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-sm"
      >
        <History className="w-4 h-4" />
        <span className="hidden sm:inline">History</span>
        {hasFetched && agents.length > 0 && (
          <span className="bg-primary/20 text-primary text-xs px-1.5 py-0.5 rounded-full">
            {agents.length}
          </span>
        )}
        <ChevronDown
          className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </Button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-72 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-50"
          >
            <div className="p-3 border-b border-border">
              <h3 className="font-semibold text-sm">Your Chatbots</h3>
            </div>

            <div className="max-h-64 overflow-y-auto">
              {isLoading ? (
                <div className="p-4 text-center text-muted-foreground text-sm">
                  <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
                  <p>Loading chatbots...</p>
                </div>
              ) : agents.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-sm">
                  <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No chatbots yet</p>
                  <p className="text-xs mt-1">Create one to get started!</p>
                </div>
              ) : (
                agents.map((agent) => {
                  const isReady = agent.status === 'active';
                  const statusLabel =
                    agent.status === 'active'
                      ? 'Ready'
                      : agent.status === 'creating'
                      ? 'Creating...'
                      : agent.status === 'error'
                      ? 'Error'
                      : agent.status;

                  // Count total documents across all KBs
                  const totalDocs = agent.knowledgeBases.reduce(
                    (sum, kb) => sum + (kb.documentCount || 0),
                    0
                  );

                  return (
                    <div
                      key={agent.uuid}
                      onClick={() => handleNavigate(agent.uuid)}
                      className="flex items-center gap-3 p-3 transition-colors group hover:bg-muted/50 cursor-pointer"
                    >
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                          isReady ? 'bg-primary/10' : 'bg-muted'
                        }`}
                      >
                        <Globe
                          className={`w-4 h-4 ${
                            isReady ? 'text-primary' : 'text-muted-foreground'
                          }`}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {agent.domain}
                        </p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          {formatTimeAgo(agent.createdAt)}
                          {!isReady && (
                            <span className="text-yellow-500">
                              {' '}
                              • {statusLabel}
                            </span>
                          )}
                          {isReady && totalDocs > 0 && (
                            <span className="text-muted-foreground">
                              {' '}
                              • {totalDocs} docs
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="p-2 border-t border-border">
              <button
                onClick={handleCreateNew}
                className="w-full flex items-center gap-2 p-2 text-sm text-primary hover:bg-primary/10 rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create new chatbot
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
