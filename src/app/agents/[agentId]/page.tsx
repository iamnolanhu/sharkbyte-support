'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  MessageCircle,
  Globe,
  Upload,
  Database,
  RefreshCw,
  Trash2,
  Save,
  CheckCircle,
  AlertCircle,
  Loader2,
  Code,
  Copy,
  Check,
} from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';
import { AgentHistory } from '@/components/agent-history';
import { SammyAvatar } from '@/components/sammy-avatar';
import { Button } from '@/components/ui/button';
import { Footer } from '@/components/footer';
import type { AgentWithKBs, KnowledgeBaseInfo } from '@/types';

function KBCard({
  kb,
  icon: Icon,
  title,
  description,
}: {
  kb: KnowledgeBaseInfo | null;
  icon: React.ElementType;
  title: string;
  description: string;
}) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'indexed':
        return 'text-green-500';
      case 'indexing':
        return 'text-yellow-500';
      case 'error':
        return 'text-red-500';
      default:
        return 'text-muted-foreground';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'indexed':
        return <CheckCircle className="w-4 h-4" />;
      case 'indexing':
        return <Loader2 className="w-4 h-4 animate-spin" />;
      case 'error':
        return <AlertCircle className="w-4 h-4" />;
      default:
        return <Loader2 className="w-4 h-4 animate-spin" />;
    }
  };

  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
          {kb ? (
            <div className="mt-2 flex items-center gap-2">
              <span className={`flex items-center gap-1 ${getStatusColor(kb.status)}`}>
                {getStatusIcon(kb.status)}
                <span className="text-sm capitalize">{kb.status}</span>
              </span>
              {kb.documentCount !== undefined && (
                <span className="text-sm text-muted-foreground">
                  {kb.documentCount} docs
                </span>
              )}
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Not configured</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AgentManagementPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const agentId = params.agentId as string;
  const isFromIndexing = searchParams.get('indexing') === 'true';
  const kbId = searchParams.get('kbId');

  const [agent, setAgent] = useState<AgentWithKBs | null>(null);
  const [accessKey, setAccessKey] = useState<string>('');
  const [instruction, setInstruction] = useState('');
  const [originalInstruction, setOriginalInstruction] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [repairSuccess, setRepairSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [agentStatus, setAgentStatus] = useState<'deploying' | 'ready' | 'error' | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Agent is ready when it has an endpoint and status is ready (or status not yet checked for existing agents)
  const isAgentReady = Boolean(agent?.endpoint && (agentStatus === 'ready' || agentStatus === null));

  useEffect(() => {
    async function loadAgent() {
      try {
        // Check localStorage for existing accessKey first
        const storedData = localStorage.getItem(`sharkbyte-agent-${agentId}`);
        const storedAgent = storedData ? JSON.parse(storedData) : null;
        const existingKey = storedAgent?.accessKey;

        // Fetch agent data (only request new key if we don't have one stored)
        const needsNewKey = !existingKey;
        const res = await fetch(
          `/api/agents/${agentId}${needsNewKey ? '?includeAccessKey=true&forceNewKey=true' : ''}`
        );
        const data = await res.json();

        if (data.success && data.agent) {
          setAgent(data.agent);
          setInstruction(data.instruction || '');
          setOriginalInstruction(data.instruction || '');

          // Use existing key from localStorage, or new key from API
          const keyToUse = existingKey || data.accessKey || '';
          if (keyToUse) {
            setAccessKey(keyToUse);
            // Store complete agent data in localStorage if we got a new key
            if (data.accessKey && !existingKey) {
              const completeAgent = {
                id: data.agent.uuid,
                name: data.agent.name,
                kbId: data.agent.knowledgeBases?.[0]?.uuid || '',
                url: `https://${data.agent.domain}`,
                endpoint: data.agent.endpoint || '',
                accessKey: data.accessKey,
                createdAt: data.agent.createdAt,
              };
              localStorage.setItem(`sharkbyte-agent-${agentId}`, JSON.stringify(completeAgent));
            }
          }
        } else {
          setError(data.error || 'Agent not found');
        }
      } catch (err) {
        console.error('Failed to fetch agent:', err);
        setError('Failed to load agent');
      } finally {
        setIsLoading(false);
      }
    }

    loadAgent();
  }, [agentId]);

  // Poll agent status until ready (continue from homepage polling)
  useEffect(() => {
    // Skip if no agent loaded yet
    if (!agent) return;

    // If agent already has endpoint, it's ready - no need to poll
    if (agent.endpoint) {
      if (agentStatus !== 'ready') {
        setAgentStatus('ready');
      }
      return;
    }

    // No endpoint means agent is still deploying - need to poll
    // But we need kbId to poll status
    if (!kbId) {
      setAgentStatus('deploying');
      setStatusMessage('Agent is deploying...');
      return;
    }

    if (agentStatus === 'ready') return;

    let isCancelled = false;
    const pollInterval = 3000; // Poll every 3 seconds

    const checkStatus = async () => {
      if (isCancelled) return;

      try {
        const res = await fetch(
          `/api/agent-status?agentId=${agentId}&kbId=${kbId}&url=${encodeURIComponent(agent.domain || '')}`
        );
        const data = await res.json();

        if (isCancelled) return;

        if (data.status === 'ready') {
          setAgentStatus('ready');
          setStatusMessage('');
          // Reload agent to get updated endpoint
          // Check localStorage for existing key - don't create new one if we have it
          const storedData = localStorage.getItem(`sharkbyte-agent-${agentId}`);
          const storedAgent = storedData ? JSON.parse(storedData) : null;
          const existingKey = storedAgent?.accessKey;
          const needsNewKey = !existingKey;

          const agentRes = await fetch(
            `/api/agents/${agentId}${needsNewKey ? '?includeAccessKey=true&forceNewKey=true' : ''}`
          );
          const agentData = await agentRes.json();
          if (agentData.success && agentData.agent) {
            setAgent(agentData.agent);
            // Use existing key or new key
            const keyToUse = existingKey || agentData.accessKey || '';
            if (keyToUse) {
              setAccessKey(keyToUse);
              // Store complete agent data if we created a new key
              if (agentData.accessKey && !existingKey) {
                const completeAgent = {
                  id: agentData.agent.uuid,
                  name: agentData.agent.name,
                  kbId: agentData.agent.knowledgeBases?.[0]?.uuid || '',
                  url: `https://${agentData.agent.domain}`,
                  endpoint: agentData.agent.endpoint || '',
                  accessKey: agentData.accessKey,
                  createdAt: agentData.agent.createdAt,
                };
                localStorage.setItem(`sharkbyte-agent-${agentId}`, JSON.stringify(completeAgent));
              }
            }
          }
        } else if (data.status === 'error') {
          setAgentStatus('error');
          setStatusMessage(data.message || 'Agent deployment failed');
        } else {
          // Still deploying/indexing
          setAgentStatus('deploying');
          setStatusMessage(data.message || 'Agent is deploying...');
          // Continue polling
          setTimeout(checkStatus, pollInterval);
        }
      } catch (err) {
        console.error('Status poll error:', err);
        if (!isCancelled) {
          setTimeout(checkStatus, pollInterval);
        }
      }
    };

    // Start polling
    checkStatus();

    return () => {
      isCancelled = true;
    };
  }, [agent, agentId, kbId, agentStatus]);

  const handleSaveInstruction = async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    setError(null);

    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction }),
      });

      const data = await res.json();

      if (data.success) {
        setOriginalInstruction(instruction);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        setError(data.error || 'Failed to save');
      }
    } catch (err) {
      console.error('Failed to save instruction:', err);
      setError('Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (
      !confirm(
        'Are you sure you want to delete this agent and all its knowledge bases? This cannot be undone.'
      )
    ) {
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/agents/${agentId}`, {
        method: 'DELETE',
      });

      const data = await res.json();

      if (data.success) {
        // Clear localStorage
        localStorage.removeItem(`sharkbyte-agent-${agentId}`);
        router.push('/');
      } else {
        setError(data.error || 'Failed to delete');
        setIsDeleting(false);
      }
    } catch (err) {
      console.error('Failed to delete agent:', err);
      setError('Failed to delete agent');
      setIsDeleting(false);
    }
  };

  const handleRepair = async () => {
    setIsRepairing(true);
    setRepairSuccess(null);
    setError(null);

    try {
      const res = await fetch(`/api/agents/${agentId}/repair`, {
        method: 'POST',
      });

      const data = await res.json();

      if (data.success) {
        setRepairSuccess(data.message);
        setTimeout(() => setRepairSuccess(null), 5000);
        // Refresh agent data to show updated KBs
        const agentRes = await fetch(`/api/agents/${agentId}`);
        const agentData = await agentRes.json();
        if (agentData.success && agentData.agent) {
          setAgent(agentData.agent);
        }
      } else {
        setError(data.error || 'Failed to repair');
      }
    } catch (err) {
      console.error('Failed to repair agent:', err);
      setError('Failed to repair agent');
    } finally {
      setIsRepairing(false);
    }
  };

  const hasChanges = instruction !== originalInstruction;

  // Find KBs by type
  const crawlKB = agent?.knowledgeBases.find((kb) => kb.type === 'crawl') || null;
  const uploadsKB = agent?.knowledgeBases.find((kb) => kb.type === 'uploads') || null;
  const structuredKB = agent?.knowledgeBases.find((kb) => kb.type === 'structured') || null;

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

  if (error && !agent) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
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
        <div className="flex items-center justify-between p-4 max-w-4xl mx-auto">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push('/')}
              className="rounded-full"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <SammyAvatar size="sm" animated={false} />
            <div>
              <h1 className="font-semibold text-foreground">{agent?.name}</h1>
              <p className="text-xs text-muted-foreground">{agent?.domain}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isAgentReady && statusMessage && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                {statusMessage}
              </span>
            )}
            <Button
              onClick={() => router.push(`/agents/${agentId}/chat`)}
              className="gap-2"
              disabled={!isAgentReady}
              title={!isAgentReady ? 'Agent is still deploying...' : undefined}
            >
              {!isAgentReady ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <MessageCircle className="w-4 h-4" />
              )}
              {isAgentReady ? 'Open Chat' : 'Deploying...'}
            </Button>
            <AgentHistory />
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 space-y-8">
          {/* Agent Settings */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Agent Settings
            </h2>
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
                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}
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

          {/* Knowledge Bases */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">
                Knowledge Bases
              </h2>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRepair}
                disabled={isRepairing}
                className="gap-2"
              >
                {isRepairing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Repair KBs
              </Button>
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
              <KBCard
                kb={crawlKB}
                icon={Globe}
                title="Website Crawl"
                description="Data scraped from your website"
              />
              <KBCard
                kb={uploadsKB}
                icon={Upload}
                title="Uploaded Documents"
                description="PDFs, TXT, and DOCX files"
              />
              <KBCard
                kb={structuredKB}
                icon={Database}
                title="Structured Data"
                description="JSON, CSV, and FAQ data"
              />
            </div>
            <p className="text-sm text-muted-foreground mt-4">
              File uploads and re-crawling coming soon.
            </p>
          </motion.section>

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
              {accessKey ? (
                <div className="relative">
                  <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                    <code className="text-foreground">{`<script
  src="https://sharkbyte-support.vercel.app/widget.js"
  data-agent-id="${agentId}"
  data-endpoint="${agent?.endpoint || ''}"
  data-access-key="${accessKey}"
  data-primary-color="#0080FF"
  data-position="bottom-right"
  async
></script>`}</code>
                  </pre>
                  <Button
                    variant="outline"
                    size="sm"
                    className="absolute top-2 right-2 gap-1"
                    onClick={() => {
                      navigator.clipboard.writeText(`<script
  src="https://sharkbyte-support.vercel.app/widget.js"
  data-agent-id="${agentId}"
  data-endpoint="${agent?.endpoint || ''}"
  data-access-key="${accessKey}"
  data-primary-color="#0080FF"
  data-position="bottom-right"
  async
></script>`);
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

          {/* Danger Zone */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Danger Zone
            </h2>
            <div className="border border-destructive/50 rounded-lg p-4 bg-destructive/5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-foreground">Delete Agent</h3>
                  <p className="text-sm text-muted-foreground">
                    Permanently delete this agent and all its knowledge bases
                  </p>
                </div>
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="gap-2"
                >
                  {isDeleting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  Delete
                </Button>
              </div>
            </div>
          </motion.section>
        </div>
      </main>

      {/* Footer */}
      <div className="py-4 border-t border-border bg-card/50">
        <Footer />
      </div>
    </div>
  );
}
