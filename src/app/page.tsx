'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Header } from '@/components/header';
import { UrlInput } from '@/components/url-input';
import { ProgressIndicator } from '@/components/progress-indicator';
import { WaveBackground } from '@/components/wave-background';
import { SammyAvatar } from '@/components/sammy-avatar';
import { Footer } from '@/components/footer';
import { TIMING } from '@/lib/config';
import { saveStoredAgent } from '@/lib/stored-agents';
import type { AgentStatusResponse, CreateAgentApiResponse } from '@/types';

type CreationStep = 'idle' | 'creating' | 'indexing' | 'ready' | 'error';

interface PendingAgent {
  agentId: string;
}

function errorText(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const { error } = body as { error: unknown };
    if (typeof error === 'string' && error) return error;
  }
  return fallback;
}

export default function Home() {
  const router = useRouter();
  const [step, setStep] = useState<CreationStep>('idle');
  const [agentData, setAgentData] = useState<PendingAgent | null>(null);
  const [error, setError] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>(''); // Dynamic status from API
  const [isSubmitting, setIsSubmitting] = useState(false); // Prevents double-submit

  // Poll the crawl until the agent is ready or fails
  useEffect(() => {
    if (step !== 'indexing' || !agentData) return;

    let attempts = 0;
    const { agentId } = agentData;

    const pollStatus = async () => {
      attempts++;
      // Out of patience: the dashboard keeps polling and shows progress
      if (attempts > TIMING.MAX_POLL_ATTEMPTS) {
        router.push(`/agents/${agentId}`);
        return;
      }

      try {
        const res = await fetch(`/api/agent-status?agentId=${encodeURIComponent(agentId)}`);
        const data: unknown = await res.json();
        if (!res.ok) {
          setStep('error');
          setError(errorText(data, 'The tide went out on that one. Try again.'));
          setIsSubmitting(false);
          return;
        }
        const status = data as Partial<AgentStatusResponse>;
        if (status.message) setStatusMessage(status.message);

        if (status.status === 'ready') {
          setStep('ready');
          router.push(`/agents/${agentId}`);
        } else if (status.status === 'failed') {
          setStep('error');
          setError(status.error || 'Sammy could not read that site. Try another one.');
          setIsSubmitting(false);
        }
      } catch (err) {
        console.error('Status poll error:', err);
      }
    };

    const interval = setInterval(pollStatus, TIMING.STATUS_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [step, agentData, router]);

  const handleSubmit = async (url: string) => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setStep('creating');
    setError('');

    try {
      const res = await fetch('/api/create-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data: unknown = await res.json();

      if (!res.ok) {
        throw new Error(errorText(data, 'Failed to create agent'));
      }
      const created = data as CreateAgentApiResponse;

      saveStoredAgent(localStorage, {
        id: created.agentId,
        name: created.agentName,
        url: created.url,
        ...(created.ownerToken ? { ownerToken: created.ownerToken } : {}),
        createdAt: new Date().toISOString(),
      });
      setAgentData({ agentId: created.agentId });

      if (created.isExisting || created.status === 'ready') {
        setStep('ready');
        router.push(`/agents/${created.agentId}`);
      } else {
        setStep('indexing');
      }
    } catch (err) {
      console.error('[handleSubmit] Error:', err);
      setStep('error');
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
      setIsSubmitting(false); // Allow retry on error
    }
  };

  const getProgressSteps = () => [
    {
      id: 'create-agent',
      label: 'Launching Sammy',
      description: 'Setting up a fresh little shark',
      status:
        step === 'creating'
          ? 'loading'
          : step === 'error' && !agentData
          ? 'error'
          : agentData
          ? 'complete'
          : 'pending',
    },
    {
      id: 'indexing',
      label: 'Diving Into Your Site',
      description: statusMessage || 'Swimming through your pages',
      status:
        step === 'indexing'
          ? 'loading'
          : step === 'ready'
          ? 'complete'
          : step === 'error' && agentData
          ? 'error'
          : 'pending',
    },
    {
      id: 'ready',
      label: 'Agent Ready',
      description: 'Your AI support agent is live',
      status: step === 'ready' ? 'complete' : 'pending',
    },
  ] as const;

  return (
    <main className="relative min-h-screen flex flex-col items-center justify-center px-4 pt-20 pb-8 sm:pt-24 sm:pb-8">
      <WaveBackground />
      <Header />

      <AnimatePresence mode="wait">
        {(step === 'idle' || step === 'error') ? (
          <motion.div
            key="input"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex flex-col items-center gap-6 sm:gap-8 w-full max-w-3xl"
          >
            {/* Hero */}
            <motion.div
              className="text-center space-y-3 sm:space-y-4"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <SammyAvatar size="hero" interactive className="mx-auto mb-2 sm:mb-4 w-24 h-24 sm:w-32 sm:h-32 md:w-40 md:h-40 lg:w-48 lg:h-48" />
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold bg-gradient-to-r from-[var(--do-blue)] to-[var(--do-teal)] bg-clip-text text-transparent leading-tight">
                SharkByte Support
              </h1>
              <p className="text-base sm:text-lg md:text-xl text-muted-foreground max-w-lg mx-auto px-2">
                Transform any website into an AI-powered support agent in seconds
              </p>
            </motion.div>

            {/* URL Input */}
            <UrlInput onSubmit={handleSubmit} isLoading={isSubmitting} />

            {/* Error Display */}
            {step === 'error' && error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 max-w-md mx-4"
              >
                <p className="text-sm text-destructive">{error}</p>
                <button
                  onClick={() => {
                    setStep('idle');
                    setError('');
                    setAgentData(null);
                    setIsSubmitting(false);
                  }}
                  className="mt-2 text-sm text-primary hover:underline"
                >
                  Try again
                </button>
              </motion.div>
            )}

            {/* Features */}
            <motion.div
              className="grid grid-cols-3 gap-2 sm:gap-4 mt-4 sm:mt-8 w-full max-w-md"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
            >
              {[
                { title: 'Instant', desc: 'Just paste URL' },
                { title: 'AI-Powered', desc: 'Your content' },
                { title: '24/7', desc: 'Always on' },
              ].map((feature, i) => (
                <div
                  key={i}
                  className="p-2.5 sm:p-4 rounded-lg sm:rounded-xl bg-card/50 backdrop-blur-sm border border-border text-center"
                >
                  <h3 className="text-xs sm:text-sm md:text-base font-semibold text-foreground">{feature.title}</h3>
                  <p className="text-[10px] sm:text-xs md:text-sm text-muted-foreground leading-tight">{feature.desc}</p>
                </div>
              ))}
            </motion.div>

            {/* Footer */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
            >
              <Footer />
            </motion.div>
          </motion.div>
        ) : (
          <motion.div
            key="progress"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="w-full max-w-md px-4 flex items-center justify-center"
          >
            <ProgressIndicator steps={getProgressSteps()} error={error} />
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
