import { chatRequestMeta } from '@/lib/chat/chat-event';
import { handleChat } from '@/lib/chat/handle-chat';
import { getLimits } from '@/lib/config';
import { getClientIp } from '@/lib/rails';

export const maxDuration = 60;

/** The `agentId` field of a body small enough to parse; anything else → '' (answered as retired). */
function readAgentId(raw: string): string {
  if (Buffer.byteLength(raw, 'utf8') > getLimits().maxChatBodyBytes) return '';
  try {
    const body: unknown = JSON.parse(raw);
    if (typeof body === 'object' && body !== null && 'agentId' in body && typeof body.agentId === 'string') {
      return body.agentId;
    }
  } catch {
    // handleChat answers the malformed body with a 400
  }
  return '';
}

/** POST /api/chat { agentId, messages }: the site's own chat, streamed as a UI message stream. */
export async function POST(request: Request) {
  const raw = await request.text();
  return handleChat({
    agentId: readAgentId(raw),
    raw,
    ip: getClientIp(request.headers),
    meta: chatRequestMeta(request.headers, 'site'),
  });
}
