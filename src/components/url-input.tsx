'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Globe, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface UrlInputProps {
  onSubmit: (url: string) => void;
  isLoading?: boolean;
  className?: string;
}

export function UrlInput({ onSubmit, isLoading, className }: UrlInputProps) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  const validateUrl = (input: string): boolean => {
    try {
      let testUrl = input.trim();
      if (!testUrl.startsWith('http://') && !testUrl.startsWith('https://')) {
        testUrl = `https://${testUrl}`;
      }
      new URL(testUrl);
      return true;
    } catch {
      return false;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!url.trim()) {
      setError('Please enter a website URL');
      return;
    }

    if (!validateUrl(url)) {
      setError('Please enter a valid URL');
      return;
    }

    onSubmit(url.trim());
  };

  return (
    <motion.form
      onSubmit={handleSubmit}
      className={cn('w-full max-w-2xl px-4', className)}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
    >
      {/* Desktop: inline button | Mobile: stacked */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <div className="absolute left-3 sm:left-4 top-1/2 -translate-y-1/2 text-muted-foreground">
            <Globe className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>

          <input
            type="text"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setError('');
            }}
            placeholder="Enter your website URL"
            disabled={isLoading}
            className={cn(
              'w-full pl-10 sm:pl-12 pr-4 py-3 sm:py-4 text-base sm:text-lg rounded-xl',
              'bg-card/80 backdrop-blur-sm',
              'border-2 border-border',
              'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
              'placeholder:text-muted-foreground',
              'transition-all duration-200',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              error && 'border-destructive focus:border-destructive focus:ring-destructive/20'
            )}
          />
        </div>

        <Button
          type="submit"
          disabled={isLoading || !url.trim()}
          className="w-full sm:w-auto px-6 py-3 sm:py-4 h-auto text-base sm:text-lg rounded-xl"
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <>
              Create Agent
              <ArrowRight className="w-4 h-4 ml-2" />
            </>
          )}
        </Button>
      </div>

      {error && (
        <motion.p
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 text-sm text-destructive text-center"
        >
          {error}
        </motion.p>
      )}

      <p className="mt-4 text-xs sm:text-sm text-muted-foreground text-center">
        We&apos;ll crawl your website and create an AI support agent in seconds
      </p>
    </motion.form>
  );
}
