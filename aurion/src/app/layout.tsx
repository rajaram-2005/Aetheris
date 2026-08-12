/* ─── AURION Root Layout ─── */
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AURION — Sovereign Cognitive Engine",
  description: "A sovereign cognitive engine powered by C7 cascade. On-device, private, no AI vendor APIs.",
  keywords: ["AURION", "AI", "cognitive engine", "C7", "on-device", "private", "no API keys"],
  authors: [{ name: "AURION" }],
  openGraph: {
    title: "AURION — Sovereign Cognitive Engine",
    description: "On-device AI powered by C7 cascade. No OpenAI. No Gemini. No Claude.",
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
