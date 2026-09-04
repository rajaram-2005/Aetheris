import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCron, matches, nextRun, describeCron, partsIn, isValidTimeZone } from "../src/lib/schedules/cron";
import { validateSchedule } from "../src/lib/schedules/engine";

const IST = "Asia/Kolkata";
const at = (iso: string) => new Date(iso);

test("cron parsing: stars, lists, ranges, steps, names, sunday=7", () => {
  const s = parseCron("*/15 9-17 1,15 jan-mar mon-fri");
  assert.deepEqual([...s.min], [0, 15, 30, 45]); assert.equal(s.hour.size, 9); assert.deepEqual([...s.dom], [1, 15]); assert.deepEqual([...s.mon], [1, 2, 3]); assert.deepEqual([...s.dow], [1, 2, 3, 4, 5]);
  assert.ok(parseCron("0 0 * * 7").dow.has(0));
  assert.throws(() => parseCron("60 * * * *"), /bad range/); assert.throws(() => parseCron("* * * *"), /5 fields/); assert.throws(() => parseCron("*/0 * * * *"), /bad step/);
});

test("matching honours the time zone", () => {
  const spec = parseCron("30 8 * * *");
  // 08:30 IST == 03:00 UTC
  assert.ok(matches(spec, at("2026-09-04T03:00:00Z"), IST)); assert.ok(!matches(spec, at("2026-09-04T03:00:00Z"), "UTC"));
  assert.deepEqual(partsIn(at("2026-09-04T03:00:00Z"), IST), { min: 30, hour: 8, dom: 4, mon: 9, dow: 5, year: 2026 });
  // dom OR dow when both restricted (standard cron)
  const both = parseCron("0 9 1 * 1"); assert.ok(matches(both, at("2026-09-07T03:30:00Z"), IST)); // Monday 7th
  assert.ok(matches(both, at("2026-09-01T03:30:00Z"), IST)); assert.ok(!matches(both, at("2026-09-02T03:30:00Z"), IST));
});

test("nextRun finds the next slot across day/week/month boundaries", () => {
  const from = at("2026-09-04T10:00:00Z"); // Fri 15:30 IST
  assert.equal(nextRun("0 9 * * *", from, IST)?.toISOString(), "2026-09-05T03:30:00.000Z");
  assert.equal(nextRun("0 9 * * 1-5", from, IST)?.toISOString(), "2026-09-07T03:30:00.000Z"); // skips weekend
  assert.equal(nextRun("0 9 1 * *", from, IST)?.toISOString(), "2026-10-01T03:30:00.000Z");
  assert.equal(nextRun("*/30 * * * *", from, IST)?.toISOString(), "2026-09-04T10:30:00.000Z");
  assert.equal(nextRun("0 9 * * *", at("2026-09-04T03:30:00Z"), IST)?.toISOString(), "2026-09-05T03:30:00.000Z", "strictly after");
});

test("describeCron and validation", () => {
  assert.equal(describeCron("0 8 * * *"), "daily at 08:00"); assert.equal(describeCron("0 9 * * 1-5"), "weekdays at 09:00"); assert.equal(describeCron("0 9 * * 1"), "every Mon at 09:00"); assert.equal(describeCron("*/30 * * * *"), "every 30 minutes"); assert.equal(describeCron("0 9 1 * *"), "monthly on day 1 at 09:00");
  assert.ok(isValidTimeZone(IST) && !isValidTimeZone("Mars/Olympus"));
  const base = { name: "Digest", cron: "0 8 * * *", tz: IST, task: { kind: "agent" as const, agent: "hermes", prompt: "Summarise the news" } };
  assert.equal(validateSchedule(base), null);
  assert.match(validateSchedule({ ...base, cron: "* * * * *" })!, /minimum interval/);
  assert.match(validateSchedule({ ...base, tz: "Nope/Nope" })!, /time zone/);
  assert.match(validateSchedule({ ...base, task: { kind: "agent", agent: "nobody", prompt: "x" } })!, /agent/);
  assert.match(validateSchedule({ ...base, deliver: [{ type: "webhook", url: "http://insecure" }] })!, /https/);
  assert.match(validateSchedule({ ...base, deliver: [{ type: "email", to: "bad" }] })!, /email/);
});
