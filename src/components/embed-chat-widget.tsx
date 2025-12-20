'use client';

import { useState, useEffect, useRef } from 'react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface EmbedChatWidgetProps {
  endpoint: string;
  accessKey: string;
  agentId: string;
  agentName?: string;
  primaryColor?: string;
  position?: 'bottom-right' | 'bottom-left';
  welcomeMessage?: string;
}

type Theme = 'light' | 'dark' | 'ocean';

const themes = {
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

export function EmbedChatWidget({
  endpoint,
  accessKey,
  agentId,
  agentName = 'Sammy',
  primaryColor = '#0080FF',
  position = 'bottom-right',
  welcomeMessage = "Hi! How can I help you today?",
}: EmbedChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>('light');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Detect system preference on mount
  useEffect(() => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setTheme(prefersDark ? 'dark' : 'light');

    // Listen for system preference changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      if (theme !== 'ocean') {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Notify parent window of state changes
  useEffect(() => {
    const message = {
      type: isOpen ? 'sharkbyte:open' : 'sharkbyte:close',
      payload: {
        width: isOpen ? 380 : 70,
        height: isOpen ? 520 : 70,
      },
    };
    window.parent.postMessage(message, '*');
  }, [isOpen]);

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
      // Use absolute URL since widget runs in iframe on external sites
      const response = await fetch(`https://sharkbyte-support.vercel.app/api/widget/${agentId}`, {
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

  const colors = themes[theme];
  const accentColor = theme === 'ocean' ? colors.accent : primaryColor;

  // Inline SVG icons
  const CloseIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );

  const SendIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );

  const LoaderIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </svg>
  );

  const SunIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );

  const MoonIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );

  const WavesIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
      <path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1" />
    </svg>
  );

  const ThemeIcon = () => {
    if (theme === 'light') return <SunIcon />;
    if (theme === 'dark') return <MoonIcon />;
    return <WavesIcon />;
  };

  const positionStyle = position === 'bottom-right'
    ? { right: '16px' }
    : { left: '16px' };

  return (
    <>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        .bounce-1 { animation: bounce 0.6s infinite; animation-delay: 0ms; }
        .bounce-2 { animation: bounce 0.6s infinite; animation-delay: 150ms; }
        .bounce-3 { animation: bounce 0.6s infinite; animation-delay: 300ms; }
      `}</style>

      <div
        style={{
          position: 'fixed',
          bottom: '16px',
          ...positionStyle,
          zIndex: 9999,
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        {isOpen ? (
          <div
            style={{
              width: '360px',
              height: '500px',
              background: colors.bgGradient,
              borderRadius: '16px',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              border: `1px solid ${colors.border}`,
              transition: 'all 0.3s ease',
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                backgroundColor: accentColor,
                color: '#fff',
              }}
            >
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(255,255,255,0.2)',
                  padding: '4px',
                  flexShrink: 0,
                }}
              >
                <img
                  src="https://sharkbyte-support.vercel.app/sammy/transparent/sammy-front-transparent.png"
                  alt={agentName}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '15px' }}>{agentName}</div>
                <div style={{ fontSize: '12px', opacity: 0.8 }}>Online</div>
              </div>
              <button
                onClick={cycleTheme}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  padding: '8px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background-color 0.2s',
                }}
                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.2)')}
                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                title={`Current: ${theme}. Click to switch.`}
              >
                <ThemeIcon />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  padding: '8px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background-color 0.2s',
                }}
                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.2)')}
                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <CloseIcon />
              </button>
            </div>

            {/* Messages */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '16px',
                backgroundColor: colors.bgSecondary,
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              {/* Welcome message */}
              {messages.length === 0 && !streamingContent && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: colors.bgBubble,
                      padding: '4px',
                      flexShrink: 0,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    }}
                  >
                    <img
                      src="https://sharkbyte-support.vercel.app/sammy/transparent/sammy-front-transparent.png"
                      alt={agentName}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  </div>
                  <div
                    style={{
                      backgroundColor: colors.bgBubble,
                      borderRadius: '16px',
                      borderTopLeftRadius: '4px',
                      padding: '10px 14px',
                      maxWidth: '80%',
                      fontSize: '14px',
                      color: colors.text,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                    }}
                  >
                    {welcomeMessage}
                  </div>
                </div>
              )}

              {/* Message history */}
              {messages.map((message, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    gap: '8px',
                    flexDirection: message.role === 'user' ? 'row-reverse' : 'row',
                  }}
                >
                  {message.role === 'assistant' && (
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        backgroundColor: colors.bgBubble,
                        padding: '4px',
                        flexShrink: 0,
                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                      }}
                    >
                      <img
                        src="https://sharkbyte-support.vercel.app/sammy/transparent/sammy-front-transparent.png"
                        alt={agentName}
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    </div>
                  )}
                  <div
                    style={{
                      borderRadius: '16px',
                      borderTopLeftRadius: message.role === 'assistant' ? '4px' : '16px',
                      borderTopRightRadius: message.role === 'user' ? '4px' : '16px',
                      padding: '10px 14px',
                      maxWidth: '80%',
                      fontSize: '14px',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                      whiteSpace: 'pre-wrap' as const,
                      ...(message.role === 'user'
                        ? { backgroundColor: accentColor, color: '#fff' }
                        : { backgroundColor: colors.bgBubble, color: colors.text }),
                    }}
                  >
                    {message.content}
                  </div>
                </div>
              ))}

              {/* Streaming message */}
              {streamingContent && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: colors.bgBubble,
                      padding: '4px',
                      flexShrink: 0,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    }}
                  >
                    <img
                      src="https://sharkbyte-support.vercel.app/sammy/transparent/sammy-front-transparent.png"
                      alt={agentName}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  </div>
                  <div
                    style={{
                      backgroundColor: colors.bgBubble,
                      borderRadius: '16px',
                      borderTopLeftRadius: '4px',
                      padding: '10px 14px',
                      maxWidth: '80%',
                      fontSize: '14px',
                      color: colors.text,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                      whiteSpace: 'pre-wrap' as const,
                    }}
                  >
                    {streamingContent}
                    <span
                      style={{
                        display: 'inline-block',
                        width: '6px',
                        height: '16px',
                        backgroundColor: colors.loadingDot,
                        marginLeft: '2px',
                        animation: 'bounce 0.6s infinite',
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Loading indicator */}
              {isLoading && !streamingContent && (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '50%',
                      backgroundColor: colors.bgBubble,
                      padding: '4px',
                      flexShrink: 0,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    }}
                  >
                    <img
                      src="https://sharkbyte-support.vercel.app/sammy/transparent/sammy-front-transparent.png"
                      alt={agentName}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  </div>
                  <div
                    style={{
                      backgroundColor: colors.bgBubble,
                      borderRadius: '16px',
                      borderTopLeftRadius: '4px',
                      padding: '12px 14px',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                      display: 'flex',
                      gap: '4px',
                    }}
                  >
                    <span className="bounce-1" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: colors.loadingDot }} />
                    <span className="bounce-2" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: colors.loadingDot }} />
                    <span className="bounce-3" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: colors.loadingDot }} />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div
              style={{
                padding: '12px',
                borderTop: `1px solid ${colors.border}`,
                backgroundColor: colors.bg,
              }}
            >
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message..."
                  rows={1}
                  disabled={isLoading}
                  style={{
                    flex: 1,
                    resize: 'none',
                    borderRadius: '12px',
                    border: `1px solid ${colors.inputBorder}`,
                    backgroundColor: colors.inputBg,
                    padding: '10px 14px',
                    fontSize: '14px',
                    color: colors.text,
                    outline: 'none',
                    maxHeight: '100px',
                    fontFamily: 'inherit',
                  }}
                  onFocus={(e) => (e.target.style.borderColor = accentColor)}
                  onBlur={(e) => (e.target.style.borderColor = colors.inputBorder)}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || isLoading}
                  style={{
                    padding: '10px',
                    borderRadius: '12px',
                    border: 'none',
                    backgroundColor: accentColor,
                    color: '#fff',
                    cursor: !input.trim() || isLoading ? 'not-allowed' : 'pointer',
                    opacity: !input.trim() || isLoading ? 0.5 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'opacity 0.2s',
                  }}
                >
                  {isLoading ? <LoaderIcon /> : <SendIcon />}
                </button>
              </div>
              <div
                style={{
                  textAlign: 'center',
                  fontSize: '10px',
                  color: colors.textMuted,
                  marginTop: '8px',
                }}
              >
                Powered by{' '}
                <a
                  href="https://sharkbyte-support.vercel.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: colors.textMuted, textDecoration: 'none' }}
                >
                  SharkByte
                </a>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsOpen(true)}
            style={{
              width: '60px',
              height: '60px',
              borderRadius: '50%',
              border: 'none',
              cursor: 'pointer',
              boxShadow: `0 4px 20px rgba(0,0,0,0.15), 0 0 0 3px ${accentColor}40`,
              overflow: 'hidden',
              padding: 0,
              transition: 'transform 0.2s',
            }}
            onMouseOver={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
            onMouseOut={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            <img
              src="https://sharkbyte-support.vercel.app/sammy/transparent/sammy-front-transparent.png"
              alt={`Chat with ${agentName}`}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </button>
        )}
      </div>
    </>
  );
}
