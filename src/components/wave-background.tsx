'use client';

import { motion } from 'framer-motion';

export function WaveBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      {/* Ocean gradient base */}
      <div className="absolute inset-0 bg-gradient-to-b from-[var(--do-bg-dark-gradient-start)] to-[var(--do-bg-dark-gradient-end)] opacity-90" />

      {/* Animated waves */}
      <svg
        className="absolute bottom-0 w-[200%] h-64"
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
      >
        <motion.path
          d="M0,160L48,176C96,192,192,224,288,213.3C384,203,480,149,576,149.3C672,149,768,203,864,213.3C960,224,1056,192,1152,165.3C1248,139,1344,117,1392,106.7L1440,96L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
          fill="rgba(0, 105, 255, 0.1)"
          animate={{ x: [0, -720] }}
          transition={{
            duration: 15,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
        <motion.path
          d="M0,224L48,213.3C96,203,192,181,288,181.3C384,181,480,203,576,213.3C672,224,768,224,864,208C960,192,1056,160,1152,160C1248,160,1344,192,1392,208L1440,224L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
          fill="rgba(0, 175, 206, 0.08)"
          animate={{ x: [-720, 0] }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
        <motion.path
          d="M0,288L48,272C96,256,192,224,288,218.7C384,213,480,235,576,245.3C672,256,768,256,864,234.7C960,213,1056,171,1152,165.3C1248,160,1344,192,1392,208L1440,224L1440,320L1392,320C1344,320,1248,320,1152,320C1056,320,960,320,864,320C768,320,672,320,576,320C480,320,384,320,288,320C192,320,96,320,48,320L0,320Z"
          fill="rgba(100, 20, 238, 0.06)"
          animate={{ x: [0, -720] }}
          transition={{
            duration: 25,
            repeat: Infinity,
            ease: 'linear',
          }}
        />
      </svg>

      {/* Floating particles/bubbles */}
      <div className="absolute inset-0">
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-2 h-2 rounded-full bg-[var(--do-blue)]/20"
            style={{
              left: `${15 + i * 15}%`,
              bottom: '-10%',
            }}
            animate={{
              y: [0, -500],
              opacity: [0, 1, 0],
            }}
            transition={{
              duration: 4 + i * 0.5,
              repeat: Infinity,
              delay: i * 0.8,
              ease: 'easeOut',
            }}
          />
        ))}
      </div>
    </div>
  );
}
