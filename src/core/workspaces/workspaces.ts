/**
 * Workspaces (Phase 16/21) — a named scope that groups knowledge facts, memory, jobs, devices and
 * automations for one user. Persisted in the JSON store; the fabric/memory/jobs already accept a
 * `workspace` string, so a workspace is the durable record + counts over those scopes.
 * Status: IMPLEMENTED (single-user ownership; sharing between accounts NOT AVAILABLE).
 */
import { randomUUID } from "node:crypto";
import { store } from "@/lib/store";
import { listFacts } from "@/core/knowledge/fabric";
import { listJobs } from "@/core/agents/runtime";

const COL = "workspaces";
export const DEFAULT_WORKSPACE = "default";
export interface Workspace { id: string; uid: string; name: string; description?: string; tags: string[]; createdAt: number; updatedAt: number; archived?: boolean }

export async function listWorkspaces(uid: string): Promise<Workspace[]> {
  const all = Object.values(await store.all<Workspace>(COL)).filter((w) => w.uid === uid);
  if (!all.some((w) => w.id === `${uid}:${DEFAULT_WORKSPACE}`)) all.unshift(await ensureDefault(uid));
  return all.sort((a, b) => a.createdAt - b.createdAt);
}
export async function ensureDefault(uid: string): Promise<Workspace> {
  const id = `${uid}:${DEFAULT_WORKSPACE}`;
  return store.update<Workspace>(COL, id, (cur) => cur ?? { id, uid, name: "Default", tags: [], createdAt: Date.now(), updatedAt: Date.now() });
}
export async function createWorkspace(uid: string, input: { name: string; description?: string; tags?: string[] }): Promise<Workspace> {
  const name = input.name.trim().slice(0, 80); if (!name) throw new Error("name required");
  if ((await listWorkspaces(uid)).length >= 50) throw new Error("workspace limit (50) reached");
  const w: Workspace = { id: `${uid}:${randomUUID().slice(0, 8)}`, uid, name, description: input.description?.slice(0, 500), tags: (input.tags ?? []).slice(0, 10), createdAt: Date.now(), updatedAt: Date.now() };
  await store.set(COL, w.id, w); return w;
}
export async function getWorkspace(uid: string, id: string) { const w = await store.get<Workspace>(COL, id); return w && w.uid === uid ? w : undefined; }
export async function updateWorkspace(uid: string, id: string, patch: Partial<Pick<Workspace, "name" | "description" | "tags" | "archived">>) {
  const w = await getWorkspace(uid, id); if (!w) return undefined;
  return store.update<Workspace>(COL, id, (cur) => ({ ...(cur as Workspace), ...patch, name: (patch.name ?? cur!.name).trim().slice(0, 80) || cur!.name, updatedAt: Date.now() }));
}
export async function deleteWorkspace(uid: string, id: string) { const w = await getWorkspace(uid, id); if (!w || id.endsWith(`:${DEFAULT_WORKSPACE}`)) return false; await store.remove(COL, id); return true; }
/** Scope key used by fabric/memory/jobs for this workspace (short id after the uid prefix). */
export const scopeOf = (w: Workspace) => w.id.split(":").slice(1).join(":");
/** Counts of what lives inside a workspace — computed, never estimated. */
export async function workspaceStats(uid: string, w: Workspace) {
  const scope = scopeOf(w);
  const [facts, jobs] = await Promise.all([listFacts(uid, scope, 1000), listJobs(uid, 500)]);
  const inScope = jobs.filter((j) => (j as { workspace?: string }).workspace === scope);
  return { scope, facts: facts.length, memories: facts.filter((f) => f.tags.some((t) => t.startsWith("memory:"))).length, jobs: inScope.length, runningJobs: inScope.filter((j) => j.status === "running").length };
}
