'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Loader2, Maximize2, Minimize2, Sun, Moon, Waves } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Streamdown } from 'streamdown';
import type { BundledTheme } from 'shiki';
import {
  CHAT_CONSTANTS,
  getTailwindThemeClasses,
  getAccentColor,
  FishSvg,
  OceanDecorations,
  ChatFooter,
} from './chat';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatWidgetProps {
  endpoint: string;
  accessKey: string;
  agentName?: string;
  avatarUrl?: string;
  primaryColor?: string;
  position?: 'bottom-right' | 'bottom-left';
  welcomeMessage?: string;
}

export function ChatWidget({
  endpoint,
  accessKey,
  agentName = CHAT_CONSTANTS.DEFAULT_AGENT_NAME,
  avatarUrl = CHAT_CONSTANTS.AVATAR_URL,
  primaryColor = CHAT_CONSTANTS.DEFAULT_PRIMARY_COLOR,
  position = 'bottom-right',
  welcomeMessage,
}: ChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [mounted, setMounted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { theme, setTheme } = useTheme();

  // Use same theme for both light/dark slots to bypass prefers-color-scheme issues
  // This ensures the correct theme is always used regardless of OS preference
  const shikiTheme: [BundledTheme, BundledTheme] = theme === 'light'
    ? ['github-light', 'github-light']
    : ['dracula', 'dracula'];

  const defaultWelcome = welcomeMessage || CHAT_CONSTANTS.getDefaultWelcome(agentName);

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const cycleTheme = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('ocean');
    else setTheme('light');
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = { role: 'user', content: input.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setStreamingContent('');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage],
          endpoint,
          accessKey,
        }),
      });

      if (!response.ok) {
        throw new Error('Chat request failed');
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('0:')) {
            try {
              const data = JSON.parse(line.slice(2));
              if (data.textDelta) {
                accumulated += data.textDelta;
                setStreamingContent(accumulated);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      setMessages((prev) => [...prev, { role: 'assistant', content: accumulated }]);
      setStreamingContent('');
    } catch (error) {
      console.error('Chat error:', error);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: "Sorry, I encountered an error. Please try again." },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const positionClasses = position === 'bottom-right'
    ? 'right-4 sm:right-6'
    : 'left-4 sm:left-6';

  const maximizedClasses = isMaximized
    ? 'fixed inset-4 sm:inset-6 w-auto h-auto'
    : 'w-[340px] sm:w-[380px] h-[500px]';

  // Theme-aware colors using shared function
  const themeColors = getTailwindThemeClasses(theme as 'light' | 'dark' | 'ocean', mounted);
  const accentColor = getAccentColor(theme as 'light' | 'dark' | 'ocean', primaryColor);

  const ThemeIcon = () => {
    if (!mounted) return <Sun className="w-4 h-4 text-white" />;
    if (theme === 'light') return <Sun className="w-4 h-4 text-white" />;
    if (theme === 'dark') return <Moon className="w-4 h-4 text-white" />;
    return <Waves className="w-4 h-4 text-white" />;
  };

  return (
    <div className={`fixed ${isMaximized ? 'inset-0' : `bottom-4 sm:bottom-6 ${positionClasses}`} z-50`}>
      <AnimatePresence mode="wait">
        {isOpen ? (
          <motion.div
            key="chat-window"
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            layout
            className={`${maximizedClasses} ${themeColors.bg} rounded-2xl shadow-2xl flex flex-col overflow-hidden ${themeColors.border} border`}
            style={{
              boxShadow: `0 10px 40px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.05)`,
              ...(themeColors.isOcean ? { background: 'linear-gradient(180deg, #0a1628 0%, #1a365d 100%)' } : {}),
            }}
          >
            {/* Header */}
            <div
              className={`px-4 py-3 flex items-center gap-3 ${themeColors.border} border-b`}
              style={{ backgroundColor: accentColor }}
            >
              <div className="w-10 h-10 rounded-full bg-white/20 p-1 flex-shrink-0">
                <Image
                  src={avatarUrl}
                  alt={agentName}
                  width={40}
                  height={40}
                  className="w-full h-full object-contain"
                />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-white truncate">{agentName}</h3>
                <p className="text-xs text-white/80">Online</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={cycleTheme}
                  className="p-2 rounded-full hover:bg-white/20 transition-colors"
                  aria-label="Toggle theme"
                >
                  <ThemeIcon />
                </button>
                <button
                  onClick={() => setIsMaximized(!isMaximized)}
                  className="p-2 rounded-full hover:bg-white/20 transition-colors"
                  aria-label={isMaximized ? 'Minimize chat' : 'Maximize chat'}
                >
                  {isMaximized ? (
                    <Minimize2 className="w-4 h-4 text-white" />
                  ) : (
                    <Maximize2 className="w-4 h-4 text-white" />
                  )}
                </button>
                <button
                  onClick={() => {
                    setIsOpen(false);
                    setIsMaximized(false);
                  }}
                  className="p-2 rounded-full hover:bg-white/20 transition-colors"
                  aria-label="Close chat"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className={`flex-1 overflow-y-auto p-4 space-y-4 ${themeColors.bgSecondary} relative`}>
              {/* Ocean theme decorations - subtle bubbles and fish */}
              {themeColors.isOcean && <OceanDecorations />}

              {/* Welcome message */}
              {messages.length === 0 && !streamingContent && (
                <div className="flex gap-3">
                  <div className={`w-8 h-8 rounded-full ${themeColors.bgBubble} p-1 flex-shrink-0 shadow-sm`}>
                    <Image
                      src={avatarUrl}
                      alt={agentName}
                      width={32}
                      height={32}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className={`${themeColors.bgBubble} rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%] shadow-sm`}>
                    <p className={`text-sm ${themeColors.text}`}>{defaultWelcome}</p>
                  </div>
                </div>
              )}

              {/* Message history */}
              {messages.map((message, i) => (
                <div
                  key={i}
                  className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
                >
                  {message.role === 'assistant' && (
                    <div className={`w-8 h-8 rounded-full ${themeColors.bgBubble} p-1 flex-shrink-0 shadow-sm`}>
                      <Image
                        src={avatarUrl}
                        alt={agentName}
                        width={32}
                        height={32}
                        className="w-full h-full object-contain"
                      />
                    </div>
                  )}
                  <div
                    className={`rounded-2xl px-4 py-2 max-w-[80%] shadow-sm ${
                      message.role === 'user'
                        ? 'text-white rounded-tr-sm'
                        : `${themeColors.bgBubble} ${themeColors.text} rounded-tl-sm`
                    }`}
                    style={message.role === 'user' ? { backgroundColor: accentColor } : {}}
                  >
                    {message.role === 'user' ? (
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    ) : (
                      <div className="text-sm">
                        <Streamdown shikiTheme={shikiTheme}>{message.content}</Streamdown>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {/* Streaming message */}
              {streamingContent && (
                <div className="flex gap-3">
                  <div className={`w-8 h-8 rounded-full ${themeColors.bgBubble} p-1 flex-shrink-0 shadow-sm`}>
                    <Image
                      src={avatarUrl}
                      alt={agentName}
                      width={32}
                      height={32}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className={`${themeColors.bgBubble} rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%] shadow-sm`}>
                    <div className={`text-sm ${themeColors.text}`}>
                      <Streamdown shikiTheme={shikiTheme} isAnimating={true}>
                        {streamingContent}
                      </Streamdown>
                    </div>
                  </div>
                </div>
              )}

              {/* Loading indicator */}
              {isLoading && !streamingContent && (
                <div className="flex gap-3">
                  <div className={`w-8 h-8 rounded-full ${themeColors.bgBubble} p-1 flex-shrink-0 shadow-sm`}>
                    <Image
                      src={avatarUrl}
                      alt={agentName}
                      width={32}
                      height={32}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className={`${themeColors.bgBubble} rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm`}>
                    <div className="flex gap-1">
                      <span className={`w-2 h-2 ${themeColors.isOcean ? 'bg-cyan-400' : 'bg-gray-400'} rounded-full animate-bounce`} style={{ animationDelay: '0ms' }} />
                      <span className={`w-2 h-2 ${themeColors.isOcean ? 'bg-cyan-400' : 'bg-gray-400'} rounded-full animate-bounce`} style={{ animationDelay: '150ms' }} />
                      <span className={`w-2 h-2 ${themeColors.isOcean ? 'bg-cyan-400' : 'bg-gray-400'} rounded-full animate-bounce`} style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className={`p-3 ${themeColors.border} border-t ${themeColors.bg}`}>
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message..."
                  rows={1}
                  className={`flex-1 resize-none rounded-xl border ${themeColors.inputBorder} ${themeColors.inputBg} px-4 py-2.5 text-sm focus:outline-none focus:ring-2 ${themeColors.isOcean ? 'focus:ring-cyan-500 text-cyan-50 placeholder:text-cyan-200/40' : 'focus:ring-blue-500 text-inherit placeholder:text-gray-400'}`}
                  style={{ maxHeight: '100px' }}
                  disabled={isLoading}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || isLoading}
                  className="p-2.5 rounded-xl text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                  style={{ backgroundColor: accentColor }}
                  aria-label="Send message"
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </button>
              </div>
              <ChatFooter useTailwind tailwindClass={themeColors.textMuted} />
            </div>
          </motion.div>
        ) : (
          <motion.button
            key="chat-button"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsOpen(true)}
            className="w-14 h-14 sm:w-16 sm:h-16 rounded-full shadow-lg hover:shadow-xl transition-shadow overflow-hidden"
            style={{
              boxShadow: `0 4px 20px rgba(0,0,0,0.15), 0 0 0 3px ${accentColor}40`,
            }}
            aria-label={`Chat with ${agentName}`}
          >
            <Image
              src={avatarUrl}
              alt={agentName}
              width={64}
              height={64}
              className="w-full h-full object-cover"
            />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
