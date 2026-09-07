# Scope: Real-time turbine fault diagnosis at production accuracy

**Status:** planning. No code yet.
**Honest framing:** the engineering scope, the data requirements, the evaluation harness, what "done" means, and what the result does and does not prove. Nothing in this document is a build commitment.

This document exists because the user asked for the architecture document's Section-2 items, and Section 2 #3 is the one I have a defensible plan for. Every other Section-2 item is either unsafe to scope (#5 hardware actuation), requires research-level work I cannot honestly claim (#6 AGI), or requires domain data we do not have and cannot fabricate (#1, #2, #4, #7, #8, #9).

## What the document says, verbatim

> *"Real-time turbine fault diagnosis at production accuracy. Real SCADA/vibration/temperature histories with confirmed failures and maintenance outcomes. Accuracy cannot be invented from UI logic."*

The honest reading: NIRIKSHAN today runs FFT, anomaly detection, and PBNN. The numbers it produces are whatever the algorithms produce. **No** "X% accuracy" claim until there is a labelled benchmark.

## What "done" looks like, in three parts

### Part 1: A labelled benchmark dataset

The single thing that converts the diagnosis engine from "engineering" to "validated" is a benchmark. Required properties:

- **Real SCADA or vibration time series.** Not synthetic. Not a simulation. The benchmark is a record of what sensors actually saw, sampled at the rate the sensors actually ran, with the same gaps, drift, and noise a production system has.
- **Confirmed labels.** Every detection window must be matched to a maintenance record, work order, or field report that says what was actually wrong. The labels are the ground truth.
- **Per-fault coverage.** At minimum: outer-race bearing, inner-race bearing, ball/roller defect, gear mesh fault, imbalance, misalignment, looseness, cavitation (pumps), and "no fault" (healthy baseline). Imbalanced training data is a known failure mode; the dataset must have a documented positive-to-negative ratio.
- **Public or licensable.** Without that, the benchmark cannot be reproduced and the accuracy number cannot be audited.

Public candidates I would evaluate first, in order of how directly they match the NIRIKSHAN signal chain:

1. **CWRU bearing dataset** (Case Western Reserve University). Vibration signals at 12 kHz and 48 kHz from a 2-hp motor with seeded bearing faults. Long-established as a teaching benchmark. Real data, real labels. Small (≈30 trials).
2. **MFPT bearing dataset** (Machinery Failure Prevention Technology). Fault and baseline trials with documented load and speed conditions.
3. **Paderborn University bearing dataset.** ~32 bearings with 32 measured conditions each, well-documented fault modes. Larger and more recent.
4. **IMS / NASA bearing run-to-failure datasets.** Time-to-failure acceleration tests; useful for RUL-adjacent work but the labels are "time to failure" rather than fault class.
5. **A proprietary operator dataset.** This is the only path to *production* accuracy on a real fleet, and the only reason a vendor has any defensible claim at all. Procurement, NDA, and storage are real problems.

Each has trade-offs. CWRU is a teaching benchmark; Paderborn is closer to a production signal; a proprietary dataset is what the document's "real SCADA/vibration/temperature histories" actually means.

### Part 2: An evaluation harness

NIRIKSHAN today exports:
- `diagnose(signal, opts)` from `src/core/diagnostics/engine.ts` — returns severity, peak magnitude, dominant frequency, top fault, bearing-signature matches.
- `analyzeSeries(series, z)` from `src/core/multimodal/perceive.ts` — z-score anomaly on a time series.
- `detectChannel(twinId, channel, z, limit)` from `src/core/anomaly/detector.ts` — PBNN-fitted residual anomaly detection.
- `predictNext(opts)` from `src/core/learning/predictions.ts` — PBNN forecast.
- `matchBearingSignatures(spectrum, rotorRpm, tolerance)` from `src/core/diagnostics/fft.ts` — frequency-domain fault matcher.

The harness wraps these. For each labelled trial in the benchmark:

1. Load the signal at the rate the benchmark specifies.
2. Decimate if NIRIKSHAN's sample-rate assumption (configurable) differs.
3. Run the FFT.
4. Run the bearing-signature matcher at the documented rotor speed.
5. Run the anomaly detector.
6. Run the PBNN predictor.
7. Score the result against the label.
8. Record per-trial: predicted class, true class, confidence, ms, ok-flag.

The harness reports:
- **Per-class precision, recall, F1** (against the labelled ground truth).
- **Confusion matrix** (which faults the engine confuses with which).
- **Calibration** (do the engine's confidence scores match its empirical accuracy?).
- **Latency** (ms per trial at the production input length).
- **Failure cases** (which signals the engine got wrong, and why — typically SNR, decimation, or rare fault modes).

These are the **only** numbers that earn the word "accuracy" for the engine. The "engineering" claim today is honest: the engine runs, the numbers come out. The "validated" claim requires this harness run against a labelled benchmark.

### Part 3: A live `accuracy` page

A new page, `/accuracy`, server-rendered, that:

- Names the benchmark (CWRU, Paderborn, or proprietary).
- Names the version of NIRIKSHAN that produced the numbers.
- Shows the per-class precision/recall/F1, the confusion matrix, the calibration curve, the latency distribution.
- Names the date the harness ran and the git SHA.
- Has a single banner: **"These numbers are against a labelled benchmark. They do not claim production-accuracy on the user's fleet, which depends on sensor quality, label quality, and fault coverage."**

This is the page that the architecture document's "do not claim" caveat points at. With it, the system can say what the engine can do, against which data, with what confidence. Without it, the system can only say "the engine runs."

## What this would cost, in time and effort

This is not a "build in an afternoon" item. The cost has three parts:

1. **Data acquisition.** CWRU and Paderborn are free; downloading and formatting them is days. A proprietary operator dataset is months of negotiation, NDA, and procurement, and may not be available at any price. Realistically, the harness ships against the public datasets first.
2. **Harness build.** The harness itself is one to two weeks of engineering: signal loading, decimation, the per-trial scorer, the report generator, the `/accuracy` page. This is real work and it is buildable today, on the existing NIRIKSHAN code.
3. **Validation.** Running the harness, reading the per-class numbers, identifying which faults the engine misses, deciding whether the misses are data-driven (more labelled trials needed) or algorithm-driven (the matcher is wrong about a fault class). This is the part that takes the most time, and it is the part that *must not be skipped*.

A defensible v1 — CWRU + Paderborn, no proprietary data, full harness, honest `/accuracy` page — is **realistic in 6 to 10 weeks of focused work**. A v2 with a real operator dataset is a procurement problem and a multi-month engagement.

## What this scope does NOT include

- **Real-time at sub-second latency.** A "production" claim requires benchmarking against the operator's actual sensor rate and the operator's pipeline budget. The harness measures latency but the deployment decision is the operator's.
- **Production-accuracy on the operator's fleet.** The CWRU and Paderborn benchmarks are academic. They tell you the engine works on academic data. Whether it works on the operator's fleet is a different question, and the only honest answer is "we do not know until we benchmark it on the operator's data."
- **RUL prediction.** That is a separate Section-2 item (#4), with its own data requirements and its own plan.
- **A claim that the engine "predicts" failures.** Detection is not prediction. The document is explicit about this: detection looks back at a known signal; prediction requires labelled degradation trajectories and a model that has been trained to forecast them. The CWRU/Paderborn path is detection, not prediction.

## The honest claim we could make after this scope

> *"Aetheris's NIRIKSHAN engine, evaluated against the CWRU and Paderborn bearing benchmarks on N trials, achieves per-class precision/recall/F1 of [numbers] with a calibration error of [number] and a median latency of [ms]. These numbers are against labelled academic data; they are not a guarantee of production accuracy on any specific fleet. The engine does not predict failures; it classifies observed signals."*

That sentence is the boundary. Everything to the left of it is honest. Everything to the right of it would be fabrication.

## The honest claim we would still NOT be able to make

- "Aetheris predicts gearbox failure with 93% accuracy." (Cannot claim without an RUL-specific labelled dataset.)
- "Aetheris is operationally superior to the operator's incumbent." (Cannot claim without controlled experiments on the operator's fleet.)
- "Aetheris understands physics like a human engineer." (Cannot claim; the engine does not reason about physics, it matches frequencies.)
- "Aetheris autonomously controls the turbine." (Cannot claim; the `physical` permission is off by default.)

## What I will and will not do

**Will do, today, in this PR, if you want it:**

- The eval harness scaffold. Empty functions, real signatures, real test that loads a synthetic labelled trial and runs the engine. No claim of accuracy. Just the harness plumbing.
- A stub `/accuracy` page that says "no benchmark configured yet" until a real one is wired in.
- A `docs/EVALUATION.md` that records the data-acquisition plan above.

**Will not do, today, in this PR, even if asked:**

- Publish an accuracy number without a benchmark to back it.
- Pretend the CWRU dataset gives the engine a "production" claim.
- Wire NIRIKSHAN into a real-time control loop.

**Will not do at all, in any PR, unless you bring the data:**

- Make any of the four "would still not be able to make" claims above.

## Decision

If you want me to ship the harness scaffold + `/accuracy` page stub + `docs/EVALUATION.md` as a real, tested, Section-3-honest first slice, tell me and I'll do it in this round. If you want me to scope one of the other Section-2 items instead, tell me which and I'll write a similar document. If you want both the harness scaffold and a scope doc for a second item, tell me which second.

If you want me to invent a number, I still won't.
