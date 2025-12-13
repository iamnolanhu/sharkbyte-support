import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ agentId: string }>;
}

export default async function OldChatPage({ params }: PageProps) {
  const { agentId } = await params;
  redirect(`/agents/${agentId}/chat`);
}
