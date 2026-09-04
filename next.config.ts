import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["*.e2b.app"],
  /**
   * The desktop app (desktop/) ships the server as a self-contained bundle: it runs
   * `.next/standalone/server.js` under Electron's own Node runtime, so no Node install is needed on
   * the user's machine. Opt in with AETHERIS_STANDALONE=1 — `npm run desktop:build` sets it.
   *
   * Left off by default so `npm run build && npm start` behaves exactly as documented in
   * docs/DEPLOYMENT.md (standalone moves the output into `.next/standalone`, which would break
   * `next start`).
   */
  ...(process.env.AETHERIS_STANDALONE === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
