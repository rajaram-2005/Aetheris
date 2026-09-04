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
import { extractJson } from "../verification/verify";
import { traced } from "../observability/events";
import { ssrfCheck } from "../security/guard";

export interface Snapshot { url: string; title: string; text: string; links: { n: number; text: string; href: string }[]; forms: { n: number; action: string; method: string; fields: { name: string; type: string; value?: string; label?: string }[] }[]; status: number; /** True when the page is a JS application shell: the http engine got the markup, but the content is rendered client-side, so this snapshot is not the page the user would see. */ needsJs?: boolean;
  /** Server-rendered hydration payloads recovered from `<script>` tags (Next/Nuxt/Remix/SvelteKit/Angular/JSON-LD). */ embedded?: { source: EmbeddedSource; label: string; chars: number }[] }
export type Action = { type: "goto"; url: string } | { type: "follow"; n: number } | { type: "submit"; n: number; fields: Record<string, string> } | { type: "extract"; instruction: string } | { type: "finish"; answer: string };
export interface Step { i: number; action: Action; url?: string; ok: boolean; note?: string; ms: number }
export interface BrowseResult { ok: boolean; answer: string; steps: Step[]; engine: "http" | "playwright"; finalUrl?: string; reason?: string }

const DENY_DEFAULT = [/^https?:\/\/(localhost|127\.|10\.|192\.168\.|169\.254\.|\[::1\])/i, /^file:/i];
const abs = (base: string, href: string) => { try { return new URL(href, base).toString(); } catch { return ""; } };
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** Where a hydration payload came from — reported so the agent knows what it is reading. */
export type EmbeddedSource = "next-data" | "nuxt-data" | "nuxt-legacy" | "remix" | "initial-state" | "sveltekit" | "angular-ssr" | "ld+json";

export interface EmbeddedData { source: EmbeddedSource; label: string; json: unknown }

const SCRIPT_BODY = (attrs: string) => new RegExp(`<script\\b[^>]*${attrs}[^>]*>([\\s\\S]*?)<\\/script>`, "gi");

/** Keys that never carry readable content on their own. */
const NOISE = new Set(["_owner", "_store", "displayName", "__v", "className", "style", "key", "ref"]);

/**
 * A React/RSC element rather than data. `props` and `children` must NOT be blanket-skipped: that is
 * exactly where Next.js puts `pageProps`, so they are only dropped when the object is an element.
 */
const isReactNode = (o: Record<string, unknown>) => "$$typeof" in o || (typeof o.type === "string" && ("props" in o || "key" in o) && !("name" in o || "title" in o || "text" in o));

/**
 * Flatten a hydration payload into readable lines. Frameworks ship the data that rendered the page
 * as JSON in a <script> tag; walking it recovers text the http engine would otherwise throw away
 * with the rest of the <script> content. Scalars only — objects/arrays are traversed, never dumped.
 */
export function jsonToText(value: unknown, maxChars = 6000, depth = 0, key = ""): string {
  if (maxChars <= 0 || depth > 8) return "";
  const out: string[] = [];
  let budget = maxChars;
  const walk = (v: unknown, k: string, d: number) => {
    if (budget <= 0 || d > 8) return;
    if (v === null || v === undefined) return;
    if (typeof v === "string") {
      const t = v.trim();
      // Skip hashes, data URIs, CSS and code-ish blobs; keep human sentences and short values.
      if (t.length >= 2 && t.length <= 400 && !/^(data:|[A-Za-z0-9+/]{40,}={0,2}$|\.|function|\(module\)|use client)/.test(t) && !/^[-\w.]+\s*\{/.test(t)) {
        const line = k ? `${k}: ${t}` : t;
        if (line.length < budget) { out.push(line); budget -= line.length + 1; }
      }
      return;
    }
    if (typeof v === "number" || typeof v === "boolean") {
      if (k && !/^(_|__)/.test(k)) { const line = `${k}: ${v}`; if (line.length < budget) { out.push(line); budget -= line.length + 1; } }
      return;
    }
    if (Array.isArray(v)) { for (const item of v) walk(item, k, d + 1); return; }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (isReactNode(o)) return;
      for (const [kk, vv] of Object.entries(o)) {
        if (NOISE.has(kk) || kk.startsWith("__")) continue;
        walk(vv, kk, d + 1);
      }
    }
  };
  walk(value, key, depth);
  return out.join("\n");
}

/**
 * Pure: pull the server-rendered hydration payloads out of a page.
 *
 * A page that "needs JavaScript" is usually not empty — Next, Nuxt, Remix, SvelteKit and Angular
 * Universal serialise the exact data that rendered it into a <script> tag so the client can hydrate.
 * That JSON is in the raw HTML, so the http engine can read it without executing anything. Only
 * `JSON.parse` is ever used: nothing here evaluates a page's JavaScript.
 */
export function extractEmbeddedData(html: string): EmbeddedData[] {
  const found: EmbeddedData[] = [];
  const push = (source: EmbeddedSource, label: string, raw: string | undefined) => {
    if (!raw || !raw.trim()) return;
    const { value, found: ok } = extractJson(raw);
    if (ok && value !== null) found.push({ source, label, json: value });
  };
  const one = (re: RegExp) => { re.lastIndex = 0; const m = re.exec(html); return m?.[1]; };

  push("next-data", "Next.js __NEXT_DATA__", one(SCRIPT_BODY('id=["\']__NEXT_DATA__["\']')));
  push("nuxt-data", "Nuxt __NUXT_DATA__", one(SCRIPT_BODY('id=["\']__NUXT_DATA__["\']')));
  push("angular-ssr", "Angular serverApp-state", one(SCRIPT_BODY('id=["\']serverApp-state["\']')));
  push("sveltekit", "SvelteKit hydration data", one(SCRIPT_BODY('data-sveltekit-hydrate')));

  // `window.X = {...};` forms: take the balanced literal after the `=`, never eval the script.
  const assign = (name: string) => {
    const m = new RegExp(`(?:window\\.)?${name}\\s*=\\s*`, "i").exec(html);
    if (!m) return undefined;
    return html.slice(m.index + m[0].length, m.index + m[0].length + 200_000);
  };
  push("nuxt-legacy", "Nuxt window.__NUXT__", assign("__NUXT__"));
  push("remix", "Remix __remixContext", assign("__remixContext"));
  push("initial-state", "window.__INITIAL_STATE__", assign("__INITIAL_STATE__"));

  // JSON-LD: framework-independent structured data (products, articles, events, orgs).
  const ld = SCRIPT_BODY('type=["\']application/ld\\+json["\']');
  for (let m = ld.exec(html), n = 0; m && n < 8; m = ld.exec(html), n++) {
    const label = (() => { try { const v = JSON.parse(m[1]) as { ["@type"]?: string | string[] }; return `JSON-LD ${Array.isArray(v?.["@type"]) ? v["@type"][0] : v?.["@type"] ?? ""}`.trim(); } catch { return "JSON-LD"; } })();
    push("ld+json", label, m[1]);
  }
  return found;
}

/**
 * Pure: is this an application shell rather than a server-rendered page? React/Vue/Angular/Next ship
 * an almost-empty <body> plus a bundle; the http engine cannot run it. Detecting it lets the agent say
 * "this needs JavaScript" instead of describing an empty page as the answer.
 */
export function looksLikeJsShell(html: string, text: string): boolean {
  const root = /<div[^>]+id=["\']?(root|app|__next|__nuxt|ng-app)["\']?/i.test(html) || /<body[^>]+(ng-app|data-reactroot)/i.test(html);
  const bundle = /<script[^>]+src=["\'][^"\']+\.js/i.test(html);
  const thin = text.replace(/\s+/g, "").length < 240;
  return root && bundle && thin;
}

/** Pure: HTML → snapshot (tested). */
export function snapshot(url: string, html: string, status = 200, maxText = 12_000): Snapshot {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "");
  const noscript = [...html.matchAll(/<noscript\b[^>]*>([\s\S]*?)<\/noscript>/gi)].map((m) => htmlToText(m[1])).filter(Boolean).join(" ");
  const body = html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, "");
  const embedded = extractEmbeddedData(html).map((e) => ({ ...e, text: jsonToText(e.json, 3000) })).filter((e) => e.text.length > 20);
  const links: Snapshot["links"] = []; let n = 0;
  for (const m of body.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) { const href = abs(url, m[1]); const text = decode(m[2].replace(/<[^>]+>/g, "")); if (href && /^https?:/.test(href) && text) { links.push({ n: ++n, text: text.slice(0, 80), href }); if (n >= 120) break; } }
  const forms: Snapshot["forms"] = []; let f = 0;
  for (const m of body.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = m[1]; const action = abs(url, /action=["']([^"']*)["']/i.exec(attrs)?.[1] ?? url); const method = (/method=["']?(post|get)/i.exec(attrs)?.[1] ?? "get").toLowerCase();
    const fields: Snapshot["forms"][number]["fields"] = [];
    for (const im of m[2].matchAll(/<(input|textarea|select)\b([^>]*)>/gi)) { const a = im[2]; const name = /name=["']([^"']+)["']/i.exec(a)?.[1]; if (!name) continue; const type = im[1] === "input" ? (/type=["']([^"']+)["']/i.exec(a)?.[1] ?? "text").toLowerCase() : im[1]; if (["hidden", "submit", "button", "image"].includes(type) && type !== "hidden") continue; fields.push({ name, type, value: /value=["']([^"']*)["']/i.exec(a)?.[1], label: /placeholder=["']([^"']*)["']/i.exec(a)?.[1] ?? /aria-label=["']([^"']*)["']/i.exec(a)?.[1] }); }
    forms.push({ n: ++f, action, method, fields }); if (f >= 20) break;
  }
  const text = htmlToText(body).slice(0, maxText);
  // Hydration payloads and <noscript> are real page content that the stripped body does not contain.
  const extra = [noscript, ...embedded.map((e) => `— ${e.label} —\n${e.text}`)].filter(Boolean).join("\n");
  return {
    url, title, text: extra ? `${text}\n\n[recovered from the page\'s embedded data]\n${extra}`.slice(0, maxText + 12_000) : text,
    links, forms, status, needsJs: looksLikeJsShell(html, text) || undefined,
    embedded: embedded.map((e) => ({ source: e.source, label: e.label, chars: e.text.length })),
  };
}
export function render(s: Snapshot, maxLinks = 60): string {
  return `URL: ${s.url}\nTITLE: ${s.title}\nSTATUS: ${s.status}${s.needsJs ? "\nWARNING: JavaScript application shell — this page renders client-side, so the text below is the shell, not the content. Do not describe it as the answer; report that the page needs JavaScript." : ""}\n\nTEXT:\n${s.text.slice(0, 7000)}\n\nLINKS:\n${s.links.slice(0, maxLinks).map((l) => `[${l.n}] ${l.text} → ${l.href}`).join("\n")}\n\nFORMS:\n${s.forms.map((f) => `(${f.n}) ${f.method.toUpperCase()} ${f.action} fields: ${f.fields.map((x) => `${x.name}:${x.type}${x.label ? `(${x.label})` : ""}`).join(", ")}`).join("\n") || "none"}`;
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
    return { kind: "playwright", async load(url, init) { if (init?.body) { const h = new HttpEngine(); return h.load(url, init); } const page = await browser.newPage(); try { const res = await page.goto(url, { waitUntil: "networkidle", timeout: 25_000 }); /* the JS already ran here, so a thin page is really thin, not an unrendered shell */ const snap = snapshot(page.url(), await page.content(), res?.status() ?? 200); snap.needsJs = undefined; return snap; } finally { await page.close(); } }, close: () => browser.close() };
  } catch { return null; }
}
export async function browserStatus() { const pw = await playwrightEngine(); if (pw) await pw.close(); return { http: { available: true, note: "static HTML only, no JavaScript — JS application shells are detected and reported as needsJs rather than described as content" }, playwright: { available: !!pw, note: pw ? "chromium launches" : "install with: npm i playwright && npx playwright install chromium" } }; }

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
          const ss = await ssrfCheck(url, { allowHttp: true }); if (!ss.ok) throw new Error(`blocked: ${ss.reason}`);
          snap = await engine.load(url, init); s.url = snap.url; s.note = `${snap.status} · ${snap.title || "(no title)"} · ${snap.links.length} links${snap.needsJs ? " · JS shell (content is client-rendered)" : ""}`; last = snap.url;
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
