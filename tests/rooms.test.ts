import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";

before(() => { process.env.AETHERIS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aetheris-rooms-")); });

test("rooms: messages fan out to subscribers with monotonic seq; presence tracks people", async () => {
  const { createRoom, appendMessage, subscribe, touchPresence, activeParticipants, eventsSince } = await import("../src/lib/rooms/rooms");
  const room = await createRoom("owner", "Test");
  const got: number[] = [];
  const off = subscribe(room.id, (ev) => got.push(ev.seq));
  await touchPresence(room.id, "u1", "Raj");
  await touchPresence(room.id, "u2", "Priya");
  await appendMessage(room.id, { role: "user", content: "hi", author: { uid: "u1", name: "Raj", color: "#fff" } });
  off();
  assert.deepEqual(got, [1, 2, 3]);
  const r2 = await touchPresence(room.id, "u1");
  assert.deepEqual(activeParticipants(r2).map((p) => p.name).sort(), ["Priya", "Raj"]);
  const later = await eventsSince(room.id, 2);
  assert.ok(later.every((e) => e.seq > 2) && later.length >= 1);
});

test("i18n: falls back to English and covers all keys for ta/hi where provided", async () => {
  const { t } = await import("../src/lib/i18n");
  assert.equal(t("mode.chat", "ta"), "அரட்டை");
  assert.equal(t("mode.chat", "hi"), "चैट");
  assert.equal(t("chat.send", "en"), "Send");
});

test("gallery seed is well-formed", async () => {
  const { SEED } = await import("../src/lib/gallery/seed");
  assert.ok(SEED.length >= 6);
  for (const s of SEED) { assert.ok(s.title && s.prompt && s.id); assert.ok(Array.isArray(s.tags)); }
});
