/**
 * OpenAI-compatible endpoint for personal Aetheris API keys.
 *   POST /api/v1/chat/completions  Authorization: Bearer sk-aeth-…
 *   body: { model: "aetheris-pro", messages: [...], stream?: boolean, temperature?: number, agents?: string[] }
 * Point any OpenAI SDK at base_url = https://<host>/api/v1 .
 */
import { NextResponse } from "next/server";
import { authenticateKey } from "@/lib/keys/apikeys";
import { consumeChat, planFor } from "@/lib/billing/entitlements";
import { resolveTier } from "@/lib/models/tiers";
import { route } from "@/lib/router/router";
import { orchestrate } from "@/lib/agents/orchestrator";
import { getLessons } from "@/lib/agents/lessons";
import type { ChatMessage } from "@/lib/router/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const oaiErr = (message: string, status: number, type = "invalid_request_error", code?: string) =>
  NextResponse.json({ error: { message, type, code } }, { status });

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const key = token ? await authenticateKey(token) : null;
  if (!key) return oaiErr("Invalid API key. Create one in Aetheris → Settings → API keys.", 401, "authentication_error", "invalid_api_key");

  const body = await req.json().catch(() => null) as null | { model?: string; messages?: { role: string; content: unknown }[]; stream?: boolean; temperature?: number; max_tokens?: number; agents?: string[] };
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) return oaiErr("`messages` is required", 400);

  const plan = await planFor(key.uid);
  const { tier, downgraded } = resolveTier(body.model ?? key.model, plan.id);
  const quota = await consumeChat(key.uid, body.agents?.length ? 2 : 1);
  if (!quota.allowed) return oaiErr(`Daily credit limit reached (${quota.limit}). Upgrade your Aetheris plan.`, 429, "rate_limit_error", "insufficient_quota");

  const toText = (c: unknown) => typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : "")).join("") : "";
  const msgs: ChatMessage[] = body.messages
    .filter((m) => m && ["system", "user", "assistant"].includes(m.role))
    .map((m) => ({ role: m.role as ChatMessage["role"], content: toText(m.content) }))
    .slice(-tier.contextMessages);
  if (!msgs.some((m) => m.role === "system")) msgs.unshift({ role: "system", content: "You are Aetheris One, a precise, helpful assistant." });

  const id = "chatcmpl-" + Math.random().toString(36).slice(2, 14);
  const created = Math.floor(Date.now() / 1000);
  const modelLabel = tier.id + (downgraded ? " (plan-capped)" : "");
  const wantAgents = !!body.agents?.length || /^@[\w-]+/.test(msgs[msgs.length - 1]?.content ?? "");
  const routeOpts = { allow: tier.providers, allowKeyless: tier.allowKeyless, maxTokens: Math.min(body.max_tokens ?? tier.maxTokens, tier.maxTokens), temperature: body.temperature };

  const runText = async (onDelta?: (t: string) => void): Promise<{ text: string; provider: string }> => {
    if (wantAgents) {
      if (!plan.features.includes("agents") && (body.agents?.length ?? 0) > 1) throw Object.assign(new Error("Multi-agent runs need Lite or above."), { status: 402 });
      let text = ""; let provider = "";
      await orchestrate({
        messages: msgs, agents: body.agents, lessons: await getLessons(key.uid), signal: req.signal,
        policy: { maxAgents: Math.min(plan.maxAgents, tier.agents.max), parallel: tier.agents.parallel, critique: tier.agents.critique, allow: tier.providers, allowKeyless: tier.allowKeyless, maxTokens: routeOpts.maxTokens },
        onEvent: (e) => { if (e.type === "delta") { text += e.text; onDelta?.(e.text); } else if (e.type === "done") provider = e.provider; },
      });
      return { text, provider };
    }
    const r = await route({ ...routeOpts, messages: msgs, signal: req.signal, onDelta: onDelta ? (t) => onDelta(t) : undefined });
    return { text: r.content, provider: r.provider };
  };

  if (!body.stream) {
    try {
      const { text, provider } = await runText();
      return NextResponse.json({
        id, object: "chat.completion", created, model: modelLabel, system_fingerprint: provider,
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        usage: { prompt_tokens: Math.ceil(msgs.reduce((n, m) => n + m.content.length, 0) / 4), completion_tokens: Math.ceil(text.length / 4), total_tokens: 0 },
        aetheris: { tier: tier.id, provider, credits_used: quota.used, credits_limit: quota.limit },
      });
    } catch (e) {
      const err = e as Error & { status?: number };
      return oaiErr(err.message, err.status ?? 502, "api_error");
    }
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created, model: modelLabel, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`));
      try {
        chunk({ role: "assistant", content: "" });
        await runText((t) => chunk({ content: t }));
        chunk({}, "stop");
      } catch (e) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ error: { message: (e as Error).message, type: "api_error" } })}\n\n`));
      } finally {
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
