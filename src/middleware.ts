import { NextResponse, type NextRequest } from "next/server";
import { isLoopbackHost } from "./lib/loopback";

/**
 * Edge middleware (Phase 17): security headers on every response + coarse per-IP rate limiting for
 * write-heavy and physical endpoints. Fine-grained per-uid limits live in the routes (src/core/security/guard.ts).
 * Honest: the edge counter is per-instance/in-memory; put a real limiter (Upstash/Cloudflare) in front for multi-region.
 */
const hits = new Map<string, number[]>();
const RULES: { test: RegExp; limit: number; windowMs: number }[] = [
  { test: /^\/api\/(devices|robots)\//, limit: 60, windowMs: 60_000 },
  { test: /^\/api\/(executions|browser|jobs|research|multimodal|github\/repos\/intel)/, limit: 30, windowMs: 60_000 },
  { test: /^\/api\/automations\/[^/]+\/hook/, limit: 120, windowMs: 60_000 },
  { test: /^\/api\/(auth|permissions)/, limit: 90, windowMs: 60_000 },
];
export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  /**
   * Desktop guard: when this instance is the one embedded in the Aetheris desktop app
   * (`AETHERIS_DESKTOP=1`, set by `desktop/src/lib/local-server.ts`), the server is reachable on
   * 127.0.0.1 only, and we additionally require a loopback `Host` header. That blocks the
   * DNS-rebinding trick where a web page the user visits resolves a public name to 127.0.0.1 and
   * reads the local Aetheris API through the browser. Off by default: it would break any
   * reverse-proxy or container deployment that forwards a public host name.
   */
  if (process.env.AETHERIS_DESKTOP === "1" && !isLoopbackHost(req.headers.get("host"))) {
    return new NextResponse(JSON.stringify({ error: "forbidden", detail: "this instance only accepts loopback Host headers" }), { status: 403, headers: { "content-type": "application/json" } });
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    const rule = RULES.find((r) => r.test.test(path));
    if (rule) {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
      const key = `${ip}:${rule.test.source}`; const now = Date.now(); const w = (hits.get(key) ?? []).filter((t) => now - t < rule.windowMs);
      if (w.length >= rule.limit) return new NextResponse(JSON.stringify({ error: "rate limited", retryAfterSec: Math.ceil((w[0] + rule.windowMs - now) / 1000) }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(Math.ceil((w[0] + rule.windowMs - now) / 1000)) } });
      w.push(now); hits.set(key, w); if (hits.size > 20_000) hits.clear();
    }
  }
  const res = NextResponse.next();
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
  res.headers.set("X-DNS-Prefetch-Control", "off");
  if (!path.startsWith("/s/")) res.headers.set("X-Robots-Tag", path.startsWith("/api/") ? "noindex" : "all");
  return res;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
