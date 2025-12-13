/**
 * DigitalOcean Design System - Theme Reference
 * Scraped from digitalocean.com on December 2025
 *
 * Use these tokens to maintain brand consistency with DigitalOcean's design system
 */

export const digitalOceanTheme = {
  // ============================================
  // PRIMARY BRAND COLORS
  // ============================================
  colors: {
    primary: {
      blue: '#0069FF',          // Main brand blue
      blueHover: '#1433D6',     // Darker blue for hover states
      navy: '#000C2A',          // Dark navy for text/backgrounds
      doBlue: '#0080FF',        // DigitalOcean documentation blue
    },

    // ============================================
    // SECONDARY COLORS
    // ============================================
    secondary: {
      purple: '#6414EE',
      magenta: '#CA64DD',
      magentaDark: '#8917A6',
      teal: '#00AFCE',
      tealDark: '#006375',
      green: '#15CD72',
      greenAlt: '#00C483',
      greenDark: '#006650',
    },

    // ============================================
    // BACKGROUND COLORS
    // ============================================
    background: {
      light: '#F9FAFE',         // Light page background
      lightBlue: '#CAECFF',
      lightBlueBright: '#B5F6FF',
      lightPurple: '#E8E2FC',
      lightGreen: '#B5FFDB',
      lightTeal: '#B5FFF1',
      neutral: '#E3E8F4',
      // Dark theme
      dark: '#000C2A',
      darkGradientStart: '#0a1628',
      darkGradientEnd: '#1a365d',
    },

    // ============================================
    // TEXT COLORS
    // ============================================
    text: {
      primary: '#000C2A',       // Main heading/body text
      secondary: '#4D5B7C',     // Subdued text
      muted: '#8690A9',         // Placeholder/disabled text
      light: '#FFFFFF',         // Text on dark backgrounds
    },

    // ============================================
    // SEMANTIC COLORS
    // ============================================
    semantic: {
      success: '#15CD72',
      error: '#FF6B6B',         // Coral red
      warning: '#FFAA00',
      info: '#0069FF',
      focus: '#0069FF',
    },

    // ============================================
    // BORDER & DIVIDER
    // ============================================
    border: {
      light: 'rgba(17, 25, 46, 0.1)',
      medium: '#E3E8F4',
      dark: '#4D5B7C',
    },
  },

  // ============================================
  // TYPOGRAPHY
  // ============================================
  typography: {
    fontFamily: {
      heading: "'Epilogue', sans-serif",
      body: "'Inter', sans-serif",
      mono: "'JetBrains Mono', 'Fira Code', monospace",
    },
    fontSize: {
      xs: '12px',
      sm: '14px',
      base: '16px',
      lg: '18px',
      xl: '20px',
      '2xl': '24px',
      '3xl': '28px',
      '4xl': '36px',
      '5xl': '48px',
    },
    fontWeight: {
      normal: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
    lineHeight: {
      tight: 1.2,
      normal: 1.5,
      relaxed: 1.75,
    },
  },

  // ============================================
  // SPACING SYSTEM (8px base)
  // ============================================
  spacing: {
    px: '1px',
    0: '0',
    1: '8px',
    2: '16px',
    3: '24px',
    4: '32px',
    5: '40px',
    6: '48px',
    7: '56px',
    8: '64px',
    10: '80px',
    16: '128px',
  },

  // ============================================
  // BORDER RADIUS
  // ============================================
  borderRadius: {
    none: '0',
    sm: '4px',
    md: '8px',
    lg: '16px',
    xl: '24px',
    full: '999px',
  },

  // ============================================
  // SHADOWS
  // ============================================
  shadows: {
    sm: '0 1px 2px rgba(0, 12, 42, 0.05)',
    md: '0 4px 6px rgba(0, 12, 42, 0.1)',
    lg: '0 10px 15px rgba(0, 12, 42, 0.1)',
    xl: '0 20px 25px rgba(0, 12, 42, 0.15)',
    glow: '0 0 20px rgba(0, 105, 255, 0.3)',
  },

  // ============================================
  // TRANSITIONS
  // ============================================
  transitions: {
    fast: '150ms ease',
    normal: '200ms ease',
    slow: '300ms ease',
    bounce: '300ms cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  },

  // ============================================
  // Z-INDEX SCALE
  // ============================================
  zIndex: {
    dropdown: 100,
    sticky: 200,
    modal: 300,
    popover: 400,
    tooltip: 500,
  },

  // ============================================
  // GRADIENTS
  // ============================================
  gradients: {
    // Ocean-inspired gradients for SharkByte
    oceanDeep: 'linear-gradient(180deg, #0a1628 0%, #1a365d 100%)',
    oceanWave: 'linear-gradient(135deg, #0069FF 0%, #00AFCE 100%)',
    oceanSunset: 'linear-gradient(135deg, #0069FF 0%, #6414EE 50%, #CA64DD 100%)',
    success: 'linear-gradient(135deg, #15CD72 0%, #00C483 100%)',
    // Button gradients
    primaryButton: 'linear-gradient(180deg, #0069FF 0%, #1433D6 100%)',
    secondaryButton: 'linear-gradient(180deg, #6414EE 0%, #8917A6 100%)',
  },
} as const;

// Type exports for TypeScript usage
export type DigitalOceanColors = typeof digitalOceanTheme.colors;
export type DigitalOceanTypography = typeof digitalOceanTheme.typography;
export type DigitalOceanSpacing = typeof digitalOceanTheme.spacing;

export default digitalOceanTheme;
