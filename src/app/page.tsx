import { ThemeToggle } from "@/components/theme-toggle";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <div className="text-center space-y-6">
        <h1 className="text-5xl font-bold text-primary">
          SharkByte Support
        </h1>
        <p className="text-xl text-muted-foreground">
          Smart support in every byte
        </p>
        <p className="text-sm text-muted-foreground/60">
          Next.js 16 + React 19.2 + Tailwind v4 + shadcn/ui
        </p>
      </div>
    </main>
  );
}
