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
import { ExistingChromeConnectGuard } from "./existing-chrome-connect-guard.js";
import {
  EXISTING_CHROME_CONNECT_TIMEOUT_MS,
  MCP_ALLOWLIST_TOOL_NAMES,
  publicWorkflowTools,
} from "./tool-profile.js";

let runtime = null;
let connectAttempt = null;
let lifecycleEpoch = 0;
let lastError = null;
let generation = 0;
let explicitStartKey = null;
let lifecycleLock = Promise.resolve();
const existingChromeConnectGuard = new ExistingChromeConnectGuard();

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

function runtimeStartCancelledError() {
  const error = new Error("RUNTIME_START_CANCELLED: browser bridge startup was cancelled by stop or emergency detach");
  error.code = "RUNTIME_START_CANCELLED";
  return error;
}

function attemptIsCurrent(attempt) {
  return !attempt.cancelled && attempt.epoch === lifecycleEpoch;
}

async function closeMcpResources(client, transport) {
  if (!client && !transport) return;
  const pid = transport?.pid;
  let gracefulClose;
  try { gracefulClose = client?.close?.(); } catch { gracefulClose = null; }
  if (gracefulClose) await bounded(gracefulClose, 500);
  if (processAlive(pid)) {
    try { process.kill(pid, "SIGTERM"); } catch {}
  }
  if (gracefulClose) await bounded(gracefulClose, 1500);
  if (transport?.close) {
    let transportClose;
    try { transportClose = transport.close(); } catch { transportClose = null; }
    if (transportClose) await bounded(transportClose, 500);
  }
  if (processAlive(pid)) {
    try { process.kill(pid, "SIGKILL"); } catch {}
  }
}

async function openRuntime(ctx, config, attempt) {
  let transport = null;
  let client = null;
  try {
    if (!fs.existsSync(config.bridgeEntrypoint)) {
      throw new Error(`Bundled browser-bridge entrypoint not found: ${config.bridgeEntrypoint}. Run npm run prepare:dev or reinstall the release bundle.`);
    }

    await prepareChrome(config);
    if (!attemptIsCurrent(attempt)) throw runtimeStartCancelledError();

    const env = {
      ...getDefaultEnvironment(),
      BB_CONNECTION_MODE: config.connectionMode,
      BB_TOOL_PROFILE: config.toolProfile,
      // Register one private connect-only primitive in the stdio child. It is not
      // contributed to HanaAgent and is used only by reviewed browser_bridge_start.
      BB_TOOL_ALLOWLIST: MCP_ALLOWLIST_TOOL_NAMES.join(","),
      BB_ENABLE_REST: "0",
      BB_ENABLE_HTTP_MCP: "0",
    };
    if (config.connectionMode === "existing-chrome") {
      env.BB_CHROME_CHANNEL = config.existingChromeChannel;
      env.BB_CHROME_USER_DATA_DIR = config.existingChromeUserDataDir;
      // The reviewed Hana action grants exactly one browser connection attempt.
      // Starting the MCP subprocess itself must not consume a Chrome consent prompt.
      env.BB_DEFER_INITIAL_CONNECT = "1";
      env.BB_REQUIRE_REVIEWED_RECONNECT = "1";
      // One reviewed action, one WebSocket open, no retry. Give the human enough
      // time to answer Chrome's native consent dialog before the sole attempt expires.
      env.BB_BROWSER_CONNECT_TIMEOUT_MS = String(EXISTING_CHROME_CONNECT_TIMEOUT_MS);
    } else {
      env.BB_CDP_HOST = config.cdpHost;
      env.BB_CDP_PORT = String(config.cdpPort);
    }

    transport = new StdioClientTransport({
      command: process.execPath,
      args: [config.bridgeEntrypoint],
      cwd: config.bridgeDirectory,
      env,
      stderr: "pipe",
    });
    client = new Client({ name: "hana-browser-bridge-plugin", version: "0.2.5" });
    attempt.transport = transport;
    attempt.client = client;
    transport.stderr?.on?.("data", (chunk) => {
      const line = sanitizeError(String(chunk || "").trim());
      if (line) ctx?.log?.debug?.(`browser-bridge MCP: ${line}`);
    });
    transport.onerror = (error) => {
      if (attemptIsCurrent(attempt)) lastError = "MCP_TRANSPORT_ERROR";
      const safeLog = sanitizeError(error);
      ctx?.log?.error?.(`browser-bridge MCP transport error: ${safeLog}`);
    };
    await client.connect(transport);
    if (!attemptIsCurrent(attempt)) throw runtimeStartCancelledError();
    const listed = await client.listTools();
    if (!attemptIsCurrent(attempt)) throw runtimeStartCancelledError();
    const toolNames = listed.tools.map((tool) => tool.name).sort();
    const missingTools = MCP_ALLOWLIST_TOOL_NAMES.filter((name) => !toolNames.includes(name));
    if (missingTools.length > 0) {
      throw new Error(`Bundled browser-bridge is missing required MCP tools: ${missingTools.join(", ")}`);
    }
    const unexpectedTools = toolNames.filter((name) => !MCP_ALLOWLIST_TOOL_NAMES.includes(name));
    if (unexpectedTools.length > 0) {
      throw new Error("Bundled browser-bridge exposed tools outside the private allowlist");
    }
    const created = {
      key: runtimeKey(config),
      client,
      transport,
      config,
      toolNames,
      publicToolNames: publicWorkflowTools(toolNames),
      connectedAt: new Date().toISOString(),
      generation: ++generation,
    };
    runtime = created;
    lastError = null;
    return created;
  } catch (error) {
    await closeMcpResources(client, transport);
    throw error;
  }
}

async function withLifecycleLock(task) {
  const previous = lifecycleLock;
  let release;
  lifecycleLock = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

async function ensureMcpRuntimeUnlocked(ctx = {}, { explicit = false } = {}) {
  const config = await resolveConfig(ctx);
  const key = runtimeKey(config);
  if ((runtime && runtime.key !== key) || (connectAttempt && connectAttempt.key !== key)) {
    await shutdownMcpRuntime({ stopChrome: false });
  }
  if (requiresExplicitStart(config) && !explicit && explicitStartKey !== key) {
    throw new Error("EXPLICIT_CONNECT_REQUIRED: use the reviewed browser_bridge_start action before accessing the user's Chrome browser");
  }
  if (runtime?.key === key) {
    if (explicit) explicitStartKey = key;
    return runtime;
  }
  if (!connectAttempt) {
    const attempt = {
      key,
      epoch: lifecycleEpoch,
      cancelled: false,
      client: null,
      transport: null,
      promise: null,
    };
    connectAttempt = attempt;
    attempt.promise = openRuntime(ctx, config, attempt).finally(() => {
      if (connectAttempt === attempt) connectAttempt = null;
    });
  }
  const attempt = connectAttempt;
  const active = await attempt.promise;
  if (!attemptIsCurrent(attempt)) throw runtimeStartCancelledError();
  if (active.key !== key) throw new Error("RUNTIME_KEY_MISMATCH: browser bridge runtime configuration changed during startup");
  if (explicit) explicitStartKey = key;
  return active;
}

export async function ensureMcpRuntime(ctx = {}, options = {}) {
  return await withLifecycleLock(() => ensureMcpRuntimeUnlocked(ctx, options));
}

export async function callBridgeTool(name, args = {}, ctx = {}) {
  let active = await ensureMcpRuntime(ctx);
  if (!active.publicToolNames.includes(name)) throw new Error(`MCP tool is not available in workflow profile: ${name}`);

  if (active.config.connectionMode === "existing-chrome") {
    try {
      const result = await existingChromeConnectGuard.invoke(
        active.key,
        () => active.client.callTool({ name, arguments: args || {} }),
      );
      const guardStatus = existingChromeConnectGuard.status(active.key);
      lastError = guardStatus.retryBlockReason === "consent-denied"
        ? "CONSENT_DENIED"
        : guardStatus.retryBlockReason === "connection-failed"
          ? "BROWSER_CONNECTION_FAILED"
          : null;
      return result;
    } catch (error) {
      lastError = [
        "BROWSER_CONNECT_REVIEW_REQUIRED",
        "BROWSER_CONNECT_ATTEMPT_IN_PROGRESS",
        "RUNTIME_START_CANCELLED",
      ].includes(error?.code)
        ? error.code
        : "BROWSER_CONNECTION_FAILED";
      throw error;
    }
  }

  try {
    return await active.client.callTool({ name, arguments: args || {} });
  } catch (error) {
    lastError = "MCP_TOOL_CALL_FAILED";
    ctx?.log?.error?.(`browser-bridge MCP tool error: ${sanitizeError(error)}`);
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
  const guardStatus = config.connectionMode === "existing-chrome"
    ? existingChromeConnectGuard.status(key)
    : { retryBlocked: false, retryBlockReason: null, attemptInFlight: false, browserConnected: false };
  return {
    ok: browserProbe.ok
      && !!runtime
      && runtime.key === key
      && !guardStatus.retryBlocked
      && (config.connectionMode !== "existing-chrome" || guardStatus.browserConnected),
    name: "Browser Bridge for HanaAgent",
    pluginVersion: "0.2.5",
    connection: {
      mode: config.connectionMode,
      ownsBrowser: config.ownsBrowser,
      explicitStartRequired: requiresExplicitStart(config),
      explicitStartGranted: !requiresExplicitStart(config) || explicitStartKey === key,
      ...guardStatus,
    },
    mcp: {
      connected: !!runtime && runtime.key === key,
      generation: runtime?.generation || generation,
      connectedAt: runtime?.connectedAt || null,
      toolCount: runtime?.publicToolNames?.length || 0,
      tools: runtime?.publicToolNames || [],
      lastError,
      bridgeDirectory: config.bridgeAvailable ? "configured-and-available" : "configured-unavailable",
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
          error: browserProbe.ok
            ? null
            : browserProbe.activePortPresent ? "ENDPOINT_UNAVAILABLE" : "ENDPOINT_MISSING",
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
  const config = await resolveConfig(ctx);
  const key = runtimeKey(config);
  if (
    config.connectionMode === "existing-chrome"
    && runtime?.key === key
    && (
      existingChromeConnectGuard.status(key).retryBlocked
      || existingChromeConnectGuard.status(key).browserConnected
    )
  ) {
    // Every reviewed start receives a fresh one-attempt generation. This avoids
    // implicit reconnects after denial, timeout, or a Chrome restart.
    await shutdownMcpRuntime({ stopChrome: false });
  }

  const active = await ensureMcpRuntime(ctx, { explicit: true });
  if (active.config.connectionMode !== "existing-chrome") {
    return {
      ok: true,
      connected: true,
      mcpConnected: true,
      browserConnected: true,
      retryBlocked: false,
      retryBlockReason: null,
      errorCode: null,
      connectionMode: active.config.connectionMode,
      ownsBrowser: active.config.ownsBrowser,
      toolCount: active.publicToolNames.length,
      tools: active.publicToolNames,
    };
  }

  // The reviewed start must itself consume the single Chrome consent attempt.
  // Deferring it to browser_list_tabs made HanaAgent report start success before
  // Chrome was connected and left the human only the unreviewed tool's short
  // WebSocket-open window to answer the prompt.
  existingChromeConnectGuard.reviewedStart(active.key);
  let thrownCode = null;
  try {
    await existingChromeConnectGuard.invoke(
      active.key,
      () => active.client.callTool({ name: "browser_connect", arguments: {} }),
    );
  } catch (error) {
    thrownCode = typeof error?.code === "string" ? error.code : "BROWSER_CONNECTION_FAILED";
  }

  const guardStatus = existingChromeConnectGuard.status(active.key);
  const browserConnected = guardStatus.browserConnected && !guardStatus.retryBlocked;
  const errorCode = browserConnected
    ? null
    : thrownCode
      || (guardStatus.retryBlockReason === "consent-denied"
        ? "CONSENT_DENIED"
        : "BROWSER_CONNECTION_FAILED");
  lastError = errorCode;

  return {
    ok: browserConnected,
    connected: browserConnected,
    mcpConnected: true,
    browserConnected,
    retryBlocked: guardStatus.retryBlocked,
    retryBlockReason: guardStatus.retryBlockReason,
    errorCode,
    connectionMode: active.config.connectionMode,
    ownsBrowser: active.config.ownsBrowser,
    toolCount: active.publicToolNames.length,
    tools: active.publicToolNames,
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
  const pending = connectAttempt;
  lifecycleEpoch += 1;
  if (pending) pending.cancelled = true;
  connectAttempt = null;
  runtime = null;
  explicitStartKey = null;
  existingChromeConnectGuard.clear();
  await closeMcpResources(active?.client, active?.transport);
  if (pending?.transport && pending.transport !== active?.transport) {
    await closeMcpResources(pending.client, pending.transport);
  }
  // stopDedicatedChrome only ever targets a process spawned and owned by this plugin.
  const chrome = stopChrome ? await stopDedicatedChrome() : null;
  return { ok: true, mcpStopped: !!active || !!pending, chrome };
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
