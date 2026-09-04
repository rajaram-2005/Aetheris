import { NextResponse } from "next/server";
import { getUserId } from "@/lib/user";
import { consumeChat, planFor } from "@/lib/billing/entitlements";
import { resolveTier } from "@/lib/models/tiers";
import { route } from "@/lib/router/router";
import { agentById, HERMES_BASE } from "@/lib/agents/catalog";
import type { ChatMessage } from "@/lib/router/types";
import { conceptGlossary } from "@/lib/concepts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Explainability: ask the AI Explainer to audit an answer that was already given.
 * POST { question, answer, provider?, model?, agents?: string[] } → SSE { type: "delta"|"done"|"error" }
 * The explanation always covers: fact vs inference vs guess, assumptions, calibrated confidence,
 * most-likely errors, how to verify cheaply, and bias risk in the framing.
 */
export const EXPLAIN_SECTIONS = ["What was asked", "Fact / inference / guess", "Assumptions made", "Confidence", "Most likely to be wrong", "How to verify", "Bias & framing check"] as const;

export function buildExplainPrompt(question: string, answer: string, meta: { provider?: string; model?: string; agents?: string[] }): ChatMessage[] {
  const xai = agentById("xai")!;
  const via = [meta.provider && `provider: ${meta.provider}`, meta.model && `model tier: ${meta.model}`, meta.agents?.length && `agents: ${meta.agents.join(", ")}`].filter(Boolean).join(" · ");
  return [
    { role: "system", content: `${HERMES_BASE}\n\n${xai.system}\n\nFormat: Markdown with exactly these headings, in order: ${EXPLAIN_SECTIONS.map((s) => `### ${s}`).join(", ")}. Under "Confidence" give a percentage and one sentence of reasoning. Under "Fact / inference / guess" use a 3-column table listing the answer's main claims. Keep the whole thing under 350 words. Be honest that you are reasoning about the answer from the outside — you did not produce it and cannot see its internal process. When a limitation maps to a known concept (hallucination, calibration, sycophancy, training cutoff, RAG…), name it and link it as [term](/docs/concept-<id>) so the user can learn more.\n\nConcept glossary (ids in parentheses):\n${conceptGlossary(["hallucination", "calibration", "sycophancy", "training-data", "rag", "reasoning", "bias", "context-window", "verification", "explainability"]).replace(/^- /gm, "- ")}` },
    { role: "user", content: `An AI assistant${via ? ` (${via})` : ""} was asked:\n\n"""\n${question}\n"""\n\nIt answered:\n\n"""\n${answer}\n"""\n\nExplain this answer for the user.` },
  ];
}

export async function POST(req: Request) {
  const { uid } = await getUserId();
  const b = (await req.json().catch(() => ({}))) as { question?: string; answer?: string; provider?: string; model?: string; agents?: string[] };
  const question = (b.question ?? "").trim().slice(0, 6000); const answer = (b.answer ?? "").trim().slice(0, 12000);
  if (!answer) return NextResponse.json({ error: "answer required" }, { status: 400 });
  const plan = await planFor(uid); const { tier } = resolveTier(b.model, plan.id);
  const quota = await consumeChat(uid, 1, "chat");
  if (!quota.allowed) return NextResponse.json({ error: "Daily limit reached." }, { status: 402 });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (e: unknown) => { try { ctrl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { /* closed */ } };
      try {
        const r = await route({ allow: tier.providers, allowKeyless: tier.allowKeyless, maxTokens: 900, temperature: 0.2, signal: req.signal, messages: buildExplainPrompt(question, answer, b), onDelta: (t) => send({ type: "delta", text: t }) });
        send({ type: "done", provider: r.provider, model: r.model });
      } catch (e) { send({ type: "error", error: (e as Error).message }); }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
