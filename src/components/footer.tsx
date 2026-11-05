'use client';

import Link from 'next/link';
import { track } from '@/lib/analytics/client';

const LINK_CLASS = 'hover:text-primary transition-colors underline-offset-2 hover:underline';

export function Footer() {
  return (
    <footer className="text-center text-xs sm:text-sm text-muted-foreground/60 px-4 py-6 space-y-1">
      <p>
        Made with <span className="text-red-500">❤️</span> by{' '}
        <Link href="https://dev.nolanhu.com" target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
          Nolan
        </Link>
      </p>
      <p>
        Born at the MLH ×{' '}
        <Link
          href="https://www.digitalocean.com/?refcode=732d9583cca9"
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_CLASS}
        >
          DigitalOcean
        </Link>{' '}
        hackathon — 3rd place
      </p>
      <p>
        <Link
          href="https://sigmasynapses.com"
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_CLASS}
          onClick={() => track('footer_sigma_clicked')}
        >
          Need a custom agent? Sigma Synapses →
        </Link>
      </p>
      <p>
        <Link
          href="https://github.com/iamnolanhu/sharkbyte-support"
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_CLASS}
        >
          Open source on GitHub
        </Link>
      </p>
    </footer>
  );
}
