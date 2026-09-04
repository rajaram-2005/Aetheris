/**
 * Regenerates tests/fixtures/sample.mp4 with the in-process WASM ffmpeg.
 * Kept in tools/ so the fixture is reproducible without a host ffmpeg.
 *   npx tsx tools/gen-fixture.ts
 */
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const req = createRequire(import.meta.url);
const glue = req.resolve("@ffmpeg/core");
const dir = path.dirname(glue);
const src = `
const { parentPort, workerData } = require("node:worker_threads");
const path = require("node:path");
globalThis.self = globalThis;
globalThis.location = { href: require("node:url").pathToFileURL(path.join(workerData.dir, "ffmpeg-core.js")).href };
require(path.join(workerData.dir, "ffmpeg-core.js"))({
  locateFile: (f) => path.join(workerData.dir, f),
  wasmBinary: workerData.wasm,
  print: () => {}, printErr: () => {}, noInitialRun: true,
}).then((M) => {
  M.setLogger(() => {});
  const rc = M.exec(...workerData.args);
  const b = M.FS.readFile("/out.mp4");
  parentPort.postMessage({ rc, bytes: Buffer.from(b) });
}).catch((e) => parentPort.postMessage({ rc: -1, err: String(e).slice(0, 200) }));
`;
const w = new Worker(src, {
  eval: true,
  workerData: {
    dir,
    wasm: readFileSync(req.resolve("@ffmpeg/core/wasm")),
    // 3s, 160x120, 10fps, yuv420p: the smallest shape every decoder accepts.
    args: ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=3:size=160x120:rate=10", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "10", "/out.mp4"],
  },
});
w.once("message", (m: { rc: number; bytes?: Buffer; err?: string }) => {
  if (m.rc !== 0 || !m.bytes) { console.error("FAILED", m.err ?? m.rc); process.exit(1); }
  writeFileSync("tests/fixtures/sample.mp4", m.bytes);
  console.log("wrote tests/fixtures/sample.mp4", m.bytes.length, "bytes");
  w.terminate();
  process.exit(0);
});
w.once("error", (e) => { console.error("worker error", e.message); process.exit(1); });
