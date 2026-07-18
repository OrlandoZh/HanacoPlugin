import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, startFixture } from "./harness.js";
import { execute as executeStartTool } from "../tools/browser_bridge_start.js";
import {
  callBridgeTool,
  getBridgeStatus,
  shutdownMcpRuntime,
  startBridgeRuntime,
} from "../lib/mcp-client.js";

const pluginDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bridgeDir = path.join(pluginDir, "vendor", "browser-bridge");

function parseText(result) {
  const text = result.content?.find((item) => item.type === "text")?.text || "{}";
  return JSON.parse(text);
}

function assertNoRoutingSecrets(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, /webSocketDebuggerUrl/i);
  assert.doesNotMatch(serialized, /sessionId/i);
  assert.doesNotMatch(serialized, /\/devtools\/browser\//i);
}

test("existing Chrome Auto Connect requires reviewed start and never owns the user's browser", { timeout: 45000 }, async (t) => {
  const chrome = await launchChrome({ autoConnect: true });
  const fixture = await startFixture();
  let runtimeStopped = false;
  t.after(async () => {
    if (!runtimeStopped) await shutdownMcpRuntime({ stopChrome: true });
    await fixture.close();
    await chrome.teardown();
  });

  const values = {
    connectionMode: "existing-chrome",
    existingChromeChannel: "stable",
    existingChromeUserDataDir: chrome.userDataDir,
    bridgeDirectory: bridgeDir,
    toolProfile: "workflow",
  };
  const ctx = {
    pluginDir,
    config: { get: async (key) => values[key] },
    log: { info() {}, debug() {}, error() {} },
  };

  await assert.rejects(
    () => callBridgeTool("browser_list_tabs", {}, ctx),
    /EXPLICIT_CONNECT_REQUIRED/,
    "read-only workflow tools must not implicitly connect to the user's Chrome",
  );

  const startedToolResult = await executeStartTool({}, ctx);
  const started = startedToolResult.details;
  assert.equal(startedToolResult.isError, false, "HanaAgent start tool must report a successful reviewed Chrome connection");
  assert.equal(started.ok, true);
  assert.equal(started.connectionMode, "existing-chrome");
  assert.equal(started.ownsBrowser, false);
  assert.equal(started.toolCount, 15);
  assert.equal(started.mcpConnected, true);
  assert.equal(started.browserConnected, true, "reviewed start must complete the Chrome connection itself");
  assert.equal(started.retryBlocked, false);
  assert.equal(started.tools.includes("browser_connect"), false, "private connect primitive must not reach HanaAgent");
  const preToolStatus = await getBridgeStatus(ctx);
  assert.equal(preToolStatus.connection.browserConnected, true);
  assert.equal(preToolStatus.mcp.toolCount, 15);
  assert.equal(preToolStatus.mcp.tools.includes("browser_connect"), false);

  const listed = parseText(await callBridgeTool("browser_list_tabs", {}, ctx));
  assert.equal(listed.ok, true);
  assert.ok(Array.isArray(listed.tabs));
  assertNoRoutingSecrets(listed);

  const created = parseText(await callBridgeTool("browser_new_tab", { url: fixture.url }, ctx));
  assert.equal(created.ok, true);
  assert.ok(created.targetId);
  assertNoRoutingSecrets(created);

  const attached = parseText(await callBridgeTool("browser_attach_tab", { targetId: created.targetId }, ctx));
  assert.equal(attached.ok, true);
  assertNoRoutingSecrets(attached);

  // Regression: after a second tab becomes active, native mouse input to the first
  // claimed tab must activate that target before Input.dispatchMouseEvent.
  const backgroundingTab = parseText(await callBridgeTool("browser_new_tab", { url: fixture.url }, ctx));
  assert.equal(backgroundingTab.ok, true);
  assertNoRoutingSecrets(backgroundingTab);
  const clicked = parseText(await callBridgeTool("browser_action", {
    targetId: created.targetId,
    action: "click",
    selector: "#spa-action",
    waitAfterMs: 100,
  }, ctx));
  assert.equal(clicked.ok, true);
  assert.equal(clicked.mode, "native");
  const spaState = parseText(await callBridgeTool("browser_dom", {
    targetId: created.targetId,
    expression: "({marker:document.querySelector('#spa-marker')?.textContent,hash:location.hash,clicks:window.__bbTest?.clicks})",
  }, ctx));
  assert.deepEqual(spaState.value, { marker: "spa-ok", hash: "#accepted", clicks: 1 });
  assertNoRoutingSecrets(clicked);
  assertNoRoutingSecrets(spaState);

  const counters = parseText(await callBridgeTool("browser_read_counters", { targetId: created.targetId }, ctx));
  assert.equal(counters.ok, true);
  assert.deepEqual(counters.counters, { total: 0, success: 0, fail: 0 });

  const status = await getBridgeStatus(ctx);
  assert.equal(status.connection.mode, "existing-chrome");
  assert.equal(status.connection.explicitStartGranted, true);
  assert.equal(status.connection.retryBlocked, false);
  assert.equal(status.connection.retryBlockReason, null);
  assert.equal(status.connection.browserConnected, true);
  assert.equal(status.mcp.bridgeDirectory, "configured-and-available");
  const serializedStatus = JSON.stringify(status);
  assert.equal(serializedStatus.includes(chrome.userDataDir), false);
  assert.equal(serializedStatus.includes(pluginDir), false);
  assert.equal(status.chrome.owned, false);
  assert.equal(status.chrome.endpoint, "auto-connect:available");
  assert.equal(status.chrome.userDataDir, "configured");
  assert.doesNotMatch(JSON.stringify(status.chrome), /auto-connect:\d+|hana-bb-plugin-it-|\/Users\//);
  assert.equal(status.mcp.connected, true);
  assert.equal(status.security.rawCdpExposed, false);

  const reviewedRestart = await startBridgeRuntime(ctx);
  assert.equal(reviewedRestart.ok, true);
  assert.equal(reviewedRestart.browserConnected, true, "reviewed restart must finish the replacement Chrome connection");
  const postRestartStatus = await getBridgeStatus(ctx);
  assert.equal(postRestartStatus.connection.browserConnected, true);
  assert.ok(postRestartStatus.mcp.generation > status.mcp.generation);
  const relisted = parseText(await callBridgeTool("browser_list_tabs", {}, ctx));
  assert.equal(relisted.ok, true);
  assert.equal((await getBridgeStatus(ctx)).connection.browserConnected, true);

  const stopped = await shutdownMcpRuntime({ stopChrome: true });
  runtimeStopped = true;
  assert.equal(stopped.mcpStopped, true);
  assert.equal(stopped.chrome.stopped, false, "existing mode must not stop an unowned Chrome process");
  assert.equal(chrome.isAlive(), true, "temporary stand-in for the user's Chrome must remain alive after plugin shutdown");
});
