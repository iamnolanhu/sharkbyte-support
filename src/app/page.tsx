'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ThemeToggle } from '@/components/theme-toggle';
import { UrlInput } from '@/components/url-input';
import { ProgressIndicator } from '@/components/progress-indicator';
import { WaveBackground } from '@/components/wave-background';
import { SammyAvatar } from '@/components/sammy-avatar';

type CreationStep = 'idle' | 'creating' | 'indexing' | 'ready' | 'error';

interface AgentData {
  agentId: string;
  kbId: string;
  endpoint: string;
  accessKey: string;
  url: string;
}

export default function Home() {
  const router = useRouter();
  const [step, setStep] = useState<CreationStep>('idle');
  const [agentData, setAgentData] = useState<AgentData | null>(null);
  const [error, setError] = useState<string>('');

  // Poll for agent status when indexing
  useEffect(() => {
    if (step !== 'indexing' || !agentData) return;

    const pollStatus = async () => {
      try {
        const res = await fetch(
          `/api/agent-status?agentId=${agentData.agentId}&kbId=${agentData.kbId}`
        );
        const data = await res.json();

        if (data.status === 'ready') {
          setStep('ready');
          // Store in localStorage and redirect
          localStorage.setItem(
            `sharkbyte-agent-${agentData.agentId}`,
            JSON.stringify({
              ...agentData,
              createdAt: new Date().toISOString(),
            })
          );
          router.push(`/chat/${agentData.agentId}`);
        } else if (data.status === 'error') {
          setStep('error');
          setError(data.error || 'Failed to create agent');
        }
      } catch (err) {
        console.error('Status poll error:', err);
      }
    };

    const interval = setInterval(pollStatus, 3000);
    return () => clearInterval(interval);
  }, [step, agentData, router]);

  const handleSubmit = async (url: string) => {
    setStep('creating');
    setError('');

    try {
      const res = await fetch('/api/create-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, maxPages: 100 }),
      });

      const data = await res.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to create agent');
      }

      setAgentData({
        agentId: data.agentId,
        kbId: data.kbId,
        endpoint: data.endpoint,
        accessKey: data.accessKey,
        url: data.url,
      });
      setStep('indexing');
    } catch (err) {
      setStep('error');
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    }
  };

  const getProgressSteps = () => [
    {
      id: 'create-kb',
      label: 'Creating Knowledge Base',
      description: 'Setting up website crawler',
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
      label: 'Indexing Website',
      description: 'Crawling and processing pages',
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
    <main className="relative min-h-screen flex flex-col items-center justify-center p-8">
      <WaveBackground />

      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      <AnimatePresence mode="wait">
        {(step === 'idle' || step === 'error' || step === 'creating') ? (
          <motion.div
            key="input"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex flex-col items-center gap-8"
          >
            {/* Hero */}
            <motion.div
              className="text-center space-y-4"
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <SammyAvatar size="xl" className="mx-auto mb-4" />
              <h1 className="text-5xl md:text-6xl font-bold bg-gradient-to-r from-[var(--do-blue)] to-[var(--do-teal)] bg-clip-text text-transparent">
                SharkByte Support
              </h1>
              <p className="text-xl text-muted-foreground max-w-lg">
                Transform any website into an AI-powered support agent in seconds
              </p>
            </motion.div>

            {/* URL Input */}
            <UrlInput onSubmit={handleSubmit} isLoading={step === 'creating'} />

            {/* Error Display */}
            {step === 'error' && error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 max-w-md"
              >
                <p className="text-sm text-destructive">{error}</p>
                <button
                  onClick={() => {
                    setStep('idle');
                    setError('');
                    setAgentData(null);
                  }}
                  className="mt-2 text-sm text-primary hover:underline"
                >
                  Try again
                </button>
              </motion.div>
            )}

            {/* Features */}
            <motion.div
              className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8 max-w-3xl"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
            >
              {[
                { title: 'Instant Setup', desc: 'Just paste your URL' },
                { title: 'AI-Powered', desc: 'Trained on your content' },
                { title: '24/7 Support', desc: 'Always available' },
              ].map((feature, i) => (
                <div
                  key={i}
                  className="p-4 rounded-xl bg-card/50 backdrop-blur-sm border border-border text-center"
                >
                  <h3 className="font-semibold text-foreground">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.desc}</p>
                </div>
              ))}
            </motion.div>

            {/* Footer */}
            <motion.p
              className="text-sm text-muted-foreground/60 mt-8"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
            >
              Powered by DigitalOcean Gradient AI
            </motion.p>
          </motion.div>
        ) : (
          <motion.div
            key="progress"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
          >
            <ProgressIndicator steps={getProgressSteps()} error={error} />
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
