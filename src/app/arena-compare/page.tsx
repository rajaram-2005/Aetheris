/**
 * /arena-compare — Pairwise statistical comparison between
 * two arena rows. Pure read-side; the user pastes content
 * and latency, the page runs compareArena() and renders.
 */
"use client";
import { useState } from "react";
import { compareArena, type ArenaPairwise } from "@/core/arena/stats";
import Link from "next/link";

const COLOUR: Record<string, string> = {
  a: "#4ade80", b: "#38bdf8", tie: "#facc15", "both-fail": "#f87171",
};

export default function ArenaComparePage() {
  const [aContent, setAContent] = useState("wind turbine vibration rising on the gearbox bearing");
  const [bContent, setBContent] = useState("vibration rising in gearbox bearing of the wind turbine");
  const [aLat, setALat] = useState(200);
  const [bLat, setBLat] = useState(100);
  const [aOk, setAOk] = useState(true);
  const [bOk, setBOk] = useState(true);
  const r: ArenaPairwise = compareArena(
    { providerId: "A", providerName: "A", model: "m", configured: true, status: aOk ? "ok" : "error", content: aContent, latencyMs: aLat, error: null, costClass: "free", locality: "us" },
    { providerId: "B", providerName: "B", model: "m", configured: true, status: bOk ? "ok" : "error", content: bContent, latencyMs: bLat, error: null, costClass: "free", locality: "us" },
  );
  return (
    <div className="ac-page">
      <header className="ac-head">
        <h1>🆚 Arena Pairwise Compare</h1>
        <p>Real statistical tests on arena output: token-overlap (Jaccard), length ratio, latency ratio, and a winner with a confidence flag. The function is honest: it never claims a winner when either row is not <code>ok</code>.</p>
      </header>
      <section className="ac-form">
        <div className="ac-side">
          <h3>A</h3>
          <label><input type="checkbox" checked={aOk} onChange={(e) => setAOk(e.target.checked)} /> ok</label>
          <label>latency (ms) <input type="number" value={aLat} onChange={(e) => setALat(Number(e.target.value))} min={0} /></label>
          <textarea rows={4} value={aContent} onChange={(e) => setAContent(e.target.value)} />
        </div>
        <div className="ac-side">
          <h3>B</h3>
          <label><input type="checkbox" checked={bOk} onChange={(e) => setBOk(e.target.checked)} /> ok</label>
          <label>latency (ms) <input type="number" value={bLat} onChange={(e) => setBLat(Number(e.target.value))} min={0} /></label>
          <textarea rows={4} value={bContent} onChange={(e) => setBContent(e.target.value)} />
        </div>
      </section>
      <section className="ac-result">
        <div className="ac-row"><span>winner</span><strong style={{ color: COLOUR[r.winner] }}>{r.winner}</strong></div>
        <div className="ac-row"><span>confidence</span><strong>{r.confidence}</strong></div>
        <div className="ac-row"><span>both ok</span><strong style={{ color: r.bothOk ? "#4ade80" : "#f87171" }}>{r.bothOk ? "✓" : "✗"}</strong></div>
        <div className="ac-row"><span>jaccard</span><code>{r.jaccard === null ? "—" : r.jaccard.toFixed(3)}</code></div>
        <div className="ac-row"><span>length ratio</span><code>{r.lengthRatio.toFixed(2)}×</code> <small>({r.lengthDeltaChars >= 0 ? "+" : ""}{r.lengthDeltaChars} chars)</small></div>
        <div className="ac-row"><span>latency ratio</span><code>{r.latencyRatio.toFixed(2)}×</code> <small>({r.latencyDeltaMs >= 0 ? "+" : ""}{r.latencyDeltaMs} ms)</small></div>
        <div className="ac-reason">{r.reason}</div>
      </section>
      <footer className="ac-foot">
        <p><Link href="/arena">/arena</Link> · <Link href="/">/</Link></p>
      </footer>
    </div>
  );
}
