/**
 * Audit Export.
 *
 *   A read-side composer that turns the production
 *   observability event log into an exportable audit bundle.
 *   Two formats: JSON (full event objects, machine-readable)
 *   and CSV (one row per event, summary fields, spreadsheet-
 *   friendly).
 *
 *   The export is filtered to the user's uid (and only events
 *   the user is allowed to see). The output is identical
 *   to what the production query() returns — no fabrication,
 *   no transformation, just a different rendering.
 */

import { query, type AetherisEvent, type EventType } from "@/core/observability/events";

export interface AuditExportJson {
  format: "json";
  uid: string;
  total: number;
  events: AetherisEvent[];
  exportedAt: number;
}

export interface AuditExportCsv {
  format: "csv";
  uid: string;
  total: number;
  headers: string[];
  rows: string[][];
  exportedAt: number;
}

export type AuditExport = AuditExportJson | AuditExportCsv;

export function exportJson(uid: string, opts: { type?: EventType; sinceMs?: number; limit?: number; okOnly?: boolean } = {}): AuditExportJson {
  // We pull a wide window and filter on our end so okOnly has
  // the right semantics (the production query() inverts the
  // okOnly flag, so we can't trust it).
  const window = Math.max(1000, (opts.limit ?? 1000) * 4);
  let events = query({ uid, type: opts.type, since: opts.sinceMs, limit: window });
  if (opts.okOnly) events = events.filter((e) => e.ok);
  events = events.slice(0, opts.limit ?? 100);
  return { format: "json", uid, total: events.length, events, exportedAt: Date.now() };
}

const CSV_HEADERS = ["id", "at", "type", "uid", "capability", "ok", "ms", "detail"];

function csvCell(s: string): string {
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function exportCsv(uid: string, opts: { type?: EventType; sinceMs?: number; limit?: number; okOnly?: boolean } = {}): AuditExportCsv {
  const window = Math.max(1000, (opts.limit ?? 1000) * 4);
  let events = query({ uid, type: opts.type, since: opts.sinceMs, limit: window });
  if (opts.okOnly) events = events.filter((e) => e.ok);
  events = events.slice(0, opts.limit ?? 100);
  const rows = events.map((e) => [
    e.id, String(e.at), e.type, e.uid ?? "", e.capability ?? "", e.ok ? "true" : "false", e.ms === undefined ? "" : String(e.ms), e.detail ?? "",
  ]);
  return { format: "csv", uid, total: events.length, headers: CSV_HEADERS, rows, exportedAt: Date.now() };
}

export function toCsvString(c: AuditExportCsv): string {
  const lines = [c.headers.map(csvCell).join(",")];
  for (const r of c.rows) lines.push(r.map(csvCell).join(","));
  return lines.join("\n") + "\n";
}
