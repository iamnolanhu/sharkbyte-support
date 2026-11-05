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
  LOCAL_ERROR_PREFIX,
  buildChatRequestBody,
  chatErrorCopy,
  toChatMessages,
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

// Shared icons
export {
  CloseIcon,
  SendIcon,
  LoaderIcon,
  SunIcon,
  MoonIcon,
  WavesIcon,
  MaximizeIcon,
  MinimizeIcon,
} from './chat-icons';
