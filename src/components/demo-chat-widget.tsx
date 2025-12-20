'use client';

import { useState, useEffect } from 'react';
import { ChatWidget } from './chat-widget';

interface DemoAgentData {
  id: string;
  name: string;
  domain: string;
  endpoint: string;
  accessKey: string;
}

/**
 * Self-healing demo chat widget for the SharkByte website.
 * Automatically fetches or creates the demo agent on mount.
 * If the demo agent is deleted, it will be recreated on next load.
 */
export function DemoChatWidget() {
  const [agent, setAgent] = useState<DemoAgentData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDemoAgent() {
      try {
        // First try to get existing demo agent
        const getRes = await fetch('/api/demo-agent');
        const getData = await getRes.json();

        if (getData.success && getData.agent) {
          setAgent(getData.agent);
          setIsLoading(false);
          return;
        }

        // No production domain configured (localhost/dev) - don't try to create
        if (getData.message === 'No production domain configured') {
          console.log('No production domain configured, skipping demo widget');
          setIsLoading(false);
          return;
        }

        // Agent doesn't exist - create it (only on production)
        console.log('Demo agent not found, creating...');
        const postRes = await fetch('/api/demo-agent', { method: 'POST' });
        const postData = await postRes.json();

        if (postData.success && postData.agent) {
          setAgent(postData.agent);
        } else {
          // Don't show error for expected cases (no production domain)
          if (!postData.error?.includes('No production domain')) {
            setError(postData.error || 'Failed to create demo agent');
          }
        }
      } catch (err) {
        console.error('Failed to load demo agent:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }

    loadDemoAgent();
  }, []);

  // Don't render while loading or on error
  if (isLoading || error || !agent) {
    return null;
  }

  return (
    <ChatWidget
      endpoint={agent.endpoint}
      accessKey={agent.accessKey}
      agentName="Sammy"
      avatarUrl="/sammy/transparent/sammy-avatar-transparent.png"
      primaryColor="#0080FF"
      position="bottom-right"
      welcomeMessage="Hi! I'm Sammy, your SharkByte assistant. Ask me anything about how to create AI-powered support agents for your website!"
    />
  );
}
