'use client';

import { motion } from 'framer-motion';
import { User } from 'lucide-react';
import { Streamdown } from 'streamdown';
import { useTheme } from 'next-themes';
import type { BundledTheme } from 'shiki';
import { cn } from '@/lib/utils';
import { SammyAvatar } from './sammy-avatar';
import type { ChatMessage as ChatMessageType } from '@/types';

interface ChatMessageProps {
  message: ChatMessageType;
  isStreaming?: boolean;
}

export function ChatMessage({ message, isStreaming }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const { theme } = useTheme();

  // Use same theme for both light/dark slots to bypass prefers-color-scheme issues
  // This ensures the correct theme is always used regardless of OS preference
  const shikiTheme: [BundledTheme, BundledTheme] = theme === 'light'
    ? ['github-light', 'github-light']
    : ['dracula', 'dracula'];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'flex gap-3 p-4',
        isUser && 'flex-row-reverse'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-transparent'
        )}
      >
        {isUser ? (
          <User className="w-5 h-5" />
        ) : (
          <SammyAvatar size="sm" animated={false} />
        )}
      </div>

      {/* Message Bubble */}
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-4 py-3',
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-card border border-border rounded-tl-sm'
        )}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap leading-relaxed">
            {message.content}
          </p>
        ) : (
          <div className="text-sm leading-relaxed">
            <Streamdown shikiTheme={shikiTheme} isAnimating={isStreaming}>
              {message.content}
            </Streamdown>
          </div>
        )}
      </div>
    </motion.div>
  );
}

export function ChatMessageSkeleton() {
  return (
    <div className="flex gap-3 p-4">
      <div className="flex-shrink-0 w-10 h-10">
        <SammyAvatar size="sm" animated />
      </div>
      <div className="flex-1 space-y-2">
        <motion.div
          className="h-4 bg-muted rounded w-3/4"
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
        <motion.div
          className="h-4 bg-muted rounded w-1/2"
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1.5, repeat: Infinity, delay: 0.2 }}
        />
      </div>
    </div>
  );
}
