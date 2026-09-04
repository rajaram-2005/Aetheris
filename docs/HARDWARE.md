# Hardware & Physical AI

Aetheris treats the physical world as one more capability class — discoverable in the registry, permissioned (`physical` grant, never implied by any other level), observable (every read/actuation is an event), testable (dry-run `validate`), replaceable (adapters behind one interface).

```
 Sensor ──▶ Device adapter ──▶ Telemetry store ──▶ Digital twin (world model)
                                                        │
                                              Agent reasoning / automation
                                                        │
                       ┌──── Safety policy loop ────────┤
                       │  limits · interlocks · rate    │
                       │  freshness · confirmation      │
                       ▼                                │
 Actuator ◀── Device adapter ◀── Command ◀──────────────┘
      └──── read-back + verify + audit event
```

Nothing in this layer fabricates readings. If an adapter cannot reach the device, the API says so.

## Status by adapter

| Adapter | Boards / systems | Status |
|---|---|---|
| `http` | ESP32, Arduino (WiFi), Raspberry Pi, any device serving the JSON contract below; also `aetheris-bridge` | **IMPLEMENTED** — verified against an in-repo mock server |
| `mqtt` | any MQTT 3.1.1 broker (Mosquitto, EMQX, HiveMQ, Home Assistant, Tasmota devices) | **IMPLEMENTED** per spec, verified with an in-repo protocol mock; **UNVERIFIED** on a real broker from this sandbox. No TLS/WebSocket. |
| `modbus` | PLCs / RTUs over Modbus-TCP (FC01/03/04/05/06/16) | **IMPLEMENTED** per spec, verified with protocol mock; **UNVERIFIED** on a real PLC |
| `serial` | USB Arduino / STM32 / ESP32 | **NOT AVAILABLE in-process** (a Next.js server cannot own `/dev/tty*` reliably). Use `bridge/aetheris-bridge.mjs` and register it as `http`. |
| `opcua`, `can`, `ros2` | OPC-UA servers, CAN buses, ROS 2 | **NOT AVAILABLE** here (native SDKs). Interface is stable; ROS 2 is served separately via rosbridge — see `docs/ROBOTICS.md`. |

Source: `src/core/physical/devices.ts` (registry, adapters, safety loop), `src/core/physical/protocols.ts` (dependency-free MQTT/Modbus clients), `src/core/physical/interfaces.ts` (contracts + `checkSafety`).

## The `http` device contract (firmware side)

Any board that speaks this is a first-class Aetheris device:

```
GET  /state                    → 200 {"ok":true,"state":{"temp":24.5,"relay":0}, "age_ms":120}
POST /cmd  {"relay":1}                 → 200 {"ok":true}          body = {"<capability id>": value}
Authorization: Bearer <token>  (optional; set auth.token when registering)
```

Minimal ESP32 (Arduino core) sketch:

```cpp
#include <WiFi.h>
#include <WebServer.h>
WebServer srv(80); int relay = 0;
void setup() {
  pinMode(5, OUTPUT); WiFi.begin("ssid", "pass"); while (WiFi.status() != WL_CONNECTED) delay(200);
  srv.on("/state", HTTP_GET, [] { srv.send(200, "application/json", String("{\"ok\":true,\"state\":{\"relay\":") + relay + ",\"temp\":" + analogRead(34) * 0.1 + "}}"); });
  srv.on("/cmd", HTTP_POST, [] { String b = srv.arg("plain"); if (b.indexOf("\"relay\"") > 0) { relay = b.indexOf("\"value\":1") > 0; digitalWrite(5, relay); } srv.send(200, "application/json", "{\"ok\":true}"); });
  srv.begin();
}
void loop() { srv.handleClient(); }
```

## USB boards via `aetheris-bridge` (serial)

`bridge/aetheris-bridge.mjs` is a ~60-line daemon that runs on the machine the board is plugged into and exposes the http contract:

```bash
cd bridge && npm i serialport
node aetheris-bridge.mjs --port /dev/ttyUSB0 --baud 115200 --listen 8787 --token s3cret
```

Firmware prints one JSON object per line (`{"temp":24.5,"relay":0}`) and reads `{"relay":1}\n`. Register in Aetheris as `adapter=http, address=http://<host>:8787, auth.token=s3cret`. If Aetheris runs on a different host than the bridge, set `AETHERIS_ALLOW_PRIVATE_URLS=1` on the Aetheris server (LAN addresses are blocked by the SSRF guard by default).

Arduino sketch for the bridge contract:

```cpp
void setup() { Serial.begin(115200); pinMode(13, OUTPUT); }
void loop() {
  if (Serial.available()) { String l = Serial.readStringUntil('\n'); if (l.indexOf("\"relay\"") >= 0) digitalWrite(13, l.indexOf("\"value\":1") >= 0); }
  static unsigned long t; if (millis() - t > 1000) { t = millis(); Serial.print("{\"relay\":"); Serial.print(digitalRead(13)); Serial.print(",\"a0\":"); Serial.print(analogRead(A0)); Serial.println("}"); }
}
```

## MQTT devices

Register with `adapter=mqtt`, `address=mqtt://broker:1883`. `auth` holds `username`, `password`, and topic config: `stateTopic` (default `<base|name>/state`, JSON object payload) and `cmdTopic` (default `<base|name>/cmd/<capability>`); a capability can override its own topic with `map.topic`. Commands are published QoS 1 with the raw value (strings as-is, others JSON). TLS (`mqtts://`) and WebSocket transports are **NOT AVAILABLE** — put a local Mosquitto bridge in front if the broker requires them.

## Modbus/TCP (PLC, RTU, SCADA gateways)

`adapter=modbus`, `address=tcp://plc:502`, `auth.unit` (default 1). Each capability declares `map: {table: "holding"|"input"|"coil"|"discrete", addr, scale?}`. Reads use FC01/03/04 (`discrete` falls back to coil read); writes use FC05/06/16 and go through the full safety loop. Write to a PLC only after configuring interlocks — see below.

## Safety policy loop (mandatory, deterministic, tested)

Every actuation (`POST /api/devices/:id {op:"actuate"}`) passes, in order:

1. **Permission** — caller needs the `physical` grant (opt-in via `POST /api/devices/optin`, never granted by env) **and** a single-use confirmation token for `device:<id>.<capability>`.
2. **Known target** — device and capability exist and are `actuator`s.
3. **Limits** — value within the capability's `limits {min, max, unit, maxRatePerMin}`; the per-capability rate limit is enforced from the audit history.
4. **Interlocks** — `{when: {capability, op, value}, block: [capabilities], reason}` evaluated against the latest telemetry; a missing/stale reading fails closed.
5. **E-stop latch** — a latched device refuses everything except `reset` (which itself needs confirmation).
6. **Execute → read back → verify** — the adapter writes, then reads state; mismatch is reported as `verified:false`.
7. **Audit** — a `device` event with the decision, values and latency is recorded (visible in `/api/telemetry/audit`).

`{op:"validate"}` runs steps 2–5 without acting (read-only), so agents and automations can plan. `{op:"estop"}` needs the physical grant but **no confirmation** — stopping is never blocked by a dialog.

## Telemetry ingestion (device → Aetheris)

Devices behind NAT can push instead of being polled: `POST /api/devices/:id {op:"ingest", values:{...}}` with `Authorization: Bearer <auth.ingestToken>`. Telemetry feeds twins (`docs/ROBOTICS.md` → Digital twins) and automation `device` triggers.

## What is deliberately not here

* No cloud device registry / OTA firmware (out of scope).
* No PID or motion control loops inside Aetheris — the controller lives on the device; Aetheris sets setpoints and supervises.
* The `simulated` adapter exists for demos and tests; every reading it returns carries `_simulated: true` so it can never be mistaken for a real sensor.
