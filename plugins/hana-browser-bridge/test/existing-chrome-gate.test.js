import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { callBridgeTool, shutdownMcpRuntime } from "../lib/mcp-client.js";

test("existing Chrome workflow tools require reviewed explicit start before discovery", async (t) => {
  t.after(() => shutdownMcpRuntime({ stopChrome: false }));
  const values = {
    connectionMode: "existing-chrome",
    existingChromeUserDataDir: path.join(os.tmpdir(), "hana-bb-does-not-exist"),
    bridgeDirectory: path.resolve("vendor/browser-bridge"),
    toolProfile: "workflow",
  };
  const ctx = {
    pluginDir: path.resolve("."),
    config: { get: async (key) => values[key] },
    log: { info() {}, debug() {}, error() {} },
  };
  await assert.rejects(
    callBridgeTool("browser_list_tabs", {}, ctx),
    /EXPLICIT_CONNECT_REQUIRED/,
  );
});
