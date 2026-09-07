"use client";

/**
 * Command palette — Cmd+K / Ctrl+K to open, fuzzy search, jump anywhere.
 *
 *   Goals:
 *     - Open with Cmd+K (mac) or Ctrl+K (everything else). Esc to close.
 *     - Search across the in-app Modes (chat, agents, factory, …) and the
 *       utility routes (/diagnostics, /admin, /docs, …).
 *     - Fuzzy match on label + blurb + tag. Up/Down to move, Enter to jump.
 *     - A small "Run an API call" section that talks to the same endpoints
 *       the agent uses, so the palette doubles as a dev console.
 *     - NO new dependencies. NO server roundtrip for the index; the index
 *       is static and exported as a const.
 *
 *   Honest limits:
 *     - Does not search across the user's chat history (no API for that
 *       and no clear best-match score; the chat search box is the place
 *       for that).
 *     - Does not invoke LLM calls. A "natural-language → action" feature
 *       would be cool but is a separate piece of work; this is a fuzzy
 *       search + keyboard shortcut, not an AI bar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MODES, type Mode } from "./Sidebar";

export type PaletteItem = {
  id: string;
  label: string;
  blurb: string;
  tag: "mode" | "route" | "api" | "capability";
  /** Words to fuzzy-match against. */
  haystack: string[];
  /** What happens on Enter. */
  action: () => void;
  /** Optional icon. */
  icon?: string;
};

export interface CommandPaletteProps {
  /** Set the in-app mode (forwarded from the page that owns it). */
  setMode: (m: Mode) => void;
  /** Navigate to a route via the router (window.location for full nav). */
  navigate: (path: string) => void;
  /** Run an API call from the palette. */
  callApi: (path: string, init?: RequestInit) => Promise<unknown>;
}

export default function CommandPalette({ setMode, navigate, callApi }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const items = useMemo(() => buildIndex(setMode, navigate, callApi, setBusy, setErr), [setMode, navigate, callApi]);

  const matches = useMemo(() => fuzzyFilter(items, query, 12), [items, query]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      setErr(null);
      setBusy(null);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Clamp selection
  useEffect(() => {
    if (selected >= matches.length) setSelected(Math.max(0, matches.length - 1));
  }, [matches.length, selected]);

  // Global Cmd+K / Ctrl+K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (open && e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const run = useCallback(async (item: PaletteItem) => {
    setOpen(false);
    try {
      await item.action();
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  // In-palette key handling
  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(matches.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const m = matches[selected];
      if (m) void run(m);
    }
  };

  if (!open) return null;

  return (
    <div className="cmd-overlay" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="cmd-modal" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmd-input"
          placeholder="Type a command, mode, route, or API… (↑↓ Enter · Esc)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
          data-testid="cmd-input"
        />
        {busy ? <div className="cmd-busy">{busy}…</div> : null}
        {err ? <div className="cmd-err">⚠ {err}</div> : null}
        <div className="cmd-list" data-testid="cmd-list">
          {matches.length === 0 ? <div className="cmd-empty">No matches. Try a different word.</div> : null}
          {matches.map((m, i) => (
            <button
              key={m.id}
              className={`cmd-row${i === selected ? " on" : ""}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => void run(m)}
              data-testid={`cmd-row-${m.id}`}
              data-tag={m.tag}
            >
              <span className="cmd-icon">{m.icon ?? (m.tag === "mode" ? "◆" : m.tag === "route" ? "/" : m.tag === "api" ? "→" : "★")}</span>
              <span className="cmd-label">{m.label}</span>
              <span className="cmd-tag">{m.tag}</span>
              <span className="cmd-blurb">{m.blurb}</span>
            </button>
          ))}
        </div>
        <div className="cmd-hint">{matches.length} match{matches.length === 1 ? "" : "es"} · Cmd/Ctrl+K to toggle · ↑↓ to move · Enter to run</div>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------- index
//
// One static list of palette items. Adding a new entry here is the only
// change needed to expose something in the palette.

function buildIndex(
  setMode: (m: Mode) => void,
  navigate: (path: string) => void,
  callApi: (path: string, init?: RequestInit) => Promise<unknown>,
  setBusy: (s: string | null) => void,
  setErr: (s: string | null) => void,
): PaletteItem[] {
  const items: PaletteItem[] = [];

  // 1. In-app modes
  for (const m of MODES) {
    items.push({
      id: `mode:${m.id}`,
      label: `Go to ${m.label}`,
      blurb: m.blurb,
      tag: "mode",
      icon: m.icon,
      haystack: [m.id, m.label.toLowerCase(), m.blurb.toLowerCase()],
      action: () => setMode(m.id),
    });
  }

  // 2. Routes (full-page navigation)
  const routes: { path: string; label: string; blurb: string; tag?: string[] }[] = [
    { path: "/dashboard", label: "Dashboard", blurb: "10-core status, mesh, recent diagnostics, quick links", tag: ["home", "system", "health"] },
    { path: "/agents", label: "Agent Inspector", blurb: "Every agent in the catalog (Prime, Hermes, Metis, ...) with tier + skills + system prompt", tag: ["agent", "inspector", "catalog"] },
    { path: "/abstain", label: "Abstention (I don't know)", blurb: "NIRNAYA's 8-item evidence checklist + COLLECT / ESCALATE / SAFE STATE recommendation", tag: ["abstain", "evidence", "nirnaya"] },
    { path: "/compare", label: "Asset Comparison", blurb: "Side-by-side twin comparison: live state, last diagnostic, history sparkline, BPFO expectation", tag: ["compare", "twin", "asset"] },
    { path: "/autonomy", label: "Autonomy Level", blurb: "6-level autonomy dial (L0 reporting-only … L5 autonomous-accept) + level-change form", tag: ["autonomy", "policy", "safety"] },
    { path: "/anomaly", label: "Anomaly Detection", blurb: "Real anomaly detector on a twin channel: constant model + MAD-robust sigma, per-point z-score", tag: ["anomaly", "twin", "zscore"] },
    { path: "/fleet", label: "Fleet Overview", blurb: "Every twin in your fleet: health band, breaches, overdue maintenance, last diagnostic", tag: ["fleet", "twin", "overview"] },
    { path: "/devices", label: "Device Registry", blurb: "Every device the user has registered: adapter, address, health, twin binding, interlocks", tag: ["device", "edge", "physical"] },
    { path: "/trust", label: "Trust & Permissions", blurb: "5-level permission ladder, current principal grants, per-capability allow/deny", tag: ["permission", "policy", "safety"] },
    { path: "/maintenance", label: "Maintenance Dispatch", blurb: "Prioritised dispatch list: CRITICAL/HIGH/MEDIUM/LOW based on overdue maintenance, breaches, diagnostics", tag: ["maintenance", "dispatch", "twin"] },
    { path: "/handoff", label: "Operator Handoff", blurb: "Shift notes for the oncoming operator: observation / decision / open question / escalation", tag: ["handoff", "operator", "shift"] },
    { path: "/knowledge-graph", label: "Knowledge Graph", blurb: "The user's knowledge fabric as a graph: top entities, top relations, hub, depth-N subgraph", tag: ["knowledge", "graph", "entity"] },
    { path: "/credits", label: "Credit Ledger", blurb: "Today's usage, per-kind breakdown (chat/agents/research/arena/factory/media/api), 30-day history", tag: ["credits", "usage", "billing"] },
    { path: "/arena", label: "Model Arena", blurb: "Run the same prompt against every provider in parallel, side-by-side compare", tag: ["arena", "model", "router"] },
    { path: "/learning", label: "PBNN Prediction Graph", blurb: "Forecast next N steps from the production PBNN model with ±1.96σ band", tag: ["learning", "pbnn", "forecast"] },
    { path: "/twins/edit", label: "Twin Edit", blurb: "Typed mutations: setName, setState, addBound, removeBound, addRule, addMaintenance", tag: ["twin", "edit", "write"] },
    { path: "/trace", label: "Reasoning Trace", blurb: "Read the observability log as a per-capability reasoning trace with ok/fail, ms, detail", tag: ["trace", "reasoning", "observability"] },
    { path: "/permissions-matrix", label: "Permission Matrix", blurb: "Capability × security-level count matrix + per-capability table", tag: ["permission", "matrix", "capability"] },
    { path: "/lab-history", label: "Lab Experiment History", blurb: "Every lab run with source, output, stop reason, and p50/p95 latency", tag: ["lab", "experiment", "history"] },
    { path: "/maintenance-calendar", label: "Maintenance Calendar", blurb: "Forward 90-day projection of every maintenance entry, bucketed by overdue/week/month", tag: ["maintenance", "calendar", "projection"] },
    { path: "/evidence", label: "Evidence Ledger", blurb: "Append-only view across twin events, diagnostic history, and system events; filterable by twin and source", tag: ["evidence", "audit", "log"] },
    { path: "/audit", label: "Audit Export", blurb: "Download the production observability log as JSON or CSV with type, since, limit, okOnly filters", tag: ["audit", "export", "csv", "json"] },
    { path: "/terminal", label: "Sandboxed Terminal", blurb: "Run a single command per request in a fresh temp workspace, env-scrubbed, SIGKILL timeout. Read-only commands run unconfirmed; everything else needs safe_write + a token", tag: ["terminal", "sandbox", "shell"] },
    { path: "/cores", label: "Cores", blurb: "The 10 cores in the Aetheris v1 architecture, with what each can and cannot do today, and where its source code lives", tag: ["cores", "architecture", "registry"] },
    { path: "/vayu", label: "VAYU-1", blurb: "Wind & aerodynamics intelligence service: PBNN + anomaly + arena + FFT behind a single named query (proxy, not a trained model)", tag: ["vayu", "wind", "domain"] },
    { path: "/fuse", label: "Fusion Engine", blurb: "Single entry point that composes a structured answer from real modules: telemetry, twin, evidence, memory, verification, optional VAYU. No fabrication", tag: ["fusion", "orchestration", "decision"] },
    { path: "/shell", label: "Aetheris Shell", blurb: "The Section-5 architecture layout: left rail of cores, centre 3D twin, right intelligence, bottom strip", tag: ["shell", "ui", "layout"] },
    { path: "/runbook", label: "Operator Runbook", blurb: "What an operator can do today, what they cannot, what the system guarantees, what it does not", tag: ["runbook", "operator", "honest"] },
    { path: "/capabilities", label: "Capabilities", blurb: "Honest capabilities statement: per-core can-do / does-not-yet, plus the boundary Aetheris can keep", tag: ["capabilities", "honest", "scope"] },
    { path: "/fusion-trace", label: "Fusion Trace", blurb: "Every recorded fusion:orchestrate call, with decision and uncertainty, plus the underlying observability events", tag: ["fusion", "trace", "observability"] },
    { path: "/thresholds", label: "Thresholds", blurb: "Per-twin, per-channel fault-detection thresholds fit from the user's own diagnostic history (mean + k·sigma bands)", tag: ["thresholds", "diagnostics", "anomaly"] },
    { path: "/residual-thresholds", label: "Residual Thresholds", blurb: "Anomaly thresholds from the trained PBNN model's residual variance: mean ± k·sqrt(sigma2)", tag: ["residual", "pbnn", "anomaly"] },
    { path: "/arena-compare", label: "Arena Compare", blurb: "Pairwise statistical comparison between two arena rows: jaccard, length ratio, latency ratio, winner with confidence", tag: ["arena", "compare", "stats"] },
    { path: "/diagnostics", label: "Diagnostics", blurb: "FFT spectrum + bearing-fault panel", tag: ["fft", "twin"] },
    { path: "/twin-3d", label: "Twin Viewer 3D", blurb: "Wireframe digital-twin viewer with severity overlay", tag: ["3d", "twin", "wireframe"] },
    { path: "/world-model", label: "World Model", blurb: "What-if scenarios with trajectory sparklines (do nothing, derate, shutdown, cool+)", tag: ["world", "counterfactual", "simulate"] },
    { path: "/timeline", label: "Timeline", blurb: "Causal replay of diagnostic history for one asset", tag: ["timeline", "replay", "history"] },
    { path: "/demo", label: "WTG-04 Demo", blurb: "Deterministic signature anomaly walkthrough (10 cores, 14 steps)", tag: ["demo", "anomaly", "wtg-04"] },
    { path: "/warroom", label: "War Room", blurb: "Two-agent debate with judge + saved transcripts", tag: ["debate", "agent", "war"] },
    { path: "/admin", label: "Admin", blurb: "Payments, users, plans (admin key required)", tag: ["admin", "payment"] },
    { path: "/docs", label: "Docs", blurb: "User + developer documentation", tag: ["docs", "guide"] },
    { path: "/docs/start", label: "Docs: Getting started", blurb: "5-minute walkthrough", tag: ["docs", "guide", "start"] },
  ];
  for (const r of routes) {
    items.push({
      id: `route:${r.path}`,
      label: r.label,
      blurb: r.blurb,
      tag: "route",
      haystack: [r.path, r.label.toLowerCase(), r.blurb.toLowerCase(), ...(r.tag ?? []), ...r.path.split("/").filter(Boolean)],
      action: () => navigate(r.path),
    });
  }

  // 3. API quick-runs (the same endpoints the agent uses)
  const apis: { path: string; label: string; blurb: string; init?: RequestInit; tag?: string[] }[] = [
    { path: "/api/diagnostics", label: "GET /api/diagnostics", blurb: "FFT engine status (capabilities, limits)", tag: ["diagnostic", "fft", "status"] },
    { path: "/api/windturbine", label: "GET /api/windturbine", blurb: "List your wind-turbine twins", tag: ["twin", "wind", "scada"] },
    { path: "/api/twins", label: "GET /api/twins", blurb: "List all your digital twins", tag: ["twin"] },
    { path: "/api/learning", label: "GET /api/learning", blurb: "List PBNN learning pipelines", tag: ["learning", "pbnn"] },
    { path: "/api/symbolic", label: "GET /api/symbolic", blurb: "Neurosymbolic verifier status", tag: ["symbolic", "verify"] },
    { path: "/api/lab", label: "GET /api/lab", blurb: "Sandboxed self-modification lab status", tag: ["lab", "sandbox"] },
    { path: "/api/capabilities", label: "GET /api/capabilities", blurb: "List all capability cards (sources, statuses)", tag: ["capability", "registry"] },
    { path: "/api/mesh", label: "GET /api/mesh", blurb: "Provider mesh status (configured / ready / errors)", tag: ["mesh", "provider"] },
    { path: "/api/debate", label: "GET /api/debate", blurb: "List saved War Room debates (newest first)", tag: ["debate", "war", "history"] },
    { path: "/api/demo", label: "GET /api/demo", blurb: "DEMO mode status (enabled, seeded, pinned provider)", tag: ["demo", "status"] },
  ];
  for (const a of apis) {
    items.push({
      id: `api:${a.path}`,
      label: a.label,
      blurb: a.blurb,
      tag: "api",
      haystack: [a.path, a.label.toLowerCase(), a.blurb.toLowerCase(), ...(a.tag ?? [])],
      action: async () => {
        setBusy(a.label);
        try {
          const out = await callApi(a.path, a.init);
          setErr(null);
          // Show result in a JSON viewer; for now, log to console + alert snippet.
          // A real "results drawer" can be wired later.
          // eslint-disable-next-line no-console
          console.log(`[palette] ${a.path}:`, out);
          window.alert(`${a.label}\n\n${truncate(JSON.stringify(out, null, 2), 1800)}`);
        } finally {
          setBusy(null);
        }
      },
    });
  }

  // 4. Capability quick-look (read-only; opens a window.alert with the card)
  const capabilities: { id: string; label: string; blurb: string }[] = [
    { id: "diagnostics:fft", label: "FFT Diagnostics Engine", blurb: "Vibration + bearing signatures" },
    { id: "domain:wind-turbine", label: "Wind Turbine Asset Model", blurb: "Digital twin + 3-stage plan gate" },
    { id: "system:symbolic-verifier", label: "Neurosymbolic Verifier", blurb: "Plan verification with SI units" },
    { id: "device:edge", label: "Edge Hardware", blurb: "ESP32 binding (opt-in, physical grant)" },
    { id: "memory:pbnn", label: "Physics-Guided BNN", blurb: "Linear-Gaussian surrogate" },
    { id: "lab:run", label: "Lab Sandbox", blurb: "Compile + deploy scripts (opt-in, full_workspace)" },
  ];
  for (const c of capabilities) {
    items.push({
      id: `cap:${c.id}`,
      label: c.label,
      blurb: c.blurb,
      tag: "capability",
      haystack: [c.id, c.label.toLowerCase(), c.blurb.toLowerCase(), c.id.split(":")[0]],
      action: async () => {
        setBusy(`Fetching ${c.label}…`);
        try {
          const out = await callApi(`/api/capabilities/${encodeURIComponent(c.id)}`) as { card?: { id: string; name: string; description: string; tags?: string[]; verification_status?: string } } | undefined;
          if (out?.card) {
            const card = out.card;
            window.alert(`${card.name}  (${card.id})\n\n${card.description}\n\nStatus: ${card.verification_status ?? "?"}\nTags: ${(card.tags ?? []).join(", ")}`);
          } else {
            window.alert(`Capability ${c.id}: not found in the registry.`);
          }
        } finally {
          setBusy(null);
        }
      },
    });
  }

  return items;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + `\n…(truncated, ${s.length - n} more chars)`;
}

// --------------------------------------------------------------------------- fuzzy filter
//
// Pure, dependency-free scoring. Each character of the query must appear in
// the haystack in order; consecutive matches and matches at word starts
// score higher. Returns the top N items by score (>= 0.3 to be visible).
//
// Not a full fuzzy library (no typo correction, no multi-pattern, no
// weighting by IDF). That's deliberate — keeps the dep footprint at 0.

export function fuzzyScore(needle: string, haystack: string): number {
  const n = needle.toLowerCase();
  const h = haystack.toLowerCase();
  if (!n) return 1; // empty query matches everything with full score
  if (!h) return 0;
  // Find the best window of length >= n in h that contains n as a subsequence.
  let best = 0;
  let i = 0;
  let streak = 0;
  let streakBonus = 0;
  let wordStart = true;
  for (let k = 0; k < h.length && i < n.length; k++) {
    if (h[k] === n[i]) {
      streak = streak > 0 ? streak + 1 : 1;
      streakBonus += streak >= 2 ? 0.4 : 0;
      if (wordStart) streakBonus += 0.3;
      wordStart = false;
      i++;
    } else {
      streak = 0;
      wordStart = h[k] === " " || h[k] === "/" || h[k] === ":" || h[k] === "-" || h[k] === "_";
    }
  }
  if (i < n.length) return 0; // not all chars of needle found in order
  // base score: ratio of needle to haystack length (shorter haystack = better)
  best = (n.length / h.length) * 0.7 + streakBonus;
  return Math.min(1, best);
}

export function fuzzyFilter(items: PaletteItem[], query: string, topN: number): PaletteItem[] {
  const q = query.trim();
  const scored: { item: PaletteItem; score: number }[] = [];
  for (const it of items) {
    let best = 0;
    for (const h of it.haystack) {
      const s = fuzzyScore(q, h);
      if (s > best) best = s;
      if (best >= 0.99) break;
    }
    if (q === "" || best >= 0.3) scored.push({ item: it, score: best });
  }
  scored.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
  return scored.slice(0, topN).map((s) => s.item);
}
