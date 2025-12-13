'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface SammyAvatarProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'normal' | 'front' | 'jetpack' | 'balloon';
  animated?: boolean;
  className?: string;
}

const sizes = {
  sm: { container: 'w-8 h-8', pixels: 32 },
  md: { container: 'w-12 h-12', pixels: 48 },
  lg: { container: 'w-16 h-16', pixels: 64 },
  xl: { container: 'w-24 h-24', pixels: 96 },
};

const variants = {
  normal: '/sammy/transparent/sammy-normal-transparent.png',
  front: '/sammy/transparent/sammy-front-transparent.png',
  jetpack: '/sammy/transparent/sammy-jetpack-transparent.png',
  balloon: '/sammy/transparent/sammy-balloon-transparent.png',
};

export function SammyAvatar({
  size = 'md',
  variant = 'normal',
  animated = true,
  className,
}: SammyAvatarProps) {
  const { container, pixels } = sizes[size];
  const imageSrc = variants[variant];

  const containerClass = cn(
    container,
    'relative flex items-center justify-center',
    className
  );

  const imageElement = (
    <Image
      src={imageSrc}
      alt="Sammy the Shark"
      width={pixels}
      height={pixels}
      className="object-contain"
      priority
    />
  );

  if (animated) {
    return (
      <motion.div
        className={containerClass}
        animate={{ y: [0, -5, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' as const }}
      >
        {imageElement}
      </motion.div>
    );
  }

  return <div className={containerClass}>{imageElement}</div>;
}

export function SammyLoading({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-4', className)}>
      <motion.div
        animate={{
          rotate: [0, 10, -10, 0],
          y: [0, -10, 0],
        }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: 'easeInOut' as const,
        }}
      >
        <SammyAvatar size="xl" variant="jetpack" animated={false} />
      </motion.div>
      <motion.div
        className="flex gap-1"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-2 h-2 rounded-full bg-[var(--do-blue)]"
            animate={{ y: [0, -8, 0] }}
            transition={{
              duration: 0.6,
              repeat: Infinity,
              delay: i * 0.15,
            }}
          />
        ))}
      </motion.div>
    </div>
  );
}
