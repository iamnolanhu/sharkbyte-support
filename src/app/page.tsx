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

type CreationStep = 'idle' | 'creating' | 'indexing' | 'ready' | 'error';

interface AgentData {
  agentId: string;
  agentName: string;
  kbId: string;
  endpoint: string;
  accessKey: string;
  url: string;
  isExisting: boolean;
}

const MAX_POLL_ATTEMPTS = 10; // 30 seconds max (10 × 3 seconds) before navigating to chat

export default function Home() {
  const router = useRouter();
  const [step, setStep] = useState<CreationStep>('idle');
  const [agentData, setAgentData] = useState<AgentData | null>(null);
  const [error, setError] = useState<string>('');
  const [pollCount, setPollCount] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string>(''); // Dynamic status from API

  // Poll for agent status when indexing (with timeout)
  useEffect(() => {
    if (step !== 'indexing' || !agentData) return;

    // Use local variable to track poll count (avoids stale closure issue with state)
    let localPollCount = 0;

    const pollStatus = async () => {
      localPollCount++;
      setPollCount(localPollCount); // Update state for UI if needed

      // Check for timeout - navigate to chat anyway after max attempts
      if (localPollCount >= MAX_POLL_ATTEMPTS) {
        // Store in localStorage and navigate to agent dashboard with indexing flag
        localStorage.setItem(
          `sharkbyte-agent-${agentData.agentId}`,
          JSON.stringify({
            id: agentData.agentId,
            name: agentData.agentName,
            kbId: agentData.kbId,
            url: agentData.url,
            endpoint: agentData.endpoint,
            accessKey: agentData.accessKey,
            createdAt: new Date().toISOString(),
          })
        );
        // Navigate to agent dashboard with indexing flag
        router.push(`/agents/${agentData.agentId}?indexing=true&kbId=${agentData.kbId}`);
        return;
      }

      try {
        const res = await fetch(
          `/api/agent-status?agentId=${agentData.agentId}&kbId=${agentData.kbId}&url=${encodeURIComponent(agentData.url || '')}`
        );
        const data = await res.json();

        // Update status message if provided
        if (data.message) {
          setStatusMessage(data.message);
        }

        if (data.status === 'ready') {
          setStep('ready');
          // Store in localStorage and redirect to agent dashboard
          localStorage.setItem(
            `sharkbyte-agent-${agentData.agentId}`,
            JSON.stringify({
              id: agentData.agentId,
              name: agentData.agentName,
              kbId: agentData.kbId,
              url: agentData.url,
              endpoint: agentData.endpoint,
              accessKey: agentData.accessKey,
              createdAt: new Date().toISOString(),
            })
          );
          router.push(`/agents/${agentData.agentId}`);
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
    console.log('[handleSubmit] Starting with URL:', url);
    setStep('creating');
    setError('');
    setPollCount(0);

    try {
      const res = await fetch('/api/create-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, maxPages: 100 }),
      });

      const data = await res.json();
      console.log('[handleSubmit] API response:', data);

      if (!data.success) {
        throw new Error(data.error || 'Failed to create agent');
      }

      const newAgentData: AgentData = {
        agentId: data.agentId,
        agentName: data.agentName,
        kbId: data.kbId,
        endpoint: data.endpoint,
        accessKey: data.accessKey,
        url: data.url,
        isExisting: data.isExisting,
      };
      console.log('[handleSubmit] Setting agentData:', newAgentData);

      setAgentData(newAgentData);

      // Check if agent is already ready (existing agent) or needs indexing
      if (data.status === 'ready' || data.isExisting) {
        console.log('[handleSubmit] Agent ready, redirecting to dashboard');
        // Existing agent - ready immediately
        setStep('ready');

        // Store in localStorage with agent name
        localStorage.setItem(
          `sharkbyte-agent-${data.agentId}`,
          JSON.stringify({
            id: data.agentId,
            name: data.agentName,
            kbId: data.kbId,
            url: data.url,
            endpoint: data.endpoint,
            accessKey: data.accessKey,
            createdAt: new Date().toISOString(),
          })
        );

        // Redirect to agent dashboard
        router.push(`/agents/${data.agentId}`);
      } else {
        console.log('[handleSubmit] New agent, setting step to indexing');
        // New agent - indexing in progress, start polling
        setStep('indexing');
      }
    } catch (err) {
      console.error('[handleSubmit] Error:', err);
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
      description: statusMessage || 'Crawling and processing pages',
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
            <UrlInput onSubmit={handleSubmit} isLoading={false} />

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
