# Wind Turbine — Asset Model & Plan Gate

A typed vocabulary and a deterministic three-stage gate that an agent uses to ask
"if I do X, will my turbine stay safe?" and get a structured answer.

## What it is

A **canonical 2 MW wind-turbine asset model** with a small, well-typed vocabulary
for every channel (rotor_rpm, T_gearbox_K, vib_bearing_mms, …) and a set of
first-order rule-based physics rules. A proposed plan is gated through three
stages:

1. **Digital-twin simulator** — the existing `../twins/twins.ts#simulate()`
   forward-propagates the turbine's state under the proposed interventions
   using the rule set in `./model.ts`.
2. **Neurosymbolic Verifier** — the existing `../symbolic/constraints.ts`
   checks the plan symbolically with SI unit consistency, per-step guards, and
   global invariants.
3. **Optional PBNN** — when a `HealthPredictor` is supplied, the learned model
   scores the predicted end-of-plan health and rejects if it falls below a
   threshold.

The gate returns an `accept` verdict (or a structured `reject` with the failing
step, the reason, the per-step trajectory, and the breach list).

## What it is NOT

- **Not a CFD or FEA solver.** The forward model is first-order linearised:
  gear ratios, simple heat balance, exponential-smoothed vibration, no fluid
  dynamics. It is suitable for agent reasoning over first-order trade-offs; it
  is **not** an engineering certification tool.
- **Not a wind-resource library.** No Weibull fit, no power-curve regression,
  no actual meteorological data ingestion.
- **Not a controller.** It does not write back to the physical device. The
  actuation path is the existing `device:gateway` capability with its E-stop,
  interlocks, and the `physical` opt-in grant.

## API

```
GET  /api/windturbine                  list the user's canonical wind-turbine twins
POST /api/windturbine  { op: "canon",  id, name, initialState?, deviceIds? }
POST /api/windturbine  { op: "plan",   twinId?, interventions, stepsPerIntervention?, globalInvariants? }
```

### Plan example

```json
{
  "op": "plan",
  "interventions": [
    { "id": "derate",  "effects": { "derate_pct": 50 }, "invariants": ["T_gearbox_K < 360"] },
    { "id": "wait",    "effects": {},                     "guards": ["T_gearbox_K < 350"] }
  ],
  "stepsPerIntervention": 5
}
```

The response is `{ ok, trajectory, breaches, prediction, rawSimulation, symbolic }`.

## Files

- `src/core/windturbine/model.ts`  — vocabulary, bounds, rule-based physics
- `src/core/windturbine/plan.ts`   — `planAndGate()` and the `InterventionStep` shape
- `src/app/api/windturbine/route.ts` — REST surface
- `tests/windturbine.test.ts`      — 18 end-to-end tests, all green

## Extending

To add a new channel:

1. Add it to `ChannelId` in `model.ts`.
2. Add its SI unit to `UNITS`.
3. If it has a safety bound, add it to `DEFAULT_BOUNDS` with `critical: true`
   and to `CRITICAL_BOUND_KEYS`.
4. Add a starting value in `canonicalTurbineTwin()`.
5. If it has physics, add a rule in `DEFAULT_RULES`. The rule DSL is the
   existing `../twins/twins.ts#evalExpr` arithmetic (numbers, identifiers,
   + - * / %, `min`, `max`, `abs`, `clamp`, `sqrt`); there is no `^` operator
   — write `x*x` for `x^2`.

## Status

**EXPERIMENTAL.** Listed in the capability registry as `domain:wind-turbine`,
honestly reflecting that the physics is a small first-order approximation.
Real engineering decisions still need full CFD/FEA.
