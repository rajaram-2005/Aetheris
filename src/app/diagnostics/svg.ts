/**
 * Spectrum SVG generator — extracted from page.tsx so it's testable in pure TS.
 *
 *   The actual page component (page.tsx) wraps this in a server-rendered
 *   Next.js route at /diagnostics. The SVG output is inline (no separate file
 *   request, no client-side JS).
 */
import type { Spectrum } from "@/core/diagnostics/fft";

export interface FaultMarker {
  outerRace: number;
  innerRace: number;
  ballSpin: number;
  cage: number;
}

const FAULT_LABELS: Array<{ key: keyof FaultMarker; short: string }> = [
  { key: "outerRace", short: "outer race (BPFO)" },
  { key: "innerRace", short: "inner race (BPFI)" },
  { key: "ballSpin", short: "ball spin (BSF)" },
  { key: "cage", short: "cage (FTF)" },
];

/**
 * Render an SVG string of the magnitude spectrum. Pure function; depends only
 * on the input spectrum and fault markers.
 */
export function renderSpectrumSvg(spectrum: Spectrum, fault: FaultMarker): string {
  const W = 640; const H = 220; const PAD = 36;
  const bins = spectrum.magnitude;
  const fMax = spectrum.frequency[spectrum.frequency.length - 1];
  const cutoff = Math.max(1, Math.floor(bins.length * 0.8));
  const visFreq = spectrum.frequency.slice(0, cutoff);
  const visMag = bins.slice(0, cutoff);
  const yMax = Math.max(0.01, ...visMag) * 1.1;
  const xScale = (f: number) => PAD + (f / Math.max(fMax, 1e-9)) * (W - 2 * PAD);
  const yScale = (m: number) => H - PAD - (m / Math.max(yMax, 1e-9)) * (H - 2 * PAD);
  let d = "";
  for (let i = 0; i < visFreq.length; i++) {
    d += `${i === 0 ? "M" : "L"}${xScale(visFreq[i]).toFixed(2)},${yScale(visMag[i]).toFixed(2)}`;
  }
  const fMaxVis = fMax * 0.8;
  const faultLines: string[] = [];
  for (const { key, short } of FAULT_LABELS) {
    const f = fault[key];
    if (f > 0 && f < fMaxVis) {
      faultLines.push(`<g><line x1="${xScale(f).toFixed(2)}" y1="${PAD}" x2="${xScale(f).toFixed(2)}" y2="${H - PAD}" stroke="#fb923c" stroke-dasharray="3,2" opacity="0.6"/><text x="${(xScale(f) + 2).toFixed(2)}" y="${PAD + 12}" fill="#fb923c" font-size="9">${short} (${f.toFixed(1)} Hz)</text></g>`);
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="diag-svg" preserveAspectRatio="xMidYMid meet" aria-label="magnitude spectrum"><rect x="0" y="0" width="${W}" height="${H}" fill="#0b0d12"/><line x1="${PAD}" y1="${H - PAD}" x2="${W - PAD}" y2="${H - PAD}" stroke="#475569"/><line x1="${PAD}" y1="${PAD}" x2="${PAD}" y2="${H - PAD}" stroke="#475569"/>${[0.25, 0.5, 0.75].map((p) => `<line x1="${PAD}" y1="${yScale(yMax * p).toFixed(2)}" x2="${W - PAD}" y2="${yScale(yMax * p).toFixed(2)}" stroke="#1e293b" stroke-dasharray="2,3"/>`).join("")}${faultLines.join("")}<path d="${d}" fill="none" stroke="#38bdf8" stroke-width="1"/><text x="${W - PAD}" y="${H - 6}" text-anchor="end" fill="#94a3b8" font-size="10">Hz</text><text x="6" y="${PAD + 6}" fill="#94a3b8" font-size="10">mag</text><text x="${W / 2}" y="${H - 6}" text-anchor="middle" fill="#64748b" font-size="9">0 – ${fMaxVis.toFixed(0)} Hz (one-sided)</text></svg>`;
}

/** Sparkline (small SVG) for the history trend. */
export function renderSparkline(values: number[]): string {
  if (values.length < 2) return "";
  const W = 300; const H = 60; const PAD = 4;
  const yMax = Math.max(0.01, ...values) * 1.1;
  const xScale = (i: number) => PAD + (i / (values.length - 1)) * (W - 2 * PAD);
  const yScale = (m: number) => H - PAD - (m / Math.max(yMax, 1e-9)) * (H - 2 * PAD);
  let d = "";
  for (let i = 0; i < values.length; i++) d += `${i === 0 ? "M" : "L"}${xScale(i).toFixed(2)},${yScale(values[i]).toFixed(2)}`;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="diag-spark" aria-label="peak magnitude over time"><path d="${d}" fill="none" stroke="#a78bfa" stroke-width="1.5"/></svg>`;
}
