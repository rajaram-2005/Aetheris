import { NextResponse, type NextRequest } from "next/server";
import { isLoopbackHost } from "./lib/loopback";
import { ACCOUNT_SESSION_COOKIE } from "./lib/auth/constants";
import { authenticationRequired, isPublicAuthPath, validSessionCookie } from "./lib/auth/gate";
import { checkRateLimit } from "./lib/ratelimit";
import { hostedMode } from "./lib/hosted";

/**
 * Edge middleware: session gate (when AETHERIS_REQUIRE_LOGIN=1) + security headers on every
 * response + coarse per-IP rate limiting for write-heavy, physical and AI endpoints.
 * Fine-grained per-uid limits live in the routes (src/core/security/guard.ts).
 * The limiter is shared (Upstash Redis REST) when configured, per-instance/in-memory otherwise.
 */
const RULES: { test: RegExp; limit: number; windowMs: number }[] = [
  { test: /^\/api\/(devices|robots)\//, limit: 60, windowMs: 60_000 },
  { test: /^\/api\/(executions|browser|jobs|research|multimodal|github\/repos\/intel)/, limit: 30, windowMs: 60_000 },
  /**
   * The two heaviest endpoints in the app: one POST to /api/control-plane runs the whole 12-phase
   * pipeline (including its Phase 7 → Phase 3 recovery loop), and one POST to /api/test-lab runs the
   * eight-category regression suite. Both are capped at LIMITS.heavy so a client cannot pin a server
   * worker by clicking in a loop.
   */
  { test: /^\/api\/(control-plane|test-lab)(\/|$)/, limit: 12, windowMs: 60_000 },
  { test: /^\/api\/automations\/[^/]+\/hook/, limit: 120, windowMs: 60_000 },
  { test: /^\/api\/(auth|permissions)/, limit: 90, windowMs: 60_000 },
  /** AI spend endpoints: each hit burns provider quota, so they get their own per-IP budget. */
  { test: /^\/api\/(chat|arena|debate|explain|agents\/run|factory\/run|workflows|media\/generate|v1\/chat)(\/|$)/, limit: 60, windowMs: 60_000 },
];
export async function middleware(req: NextRequest) {
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

  // Login gate (public hosted instances): a valid account session everywhere except the public
  // auth paths. The session is verified cryptographically (WebCrypto AES-GCM) at the edge.
  if (authenticationRequired() && !isPublicAuthPath(path, req.method)) {
    const ok = await validSessionCookie(req.cookies.get(ACCOUNT_SESSION_COOKIE)?.value);
    if (!ok) {
      if (path.startsWith("/api/")) {
        return new NextResponse(JSON.stringify({ error: "authentication required", detail: "this instance requires sign-in" }), { status: 401, headers: { "content-type": "application/json" } });
      }
      const url = req.nextUrl.clone(); url.pathname = "/"; url.searchParams.set("signin", "required");
      return NextResponse.redirect(url);
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    const rule = RULES.find((r) => r.test.test(path));
    if (rule) {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
      const rl = await checkRateLimit({ key: `edge:${rule.test.source}:${ip}`, limit: rule.limit, windowMs: rule.windowMs });
      if (!rl.allowed) return new NextResponse(JSON.stringify({ error: "rate limited", retryAfterSec: rl.retryAfterSec }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": String(rl.retryAfterSec) } });
    }
  }
  const res = NextResponse.next();
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
  res.headers.set("X-DNS-Prefetch-Control", "off");
  // HSTS only on hosted instances: it would needlessly pin localhost development to HTTPS.
  if (hostedMode()) res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  if (!path.startsWith("/s/")) res.headers.set("X-Robots-Tag", path.startsWith("/api/") ? "noindex" : "all");
  return res;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
