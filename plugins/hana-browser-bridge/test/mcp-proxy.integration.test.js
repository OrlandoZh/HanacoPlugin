import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, startFixture } from "./harness.js";
import { callBridgeTool, getBridgeStatus, shutdownMcpRuntime } from "../lib/mcp-client.js";

const pluginDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bridgeDir = path.join(pluginDir, "vendor", "browser-bridge");

function parseText(result) {
  const text = result.content?.find((item) => item.type === "text")?.text || "{}";
  return JSON.parse(text);
}

test("packaged Hana plugin keeps a persistent MCP session across workflow calls", { timeout: 45000 }, async (t) => {
  const chrome = await launchChrome();
  const fixture = await startFixture();
  t.after(async () => {
    await shutdownMcpRuntime({ stopChrome: false });
    await fixture.close();
    await chrome.teardown();
  });

  const values = {
    cdpHost: chrome.host,
    cdpPort: chrome.port,
    autoStartChrome: false,
    bridgeDirectory: bridgeDir,
    chromeProfileDir: chrome.userDataDir,
    toolProfile: "workflow",
  };
  const ctx = {
    pluginDir,
    config: { get: async (key) => values[key] },
    log: { info() {}, debug() {}, error() {} },
  };

  const initial = await callBridgeTool("browser_list_tabs", {}, ctx);
  assert.equal(initial.isError, undefined);

  const created = parseText(await callBridgeTool("browser_new_tab", { url: fixture.url }, ctx));
  assert.equal(created.ok, true);
  assert.ok(created.targetId);

  const attached = parseText(await callBridgeTool("browser_attach_tab", { targetId: created.targetId }, ctx));
  assert.equal(attached.ok, true);

  const counters = parseText(await callBridgeTool("browser_read_counters", { targetId: created.targetId }, ctx));
  assert.equal(counters.ok, true);
  assert.deepEqual(counters.counters, { total: 0, success: 0, fail: 0 });

  const observed = parseText(await callBridgeTool("browser_dom", {
    targetId: created.targetId,
    mode: "observe",
    maxElements: 20,
  }, ctx));
  assert.equal(observed.ok, true);
  const input = observed.elements.find((item) => item.tag === "input");
  assert.ok(input?.ref);
  assert.equal("locator" in input, false);

  const secret = "hana-ref-input";
  const acted = parseText(await callBridgeTool("browser_action", {
    targetId: created.targetId,
    ref: input.ref,
    action: "input",
    value: secret,
    clear: true,
    verify: true,
  }, ctx));
  assert.equal(acted.ok, true, JSON.stringify(acted));
  assert.equal(JSON.stringify(acted).includes(secret), false);

  const verified = parseText(await callBridgeTool("browser_dom", {
    targetId: created.targetId,
    mode: "verify",
    ref: input.ref,
    assertion: "exact",
    expected: secret,
  }, ctx));
  assert.equal(verified.ok, true);
  assert.equal(verified.matched, true);
  assert.equal(JSON.stringify(verified).includes(secret), false);

  const status = await getBridgeStatus(ctx);
  assert.equal(status.mcp.connected, true);
  assert.equal(status.mcp.toolCount, 15);
  assert.equal(status.chrome.cdpOnline, true);
  assert.equal(status.security.restEnabled, false);
});
