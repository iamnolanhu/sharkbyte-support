import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SharkByte Chat Widget',
  description: 'AI-powered support chat widget',
};

// Note: Don't include <html>/<body> tags - those come from root layout
// This layout just provides embed-specific styling
export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        margin: 0,
        padding: 0,
        background: 'transparent',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
      }}
      data-embed-container="true"
    >
      {children}
    </div>
  );
}
