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
        {/* Next/React streaming can leave an empty `<div hidden><!--$--><!--/$--></div>` boundary
            shell as the first body child: the $RC cleanup removes the streamed payload but keeps
            the empty wrapper. That bare shell makes hydration mismatch (the server DOM starts with
            the shell while the client tree starts with the app), so React regenerates the whole
            tree. Remove such empty shells — they are dead weight by definition (no elements, no
            text). $RC finalizes boundaries after this script runs, so watch body mutations too. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var cleanShells=function(){var e=document.body.children,i=0;while(i<e.length){var n=e[i];if(n.nodeName==="DIV"&&n.hasAttribute("hidden")&&n.childElementCount===0&&!n.textContent.trim())n.remove();else i++}};cleanShells();new MutationObserver(cleanShells).observe(document.body,{childList:true,subtree:true})}catch(_){}`,
          }}
        />
        {children}
        {/* The desktop app (desktop/) injects window.aetherisDesktop through its preload; it must
            not register the service worker, or a stale cached shell would outlive an app update. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if(!window.aetherisDesktop&&"serviceWorker" in navigator){addEventListener("load",()=>navigator.serviceWorker.register("/sw.js",{updateViaCache:"none"}).catch(()=>{}))}`,
          }}
        />
      </body>
    </html>
  );
}
