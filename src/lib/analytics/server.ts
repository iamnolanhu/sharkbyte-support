import { PostHog } from 'posthog-node';

export type ServerEvent =
  | 'crawl_finished'
  | 'rate_limited'
  | 'llm_fallback'
  | 'llm_stream_error'
  | 'cron_sweep';

const DEFAULT_DISTINCT_ID = 'sharkbyte-server';

/**
 * Sends one server-side PostHog event and waits for it, so a serverless function
 * can return safely. No-op without POSTHOG_API_KEY; never throws.
 */
export async function captureServer(
  event: ServerEvent,
  properties: Record<string, string | number | boolean | null>,
  distinctId: string = DEFAULT_DISTINCT_ID,
): Promise<void> {
  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) return;
  try {
    const client = new PostHog(apiKey, {
      host: process.env.POSTHOG_HOST || undefined,
      flushAt: 1,
      flushInterval: 0,
    });
    await client.captureImmediate({
      distinctId,
      event,
      properties: { ...properties, app: 'sharkbyte', surface: 'server' },
    });
  } catch {
    // Analytics must never break a request.
  }
}
