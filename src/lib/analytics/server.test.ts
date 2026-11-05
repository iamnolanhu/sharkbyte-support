import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const captureImmediate = vi.fn<(msg: unknown) => Promise<void>>();
const constructed = vi.fn<(key: string, options: unknown) => void>();

vi.mock('posthog-node', () => ({
  PostHog: class {
    constructor(key: string, options: unknown) {
      constructed(key, options);
    }
    captureImmediate = captureImmediate;
  },
}));

import { captureServer } from '@/lib/analytics/server';

beforeEach(() => {
  captureImmediate.mockReset().mockResolvedValue(undefined);
  constructed.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('captureServer', () => {
  it('is a no-op without POSTHOG_API_KEY', async () => {
    vi.stubEnv('POSTHOG_API_KEY', '');
    await captureServer('cron_sweep', { removed: 1 });
    expect(constructed).not.toHaveBeenCalled();
    expect(captureImmediate).not.toHaveBeenCalled();
  });

  it('tags app and surface', async () => {
    vi.stubEnv('POSTHOG_API_KEY', 'phc_test');
    await captureServer('rate_limited', { rail: 'chat_ip' }, 'agent-1');
    expect(captureImmediate).toHaveBeenCalledTimes(1);
    expect(captureImmediate.mock.calls[0]?.[0]).toEqual({
      distinctId: 'agent-1',
      event: 'rate_limited',
      properties: { rail: 'chat_ip', app: 'sharkbyte', surface: 'server' },
    });
  });

  it('uses a stable server distinct id by default', async () => {
    vi.stubEnv('POSTHOG_API_KEY', 'phc_test');
    await captureServer('cron_sweep', {});
    expect(captureImmediate.mock.calls[0]?.[0]).toMatchObject({ distinctId: 'sharkbyte-server' });
  });

  it('never throws when PostHog fails', async () => {
    vi.stubEnv('POSTHOG_API_KEY', 'phc_test');
    captureImmediate.mockRejectedValue(new Error('network down'));
    await expect(captureServer('llm_fallback', {})).resolves.toBeUndefined();
  });
});
