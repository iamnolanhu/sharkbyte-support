/**
 * Shared theme configuration for chat widgets
 * Used by both chat-widget.tsx and embed-chat-widget.tsx
 */

export type Theme = 'light' | 'dark' | 'ocean';

export interface ThemeColors {
  bg: string;
  bgGradient: string;
  bgSecondary: string;
  bgBubble: string;
  text: string;
  textMuted: string;
  border: string;
  inputBg: string;
  inputBorder: string;
  accent: string;
  loadingDot: string;
}

export const themes: Record<Theme, ThemeColors> = {
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

export function getThemeColors(theme: Theme, customAccent?: string): ThemeColors {
  const colors = { ...themes[theme] };
  // Custom accent color only applies to light/dark themes, not ocean
  if (customAccent && theme !== 'ocean') {
    colors.accent = customAccent;
  }
  return colors;
}

/**
 * Get Tailwind-compatible theme classes for chat-widget
 * This bridges the gap between inline styles (embed) and Tailwind (main widget)
 */
export function getTailwindThemeClasses(theme: Theme, mounted: boolean) {
  const isOcean = mounted && theme === 'ocean';
  const isDark = mounted && (theme === 'dark' || theme === 'ocean');

  return {
    bg: isOcean ? 'bg-[#0a1628]' : isDark ? 'bg-gray-900' : 'bg-white',
    bgSecondary: isOcean ? 'bg-[#1e3a5f]' : isDark ? 'bg-gray-800' : 'bg-gray-50',
    bgBubble: isOcean ? 'bg-[#1e3a5f]' : isDark ? 'bg-gray-700' : 'bg-white',
    text: isOcean ? 'text-cyan-50' : isDark ? 'text-gray-200' : 'text-gray-800',
    textMuted: isOcean ? 'text-cyan-200/60' : isDark ? 'text-gray-400' : 'text-gray-400',
    border: isOcean ? 'border-cyan-500/20' : isDark ? 'border-gray-700' : 'border-gray-200',
    inputBg: isOcean ? 'bg-[#0a1628]' : isDark ? 'bg-gray-800' : 'bg-gray-50',
    inputBorder: isOcean ? 'border-cyan-500/30' : isDark ? 'border-gray-600' : 'border-gray-200',
    isOcean,
    isDark,
  };
}

/**
 * Get the appropriate accent color based on theme
 */
export function getAccentColor(theme: Theme, primaryColor: string = '#0080FF'): string {
  return theme === 'ocean' ? '#0891b2' : primaryColor;
}

/**
 * Chat widget constants
 */
export const CHAT_CONSTANTS = {
  DEFAULT_AGENT_NAME: 'Sammy',
  AVATAR_URL: '/sammy/transparent/sammy-avatar-transparent.png',
  AVATAR_URL_ABSOLUTE: 'https://sharkbyte-support.vercel.app/sammy/transparent/sammy-avatar-transparent.png',
  DEFAULT_PRIMARY_COLOR: '#0080FF',
  getDefaultWelcome: (agentName: string) => `Hi! I'm ${agentName}. How can I help you today?`,
};
