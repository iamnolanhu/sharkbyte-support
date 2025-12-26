'use client';

import { motion } from 'framer-motion';

/**
 * Fish SVG component for ocean theme decorations
 */
export function FishSvg({
  size,
  opacity,
  direction,
}: {
  size: number;
  opacity: number;
  direction: 'left' | 'right';
}) {
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

/**
 * Ocean theme decorations using Framer Motion
 * Used by chat-widget.tsx (Next.js context with Framer Motion)
 */
export function OceanDecorations() {
  return (
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
  );
}

/**
 * Inline styles for ocean decorations (CSS keyframe animations)
 * Used by embed-chat-widget.tsx (iframe context without Framer Motion)
 */
export function getOceanDecorationsStyles(): string {
  return `
    @keyframes oceanBubble {
      0% {
        transform: translateY(0);
        opacity: 0;
      }
      10% {
        opacity: 0.15;
      }
      90% {
        opacity: 0.15;
      }
      100% {
        transform: translateY(-400px);
        opacity: 0;
      }
    }
    @keyframes fishSwimRight {
      0% {
        transform: translateX(-20px);
      }
      100% {
        transform: translateX(calc(100% + 20px));
      }
    }
    @keyframes fishSwimLeft {
      0% {
        transform: translateX(100%) scaleX(-1);
      }
      100% {
        transform: translateX(-20px) scaleX(-1);
      }
    }
    .ocean-bubble {
      position: absolute;
      border-radius: 50%;
      background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.2), rgba(0,175,206,0.1));
      animation: oceanBubble linear infinite;
      pointer-events: none;
    }
    .ocean-fish {
      position: absolute;
      pointer-events: none;
    }
    .ocean-fish-right {
      animation: fishSwimRight linear infinite;
    }
    .ocean-fish-left {
      animation: fishSwimLeft linear infinite;
    }
  `;
}

/**
 * Ocean decorations for inline styles (embed widget)
 * Returns React elements with inline styles and CSS classes
 */
export function OceanDecorationsInline() {
  const bubbles = [0, 1, 2, 3, 4, 5].map((i) => ({
    size: 4 + (i % 3) * 2,
    left: `${15 + i * 15}%`,
    duration: 8 + i * 2,
    delay: i * 1.5,
  }));

  const fish = [
    { top: '30%', direction: 'right' as const, duration: 15, delay: 0 },
    { top: '60%', direction: 'left' as const, duration: 20, delay: 8 },
  ];

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
      {bubbles.map((bubble, i) => (
        <div
          key={`bubble-${i}`}
          className="ocean-bubble"
          style={{
            width: bubble.size,
            height: bubble.size,
            left: bubble.left,
            bottom: '-5%',
            animationDuration: `${bubble.duration}s`,
            animationDelay: `${bubble.delay}s`,
          }}
        />
      ))}
      {fish.map((f, i) => (
        <div
          key={`fish-${i}`}
          className={`ocean-fish ocean-fish-${f.direction}`}
          style={{
            top: f.top,
            left: f.direction === 'right' ? '-20px' : 'auto',
            right: f.direction === 'left' ? '-20px' : 'auto',
            animationDuration: `${f.duration}s`,
            animationDelay: `${f.delay}s`,
          }}
        >
          <svg
            width={12}
            height={7.2}
            viewBox="0 0 24 14"
          >
            <path
              d="M23 7c-3-4-6-6-11-6C7 1 4 4 1 7c3 3 6 6 11 6 5 0 8-2 11-6z"
              fill="rgba(0, 175, 206, 0.1)"
            />
            <circle cx="6" cy="7" r="1.5" fill="rgba(255, 255, 255, 0.08)" />
          </svg>
        </div>
      ))}
    </div>
  );
}
