import { NextResponse } from "next/server";
import { route } from "@/lib/router/router";
import { ProviderError, type ChatMessage, type ProviderAttempt } from "@/lib/router/types";
import { getUserId, uidCookie } from "@/lib/user";
import { consumeChat, hasFeature } from "@/lib/billing/entitlements";
import { runAgent, type EnabledServer } from "@/lib/mcp/agent";
import { connectorById } from "@/lib/mcp/catalog";
import { getSession } from "@/lib/github/auth";
import { readTokens, refreshToken, tokensCookie } from "@/lib/mcp/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM_PROMPT =
  process.env.AETHERIS_SYSTEM_PROMPT ??
  "You are Aetheris One, a helpful, concise AI assistant. Format answers in Markdown when useful.";

const MAX_MESSAGES = 40;
const MAX_CHARS = 32_000;

function isMessage(m: unknown): m is ChatMessage {
  if (!m || typeof m !== "object") return false;
  const r = (m as ChatMessage).role;
  return (r === "user" || r === "assistant" || r === "system") && typeof (m as ChatMessage).content === "string";
}

export async function POST(req: Request) {
  let body: { messages?: unknown; preferred?: unknown; temperature?: unknown; servers?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0 || !body.messages.every(isMessage)) {
    return NextResponse.json({ error: "`messages` must be a non-empty array of {role, content}" }, { status: 400 });
  }

  // Trim history: keep the most recent messages within budget. Client-supplied system
  // messages are dropped; the server owns the system prompt.
  const history = (body.messages as ChatMessage[]).filter((m) => m.role !== "system").slice(-MAX_MESSAGES);
  let total = 0;
  const kept: ChatMessage[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    total += history[i].content.length;
    if (total > MAX_CHARS) break;
    kept.unshift(history[i]);
  }
  if (kept.length === 0) {
    return NextResponse.json({ error: "Message too long" }, { status: 413 });
  }

  const { uid, isNew } = await getUserId();
  const quota = await consumeChat(uid);
  if (!quota.allowed) {
    const res = NextResponse.json(
      { error: `Free tier limit reached (${quota.limit} messages/day). Upgrade to Aetheris Pro for unlimited chat.`, code: "quota", quota },
      { status: 402 },
    );
    if (isNew) res.cookies.set(uidCookie(uid));
    return res;
  }

  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, ...kept];
  const preferred = typeof body.preferred === "string" ? body.preferred : undefined;
  const temperature = typeof body.temperature === "number" ? body.temperature : undefined;

  const servers = (Array.isArray(body.servers) ? body.servers : []) as EnabledServer[];
  if (servers.length > 0 && servers.some((s) => connectorById(s.id)?.premium)) {
    if (!(await hasFeature(uid, "mcp_premium"))) {
      return NextResponse.json({ error: "That connector is a premium MCP. Upgrade to Aetheris Pro to use it.", code: "upgrade", feature: "mcp_premium" }, { status: 402 });
    }
  }

  try {
    if (servers.length > 0) {
      const gh = await getSession();
      const tokenMap = await readTokens();
      let tokensChanged = false;
      const oauthTokens: Record<string, string> = {};
      for (const [id, t] of Object.entries(tokenMap)) {
        let tok = t;
        if (tok.expires_at && tok.expires_at < Date.now() + 30_000) {
          const r = await refreshToken(tok);
          if (r) { tok = r; tokenMap[id] = r; tokensChanged = true; }
        }
        oauthTokens[id] = tok.access_token;
      }
      const a = await runAgent({ messages, servers, preferred, ctx: { github: gh ? { token: gh.token, login: gh.login } : undefined, oauthTokens } });
      const res = NextResponse.json({ content: a.content, provider: a.provider, model: a.model, attempts: [], toolEvents: a.toolEvents, mcpFailures: a.failures, quota });
      if (isNew) res.cookies.set(uidCookie(uid));
      if (tokensChanged) res.cookies.set(tokensCookie(tokenMap));
      return res;
    }
    const result = await route({ messages, preferred, temperature, signal: req.signal });
    const res = NextResponse.json({ ...result, quota });
    if (isNew) res.cookies.set(uidCookie(uid));
    return res;
  } catch (err) {
    if (err instanceof ProviderError) {
      const attempts = (err as ProviderError & { attempts?: ProviderAttempt[] }).attempts ?? [];
      return NextResponse.json({ error: err.message, attempts }, { status: err.status ?? 502 });
    }
    console.error("[aetheris] unexpected error", err);
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
