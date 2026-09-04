import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
process.env.AETHERIS_DATA_DIR = mkdtempSync(path.join(tmpdir(), "aeth-phys-"));
import { MqttClient, ModbusTcp, mqttPacket, modbusFrame } from "../src/core/physical/protocols";
import { validateActuation, registerDevice, actuate, estop, readDevice, type Device } from "../src/core/physical/devices";

test("MQTT packets encode/decode and round-trip against a minimal broker", async () => {
  const c = mqttPacket.connect("cid", { username: "u", password: "p" }); assert.equal(c[0], 0x10); assert.equal(c.subarray(2, 8).toString("latin1"), "\u0000\u0004MQTT");
  const p = mqttPacket.publish("a/b", "hi", { qos: 1, id: 7 }); const parsed = mqttPacket.parse(p); assert.equal(parsed.packets[0].type, 3);
  const dp = mqttPacket.decodePublish(parsed.packets[0].flags, parsed.packets[0].body); assert.equal(dp.topic, "a/b"); assert.equal(dp.id, 7); assert.equal(dp.payload.toString(), "hi");
  // mini broker: CONNACK, SUBACK, PUBACK, and echo publishes back to subscribers
  const subs: net.Socket[] = [];
  const broker = net.createServer((s) => { let buf: Buffer = Buffer.alloc(0); s.on("data", (d) => { buf = Buffer.concat([buf, d]); const { packets, rest } = mqttPacket.parse(buf); buf = rest; for (const pk of packets) { if (pk.type === 1) s.write(Buffer.from([0x20, 2, 0, 0])); else if (pk.type === 8) { subs.push(s); s.write(Buffer.from([0x90, 3, pk.body[0], pk.body[1], 0])); } else if (pk.type === 3) { const m = mqttPacket.decodePublish(pk.flags, pk.body); if (m.qos === 1) s.write(Buffer.from([0x40, 2, m.id! >> 8, m.id! & 255])); for (const x of subs) x.write(mqttPacket.publish(m.topic, m.payload)); } else if (pk.type === 12) s.write(Buffer.from([0xd0, 0])); } }); });
  await new Promise<void>((r) => broker.listen(0, "127.0.0.1", r)); const port = (broker.address() as net.AddressInfo).port;
  const client = new MqttClient("127.0.0.1", port, { username: "u", password: "p" }); await client.connect();
  const got = new Promise<string>((r) => client.subscribe(["dev/state"], (_t, pl) => r(pl.toString())));
  await new Promise((r) => setTimeout(r, 20)); await client.publish("dev/state", '{"temp":21}', { qos: 1 });
  assert.equal(await got, '{"temp":21}'); client.close(); broker.close();
});

test("Modbus/TCP frames + client against a mock PLC", async () => {
  const regs = new Array<number>(20).fill(0); regs[3] = 1234; const coils = new Array<boolean>(16).fill(false);
  const plc = net.createServer((s) => s.on("data", (d) => { const tid = d.readUInt16BE(0), unit = d[6], fc = d[7], addr = d.readUInt16BE(8);
    if (fc === 3 || fc === 4) { const qty = d.readUInt16BE(10); const data = Buffer.alloc(1 + qty * 2); data[0] = qty * 2; for (let i = 0; i < qty; i++) data.writeUInt16BE(regs[addr + i] ?? 0, 1 + i * 2); s.write(modbusFrame.build(tid, unit, fc, data)); }
    else if (fc === 1) { const qty = d.readUInt16BE(10); const data = Buffer.alloc(1 + Math.ceil(qty / 8)); data[0] = data.length - 1; for (let i = 0; i < qty; i++) if (coils[addr + i]) data[1 + (i >> 3)] |= 1 << (i & 7); s.write(modbusFrame.build(tid, unit, 1, data)); }
    else if (fc === 6) { regs[addr] = d.readUInt16BE(10); s.write(d); } else if (fc === 5) { coils[addr] = d.readUInt16BE(10) === 0xff00; s.write(d); }
    else if (fc === 16 && addr > 15) { s.write(Buffer.concat([d.subarray(0, 4), Buffer.from([0, 3, unit, fc | 0x80, 2])])); } }));
  await new Promise<void>((r) => plc.listen(0, "127.0.0.1", r)); const port = (plc.address() as net.AddressInfo).port;
  const m = new ModbusTcp("127.0.0.1", port, 1);
  assert.deepEqual(await m.readHolding(2, 3), [0, 1234, 0]);
  await m.writeRegister(5, 777); assert.deepEqual(await m.readHolding(5, 1), [777]);
  await m.writeCoil(2, true); assert.deepEqual(await m.readCoils(0, 4), [false, false, true, false]);
  await assert.rejects(() => m.writeRegisters(40, [1]), /illegal data address/);
  plc.close();
});

test("safety policy: limits, interlocks, latch, rate; actuate via simulated adapter with readback", async () => {
  const dev: Device = { id: "d1", uid: "u", name: "boiler", kind: "plc", adapter: "simulated", address: "sim", capabilities: [{ id: "temp", kind: "sensor" }, { id: "valve", kind: "actuator", limits: { min: 0, max: 100, unit: "%", maxRatePerMin: 2 } }, { id: "pump", kind: "actuator" }], interlocks: [{ id: "overtemp", when: { capability: "temp", op: ">", value: 90 }, block: ["valve"], reason: "boiler over 90°C" }], health: { state: "unknown" }, latched: false, tags: [], createdAt: 0, updatedAt: 0 };
  assert.equal(validateActuation(dev, "valve", 50, { temp: 40 }).allow, true);
  assert.match(validateActuation(dev, "valve", 150, { temp: 40 }).reasons[0], /above max/);
  assert.match(validateActuation(dev, "valve", 50, { temp: 95 }).reasons[0], /overtemp/);
  assert.match(validateActuation(dev, "valve", 50, undefined).reasons[0], /no reading/);
  assert.match(validateActuation(dev, "temp", 1, {}).reasons[0], /not an actuator/);
  assert.match(validateActuation({ ...dev, latched: true }, "pump", 1, {}).reasons[0], /E-STOP/);
  const d = await registerDevice("u", { name: "sim", adapter: "simulated", address: "sim", capabilities: [{ id: "level", kind: "sensor" }, { id: "pump", kind: "actuator", limits: { min: 0, max: 1 } }], stopCommand: { capability: "pump", value: 0 } });
  await readDevice(d);
  const r = await actuate(d, "pump", 1, { by: "test" }); assert.equal(r.ok, true); assert.equal(r.verified, true);
  const e = await estop(d, "test"); assert.equal(e.latched, true); assert.equal(e.stopSent, true);
  await assert.rejects(() => actuate(d, "pump", 1, { by: "test" }), /E-STOP/);
  const unsupported = await registerDevice("u", { name: "plc2", adapter: "opcua", address: "opc.tcp://x" }); assert.equal(unsupported.health.state, "error");
});

test("rosbridge client against a mock server; governor clamps and geofences", async () => {
  const { RosBridge, governTwist, DEFAULT_SAFETY, RobotAgent } = await import("../src/core/robotics/rosbridge");
  const g = governTwist({ linear: 2, angular: -3 }, DEFAULT_SAFETY); assert.equal(g.linear, 0.3); assert.equal(g.angular, -0.8); assert.equal(g.clamped, true);
  const fence = { ...DEFAULT_SAFETY, geofence: { xMin: -1, xMax: 1, yMin: -1, yMax: 1 } };
  assert.equal(governTwist({ linear: 0.2, angular: 0 }, fence, { x: 1, y: 0, yaw: 0 }).linear, 0);        // at east wall heading east → stop
  assert.equal(governTwist({ linear: 0.2, angular: 0 }, fence, { x: 1, y: 0, yaw: Math.PI }).linear, 0.2); // heading back inside → ok
  // real rosbridge JSON protocol over a minimal in-process WebSocket server
  const { miniWsServer } = await import("./helpers/miniws");
  const srv = await miniWsServer((m, send) => {
    if (m.op === "call_service" && m.service === "/rosapi/topics") send({ op: "service_response", id: m.id, service: m.service, result: true, values: { topics: ["/cmd_vel", "/odom"], types: ["geometry_msgs/msg/Twist", "nav_msgs/msg/Odometry"] } });
    if (m.op === "call_service" && m.service === "/fail") send({ op: "service_response", id: m.id, result: false, values: "boom" });
    if (m.op === "subscribe" && m.topic === "/odom") send({ op: "publish", topic: "/odom", msg: { pose: { pose: { position: { x: 1, y: 2 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } } } });
  });
  const ros = new RosBridge(srv.url); await ros.connect();
  assert.deepEqual((await ros.topics()).map((t) => t.topic), ["/cmd_vel", "/odom"]);
  await assert.rejects(() => ros.call("/fail"), /boom/);
  const odom = await ros.once("/odom"); assert.equal((odom.pose as { pose: { position: { x: number } } }).pose.position.x, 1);
  ros.close(); srv.close();
  await assert.rejects(() => new RosBridge("ws://127.0.0.1:1").connect(1500), /rosbridge connection failed|timeout/);
  const published: unknown[] = [];
  const fake = { url: "ws://x", advertise() {}, publish(t: string, m: unknown) { published.push({ t, m }); }, subscribe() { return () => {}; } } as unknown as InstanceType<typeof RosBridge>;
  const a = new RobotAgent(fake, { ...DEFAULT_SAFETY, watchdogMs: 200 }); await a.start();
  a.move(1, 0); assert.deepEqual((published.at(-1) as { m: { linear: { x: number } } }).m.linear.x, 0.3);
  await new Promise((r) => setTimeout(r, 450)); const zero = published.at(-1) as { m: { linear: { x: number } } }; assert.equal(zero.m.linear.x, 0); // watchdog stopped it
  a.estop(); assert.throws(() => a.move(0.1, 0), /E-STOP/); a.stop();
});

test("digital twin: expression DSL, bounds, simulation, health", async () => {
  const { evalExpr, checkBounds, simulate, twinHealth } = await import("../src/core/twins/twins");
  assert.equal(evalExpr("temp + 0.5*valve*dt/60 - 0.1*(temp-20)", { temp: 30, valve: 50, dt: 60 }), 30 + 25 - 1);
  assert.equal(evalExpr("clamp(x, 0, 10)", { x: 42 }), 10); assert.throws(() => evalExpr("process.exit()", {}), /unknown/);
  assert.equal(checkBounds({ temp: 95 }, [{ key: "temp", max: 90, critical: true }])[0].critical, true);
  const sim = simulate({ state: { temp: 60, valve: 0 }, rules: [{ target: "temp", expr: "temp + 0.4*valve*dt/60 - 0.05*(temp-20)" }], bounds: [{ key: "temp", max: 90, critical: true }], stepSeconds: 60 }, { valve: 100 }, 30);
  assert.equal(sim.safe, false); assert.ok(sim.firstBreachAtSeconds! > 0);
  const safe = simulate({ state: { temp: 60, valve: 0 }, rules: [{ target: "temp", expr: "temp + 0.4*valve*dt/60 - 0.05*(temp-20)" }], bounds: [{ key: "temp", max: 90, critical: true }], stepSeconds: 60 }, { valve: 5 }, 30);
  assert.equal(safe.safe, true);
  const h = twinHealth({ id: "t", uid: "u", name: "n", kind: "k", deviceIds: [], state: { temp: 95 }, history: [], bounds: [{ key: "temp", max: 90, critical: true }], rules: [], stepSeconds: 60, relationships: [], maintenance: [{ at: 0, note: "x", nextDue: 1 }], events: [], createdAt: 0, updatedAt: 0 });
  assert.equal(h.score, 100 - 30 - 40 - 10); assert.equal(h.stale, true);
});
