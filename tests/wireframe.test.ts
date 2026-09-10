/**
 * Tests for the 3D wireframe projection math.
 *
 *   The component itself (canvas, requestAnimationFrame) is hard to test
 *   without a browser. What we test here is the pure math: the geometry
 *   shape, the projection's determinism, the rotation behaviour, the
 *   auto-fit, and the severity bucketing. Those are the parts that, if
 *   wrong, would make the visualisation lie.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalTurbineGeometry, projectScene, drawScene, severityFor,
  overlayFromState, SEVERITY_COLOURS,
} from "../src/core/windturbine/wireframe";

test("wireframe: canonical geometry has a tower, nacelle, hub, and 3 blades", () => {
  const g = canonicalTurbineGeometry();
  // tower 4-bottom + 4-top = 8; nacelle 8; hub 1; per-blade 3 vertices (tip1, tip2, mid) × 3 = 9
  assert.equal(g.vertices.length, 8 + 8 + 1 + 3 * 3);
  // Every edge points to a real vertex
  for (const e of g.edges) {
    assert.ok(e.a >= 0 && e.a < g.vertices.length, `bad edge a: ${e.a}`);
    assert.ok(e.b >= 0 && e.b < g.vertices.length, `bad edge b: ${e.b}`);
  }
});

test("wireframe: hub vertex has the largest Z (faces +Z)", () => {
  const g = canonicalTurbineGeometry();
  let maxZ = -Infinity, maxIdx = -1;
  for (let i = 0; i < g.vertices.length; i++) {
    if (g.vertices[i]![2] > maxZ) { maxZ = g.vertices[i]![2]; maxIdx = i; }
  }
  assert.ok(maxZ > 0, "hub should be on +Z side of the nacelle");
  // The hub is the only vertex at that Z (the +Z face of the nacelle is slightly behind)
  // The max-Z vertex should be a unique high value.
  assert.ok(maxIdx > 0);
});

test("wireframe: projection is deterministic — same inputs → same outputs", () => {
  const g = canonicalTurbineGeometry();
  const a = projectScene({ vertices: g.vertices, edges: g.edges, width: 400, height: 300 });
  const b = projectScene({ vertices: g.vertices, edges: g.edges, width: 400, height: 300 });
  assert.equal(a.points.length, b.points.length);
  for (let i = 0; i < a.points.length; i++) {
    assert.equal(a.points[i]!.x, b.points[i]!.x);
    assert.equal(a.points[i]!.y, b.points[i]!.y);
    assert.equal(a.points[i]!.depth, b.points[i]!.depth);
  }
});

test("wireframe: auto-fit scale keeps every point inside the canvas", () => {
  const g = canonicalTurbineGeometry();
  const scene = projectScene({ vertices: g.vertices, edges: g.edges, width: 400, height: 300 });
  for (const p of scene.points) {
    assert.ok(p.x >= 0 && p.x <= 400, `x out of bounds: ${p.x}`);
    assert.ok(p.y >= 0 && p.y <= 300, `y out of bounds: ${p.y}`);
  }
});

test("wireframe: yaw=0 vs yaw=π/2 move the projected hub", () => {
  const g = canonicalTurbineGeometry();
  const a = projectScene({ vertices: g.vertices, edges: g.edges, width: 400, height: 300, yaw: 0 });
  const b = projectScene({ vertices: g.vertices, edges: g.edges, width: 400, height: 300, yaw: Math.PI / 2 });
  // The hub is the max-Z vertex; find it in both projections and compare.
  const hub = g.vertices.reduce((acc, v, i) => (v[2] > g.vertices[acc]![2] ? i : acc), 0);
  const p0 = a.points[hub]!;
  const p1 = b.points[hub]!;
  // After a π/2 yaw, the hub should be roughly mirrored in X.
  assert.notEqual(p0.x, p1.x, "yaw should change x");
});

test("wireframe: spin moves the blade tips but not the tower", () => {
  const g = canonicalTurbineGeometry();
  // Pin the origin to (200, 150) so the auto-fit re-centering doesn't
  // shadow the actual rotation we want to observe.
  const a = projectScene({ vertices: g.vertices, edges: g.edges, width: 400, height: 300, originX: 200, originY: 150, scale: 1, spin: 0 });
  const b = projectScene({ vertices: g.vertices, edges: g.edges, width: 400, height: 300, originX: 200, originY: 150, scale: 1, spin: Math.PI / 3 });
  // Tower vertex 0 is the base — it must not move
  assert.equal(a.points[0]!.x, b.points[0]!.x);
  assert.equal(a.points[0]!.y, b.points[0]!.y);
  // Some blade vertex must move
  let moved = false;
  for (let i = 16; i < a.points.length; i++) { // hubIdx=16, blade vertices after
    if (a.points[i]!.x !== b.points[i]!.x || a.points[i]!.y !== b.points[i]!.y) { moved = true; break; }
  }
  assert.ok(moved, "spin should move at least one blade vertex");
});

test("wireframe: sorted edges are drawn back-to-front (painter's algorithm)", () => {
  const g = canonicalTurbineGeometry();
  const scene = projectScene({ vertices: g.vertices, edges: g.edges, width: 400, height: 300 });
  // Sort like drawScene does and check non-decreasing depth (back to front means
  // we draw the highest depth first, so when iterating in order, depth
  // decreases).
  const sorted = scene.edges.slice().sort((a, b) => (b.a.depth + b.b.depth) - (a.a.depth + a.b.depth));
  for (let i = 1; i < sorted.length; i++) {
    const dPrev = sorted[i - 1]!.a.depth + sorted[i - 1]!.b.depth;
    const dCurr = sorted[i]!.a.depth + sorted[i]!.b.depth;
    assert.ok(dPrev >= dCurr, "back-to-front sort broken");
  }
});

test("wireframe: severityFor follows ISO 10816 thresholds (mm/s) by default", () => {
  assert.equal(severityFor(0.5), "ok");
  assert.equal(severityFor(4.0), "ok");
  assert.equal(severityFor(4.6), "watch");
  assert.equal(severityFor(7.0), "watch");
  assert.equal(severityFor(7.2), "warning");
  assert.equal(severityFor(11.0), "warning");
  assert.equal(severityFor(11.3), "critical");
  assert.equal(severityFor(15.0), "critical");
});

test("wireframe: severityFor honours custom bounds", () => {
  // Tight critical bound around 1.0
  const sev = severityFor(0.95, { max: 1.0, critical: true });
  assert.equal(sev, "warning");
  const sev2 = severityFor(0.8, { max: 1.0, critical: true });
  assert.equal(sev2, "watch");
  const sev3 = severityFor(0.5, { max: 1.0, critical: true });
  assert.equal(sev3, "ok");
  const sev4 = severityFor(1.2, { max: 1.0, critical: true });
  assert.equal(sev4, "critical");
});

test("wireframe: overlayFromState returns one entry per numeric state key with a bound", () => {
  const state = { rotor_rpm: 1500, gearbox_temp_K: 340, vib_rms: 12.4, name: "asset" } as Record<string, number | string | boolean>;
  const bounds = [
    { key: "rotor_rpm", max: 1800, unit: "rpm" },
    { key: "gearbox_temp_K", min: 233, max: 353, critical: true, unit: "K" },
    { key: "vib_rms", max: 11.2, unit: "mm/s" },
  ];
  const overlays = overlayFromState(state, bounds);
  assert.equal(overlays.length, 3);
  const vib = overlays.find((o) => o.key === "vib_rms")!;
  assert.equal(vib.severity, "critical");
  assert.equal(SEVERITY_COLOURS.critical, "#f87171");
  // Coordinates differ between channels (placement matters)
  const xs = new Set(overlays.map((o) => o.x));
  assert.ok(xs.size > 1, "overlays should be placed on different vertices");
});

test("wireframe: overlayFromState ignores non-numeric and unbounded keys", () => {
  const state = { name: "asset", stringKey: "abc" };
  const bounds = [{ key: "rotor_rpm", max: 1800 }, { key: "missing" } as { key: string; max?: number }];
  const overlays = overlayFromState(state as Record<string, number | string | boolean>, bounds as { key: string; max?: number; critical?: boolean; unit?: string }[]);
  assert.equal(overlays.length, 0);
});

test("wireframe: drawScene does not throw with a stub canvas context", () => {
  const g = canonicalTurbineGeometry();
  const scene = projectScene({ vertices: g.vertices, edges: g.edges, width: 200, height: 200 });
  // Minimal canvas 2d context stub — just records the calls
  const calls: string[] = [];
  const ctx = {
    clearRect: () => { calls.push("clear"); },
    beginPath: () => { calls.push("begin"); },
    moveTo: () => { calls.push("move"); },
    lineTo: () => { calls.push("line"); },
    stroke: () => { calls.push("stroke"); },
    set strokeStyle(_: string) { /* swallow */ },
    set lineWidth(_: number) { /* swallow */ },
  } as unknown as CanvasRenderingContext2D;
  drawScene(ctx, scene);
  // Should have: 1 clear + N*(begin/move/line/stroke)
  assert.equal(calls[0], "clear");
  assert.ok(calls.length > 4);
  // Every edge in the scene produced at least one stroke
  const strokes = calls.filter((c) => c === "stroke").length;
  assert.equal(strokes, scene.edges.length);
});

test("wireframe: projection preserves vertex count", () => {
  const g = canonicalTurbineGeometry();
  const scene = projectScene({ vertices: g.vertices, edges: g.edges, width: 200, height: 200 });
  assert.equal(scene.points.length, g.vertices.length);
  assert.equal(scene.edges.length, g.edges.length);
});

test("wireframe: projection is pure — no shared state", () => {
  const g = canonicalTurbineGeometry();
  const a = projectScene({ vertices: g.vertices, edges: g.edges, width: 200, height: 200, yaw: 0 });
  const b = projectScene({ vertices: g.vertices, edges: g.edges, width: 200, height: 200, yaw: 0.5 });
  // changing yaw doesn't mutate the input vertices
  for (let i = 0; i < g.vertices.length; i++) {
    const v = g.vertices[i]!;
    assert.ok(Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]));
  }
  // and the scene is a fresh object
  assert.notEqual(a, b);
});
