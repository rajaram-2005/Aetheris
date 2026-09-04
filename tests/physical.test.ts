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
