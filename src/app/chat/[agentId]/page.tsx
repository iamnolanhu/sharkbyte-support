import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function OldChatPage({ params, searchParams }: PageProps) {
  const { agentId } = await params;
  const search = await searchParams;

  // Forward query params (indexing, kbId) to the new chat page
  const queryString = new URLSearchParams(
    Object.entries(search)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, Array.isArray(v) ? v[0] : v] as [string, string])
  ).toString();

  redirect(`/agents/${agentId}/chat${queryString ? `?${queryString}` : ''}`);
}
