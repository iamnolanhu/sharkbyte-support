'use client';

import { useEffect, type ReactNode } from 'react';
import posthog from 'posthog-js';

export type ClientEvent =
  | 'agent_create_submitted'
  | 'agent_ready'
  | 'agent_failed'
  | 'chat_message_sent'
  | 'embed_code_copied'
  | 'embed_widget_opened'
  | 'footer_sigma_clicked'
  | 'demo_limit_hit';

export type AnalyticsSurface = 'site' | 'embed';

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';

let initialized = false;

/**
 * Starts PostHog once per page and tags every event with the app and surface.
 * Off (returns false) without NEXT_PUBLIC_POSTHOG_KEY.
 */
export function initAnalytics(surface: AnalyticsSurface): boolean {
  // Literal process.env reads so Next.js inlines them into the client bundle.
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return false;
  if (initialized) return true;
  posthog.init(key, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || DEFAULT_POSTHOG_HOST,
    capture_pageview: 'history_change',
    autocapture: true,
    disable_session_recording: false,
  });
  posthog.register({ app: 'sharkbyte', surface });
  initialized = true;
  return true;
}

/** Sends a named event; a no-op when analytics is off. */
export function track(event: ClientEvent, props?: Record<string, string | number | boolean>): void {
  if (!initialized) return;
  posthog.capture(event, props);
}

interface AnalyticsProviderProps {
  surface: AnalyticsSurface;
  children?: ReactNode;
}

export function AnalyticsProvider({ surface, children }: AnalyticsProviderProps) {
  useEffect(() => {
    initAnalytics(surface);
  }, [surface]);
  return <>{children}</>;
}
