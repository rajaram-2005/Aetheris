import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aetheris One",
  description: "One chat. A mesh of free AI providers. Automatic failover.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
