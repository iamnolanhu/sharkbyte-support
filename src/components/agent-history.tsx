'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { History, Globe, Trash2, Plus, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import type { StoredAgent } from '@/types';

function getStoredAgents(): StoredAgent[] {
  if (typeof window === 'undefined') return [];

  const agents: StoredAgent[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('sharkbyte-agent-')) {
      const data = localStorage.getItem(key);
      if (data) {
        try {
          agents.push(JSON.parse(data));
        } catch {
          // Skip invalid entries
        }
      }
    }
  }
  return agents.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

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

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function AgentHistory() {
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [agents, setAgents] = useState<StoredAgent[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load agents on mount and when dropdown opens
  useEffect(() => {
    setAgents(getStoredAgents());
  }, [isOpen]);

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
    router.push(`/chat/${agentId}`);
  };

  const handleDelete = (e: React.MouseEvent, agentId: string) => {
    e.stopPropagation();
    localStorage.removeItem(`sharkbyte-agent-${agentId}`);
    setAgents(getStoredAgents());

    // If we're on this agent's chat page, redirect to home
    if (pathname === `/chat/${agentId}`) {
      router.push('/');
    }
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
        {agents.length > 0 && (
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
              {agents.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-sm">
                  <History className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No chatbots yet</p>
                  <p className="text-xs mt-1">Create one to get started!</p>
                </div>
              ) : (
                agents.map((agent) => (
                  <div
                    key={agent.id}
                    onClick={() => handleNavigate(agent.id)}
                    className="flex items-center gap-3 p-3 hover:bg-muted/50 cursor-pointer transition-colors group"
                  >
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Globe className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">
                        {extractDomain(agent.url)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatTimeAgo(agent.createdAt)}
                      </p>
                    </div>
                    <button
                      onClick={(e) => handleDelete(e, agent.id)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-destructive/10 rounded-md transition-all"
                      title="Delete chatbot"
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </button>
                  </div>
                ))
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
