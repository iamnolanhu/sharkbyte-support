import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "SharkByte Support",
  description: "Smart support in every byte. Transform any website into an AI-powered customer support agent.",
  keywords: ["AI", "chatbot", "customer support", "DigitalOcean", "Gradient AI"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="ocean"
          enableSystem={false}
          themes={["light", "dark", "ocean"]}
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
