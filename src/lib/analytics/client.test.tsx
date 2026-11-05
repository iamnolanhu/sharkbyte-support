import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const posthogMock = vi.hoisted(() => ({
  init: vi.fn(),
  register: vi.fn(),
  capture: vi.fn(),
}));

vi.mock('posthog-js', () => ({ default: posthogMock }));

async function loadClient() {
  vi.resetModules();
  return import('./client');
}

describe('analytics client', () => {
  beforeEach(() => {
    posthogMock.init.mockReset();
    posthogMock.register.mockReset();
    posthogMock.capture.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('initAnalytics is off without a key', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    const { initAnalytics, track } = await loadClient();

    expect(initAnalytics('site')).toBe(false);
    expect(posthogMock.init).not.toHaveBeenCalled();
    expect(() => track('agent_ready')).not.toThrow();
    expect(posthogMock.capture).not.toHaveBeenCalled();
  });

  it('initAnalytics registers app and surface', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test_placeholder');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', '');
    const { initAnalytics, track } = await loadClient();

    expect(initAnalytics('embed')).toBe(true);
    expect(initAnalytics('embed')).toBe(true);

    expect(posthogMock.init).toHaveBeenCalledTimes(1);
    // Inside customer sites: no replay, no autocapture family, named events only.
    expect(posthogMock.init).toHaveBeenCalledWith('phc_test_placeholder', {
      api_host: 'https://us.i.posthog.com',
      capture_pageview: 'history_change',
      autocapture: false,
      rageclick: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      disable_session_recording: true,
    });
    expect(posthogMock.register).toHaveBeenCalledTimes(1);
    expect(posthogMock.register).toHaveBeenCalledWith({ app: 'sharkbyte', surface: 'embed' });

    track('demo_limit_hit', { rail: 'chat_tokens' });
    expect(posthogMock.capture).toHaveBeenCalledWith('demo_limit_hit', { rail: 'chat_tokens' });
  });

  it('initAnalytics turns on replay and autocapture on the site surface only', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test_placeholder');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', '');
    const { initAnalytics, track } = await loadClient();

    expect(initAnalytics('site')).toBe(true);

    expect(posthogMock.init).toHaveBeenCalledWith('phc_test_placeholder', {
      api_host: 'https://us.i.posthog.com',
      capture_pageview: 'history_change',
      autocapture: true,
      rageclick: true,
      capture_dead_clicks: true,
      capture_heatmaps: true,
      disable_session_recording: false,
    });
    expect(posthogMock.register).toHaveBeenCalledWith({ app: 'sharkbyte', surface: 'site' });
    track('agent_ready');
    expect(posthogMock.capture).toHaveBeenCalledWith('agent_ready', undefined);
  });

  it('initAnalytics uses the configured host', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test_placeholder');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://eu.i.posthog.com');
    const { initAnalytics } = await loadClient();

    initAnalytics('site');
    expect(posthogMock.init).toHaveBeenCalledWith(
      'phc_test_placeholder',
      expect.objectContaining({ api_host: 'https://eu.i.posthog.com' }),
    );
  });
});
