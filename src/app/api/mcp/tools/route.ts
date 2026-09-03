import { NextResponse } from "next/server";
import { McpClient } from "@/lib/mcp/client";
import { resolveServer, type EnabledServer } from "@/lib/mcp/agent";

export const dynamic = "force-dynamic";

/** Test a server connection and list its tools. */
export async function POST(req: Request) {
  const s = (await req.json().catch(() => null)) as EnabledServer | null;
  if (!s?.id) return NextResponse.json({ error: "server id required" }, { status: 400 });
  const r = resolveServer(s);
  if (!r) return NextResponse.json({ error: "This connector has no remote URL configured." }, { status: 400 });
  try {
    const client = new McpClient({ url: r.url, headers: r.headers }, 15_000);
    const info = await client.initialize();
    const tools = await client.listTools();
    return NextResponse.json({ server: r.name, info, tools: tools.map((t) => ({ name: t.name, description: t.description })) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
