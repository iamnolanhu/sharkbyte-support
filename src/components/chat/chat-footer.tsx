'use client';

/**
 * Shared footer component for chat widgets
 * Consistent branding across all chat interfaces
 */

interface ChatFooterProps {
  /** Text color for the footer (CSS color value) */
  textColor?: string;
  /** Use Tailwind classes instead of inline styles */
  useTailwind?: boolean;
  /** Tailwind class for muted text color */
  tailwindClass?: string;
}

/**
 * Footer component with SharkByte branding
 * Supports both inline styles (embed widget) and Tailwind (main widget)
 */
export function ChatFooter({
  textColor = '#666666',
  useTailwind = false,
  tailwindClass = 'text-gray-400',
}: ChatFooterProps) {
  if (useTailwind) {
    return (
      <p className={`text-[10px] ${tailwindClass} text-center mt-2`}>
        Powered by{' '}
        <a
          href="https://sharkbyte-support.vercel.app"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:opacity-80 transition-colors"
        >
          SharkByte
        </a>
        {' · '}
        Made with <span className="text-red-400">&#10084;&#65039;</span> by{' '}
        <a
          href="https://dev.nolanhu.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:opacity-80 transition-colors"
        >
          Nolan
        </a>
      </p>
    );
  }

  // Inline styles version for embed widget
  return (
    <div
      style={{
        textAlign: 'center',
        fontSize: '10px',
        color: textColor,
        marginTop: '8px',
      }}
    >
      Powered by{' '}
      <a
        href="https://sharkbyte-support.vercel.app"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: textColor, textDecoration: 'none' }}
      >
        SharkByte
      </a>
      {' · '}
      Made with <span style={{ color: '#f87171' }}>&#10084;&#65039;</span> by{' '}
      <a
        href="https://dev.nolanhu.com"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: textColor, textDecoration: 'none' }}
      >
        Nolan
      </a>
    </div>
  );
}
