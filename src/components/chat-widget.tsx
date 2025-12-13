'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Loader2, Maximize2, Minimize2, Sun, Moon, Waves } from 'lucide-react';
import { useTheme } from 'next-themes';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Mini fish SVG for ocean theme
function FishSvg({ size, opacity, direction }: { size: number; opacity: number; direction: 'left' | 'right' }) {
  return (
    <svg
      width={size}
      height={size * 0.6}
      viewBox="0 0 24 14"
      style={{ transform: direction === 'right' ? 'scaleX(-1)' : 'none' }}
    >
      <path
        d="M23 7c-3-4-6-6-11-6C7 1 4 4 1 7c3 3 6 6 11 6 5 0 8-2 11-6z"
        fill={`rgba(0, 175, 206, ${opacity})`}
      />
      <circle cx="6" cy="7" r="1.5" fill={`rgba(255, 255, 255, ${opacity * 0.8})`} />
    </svg>
  );
}

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
  agentName = 'Sammy',
  avatarUrl = '/sammy/transparent/sammy-avatar-transparent.png',
  primaryColor = '#0080FF',
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

  const defaultWelcome = welcomeMessage || `Hi! I'm ${agentName}. How can I help you today?`;

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

  // Theme-aware colors
  const isOcean = mounted && theme === 'ocean';
  const isDark = mounted && (theme === 'dark' || theme === 'ocean');

  const themeColors = {
    bg: isOcean ? 'bg-[#0a1628]' : isDark ? 'bg-gray-900' : 'bg-white',
    bgSecondary: isOcean ? 'bg-[#1e3a5f]' : isDark ? 'bg-gray-800' : 'bg-gray-50',
    bgBubble: isOcean ? 'bg-[#1e3a5f]' : isDark ? 'bg-gray-700' : 'bg-white',
    text: isOcean ? 'text-cyan-50' : isDark ? 'text-gray-200' : 'text-gray-800',
    textMuted: isOcean ? 'text-cyan-200/60' : isDark ? 'text-gray-400' : 'text-gray-400',
    border: isOcean ? 'border-cyan-500/20' : isDark ? 'border-gray-700' : 'border-gray-200',
    inputBg: isOcean ? 'bg-[#0a1628]' : isDark ? 'bg-gray-800' : 'bg-gray-50',
    inputBorder: isOcean ? 'border-cyan-500/30' : isDark ? 'border-gray-600' : 'border-gray-200',
    accent: isOcean ? '#0891b2' : primaryColor,
  };

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
              ...(isOcean ? { background: 'linear-gradient(180deg, #0a1628 0%, #1a365d 100%)' } : {}),
            }}
          >
            {/* Header */}
            <div
              className={`px-4 py-3 flex items-center gap-3 ${themeColors.border} border-b`}
              style={{ backgroundColor: themeColors.accent }}
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
              {isOcean && (
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                  {/* Mini bubbles */}
                  {[...Array(6)].map((_, i) => (
                    <motion.div
                      key={`bubble-${i}`}
                      className="absolute rounded-full"
                      style={{
                        width: 4 + (i % 3) * 2,
                        height: 4 + (i % 3) * 2,
                        left: `${15 + i * 15}%`,
                        bottom: '-5%',
                        background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.2), rgba(0,175,206,0.1))`,
                      }}
                      animate={{
                        y: [0, -400],
                        opacity: [0, 0.15, 0.15, 0],
                      }}
                      transition={{
                        duration: 8 + i * 2,
                        repeat: Infinity,
                        delay: i * 1.5,
                        ease: 'easeOut',
                      }}
                    />
                  ))}
                  {/* Mini fish */}
                  {[0, 1].map((i) => (
                    <motion.div
                      key={`fish-${i}`}
                      className="absolute"
                      style={{ top: `${30 + i * 30}%` }}
                      initial={{ x: i === 0 ? '-20px' : '100%' }}
                      animate={{ x: i === 0 ? '100%' : '-20px' }}
                      transition={{
                        duration: 15 + i * 5,
                        repeat: Infinity,
                        delay: i * 8,
                        ease: 'linear',
                      }}
                    >
                      <FishSvg size={12} opacity={0.1} direction={i === 0 ? 'right' : 'left'} />
                    </motion.div>
                  ))}
                </div>
              )}

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
                    style={message.role === 'user' ? { backgroundColor: themeColors.accent } : {}}
                  >
                    {message.role === 'user' ? (
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    ) : (
                      <div className="text-sm chat-markdown">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                            ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
                            ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
                            li: ({ children }) => <li className="mb-1">{children}</li>,
                            code: ({ children }) => (
                              <code className={`${isOcean ? 'bg-cyan-900/50' : isDark ? 'bg-gray-600' : 'bg-gray-200'} px-1 py-0.5 rounded text-xs`}>
                                {children}
                              </code>
                            ),
                            pre: ({ children }) => (
                              <pre className={`${isOcean ? 'bg-cyan-900/50' : isDark ? 'bg-gray-600' : 'bg-gray-200'} p-2 rounded overflow-x-auto text-xs my-2`}>
                                {children}
                              </pre>
                            ),
                            strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                            em: ({ children }) => <em className="italic">{children}</em>,
                            a: ({ href, children }) => (
                              <a href={href} target="_blank" rel="noopener noreferrer" className={`${isOcean ? 'text-cyan-300' : 'text-blue-500'} hover:underline`}>
                                {children}
                              </a>
                            ),
                            h1: ({ children }) => <h1 className="text-lg font-bold mb-2">{children}</h1>,
                            h2: ({ children }) => <h2 className="text-base font-bold mb-2">{children}</h2>,
                            h3: ({ children }) => <h3 className="text-sm font-bold mb-1">{children}</h3>,
                            blockquote: ({ children }) => (
                              <blockquote className={`border-l-2 ${isOcean ? 'border-cyan-500' : 'border-gray-400'} pl-3 my-2 italic`}>
                                {children}
                              </blockquote>
                            ),
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
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
                    <div className={`text-sm ${themeColors.text} chat-markdown`}>
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
                          ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
                          li: ({ children }) => <li className="mb-1">{children}</li>,
                          code: ({ children }) => (
                            <code className={`${isOcean ? 'bg-cyan-900/50' : isDark ? 'bg-gray-600' : 'bg-gray-200'} px-1 py-0.5 rounded text-xs`}>
                              {children}
                            </code>
                          ),
                          pre: ({ children }) => (
                            <pre className={`${isOcean ? 'bg-cyan-900/50' : isDark ? 'bg-gray-600' : 'bg-gray-200'} p-2 rounded overflow-x-auto text-xs my-2`}>
                              {children}
                            </pre>
                          ),
                          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                          em: ({ children }) => <em className="italic">{children}</em>,
                          a: ({ href, children }) => (
                            <a href={href} target="_blank" rel="noopener noreferrer" className={`${isOcean ? 'text-cyan-300' : 'text-blue-500'} hover:underline`}>
                              {children}
                            </a>
                          ),
                        }}
                      >
                        {streamingContent}
                      </ReactMarkdown>
                      <span className={`inline-block w-1.5 h-4 ${isOcean ? 'bg-cyan-400' : 'bg-gray-400'} ml-0.5 animate-pulse`} />
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
                      <span className={`w-2 h-2 ${isOcean ? 'bg-cyan-400' : 'bg-gray-400'} rounded-full animate-bounce`} style={{ animationDelay: '0ms' }} />
                      <span className={`w-2 h-2 ${isOcean ? 'bg-cyan-400' : 'bg-gray-400'} rounded-full animate-bounce`} style={{ animationDelay: '150ms' }} />
                      <span className={`w-2 h-2 ${isOcean ? 'bg-cyan-400' : 'bg-gray-400'} rounded-full animate-bounce`} style={{ animationDelay: '300ms' }} />
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
                  className={`flex-1 resize-none rounded-xl border ${themeColors.inputBorder} ${themeColors.inputBg} px-4 py-2.5 text-sm focus:outline-none focus:ring-2 ${isOcean ? 'focus:ring-cyan-500 text-cyan-50 placeholder:text-cyan-200/40' : 'focus:ring-blue-500 text-inherit placeholder:text-gray-400'}`}
                  style={{ maxHeight: '100px' }}
                  disabled={isLoading}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || isLoading}
                  className="p-2.5 rounded-xl text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                  style={{ backgroundColor: themeColors.accent }}
                  aria-label="Send message"
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </button>
              </div>
              <p className={`text-[10px] ${themeColors.textMuted} text-center mt-2`}>
                Powered by{' '}
                <a
                  href="https://sharkbyte-support.vercel.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`hover:opacity-80 transition-colors`}
                >
                  SharkByte
                </a>
                {' · '}
                Made with <span className="text-red-400">❤️</span> by{' '}
                <a
                  href="https://dev.nolanhu.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`hover:opacity-80 transition-colors`}
                >
                  Nolan
                </a>
              </p>
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
              boxShadow: `0 4px 20px rgba(0,0,0,0.15), 0 0 0 3px ${themeColors.accent}40`,
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
