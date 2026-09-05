import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { loadServers, type EnabledServer } from "../src/components/Apps";

const STORAGE = "aetheris.mcp.v1";

function browserStorage(t: TestContext, raw: string | null) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  if (raw !== null) values.set(STORAGE, raw);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  return values;
}

test("Apps: loading saved connections removes retired deployment apps, keeping integrations and custom servers", (t) => {
  const keep: EnabledServer[] = [
    { id: "hub", name: "Aetheris Hub" },
    { id: "github", name: "GitHub", credential: "saved-test-token" },
    { id: "docker-hub", name: "Docker Hub" },
    { id: "custom:local-tools", name: "Local tools", url: "http://127.0.0.1:4000/mcp" },
  ];
  const retired = ["edgeone-pages", "cloudflare", "netlify", "render", "vercel"].map((id) => ({ id, credential: "retired-test-token" }));
  const values = browserStorage(t, JSON.stringify([...retired, ...keep]));
  assert.deepEqual(loadServers(), keep);
  assert.deepEqual(JSON.parse(values.get(STORAGE)!), keep, "persist the cleanup, not just hide old apps");
  assert.deepEqual(loadServers(), keep, "cleanup is idempotent");
});

test("Apps: empty or malformed browser storage does not break startup", (t) => {
  const values = browserStorage(t, null);
  assert.deepEqual(loadServers(), []);
  for (const raw of ["not-json", "null", "{}", '[null, {}, {"id": 1}]']) {
    values.set(STORAGE, raw);
    assert.deepEqual(loadServers(), [], raw);
  }
});
