/**
 * Phase 6 (hosted media/lab): the lab deploys ephemerally and refuses docker fast on hosted
 * instances; video perception records which ffmpeg path it took as telemetry.
 */
import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { labDeployDir, labStatus, runInLab } from "../src/core/lab/codesandbox";
import { issueConfirmation, principalFor } from "../src/core/policy/permissions";
import { perceive } from "../src/core/multimodal/perceive";
import { query } from "../src/core/observability/events";

const prevHosted = process.env.AETHERIS_HOSTED;
const prevDataDir = process.env.AETHERIS_DATA_DIR;
const prevDeployDir = process.env.AETHERIS_LAB_DEPLOY_DIR;

beforeEach(() => {
  process.env.AETHERIS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "aeth-hostedlab-"));
  delete process.env.AETHERIS_HOSTED;
  delete process.env.AETHERIS_LAB_DEPLOY_DIR;
});

afterEach(() => {
  if (prevHosted === undefined) delete process.env.AETHERIS_HOSTED; else process.env.AETHERIS_HOSTED = prevHosted;
  if (prevDataDir === undefined) delete process.env.AETHERIS_DATA_DIR; else process.env.AETHERIS_DATA_DIR = prevDataDir;
  if (prevDeployDir === undefined) delete process.env.AETHERIS_LAB_DEPLOY_DIR; else process.env.AETHERIS_LAB_DEPLOY_DIR = prevDeployDir;
});

test("lab deploy dir: explicit env wins, hosted uses ephemeral tmp, local uses the data dir", () => {
  assert.equal(labDeployDir(), path.join(process.env.AETHERIS_DATA_DIR!, "lab", "deployed"));
  process.env.AETHERIS_LAB_DEPLOY_DIR = "/custom/deploys";
  assert.equal(labDeployDir(), "/custom/deploys");
  delete process.env.AETHERIS_LAB_DEPLOY_DIR;
  process.env.AETHERIS_HOSTED = "1";
  assert.ok(labDeployDir().startsWith(tmpdir()), labDeployDir());
});

test("lab on hosted: docker fast-fails honestly, status reports ephemeral with no daemon probe", async () => {
  process.env.AETHERIS_HOSTED = "1";
  const st = await labStatus();
  assert.equal(st.docker, false);
  assert.equal(st.ephemeral, true);
  assert.ok(String(st.deployDir).startsWith(tmpdir()));
  const r = await runInLab({
    principal: principalFor("lab-u", { admin: true }),
    description: "hosted docker probe",
    language: "python",
    source: "print('hi')",
    runtime: "docker",
    confirmationToken: issueConfirmation("lab-u", "lab:run"),
  }, { uid: "lab-u" });
  assert.equal(r.ok, false);
  assert.equal(r.stoppedBecause, "docker_unavailable");
  assert.match(r.output, /unavailable on hosted\/serverless/);
});

test("video perception records which ffmpeg path it took", async () => {
  // Garbage bytes, no providers, no video keys: deterministic — either the ffmpeg binary rejects
  // the input or the container probe does. Both note the decision as telemetry.
  const r = await perceive({ modality: "video", data: Buffer.from("this is not a video file") });
  assert.equal(r.ok, false);
  const notes = query({ capability: "multimodal:video-path", limit: 10 });
  assert.ok(notes.length >= 1);
  assert.match(notes[0].detail ?? "", /^via=(ffmpeg|none) /);
  assert.equal(notes[0].ok, false);
});
