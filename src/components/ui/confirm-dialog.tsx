'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  onConfirm: () => void;
  isLoading?: boolean;
  confirmDisabled?: boolean;
  confirmDisabledMessage?: string;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  isLoading = false,
  confirmDisabled = false,
  confirmDisabledMessage,
}: ConfirmDialogProps) {
  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open && !isLoading) {
        onOpenChange(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onOpenChange, isLoading]);

  // Prevent body scroll when dialog is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  const handleConfirm = () => {
    onConfirm();
  };

  const dialogContent = (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/60 z-[9998]"
            onClick={() => !isLoading && onOpenChange(false)}
          />

          {/* Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          >
            <div
              className="w-full max-w-sm bg-background border border-border rounded-xl shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header with icon */}
              <div className="p-4 sm:p-6 pb-2 sm:pb-4">
                <div className="flex items-start gap-3 sm:gap-4">
                  <div
                    className={`flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center ${
                      variant === 'destructive'
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-primary/10 text-primary'
                    }`}
                  >
                    <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg sm:text-xl font-semibold text-foreground">
                      {title}
                    </h2>
                    <p className="mt-1 sm:mt-2 text-sm sm:text-base text-muted-foreground">
                      {description}
                    </p>
                  </div>
                </div>
              </div>

              {/* Disabled message */}
              {confirmDisabled && confirmDisabledMessage && (
                <div className="px-4 sm:px-6 pb-2">
                  <p className="text-xs text-muted-foreground text-center bg-muted/50 rounded-lg p-2">
                    {confirmDisabledMessage}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="p-4 sm:p-6 pt-2 sm:pt-4 flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 sm:justify-end">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isLoading}
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px]"
                >
                  {cancelLabel}
                </Button>
                <Button
                  variant={variant === 'destructive' ? 'destructive' : 'default'}
                  onClick={handleConfirm}
                  disabled={isLoading || confirmDisabled}
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px]"
                >
                  {isLoading ? 'Please wait...' : confirmLabel}
                </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  // Only render on client side
  if (typeof window === 'undefined') {
    return null;
  }

  return createPortal(dialogContent, document.body);
}
