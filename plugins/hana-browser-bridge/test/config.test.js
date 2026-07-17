import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { assertLoopbackHost, assertSafeProfileDir, expandHome, resolveConfig } from "../lib/config.js";

function ctx(values = {}) {
  return {
    pluginDir: path.resolve("."),
    config: { get: async (key) => values[key] },
  };
}

test("loopback hosts are accepted and remote hosts are rejected", () => {
  assert.equal(assertLoopbackHost("localhost"), "127.0.0.1");
  assert.equal(assertLoopbackHost("127.0.0.1"), "127.0.0.1");
  assert.throws(() => assertLoopbackHost("0.0.0.0"), /loopback-only/);
  assert.throws(() => assertLoopbackHost("192.168.1.20"), /loopback-only/);
});

test("daily Chrome profiles are rejected", () => {
  assert.throws(() => assertSafeProfileDir("~/Library/Application Support/Google/Chrome"), /Dedicated Chrome profile/);
  assert.throws(() => assertSafeProfileDir("~/Library/Application Support/Google/Chrome/Default"), /Dedicated Chrome profile/);
  assert.match(assertSafeProfileDir("~/.hanako/browser-bridge/profile"), /\.hanako/);
});

test("resolveConfig enforces workflow and a safe port", async () => {
  await assert.rejects(resolveConfig(ctx({ toolProfile: "full" })), /workflow/);
  await assert.rejects(resolveConfig(ctx({ cdpPort: 80 })), /Invalid CDP port/);
  const config = await resolveConfig(ctx({ cdpPort: 19282, chromeProfileDir: "~/.hanako/browser-bridge/test" }));
  assert.equal(config.toolProfile, "workflow");
  assert.equal(config.cdpPort, 19282);
  assert.equal(expandHome("~/x"), path.join(os.homedir(), "x"));
});
