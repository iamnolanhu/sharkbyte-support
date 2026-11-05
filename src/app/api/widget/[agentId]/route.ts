import { chatRequestMeta } from '@/lib/chat/chat-event';
import { handleChat } from '@/lib/chat/handle-chat';
import { getClientIp } from '@/lib/rails';

export const maxDuration = 60;

// Embedded widgets live on any site, so this route is public by design.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

interface RouteContext {
  params: Promise<{ agentId: string }>;
}

/** POST /api/widget/[agentId] { messages }: the embedded widget's chat. */
export async function POST(request: Request, context: RouteContext) {
  const { agentId } = await context.params;
  const raw = await request.text();
  return handleChat({
    agentId,
    raw,
    ip: getClientIp(request.headers),
    corsHeaders: CORS_HEADERS,
    meta: chatRequestMeta(request.headers, 'embed'),
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
