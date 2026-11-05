'use client';

import { usePathname } from 'next/navigation';
import { AnalyticsProvider } from '@/lib/analytics/client';
import { Footer } from '@/components/footer';
import { DemoChatWidget } from '@/components/demo-chat-widget';

/** Site-wide analytics, footer and demo widget; embed routes get none of them. */
export function SiteChrome() {
  const pathname = usePathname();
  if (pathname?.startsWith('/embed')) return null;
  return (
    <AnalyticsProvider surface="site">
      <Footer />
      <DemoChatWidget />
    </AnalyticsProvider>
  );
}
