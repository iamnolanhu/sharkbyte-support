'use client';

import { motion } from 'framer-motion';
import { useMemo } from 'react';

// Seeded random number generator for consistent values
function seededRandom(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// Pre-defined bubble configurations (deterministic)
const bubbleConfigs = [
  { size: 8, left: 5, delay: 0, duration: 8, opacity: 0.4 },
  { size: 12, left: 15, delay: 1.5, duration: 10, opacity: 0.3 },
  { size: 6, left: 25, delay: 0.5, duration: 7, opacity: 0.5 },
  { size: 14, left: 35, delay: 2, duration: 11, opacity: 0.35 },
  { size: 10, left: 45, delay: 3, duration: 9, opacity: 0.45 },
  { size: 8, left: 55, delay: 1, duration: 8, opacity: 0.4 },
  { size: 16, left: 65, delay: 2.5, duration: 12, opacity: 0.3 },
  { size: 6, left: 75, delay: 0.8, duration: 7, opacity: 0.5 },
  { size: 12, left: 85, delay: 1.8, duration: 10, opacity: 0.35 },
  { size: 10, left: 95, delay: 3.5, duration: 9, opacity: 0.4 },
  { size: 7, left: 10, delay: 4, duration: 8, opacity: 0.45 },
  { size: 11, left: 20, delay: 4.5, duration: 10, opacity: 0.35 },
  { size: 9, left: 30, delay: 5, duration: 9, opacity: 0.4 },
  { size: 13, left: 40, delay: 5.5, duration: 11, opacity: 0.3 },
  { size: 8, left: 50, delay: 6, duration: 8, opacity: 0.5 },
  { size: 15, left: 60, delay: 6.5, duration: 12, opacity: 0.35 },
  { size: 7, left: 70, delay: 7, duration: 7, opacity: 0.45 },
  { size: 10, left: 80, delay: 7.5, duration: 9, opacity: 0.4 },
  { size: 12, left: 90, delay: 8, duration: 10, opacity: 0.35 },
  { size: 9, left: 98, delay: 0.3, duration: 9, opacity: 0.4 },
];

// Pre-defined sparkle positions (deterministic)
const sparkleConfigs = [
  { left: 15, top: 25 },
  { left: 30, top: 45 },
  { left: 45, top: 35 },
  { left: 60, top: 55 },
  { left: 75, top: 30 },
  { left: 85, top: 50 },
  { left: 25, top: 65 },
  { left: 70, top: 40 },
];

export function WaveBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      {/* Ocean gradient base */}
      <div className="absolute inset-0 bg-gradient-to-b from-[var(--do-bg-dark-gradient-start)] to-[var(--do-bg-dark-gradient-end)]" />

      {/* Subtle light rays from top */}
      <div className="absolute inset-0 opacity-20">
        <div className="absolute top-0 left-1/4 w-px h-96 bg-gradient-to-b from-[var(--do-blue)] to-transparent blur-sm" />
        <div className="absolute top-0 left-1/2 w-px h-80 bg-gradient-to-b from-[var(--do-teal)] to-transparent blur-sm" />
        <div className="absolute top-0 left-3/4 w-px h-72 bg-gradient-to-b from-[var(--do-blue)] to-transparent blur-sm" />
      </div>

      {/* Animated waves - Layer 1 (back, slowest) */}
      <svg
        className="absolute bottom-0 w-[200%] h-80"
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
      >
        <motion.path
          d="M0,160L48,176C96,192,192,224,288,213.3C384,203,480,149,576,149.3C672,149,768,203,864,213.3C960,224,1056,192,1152,165.3C1248,139,1344,117,1392,106.7L1440,96L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
          fill="rgba(0, 105, 255, 0.25)"
          animate={{ x: [0, -720] }}
          transition={{
            duration: 12,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      </svg>

      {/* Animated waves - Layer 2 (middle) */}
      <svg
        className="absolute bottom-0 w-[200%] h-72"
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
      >
        <motion.path
          d="M0,224L48,213.3C96,203,192,181,288,181.3C384,181,480,203,576,213.3C672,224,768,224,864,208C960,192,1056,160,1152,160C1248,160,1344,192,1392,208L1440,224L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
          fill="rgba(0, 175, 206, 0.2)"
          animate={{ x: [-720, 0] }}
          transition={{
            duration: 10,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      </svg>

      {/* Animated waves - Layer 3 (front, fastest) */}
      <svg
        className="absolute bottom-0 w-[200%] h-64"
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
      >
        <motion.path
          d="M0,288L48,272C96,256,192,224,288,218.7C384,213,480,235,576,245.3C672,256,768,256,864,234.7C960,213,1056,171,1152,165.3C1248,160,1344,192,1392,208L1440,224L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
          fill="rgba(100, 20, 238, 0.15)"
          animate={{ x: [0, -720] }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      </svg>

      {/* Additional shimmer wave */}
      <svg
        className="absolute bottom-0 w-[200%] h-48"
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
      >
        <motion.path
          d="M0,256L60,261.3C120,267,240,277,360,272C480,267,600,245,720,234.7C840,224,960,224,1080,234.7C1200,245,1320,267,1380,277.3L1440,288L1440,320L1380,320C1320,320,1200,320,1080,320C960,320,840,320,720,320C600,320,480,320,360,320C240,320,120,320,60,320L0,320Z"
          fill="rgba(0, 105, 255, 0.1)"
          animate={{
            x: [-720, 0],
            opacity: [0.3, 0.6, 0.3],
          }}
          transition={{
            duration: 6,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      </svg>

      {/* Floating bubbles */}
      <div className="absolute inset-0 pointer-events-none">
        {bubbleConfigs.map((bubble, i) => (
          <motion.div
            key={i}
            className="absolute rounded-full"
            style={{
              width: bubble.size,
              height: bubble.size,
              left: `${bubble.left}%`,
              bottom: '-5%',
              background: `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.4), rgba(0,105,255,${bubble.opacity}))`,
              boxShadow: `0 0 ${bubble.size / 2}px rgba(0,175,206,0.3), inset 0 0 ${bubble.size / 3}px rgba(255,255,255,0.2)`,
            }}
            animate={{
              y: [0, -900],
              x: [0, (i % 2 === 0 ? 1 : -1) * 30],
              scale: [1, 1.2, 0.8, 1],
              opacity: [0, bubble.opacity, bubble.opacity, 0],
            }}
            transition={{
              duration: bubble.duration,
              repeat: Infinity,
              delay: bubble.delay,
              ease: 'easeOut',
            }}
          />
        ))}
      </div>

      {/* Larger accent bubbles */}
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.div
          key={`large-${i}`}
          className="absolute rounded-full"
          style={{
            width: 24 + i * 8,
            height: 24 + i * 8,
            left: `${10 + i * 20}%`,
            bottom: '-10%',
            background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.2), rgba(0,175,206,0.15))',
            border: '1px solid rgba(255,255,255,0.1)',
          }}
          animate={{
            y: [0, -1000],
            x: [0, (i % 2 === 0 ? 1 : -1) * 50],
            rotate: [0, 360],
            opacity: [0, 0.6, 0.6, 0],
          }}
          transition={{
            duration: 12 + i * 2,
            repeat: Infinity,
            delay: i * 3,
            ease: 'easeInOut',
          }}
        />
      ))}

      {/* Sparkle effects */}
      {sparkleConfigs.map((sparkle, i) => (
        <motion.div
          key={`sparkle-${i}`}
          className="absolute w-1 h-1 rounded-full bg-white"
          style={{
            left: `${sparkle.left}%`,
            top: `${sparkle.top}%`,
          }}
          animate={{
            opacity: [0, 1, 0],
            scale: [0, 1.5, 0],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            delay: i * 0.8,
            ease: 'easeInOut',
          }}
        />
      ))}
    </div>
  );
}
