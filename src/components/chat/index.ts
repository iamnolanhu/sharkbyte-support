/**
 * Shared chat components and utilities
 * Used by chat-widget.tsx and embed-chat-widget.tsx
 */

// Theme configuration
export {
  type Theme,
  type ThemeColors,
  themes,
  getThemeColors,
  getTailwindThemeClasses,
  getAccentColor,
  CHAT_CONSTANTS,
} from './chat-theme';

// Chat logic hook
export {
  type ChatMessage,
  type UseChatOptions,
  type UseChatReturn,
  useChat,
} from './chat-core';

// Ocean theme decorations
export {
  FishSvg,
  OceanDecorations,
  OceanDecorationsInline,
  getOceanDecorationsStyles,
} from './chat-decorations';

// Footer component
export { ChatFooter } from './chat-footer';
