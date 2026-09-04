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
  ...(process.env.AETHERIS_STANDALONE === "1"
    ? {
        output: "standalone" as const,
        /**
         * `@ffmpeg/core` is resolved at runtime by walking node_modules (see
         * src/core/multimodal/wasmffmpeg.ts), so the dependency tracer never sees it and would leave
         * it out of the bundle — the desktop app would then report frame sampling unavailable even
         * though the package is installed. Only the UMD half is needed; the ESM build is the same
         * 31 MB again and is never loaded here.
         */
        outputFileTracingIncludes: { "/**/*": ["./node_modules/@ffmpeg/core/dist/umd/**/*", "./node_modules/@ffmpeg/core/package.json"] },
      }
    : {}),
};

export default nextConfig;
