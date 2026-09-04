import { test } from "node:test";
import assert from "node:assert/strict";
import { definePlugin, invokePlugin, listPlugins, removePlugin, validateArgs, findPluginCapability } from "../src/core/plugins/sdk";
import { searchCapabilities } from "../src/core/capabilities/registry";
import { convert } from "../src/plugins/unit-convert";
import "../src/plugins";

test("plugin sdk: example plugin is discoverable, callable, validated, observable", async () => {
  assert.ok(listPlugins().some((p) => p.id === "unit-convert"));
  const found = await searchCapabilities({ q: "convert psi to bar", limit: 5 });
  assert.ok(found.some((c) => c.id === "plugin:unit-convert.convert"));
  const r = (await invokePlugin("plugin:unit-convert.convert", { value: 1, from: "bar", to: "psi" }, { uid: "t" })) as { value: number };
  assert.ok(Math.abs(r.value - 14.5038) < 0.001);
  assert.equal(Math.round(convert(100, "c", "f")), 212);
  await assert.rejects(() => invokePlugin("plugin:unit-convert.convert", { value: "x", from: "m", to: "km" }, { uid: "t" }), /should be number/);
  await assert.rejects(() => invokePlugin("plugin:unit-convert.convert", { value: 1, from: "kg" , to: "m" }, { uid: "t" }), /cannot convert/);
  const cap = findPluginCapability("plugin:unit-convert.convert")!.capability;
  assert.equal(cap.provider, "plugin:unit-convert"); assert.equal(cap.security_level, "read_only"); assert.ok(cap.invoke?.ref.includes("/api/plugins/"));
  assert.throws(() => validateArgs(cap, { from: "m", to: "km" }), /missing required/);
});
test("plugin sdk: contract errors are loud; removal unregisters", async () => {
  assert.throws(() => definePlugin({ id: "Bad_Id", name: "x", version: "1", capabilities: [], handlers: {} }), /kebab-case/);
  assert.throws(() => definePlugin({ id: "no-handler", name: "x", version: "1", capabilities: [{ id: "plugin:no-handler.a", name: "a", category: "tool", description: "", status: "implemented", verification_status: "verified", security_level: "read_only", tags: [], supported_operations: [] }], handlers: {} }), /no handler/);
  definePlugin({ id: "tmp-plugin", name: "t", version: "1", capabilities: [{ id: "plugin:tmp-plugin.ping", name: "ping", category: "tool", description: "ping", status: "experimental", verification_status: "verified", security_level: "read_only", tags: [], supported_operations: ["ping"] }], handlers: { "plugin:tmp-plugin.ping": () => "pong" } });
  assert.equal(await invokePlugin("plugin:tmp-plugin.ping", {}, { uid: "t" }), "pong");
  removePlugin("tmp-plugin");
  assert.equal(findPluginCapability("plugin:tmp-plugin.ping"), undefined);
});
