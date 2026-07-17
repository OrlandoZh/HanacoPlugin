import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import {
  assertLoopbackHost,
  assertSafeProfileDir,
  expandHome,
  resolveConfig,
  resolveDefaultChromeUserDataDir,
} from "../lib/config.js";

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

test("daily Chrome profiles are rejected for dedicated launch", () => {
  assert.throws(() => assertSafeProfileDir("~/Library/Application Support/Google/Chrome"), /Dedicated Chrome profile/);
  assert.throws(() => assertSafeProfileDir("~/Library/Application Support/Google/Chrome/Default"), /Dedicated Chrome profile/);
  assert.match(assertSafeProfileDir("~/.hanako/browser-bridge/profile"), /\.hanako/);
});

test("resolveConfig enforces workflow and a safe port", async () => {
  await assert.rejects(resolveConfig(ctx({ toolProfile: "full" })), /workflow/);
  await assert.rejects(resolveConfig(ctx({ cdpPort: 80 })), /Invalid CDP port/);
  await assert.rejects(resolveConfig(ctx({ existingChromeRequireExplicitStart: false })), /cannot be disabled/);
  const config = await resolveConfig(ctx({ cdpPort: 19282, chromeProfileDir: "~/.hanako/browser-bridge/test" }));
  assert.equal(config.connectionMode, "dedicated");
  assert.equal(config.ownsBrowser, true);
  assert.equal(config.toolProfile, "workflow");
  assert.equal(config.cdpPort, 19282);
  assert.equal(expandHome("~/x"), path.join(os.homedir(), "x"));
});

test("existing Chrome mode resolves user data without treating it as a launch profile", async () => {
  const daily = path.join(os.homedir(), "Library/Application Support/Google/Chrome");
  const config = await resolveConfig(ctx({
    connectionMode: "existing-chrome",
    existingChromeChannel: "stable",
    existingChromeUserDataDir: daily,
    chromeProfileDir: daily,
  }));
  assert.equal(config.connectionMode, "existing-chrome");
  assert.equal(config.ownsBrowser, false);
  assert.equal(config.autoStartChrome, false);
  assert.equal(config.existingChromeRequireExplicitStart, true);
  assert.equal(config.existingChromeUserDataDir, daily);
});

test("Chrome channel discovery uses platform-specific user data roots", () => {
  assert.equal(
    resolveDefaultChromeUserDataDir("stable", "darwin"),
    path.join(os.homedir(), "Library/Application Support/Google/Chrome"),
  );
  assert.match(resolveDefaultChromeUserDataDir("canary", "win32"), /Chrome SxS[\\/]User Data$/);
  assert.throws(() => resolveDefaultChromeUserDataDir("nightly", "darwin"), /Unsupported Chrome channel/);
});
