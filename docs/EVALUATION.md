# Evaluation

This document records what evaluation means in Aetheris, what the harness does today, and what the gap to a real benchmark looks like.

## Status today

The `src/core/diagnostics/eval.ts` module is a harness scaffold. It:

- Defines `LabelledTrial` (id, trueClass, signal, sampleRateHz, rotorRpm?, note?) and `EnginePrediction`.
- Provides pure scorers: `confusionMatrix`, `perClassMetrics`, `calibrationError`, percentiles.
- Provides a runner `runEval(trials, opts)` that returns an `EvalReport` with per-class precision/recall/F1, confusion matrix, calibration error, latency P50/P95, and a notes block that names what the report proves and what it does not prove.
- The runner maps the production `diagnose()` engine output to a class label. The mapping is honest: it reads the existing bearing-signature matches and the existing severity, and never invents a label.
- With zero trials the runner returns `accuracy = null` and the notes block says "No trials were provided. The harness does not invent accuracy from zero trials." This is the contract: no fake numbers.

The harness is testable: 17 tests in `tests/diagnostics-eval.test.ts` cover the scorers, the runner, the empty-trials branch, the boundary statement, and the sample-size thresholds.

## What the harness cannot do today

- It does not load a real benchmark. CWRU, Paderborn, IMS, and proprietary operator datasets are real, and we have none of them wired in.
- It does not claim production-accuracy. The notes block on every report explicitly says so.
- It does not predict failures. Detection is not prediction.

## What "wired in" looks like

For a real benchmark, the only file that changes is `src/app/accuracy/page.tsx` — replace the `syntheticTrials()` function with a loader that returns `LabelledTrial[]` from the chosen dataset. The harness code does not change. The page is already structured to render whatever the harness produces.

For the CWRU dataset, the loader would:
1. Download the CWRU 12 kHz / 48 kHz drive-end / fan-end files.
2. Map the dataset's fault codes to the engine's class names: normal, OR / IR / ball (3 fault diameters × 2 ends), and the bearing geometry.
3. Return one `LabelledTrial` per file with the right `trueClass` and `rotorRpm`.

For the Paderborn dataset, the same shape with the 32 bearings × 32 conditions grid.

For a proprietary operator dataset, the same shape behind an NDA-appropriate loader. The dataset owner and the harness are the only two components.

## What the page looks like with a real benchmark

- Per-class precision / recall / F1 with sample size, TP / FP / FN / TN, and a clear note on the bottom-of-the-table "this is N trials from dataset X, not a fleet-level claim."
- Confusion matrix as a 2D table, off-diagonal cells highlighted.
- Calibration error with a per-bucket breakdown.
- Latency P50 / P95.
- A banner: "These numbers are against a labelled benchmark. They do not claim production-accuracy on the user's fleet."

## Cost and timeline

Realistic for an honest v1:
- Public datasets (CWRU + Paderborn): 6 to 10 weeks of focused work.
- A proprietary operator dataset: multi-month engagement with NDA / procurement.

## What the document says

The architecture document is explicit:

> *"Real-time turbine fault diagnosis at production accuracy. Real SCADA/vibration/temperature histories with confirmed failures and maintenance outcomes. Accuracy cannot be invented from UI logic."*

The harness plumbing does not violate this. The boundary is in the `notes.doesNotProve` string. The page banner repeats the boundary. The synthetic-fixture smoke test runs end-to-end and produces real numbers, but the page is explicit that the smoke test is not a benchmark.

## Related documents

- `docs/SCOPE-FAULT-DIAGNOSIS.md` — the full scope for this Section-2 item.
- `/runbook` — the operator-facing runbook.
- `/capabilities` — the honest capabilities statement.
