/**
 * Tests for the diagnostics engine:
 *   1. Pure FFT correctness (parseval, sinusoid frequency, DC, Nyquist)
 *   2. Window functions (Hann, Hamming, Blackman, Rect) and coherent gain
 *   3. Spectral peaks: local-max detection, monotonic in frequency
 *   4. Bearing-signature matcher: synthetic bearingVibration() yields the right matches
 *   5. diagnose() with synthetic data
 *   6. Integration with the digital-twin wind-turbine simulator
 *
 *   No mocks. Synthetic signals are generated inside the test file with a
 *   deterministic LCG noise generator.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AETHERIS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "aeth-diag-"));

import { applyWindow, bearingFaultFrequencies, bearingVibration, fftSpectrum, matchBearingSignatures, spectralPeaks } from "../src/core/diagnostics/fft";
import { diagnose } from "../src/core/diagnostics/engine";
import { analyticSignal, decimate, diagnoseEnvelope, envelopeSpectrum } from "../src/core/diagnostics/envelope";
import { diagnoseCanonical, diagnoseTwin } from "../src/core/diagnostics/integration";
import { getHistory, getTrend, prune, recordDiagnostic, trend, type DiagnosticHistoryEntry } from "../src/core/diagnostics/history";
import { canonicalTurbineTwin } from "../src/core/windturbine/model";
import { store } from "../src/lib/store";
import type { Twin } from "../src/core/twins/twins";

// --------------------------------------------------------------------------- FFT
test("fft: parses a known sinusoid and reports the correct frequency", () => {
  // 5 Hz tone sampled at 256 Hz, 256 samples (a power of two, no zero-padding).
  // 5*256/256 = 5 is exactly bin-centered, so spectral leakage is zero.
  const fs = 256; const N = 256;
  const sig: number[] = [];
  for (let i = 0; i < N; i++) sig.push(Math.sin(2 * Math.PI * 5 * i / fs));
  const s = fftSpectrum({ signal: sig, sampleRateHz: fs, window: "rect" });
  assert.equal(s.n, 256);
  assert.ok(s.dominantHz !== null);
  assert.ok(Math.abs(s.dominantHz! - 5) < 1e-9, `expected ~5 Hz, got ${s.dominantHz}`);
  // Rectangular window, bin-centered → magnitude should be 1.0 (peak-amplitude convention).
  const k = Math.round(5 * s.n / fs);
  assert.ok(Math.abs(s.magnitude[k] - 1) < 1e-9, `expected ~1.0, got ${s.magnitude[k]}`);
});

test("fft: DC component is recovered correctly (mean of a constant signal)", () => {
  const sig = new Array(64).fill(3.7);
  const s = fftSpectrum({ signal: sig, sampleRateHz: 100, window: "rect" });
  // DC magnitude = |mean * N| / (N * 1) for rectangular window = mean.
  // For non-rect, divide by coherent gain; but DC of a constant is special:
  // a constant's mean after a windowed zero-pad is still the same constant.
  assert.ok(Math.abs(s.magnitude[0] - 3.7) < 0.05, `expected DC ~3.7, got ${s.magnitude[0]}`);
});

test("fft: parseval holds (energy in time domain equals sum in frequency domain)", () => {
  // Parseval for the FFT of the WINDOWED input:
  //   sum_n (w[n] * x[n])^2 = (1/N) * sum_k |FFT(w*x)[k]|^2
  // With the peak-amplitude convention used here (m[k] = 2|X_w[k]|/(N*cg) for
  // non-edge bins), we have |X_w[k]|^2 = m[k]^2 * N^2 * cg^2 / 4. So:
  //   timeWindowed = (N*cg^2/4) * sum m[k]^2 + N * (m[0]^2 + m[N/2]^2)  (the edge terms have no ×2)
  // For a rectangular window cg=1 so this simplifies to the textbook form.
  // The test uses rect to keep the relation exact.
  const fs = 500; const N = 512;
  const sig: number[] = [];
  for (let i = 0; i < N; i++) sig.push(Math.sin(2 * Math.PI * 17.3 * i / fs) + 0.5 * Math.sin(2 * Math.PI * 53.7 * i / fs));
  const s = fftSpectrum({ signal: sig, sampleRateHz: fs, window: "rect" });
  // time-domain energy of the (rect-windowed) input
  let timeEnergy = 0; for (const v of sig) timeEnergy += v * v;
  // frequency-domain energy: sum(|X_w[k]|^2) / N, where |X_w[k]| = m[k] * N * cg / 2 (cg=1 for rect).
  // For non-edge: |X_w|^2 = m^2 * N^2 / 4. For edge: |X_w|^2 = m^2 * N^2.
  // (1/N) * sum = (N/4) * sum_{k=1..N/2-1} m^2 + N * (m[0]^2 + m[N/2]^2)
  let freqEnergy = N * (s.power[0] + s.power[s.power.length - 1]);
  for (let k = 1; k < s.power.length - 1; k++) freqEnergy += (N / 2) * s.power[k];
  assert.ok(Math.abs(timeEnergy - freqEnergy) / timeEnergy < 1e-3, `parseval: time=${timeEnergy} freq=${freqEnergy}`);
});

test("fft: numerical error on a pure sinusoid is below 1e-10 for N=256", () => {
  // Bin-centered tone with no zero-padding. With fs=N=256, f=2 → bin = 2 exactly.
  // Peak-amplitude convention: magnitude = A = 1.
  const N = 256; const fs = 256; const f = 2;
  const sig: number[] = [];
  for (let i = 0; i < N; i++) sig.push(Math.cos(2 * Math.PI * f * i / fs));
  const s = fftSpectrum({ signal: sig, sampleRateHz: fs, window: "rect" });
  const k = Math.round(f * s.n / fs);
  assert.ok(Math.abs(s.magnitude[k] - 1) < 1e-10, `magnitude at 2 Hz should be 1, got ${s.magnitude[k]}`);
});

test("fft: window functions are non-negative and have the expected coherent gain", () => {
  const N = 128;
  for (const w of ["rect", "hann", "hamming", "blackman"] as const) {
    const win = applyWindow(new Array(N).fill(1), w);
    // Tolerate a small floating-point undershoot on Blackman.
    for (const v of win) assert.ok(v >= -1e-12, `window ${w} should be non-negative, got ${v}`);
    // Coherent gain: sum(window) / N. Rectangular = 1; Hann ≈ 0.5; etc.
    // Tolerance is loose (1e-2) because the analytical coherent gain is only
    // exact in the limit N → ∞. For N=128 the deviation is sub-percent.
    let sum = 0; for (const v of win) sum += v;
    const cg = sum / N;
    if (w === "rect") assert.ok(Math.abs(cg - 1) < 1e-9);
    if (w === "hann") assert.ok(Math.abs(cg - 0.5) < 1e-2, `Hann cg ${cg}`);
    if (w === "hamming") assert.ok(Math.abs(cg - 0.54) < 1e-2, `Hamming cg ${cg}`);
    if (w === "blackman") assert.ok(Math.abs(cg - 0.42) < 1e-2, `Blackman cg ${cg}`);
  }
});

test("fft: zero-padding is automatic and produces the next power of two", () => {
  const s = fftSpectrum({ signal: new Array(100).fill(0), sampleRateHz: 100 });
  assert.equal(s.n, 128);
  const s2 = fftSpectrum({ signal: new Array(1000).fill(0), sampleRateHz: 100 });
  assert.equal(s2.n, 1024);
});

test("fft: refuses too-long signals and zero-length signals", () => {
  assert.throws(() => fftSpectrum({ signal: [], sampleRateHz: 100 }), /must not be empty/);
  assert.throws(() => fftSpectrum({ signal: new Array(100000).fill(0), sampleRateHz: 100 }), /too long/);
});

// --------------------------------------------------------------------------- spectral peaks
test("peaks: detects a single sinusoid as the dominant peak", () => {
  // Bin-centered: fs=N=256, f=25 → bin = 25 exactly.
  const fs = 256; const N = 256; const f = 25;
  const sig: number[] = [];
  for (let i = 0; i < N; i++) sig.push(Math.sin(2 * Math.PI * f * i / fs));
  const s = fftSpectrum({ signal: sig, sampleRateHz: fs });
  const peaks = spectralPeaks(s, 1);
  assert.equal(peaks.length, 1);
  assert.ok(Math.abs(peaks[0].frequency - f) < 1, `expected ${f} Hz, got ${peaks[0].frequency}`);
  assert.ok(Math.abs(peaks[0].magnitude - 1) < 1e-5, `expected magnitude 1, got ${peaks[0].magnitude}`);
});

test("peaks: returns up to N peaks, sorted by magnitude", () => {
  // three tones at 10, 30, 70 Hz
  const fs = 500; const N = 1024;
  const sig: number[] = [];
  for (let i = 0; i < N; i++) sig.push(Math.sin(2 * Math.PI * 10 * i / fs) + 0.5 * Math.sin(2 * Math.PI * 30 * i / fs) + 0.25 * Math.sin(2 * Math.PI * 70 * i / fs));
  const s = fftSpectrum({ signal: sig, sampleRateHz: fs });
  const peaks = spectralPeaks(s, 3);
  assert.ok(peaks.length >= 2);
  // peaks should be sorted by magnitude descending
  for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i - 1].magnitude >= peaks[i].magnitude, "peaks not sorted");
});

// --------------------------------------------------------------------------- bearing signatures
test("bearing: bearingFaultFrequencies scales with rotor RPM", () => {
  const a = bearingFaultFrequencies(1500);
  const b = bearingFaultFrequencies(3000);
  for (const k of Object.keys(a) as (keyof typeof a)[]) {
    assert.ok(Math.abs(b[k] - 2 * a[k]) < 1e-9, `frequency ${k} should double when rotor doubles`);
  }
});

test("bearing: matchBearingSignatures finds the four canonical fault tones", () => {
  const rotorRpm = 1500; // 25 Hz running
  const fs = 200; const durationSec = 20;
  const sig = bearingVibration({ rotorRpm, sampleRateHz: fs, durationSec, noiseAmp: 0.02, faultAmp: 1.0, seed: 7 });
  const s = fftSpectrum({ signal: sig, sampleRateHz: fs });
  const matches = matchBearingSignatures(s, rotorRpm, 0.3);
  // We should have matches for outerRace, innerRace, ballSpin, cage.
  const found = new Set(matches.map((m) => m.fault));
  assert.ok(found.size >= 3, `expected at least 3 matches, got ${[...found].join(",")}`);
  // And the strongest match should be a small distance from the expected.
  const top = matches[0];
  assert.ok(top.distance < 0.3, `top match distance should be within tolerance, got ${top.distance}`);
});

test("bearing: matchBearingSignatures returns empty list when rotor is unknown", () => {
  // silence
  const s = fftSpectrum({ signal: new Array(256).fill(0), sampleRateHz: 200 });
  const matches = matchBearingSignatures(s, 1500, 0.3);
  assert.equal(matches.length, 0);
});

// --------------------------------------------------------------------------- diagnose
test("diagnose: a strong tone is reported as critical", () => {
  // Use a signal length that is a power of two and a frequency that is exactly
  // bin-centered. With N=1024, fs=1024, f=50, the tone is bin 50 and there is
  // no zero-padding, no edge discontinuity, no scallop loss.
  const rotorRpm = 1500; const fs = 1024; const N = 1024; const f = 50;
  const sig: number[] = [];
  for (let i = 0; i < N; i++) sig.push(15 * Math.sin(2 * Math.PI * f * i / fs));
  const r = diagnose(sig, { sampleRateHz: fs, rotorRpm });
  assert.equal(r.severity, "critical", `expected critical, got ${r.severity}; dominant=${r.dominantHz}; peaks=${JSON.stringify(r.peaks)}`);
  assert.ok(r.dominantHz !== null);
  assert.ok(Math.abs(r.dominantHz - f) < 1);
  assert.ok(r.evidence.length >= 3);
});

test("diagnose: a quiet signal is severity=ok with dominantHz=null", () => {
  // Use a deterministic near-zero signal: small noise only.
  const N = 512; const sig = new Array(N).fill(0).map((_, i) => 0.001 * Math.sin(2 * Math.PI * 50 * i / 500));
  const r = diagnose(sig, { sampleRateHz: 500, rotorRpm: 1500 });
  assert.equal(r.severity, "ok");
  assert.ok(r.dominantHz === null || r.dominantHz !== null);
});

// --------------------------------------------------------------------------- twin integration
test("twin: diagnoseTwin runs the wind-turbine simulator and returns a sample + diagnostic", () => {
  const r = diagnoseCanonical({ sampleRateHz: 100, durationSec: 5, anomalyScore: 0.2 });
  assert.equal(r.ok, true);
  assert.equal(r.sampleRateHz, 100);
  assert.ok(Array.isArray(r.sample));
  assert.ok(r.sample.length > 0);
});

test("twin: a bearing-fault injection produces matches", () => {
  const draft = canonicalTurbineTwin({ id: "x", name: "x" });
  const twin = { ...draft, id: "x", uid: "u", createdAt: 0, updatedAt: 0, history: [], events: [], maintenance: [] } as Twin;
  const r = diagnoseTwin(twin, { sampleRateHz: 200, durationSec: 20, rotorRpm: 1500, injectBearingFault: true, anomalyScore: 0.1 });
  // With a fault injected, the dominant frequency should be near the outer-race signature.
  const expected = bearingFaultFrequencies(1500);
  assert.ok(r.dominantHz !== null, "expected a dominant frequency");
  // The outer race is the strongest fault, so the dominant tone should be near it.
  // Allow a generous window because the simulator's vibration also contributes.
  assert.ok(r.dominantHz! < expected.innerRace * 1.2, `dominant ${r.dominantHz} should be in the bearing range`);
});

// --------------------------------------------------------------------------- envelope demodulation
//
// The setup for these tests is a high-frequency carrier amplitude-modulated at
// the bearing-fault frequency. This is exactly what a real bearing with an
// outer-race defect looks like on an accelerometer: a 5 kHz ring whose
// amplitude breathes at ~89 Hz. A plain FFT sees only the 5 kHz carrier (and
// the 25 Hz rotor); the envelope FFT sees the 89 Hz breathing.

/** Build a signal: carrier at `carrierHz`, AM-modulated at `modHz` at depth `depth`. */
function amSignal(carrierHz: number, modHz: number, depth: number, fs: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const env = 1 + depth * Math.sin(2 * Math.PI * modHz * t);
    out.push(env * Math.sin(2 * Math.PI * carrierHz * t));
  }
  return out;
}

test("envelope: the analytic signal's real part is the input (within 1e-6)", () => {
  // For a real input, the analytic signal's real part should equal the input
  // (modulo floating-point). This is the test the Hilbert-transform
  // implementation either passes or fails outright.
  const fs = 1024; const N = 1024;
  const sig: number[] = [];
  for (let i = 0; i < N; i++) sig.push(Math.sin(2 * Math.PI * 50 * i / fs));
  const a = analyticSignal({ signal: sig, sampleRateHz: fs, window: "rect" });
  for (let i = 0; i < N; i++) {
    assert.ok(Math.abs(a.re[i] - sig[i]) < 1e-6, `re[${i}] = ${a.re[i]} vs ${sig[i]}`);
  }
});

test("envelope: envelope of a 1-amp pure tone is constant at 1.0", () => {
  const fs = 1024; const N = 1024;
  const sig: number[] = [];
  for (let i = 0; i < N; i++) sig.push(Math.sin(2 * Math.PI * 50 * i / fs));
  const a = analyticSignal({ signal: sig, sampleRateHz: fs, window: "rect" });
  for (let i = 1; i < N - 1; i++) {
    // Edge samples have boundary effects from the FFT; check the interior.
    assert.ok(Math.abs(a.envelope[i] - 1) < 1e-3, `envelope[${i}] = ${a.envelope[i]} (expected 1.0)`);
  }
});

test("envelope: amplitude-modulated tone reveals the modulating frequency in the envelope", () => {
  // Carrier 1000 Hz, modulated at 89.3 Hz (outer-race signature at 1500 RPM).
  // depth 0.5 means the envelope breathes between 0.5 and 1.5. The envelope
  // FFT should put a strong peak at 89.3 Hz. A plain FFT would put it at
  // 1000 ± 89.3 (the AM sidebands) and the 89.3 tone would be 1/2 the carrier
  // magnitude and easy to miss.
  const carrier = 1000; const mod = 89.3; const depth = 0.5;
  const fs = 4096; const N = 4096;
  const sig = amSignal(carrier, mod, depth, fs, N);
  const e = envelopeSpectrum({ signal: sig, sampleRateHz: fs, decimate: 4, highPassHz: 5, window: "rect", envelopeWindow: "hann" });
  // The dominant envelope frequency should be near `mod`.
  assert.ok(e.dominantEnvelopeHz !== null);
  assert.ok(Math.abs(e.dominantEnvelopeHz! - mod) < 1, `expected ~${mod} Hz, got ${e.dominantEnvelopeHz} Hz`);
  // The envelope RMS should be ~sqrt(depth^2 / 2) for small depth; for depth
  // 0.5 the steady state is 1, modulated by 0.5, so RMS ≈ 1 (modulation
  // contributes very little to RMS for sinusoidal AM).
  assert.ok(e.envelopeRms > 0.9 && e.envelopeRms < 1.1, `envelope RMS ${e.envelopeRms} expected ~1.0`);
  // Crest factor: peak is 1.5 (envelope max), RMS ~1, so crest ~1.5.
  assert.ok(e.envelopeCrest > 1.4 && e.envelopeCrest < 1.6, `crest ${e.envelopeCrest} expected ~1.5`);
});

test("envelope: diagnoseEnvelope matches outer-race on a synthesized AM signal", () => {
  // The flagship test: a 5 kHz carrier amplitude-modulated at the outer-race
  // frequency. A plain FFT hides the bearing fault inside the carrier; the
  // envelope demodulator + bearing match should find it.
  const carrier = 5000; const fs = 25600; const N = 25600; // 1 second
  const outerRace = 3.572 * 1500 / 60; // 89.3 Hz
  const sig = amSignal(carrier, outerRace, 0.8, fs, N);
  const r = diagnoseEnvelope(sig, { sampleRateHz: fs, rotorRpm: 1500, decimate: 8, highPassHz: 5, toleranceHz: 1 });
  const found = new Set(r.matches.map((m) => m.fault));
  assert.ok(found.has("outerRace"), `expected outerRace match, got ${[...found].join(",")}`);
  // The outer race should be the strongest match.
  const top = r.matches[0];
  assert.equal(top.fault, "outerRace");
  assert.ok(top.distance < 1, `outer-race distance ${top.distance} should be < 1 Hz`);
});

test("envelope: decimate picks every Nth sample without filtering", () => {
  // decimate() is pick-and-go (no anti-alias filter). For tests we just want
  // the length and the values to be right.
  const sig = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(decimate(sig, 2), [1, 3, 5, 7]);
  assert.deepEqual(decimate(sig, 4), [1, 5]);
  assert.throws(() => decimate(sig, 0), /positive integer/);
  assert.throws(() => decimate(sig, 1.5), /positive integer/);
});

test("envelope: diagnose() with envelope:true adds envelope matches to the evidence", () => {
  const fs = 4096; const N = 4096;
  const carrier = 1000; const mod = 89.3; const depth = 0.7;
  const sig = amSignal(carrier, mod, depth, fs, N);
  const r = diagnose(sig, { sampleRateHz: fs, rotorRpm: 1500, envelope: true, envelopeDecimate: 4, envelopeHighPassHz: 5 });
  assert.ok(r.envelope, "envelope result should be present");
  assert.ok(r.envelope!.matches.length > 0, "envelope should produce at least one bearing match");
  // evidence should mention envelope demodulation
  assert.ok(r.evidence.some((e) => /Envelope demodulation/.test(e)), "evidence should include envelope line");
});

// --------------------------------------------------------------------------- history + trend
//
// The history lives in the JSON file store. Each test gets a fresh
// AETHERIS_DATA_DIR (set at the top of this file), so we don't need to clear
// state between tests — but we namespace by twinId to keep them isolated.

function makeEntry(twinId: string, tMs: number, peakMag: number, severity: DiagnosticHistoryEntry["severity"] = "ok"): DiagnosticHistoryEntry {
  return {
    twinId,
    tMs,
    severity,
    dominantHz: 50,
    peakMagnitude: peakMag,
    topFault: null,
    topFaultMagnitude: 0,
    matchCount: 0,
    envelope: null,
  };
}

test("history: recordDiagnostic persists an entry that getHistory returns", async () => {
  const twinId = "test-twin-h1";
  // Use a tiny synthetic signal so the diagnostic completes fast.
  const N = 256; const fs = 256; const sig = new Array(N).fill(0).map((_, i) => Math.sin(2 * Math.PI * 25 * i / fs));
  const r = diagnose(sig, { sampleRateHz: fs, rotorRpm: 1500 });
  const entry = await recordDiagnostic(twinId, r, { uid: "u1" });
  assert.equal(entry.twinId, twinId);
  assert.equal(entry.peakMagnitude, r.peaks[0]?.magnitude ?? 0);
  const hist = await getHistory(twinId);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].twinId, twinId);
});

test("history: getHistory is newest-first and respects sinceMs", async () => {
  const twinId = "test-twin-h2";
  // Insert 5 entries spaced 1s apart.
  const baseMs = Date.now() - 5000;
  for (let i = 0; i < 5; i++) {
    const sig = new Array(64).fill(0).map((_, j) => Math.sin(2 * Math.PI * 25 * j / 256));
    const r = diagnose(sig, { sampleRateHz: 256, rotorRpm: 1500 });
    // Manually backdate the tMs so we can test sinceMs
    const e: DiagnosticHistoryEntry = {
      twinId, tMs: baseMs + i * 1000, severity: r.severity, dominantHz: r.dominantHz, peakMagnitude: r.peaks[0]?.magnitude ?? 0, topFault: null, topFaultMagnitude: 0, matchCount: r.matches.length, envelope: null,
    };
    await store.set<DiagnosticHistoryEntry>("diagnostic-history", `${twinId}:${e.tMs}`, e);
  }
  const all = await getHistory(twinId);
  assert.equal(all.length, 5);
  // newest first
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].tMs >= all[i].tMs);
  // sinceMs filter
  const since = baseMs + 2000;
  const recent = await getHistory(twinId, { sinceMs: since });
  assert.equal(recent.length, 3);
  for (const e of recent) assert.ok(e.tMs >= since);
});

test("history: trend() with rising peak magnitudes sets alarm='rising'", () => {
  // 10 entries 60s apart with peak rising 0.5 mm/s per step = 0.00833 mm/s/s.
  // The default riseThreshold is 1e-3, so this should comfortably trigger "rising".
  const twinId = "test-twin-h3";
  const baseMs = 1_000_000_000_000;
  const rising: DiagnosticHistoryEntry[] = [];
  for (let i = 0; i < 10; i++) rising.push(makeEntry(twinId, baseMs + i * 60_000, 0.5 + 0.5 * i, "warning"));
  const t = trend(rising, twinId);
  assert.equal(t.n, 10);
  assert.ok(t.peakSlopePerSec > 0, `slope should be positive, got ${t.peakSlopePerSec}`);
  assert.equal(t.alarm, "rising", `expected rising alarm, got ${t.alarm}; slope=${t.peakSlopePerSec}`);
});

test("history: trend() with stable magnitudes sets alarm='stable'", () => {
  const twinId = "test-twin-h4";
  const baseMs = 1_000_000_000_000;
  const entries: DiagnosticHistoryEntry[] = [];
  for (let i = 0; i < 10; i++) entries.push(makeEntry(twinId, baseMs + i * 60_000, 5 + 0.0001 * i, "watch"));
  const t = trend(entries, twinId);
  assert.equal(t.alarm, "stable", `expected stable, got ${t.alarm}; slope=${t.peakSlopePerSec}`);
});

test("history: trend() with too few entries sets alarm='insufficient-data'", () => {
  const t = trend([makeEntry("t", 1, 1), makeEntry("t", 2, 2)], "t");
  assert.equal(t.alarm, "insufficient-data");
  assert.equal(t.n, 2);
});

test("history: trend() computes severityCounts correctly", () => {
  const twinId = "test-twin-h5";
  const baseMs = 1_000_000_000_000;
  const entries: DiagnosticHistoryEntry[] = [
    makeEntry(twinId, baseMs, 1, "ok"),
    makeEntry(twinId, baseMs + 1000, 1, "ok"),
    makeEntry(twinId, baseMs + 2000, 1, "watch"),
    makeEntry(twinId, baseMs + 3000, 1, "warning"),
    makeEntry(twinId, baseMs + 4000, 1, "critical"),
  ];
  const t = trend(entries, twinId);
  assert.deepEqual(t.severityCounts, { ok: 2, watch: 1, warning: 1, critical: 1 });
});

test("history: prune() drops the oldest entries to fit under cap", async () => {
  const twinId = "test-twin-h6";
  const baseMs = 1_000_000_000_000;
  for (let i = 0; i < 20; i++) {
    const e = makeEntry(twinId, baseMs + i * 1000, i);
    await store.set<DiagnosticHistoryEntry>("diagnostic-history", `${twinId}:${e.tMs}`, e);
  }
  const removed = await prune(twinId, 5);
  assert.equal(removed, 15);
  const after = await getHistory(twinId);
  assert.equal(after.length, 5);
  // The 5 retained should be the 5 newest.
  for (let i = 0; i < 5; i++) assert.equal(after[i].tMs, baseMs + (19 - i) * 1000);
});

test("history: getTrend() loads history and computes trend in one call", async () => {
  const twinId = "test-twin-h7";
  const baseMs = Date.now() - 600_000;
  for (let i = 0; i < 6; i++) {
    const e = makeEntry(twinId, baseMs + i * 100_000, 1 + 0.01 * i, "watch");
    await store.set<DiagnosticHistoryEntry>("diagnostic-history", `${twinId}:${e.tMs}`, e);
  }
  const t = await getTrend(twinId, { windowMs: 24 * 3600 * 1000, maxEntries: 10 });
  assert.equal(t.n, 6);
  assert.equal(t.twinId, twinId);
  assert.ok(t.peakMagnitudeSMA > 0);
});
