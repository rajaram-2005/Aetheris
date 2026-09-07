import { NextResponse } from "next/server";
import { getUserId, uidCookie } from "@/lib/user";
import { PROVIDERS, providerKey, providerKeySource, resolveModel, type ProviderKeySource } from "@/lib/router/providers";
import { setRuntimeKey, runtimeKeyFor } from "@/lib/router/runtimeKeys";
import { maskKey } from "@/lib/router/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/PUT/DELETE /api/providers/keys — manage model-provider API keys from the Settings UI
 * instead of .env. Keys are stored instance-wide in <dataDir>/runtime_keys.json (mode 0600)
 * and apply immediately — no restart. A runtime key overrides the same env var from .env;
 * removing it transparently falls back to .env.
 */

interface ProviderKeyView {
  id: string;
  name: string;
  kind: string;
  envKey: string;
  model: string;
  keyless: boolean;
  local: boolean;
  vision: boolean;
  costClass: string;
  keyUrl?: string;
  freeTier?: string;
  notes?: string;
  hasKey: boolean;
  source: ProviderKeySource | null;
  maskedKey: string | null;
  cloudflare: boolean;
  cloudflareAccountSet: boolean;
}

function view(id: string): ProviderKeyView | null {
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    envKey: p.envKey,
    model: resolveModel(p),
    keyless: !!p.keyless,
    local: !!p.local,
    vision: !!p.vision,
    costClass: p.costClass ?? "free",
    keyUrl: p.keyUrl,
    freeTier: p.freeTier,
    notes: p.notes,
    hasKey: !!providerKey(p),
    source: providerKeySource(p) ?? null,
    maskedKey: maskKey(providerKey(p)),
    cloudflare: p.kind === "cloudflare",
    cloudflareAccountSet: !!process.env.CLOUDFLARE_ACCOUNT_ID?.trim(),
  };
}

export async function GET() {
  const { uid, isNew } = await getUserId();
  const providers = PROVIDERS.map((p) => view(p.id)).filter((v): v is ProviderKeyView => !!v);
  const res = NextResponse.json({ providers });
  if (isNew) {
    const c = uidCookie(uid);
    res.headers.append("Set-Cookie", `${c.name}=${c.value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${c.maxAge}`);
  }
  return res;
}

export async function PUT(req: Request) {
  await getUserId();
  const body = (await req.json().catch(() => ({}))) as { id?: string; key?: string };
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const key = typeof body.key === "string" ? body.key.trim() : "";
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) return NextResponse.json({ error: `unknown provider "${id}"` }, { status: 404 });
  if (key.length < 6) return NextResponse.json({ error: "key looks too short to be valid" }, { status: 400 });
  setRuntimeKey(p.envKey, key);
  return NextResponse.json({ ok: true, provider: view(id) });
}

export async function DELETE(req: Request) {
  await getUserId();
  const body = (await req.json().catch(() => ({}))) as { id?: string };
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const p = PROVIDERS.find((x) => x.id === id);
  if (!p) return NextResponse.json({ error: `unknown provider "${id}"` }, { status: 404 });
  if (runtimeKeyFor(p.envKey)) setRuntimeKey(p.envKey, "");
  return NextResponse.json({ ok: true, provider: view(id) });
}
