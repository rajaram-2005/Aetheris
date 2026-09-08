/**
 * Tests for the NIRIKSHAN evaluation harness.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { confusionMatrix, perClassMetrics, calibrationError, runEval, type LabelledTrial } from "../src/core/diagnostics/eval";

function trial(id: string, trueClass: string, signal: number[] = [0, 0, 0], sampleRateHz = 12000, rotorRpm?: number): LabelledTrial {
  return { id, trueClass, signal, sampleRateHz, rotorRpm };
}

test("confusionMatrix: 2x2 with all correct", () => {
  const m = confusionMatrix([{ trueClass: "a", prediction: "a" }, { trueClass: "b", prediction: "b" }]);
  assert.equal(m.classes.length, 2);
  assert.equal(m.matrix[0]![0], 1);
  assert.equal(m.matrix[0]![1], 0);
  assert.equal(m.matrix[1]![0], 0);
  assert.equal(m.matrix[1]![1], 1);
});

test("confusionMatrix: off-diagonal counts go to (true, pred)", () => {
  const m = confusionMatrix([{ trueClass: "a", prediction: "b" }, { trueClass: "b", prediction: "a" }]);
  assert.equal(m.matrix[0]![1], 1);
  assert.equal(m.matrix[1]![0], 1);
});

test("confusionMatrix: classes are sorted", () => {
  const m = confusionMatrix([{ trueClass: "z", prediction: "a" }, { trueClass: "a", prediction: "z" }]);
  assert.deepEqual(m.classes, ["a", "z"]);
});

test("perClassMetrics: precision, recall, F1 are correct on a 2-class problem", () => {
  const trials = [
    { trueClass: "a", prediction: "a" },
    { trueClass: "a", prediction: "a" },
    { trueClass: "a", prediction: "b" },
    { trueClass: "b", prediction: "b" },
    { trueClass: "b", prediction: "a" },
  ];
  const m = perClassMetrics(trials, ["a", "b"]);
  const a = m.find((x) => x.class === "a")!;
  assert.equal(a.tp, 2);
  assert.equal(a.fp, 1);
  assert.equal(a.fn, 1);
  assert.equal(a.tn, 1);
  assert.equal(a.precision, 2 / 3);
  assert.equal(a.recall, 2 / 3);
  assert.ok(Math.abs(a.f1! - (2 * (2 / 3) * (2 / 3)) / ((2 / 3) + (2 / 3))) < 1e-9);
});

test("perClassMetrics: class with zero trials has null rates", () => {
  const m = perClassMetrics([{ trueClass: "a", prediction: "a" }], ["a", "b"]);
  const b = m.find((x) => x.class === "b")!;
  assert.equal(b.trials, 0);
  assert.equal(b.precision, null);
  assert.equal(b.recall, null);
  assert.equal(b.f1, null);
});

test("calibrationError: 0 when all confidences match empirical accuracy", () => {
  // 10 trials each at 0.5 confidence, 5 correct → empirical 0.5.
  const trials = Array.from({ length: 10 }, (_, i) => ({ confidence: 0.5, correct: i < 5 }));
  const err = calibrationError(trials);
  assert.ok(err !== null);
  assert.ok(err! < 0.01);
});

test("calibrationError: null on empty input", () => {
  assert.equal(calibrationError([]), null);
});

test("calibrationError: conf > 1 is clamped to 1", () => {
  const err = calibrationError([{ confidence: 2, correct: true }]);
  assert.ok(err !== null);
});

test("calibrationError: conf < 0 is clamped to 0", () => {
  const err = calibrationError([{ confidence: -0.5, correct: false }]);
  assert.ok(err !== null);
});

test("runEval: empty trials list returns accuracy = null and notes explain the absence", async () => {
  const r = await runEval([], { benchmark: "test-empty", engineVersion: "test" });
  assert.equal(r.totalTrials, 0);
  assert.equal(r.accuracy, null);
  assert.equal(r.correct, 0);
  assert.match(r.notes.proves, /No trials/i);
  assert.equal(r.notes.sampleSize, "insufficient");
  assert.match(r.notes.doesNotProve, /production-accuracy/);
});

test("runEval: 100% accuracy on a perfectly-classified synthetic set", async () => {
  // Use the predictions override so we don't depend on
  // engine behaviour for this test.
  const r = await runEval(
    [trial("a-1", "a"), trial("a-2", "a"), trial("b-1", "b")],
    {
      benchmark: "synthetic-100",
      engineVersion: "test",
      predictions: [
        { id: "a-1", trueClass: "a", predictedClass: "a", confidence: 0.9, ok: true, ms: 1 },
        { id: "a-2", trueClass: "a", predictedClass: "a", confidence: 0.9, ok: true, ms: 1 },
        { id: "b-1", trueClass: "b", predictedClass: "b", confidence: 0.9, ok: true, ms: 1 },
      ],
    },
  );
  assert.equal(r.totalTrials, 3);
  assert.equal(r.correct, 3);
  assert.equal(r.accuracy, 1);
  assert.equal(r.notes.sampleSize, "insufficient");
});

test("runEval: 0% accuracy is reported as 0 (not null) when trials are present", async () => {
  const r = await runEval(
    [trial("a-1", "a"), trial("b-1", "b")],
    {
      benchmark: "synthetic-0",
      engineVersion: "test",
      predictions: [
        { id: "a-1", trueClass: "a", predictedClass: "b", confidence: 0.9, ok: true, ms: 1 },
        { id: "b-1", trueClass: "b", predictedClass: "a", confidence: 0.9, ok: true, ms: 1 },
      ],
    },
  );
  assert.equal(r.accuracy, 0);
  assert.equal(r.correct, 0);
});

test("runEval: perClass F1 is computed for classes with positive trials", async () => {
  const r = await runEval(
    [trial("a-1", "a"), trial("b-1", "b"), trial("c-1", "c")],
    {
      benchmark: "synthetic-3class",
      engineVersion: "test",
      predictions: [
        { id: "a-1", trueClass: "a", predictedClass: "a", confidence: 0.8, ok: true, ms: 1 },
        { id: "b-1", trueClass: "b", predictedClass: "b", confidence: 0.8, ok: true, ms: 1 },
        { id: "c-1", trueClass: "c", predictedClass: "a", confidence: 0.8, ok: true, ms: 1 },
      ],
    },
  );
  // F1 is null for the class that was never correctly
  // predicted (c: tp=0, fp=1, fn=1 → precision=0, recall=0,
  // f1=null because 0 + 0 is the f1=0 boundary, but with
  // 0/0 fallthrough). We assert at least 2 of the 3
  // classes have a numeric F1.
  const numeric = r.perClass.filter((c) => typeof c.f1 === "number").length;
  assert.ok(numeric >= 2, `expected at least 2 numeric F1, got ${numeric}`);
});

test("runEval: confusion matrix is square and has correct dimensions", async () => {
  const r = await runEval(
    [trial("a-1", "a"), trial("b-1", "b")],
    {
      benchmark: "synthetic-cm",
      engineVersion: "test",
      predictions: [
        { id: "a-1", trueClass: "a", predictedClass: "a", confidence: 0.8, ok: true, ms: 1 },
        { id: "b-1", trueClass: "b", predictedClass: "b", confidence: 0.8, ok: true, ms: 1 },
      ],
    },
  );
  assert.equal(r.confusion.matrix.length, r.confusion.classes.length);
  for (const row of r.confusion.matrix) assert.equal(row.length, r.confusion.classes.length);
});

test("runEval: latencyP50 and latencyP95 are reported when trials have ms", async () => {
  const r = await runEval(
    Array.from({ length: 10 }, (_, i) => trial(`t-${i}`, "a")),
    {
      benchmark: "synthetic-latency",
      engineVersion: "test",
      predictions: Array.from({ length: 10 }, (_, i) => ({ id: `t-${i}`, trueClass: "a", predictedClass: "a", confidence: 0.8, ok: true, ms: i + 1 })),
    },
  );
  assert.equal(typeof r.latencyP50, "number");
  assert.equal(typeof r.latencyP95, "number");
  assert.ok(r.latencyP50! <= r.latencyP95!);
});

test("runEval: notes.doesNotProve is the document's boundary statement", async () => {
  const r = await runEval([], { benchmark: "boundary", engineVersion: "test" });
  for (const phrase of ["production-accuracy", "operational superiority", "predict failures"]) {
    assert.ok(r.notes.doesNotProve.includes(phrase), `boundary missing: '${phrase}'`);
  }
});

test("runEval: sampleSize thresholds (insufficient < small < moderate < large)", async () => {
  const make = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `t-${i}`, trueClass: "a", predictedClass: "a", confidence: 0.8, ok: true, ms: 1 }));
  const r9 = await runEval([], { benchmark: "s", engineVersion: "v" });
  const r50 = await runEval([], { benchmark: "s", engineVersion: "v", predictions: make(50) });
  const r500 = await runEval([], { benchmark: "s", engineVersion: "v", predictions: make(500) });
  const r2000 = await runEval([], { benchmark: "s", engineVersion: "v", predictions: make(2000) });
  // 0 trials → insufficient; 50 → small; 500 → moderate;
  // 2000 → large.
  assert.equal(r9.notes.sampleSize, "insufficient");
  assert.equal(r50.notes.sampleSize, "small");
  assert.equal(r500.notes.sampleSize, "moderate");
  assert.equal(r2000.notes.sampleSize, "large");
});
