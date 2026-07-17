import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

let ownedChrome = null;
let ownedConfigKey = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function cdpVersionUrl(config) {
  const host = config.cdpHost === "::1" ? "[::1]" : config.cdpHost;
  return `http://${host}:${config.cdpPort}/json/version`;
}

export async function probeCdp(config, timeoutMs = 1000) {
  return await new Promise((resolve) => {
    const req = http.get(cdpVersionUrl(config), { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ ok: res.statusCode === 200, statusCode: res.statusCode, version: parsed });
        } catch {
          resolve({ ok: false, statusCode: res.statusCode, error: "Invalid CDP response" });
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("CDP probe timed out")));
    req.on("error", (error) => resolve({ ok: false, error: error.message }));
  });
}


export function devToolsActivePortPath(config) {
  return path.join(config.existingChromeUserDataDir, "DevToolsActivePort");
}

export function parseDevToolsActivePort(content) {
  const lines = String(content || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const port = Number(lines[0]);
  const wsPath = lines[1] || "";
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid DevToolsActivePort port");
  if (!/^\/devtools\/browser\/[A-Za-z0-9._-]+$/.test(wsPath)) throw new Error("Invalid DevToolsActivePort browser path");
  return { port, wsPath };
}

async function probeTcpPort(port, timeoutMs = 500) {
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const done = (ok, error) => {
      socket.destroy();
      resolve({ ok, error });
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false, "timeout"));
    socket.once("error", (error) => done(false, error.message));
  });
}

export async function inspectExistingChrome(config) {
  const activePortPath = devToolsActivePortPath(config);
  try {
    const content = fs.readFileSync(activePortPath, "utf8");
    const parsed = parseDevToolsActivePort(content);
    const tcp = await probeTcpPort(parsed.port);
    return {
      ok: tcp.ok,
      activePortPresent: true,
      port: parsed.port,
      userDataDir: config.existingChromeUserDataDir,
      error: tcp.ok ? null : "Chrome remote debugging endpoint is not reachable",
    };
  } catch (error) {
    return {
      ok: false,
      activePortPresent: fs.existsSync(activePortPath),
      port: null,
      userDataDir: config.existingChromeUserDataDir,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function startDedicatedChrome(config, { waitMs = 12000 } = {}) {
  const existing = await probeCdp(config);
  if (existing.ok) return { ok: true, alreadyRunning: true, owned: false, cdp: existing };
  if (!fs.existsSync(config.chromeExecutable)) {
    return { ok: false, error: `Chrome executable not found: ${config.chromeExecutable}` };
  }
  fs.mkdirSync(config.chromeProfileDir, { recursive: true, mode: 0o700 });

  const key = `${config.cdpHost}:${config.cdpPort}:${config.chromeProfileDir}`;
  if (ownedChrome && ownedConfigKey === key && ownedChrome.exitCode === null) {
    return { ok: true, alreadyRunning: true, owned: true, pid: ownedChrome.pid };
  }

  const args = [
    `--remote-debugging-address=${config.cdpHost}`,
    `--remote-debugging-port=${config.cdpPort}`,
    `--user-data-dir=${config.chromeProfileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ];
  const child = spawn(config.chromeExecutable, args, {
    detached: false,
    stdio: "ignore",
    env: { ...process.env },
  });
  ownedChrome = child;
  ownedConfigKey = key;
  child.once("exit", () => {
    if (ownedChrome === child) {
      ownedChrome = null;
      ownedConfigKey = null;
    }
  });

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const probe = await probeCdp(config);
    if (probe.ok) return { ok: true, alreadyRunning: false, owned: true, pid: child.pid, cdp: probe };
    if (child.exitCode !== null) return { ok: false, error: `Chrome exited with code ${child.exitCode}` };
    await sleep(250);
  }
  return { ok: false, error: `Chrome did not expose CDP within ${waitMs}ms`, pid: child.pid };
}

export async function stopDedicatedChrome() {
  if (!ownedChrome || ownedChrome.exitCode !== null) {
    ownedChrome = null;
    ownedConfigKey = null;
    return { ok: true, stopped: false, reason: "No plugin-owned Chrome process" };
  }
  const child = ownedChrome;
  child.kill("SIGTERM");
  const deadline = Date.now() + 5000;
  while (child.exitCode === null && Date.now() < deadline) await sleep(100);
  if (child.exitCode === null) child.kill("SIGKILL");
  ownedChrome = null;
  ownedConfigKey = null;
  return { ok: true, stopped: true, pid: child.pid };
}

export function getOwnedChromeStatus() {
  return {
    owned: !!ownedChrome && ownedChrome.exitCode === null,
    pid: ownedChrome?.exitCode === null ? ownedChrome.pid : null,
    configKey: ownedConfigKey,
  };
}
