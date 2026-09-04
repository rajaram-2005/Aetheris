/**
 * Browser Agent (Phase 12) — goal-driven web navigation with a permission gate.
 *
 * Two engines, chosen at runtime and reported honestly:
 *   http        IMPLEMENTED  fetch + HTML → accessibility-style snapshot (headings, text, links[n], forms[n]);
 *               actions: goto · follow(link n) · submit(form n, fields) · extract · finish. No JS execution.
 *   playwright  OPTIONAL     used automatically when the `playwright` package AND a browser are installed
 *               (npx playwright install chromium); adds click/type on JS-rendered pages. Otherwise NOT AVAILABLE.
 *
 * Safety: domain allow/deny lists, robots.txt respected for the http engine, max steps, no credentials in
 * prompts, POST/submit requires safe_write (caller enforces via /api/browser), full trace of every step.
 */
import { route } from "@/lib/router/router";
import { htmlToText } from "@/lib/kb";
import { traced } from "../observability/events";

export interface Snapshot { url: string; title: string; text: string; links: { n: number; text: string; href: string }[]; forms: { n: number; action: string; method: string; fields: { name: string; type: string; value?: string; label?: string }[] }[]; status: number }
export type Action = { type: "goto"; url: string } | { type: "follow"; n: number } | { type: "submit"; n: number; fields: Record<string, string> } | { type: "extract"; instruction: string } | { type: "finish"; answer: string };
export interface Step { i: number; action: Action; url?: string; ok: boolean; note?: string; ms: number }
export interface BrowseResult { ok: boolean; answer: string; steps: Step[]; engine: "http" | "playwright"; finalUrl?: string; reason?: string }

const DENY_DEFAULT = [/^https?:\/\/(localhost|127\.|10\.|192\.168\.|169\.254\.|\[::1\])/i, /^file:/i];
const abs = (base: string, href: string) => { try { return new URL(href, base).toString(); } catch { return ""; } };
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** Pure: HTML → snapshot (tested). */
export function snapshot(url: string, html: string, status = 200, maxText = 12_000): Snapshot {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const body = html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, "");
  const links: Snapshot["links"] = []; let n = 0;
  for (const m of body.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) { const href = abs(url, m[1]); const text = decode(m[2].replace(/<[^>]+>/g, "")); if (href && /^https?:/.test(href) && text) { links.push({ n: ++n, text: text.slice(0, 80), href }); if (n >= 120) break; } }
  const forms: Snapshot["forms"] = []; let f = 0;
  for (const m of body.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = m[1]; const action = abs(url, /action=["']([^"']*)["']/i.exec(attrs)?.[1] ?? url); const method = (/method=["']?(post|get)/i.exec(attrs)?.[1] ?? "get").toLowerCase();
    const fields: Snapshot["forms"][number]["fields"] = [];
    for (const im of m[2].matchAll(/<(input|textarea|select)\b([^>]*)>/gi)) { const a = im[2]; const name = /name=["']([^"']+)["']/i.exec(a)?.[1]; if (!name) continue; const type = im[1] === "input" ? (/type=["']([^"']+)["']/i.exec(a)?.[1] ?? "text").toLowerCase() : im[1]; if (["hidden", "submit", "button", "image"].includes(type) && type !== "hidden") continue; fields.push({ name, type, value: /value=["']([^"']*)["']/i.exec(a)?.[1], label: /placeholder=["']([^"']*)["']/i.exec(a)?.[1] ?? /aria-label=["']([^"']*)["']/i.exec(a)?.[1] }); }
    forms.push({ n: ++f, action, method, fields }); if (f >= 20) break;
  }
  return { url, title, text: htmlToText(body).slice(0, maxText), links, forms, status };
}
export function render(s: Snapshot, maxLinks = 60): string {
  return `URL: ${s.url}\nTITLE: ${s.title}\nSTATUS: ${s.status}\n\nTEXT:\n${s.text.slice(0, 7000)}\n\nLINKS:\n${s.links.slice(0, maxLinks).map((l) => `[${l.n}] ${l.text} → ${l.href}`).join("\n")}\n\nFORMS:\n${s.forms.map((f) => `(${f.n}) ${f.method.toUpperCase()} ${f.action} fields: ${f.fields.map((x) => `${x.name}:${x.type}${x.label ? `(${x.label})` : ""}`).join(", ")}`).join("\n") || "none"}`;
}

const robotsCache = new Map<string, string[]>();
async function robotsAllows(url: string): Promise<boolean> {
  try { const u = new URL(url); const key = u.origin; let rules = robotsCache.get(key); if (!rules) { const r = await fetch(`${key}/robots.txt`, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": "AetherisBot/1.0" } }); const txt = r.ok ? await r.text() : ""; rules = []; let applies = false; for (const line of txt.split(/\r?\n/)) { const [k, v] = line.split(":").map((x) => x?.trim().toLowerCase()); if (k === "user-agent") applies = v === "*" || v === "aetherisbot"; else if (applies && k === "disallow" && v) rules.push(v); } robotsCache.set(key, rules); } return !rules.some((p) => u.pathname.startsWith(p)); } catch { return true; }
}
export function policyOk(url: string, opts: { allow?: RegExp[]; deny?: RegExp[] }): string | null {
  if (!/^https?:\/\//i.test(url)) return "only http(s) URLs";
  if ([...DENY_DEFAULT, ...(opts.deny ?? [])].some((r) => r.test(url))) return "URL blocked by deny-list (private networks are never browsed)";
  if (opts.allow?.length && !opts.allow.some((r) => r.test(url))) return "URL not in allow-list";
  return null;
}

class HttpEngine {
  readonly kind = "http" as const; private jar = new Map<string, string>();
  async load(url: string, init?: { method?: string; body?: URLSearchParams }): Promise<Snapshot> {
    if (!(await robotsAllows(url))) throw new Error("robots.txt disallows this path");
    const host = new URL(url).host;
    const r = await fetch(url, { method: init?.method ?? "GET", body: init?.body, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 AetherisBot/1.0 (+https://github.com/rajaram-2005/Aetheris)", Accept: "text/html,*/*;q=0.8", ...(this.jar.get(host) ? { Cookie: this.jar.get(host)! } : {}), ...(init?.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) }, signal: AbortSignal.timeout(20_000) });
    const sc = r.headers.get("set-cookie"); if (sc) this.jar.set(host, sc.split(/,(?=[^;]+=)/).map((c) => c.split(";")[0]).join("; "));
    const ct = r.headers.get("content-type") ?? ""; const txt = await r.text();
    return ct.includes("html") ? snapshot(r.url, txt, r.status) : { url: r.url, title: "", text: txt.slice(0, 12_000), links: [], forms: [], status: r.status };
  }
}
/** Playwright engine, loaded only if installed; probes a browser launch. */
async function playwrightEngine(): Promise<{ kind: "playwright"; load(url: string, init?: { method?: string; body?: URLSearchParams }): Promise<Snapshot>; close(): Promise<void> } | null> {
  try {
    const mod = "playwright"; const pw = (await import(/* webpackIgnore: true */ mod)) as { chromium: { launch(o: { headless: boolean }): Promise<{ newPage(): Promise<{ goto(u: string, o: { waitUntil: string; timeout: number }): Promise<{ status(): number } | null>; content(): Promise<string>; url(): string; close(): Promise<void> }>; close(): Promise<void> }> } };
    const browser = await pw.chromium.launch({ headless: true });
    return { kind: "playwright", async load(url, init) { if (init?.body) { const h = new HttpEngine(); return h.load(url, init); } const page = await browser.newPage(); try { const res = await page.goto(url, { waitUntil: "networkidle", timeout: 25_000 }); return snapshot(page.url(), await page.content(), res?.status() ?? 200); } finally { await page.close(); } }, close: () => browser.close() };
  } catch { return null; }
}
export async function browserStatus() { const pw = await playwrightEngine(); if (pw) await pw.close(); return { http: { available: true, note: "static HTML only, no JavaScript" }, playwright: { available: !!pw, note: pw ? "chromium launches" : "install with: npm i playwright && npx playwright install chromium" } }; }

/** Pure: parse the model's action JSON (tested). */
export function parseAction(text: string): Action | null {
  const m = /\{[\s\S]*\}/.exec(text); if (!m) return null;
  try { const a = JSON.parse(m[0]) as Partial<Action> & { url?: string; n?: number; fields?: Record<string, string>; instruction?: string; answer?: string }; switch (a.type) { case "goto": return a.url ? { type: "goto", url: a.url } : null; case "follow": return typeof a.n === "number" ? { type: "follow", n: a.n } : null; case "submit": return typeof a.n === "number" ? { type: "submit", n: a.n, fields: a.fields ?? {} } : null; case "extract": return { type: "extract", instruction: a.instruction ?? "" }; case "finish": return { type: "finish", answer: a.answer ?? "" }; default: return null; } } catch { return null; }
}

export async function browse(opts: { goal: string; startUrl: string; maxSteps?: number; allowSubmit?: boolean; allow?: RegExp[]; deny?: RegExp[]; preferred?: string; preferPlaywright?: boolean; onStep?: (s: Step) => void }): Promise<BrowseResult> {
  return traced({ type: "tool", capability: "browser:agent", detail: opts.goal.slice(0, 80) }, async () => {
    const steps: Step[] = []; const max = Math.min(opts.maxSteps ?? 8, 20);
    const pw = opts.preferPlaywright ? await playwrightEngine() : null; const engine = pw ?? new HttpEngine();
    const history: string[] = []; let snap: Snapshot | undefined; let last: string | undefined;
    const doStep = async (action: Action): Promise<Step> => {
      const t0 = Date.now(); const s: Step = { i: steps.length + 1, action, ok: true, ms: 0 };
      try {
        if (action.type === "goto" || action.type === "follow" || action.type === "submit") {
          let url: string; let init: { method?: string; body?: URLSearchParams } | undefined;
          if (action.type === "goto") url = action.url; else if (action.type === "follow") { const l = snap?.links.find((x) => x.n === action.n); if (!l) throw new Error(`no link [${action.n}]`); url = l.href; } else { const f = snap?.forms.find((x) => x.n === action.n); if (!f) throw new Error(`no form (${action.n})`); if (!opts.allowSubmit) throw new Error("form submission not permitted for this run (needs safe_write)"); const body = new URLSearchParams(); for (const fld of f.fields) { const v = action.fields[fld.name] ?? fld.value; if (v !== undefined) body.set(fld.name, v); } if (f.method === "post") { url = f.action; init = { method: "POST", body }; } else { const u = new URL(f.action); body.forEach((v, k) => u.searchParams.set(k, v)); url = u.toString(); } }
          const p = policyOk(url, opts); if (p) throw new Error(p);
          snap = await engine.load(url, init); s.url = snap.url; s.note = `${snap.status} · ${snap.title || "(no title)"} · ${snap.links.length} links`; last = snap.url;
        } else if (action.type === "extract") { if (!snap) throw new Error("no page loaded"); const r = await route({ preferred: opts.preferred, temperature: 0, maxTokens: 800, messages: [{ role: "system", content: "Extract exactly what is asked from the page text. Quote verbatim where possible. Say 'not found' if absent." }, { role: "user", content: `${action.instruction}\n\n${snap.text.slice(0, 14_000)}` }] }); s.note = r.content.slice(0, 1500); history.push(`extracted: ${s.note}`); }
      } catch (e) { s.ok = false; s.note = (e as Error).message; }
      s.ms = Date.now() - t0; steps.push(s); opts.onStep?.(s); return s;
    };
    try {
      await doStep({ type: "goto", url: opts.startUrl });
      for (let i = 0; i < max; i++) {
        const r = await route({ preferred: opts.preferred, temperature: 0, maxTokens: 300, messages: [
          { role: "system", content: `You are a careful web-browsing agent. Decide ONE next action as JSON only:\n{"type":"goto","url":"https://..."} | {"type":"follow","n":<link number>} | {"type":"submit","n":<form number>,"fields":{"name":"value"}} | {"type":"extract","instruction":"..."} | {"type":"finish","answer":"..."}\nRules: never enter credentials or personal data; prefer extract before finish; finish as soon as the goal is met; if blocked (login wall, captcha, error) finish with what you know and say so.` },
          { role: "user", content: `GOAL: ${opts.goal}\nSTEPS SO FAR:\n${steps.map((s) => `${s.i}. ${JSON.stringify(s.action)} → ${s.ok ? "ok" : "FAILED"} ${s.note ?? ""}`).join("\n")}\n${history.length ? `\nNOTES:\n${history.slice(-4).join("\n")}\n` : ""}\nCURRENT PAGE:\n${snap ? render(snap) : "(none)"}` } ] });
        const action = parseAction(r.content);
        if (!action) { steps.push({ i: steps.length + 1, action: { type: "finish", answer: "" }, ok: false, note: `unparseable action: ${r.content.slice(0, 120)}`, ms: 0 }); continue; }
        if (action.type === "finish") return { ok: true, answer: action.answer, steps, engine: engine.kind, finalUrl: last };
        await doStep(action);
      }
      return { ok: false, answer: history.at(-1) ?? "", steps, engine: engine.kind, finalUrl: last, reason: `step budget (${max}) exhausted` };
    } finally { if (pw) await pw.close(); }
  });
}
