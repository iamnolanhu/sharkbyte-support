'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Loader2, Maximize2, Minimize2 } from 'lucide-react';

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const defaultWelcome = welcomeMessage || `Hi! I'm ${agentName}. How can I help you today?`;

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
            className={`${maximizedClasses} bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700`}
            style={{
              boxShadow: `0 10px 40px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.05)`,
            }}
          >
            {/* Header */}
            <div
              className="px-4 py-3 flex items-center gap-3 border-b border-gray-200 dark:border-gray-700"
              style={{ backgroundColor: primaryColor }}
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
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-gray-800">
              {/* Welcome message */}
              {messages.length === 0 && !streamingContent && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-white dark:bg-gray-700 p-1 flex-shrink-0 shadow-sm">
                    <Image
                      src={avatarUrl}
                      alt={agentName}
                      width={32}
                      height={32}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="bg-white dark:bg-gray-700 rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%] shadow-sm">
                    <p className="text-sm text-gray-800 dark:text-gray-200">{defaultWelcome}</p>
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
                    <div className="w-8 h-8 rounded-full bg-white dark:bg-gray-700 p-1 flex-shrink-0 shadow-sm">
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
                        ? 'bg-blue-500 text-white rounded-tr-sm'
                        : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-tl-sm'
                    }`}
                    style={message.role === 'user' ? { backgroundColor: primaryColor } : {}}
                  >
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  </div>
                </div>
              ))}

              {/* Streaming message */}
              {streamingContent && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-white dark:bg-gray-700 p-1 flex-shrink-0 shadow-sm">
                    <Image
                      src={avatarUrl}
                      alt={agentName}
                      width={32}
                      height={32}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="bg-white dark:bg-gray-700 rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%] shadow-sm">
                    <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                      {streamingContent}
                      <span className="inline-block w-1.5 h-4 bg-gray-400 dark:bg-gray-500 ml-0.5 animate-pulse" />
                    </p>
                  </div>
                </div>
              )}

              {/* Loading indicator */}
              {isLoading && !streamingContent && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-white dark:bg-gray-700 p-1 flex-shrink-0 shadow-sm">
                    <Image
                      src={avatarUrl}
                      alt={agentName}
                      width={32}
                      height={32}
                      className="w-full h-full object-contain"
                    />
                  </div>
                  <div className="bg-white dark:bg-gray-700 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message..."
                  rows={1}
                  className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white placeholder:text-gray-400"
                  style={{ maxHeight: '100px' }}
                  disabled={isLoading}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || isLoading}
                  className="p-2.5 rounded-xl text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                  style={{ backgroundColor: primaryColor }}
                  aria-label="Send message"
                >
                  {isLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Send className="w-5 h-5" />
                  )}
                </button>
              </div>
              <p className="text-[10px] text-gray-400 text-center mt-2">
                Powered by{' '}
                <a
                  href="https://sharkbyte-support.vercel.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  SharkByte
                </a>
                {' · '}
                Made with <span className="text-red-400">❤️</span> by{' '}
                <a
                  href="https://dev.nolanhu.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
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
              boxShadow: `0 4px 20px rgba(0,0,0,0.15), 0 0 0 3px ${primaryColor}40`,
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
