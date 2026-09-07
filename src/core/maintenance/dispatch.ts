/**
 * Maintenance Dispatch.
 *
 *   A small recommendation engine that turns a twin's state into
 *   a prioritised dispatch list. Every recommendation is
 *   grounded in the actual production data — overdue maintenance
 *   entries, recent diagnostics, bound breaches, the diagnostic
 *   history. The engine never invents a maintenance task; it
 *   only composes the ones the user has already declared.
 *
 *   The output is sorted by priority: CRITICAL first (active
 *   critical breach + critical diagnostic), then HIGH (overdue
 *   + critical diagnostic), then MEDIUM (overdue only), then
 *   LOW (informational). Each row carries the exact reasoning
 *   the user can audit.
 */

import { getHistory } from "@/core/diagnostics/history";
import { listTwins, twinHealth, type Twin } from "@/core/twins/twins";

export type DispatchPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface DispatchRow {
  twinId: string;
  twinName: string;
  priority: DispatchPriority;
  /** Human-readable action. */
  action: string;
  /** Why this priority. */
  reason: string;
  /** Related maintenance note, if any. */
  maintenanceNote: string | null;
  /** Related last diagnostic. */
  lastDiagnostic: { severity: string; peakMagnitude: number; topFault: string | null; tMs: number } | null;
  /** Number of bound breaches, total and critical. */
  boundBreaches: { total: number; critical: number };
  /** Overdue maintenance count. */
  overdueCount: number;
  /** ms until the next-due maintenance, if any. Negative = overdue. */
  nextDueIn: number | null;
}

export interface DispatchList {
  uid: string;
  total: number;
  byPriority: Record<DispatchPriority, number>;
  rows: DispatchRow[];
  generatedAt: number;
}

function priorityFor(twin: Twin, lastSev: string | undefined, overdueCount: number, criticalBreaches: number): { priority: DispatchPriority; reason: string } {
  if (criticalBreaches > 0 && lastSev === "critical") return { priority: "CRITICAL", reason: `critical breach + last diagnostic severity=critical` };
  if (criticalBreaches > 0) return { priority: "HIGH", reason: `critical bound breach` };
  if (overdueCount > 0 && lastSev === "critical") return { priority: "HIGH", reason: `overdue maintenance (${overdueCount}) + last diagnostic severity=critical` };
  if (overdueCount > 0) return { priority: "MEDIUM", reason: `overdue maintenance (${overdueCount})` };
  if (lastSev === "critical" || lastSev === "warning") return { priority: "MEDIUM", reason: `last diagnostic severity=${lastSev}` };
  return { priority: "LOW", reason: `no active issues` };
}

function actionFor(priority: DispatchPriority, overdueCount: number, lastSev: string | undefined): string {
  if (priority === "CRITICAL") return "DISPATCH ON-CALL TEAM · bring the asset to a safe state";
  if (priority === "HIGH") return overdueCount > 0 ? "DISPATCH MAINTENANCE · investigate within 24 h" : "DISPATCH ENGINEER · inspect within 24 h";
  if (priority === "MEDIUM") return overdueCount > 0 ? "SCHEDULE MAINTENANCE · within 7 days" : "INSPECT · within 7 days";
  return "MONITOR · no action needed";
}

async function buildRow(twin: Twin): Promise<DispatchRow> {
  const h = twinHealth(twin);
  const history = await getHistory(twin.id, { limit: 1 });
  const last = history[0] ?? null;
  const { priority, reason } = priorityFor(twin, last?.severity, h.overdueMaintenance.length, h.breaches.filter((b) => b.critical).length);
  const nextDue = twin.maintenance
    .filter((m) => m.nextDue)
    .map((m) => m.nextDue!)
    .sort((a, b) => a - b)[0];
  return {
    twinId: twin.id,
    twinName: twin.name,
    priority,
    action: actionFor(priority, h.overdueMaintenance.length, last?.severity),
    reason,
    maintenanceNote: h.overdueMaintenance[0]?.note ?? null,
    lastDiagnostic: last ? { severity: last.severity, peakMagnitude: last.peakMagnitude, topFault: last.topFault, tMs: last.tMs } : null,
    boundBreaches: { total: h.breaches.length, critical: h.breaches.filter((b) => b.critical).length },
    overdueCount: h.overdueMaintenance.length,
    nextDueIn: nextDue ? nextDue - Date.now() : null,
  };
}

export async function dispatchList(uid: string): Promise<DispatchList> {
  const twins = await listTwins(uid);
  const rows = await Promise.all(twins.map(buildRow));
  const byPriority: Record<DispatchPriority, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  const order: Record<DispatchPriority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  rows.sort((a, b) => order[a.priority] - order[b.priority]);
  for (const r of rows) byPriority[r.priority]++;
  return { uid, total: rows.length, byPriority, rows, generatedAt: Date.now() };
}
