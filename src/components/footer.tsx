import Link from 'next/link';

export function Footer() {
  return (
    <footer className="text-center text-xs sm:text-sm text-muted-foreground/60 mt-4 sm:mt-8 space-y-1">
      <p>
        Made with <span className="text-red-500">❤️</span> by{' '}
        <Link
          href="https://dev.nolanhu.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-primary transition-colors underline-offset-2 hover:underline"
        >
          Nolan
        </Link>
      </p>
      <p>Powered by DigitalOcean Gradient AI</p>
    </footer>
  );
}
