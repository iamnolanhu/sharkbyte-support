'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  MessageCircle,
  Globe,
  FileText,
  Layers,
  RefreshCw,
  Trash2,
  Save,
  CheckCircle,
  AlertCircle,
  Loader2,
  Code,
  Copy,
  Check,
  History,
} from 'lucide-react';
import Link from 'next/link';
import { ThemeToggle } from '@/components/theme-toggle';
import { AgentHistory } from '@/components/agent-history';
import { SammyAvatar } from '@/components/sammy-avatar';
import { Button } from '@/components/ui/button';
import { MobileMenu, MobileMenuItem } from '@/components/mobile-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TIMING } from '@/lib/config';
import { track } from '@/lib/analytics/client';
import { ownerHeaders, removeStoredAgent } from '@/lib/stored-agents';
import type { AgentStatusResponse, GetAgentResponse, PublicAgent } from '@/types';

const RETIRED_FALLBACK = 'This Sammy has retired — make a new one on the home page.';

function errorText(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const { error } = body as { error: unknown };
    if (typeof error === 'string' && error) return error;
  }
  return fallback;
}

function StatCard({
  icon: Icon,
  title,
  value,
}: {
  icon: React.ElementType;
  title: string;
  value: string;
}) {
  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm text-muted-foreground">{title}</h3>
          <p className="font-medium text-foreground">{value}</p>
        </div>
      </div>
    </div>
  );
}

function embedSnippet(origin: string, agentId: string): string {
  return `<script
  src="${origin}/widget.js"
  data-agent-id="${agentId}"
  data-primary-color="#0080FF"
  data-position="bottom-right"
  async
></script>`;
}

export default function AgentManagementPage() {
  const params = useParams();
  const router = useRouter();
  const agentId = params.agentId as string;

  const [agent, setAgent] = useState<PublicAgent | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [retiredMessage, setRetiredMessage] = useState<string | null>(null);
  const [instruction, setInstruction] = useState('');
  const [originalInstruction, setOriginalInstruction] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [repairSuccess, setRepairSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Loads the agent; `keepInstruction` leaves a half-typed prompt alone on background refreshes.
  const loadAgent = useCallback(
    async (keepInstruction = false) => {
      try {
        const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
          headers: ownerHeaders(localStorage, agentId),
        });
        const body: unknown = await res.json();

        if (res.status === 404) {
          removeStoredAgent(localStorage, agentId);
          setRetiredMessage(errorText(body, RETIRED_FALLBACK));
          return;
        }
        if (!res.ok) {
          setError(errorText(body, 'Failed to load agent'));
          return;
        }
        const data = body as GetAgentResponse;
        setAgent(data.agent);
        setIsOwner(data.isOwner);
        if (!keepInstruction) {
          setInstruction(data.agent.instruction);
          setOriginalInstruction(data.agent.instruction);
        }
      } catch (err) {
        console.error('Failed to fetch agent:', err);
        setError('Failed to load agent');
      } finally {
        setIsLoading(false);
      }
    },
    [agentId]
  );

  useEffect(() => {
    loadAgent();
  }, [loadAgent]);

  const isCrawling = agent?.status === 'crawling';

  // Poll the crawl while it runs, then reload the agent once it settles
  useEffect(() => {
    if (!isCrawling) {
      setStatusMessage('');
      return;
    }

    let isCancelled = false;

    const checkStatus = async () => {
      try {
        const res = await fetch(`/api/agent-status?agentId=${encodeURIComponent(agentId)}`);
        if (isCancelled) return;
        if (res.status === 404) {
          await loadAgent(true);
          return;
        }
        const data = (await res.json()) as Partial<AgentStatusResponse>;
        if (isCancelled) return;

        if (data.message) setStatusMessage(data.message);
        if (data.status === 'crawling') {
          setAgent((prev) =>
            prev
              ? {
                  ...prev,
                  pagesCrawled: data.pagesCrawled ?? prev.pagesCrawled,
                  pagesTotal: data.pagesTotal ?? prev.pagesTotal,
                  chunkCount: data.chunkCount ?? prev.chunkCount,
                }
              : prev
          );
        } else {
          await loadAgent(true);
        }
      } catch (err) {
        console.error('Status poll error:', err);
      }
    };

    const interval = setInterval(checkStatus, TIMING.STATUS_POLL_INTERVAL);
    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [isCrawling, agentId, loadAgent]);

  const handleSaveInstruction = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    setError(null);

    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...ownerHeaders(localStorage, agentId) },
        body: JSON.stringify({ instruction }),
      });
      const body: unknown = await res.json();

      if (res.ok) {
        setOriginalInstruction(instruction);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        setError(errorText(body, 'Failed to save'));
      }
    } catch (err) {
      console.error('Failed to save instruction:', err);
      setError('Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
        method: 'DELETE',
        headers: ownerHeaders(localStorage, agentId),
      });
      const body: unknown = await res.json();

      if (res.ok) {
        removeStoredAgent(localStorage, agentId);
        router.push('/');
      } else {
        setError(errorText(body, 'Failed to delete'));
        setIsDeleting(false);
        setShowDeleteConfirm(false);
      }
    } catch (err) {
      console.error('Failed to delete agent:', err);
      setError('Failed to delete agent');
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleRepair = async () => {
    setIsRepairing(true);
    setRepairSuccess(null);
    setError(null);

    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/repair`, {
        method: 'POST',
        headers: ownerHeaders(localStorage, agentId),
      });
      const body: unknown = await res.json();

      if (res.ok) {
        const message =
          typeof body === 'object' && body !== null && 'message' in body
            ? String((body as { message: unknown }).message)
            : 'Sammy is diving back in.';
        setRepairSuccess(message);
        setTimeout(() => setRepairSuccess(null), 5000);
        await loadAgent(true);
      } else {
        setError(errorText(body, 'Failed to repair'));
      }
    } catch (err) {
      console.error('Failed to repair agent:', err);
      setError('Failed to repair agent');
    } finally {
      setIsRepairing(false);
    }
  };

  const hasChanges = instruction !== originalInstruction;
  const isAgentReady = agent?.status === 'ready';
  const snippet = agent && origin ? embedSnippet(origin, agentId) : '';

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <SammyAvatar size="xl" className="mx-auto mb-4" />
          <p className="text-muted-foreground">Loading agent...</p>
        </div>
      </div>
    );
  }

  if (retiredMessage) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center px-4">
          <SammyAvatar size="xl" className="mx-auto mb-4" />
          <p className="text-foreground mb-4">{retiredMessage}</p>
          <Button onClick={() => router.push('/')}>Go Home</Button>
        </div>
      </div>
    );
  }

  if (error && !agent) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center px-4">
          <SammyAvatar size="xl" className="mx-auto mb-4" />
          <p className="text-destructive mb-4">{error}</p>
          <Button onClick={() => router.push('/')}>Go Home</Button>
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
              onClick={() => router.push('/')}
              className="rounded-full flex-shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <Link href="/" className="flex-shrink-0">
              <SammyAvatar size="sm" animated={false} />
            </Link>
            <div className="min-w-0">
              <h1 className="font-semibold text-foreground truncate max-w-[120px] sm:max-w-none">
                {agent?.name}
              </h1>
              <p className="text-xs text-muted-foreground truncate max-w-[120px] sm:max-w-none">
                {agent?.domain}
              </p>
            </div>
          </div>

          {/* Right section */}
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            {/* Status - hidden on mobile */}
            {isCrawling && statusMessage && (
              <span className="hidden sm:flex text-xs text-muted-foreground items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                {statusMessage}
              </span>
            )}

            {/* Open Chat button */}
            <Button
              onClick={() => router.push(`/agents/${agentId}/chat`)}
              className="gap-1 sm:gap-2 px-2 sm:px-4"
              size="sm"
              disabled={!isAgentReady}
              title={isCrawling ? 'Sammy is still reading your site...' : undefined}
            >
              {isCrawling ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <MessageCircle className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">{isCrawling ? 'Reading...' : 'Open Chat'}</span>
            </Button>

            {/* Desktop: Show AgentHistory and ThemeToggle */}
            <div className="hidden sm:flex items-center gap-2">
              <AgentHistory />
              <ThemeToggle />
            </div>

            {/* Mobile: Hamburger menu */}
            <MobileMenu>
              <MobileMenuItem
                icon={<History className="w-5 h-5" />}
                label="Agent History"
                onClick={() => {
                  router.push('/');
                }}
              />
              {isCrawling && statusMessage && (
                <div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {statusMessage}
                </div>
              )}
            </MobileMenu>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 space-y-8">
          {/* Status */}
          <motion.section initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">Sammy&apos;s Knowledge</h2>
              {isOwner && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRepair}
                  disabled={isRepairing || isCrawling}
                  className="gap-2"
                >
                  {isRepairing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  Repair
                </Button>
              )}
            </div>
            {repairSuccess && (
              <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/30">
                <p className="text-sm text-green-500 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  {repairSuccess}
                </p>
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-3">
              <StatCard
                icon={Globe}
                title="Status"
                value={
                  agent?.status === 'ready'
                    ? 'Ready'
                    : agent?.status === 'failed'
                    ? 'Failed'
                    : 'Reading your site...'
                }
              />
              <StatCard
                icon={FileText}
                title="Pages read"
                value={
                  agent && agent.pagesTotal > 0
                    ? `${agent.pagesCrawled} of ${agent.pagesTotal}`
                    : `${agent?.pagesCrawled ?? 0}`
                }
              />
              <StatCard icon={Layers} title="Chunks" value={`${agent?.chunkCount ?? 0}`} />
            </div>
            {agent?.status === 'failed' && agent.lastError && (
              <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                <p className="text-sm text-destructive flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {agent.lastError}
                </p>
              </div>
            )}
            {!isOwner && (
              <p className="text-sm text-muted-foreground mt-4">
                You are viewing this Sammy read-only. Settings are only available in the browser that created it.
              </p>
            )}
          </motion.section>

          {/* Agent Settings (owner only) */}
          {isOwner && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <h2 className="text-lg font-semibold text-foreground mb-4">Agent Settings</h2>
              <div className="border border-border rounded-lg p-4 bg-card">
                <label className="block text-sm font-medium text-foreground mb-2">
                  System Prompt
                </label>
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  rows={6}
                  className="w-full p-3 rounded-lg border border-border bg-background text-foreground resize-none focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Enter the system prompt for your agent..."
                />
                <div className="flex items-center justify-between mt-4">
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  {saveSuccess && (
                    <p className="text-sm text-green-500 flex items-center gap-1">
                      <CheckCircle className="w-4 h-4" />
                      Saved successfully
                    </p>
                  )}
                  {!error && !saveSuccess && <div />}
                  <Button
                    onClick={handleSaveInstruction}
                    disabled={!hasChanges || isSaving}
                    className="gap-2"
                  >
                    {isSaving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    Save Changes
                  </Button>
                </div>
              </div>
            </motion.section>
          )}

          {/* Embed Code */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
          >
            <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
              <Code className="w-5 h-5" />
              Embed on Your Website
            </h2>
            <div className="border border-border rounded-lg p-4 bg-card">
              <p className="text-sm text-muted-foreground mb-4">
                Add this code to your website to embed the chat widget. Place it just before the closing <code className="bg-muted px-1 rounded">&lt;/body&gt;</code> tag.
              </p>
              {snippet ? (
                <div className="relative">
                  <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                    <code className="text-foreground">{snippet}</code>
                  </pre>
                  <Button
                    variant="outline"
                    size="sm"
                    className="absolute top-2 right-2 gap-1"
                    onClick={() => {
                      navigator.clipboard.writeText(snippet);
                      track('embed_code_copied');
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? (
                      <>
                        <Check className="w-3 h-3" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
              ) : (
                <div className="bg-muted p-4 rounded-lg text-sm text-muted-foreground">
                  Loading embed code...
                </div>
              )}
              <div className="mt-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-2">Customization options:</p>
                <ul className="list-disc list-inside space-y-1">
                  <li><code className="bg-muted px-1 rounded">data-primary-color</code> - Widget theme color (hex)</li>
                  <li><code className="bg-muted px-1 rounded">data-position</code> - <code className="bg-muted px-1 rounded">bottom-right</code> or <code className="bg-muted px-1 rounded">bottom-left</code></li>
                  <li><code className="bg-muted px-1 rounded">data-welcome-message</code> - Custom greeting message</li>
                </ul>
              </div>
            </div>
          </motion.section>

          {/* Danger Zone (owner only) */}
          {isOwner && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <h2 className="text-lg font-semibold text-foreground mb-4">Danger Zone</h2>
              <div className="border border-destructive/50 rounded-lg p-4 bg-destructive/5">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h3 className="font-medium text-foreground">Delete Agent</h3>
                    <p className="text-sm text-muted-foreground">
                      Permanently delete this agent and everything Sammy learned
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={isDeleting}
                    className="gap-2 min-h-[44px] w-full sm:w-auto"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </Button>
                </div>
              </div>
            </motion.section>
          )}
        </div>
      </main>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Agent"
        description="Are you sure you want to delete this agent and everything it learned? This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={handleDelete}
        isLoading={isDeleting}
      />
    </div>
  );
}
