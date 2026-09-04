#!/usr/bin/env node
/**
 * aetheris-bridge — tiny HTTP ↔ serial daemon so Aetheris can talk to USB boards (Arduino, STM32, ESP32 over
 * USB) through the `http` device adapter. Runs on the machine the board is plugged into. Zero config beyond
 * the port. STATUS: IMPLEMENTED (protocol) — needs the `serialport` package and a real board to be exercised.
 *
 *   npm i serialport            (one-off, in this folder)
 *   node aetheris-bridge.mjs --port /dev/ttyUSB0 --baud 115200 --listen 8787 --token mysecret
 *
 * Firmware contract (newline-delimited JSON on the serial line):
 *   board → bridge :  {"temp":24.5,"relay":0}            any flat JSON object = latest state
 *   bridge → board :  {"relay":1}\n                       from POST /cmd (one or more capability:value pairs)
 *
 * HTTP contract (identical to what Aetheris expects from any http device):
 *   GET  /state         → {"ok":true,"state":{...},"age_ms":123}
 *   POST /cmd {"<capability>": value}  → {"ok":true,...} after the line is written (echoes state if the board replies within 500 ms)
 *   Authorization: Bearer <token>   required when --token is given
 * Register in Aetheris: adapter=http, address=http://<this-machine>:8787, auth.token=<token>.
 */
import http from "node:http";
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const PORT = arg("port"), BAUD = Number(arg("baud", 115200)), LISTEN = Number(arg("listen", 8787)), TOKEN = arg("token", "");
if (!PORT) { console.error("usage: aetheris-bridge.mjs --port /dev/ttyUSB0 [--baud 115200] [--listen 8787] [--token secret]"); process.exit(2); }
let SerialPort; try { ({ SerialPort } = await import("serialport")); } catch { console.error("serialport not installed: run `npm i serialport` in this folder"); process.exit(2); }

let state = {}, stateAt = 0, buf = "";
const sp = new SerialPort({ path: PORT, baudRate: BAUD });
sp.on("data", (d) => { buf += d.toString("utf8"); let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue; try { const j = JSON.parse(line); if (j && typeof j === "object") { state = { ...state, ...j }; stateAt = Date.now(); } } catch { /* non-JSON debug line */ } } });
sp.on("error", (e) => console.error("serial error:", e.message));

const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
http.createServer(async (req, res) => {
  if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, 401, { ok: false, error: "unauthorized" });
  if (req.method === "GET" && req.url === "/state") return json(res, 200, { ok: true, state, age_ms: stateAt ? Date.now() - stateAt : null, port: PORT });
  if (req.method === "POST" && req.url === "/cmd") {
    let body = ""; for await (const c of req) body += c; let cmd; try { cmd = JSON.parse(body || "{}"); } catch { return json(res, 400, { ok: false, error: "bad json" }); }
    if (!cmd || typeof cmd !== "object" || Object.keys(cmd).length === 0) return json(res, 400, { ok: false, error: "body must be {\"<capability>\": value}" });
    const before = stateAt;
    await new Promise((r, j) => sp.write(JSON.stringify(cmd) + "\n", (e) => (e ? j(e) : sp.drain(r)))).catch((e) => json(res, 502, { ok: false, error: e.message }));
    if (res.writableEnded) return;
    const t0 = Date.now(); while (Date.now() - t0 < 500 && stateAt === before) await new Promise((r) => setTimeout(r, 20));
    return json(res, 200, { ok: true, state, echoed: stateAt !== before });
  }
  json(res, 404, { ok: false, error: "GET /state or POST /cmd" });
}).listen(LISTEN, "0.0.0.0", () => console.log(`aetheris-bridge on :${LISTEN} ↔ ${PORT}@${BAUD}${TOKEN ? " (token required)" : ""}`));
