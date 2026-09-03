import { getSession } from "@/lib/github/auth";
import { runFactory, type FactoryEvent } from "@/lib/factory/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * POST { task, preferred? } → Server-Sent Events stream of FactoryEvent.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Sign in with GitHub first" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }
  let body: { task?: string; preferred?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }
  const task = body.task?.trim();
  if (!task) return new Response(JSON.stringify({ error: "task required" }), { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (e: FactoryEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch { /* stream closed */ }
      };
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(": ping\n\n")); } catch { /* closed */ }
      }, 15_000);

      runFactory({ token: session.token, login: session.login }, task, send, { preferred: body.preferred, signal: req.signal })
        .catch((err) => send({ type: "error", message: err instanceof Error ? err.message : String(err) }))
        .finally(() => {
          clearInterval(heartbeat);
          try { controller.close(); } catch { /* already closed */ }
        });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
