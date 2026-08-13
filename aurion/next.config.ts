import type { NextConfig } from "next";

/**
 * Two supported topologies, one config:
 *
 * 1. **Production (single process).** `npm run build` emits a static export to
 *    `out/`, which FastAPI serves at `/`. The UI calls `/v1/*` on the same
 *    origin, so there is no CORS surface and nothing to proxy.
 *
 * 2. **Development.** `npm run dev` serves the UI with hot reload and proxies
 *    `/v1/*` to the Python runtime, so browser code still only ever talks to
 *    its own origin — never to localhost directly.
 */
const isDev = process.env.NODE_ENV === "development";

const backend = process.env.AETHERIS_BACKEND ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  // Static export only for production builds; `output: export` is incompatible
  // with dev-time rewrites.
  ...(isDev ? {} : { output: "export" as const }),
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  // Allow the sandboxed preview host to load dev assets.
  allowedDevOrigins: ["*.e2b.app"],
  // Rewrites are dev-only: a static export cannot apply them, and declaring
  // them unconditionally makes the build warn.
  ...(isDev
    ? {
        async rewrites() {
          return [
            { source: "/v1/:path*", destination: `${backend}/v1/:path*` },
            { source: "/docs", destination: `${backend}/docs` },
            { source: "/openapi.json", destination: `${backend}/openapi.json` },
          ];
        },
      }
    : {}),
};

export default nextConfig;
