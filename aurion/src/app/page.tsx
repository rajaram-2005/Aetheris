/* ─── AURION Home Page ─── */
"use client";

import dynamic from 'next/dynamic';

// Disable SSR for the app (uses localStorage, window, etc.)
const AurionApp = dynamic(() => import('./AurionApp'), { ssr: false });

export default function Home() {
  return <AurionApp />;
}
