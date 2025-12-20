import { EmbedChatWidget } from '@/components/embed-chat-widget';

interface EmbedPageProps {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<{
    endpoint?: string;
    accessKey?: string;
    color?: string;
    position?: string;
    welcome?: string;
  }>;
}

export default async function EmbedPage({ params, searchParams }: EmbedPageProps) {
  const { agentId } = await params;
  const { endpoint, accessKey, color, position, welcome } = await searchParams;

  // Credentials are now passed via URL params from widget.js
  // This eliminates the need for server-side API calls
  if (!endpoint || !accessKey) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui, sans-serif',
        color: '#666',
        fontSize: '14px',
      }}>
        Widget not available
      </div>
    );
  }

  const defaultWelcome = "Hi! I'm Sammy, your AI assistant. How can I help you today?";

  return (
    <EmbedChatWidget
      endpoint={decodeURIComponent(endpoint)}
      accessKey={decodeURIComponent(accessKey)}
      agentId={agentId}
      agentName="Sammy"
      primaryColor={color || '#0080FF'}
      position={(position as 'bottom-right' | 'bottom-left') || 'bottom-right'}
      welcomeMessage={welcome ? decodeURIComponent(welcome) : defaultWelcome}
    />
  );
}
