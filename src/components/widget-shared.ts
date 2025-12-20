/**
 * Shared constants and utilities for chat widgets
 * Used by both ChatWidget (main site) and EmbedChatWidget (embeddable)
 */

// Avatar paths (relative to public folder)
export const WIDGET_AVATAR = '/sammy/transparent/sammy-avatar-transparent.png';
export const WIDGET_BUTTON_AVATAR = '/sammy/transparent/sammy-front-transparent.png';

// Footer content
export const FOOTER_LINKS = {
  sharkbyte: 'https://sharkbyte-support.vercel.app',
  author: 'https://dev.nolanhu.com',
};

export const FOOTER_TEXT = {
  poweredBy: 'Powered by',
  sharkbyte: 'SharkByte',
  separator: ' · ',
  madeWith: 'Made with ',
  heart: '❤️',
  by: ' by ',
  author: 'Nolan',
};

// Default messages
export const DEFAULT_WELCOME_MESSAGE = "Hi! I'm Sammy, your AI assistant. How can I help you today?";

// Theme colors
export const THEME_COLORS = {
  light: {
    bg: '#ffffff',
    bgGradient: '#ffffff',
    bgSecondary: '#f5f5f5',
    bgBubble: '#ffffff',
    text: '#333333',
    textMuted: '#666666',
    border: '#e5e5e5',
    inputBg: '#f9f9f9',
    inputBorder: '#dddddd',
    accent: '#0080FF',
    loadingDot: '#999999',
  },
  dark: {
    bg: '#1a1a1a',
    bgGradient: '#1a1a1a',
    bgSecondary: '#262626',
    bgBubble: '#333333',
    text: '#f2f2f2',
    textMuted: '#999999',
    border: '#333333',
    inputBg: '#262626',
    inputBorder: '#444444',
    accent: '#0080FF',
    loadingDot: '#666666',
  },
  ocean: {
    bg: '#0a1628',
    bgGradient: 'linear-gradient(180deg, #0a1628 0%, #1a365d 100%)',
    bgSecondary: '#1e3a5f',
    bgBubble: '#1e3a5f',
    text: '#e0f2fe',
    textMuted: '#7dd3fc',
    border: 'rgba(6, 182, 212, 0.2)',
    inputBg: '#0a1628',
    inputBorder: 'rgba(6, 182, 212, 0.3)',
    accent: '#0891b2',
    loadingDot: '#22d3ee',
  },
};

// Widget dimensions
export const WIDGET_DIMENSIONS = {
  button: { width: 60, height: 60 },
  collapsed: { width: 70, height: 70 },
  expanded: { width: 380, height: 520 },
  maximized: { width: '100%', height: '100%' },
};

// CSS animations for ocean theme bubbles
export const OCEAN_BUBBLE_KEYFRAMES = `
@keyframes bubble-rise {
  0% {
    transform: translateY(0) scale(1);
    opacity: 0;
  }
  10% {
    opacity: 0.15;
  }
  90% {
    opacity: 0.15;
  }
  100% {
    transform: translateY(-400px) scale(0.8);
    opacity: 0;
  }
}
`;

// Helper to get absolute URL for assets
export function getAssetUrl(path: string, baseUrl?: string): string {
  const base = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}${path}`;
}

// Helper to detect if running in embed context
export function isEmbedContext(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true; // Cross-origin iframe
  }
}
