'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Menu, X, Sun, Moon, Waves } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

interface MobileMenuProps {
  children?: React.ReactNode;
}

export function MobileMenu({ children }: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  // Only render portal on client
  useEffect(() => {
    setMounted(true);
  }, []);

  const cycleTheme = () => {
    if (theme === 'light') setTheme('dark');
    else if (theme === 'dark') setTheme('ocean');
    else setTheme('light');
  };

  const ThemeIcon = () => {
    if (theme === 'light') return <Sun className="w-5 h-5" />;
    if (theme === 'dark') return <Moon className="w-5 h-5" />;
    return <Waves className="w-5 h-5" />;
  };

  // Portal content for backdrop and drawer
  const menuContent = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop - highest z-index to ensure visibility */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/60 z-[9998] sm:hidden"
            onClick={() => setIsOpen(false)}
          />

          {/* Drawer - renders above backdrop */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="fixed top-0 right-0 bottom-0 w-72 max-w-[85vw] bg-background border-l border-border z-[9999] sm:hidden flex flex-col shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border bg-card">
              <h2 className="font-semibold text-foreground">Menu</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsOpen(false)}
                className="rounded-full"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-background">
              {children}
            </div>

            {/* Footer with theme toggle */}
            <div className="p-4 border-t border-border bg-card">
              <button
                onClick={cycleTheme}
                className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
              >
                <ThemeIcon />
                <span className="text-sm text-foreground">
                  {theme === 'light' ? 'Light Mode' : theme === 'dark' ? 'Dark Mode' : 'Ocean Mode'}
                </span>
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return (
    <>
      {/* Hamburger button - only visible on mobile */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOpen(true)}
        className="sm:hidden rounded-full"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </Button>

      {/* Render menu via portal to escape stacking context */}
      {mounted && createPortal(menuContent, document.body)}
    </>
  );
}

// Menu item component for consistency
interface MobileMenuItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'destructive';
}

export function MobileMenuItem({ icon, label, onClick, variant = 'default' }: MobileMenuItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${
        variant === 'destructive'
          ? 'text-destructive hover:bg-destructive/10'
          : 'hover:bg-muted/50'
      }`}
    >
      {icon}
      <span className="text-sm">{label}</span>
    </button>
  );
}
