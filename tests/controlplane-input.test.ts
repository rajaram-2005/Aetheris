/**
 * Input validation at the control-plane boundary.
 *
 * These are the regression tests for the request-body handling of the three control-plane surfaces:
 * `POST /api/control-plane`, `POST /api/incident` and `POST /api/test-lab`. All three used to cast an
 * untrusted body straight into a domain type with `as`, which typechecks and validates nothing.
 *
 * Each bug found in the audit gets a case here:
 *   1. `maxLoopbacks` was the only bound on the Phase 7 → Phase 3 recovery loop and arrived unchecked.
 *   2. `injectedFailure` had two competing definitions (a 4-value union in the supervisor and route, a
 *      3-value copy in the page) and was cast, never checked.
 *   3. `POST /api/incident` accepted `recommendedAction.requiresHumanSignoff` from the request body, so
 *      a caller could drop the signoff requirement from a physical derate recommendation.
 *   4. `POST /api/incident` replaced `telemetrySnapshot`/`recommendedAction` wholesale, so a partial
 *      payload blanked the other fields to `undefined` and the panel rendered "-undefined K".
 *   5. `POST /api/test-lab` spread an arbitrary object into a `FailureRecord` and keyed the store by
 *      `record.testId`; and `action: "record_failure"` with a missing failure silently ran the whole
 *      eight-category suite instead of reporting the mistake.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_MAX_LOOPBACKS,
  INJECTED_FAILURES,
  isInjectedFailure,
  MAX_LOOPBACKS_LIMIT,
  normalizeMaxLoopbacks,
} from "../src/core/controlplane/types";
import { DEFAULT_OBJECTIVE, parseControlPlaneRequest } from "../src/core/controlplane/request";
import { INCIDENT_SEVERITIES, sanitizeIncidentInput, triggerIncident } from "../src/core/controlplane/incident/command";
import { parseIncidentRequest } from "../src/core/controlplane/incident/request";
import { FAILURE_SEVERITIES, FAILURE_TYPES, sanitizeFailureInput } from "../src/core/controlplane/testlab/database";
import { parseTestLabRequest } from "../src/core/controlplane/testlab/request";
import { asEnum, asFiniteNumber, asInteger, asRecord, asString, asStringArray } from "../src/core/security/validate";

// ---------------------------------------------------------------------------- shared primitives

test("validate: primitives reject what they claim to and never throw", () => {
  assert.deepEqual(asRecord({}), {});
  assert.equal(asRecord([]), null, "an array is not a record");
  assert.equal(asRecord(null), null);
  assert.equal(asRecord("x"), null);

  assert.equal(asString("ok"), "ok");
  assert.equal(asString(""), "", "empty is a valid string; callers decide if it is useful");
  assert.equal(asString("toolong", 3), null);
  assert.equal(asString(7), null);
  assert.equal(asString("line\nbreak"), "line\nbreak", "newlines are allowed in free text");
  assert.equal(asString("null\u0000byte"), null, "control characters are rejected");

  assert.equal(asFiniteNumber(1.5), 1.5);
  assert.equal(asFiniteNumber(NaN), null);
  assert.equal(asFiniteNumber(Infinity), null);
  assert.equal(asFiniteNumber("3"), null, "a numeric string is not a number");
  assert.equal(asFiniteNumber(11, { max: 10 }), null);
  assert.equal(asInteger(3.5), null);
  assert.equal(asInteger(0, { min: 0, max: 12 }), 0, "0 is inside the range, not falsy-and-rejected");

  assert.equal(asEnum("critical", INCIDENT_SEVERITIES), "critical");
  assert.equal(asEnum("apocalyptic", INCIDENT_SEVERITIES), null);
  assert.equal(asEnum(1, INJECTED_FAILURES), null);

  assert.deepEqual(asStringArray(["RAVANA", "YANTRA"]), ["RAVANA", "YANTRA"]);
  assert.equal(asStringArray(["ok", 7]), null, "one bad item rejects the array");
  assert.equal(asStringArray(new Array(100).fill("x"), { maxItems: 32 }), null);
});

// ------------------------------------------------------------------ one canonical fault vocabulary

test("types: the fault-injection vocabulary has one definition and a runtime guard", () => {
  assert.deepEqual([...INJECTED_FAILURES], ["none", "missing_evidence", "contradiction", "safety_block"]);
  for (const v of INJECTED_FAILURES) assert.equal(isInjectedFailure(v), true, `${v} is canonical`);
  assert.equal(isInjectedFailure("banana"), false);
  assert.equal(isInjectedFailure(undefined), false);
  assert.equal(isInjectedFailure(0), false);
  assert.equal(isInjectedFailure("NONE"), false, "the vocabulary is case-sensitive");
});

test("types: normalizeMaxLoopbacks clamps every unsafe ceiling (regression: 1e9 loopbacks)", () => {
  assert.equal(normalizeMaxLoopbacks(undefined), DEFAULT_MAX_LOOPBACKS);
  assert.equal(normalizeMaxLoopbacks(1_000_000_000), MAX_LOOPBACKS_LIMIT, "the DoS payload is clamped, not honoured");
  assert.equal(normalizeMaxLoopbacks(-5), 0, "a negative ceiling cannot rewind the loop counter");
  assert.equal(normalizeMaxLoopbacks(NaN), DEFAULT_MAX_LOOPBACKS);
  assert.equal(normalizeMaxLoopbacks(Infinity), DEFAULT_MAX_LOOPBACKS);
  assert.equal(normalizeMaxLoopbacks("3"), DEFAULT_MAX_LOOPBACKS, "a numeric string is not a number");
  assert.equal(normalizeMaxLoopbacks(2.9), 2, "fractional ceilings are truncated down");
  assert.equal(normalizeMaxLoopbacks(0), 0, "0 is a legitimate ceiling: no recovery loop");
});

// --------------------------------------------------------------------------- /api/control-plane

test("parseControlPlaneRequest: a valid body passes through untouched", () => {
  const r = parseControlPlaneRequest({ request: "Inspect WTG-03 main bearing", maxLoopbacks: 2, injectedFailure: "contradiction" });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value, { request: "Inspect WTG-03 main bearing", maxLoopbacks: 2, injectedFailure: "contradiction" });
});

test("parseControlPlaneRequest: an empty body gets the documented defaults, not a rejection", () => {
  const r = parseControlPlaneRequest({});
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value, { request: DEFAULT_OBJECTIVE, maxLoopbacks: DEFAULT_MAX_LOOPBACKS, injectedFailure: "none" });
  const empty = parseControlPlaneRequest({ request: "" });
  assert.equal(empty.ok && empty.value.request, DEFAULT_OBJECTIVE, "an empty objective falls back to the default, as before");
});

test("parseControlPlaneRequest: 400 for a body that is not an object", () => {
  for (const bad of [null, undefined, "text", 42, [], true]) {
    const r = parseControlPlaneRequest(bad);
    assert.equal(r.ok, false, `${JSON.stringify(bad)} must be rejected`);
    if (!r.ok) {
      assert.equal(r.status, 400);
      assert.equal(r.errors[0].field, "body");
    }
  }
});

test("parseControlPlaneRequest: 422 naming every offending field (regression: unbounded loopbacks)", () => {
  const r = parseControlPlaneRequest({ request: 42, maxLoopbacks: 1_000_000_000, injectedFailure: "banana" });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 422);
    const fields = r.errors.map((e) => e.field).sort();
    assert.deepEqual(fields, ["injectedFailure", "maxLoopbacks", "request"], "all three are reported in one pass");
    assert.match(r.errors.find((e) => e.field === "maxLoopbacks")!.message, /between 0 and 10/);
    assert.match(r.errors.find((e) => e.field === "injectedFailure")!.message, /none, missing_evidence, contradiction, safety_block/);
  }
});

test("parseControlPlaneRequest: the loopback ceiling and the objective length are both bounded", () => {
  assert.equal(parseControlPlaneRequest({ maxLoopbacks: MAX_LOOPBACKS_LIMIT }).ok, true, "the ceiling itself is accepted");
  assert.equal(parseControlPlaneRequest({ maxLoopbacks: MAX_LOOPBACKS_LIMIT + 1 }).ok, false, "one past the ceiling is not");
  assert.equal(parseControlPlaneRequest({ maxLoopbacks: 3.5 }).ok, false, "a fractional ceiling is not");
  assert.equal(parseControlPlaneRequest({ request: "x".repeat(8_001) }).ok, false, "an 8001-character objective is not");
  assert.equal(parseControlPlaneRequest({ request: "x".repeat(8_000) }).ok, true, "8000 is inside the limit");
  assert.equal(parseControlPlaneRequest({ request: "st\u0000op" }).ok, false, "control characters are not");
});

// ------------------------------------------------------------------------------- /api/incident

test("parseIncidentRequest: trigger is the default action and clear is explicit", () => {
  const t = parseIncidentRequest({});
  assert.equal(t.ok && t.value.action, "trigger");
  const c = parseIncidentRequest({ action: "clear" });
  assert.equal(c.ok && c.value.action, "clear");
});

test("parseIncidentRequest: 422 for an invented action, 400 for a non-object body", () => {
  const bad = parseIncidentRequest({ action: "detonate" });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.status, 422);
    assert.match(bad.errors[0].message, /trigger, clear/);
  }
  const notObj = parseIncidentRequest(null);
  assert.equal(notObj.ok, false);
  if (!notObj.ok) assert.equal(notObj.status, 400);
  const badData = parseIncidentRequest({ incidentData: "WTG-04" });
  assert.equal(badData.ok, false);
  if (!badData.ok) assert.equal(badData.errors[0].field, "incidentData");
});

test("sanitizeIncidentInput: typed fields survive, everything else is reported as ignored", () => {
  const { incident, ignored } = sanitizeIncidentInput({
    assetId: "WTG-08",
    severity: "high",
    currentPhase: 9,
    telemetrySnapshot: { vib_bearing_mms: 12.4, rotor_rpm: "fast" },
    activeAgents: ["RAVANA"],
    inventedField: "nope",
  });
  assert.equal(incident.assetId, "WTG-08");
  assert.equal(incident.severity, "high");
  assert.equal(incident.currentPhase, 9);
  assert.deepEqual(incident.activeAgents, ["RAVANA"]);
  assert.deepEqual(incident.telemetrySnapshot, { vib_bearing_mms: 12.4 }, "the finite reading is kept, the string is dropped");
  assert.ok(ignored.some((i) => i.startsWith("telemetrySnapshot.rotor_rpm")), "the dropped reading is reported");
  assert.ok(ignored.some((i) => i.startsWith("inventedField")), "an unknown field is reported, not silently kept");
});

test("sanitizeIncidentInput: closed vocabularies and server-controlled fields are enforced", () => {
  assert.equal(sanitizeIncidentInput({ severity: "apocalyptic" }).incident.severity, undefined);
  assert.ok(sanitizeIncidentInput({ severity: "apocalyptic" }).ignored.some((i) => i.startsWith("severity")));
  assert.equal(sanitizeIncidentInput({ currentPhase: 13 }).incident.currentPhase, undefined, "phase ids run 0-12");
  assert.equal(sanitizeIncidentInput({ currentPhase: 0 }).incident.currentPhase, 0, "phase 0 is valid, not falsy");

  // `IncidentInput` does not declare these three at all, so a typed caller cannot even express them.
  // The assertion is therefore about the untyped JSON boundary: what survives sanitization.
  const server = sanitizeIncidentInput(JSON.parse('{"incidentId":"inc_forged","active":false,"timestamp":1}'));
  assert.deepEqual(Object.keys(server.incident), [], "no server-controlled field survives sanitization");
  assert.equal("incidentId" in server.incident, false, "a caller cannot choose the incident id");
  assert.equal("active" in server.incident, false, "a caller cannot mark the incident inactive by injection");
  assert.equal("timestamp" in server.incident, false, "a caller cannot backdate the incident");
  assert.equal(server.ignored.length, 3, "each attempt is reported");
});

/**
 * The safety gate is enforced twice, and both layers are tested:
 *   - structurally: `IncidentInput["recommendedAction"]` omits `requiresHumanSignoff`, so a typed
 *     caller cannot supply it (this file would not compile if it tried);
 *   - at runtime: a JSON body that does supply it is refused, reported, and then overridden.
 */
test("sanitizeIncidentInput: requiresHumanSignoff is never accepted from a request body (regression: safety gate)", () => {
  const { incident, ignored } = sanitizeIncidentInput(
    JSON.parse('{"recommendedAction":{"action":"Derate WTG-04 by 15%","requiresHumanSignoff":false}}'),
  );
  assert.equal("requiresHumanSignoff" in (incident.recommendedAction ?? {}), false, "the flag is not carried into the incident");
  assert.equal(incident.recommendedAction?.action, "Derate WTG-04 by 15%", "the rest of the recommendation still survives");
  assert.ok(
    ignored.some((i) => i.includes("requiresHumanSignoff") && i.includes("always requires signoff")),
    `the rejection must be explicit, got: ${ignored.join("; ")}`,
  );
});

test("triggerIncident: a physical recommendation always requires human signoff", () => {
  // Straight from a hostile body, through the sanitizer, into the engine.
  const hostile = sanitizeIncidentInput(JSON.parse('{"recommendedAction":{"requiresHumanSignoff":false}}'));
  const forced = triggerIncident(hostile.incident);
  assert.equal(forced.recommendedAction.requiresHumanSignoff, true, "a caller-supplied false cannot reach the incident");

  // And by direct construction, bypassing the sanitizer entirely — the engine is the last gate.
  const direct = triggerIncident({ recommendedAction: { action: "Derate by 20%" } });
  assert.equal(direct.recommendedAction.requiresHumanSignoff, true);
  assert.equal(direct.recommendedAction.deratePct, 15, "unsupplied action fields keep their defaults");

  const defaulted = triggerIncident({});
  assert.equal(defaulted.recommendedAction.requiresHumanSignoff, true);
  assert.equal(defaulted.assetId, "WTG-04");
});

test("triggerIncident: a partial payload fills gaps from defaults instead of blanking them (regression: -undefined K)", () => {
  const inc = triggerIncident({ telemetrySnapshot: { rotor_rpm: 1400 }, recommendedAction: { action: "Derate by 10%" } });
  assert.equal(inc.telemetrySnapshot.rotor_rpm, 1400, "the supplied reading wins");
  assert.equal(inc.telemetrySnapshot.vib_bearing_mms, 8.4, "the unsupplied readings keep their defaults");
  assert.equal(inc.telemetrySnapshot.threshold_mms, 7.1);
  assert.equal(inc.recommendedAction.action, "Derate by 10%");
  assert.equal(inc.recommendedAction.deratePct, 15, "the unsupplied action fields keep their defaults");
  for (const [k, v] of Object.entries(inc.telemetrySnapshot)) assert.equal(typeof v, "number", `${k} must be a number, got ${String(v)}`);
  for (const [k, v] of Object.entries(inc.recommendedAction)) assert.notEqual(v, undefined, `${k} must not be undefined`);
});

test("sanitizeIncidentInput: a timeline is validated entry by entry", () => {
  const { incident, ignored } = sanitizeIncidentInput({
    timeline: [
      { time: "02:11:04Z", event: "Vibration crossed threshold", severity: "critical" },
      { time: "02:11:09Z", event: "missing severity" },
      { time: "02:11:12Z", event: "invented severity", severity: "panic" },
    ],
  });
  assert.equal(incident.timeline?.length, 1, "only the well-formed entry is kept");
  assert.equal(incident.timeline?.[0].severity, "critical");
  assert.equal(ignored.filter((i) => i.startsWith("timeline[")).length, 2, "both bad entries are reported");
  assert.equal(sanitizeIncidentInput({ timeline: "not an array" }).incident.timeline, undefined);
});

// -------------------------------------------------------------------------------- /api/test-lab

/** A complete, valid failure payload. Every negative case below mutates exactly one field. */
const VALID_FAILURE = {
  testId: "regression-loopback-ceiling",
  phase: 7,
  core: "OUTER_CONTROL_PLANE_CRITIC",
  input: { objective: "WTG-04 gearbox" },
  expected: "loopbackCount <= 10",
  actual: "loopbackCount unbounded",
  failureType: "invariant_breach",
  rootCause: "maxLoopbacks arrived from the request body unchecked",
  severity: "critical",
  fix: "clamp in the supervisor and reject out-of-range values at the route",
  regressionTest: "tests/controlplane-supervisor.test.ts",
};

test("parseTestLabRequest: an absent or explicit run_suite action runs the suite", () => {
  assert.deepEqual(parseTestLabRequest({}), { ok: true, value: { action: "run_suite" } });
  assert.deepEqual(parseTestLabRequest({ action: "run_suite" }), { ok: true, value: { action: "run_suite" } });
});

test("parseTestLabRequest: 422 for an invented action, 400 for a non-object body", () => {
  const bad = parseTestLabRequest({ action: "delete_everything" });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.status, 422);
    assert.match(bad.errors[0].message, /run_suite, record_failure/);
  }
  const notObj = parseTestLabRequest("nope");
  assert.equal(notObj.ok, false);
  if (!notObj.ok) assert.equal(notObj.status, 400);
});

test("parseTestLabRequest: record_failure without a failure is a 422, not a silent full suite run (regression)", () => {
  const r = parseTestLabRequest({ action: "record_failure" });
  assert.equal(r.ok, false, "the old behaviour fell through and ran eight categories of tests");
  if (!r.ok) {
    assert.equal(r.status, 422);
    assert.equal(r.errors[0].field, "failure");
  }
});

test("sanitizeFailureInput: a complete payload is accepted and typed", () => {
  const r = sanitizeFailureInput(VALID_FAILURE);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.value.testId, VALID_FAILURE.testId);
    assert.equal(r.value.phase, 7);
    assert.equal(r.value.failureType, "invariant_breach");
    assert.equal(r.value.severity, "critical");
    assert.deepEqual(r.value.input, { objective: "WTG-04 gearbox" });
    assert.equal("createdAt" in r.value, false, "server-owned fields are not caller-settable");
    assert.equal("resolved" in r.value, false);
  }
});

test("sanitizeFailureInput: every required field is required, and the vocabularies are closed", () => {
  for (const field of Object.keys(VALID_FAILURE)) {
    if (field === "input") continue; // optional, defaults to {}
    const partial = { ...VALID_FAILURE } as Record<string, unknown>;
    delete partial[field];
    const r = sanitizeFailureInput(partial);
    assert.equal(r.ok, false, `a failure without ${field} must be rejected`);
    if (!r.ok) assert.ok(r.errors.some((e) => e.field === field), `the error must name ${field}: ${JSON.stringify(r.errors)}`);
  }

  assert.equal(sanitizeFailureInput({ ...VALID_FAILURE, failureType: "vibes" }).ok, false, "an invented failure type would create a tenth statistics category");
  assert.equal(sanitizeFailureInput({ ...VALID_FAILURE, severity: "apocalyptic" }).ok, false);
  assert.equal(sanitizeFailureInput({ ...VALID_FAILURE, phase: 13 }).ok, false, "phase ids run 0-12");
  assert.equal(sanitizeFailureInput({ ...VALID_FAILURE, phase: "7" }).ok, false, "a numeric string is not a phase id");
  assert.equal(sanitizeFailureInput({ ...VALID_FAILURE, phase: 0 }).ok, true, "phase 0 is valid");
  assert.equal(sanitizeFailureInput({ ...VALID_FAILURE, testId: 42 }).ok, false, "a non-string id would collide in the store");
  assert.equal(sanitizeFailureInput({ ...VALID_FAILURE, testId: "" }).ok, false, "an empty id would collide in the store");
  assert.equal(sanitizeFailureInput({ ...VALID_FAILURE, input: "not an object" }).ok, false);
  assert.equal(sanitizeFailureInput({ ...VALID_FAILURE, input: { blob: "x".repeat(20_000) } }).ok, false, "the evidence blob is capped");
  assert.equal(sanitizeFailureInput(VALID_FAILURE).ok, true, "and the valid payload still passes after all of that");
});

test("testlab: the failure vocabularies are runtime values, so guard and union cannot drift", () => {
  assert.equal(FAILURE_TYPES.length, 10);
  assert.ok(FAILURE_TYPES.includes("invariant_breach"));
  assert.deepEqual([...FAILURE_SEVERITIES], ["critical", "warning", "advisory"]);
});
