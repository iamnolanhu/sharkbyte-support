import { getAgent, createAccessKey } from '@/lib/digitalocean';
import { EmbedChatWidget } from '@/components/embed-chat-widget';

interface EmbedPageProps {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<{
    color?: string;
    position?: string;
    welcome?: string;
  }>;
}

async function getAgentForEmbed(agentId: string) {
  try {
    const agentResponse = await getAgent(agentId);
    const agent = agentResponse.agent;

    // Ensure agent has an endpoint
    if (!agent.endpoint) {
      console.error('Agent has no endpoint');
      return null;
    }

    // Create a new API key for this embed session
    const keyResponse = await createAccessKey(agentId);
    const accessKey = keyResponse.api_key_info?.secret_key ||
                     keyResponse.access_key?.key ||
                     keyResponse.access_key?.api_key || '';

    // Extract domain from agent name (format: "Sammy - domain.com")
    const nameParts = agent.name.split(' - ');
    const domain = nameParts.length > 1 ? nameParts[1] : 'your website';

    return {
      endpoint: agent.endpoint,
      accessKey,
      name: 'Sammy',
      domain,
    };
  } catch (error) {
    console.error('Failed to get agent for embed:', error);
    return null;
  }
}

export default async function EmbedPage({ params, searchParams }: EmbedPageProps) {
  const { agentId } = await params;
  const { color, position, welcome } = await searchParams;

  const agentData = await getAgentForEmbed(agentId);

  if (!agentData) {
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

  const defaultWelcome = `Hi! I'm Sammy, your AI assistant for ${agentData.domain}. How can I help you today?`;

  return (
    <EmbedChatWidget
      endpoint={agentData.endpoint}
      accessKey={agentData.accessKey}
      agentId={agentId}
      agentName={agentData.name}
      primaryColor={color || '#0080FF'}
      position={(position as 'bottom-right' | 'bottom-left') || 'bottom-right'}
      welcomeMessage={welcome || defaultWelcome}
    />
  );
}
