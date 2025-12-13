'use client';

import { ChatWidget } from './chat-widget';

/**
 * Demo chat widget for the SharkByte website.
 * Uses environment variables for the demo agent credentials.
 */
export function DemoChatWidget() {
  const endpoint = process.env.NEXT_PUBLIC_DEMO_AGENT_ENDPOINT;
  const accessKey = process.env.NEXT_PUBLIC_DEMO_AGENT_ACCESS_KEY;

  // Don't render if demo agent not configured
  if (!endpoint || !accessKey) {
    return null;
  }

  return (
    <ChatWidget
      endpoint={endpoint}
      accessKey={accessKey}
      agentName="Sammy"
      avatarUrl="/sammy/transparent/sammy-avatar-transparent.png"
      primaryColor="#0080FF"
      position="bottom-right"
      welcomeMessage="Hi! I'm Sammy, your SharkByte assistant. Ask me anything about how to create AI-powered support agents for your website!"
    />
  );
}
