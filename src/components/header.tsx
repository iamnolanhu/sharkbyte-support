'use client';

import Link from 'next/link';
import { SammyAvatar } from './sammy-avatar';
import { ThemeToggle } from './theme-toggle';
import { AgentHistory } from './agent-history';

export function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border/50">
      <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Left: Logo/Home link */}
        <Link
          href="/"
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <SammyAvatar size="sm" className="w-8 h-8" />
          <span className="font-bold text-lg bg-gradient-to-r from-[var(--do-blue)] to-[var(--do-teal)] bg-clip-text text-transparent">
            SharkByte
          </span>
        </Link>

        {/* Right: Agent History + Theme Toggle */}
        <div className="flex items-center gap-2">
          <AgentHistory />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
