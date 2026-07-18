import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolveConfig } from "./config.js";
import {
  probeCdp,
  inspectExistingChrome,
  startDedicatedChrome,
  stopDedicatedChrome,
  getOwnedChromeStatus,
} from "./chrome-manager.js";

let runtime = null;
let connectPromise = null;
let lastError = null;
let generation = 0;
let explicitStartKey = null;

function runtimeKey(config) {
  return JSON.stringify({
    bridgeEntrypoint: config.bridgeEntrypoint,
    connectionMode: config.connectionMode,
    cdpHost: config.cdpHost,
    cdpPort: config.cdpPort,
    existingChromeChannel: config.existingChromeChannel,
    existingChromeUserDataDir: config.existingChromeUserDataDir,
    existingChromeRequireExplicitStart: config.existingChromeRequireExplicitStart,
    toolProfile: config.toolProfile,
  });
}

export function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/wss?:\/\/[^\s"']+\/devtools\/browser\/[^\s"']+/gi, "[redacted-browser-endpoint]")
    .replace(/\/devtools\/browser\/[A-Za-z0-9._-]+/g, "/devtools/browser/[redacted]")
    .replace(/\b(authorization|cookie|set-cookie)\s*[:=]\s*.*?(?=\s+\b(?:authorization|cookie|set-cookie)\b\s*[:=]|$)/gi, "$1=[redacted]")
    .replace(/[A-Fa-f0-9]{32,}/g, "[redacted]")
    .slice(0, 1000);
}

function requiresExplicitStart(config) {
  return config.connectionMode === "existing-chrome" && config.existingChromeRequireExplicitStart;
}

async function prepareChrome(config) {
  if (config.connectionMode === "existing-chrome") {
    const existing = await inspectExistingChrome(config);
    if (!existing.ok) {
      const error = existing.activePortPresent
        ? "Existing Chrome remote debugging endpoint is unavailable. Re-enable remote debugging in chrome://inspect/#remote-debugging."
        : "Existing Chrome is not ready. Start Chrome and enable remote debugging in chrome://inspect/#remote-debugging.";
      throw new Error(error);
    }
    return existing;
  }

  let cdp = await probeCdp(config);
  if (!cdp.ok && config.autoStartChrome) {
    const started = await startDedicatedChrome(config);
    if (!started.ok) throw new Error(started.error || "Failed to start dedicated Chrome");
    cdp = await probeCdp(config);
  }
  if (!cdp.ok) throw new Error(cdp.error || "Dedicated Chrome CDP endpoint is unavailable");
  return cdp;
}

async function openRuntime(ctx, config) {
  if (!fs.existsSync(config.bridgeEntrypoint)) {
    throw new Error(`Bundled browser-bridge entrypoint not found: ${config.bridgeEntrypoint}. Run npm run prepare:dev or reinstall the release bundle.`);
  }

  await prepareChrome(config);

  const env = {
    ...getDefaultEnvironment(),
    BB_CONNECTION_MODE: config.connectionMode,
    BB_TOOL_PROFILE: config.toolProfile,
    BB_ENABLE_REST: "0",
    BB_ENABLE_HTTP_MCP: "0",
  };
  if (config.connectionMode === "existing-chrome") {
    env.BB_CHROME_CHANNEL = config.existingChromeChannel;
    env.BB_CHROME_USER_DATA_DIR = config.existingChromeUserDataDir;
  } else {
    env.BB_CDP_HOST = config.cdpHost;
    env.BB_CDP_PORT = String(config.cdpPort);
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [config.bridgeEntrypoint],
    cwd: config.bridgeDirectory,
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "hana-browser-bridge-plugin", version: "0.2.1" });
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

export async function ensureMcpRuntime(ctx = {}, { explicit = false } = {}) {
  const config = await resolveConfig(ctx);
  const key = runtimeKey(config);
  if (runtime && runtime.key !== key) await shutdownMcpRuntime({ stopChrome: false });
  if (requiresExplicitStart(config) && !explicit && explicitStartKey !== key) {
    throw new Error("EXPLICIT_CONNECT_REQUIRED: use the reviewed browser_bridge_start action before accessing the user's Chrome browser");
  }
  if (runtime?.key === key) {
    if (explicit) explicitStartKey = key;
    return runtime;
  }
  if (!connectPromise) {
    connectPromise = openRuntime(ctx, config).finally(() => { connectPromise = null; });
  }
  const active = await connectPromise;
  if (explicit) explicitStartKey = key;
  return active;
}

export async function callBridgeTool(name, args = {}, ctx = {}) {
  let active = await ensureMcpRuntime(ctx);
  if (!active.toolNames.includes(name)) throw new Error(`MCP tool is not available in workflow profile: ${name}`);
  try {
    return await active.client.callTool({ name, arguments: args || {} });
  } catch (error) {
    lastError = sanitizeError(error);
    if (active.config.connectionMode === "existing-chrome") throw error;
    await shutdownMcpRuntime({ stopChrome: false });
    active = await ensureMcpRuntime(ctx);
    return await active.client.callTool({ name, arguments: args || {} });
  }
}

export async function getBridgeStatus(ctx = {}) {
  const config = await resolveConfig(ctx);
  const key = runtimeKey(config);
  const browserProbe = config.connectionMode === "existing-chrome"
    ? await inspectExistingChrome(config)
    : await probeCdp(config);
  const owned = getOwnedChromeStatus();
  return {
    ok: browserProbe.ok && !!runtime && runtime.key === key,
    name: "Browser Bridge for HanaAgent",
    pluginVersion: "0.2.1",
    connection: {
      mode: config.connectionMode,
      ownsBrowser: config.ownsBrowser,
      explicitStartRequired: requiresExplicitStart(config),
      explicitStartGranted: !requiresExplicitStart(config) || explicitStartKey === key,
    },
    mcp: {
      connected: !!runtime && runtime.key === key,
      generation: runtime?.generation || generation,
      connectedAt: runtime?.connectedAt || null,
      toolCount: runtime?.toolNames?.length || 0,
      tools: runtime?.toolNames || [],
      lastError,
      bridgeDirectory: config.bridgeDirectory,
      bridgeAvailable: config.bridgeAvailable,
    },
    chrome: config.connectionMode === "existing-chrome"
      ? {
          cdpOnline: browserProbe.ok,
          endpoint: browserProbe.ok ? "auto-connect:available" : "auto-connect:unavailable",
          browser: null,
          channel: config.existingChromeChannel,
          userDataDir: config.existingChromeUserDataConfigured ? "configured" : "channel-default",
          activePortPresent: browserProbe.activePortPresent,
          owned: false,
          pid: null,
          error: browserProbe.error || null,
        }
      : {
          cdpOnline: browserProbe.ok,
          endpoint: `${config.cdpHost}:${config.cdpPort}`,
          browser: browserProbe.version?.Browser || null,
          profileDir: config.chromeProfileDir,
          ...owned,
        },
    security: {
      toolProfile: config.toolProfile,
      restEnabled: false,
      loopbackOnly: true,
      dedicatedProfile: config.connectionMode === "dedicated",
      userChromeRequiresReviewedStart: requiresExplicitStart(config),
      rawCdpExposed: false,
    },
  };
}

export async function startBridgeRuntime(ctx = {}) {
  const active = await ensureMcpRuntime(ctx, { explicit: true });
  return {
    ok: true,
    connected: true,
    connectionMode: active.config.connectionMode,
    ownsBrowser: active.config.ownsBrowser,
    toolCount: active.toolNames.length,
    tools: active.toolNames,
  };
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
  explicitStartKey = null;
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
  // stopDedicatedChrome only ever targets a process spawned and owned by this plugin.
  const chrome = stopChrome ? await stopDedicatedChrome() : null;
  return { ok: true, mcpStopped: !!active, chrome };
}

export async function emergencyDetachRuntime() {
  const mode = runtime?.config?.connectionMode || null;
  const result = await shutdownMcpRuntime({ stopChrome: false });
  return {
    ...result,
    emergency: true,
    previousConnectionMode: mode,
    browserStopped: false,
  };
}

export async function restartBridgeRuntime(ctx = {}) {
  await shutdownMcpRuntime({ stopChrome: false });
  return await startBridgeRuntime(ctx);
}
