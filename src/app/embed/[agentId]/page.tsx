import { EmbedChatWidget } from '@/components/embed-chat-widget';
import { COPY } from '@/lib/agent-api';
import { APP_DOMAIN } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { getAgentById } from '@/lib/db/agents';

interface EmbedPageProps {
  params: Promise<{ agentId: string }>;
  // Old snippets also send endpoint and access-key params; they are ignored.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const DEFAULT_WELCOME = "Hi! I'm Sammy, your AI assistant. How can I help you today?";

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function EmbedPage({ params, searchParams }: EmbedPageProps) {
  const { agentId } = await params;
  const query = await searchParams;
  const color = single(query.color);
  const welcome = single(query.welcome);
  const agent = await getAgentById(getDb(), agentId);

  return (
    <EmbedChatWidget
      agentId={agentId}
      agentName="Sammy"
      primaryColor={color || '#0080FF'}
      position={single(query.position) === 'bottom-left' ? 'bottom-left' : 'bottom-right'}
      welcomeMessage={welcome || DEFAULT_WELCOME}
      {...(agent ? {} : { retiredMessage: COPY.retired(APP_DOMAIN) })}
    />
  );
}
