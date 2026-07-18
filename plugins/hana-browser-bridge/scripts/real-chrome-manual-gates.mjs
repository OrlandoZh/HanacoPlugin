#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 30000;

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

export function defaultChromeUserDataDir(platform = process.platform, home = os.homedir()) {
  if (platform === "darwin") return path.join(home, "Library/Application Support/Google/Chrome");
  if (platform === "linux") return path.join(home, ".config/google-chrome");
  if (platform === "win32") return path.join(home, "AppData/Local/Google/Chrome/User Data");
  throw new Error(`Unsupported platform: ${platform}`);
}

export function parseDevToolsActivePort(content) {
  const lines = String(content || "").split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length !== 2) throw new Error("Invalid DevToolsActivePort format");
  const portText = lines[0];
  const browserPath = lines[1];
  if (!/^[1-9][0-9]{0,4}$/.test(portText)) throw new Error("Invalid DevToolsActivePort port");
  const port = Number(portText);
  if (port > 65535) throw new Error("Invalid DevToolsActivePort port");
  if (!/^\/devtools\/browser\/[A-Za-z0-9._-]{8,}$/.test(browserPath)) {
    throw new Error("Invalid DevToolsActivePort browser path");
  }
  return { port, browserPath };
}

export function endpointFingerprint({ port, browserPath }) {
  return crypto.createHash("sha256").update(`${port}\n${browserPath}\n`).digest("hex").slice(0, 16);
}

async function tcpReachable(port, timeoutMs = 1200) {
  return await new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const finish = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

export async function captureSnapshot(userDataDir) {
  const activePortFile = path.join(userDataDir, "DevToolsActivePort");
  let parsed;
  try {
    parsed = parseDevToolsActivePort(fs.readFileSync(activePortFile, "utf8"));
  } catch (error) {
    return {
      schema: 1,
      capturedAt: new Date().toISOString(),
      activePortPresent: fs.existsSync(activePortFile),
      endpointValid: false,
      endpointReachable: false,
      endpointFingerprint: null,
      errorClass: error?.code === "ENOENT" ? "ENDPOINT_MISSING" : "ENDPOINT_INVALID",
    };
  }
  return {
    schema: 1,
    capturedAt: new Date().toISOString(),
    activePortPresent: true,
    endpointValid: true,
    endpointReachable: await tcpReachable(parsed.port),
    endpointFingerprint: endpointFingerprint(parsed),
    errorClass: null,
  };
}

function assertSafeSnapshot(snapshot) {
  const serialized = JSON.stringify(snapshot);
  if (/devtools\/browser\//i.test(serialized) || /webSocketDebuggerUrl|sessionId/i.test(serialized)) {
    throw new Error("Snapshot contains forbidden routing material");
  }
  if (/\b(?:[1-9][0-9]{3,4})\b/.test(String(snapshot.endpoint || ""))) {
    throw new Error("Snapshot contains a raw endpoint port");
  }
  return snapshot;
}


export function classifyUnexpectedResponse(statusCode, expected) {
  const denied = statusCode === 401 || statusCode === 403;
  return {
    observed: denied ? "deny" : "connection-error",
    passed: denied && expected === "deny",
    responseClass: `HTTP_${statusCode || "UNKNOWN"}`,
  };
}

export function classifyProbeError(message, expected) {
  const denied = /(?:unexpected server response:\s*)?(?:401|403)|denied|reject/i.test(String(message || ""));
  return {
    observed: denied ? "deny" : "connection-error",
    passed: denied && expected === "deny",
  };
}

async function probeAuthorization(userDataDir, expected, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const parsed = parseDevToolsActivePort(fs.readFileSync(path.join(userDataDir, "DevToolsActivePort"), "utf8"));
  const { default: WebSocket } = await import("ws");
  const ws = new WebSocket(`ws://127.0.0.1:${parsed.port}${parsed.browserPath}`, { handshakeTimeout: timeoutMs });
  return await new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.terminate(); } catch {}
      resolve({
        schema: 1,
        capturedAt: new Date().toISOString(),
        expected,
        ...result,
      });
    };
    ws.once("open", () => finish({ observed: "allow", passed: expected === "allow" }));
    ws.once("unexpected-response", (_request, response) => {
      response.resume();
      finish(classifyUnexpectedResponse(response.statusCode, expected));
    });
    ws.once("error", (error) => finish(classifyProbeError(error?.message || error, expected)));
    ws.once("close", () => finish({ observed: "closed-before-open", passed: false }));
    timer = setTimeout(() => finish({ observed: "authorization-timeout", passed: false }), timeoutMs + 1000);
  });
}

export async function runCli(argv = process.argv.slice(2)) {
  const command = argv[0];
  const userDataDir = path.resolve(argValue(argv, "--user-data-dir") || defaultChromeUserDataDir());
  if (command === "snapshot") {
    const snapshot = assertSafeSnapshot(await captureSnapshot(userDataDir));
    const output = argValue(argv, "--output");
    if (output) fs.writeFileSync(path.resolve(output), `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify(snapshot)}\n`);
    return snapshot.endpointValid && snapshot.endpointReachable ? 0 : 2;
  }
  if (command === "compare") {
    const beforeFile = argValue(argv, "--before");
    if (!beforeFile) throw new Error("compare requires --before <snapshot.json>");
    const before = JSON.parse(fs.readFileSync(path.resolve(beforeFile), "utf8"));
    const current = assertSafeSnapshot(await captureSnapshot(userDataDir));
    const result = assertSafeSnapshot({
      schema: 1,
      capturedAt: current.capturedAt,
      beforeReachable: before.endpointReachable === true,
      currentReachable: current.endpointReachable === true,
      endpointChanged: Boolean(before.endpointFingerprint && current.endpointFingerprint
        && before.endpointFingerprint !== current.endpointFingerprint),
      currentFingerprint: current.endpointFingerprint,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.currentReachable && result.endpointChanged ? 0 : 3;
  }
  if (command === "probe") {
    const expected = argValue(argv, "--expect");
    if (!['allow', 'deny'].includes(expected)) throw new Error("probe requires --expect allow|deny");
    const result = assertSafeSnapshot(await probeAuthorization(userDataDir, expected));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.passed ? 0 : 4;
  }
  throw new Error("Usage: real-chrome-manual-gates.mjs snapshot [--output file] | compare --before file | probe --expect allow|deny");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  runCli().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${JSON.stringify({ ok: false, errorClass: "MANUAL_GATE_ERROR" })}\n`);
    process.exitCode = 1;
  });
}
