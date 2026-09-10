/**
 * Phase 9 (resume-safe SSE): numbered frames, Last-Event-ID / X-Run-Id parsing, and the
 * completed-run memo (replay instead of regenerate, in-flight claims, TTL + cap).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { RunMemo, SseChannel, lastEventId, runIdOf, sseFrame, sseHeaders } from "../src/lib/sse";

function fakeController() {
  const chunks: Uint8Array[] = [];
  return {
    chunks,
    text: () => Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8"),
    controller: { enqueue: (c: Uint8Array) => chunks.push(c), close: () => undefined } as unknown as ReadableStreamDefaultController,
  };
}

test("sse frames carry incrementing ids and the channel keeps the replay log", () => {
  assert.equal(sseFrame(3, `{"a":1}`), `id: 3\ndata: {"a":1}\n\n`);
  const f = fakeController();
  const ch = new SseChannel(f.controller);
  assert.equal(ch.send({ type: "delta", text: "hi" }), 1);
  assert.equal(ch.send({ type: "done" }), 2);
  assert.equal(ch.raw("[DONE]"), 3);
  assert.equal(ch.count, 3);
  assert.equal(f.text(), `id: 1\ndata: {"type":"delta","text":"hi"}\n\nid: 2\ndata: {"type":"done"}\n\nid: 3\ndata: [DONE]\n\n`);
  assert.deepEqual(ch.log.map((e) => e.id), [1, 2, 3]);
  const h = sseHeaders({ "X-Run-Replay": "1" });
  assert.equal(h["Content-Type"], "text/event-stream; charset=utf-8");
  assert.equal(h["X-Run-Replay"], "1");
});

test("last-event-id and x-run-id parse defensively", () => {
  const req = (headers: Record<string, string>) => new Request("https://x.test/api/chat", { headers });
  assert.equal(lastEventId(req({ "Last-Event-ID": "7" })), 7);
  assert.equal(lastEventId(req({})), 0);
  assert.equal(lastEventId(req({ "Last-Event-ID": "nope" })), 0);
  assert.equal(lastEventId(req({ "Last-Event-ID": "-3" })), 0);
  const uuid = "123e4567-e89b-12d3-a456-426614174000";
  assert.equal(runIdOf(req({ "X-Run-Id": uuid })), uuid);
  assert.equal(runIdOf(req({})), undefined);
  assert.equal(runIdOf(req({ "X-Run-Id": "short" })), undefined);
  assert.equal(runIdOf(req({ "X-Run-Id": "../../etc/passwd!!" })), undefined);
});

test("run memo: hit, TTL expiry and cap eviction", async () => {
  const memo = new RunMemo(30, 2);
  memo.set("r1", [{ id: 1, json: "{}" }]);
  assert.equal(memo.get("r1")?.events.length, 1);
  assert.equal(memo.get("missing"), undefined);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(memo.get("r1"), undefined); // expired
  memo.set("a", []);
  memo.set("b", []);
  memo.set("c", []);
  assert.equal(memo.size, 2); // capped
  assert.equal(memo.get("a"), undefined); // oldest evicted
  assert.ok(memo.get("c"));
});

test("run memo: in-flight claims serialize retries of the same run", () => {
  const memo = new RunMemo();
  assert.equal(memo.claim("r1"), true);
  assert.equal(memo.claim("r1"), false); // second attempt gets 409 while the first runs
  memo.release("r1");
  assert.equal(memo.claim("r1"), true);
  memo.release("r1");
});

test("resume: a retry replays exactly the missed events", () => {
  // Attempt 1 streams 3 events then the connection dies after the client saw 1.
  const first = fakeController();
  const ch = new SseChannel(first.controller);
  ch.send({ type: "delta", text: "Hello" });
  ch.send({ type: "delta", text: " world" });
  ch.send({ type: "done" });
  const memo = new RunMemo();
  memo.set("run-1", ch.log);
  // Attempt 2 (Last-Event-ID: 1) replays only 2..3 — the client appends, nothing duplicates.
  const stored = memo.get("run-1")!;
  const replayed = stored.events.filter((e) => e.id > 1).map((e) => sseFrame(e.id, e.json)).join("");
  assert.equal(replayed, `id: 2\ndata: {"type":"delta","text":" world"}\n\nid: 3\ndata: {"type":"done"}\n\n`);
});
