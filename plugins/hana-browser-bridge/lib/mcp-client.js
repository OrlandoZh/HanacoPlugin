import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolveConfig } from "./config.js";
import { probeCdp, startDedicatedChrome, stopDedicatedChrome, getOwnedChromeStatus } from "./chrome-manager.js";

let runtime = null;
let connectPromise = null;
let lastError = null;
let generation = 0;

function runtimeKey(config) {
  return JSON.stringify({
    bridgeEntrypoint: config.bridgeEntrypoint,
    cdpHost: config.cdpHost,
    cdpPort: config.cdpPort,
    toolProfile: config.toolProfile,
  });
}

function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[A-Fa-f0-9]{32,}/g, "[redacted]").slice(0, 1000);
}

async function openRuntime(ctx, config) {
  if (!fs.existsSync(config.bridgeEntrypoint)) {
    throw new Error(`Bundled browser-bridge entrypoint not found: ${config.bridgeEntrypoint}. Run npm run prepare:dev or reinstall the release bundle.`);
  }

  let cdp = await probeCdp(config);
  if (!cdp.ok && config.autoStartChrome) {
    const started = await startDedicatedChrome(config);
    if (!started.ok) throw new Error(started.error || "Failed to start dedicated Chrome");
    cdp = await probeCdp(config);
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [config.bridgeEntrypoint],
    cwd: config.bridgeDirectory,
    env: {
      ...getDefaultEnvironment(),
      BB_CDP_HOST: config.cdpHost,
      BB_CDP_PORT: String(config.cdpPort),
      BB_TOOL_PROFILE: config.toolProfile,
      BB_ENABLE_REST: "0",
      BB_ENABLE_HTTP_MCP: "0",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "hana-browser-bridge-plugin", version: "0.1.0" });
  transport.stderr?.on?.("data", (chunk) => {
    const line = sanitizeError(String(chunk || "").trim());
    if (line) ctx?.log?.debug?.(`browser-bridge MCP: ${line}`);
  });
  transport.onerror = (error) => {
    lastError = sanitizeError(error);
    ctx?.log?.error?.(`browser-bridge MCP transport error: ${lastError}`);
  };
  await client.connect(transport);
  const listed = await client.listTools();
  const toolNames = listed.tools.map((tool) => tool.name).sort();
  const created = {
    key: runtimeKey(config),
    client,
    transport,
    config,
    toolNames,
    connectedAt: new Date().toISOString(),
    generation: ++generation,
  };
  runtime = created;
  lastError = null;
  return created;
}

export async function ensureMcpRuntime(ctx = {}) {
  const config = await resolveConfig(ctx);
  const key = runtimeKey(config);
  if (runtime?.key === key) return runtime;
  if (runtime && runtime.key !== key) await shutdownMcpRuntime({ stopChrome: false });
  if (!connectPromise) {
    connectPromise = openRuntime(ctx, config).finally(() => { connectPromise = null; });
  }
  return await connectPromise;
}

export async function callBridgeTool(name, args = {}, ctx = {}) {
  let active = await ensureMcpRuntime(ctx);
  if (!active.toolNames.includes(name)) throw new Error(`MCP tool is not available in workflow profile: ${name}`);
  try {
    return await active.client.callTool({ name, arguments: args || {} });
  } catch (error) {
    lastError = sanitizeError(error);
    await shutdownMcpRuntime({ stopChrome: false });
    active = await ensureMcpRuntime(ctx);
    return await active.client.callTool({ name, arguments: args || {} });
  }
}

export async function getBridgeStatus(ctx = {}) {
  const config = await resolveConfig(ctx);
  const cdp = await probeCdp(config);
  return {
    ok: cdp.ok && !!runtime,
    name: "Browser Bridge for HanaAgent",
    pluginVersion: "0.1.0",
    mcp: {
      connected: !!runtime,
      generation: runtime?.generation || generation,
      connectedAt: runtime?.connectedAt || null,
      toolCount: runtime?.toolNames?.length || 0,
      tools: runtime?.toolNames || [],
      lastError,
      bridgeDirectory: config.bridgeDirectory,
      bridgeAvailable: config.bridgeAvailable,
    },
    chrome: {
      cdpOnline: cdp.ok,
      endpoint: `${config.cdpHost}:${config.cdpPort}`,
      browser: cdp.version?.Browser || null,
      profileDir: config.chromeProfileDir,
      ...getOwnedChromeStatus(),
    },
    security: {
      toolProfile: config.toolProfile,
      restEnabled: false,
      loopbackOnly: true,
      dedicatedProfile: true,
    },
  };
}

export async function startBridgeRuntime(ctx = {}) {
  const active = await ensureMcpRuntime(ctx);
  return { ok: true, connected: true, toolCount: active.toolNames.length, tools: active.toolNames };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function bounded(promise, timeoutMs) {
  return await Promise.race([
    Promise.resolve(promise).catch(() => undefined),
    delay(timeoutMs),
  ]);
}

function processAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function shutdownMcpRuntime({ stopChrome = false } = {}) {
  const active = runtime;
  runtime = null;
  if (active) {
    const pid = active.transport.pid;
    const gracefulClose = active.client.close();
    await bounded(gracefulClose, 500);
    if (processAlive(pid)) {
      try { process.kill(pid, "SIGTERM"); } catch {}
    }
    await bounded(gracefulClose, 1500);
    await bounded(active.transport.close(), 500);
    if (processAlive(pid)) {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
  }
  const chrome = stopChrome ? await stopDedicatedChrome() : null;
  return { ok: true, mcpStopped: !!active, chrome };
}

export async function restartBridgeRuntime(ctx = {}) {
  await shutdownMcpRuntime({ stopChrome: false });
  return await startBridgeRuntime(ctx);
}
