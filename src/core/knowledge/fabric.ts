/**
 * Knowledge Fabric (Phase 8) — hybrid retrieval over one SQLite file (node:sqlite, zero deps):
 *
 *   keyword   FTS5 (BM25)                       facts_fts
 *   vector    cosine over embeddings             facts.vec      (local hashed n-gram embedding by default;
 *                                                                provider embeddings when EMBEDDINGS_URL/KEY set)
 *   graph     entity/relation triples            edges          with provenance per edge
 *   temporal  valid_from / valid_to / observed   facts          point-in-time queries, supersession
 *
 * Every fact carries provenance (source kind, ref, confidence, who/when) and a workspace scope.
 * Status: IMPLEMENTED (local embedding is a lexical hashing model — honest: it captures word overlap,
 * not semantics; plug a real embedding endpoint via env for semantic vectors).
 */
import path from "node:path";
import { mkdirSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { record } from "../observability/events";

export type SourceKind = "user" | "document" | "web" | "agent" | "device" | "github" | "research" | "memory" | "import";
export interface Provenance { kind: SourceKind; ref?: string; confidence: number; by?: string; at: number }
export interface Fact {
  id: string; uid: string; workspace: string; text: string; entities: string[]; tags: string[];
  validFrom?: number; validTo?: number; supersedes?: string; provenance: Provenance; createdAt: number;
}
export interface Edge { id: string; uid: string; workspace: string; src: string; rel: string; dst: string; factId?: string; weight: number; provenance: Provenance }
export interface Hit { fact: Fact; score: number; via: ("keyword" | "vector" | "graph" | "temporal")[] }
export interface QueryOpts { workspace?: string; k?: number; asOf?: number; entity?: string; tags?: string[]; mode?: "hybrid" | "keyword" | "vector" | "graph" }

const DIM = 256;
const DIR = process.env.AETHERIS_DATA_DIR ?? path.join(process.cwd(), "data");

// ---- embeddings ---------------------------------------------------------------------------------
const tok = (s: string) => s.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [];
/** Deterministic hashed word + bigram embedding. Free, offline, language-agnostic. */
export function localEmbed(text: string): Float32Array {
  const v = new Float32Array(DIM); const t = tok(text);
  const bump = (g: string, w: number) => { const h = createHash("md5").update(g).digest(); const i = h.readUInt16LE(0) % DIM; v[i] += (h[2] & 1 ? 1 : -1) * w; };
  t.forEach((w, i) => { bump(w, 1); if (i) bump(`${t[i - 1]}_${w}`, 0.6); if (w.length > 5) for (let j = 0; j + 4 <= w.length; j++) bump(`#${w.slice(j, j + 4)}`, 0.25); });
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; for (let i = 0; i < DIM; i++) v[i] /= n; return v;
}
export const cosine = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length && i < b.length; i++) s += a[i] * b[i]; return s; };
let embedMode: "local" | "provider" = "local";
async function embed(text: string): Promise<Float32Array> {
  const url = process.env.EMBEDDINGS_URL, key = process.env.EMBEDDINGS_KEY, model = process.env.EMBEDDINGS_MODEL ?? "text-embedding-3-small";
  if (url && key) {
    try {
      const r = await fetch(url.replace(/\/$/, "") + "/embeddings", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ model, input: text.slice(0, 8000) }), signal: AbortSignal.timeout(15_000) });
      if (r.ok) { const j = (await r.json()) as { data: { embedding: number[] }[] }; embedMode = "provider"; return Float32Array.from(j.data[0].embedding); }
    } catch { /* fall back to local */ }
  }
  embedMode = "local"; return localEmbed(text);
}

// ---- storage ------------------------------------------------------------------------------------
interface Db { exec(sql: string): void; prepare(sql: string): { run(...a: unknown[]): unknown; all(...a: unknown[]): Record<string, unknown>[]; get(...a: unknown[]): Record<string, unknown> | undefined } }
let db: Db | undefined; let dbErr: string | undefined;
async function open(): Promise<Db> {
  if (db) return db; if (dbErr) throw new Error(dbErr);
  try {
    const { DatabaseSync } = (await import("node:sqlite")) as unknown as { DatabaseSync: new (p: string) => Db };
    mkdirSync(DIR, { recursive: true });
    const d = new DatabaseSync(process.env.AETHERIS_KNOWLEDGE_DB ?? path.join(DIR, "knowledge.sqlite"));
    d.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS facts(id TEXT PRIMARY KEY, uid TEXT, workspace TEXT, text TEXT, entities TEXT, tags TEXT, valid_from INTEGER, valid_to INTEGER, supersedes TEXT, prov TEXT, created_at INTEGER, vec BLOB, vec_dim INTEGER);
      CREATE INDEX IF NOT EXISTS facts_uw ON facts(uid, workspace);
      CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(id UNINDEXED, text, entities, tags);
      CREATE TABLE IF NOT EXISTS edges(id TEXT PRIMARY KEY, uid TEXT, workspace TEXT, src TEXT, rel TEXT, dst TEXT, fact_id TEXT, weight REAL, prov TEXT);
      CREATE INDEX IF NOT EXISTS edges_src ON edges(uid, src); CREATE INDEX IF NOT EXISTS edges_dst ON edges(uid, dst);`);
    db = d; return d;
  } catch (e) { dbErr = `knowledge fabric unavailable: ${(e as Error).message}`; throw new Error(dbErr); }
}
const rowToFact = (r: Record<string, unknown>): Fact => ({ id: r.id as string, uid: r.uid as string, workspace: r.workspace as string, text: r.text as string, entities: JSON.parse(r.entities as string), tags: JSON.parse(r.tags as string), validFrom: (r.valid_from as number) ?? undefined, validTo: (r.valid_to as number) ?? undefined, supersedes: (r.supersedes as string) ?? undefined, provenance: JSON.parse(r.prov as string), createdAt: r.created_at as number });
const vecOf = (r: Record<string, unknown>) => new Float32Array(new Uint8Array(r.vec as Uint8Array).buffer.slice(0));

/** Naive entity extraction: Capitalised spans, @handles, #tags, code identifiers, quoted terms. Pure; tested. */
export function extractEntities(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z][\w-]+(?:\s+[A-Z][\w-]+){0,3})\b/g)) if (m[1].length > 2) out.add(m[1]);
  for (const m of text.matchAll(/[@#]([\w-]{2,})/g)) out.add(m[1]);
  for (const m of text.matchAll(/`([^`]{2,40})`/g)) out.add(m[1]);
  for (const m of text.matchAll(/"([^"]{3,40})"/g)) out.add(m[1]);
  return [...out].slice(0, 16);
}
/** Extract (subject, relation, object) triples from simple "X <verb> Y" sentences. Heuristic; tested. */
export function extractTriples(text: string, entities: string[]): { src: string; rel: string; dst: string }[] {
  const t: { src: string; rel: string; dst: string }[] = [];
  const rels = ["is a", "is an", "is", "uses", "owns", "works at", "works on", "built", "created", "depends on", "part of", "located in", "runs on", "prefers", "likes", "manages", "reports to", "connected to", "controls", "measures"];
  for (const s of entities) for (const o of entities) {
    if (s === o) continue;
    for (const r of rels) { const re = new RegExp(`${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(?:\\w+\\s+){0,2}?${r}\\s+(?:\\w+\\s+){0,2}?${o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"); if (re.test(text)) { t.push({ src: s, rel: r.replace(/\s+/g, "_"), dst: o }); break; } }
  }
  return t.slice(0, 24);
}

export async function addFact(input: { uid: string; workspace?: string; text: string; tags?: string[]; entities?: string[]; validFrom?: number; validTo?: number; supersedes?: string; provenance: Omit<Provenance, "at"> & { at?: number }; edges?: { src: string; rel: string; dst: string; weight?: number }[] }): Promise<Fact> {
  const d = await open(); const t0 = Date.now();
  const text = input.text.trim().slice(0, 4000); if (!text) throw new Error("empty fact");
  const entities = input.entities ?? extractEntities(text);
  const f: Fact = { id: randomBytes(6).toString("hex"), uid: input.uid, workspace: input.workspace ?? "default", text, entities, tags: input.tags ?? [], validFrom: input.validFrom ?? (input.supersedes ? Date.now() : undefined), validTo: input.validTo, supersedes: input.supersedes, provenance: { ...input.provenance, at: input.provenance.at ?? Date.now(), confidence: Math.max(0, Math.min(1, input.provenance.confidence)) }, createdAt: Date.now() };
  const vec = await embed(text);
  d.prepare("INSERT INTO facts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(f.id, f.uid, f.workspace, f.text, JSON.stringify(f.entities), JSON.stringify(f.tags), f.validFrom ?? null, f.validTo ?? null, f.supersedes ?? null, JSON.stringify(f.provenance), f.createdAt, new Uint8Array(vec.buffer), vec.length);
  d.prepare("INSERT INTO facts_fts(id,text,entities,tags) VALUES(?,?,?,?)").run(f.id, f.text, f.entities.join(" "), f.tags.join(" "));
  if (f.supersedes) d.prepare("UPDATE facts SET valid_to=COALESCE(valid_to,?) WHERE id=? AND uid=?").run(f.createdAt, f.supersedes, f.uid);
  const edges: { src: string; rel: string; dst: string; weight?: number }[] = input.edges ?? extractTriples(text, entities);
  const ins = d.prepare("INSERT INTO edges VALUES(?,?,?,?,?,?,?,?,?)");
  for (const e of edges) ins.run(randomBytes(6).toString("hex"), f.uid, f.workspace, e.src, e.rel, e.dst, f.id, e.weight ?? f.provenance.confidence, JSON.stringify(f.provenance));
  record({ type: "knowledge", uid: f.uid, capability: "knowledge:add", ok: true, ms: Date.now() - t0, detail: `${entities.length} entities · ${edges.length} edges · ${embedMode} embed` });
  return f;
}

export async function getFact(uid: string, id: string): Promise<Fact | undefined> { const r = (await open()).prepare("SELECT * FROM facts WHERE id=? AND uid=?").get(id, uid); return r ? rowToFact(r) : undefined; }
export async function deleteFact(uid: string, id: string): Promise<boolean> { const d = await open(); const r = d.prepare("DELETE FROM facts WHERE id=? AND uid=?").run(id, uid) as { changes: number }; d.prepare("DELETE FROM facts_fts WHERE id=?").run(id); d.prepare("DELETE FROM edges WHERE fact_id=? AND uid=?").run(id, uid); return r.changes > 0; }
export async function listFacts(uid: string, workspace?: string, limit = 100): Promise<Fact[]> { return (await open()).prepare(`SELECT * FROM facts WHERE uid=? ${workspace ? "AND workspace=?" : ""} ORDER BY created_at DESC LIMIT ?`).all(...(workspace ? [uid, workspace, limit] : [uid, limit])).map(rowToFact); }

export async function neighbors(uid: string, entity: string, depth = 1, workspace?: string): Promise<{ nodes: string[]; edges: Edge[] }> {
  const d = await open(); const seen = new Set<string>([entity]); let frontier = [entity]; const edges: Edge[] = []; const ids = new Set<string>();
  for (let i = 0; i < depth && frontier.length; i++) {
    const next: string[] = [];
    for (const n of frontier) {
      const rows = d.prepare(`SELECT * FROM edges WHERE uid=? AND (src=? COLLATE NOCASE OR dst=? COLLATE NOCASE) ${workspace ? "AND workspace=?" : ""} LIMIT 200`).all(...(workspace ? [uid, n, n, workspace] : [uid, n, n]));
      for (const r of rows) { if (ids.has(r.id as string)) continue; ids.add(r.id as string); const e: Edge = { id: r.id as string, uid, workspace: r.workspace as string, src: r.src as string, rel: r.rel as string, dst: r.dst as string, factId: (r.fact_id as string) ?? undefined, weight: r.weight as number, provenance: JSON.parse(r.prov as string) }; edges.push(e); for (const x of [e.src, e.dst]) if (!seen.has(x)) { seen.add(x); next.push(x); } }
    }
    frontier = next;
  }
  return { nodes: [...seen], edges };
}

/** Hybrid query: reciprocal-rank fusion of keyword + vector (+ graph expansion), filtered by time. */
export async function queryFacts(uid: string, q: string, opts: QueryOpts = {}): Promise<Hit[]> {
  const d = await open(); const t0 = Date.now(); const k = opts.k ?? 8; const mode = opts.mode ?? "hybrid"; const ws = opts.workspace;
  const time = opts.asOf ? " AND (valid_from IS NULL OR valid_from<=?) AND (valid_to IS NULL OR valid_to>?)" : ""; const timeArgs = opts.asOf ? [opts.asOf, opts.asOf] : [];
  const scoped = (extra = "") => `f.uid=? ${ws ? "AND f.workspace=?" : ""}${time}${extra}`; const scopedArgs = (...a: unknown[]) => [uid, ...(ws ? [ws] : []), ...timeArgs, ...a];
  const ranks = new Map<string, { fact: Fact; s: number; via: Set<Hit["via"][number]> }>();
  const add = (f: Fact, rank: number, via: Hit["via"][number], w = 1) => { const cur = ranks.get(f.id) ?? { fact: f, s: 0, via: new Set() }; cur.s += w / (60 + rank); cur.via.add(via); if (opts.asOf) cur.via.add("temporal"); ranks.set(f.id, cur); };
  const ftsQ = tok(q).map((w) => `"${w.replace(/"/g, "")}"`).join(" OR ");
  if (ftsQ && (mode === "hybrid" || mode === "keyword")) {
    try { d.prepare(`SELECT f.*, bm25(facts_fts) AS r FROM facts_fts JOIN facts f ON f.id=facts_fts.id WHERE facts_fts MATCH ? AND ${scoped()} ORDER BY r LIMIT ?`).all(ftsQ, ...scopedArgs(k * 3)).forEach((r, i) => add(rowToFact(r), i, "keyword")); } catch { /* malformed FTS query */ }
  }
  if (mode === "hybrid" || mode === "vector") {
    const qv = await embed(q);
    d.prepare(`SELECT f.* FROM facts f WHERE ${scoped()} ORDER BY created_at DESC LIMIT 5000`).all(...scopedArgs()).map((r) => ({ f: rowToFact(r), c: cosine(qv, vecOf(r)) })).filter((x) => x.c > 0.08).sort((a, b) => b.c - a.c).slice(0, k * 3).forEach((x, i) => add(x.f, i, "vector"));
  }
  if (mode === "hybrid" || mode === "graph") {
    const ents = opts.entity ? [opts.entity] : extractEntities(q).concat(tok(q).filter((w) => w.length > 3)).slice(0, 6);
    const fids = new Set<string>();
    for (const e of ents) for (const ed of (await neighbors(uid, e, 1, ws)).edges) if (ed.factId) fids.add(ed.factId);
    [...fids].slice(0, k * 2).forEach((id, i) => { const r = d.prepare(`SELECT f.* FROM facts f WHERE f.id=? AND ${scoped()}`).get(id, ...scopedArgs()); if (r) add(rowToFact(r), i, "graph", 0.7); });
  }
  let hits = [...ranks.values()].map((x) => ({ fact: x.fact, score: x.s * (0.5 + 0.5 * x.fact.provenance.confidence), via: [...x.via] }));
  if (opts.tags?.length) hits = hits.filter((h) => opts.tags!.every((t) => h.fact.tags.includes(t)));
  hits.sort((a, b) => b.score - a.score); hits = hits.slice(0, k);
  record({ type: "knowledge", uid, capability: "knowledge:query", ok: true, ms: Date.now() - t0, detail: `${mode} · ${hits.length} hits` });
  return hits;
}

export async function fabricStatus() {
  try { const d = await open(); const c = d.prepare("SELECT (SELECT COUNT(*) FROM facts) AS facts, (SELECT COUNT(*) FROM edges) AS edges").get()!; return { available: true, engine: "node:sqlite + FTS5", embeddings: process.env.EMBEDDINGS_URL ? "provider (EMBEDDINGS_URL)" : "local hashed n-gram (lexical, not semantic)", facts: c.facts as number, edges: c.edges as number, dim: DIM }; }
  catch (e) { return { available: false, error: (e as Error).message }; }
}
/** Render hits as a grounding block with numbered provenance for prompts. */
export function knowledgeBlock(hits: Hit[], budget = 6000): string {
  let out = "", n = 0; for (const h of hits) { const line = `[K${++n}] ${h.fact.text} (source: ${h.fact.provenance.kind}${h.fact.provenance.ref ? " " + h.fact.provenance.ref : ""}, confidence ${h.fact.provenance.confidence.toFixed(2)}${h.fact.validTo ? ", superseded" : ""})\n`; if (out.length + line.length > budget) break; out += line; }
  return out ? `Knowledge fabric (cite as [K#]):\n${out}` : "";
}
