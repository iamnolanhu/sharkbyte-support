import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { DemoChatWidget } from "@/components/demo-chat-widget";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://sharkbyte-support.vercel.app"),
  title: "SharkByte Support",
  description: "Smart support in every byte. Transform any website into an AI-powered customer support agent.",
  keywords: ["AI", "chatbot", "customer support", "DigitalOcean", "Gradient AI"],
  icons: {
    icon: "/sammy/transparent/sammy-front-transparent.png",
    apple: "/sammy/transparent/sammy-front-transparent.png",
  },
  openGraph: {
    title: "SharkByte Support",
    description: "Transform any website into an AI-powered customer support agent in seconds.",
    images: ["/sammy/transparent/sammy-normal-transparent.png"],
  },
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
          <DemoChatWidget />
        </ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}
