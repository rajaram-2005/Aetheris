/* ─── Aetheris Root Layout ─── */
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aetheris — Hermes Agent + Meta-Learning",
  description: "A unified offline cognitive runtime: the Hermes agent with meta-learning. No vendor APIs, no API keys.",
  keywords: ["Aetheris", "Hermes", "meta-learning", "agent", "offline", "private", "no API keys"],
  authors: [{ name: "Aetheris" }],
  openGraph: {
    title: "Aetheris — Hermes Agent + Meta-Learning",
    description: "Hermes agent + meta-learning, running entirely offline.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0e1a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Outfit:wght@300;400;500;600;700&family=Syne:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
