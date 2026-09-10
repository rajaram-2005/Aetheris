/**
 * Diagnostics page — server-rendered FFT spectrum + bearing-fault panel.
 *
 *   URL: /diagnostics?twinId=<id>&injectBearingFault=1
 *
 *   This page renders without client-side JavaScript:
 *     - The list of wind-turbine twins owned by the calling user.
 *     - A spectrum SVG (frequency vs magnitude) from the latest diagnostic.
 *     - Top peaks + bearing-fault matches.
 *     - Severity badge (ok / watch / warning / critical).
 *     - A trend summary (latest peak magnitude, SMA, slope, alarm).
 *     - A history sparkline of peak magnitudes.
 *
 *   The data comes from the same /api/diagnostics endpoint used by the agent
 *   and the CLI, so there is no separate "UI model" to keep in sync.
 */
import { headers } from "next/headers";
import Link from "next/link";
import { getUserId, uidCookie } from "@/lib/user";
import { listTwins } from "@/core/twins/twins";
import { diagnoseTwin } from "@/core/diagnostics/integration";
import type { DiagnosticResult } from "@/core/diagnostics/engine";
import { getHistory, getTrend, type DiagnosticHistoryEntry, type TrendReport } from "@/core/diagnostics/history";
import { bearingFaultFrequencies } from "@/core/diagnostics/fft";
import { getTwin } from "@/core/twins/twins";
import type { Twin } from "@/core/twins/twins";
import { renderSpectrumSvg, renderSparkline } from "./svg";

type TwinDiagnostic = DiagnosticResult & { sample: number[]; sampleRateHz: number; rotorRpm: number; channel: string };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEVERITY_COLORS: Record<string, string> = {
  ok: "#4ade80",
  watch: "#facc15",
  warning: "#fb923c",
  critical: "#f87171",
};

const SEVERITY_DESCRIPTIONS: Record<string, string> = {
  ok: "Within normal limits. Continue routine monitoring.",
  watch: "Slightly elevated. Plan re-check at next maintenance window.",
  warning: "Above ISO 10816 warning threshold. Inspect at next opportunity.",
  critical: "Above ISO 10816 critical threshold. Schedule maintenance immediately.",
};

interface PageData {
  uid: string;
  isNew: boolean;
  twins: { id: string; name: string }[];
  selected: { id: string; name: string } | null;
  diagnostic: TwinDiagnostic | null;
  trend: TrendReport | null;
  history: DiagnosticHistoryEntry[];
  fault: ReturnType<typeof bearingFaultFrequencies>;
  injectBearingFault: boolean;
  error: string | null;
}

async function loadPageData(twinId: string | null, injectBearingFault: boolean): Promise<PageData> {
  const { uid, isNew } = await getUserId();
  const twins = (await listTwins(uid)).filter((t) => t.kind === "wind-turbine");
  const selected = twins.find((t) => t.id === twinId) ?? null;
  let diagnostic: TwinDiagnostic | null = null;
  let trend: PageData["trend"] = null;
  let history: DiagnosticHistoryEntry[] = [];
  let error: string | null = null;
  if (selected) {
    try {
      const twin: Twin | undefined = await getTwin(selected.id);
      if (!twin || twin.uid !== uid) {
        error = "twin not found";
      } else {
        diagnostic = diagnoseTwin(twin, { sampleRateHz: 256, durationSec: 10, rotorRpm: 1500, injectBearingFault, anomalyScore: 0.2 });
        history = await getHistory(selected.id, { limit: 50 });
        trend = await getTrend(selected.id, { windowMs: 24 * 3600 * 1000, maxEntries: 50 });
      }
    } catch (e) {
      error = (e as Error).message;
    }
  }
  return { uid, isNew, twins: twins.map((t) => ({ id: t.id, name: t.name })), selected: selected ? { id: selected.id, name: selected.name } : null, diagnostic, trend, history, fault: bearingFaultFrequencies(1500), injectBearingFault, error };
}

export default async function DiagnosticsPage({ searchParams }: { searchParams: Promise<{ twinId?: string; injectBearingFault?: string }> }) {
  const sp = await searchParams;
  const twinId = sp.twinId ?? null;
  const injectBearingFault = sp.injectBearingFault === "1";
  const data = await loadPageData(twinId, injectBearingFault);
  // Set the cookie on first load (server-side).
  if (data.isNew) {
    try { (await headers()).get("cookie")?.includes(uidCookie(data.uid).name) || ""; } catch { /* ignore */ }
  }
  return (
    <div className="diag-page">
      <header className="diag-header">
        <Link href="/" className="brand">✦ Aetheris <span className="hint">diagnostics</span></Link>
        <span className="hint">vibration FFT · bearing-fault matcher · trend</span>
      </header>
      {data.error ? <div className="diag-error">⚠ {data.error}</div> : null}
      <div className="diag-grid">
        <aside className="diag-sidebar">
          <h2>Turbines</h2>
          {data.twins.length === 0 ? (
            <p className="hint">No wind-turbine twins yet. Create one with <code>POST /api/windturbine op:canon</code>.</p>
          ) : (
            <ul>
              {data.twins.map((t) => (
                <li key={t.id}>
                  <a href={`/diagnostics?twinId=${encodeURIComponent(t.id)}${data.injectBearingFault ? "&injectBearingFault=1" : ""}`} className={data.selected?.id === t.id ? "on" : ""}>
                    {t.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {data.selected ? (
            <form method="get" className="diag-form">
              <input type="hidden" name="twinId" value={data.selected.id} />
              <label>
                <input type="checkbox" name="injectBearingFault" value="1" defaultChecked={data.injectBearingFault} />
                {" "}Inject synthetic bearing fault
              </label>
              <button type="submit">Refresh</button>
            </form>
          ) : null}
        </aside>
        <main className="diag-main">
          {data.diagnostic ? (
            <DiagnosticPanel d={data.diagnostic} trend={data.trend} history={data.history} fault={data.fault} />
          ) : (
            <div className="diag-empty">
              <h2>Select a turbine to run a diagnostic</h2>
              <p className="hint">The engine will run the simulator for 10 s at 256 Hz, FFT the result, and match against BPFO/BPFI/BSF/FTF.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function DiagnosticPanel({ d, trend, history, fault }: { d: TwinDiagnostic; trend: TrendReport | null; history: DiagnosticHistoryEntry[]; fault: ReturnType<typeof bearingFaultFrequencies> }) {
  const severity = d.severity;
  const color = SEVERITY_COLORS[severity] ?? "#94a3b8";
  const description = SEVERITY_DESCRIPTIONS[severity] ?? "";
  // Use the envelope spectrum if present (much better resolution for faults);
  // otherwise the raw spectrum.
  const useEnvelope = !!d.envelope;
  const spectrum = useEnvelope ? d.envelope!.spectrum : d.spectrum;
  return (
    <div>
      <div className="diag-headline">
        <h2>Diagnostic for {d.sample.length.toLocaleString()} samples at {d.sampleRateHz} Hz</h2>
        <span className="diag-severity" style={{ background: color }}>{severity}</span>
      </div>
      <p className="diag-summary">{description}</p>
      <div className="diag-grid-inner">
        <section className="diag-card">
          <h3>Magnitude spectrum{useEnvelope ? " (envelope)" : ""}</h3>
          <SpectrumSVG spectrum={spectrum} fault={fault} />
        </section>
        <section className="diag-card">
          <h3>Top peaks</h3>
          {d.peaks.length === 0 ? <p className="hint">No peaks.</p> : (
            <table className="diag-table">
              <thead><tr><th>Freq (Hz)</th><th>Mag</th></tr></thead>
              <tbody>
                {d.peaks.map((p, i) => (
                  <tr key={i}>
                    <td>{p.frequency.toFixed(2)}</td>
                    <td>{p.magnitude.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="diag-card">
          <h3>Bearing-fault matches</h3>
          {d.matches.length === 0 ? <p className="hint">No bearing signature matched.</p> : (
            <table className="diag-table">
              <thead><tr><th>Fault</th><th>Expected</th><th>Measured</th><th>Δ (Hz)</th><th>Mag</th></tr></thead>
              <tbody>
                {d.matches.map((m, i) => (
                  <tr key={i} className={m.fault === d.matches[0].fault ? "diag-row-top" : ""}>
                    <td>{m.fault}</td>
                    <td>{m.expectedHz.toFixed(2)}</td>
                    <td>{m.measuredHz.toFixed(2)}</td>
                    <td>{m.distance.toFixed(3)}</td>
                    <td>{m.magnitude.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="diag-card">
          <h3>Trend (last 24 h)</h3>
          {trend && trend.n > 0 ? (
            <div>
              <div className="diag-row">
                <span>Latest</span>
                <b>{trend.latest.peakMagnitude.toFixed(3)}</b>
                <span className="hint">mm/s</span>
              </div>
              <div className="diag-row">
                <span>24h SMA</span>
                <b>{trend.peakMagnitudeSMA.toFixed(3)}</b>
                <span className="hint">mm/s</span>
              </div>
              <div className="diag-row">
                <span>Slope</span>
                <b>{(trend.peakSlopePerSec * 86400).toFixed(4)}</b>
                <span className="hint">mm/s/day</span>
              </div>
              <div className="diag-row">
                <span>Alarm</span>
                <b style={{ color: trend.alarm === "rising" ? "#f87171" : trend.alarm === "falling" ? "#4ade80" : "#94a3b8" }}>{trend.alarm}</b>
              </div>
              <Sparkline history={history} />
            </div>
          ) : <p className="hint">No history yet. Run the diagnostic a few times to build a trend.</p>}
        </section>
        <section className="diag-card">
          <h3>Evidence</h3>
          <ul className="diag-evidence">
            {d.evidence.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </section>
      </div>
    </div>
  );
}

function SpectrumSVG({ spectrum, fault }: { spectrum: TwinDiagnostic["spectrum"] | NonNullable<TwinDiagnostic["envelope"]>["spectrum"]; fault: ReturnType<typeof bearingFaultFrequencies> }) {
  // Server-render via dangerouslySetInnerHTML. The svg generator is in svg.ts
  // so it can be unit-tested without Next.js.
  const html = renderSpectrumSvg(spectrum, fault);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

function Sparkline({ history }: { history: DiagnosticHistoryEntry[] }) {
  if (history.length < 2) return null;
  const values = history.slice().reverse().map((h) => h.peakMagnitude);
  const html = renderSparkline(values);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}
