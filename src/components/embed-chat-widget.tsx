'use client';

import { useState, useEffect } from 'react';
import { Streamdown } from 'streamdown';
import type { BundledTheme } from 'shiki';
import {
  type Theme,
  type ChatMessage,
  themes,
  getAccentColor,
  CHAT_CONSTANTS,
  OceanDecorationsInline,
  getOceanDecorationsStyles,
  ChatFooter,
  useChat,
  CloseIcon,
  SendIcon,
  LoaderIcon,
  SunIcon,
  MoonIcon,
  WavesIcon,
  MaximizeIcon,
  MinimizeIcon,
} from './chat';

interface EmbedChatWidgetProps {
  endpoint: string;
  accessKey: string;
  agentId: string;
  agentName?: string;
  primaryColor?: string;
  position?: 'bottom-right' | 'bottom-left';
  welcomeMessage?: string;
}

export function EmbedChatWidget({
  endpoint,
  accessKey,
  agentId,
  agentName = CHAT_CONSTANTS.DEFAULT_AGENT_NAME,
  primaryColor = CHAT_CONSTANTS.DEFAULT_PRIMARY_COLOR,
  position = 'bottom-right',
  welcomeMessage,
}: EmbedChatWidgetProps) {
  // Compute default welcome message with agent name
  const defaultWelcome = welcomeMessage || CHAT_CONSTANTS.getDefaultWelcome(agentName);
  const [isOpen, setIsOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [theme, setTheme] = useState<Theme>('light');

  // Use shared chat hook for message handling
  const {
    messages,
    input,
    setInput,
    sendMessage,
    isLoading,
    streamingContent,
    messagesEndRef,
    inputRef,
    handleKeyDown,
  } = useChat({
    apiUrl: `https://sharkbyte-support.vercel.app/api/widget/${agentId}`,
    endpoint,
    accessKey,
  });

  // Use same theme for both light/dark slots to bypass prefers-color-scheme issues
  // This ensures the correct theme is always used regardless of OS preference
  const shikiTheme: [BundledTheme, BundledTheme] = theme === 'light'
    ? ['github-light', 'github-light']
    : ['dracula', 'dracula'];

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
    let width = 64;
    let height = 64;

    if (isOpen) {
      if (isMaximized) {
        width = window.innerWidth - 32;
        height = window.innerHeight - 32;
      } else {
        width = 380;
        height = 520;
      }
    }

    const message = {
      type: isOpen ? (isMaximized ? 'sharkbyte:maximize' : 'sharkbyte:open') : 'sharkbyte:close',
      payload: { width, height },
    };
    window.parent.postMessage(message, '*');
  }, [isOpen, isMaximized]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, inputRef]);

  const cycleTheme = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('ocean');
    else setTheme('light');
  };

  const colors = themes[theme];
  const accentColor = getAccentColor(theme, primaryColor);
  const isOcean = theme === 'ocean';

  // Theme icon selector using shared icons
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
        ${getOceanDecorationsStyles()}
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
              width: isMaximized ? 'calc(100vw - 32px)' : 'min(380px, calc(100vw - 32px))',
              height: isMaximized ? 'calc(100vh - 32px)' : 'min(500px, calc(100vh - 100px))',
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
                  src={CHAT_CONSTANTS.AVATAR_URL_ABSOLUTE}
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
                  padding: '12px',
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
                onClick={() => setIsMaximized(!isMaximized)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  padding: '12px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background-color 0.2s',
                }}
                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.2)')}
                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                title={isMaximized ? 'Minimize chat' : 'Maximize chat'}
              >
                {isMaximized ? <MinimizeIcon /> : <MaximizeIcon />}
              </button>
              <button
                onClick={() => {
                  setIsOpen(false);
                  setIsMaximized(false);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#fff',
                  cursor: 'pointer',
                  padding: '12px',
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
                position: 'relative',
              }}
            >
              {/* Ocean theme decorations */}
              {isOcean && <OceanDecorationsInline />}

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
                      src={CHAT_CONSTANTS.AVATAR_URL_ABSOLUTE}
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
                    {defaultWelcome}
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
                        src={CHAT_CONSTANTS.AVATAR_URL_ABSOLUTE}
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
                      ...(message.role === 'user'
                        ? { backgroundColor: accentColor, color: '#fff', whiteSpace: 'pre-wrap' as const }
                        : { backgroundColor: colors.bgBubble, color: colors.text }),
                    }}
                  >
                    {message.role === 'user' ? (
                      message.content
                    ) : (
                      <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
                        <Streamdown shikiTheme={shikiTheme}>{message.content}</Streamdown>
                      </div>
                    )}
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
                      src={CHAT_CONSTANTS.AVATAR_URL_ABSOLUTE}
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
                    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
                      <Streamdown shikiTheme={shikiTheme} isAnimating={true}>
                        {streamingContent}
                      </Streamdown>
                    </div>
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
                      src={CHAT_CONSTANTS.AVATAR_URL_ABSOLUTE}
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
              <ChatFooter textColor={colors.textMuted} />
            </div>
          </div>
        ) : (
          <button
            onClick={() => setIsOpen(true)}
            style={{
              width: '64px',
              height: '64px',
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
              src={CHAT_CONSTANTS.AVATAR_URL_ABSOLUTE}
              alt={`Chat with ${agentName}`}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </button>
        )}
      </div>
    </>
  );
}
