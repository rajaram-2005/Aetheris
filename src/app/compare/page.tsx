/**
 * /compare — Asset Comparison page.
 *
 *   Side-by-side comparison of two digital twins. Both sides show
 *   live state, last diagnostic, history sparkline, health score,
 *   BPFO expectation at the configured rotor rpm, and a
 *   "are they the same?" verdict at the bottom.
 *
 *   URL: /compare?a=…&b=…&rotorRpm=…
 */
import { compareAssets, sparklinePath, type AssetSnapshot } from "@/core/compare/assets";
import { listTwins } from "@/core/twins/twins";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function StateRow({ label, a, b, fmt }: { label: string; a: number | null; b: number | null; fmt: (n: number) => string }) {
  return (
    <tr>
      <td className="cmp-label">{label}</td>
      <td className="cmp-val">{a === null ? "—" : fmt(a)}</td>
      <td className="cmp-val">{b === null ? "—" : fmt(b)}</td>
    </tr>
  );
}

function Card({ label, s, accent }: { label: string; s: AssetSnapshot | null; accent: string }) {
  const healthColor = !s ? "var(--muted)" : s.health > 80 ? "#4ade80" : s.health > 50 ? "#facc15" : "#f87171";
  return (
    <div className="cmp-card" style={{ borderTop: `3px solid ${accent}` }}>
      <h2>{label}: {s ? s.twinName : "—"}</h2>
      <div className="cmp-meta">
        <span>id: <code>{s ? s.twinId : "—"}</code></span>
        <span>kind: {s ? s.kind : "—"}</span>
        <span>stale: {s ? (s.stale ? "yes" : "no") : "—"}</span>
      </div>
      <div className="cmp-health" style={{ color: healthColor }}>
        <span className="cmp-health-num">{s ? s.health : "—"}</span>
        <span className="cmp-health-lbl">/ 100</span>
      </div>
      <div className="cmp-sparkline-wrap">
        <svg viewBox="0 0 200 50" className="cmp-sparkline">
          {s && s.historySparkline.length > 0 ? <path d={sparklinePath(s.historySparkline, 200, 50, 4)} fill="none" stroke={accent} strokeWidth={1.5} /> : <text x="100" y="30" textAnchor="middle" fontSize="10" fill="var(--muted)">no history</text>}
        </svg>
        <span className="cmp-history-count">{s ? s.historyCount : 0} readings · {s ? s.criticalEvents24h : 0} crit/24h</span>
      </div>
    </div>
  );
}

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string; rotorRpm?: string }> }) {
  const sp = await searchParams;
  const twins = await listTwins("");
  const a = sp.a ?? (twins[0]?.id ?? "");
  const b = sp.b ?? (twins[1]?.id ?? "");
  const rotorRpm = sp.rotorRpm ? Number(sp.rotorRpm) : 1500;
  const c = await compareAssets({ twinIdA: a, twinIdB: b, rotorRpm });
  return (
    <div className="cmp-page">
      <header className="cmp-head">
        <h1>⇌ Asset Comparison</h1>
        <p>Side-by-side: live state, last diagnostic, history sparkline, health score, and BPFO expectation. This is a real read of the production state — no fabricated comparisons.</p>
        <form className="cmp-form" method="get">
          <label>Twin A <input type="text" name="a" defaultValue={a} list="cmp-twin-ids" required /></label>
          <label>Twin B <input type="text" name="b" defaultValue={b} list="cmp-twin-ids" required /></label>
          <label>Rotor rpm <input type="number" name="rotorRpm" min={500} max={3000} defaultValue={rotorRpm} /></label>
          <button type="submit">Compare</button>
        </form>
        <datalist id="cmp-twin-ids">{twins.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</datalist>
      </header>

      <section className="cmp-cards">
        <Card label="A" s={c.a} accent="#38bdf8" />
        <Card label="B" s={c.b} accent="#f472b6" />
      </section>

      <section className="cmp-table-wrap">
        <h2>Live state</h2>
        <table className="cmp-table">
          <thead>
            <tr><th></th><th>A · {c.a?.twinName ?? "—"}</th><th>B · {c.b?.twinName ?? "—"}</th></tr>
          </thead>
          <tbody>
            <StateRow label="rotor_rpm" a={c.a?.state.rotor_rpm ?? null} b={c.b?.state.rotor_rpm ?? null} fmt={(n) => n.toFixed(0)} />
            <StateRow label="vib_bearing_mms" a={c.a?.state.vib_bearing_mms ?? null} b={c.b?.state.vib_bearing_mms ?? null} fmt={(n) => n.toFixed(2)} />
            <StateRow label="T_gearbox_K" a={c.a?.state.T_gearbox_K ?? null} b={c.b?.state.T_gearbox_K ?? null} fmt={(n) => n.toFixed(1)} />
            <StateRow label="P_active_kW" a={c.a?.state.P_active_kW ?? null} b={c.b?.state.P_active_kW ?? null} fmt={(n) => n.toFixed(0)} />
            <StateRow label="oil_pressure_kPa" a={c.a?.state.oil_pressure_kPa ?? null} b={c.b?.state.oil_pressure_kPa ?? null} fmt={(n) => n.toFixed(0)} />
            <tr>
              <td className="cmp-label">BPFO expected</td>
              <td className="cmp-val">{c.a?.bpfoHz ? `${c.a.bpfoHz.toFixed(2)} Hz` : "—"}</td>
              <td className="cmp-val">{c.b?.bpfoHz ? `${c.b.bpfoHz.toFixed(2)} Hz` : "—"}</td>
            </tr>
            <tr>
              <td className="cmp-label">Last dominant Hz</td>
              <td className="cmp-val">{c.a?.lastDiagnostic?.dominantHz != null ? `${c.a.lastDiagnostic.dominantHz.toFixed(2)} Hz` : "—"}</td>
              <td className="cmp-val">{c.b?.lastDiagnostic?.dominantHz != null ? `${c.b.lastDiagnostic.dominantHz.toFixed(2)} Hz` : "—"}</td>
            </tr>
            <tr>
              <td className="cmp-label">Last peak mm/s</td>
              <td className="cmp-val">{c.a?.lastDiagnostic ? c.a.lastDiagnostic.peakMagnitude.toFixed(2) : "—"}</td>
              <td className="cmp-val">{c.b?.lastDiagnostic ? c.b.lastDiagnostic.peakMagnitude.toFixed(2) : "—"}</td>
            </tr>
            <tr>
              <td className="cmp-label">Last severity</td>
              <td className="cmp-val">{c.a?.lastDiagnostic?.severity ?? "—"}</td>
              <td className="cmp-val">{c.b?.lastDiagnostic?.severity ?? "—"}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="cmp-verdict">
        <h2>Verdict</h2>
        <p>
          A is {c.aIsHealthier ? "healthier than" : (c.a && c.b ? "not healthier than" : "not comparable with")} B.{" "}
          {c.sameFaultSignature ? "Both twins share the same dominant fault signature (outer race, near BPFO at the configured rotor)." : "The two twins do not share the same dominant fault signature, or one is missing."}
        </p>
        <p className="hint">Comparison assembled at {new Date(c.assembledAt).toISOString()}.</p>
      </section>

      <footer className="cmp-foot">
        <p>
          <Link href="/diagnostics">/diagnostics</Link>{" "}
          <Link href="/timeline">/timeline</Link>{" "}
          <Link href="/abstain">/abstain</Link>{" "}
          <Link href="/warroom">/warroom</Link>
        </p>
      </footer>
    </div>
  );
}
