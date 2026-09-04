import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeSync } from "../src/lib/sync";

test("sync merge: newer updatedAt wins, tombstones propagate then expire, memory unions", () => {
  const b1 = mergeSync(undefined, { convos: { a: { updatedAt: 10, title: "old" } }, memory: ["x"] }, 1_000_000);
  const b2 = mergeSync(b1, { convos: { a: { updatedAt: 5, title: "stale" }, b: { updatedAt: 1_000_000, deleted: true } }, memory: ["y"] }, 1_000_000);
  assert.equal(b2.convos.a.title, "old");
  assert.equal(b2.convos.b.deleted, true);
  assert.deepEqual([...b2.memory].sort(), ["x", "y"]);
  assert.equal(b2.rev, 2);
  const b3 = mergeSync(b2, {}, 1_000_000 + 31 * 86_400_000);
  assert.equal(b3.convos.b, undefined, "tombstone dropped after 30 days");
  assert.equal(b3.convos.a.title, "old");
});
