'use client';

import { usePathname } from 'next/navigation';
import { AnalyticsProvider } from '@/lib/analytics/client';
import { DemoChatWidget } from '@/components/demo-chat-widget';

/** Site-wide analytics and demo widget; embed routes get none of them. */
export function SiteChrome() {
  const pathname = usePathname();
  if (pathname?.startsWith('/embed')) return null;
  return (
    <AnalyticsProvider surface="site">
      <DemoChatWidget />
    </AnalyticsProvider>
  );
}
