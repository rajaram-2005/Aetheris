/**
 * Tests for the /diagnostics page (server-side render).
 *
 *   We don't import the React component itself (it pulls in `next/headers` and
 *   JSX which makes `tsx --test` unhappy). Instead we test the data-loading
 *   function and the spectrum SVG path generation by extracting them into a
 *   pure module and importing that.
 *
 *   The component still gets verified by manual visual checks at /diagnostics.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AETHERIS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "aeth-diag-page-"));

import { renderSpectrumSvg } from "../src/app/diagnostics/svg";

test("page: spectrum SVG renders non-empty path for a synthetic spectrum", () => {
  const bins = new Array(64).fill(0).map((_, i) => Math.exp(-((i - 10) ** 2) / 8)); // bell at bin 10
  const freq = bins.map((_, i) => i);
  const svg = renderSpectrumSvg({ magnitude: bins, frequency: freq } as never, { outerRace: 50, innerRace: 75, ballSpin: 5, cage: 7 });
  assert.ok(svg.includes("<svg"));
  assert.ok(svg.includes("<path"));
  assert.ok(svg.includes("outer"), `expected outer-race label, got: ${svg.slice(0, 500)}`);
});

test("page: spectrum SVG handles a single-bin spectrum without dividing by zero", () => {
  const svg = renderSpectrumSvg({ magnitude: [0, 0, 0, 1, 0], frequency: [0, 1, 2, 3, 4] } as never, { outerRace: 0, innerRace: 0, ballSpin: 0, cage: 0 });
  assert.ok(svg.includes("<svg"));
});
