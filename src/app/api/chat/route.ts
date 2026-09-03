import { NextResponse } from "next/server";
import { route } from "@/lib/router/router";
import { ProviderError, type ChatMessage, type ProviderAttempt } from "@/lib/router/types";

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
  let body: { messages?: unknown; preferred?: unknown; temperature?: unknown };
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

  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, ...kept];
  const preferred = typeof body.preferred === "string" ? body.preferred : undefined;
  const temperature = typeof body.temperature === "number" ? body.temperature : undefined;

  try {
    const result = await route({ messages, preferred, temperature, signal: req.signal });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ProviderError) {
      const attempts = (err as ProviderError & { attempts?: ProviderAttempt[] }).attempts ?? [];
      return NextResponse.json({ error: err.message, attempts }, { status: err.status ?? 502 });
    }
    console.error("[aetheris] unexpected error", err);
    return NextResponse.json({ error: "Unexpected server error" }, { status: 500 });
  }
}
