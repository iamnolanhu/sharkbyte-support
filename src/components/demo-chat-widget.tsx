'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { ChatWidget } from './chat-widget';

interface DemoConfig {
  endpoint: string;
  accessKey: string;
}

/**
 * Demo chat widget for the SharkByte website.
 *
 * Uses a hybrid approach for configuration:
 * 1. Fast path: Uses NEXT_PUBLIC_* env vars if set (instant load)
 * 2. Fallback: Fetches from /api/demo-config (lazy initialization)
 */
export function DemoChatWidget() {
  const pathname = usePathname();
  const [config, setConfig] = useState<DemoConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check if we're on an embed route
  const isEmbedRoute = pathname?.startsWith('/embed');

  useEffect(() => {
    // Skip fetching config on embed routes
    if (isEmbedRoute) {
      setLoading(false);
      return;
    }
    // Fast path: check env vars first (they're baked into client bundle at build time)
    const envEndpoint = process.env.NEXT_PUBLIC_DEMO_AGENT_ENDPOINT;
    const envAccessKey = process.env.NEXT_PUBLIC_DEMO_AGENT_ACCESS_KEY;

    if (envEndpoint && envAccessKey) {
      setConfig({ endpoint: envEndpoint, accessKey: envAccessKey });
      setLoading(false);
      return;
    }

    // Fallback: fetch from API (lazy initialization)
    const fetchConfig = async () => {
      try {
        const response = await fetch('/api/demo-config');
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || 'Failed to load demo config');
        }

        if (data.endpoint && data.accessKey) {
          setConfig({ endpoint: data.endpoint, accessKey: data.accessKey });
        } else {
          throw new Error('Invalid demo config response');
        }
      } catch (err) {
        console.error('Failed to load demo config:', err);
        setError(err instanceof Error ? err.message : 'Failed to load demo widget');
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, [isEmbedRoute]);

  // Show nothing while loading, on error, or on embed routes
  if (loading || error || !config || isEmbedRoute) {
    return null;
  }

  return (
    <ChatWidget
      endpoint={config.endpoint}
      accessKey={config.accessKey}
      agentName="Sammy"
      avatarUrl="/sammy/transparent/sammy-avatar-transparent.png"
      primaryColor="#0080FF"
      position="bottom-right"
      welcomeMessage="Hi! I'm Sammy, your SharkByte assistant. Ask me anything about how to create AI-powered support agents for your website!"
    />
  );
}
