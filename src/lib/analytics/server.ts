import { PostHog } from 'posthog-node';

export type ServerEvent =
  | 'crawl_finished'
  | 'rate_limited'
  | 'llm_fallback'
  | 'llm_stream_error'
  | 'chat_completed'
  | 'cron_sweep';

const DEFAULT_DISTINCT_ID = 'sharkbyte-server';

/** Analytics drops an event rather than hold a response longer than this. */
const CAPTURE_BUDGET_MS = 2000;

/**
 * Sends one server-side PostHog event and waits for it (at most CAPTURE_BUDGET_MS), so a
 * serverless function can return safely. No-op without POSTHOG_API_KEY; never throws.
 */
export async function captureServer(
  event: ServerEvent,
  properties: Record<string, string | number | boolean | null>,
  distinctId: string = DEFAULT_DISTINCT_ID,
): Promise<void> {
  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const client = new PostHog(apiKey, {
      host: process.env.POSTHOG_HOST || undefined,
      flushAt: 1,
      flushInterval: 0,
      requestTimeout: CAPTURE_BUDGET_MS,
      fetchRetryCount: 0,
    });
    const sent = client.captureImmediate({
      distinctId,
      event,
      properties: { ...properties, app: 'sharkbyte', surface: 'server' },
    });
    sent.catch(() => undefined);
    await Promise.race([
      sent,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, CAPTURE_BUDGET_MS);
      }),
    ]);
  } catch {
    // Analytics must never break a request.
  } finally {
    clearTimeout(timer);
  }
}
