import { NextResponse } from "next/server";
import { getUserId } from "@/lib/user";
import { consumeChat, planFor } from "@/lib/billing/entitlements";
import { resolveTier } from "@/lib/models/tiers";
import { runDebate } from "@/core/warroom/debate";
import { store } from "@/lib/store";
import type { WarRoomDebate } from "@/core/warroom/debate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/debate
 *
 * Body: { motion, pro?, con?, rounds?, model?, persist? }
 * Response: SSE { type: "turn"|"delta"|"verdict"|"done"|"error" }
 *
 * GET /api/debate?uid=…&id=…  → fetch a saved debate
 * GET /api/debate?uid=…&limit=… → list saved debates (newest first)
 *
 * The underlying engine lives in src/core/warroom/debate.ts. This route is
 * the streaming HTTP adapter + persistence layer.
 */
export async function POST(req: Request) {
  const { uid } = await getUserId();
  const b = (await req.json().catch(() => ({}))) as { motion?: string; pro?: string; con?: string; rounds?: number; model?: string; persist?: boolean };
  const motion = (b.motion ?? "").trim().slice(0, 2000);
  if (!motion) return NextResponse.json({ error: "motion required" }, { status: 400 });
  const rounds = Math.min(4, Math.max(1, Number(b.rounds ?? 2)));
  const plan = await planFor(uid); const { tier } = resolveTier(b.model, plan.id);
  const quota = await consumeChat(uid, rounds * 2 + 1, "agents");
  if (!quota.allowed) return NextResponse.json({ error: "Daily limit reached." }, { status: 402 });
  const pol = { allow: tier.providers, allowKeyless: tier.allowKeyless, maxTokens: Math.min(tier.maxTokens ?? 1200, 1200), signal: req.signal };
  const id = `dbt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const persist = b.persist !== false;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (e: unknown) => { try { ctrl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { /* closed */ } };
      try {
        // turn announcements: drive the UI headers
        let lastSide: "pro" | "con" | "judge" | null = null;
        let lastRound = 0;
        const debate: WarRoomDebate = await runDebate({
          motion, rounds,
          pro: b.pro, con: b.con,
          allow: pol.allow, allowKeyless: pol.allowKeyless, maxTokens: pol.maxTokens, signal: pol.signal,
          id, createdAt: Date.now(),
          onDelta: ({ side, round, text }) => {
            if (side !== lastSide || round !== lastRound) {
              lastSide = side; lastRound = round;
              const turn = side === "judge"
                ? { type: "turn", side, agent: "metis", name: "Metis", icon: "🦉", round }
                : null; // speaker announcements are emitted below as turns complete
              if (turn) send(turn);
            }
            send({ type: "delta", side, round, text });
          },
        });
        // Emit one 'turn' event per turn (so the UI can render a header per side/round)
        for (const t of debate.turns) {
          if (t.side === "judge") {
            send({ type: "turn", side: "judge", agent: t.agent, name: t.name, icon: t.icon, round: t.round });
          } else {
            send({ type: "turn", side: t.side, agent: t.agent, name: t.name, icon: t.icon, round: t.round });
          }
        }
        // Emit a final 'verdict' and 'done'
        const judge = debate.turns.find((t) => t.side === "judge");
        if (judge) send({ type: "verdict", text: judge.text, provider: judge.provider, model: judge.model });
        if (persist) {
          try {
            await store.set("debates", `${uid}:${debate.id}`, { uid, ...debate });
            send({ type: "saved", id: debate.id });
          } catch (e) {
            // persistence is best-effort; don't fail the user
            send({ type: "warn", error: `save failed: ${(e as Error).message}` });
          }
        }
        send({ type: "done", rounds, pro: debate.pro, con: debate.con, id: debate.id });
      } catch (e) {
        send({ type: "error", error: (e as Error).message });
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}

export async function GET(req: Request) {
  const { uid } = await getUserId();
  const u = new URL(req.url);
  const id = u.searchParams.get("id");
  if (id) {
    const rec = await store.get<WarRoomDebate & { uid: string }>("debates", `${uid}:${id}`);
    if (!rec) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ debate: rec });
  }
  const limit = Math.min(50, Math.max(1, Number(u.searchParams.get("limit") ?? 20)));
  const all = await store.all<WarRoomDebate & { uid: string }>("debates");
  const list = Object.values(all)
    .filter((d) => d.uid === uid)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map((d) => ({
      id: d.id,
      motion: d.motion,
      pro: d.pro,
      con: d.con,
      judge: d.judge,
      rounds: d.rounds,
      createdAt: d.createdAt,
      finishedAt: d.finishedAt,
      totalTurns: d.totalTurns,
    }));
  return NextResponse.json({ count: list.length, debates: list });
}
