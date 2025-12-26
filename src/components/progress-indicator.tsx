'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Check, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SammyLoading } from './sammy-avatar';

type StepStatus = 'pending' | 'loading' | 'complete' | 'error';

interface Step {
  id: string;
  label: string;
  description: string;
  status: StepStatus;
}

interface ProgressIndicatorProps {
  steps: readonly Step[];
  error?: string;
  className?: string;
}

const oceanMessages = [
  'Diving into your website...',
  'Swimming through your pages...',
  'Collecting digital pearls...',
  'Teaching Sammy about your site...',
  'Almost ready to surface...',
];

export function ProgressIndicator({
  steps,
  error,
  className,
}: ProgressIndicatorProps) {
  const currentStep = steps.find((s) => s.status === 'loading');
  const messageIndex = steps.filter((s) => s.status === 'complete').length;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={cn(
        'w-full max-w-[calc(100vw-32px)] sm:max-w-md p-4 sm:p-6 rounded-xl sm:rounded-2xl',
        'bg-card/90 backdrop-blur-md',
        'border border-border',
        'shadow-lg',
        className
      )}
    >
      {/* Sammy Animation */}
      <div className="mb-6">
        <SammyLoading />
        <motion.p
          key={messageIndex}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center text-sm text-muted-foreground mt-2"
        >
          {oceanMessages[messageIndex % oceanMessages.length]}
        </motion.p>
      </div>

      {/* Progress Steps */}
      <div className="space-y-3">
        {steps.map((step, index) => (
          <motion.div
            key={step.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className={cn(
              'flex items-center gap-3 p-3 rounded-lg transition-colors',
              step.status === 'loading' && 'bg-primary/10',
              step.status === 'complete' && 'bg-green-500/10',
              step.status === 'error' && 'bg-destructive/10'
            )}
          >
            {/* Status Icon */}
            <div
              className={cn(
                'w-8 h-8 rounded-full flex items-center justify-center',
                step.status === 'pending' && 'bg-muted text-muted-foreground',
                step.status === 'loading' && 'bg-primary text-primary-foreground',
                step.status === 'complete' && 'bg-green-500 text-white',
                step.status === 'error' && 'bg-destructive text-destructive-foreground'
              )}
            >
              <AnimatePresence mode="wait">
                {step.status === 'pending' && (
                  <span className="text-sm font-medium">{index + 1}</span>
                )}
                {step.status === 'loading' && (
                  <motion.div
                    key="loading"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                  >
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </motion.div>
                )}
                {step.status === 'complete' && (
                  <motion.div
                    key="complete"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                  >
                    <Check className="w-4 h-4" />
                  </motion.div>
                )}
                {step.status === 'error' && (
                  <motion.div
                    key="error"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                  >
                    <AlertCircle className="w-4 h-4" />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Step Info */}
            <div className="flex-1">
              <p
                className={cn(
                  'font-medium',
                  step.status === 'pending' && 'text-muted-foreground',
                  step.status === 'loading' && 'text-primary',
                  step.status === 'complete' && 'text-green-500',
                  step.status === 'error' && 'text-destructive'
                )}
              >
                {step.label}
              </p>
              <p className="text-xs text-muted-foreground">{step.description}</p>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Error Message */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20"
        >
          <p className="text-sm text-destructive">{error}</p>
        </motion.div>
      )}

      {/* Current Status */}
      {currentStep && (
        <div className="mt-4 text-center">
          <p className="text-sm text-muted-foreground">
            This usually takes 30-60 seconds
          </p>
        </div>
      )}
    </motion.div>
  );
}
