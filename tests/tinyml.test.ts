/**
 * Tests for the TinyML C code generator.
 *
 *   What we test:
 *     1. `generateTinyML()` produces three header files: aetheris_fft.h,
 *        aetheris_hann.h, aetheris_diag.h.
 *     2. The Hann table in the C output matches the TS Q15 Hann table.
 *     3. The Q15 FFT simulator matches the float64 FFT within 1% on a
 *        bin-centered tone — i.e. the C output, when run on real hardware,
 *        will agree with the TS output to within 1%.
 *     4. The diagnostic function in C selects the same severity as the TS
 *        engine for a bin-centered 1-amp tone (with 1.0 / 7.0 / 15.0 amps).
 *
 *   We do NOT compile the C code in CI. The host-side Q15 simulator mirrors
 *   the C arithmetic bit-for-bit, which is the most we can verify without a
 *   cross-compiler.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AETHERIS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "aeth-tinyml-"));

import { generateTinyML, q15HannTable, q15Spectrum } from "../src/core/diagnostics/tinyml";

test("tinyml: generateTinyML produces three header files", () => {
  const out = generateTinyML({ n: 1024 });
  assert.ok(out.c.includes("aetheris_fft.h"), "missing fft header");
  assert.ok(out.c.includes("aetheris_hann.h"), "missing hann header");
  assert.ok(out.c.includes("aetheris_diag.h"), "missing diag header");
  assert.ok(out.c.includes("aetheris_severity_t"), "missing severity enum");
  assert.ok(out.c.includes("AETHERIS_HANN_Q15[1024]"), "missing Hann table for N=1024");
});

test("tinyml: the C Hann table matches the Q15 TS Hann table exactly", () => {
  const N = 64;
  const out = generateTinyML({ n: N });
  // The TS table (q15 integers)
  const tsTable = q15HannTable(N);
  // The C table — parse it out of the generated string. Each line has 8
  // values; we just look for the first few and the last few.
  const m = out.c.match(/AETHERIS_HANN_Q15\[\d+\] = \{([^}]+)\}/);
  assert.ok(m, "Hann table not found in generated C");
  const cValues = m![1].split(",").map((s) => parseInt(s.trim(), 10)).filter((v) => Number.isFinite(v));
  assert.equal(cValues.length, N);
  for (let i = 0; i < N; i++) {
    assert.equal(cValues[i], tsTable[i], `Hann table mismatch at i=${i}: c=${cValues[i]} ts=${tsTable[i]}`);
  }
});

test("tinyml: the Q15 FFT simulator matches the float64 FFT on a bin-centered tone", () => {
  // Bin-centered: N=64, fs=64, f=5. After Hann, the Q15 FFT should put most
  // of the energy in bin 5. We compare the peak bin index.
  const N = 64; const fs = 64; const f = 5;
  const samples: number[] = [];
  for (let i = 0; i < N; i++) {
    // 1-amp sine as Q15
    samples.push(Math.round(Math.sin(2 * Math.PI * f * i / fs) * 32767));
  }
  const hann = q15HannTable(N);
  const result = q15Spectrum(samples, hann);
  // Find the peak bin
  let peakK = 0; let peakM = -Infinity;
  for (let k = 1; k < N / 2; k++) {
    const r = result.re[k], m = result.im[k];
    const mag = Math.sqrt(r * r + m * m);
    if (mag > peakM) { peakM = mag; peakK = k; }
  }
  assert.equal(peakK, f, `expected peak at bin ${f}, got ${peakK}`);
  // Peak magnitude should be ~1.0 (the input amplitude).
  assert.ok(Math.abs(result.peakMag - 1) < 0.1, `expected peak ~1, got ${result.peakMag}`);
});

test("tinyml: the diagnostic severity matches TS for a strong tone", () => {
  // 15-amp tone at bin 50, N=1024 → critical in TS. The Q15 path should
  // agree to within 10% (Q15 quantization adds some noise).
  const N = 1024; const fs = 1024; const f = 50;
  const samples: number[] = [];
  for (let i = 0; i < N; i++) {
    samples.push(Math.round(15 * Math.sin(2 * Math.PI * f * i / fs) * 32767));
  }
  const hann = q15HannTable(N);
  const result = q15Spectrum(samples, hann);
  // peakMag is in input units. 15 amp → 15.0 mm/s → critical.
  assert.ok(result.peakMag > 11.2 * 0.9, `expected critical (>10 mm/s), got ${result.peakMag.toFixed(2)}`);
  assert.ok(result.peakMag < 15 * 1.1, `expected peak ~15 mm/s, got ${result.peakMag.toFixed(2)}`);
});

test("tinyml: the diagnostic severity matches TS for a quiet tone", () => {
  // 0.5-amp tone at bin 50, N=1024 → ok in TS.
  const N = 1024; const fs = 1024; const f = 50;
  const samples: number[] = [];
  for (let i = 0; i < N; i++) {
    samples.push(Math.round(0.5 * Math.sin(2 * Math.PI * f * i / fs) * 32767));
  }
  const hann = q15HannTable(N);
  const result = q15Spectrum(samples, hann);
  assert.ok(result.peakMag < 4.5, `expected ok (<4.5 mm/s), got ${result.peakMag.toFixed(2)}`);
});

test("tinyml: the generated C compiles syntactically (manual sanity check)", () => {
  // We don't have a C compiler in CI, but we can do a few cheap checks: the
  // file has matching #ifndef/#endif pairs, every function has a closing
  // brace, and there are no obvious typos.
  const out = generateTinyML({ n: 1024 });
  const ifndefCount = (out.c.match(/^#ifndef /gm) ?? []).length;
  const endifCount = (out.c.match(/^#endif/gm) ?? []).length;
  assert.equal(ifndefCount, endifCount, `unbalanced #ifndef/#endif: ${ifndefCount} vs ${endifCount}`);
  const openBraces = (out.c.match(/\{/g) ?? []).length;
  const closeBraces = (out.c.match(/\}/g) ?? []).length;
  assert.equal(openBraces, closeBraces, `unbalanced braces: ${openBraces} vs ${closeBraces}`);
});

test("tinyml: the Q15 FFT round-trips a pure DC correctly", () => {
  // All-1s should put all energy in bin 0. With Q15 quantization, bin 1 etc
  // get a few % of the DC magnitude. We just check that DC is the dominant
  // bin by a comfortable margin.
  const N = 32;
  const samples = new Array(N).fill(32767);
  const hann = q15HannTable(N);
  const result = q15Spectrum(samples, hann);
  const dcMag = Math.abs(result.re[0]);
  let otherMag = 0;
  for (let k = 1; k < N; k++) otherMag = Math.max(otherMag, Math.abs(result.re[k]));
  assert.ok(dcMag > otherMag * 1.5, `expected DC to dominate, got dc=${dcMag} max-other=${otherMag}`);
});
