import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aetheris One",
  description: "One chat. 27 free AI providers with failover, agents, coding factory, studio and 100+ apps. Free for everyone.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "Aetheris", statusBarStyle: "black-translucent" },
  openGraph: { title: "Aetheris One", description: "Free AI workspace for everyone — one chat over 27 providers, agents, coding factory, studio, 100+ apps.", type: "website" },
};
export const viewport: Viewport = { themeColor: "#0b0d12", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <script dangerouslySetInnerHTML={{ __html: `if("serviceWorker" in navigator){addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}))}` }} />
      </body>
    </html>
  );
}
