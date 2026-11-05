'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { ChatWidget } from './chat-widget';
import type { DemoConfigResponse } from '@/types';

function isReadyDemoConfig(body: unknown): body is DemoConfigResponse {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  return b.success === true && typeof b.agentId === 'string' && b.status === 'ready';
}

/**
 * Demo chat widget for the SharkByte website: chats with the site's own pinned Sammy.
 * `/api/demo-config` returns its id (creating it on first use); the widget only shows
 * once that Sammy has finished reading the site.
 */
export function DemoChatWidget() {
  const pathname = usePathname();
  const [agentId, setAgentId] = useState<string | null>(null);

  // Check if we're on an embed route
  const isEmbedRoute = pathname?.startsWith('/embed');

  useEffect(() => {
    // Skip fetching config on embed routes
    if (isEmbedRoute) return;

    const fetchConfig = async () => {
      try {
        const response = await fetch('/api/demo-config');
        const body: unknown = await response.json();
        if (response.ok && isReadyDemoConfig(body)) setAgentId(body.agentId);
      } catch (err) {
        console.error('Failed to load demo config:', err);
      }
    };

    fetchConfig();
  }, [isEmbedRoute]);

  // Show nothing until the demo Sammy is ready, and never on embed routes
  if (!agentId || isEmbedRoute) {
    return null;
  }

  return (
    <ChatWidget
      agentId={agentId}
      agentName="Sammy"
      avatarUrl="/sammy/transparent/sammy-avatar-transparent.png"
      primaryColor="#0080FF"
      position="bottom-right"
      welcomeMessage="Hi! I'm Sammy, your SharkByte assistant. Ask me anything about how to create AI-powered support agents for your website!"
    />
  );
}
