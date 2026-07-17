import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULTS = Object.freeze({
  cdpHost: "127.0.0.1",
  cdpPort: 19282,
  chromeExecutable: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  chromeProfileDir: "~/.hanako/browser-bridge/chrome-profile",
  autoStartChrome: true,
  bridgeDirectory: "",
  toolProfile: "workflow",
});

export function expandHome(value) {
  if (typeof value !== "string") return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function assertLoopbackHost(host) {
  const normalized = String(host || "").trim().toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(normalized)) {
    throw new Error(`CDP host must be loopback-only; received ${host}`);
  }
  return normalized === "localhost" ? "127.0.0.1" : normalized;
}

export function assertSafeProfileDir(profileDir) {
  const resolved = path.resolve(expandHome(profileDir));
  const unsafe = [
    path.join(os.homedir(), "Library/Application Support/Google/Chrome"),
    path.join(os.homedir(), "Library/Application Support/Chromium"),
  ];
  if (unsafe.some((candidate) => resolved === candidate || resolved.startsWith(`${candidate}${path.sep}`))) {
    throw new Error("Dedicated Chrome profile cannot use the daily Chrome/Chromium profile directory");
  }
  return resolved;
}

async function getConfigValue(ctx, key) {
  try {
    const value = await ctx?.config?.get?.(key);
    return value === undefined ? DEFAULTS[key] : value;
  } catch {
    return DEFAULTS[key];
  }
}

export async function resolveConfig(ctx = {}) {
  const raw = {};
  for (const key of Object.keys(DEFAULTS)) raw[key] = await getConfigValue(ctx, key);

  const cdpPort = Number(raw.cdpPort);
  if (!Number.isInteger(cdpPort) || cdpPort < 1024 || cdpPort > 65535) {
    throw new Error(`Invalid CDP port: ${raw.cdpPort}`);
  }
  const toolProfile = String(raw.toolProfile || "workflow");
  if (toolProfile !== "workflow") throw new Error("Only the workflow tool profile is permitted");

  const pluginDir = path.resolve(ctx.pluginDir || path.join(process.cwd(), "integrations/hanaagent-browser-bridge"));
  const configuredBridge = String(raw.bridgeDirectory || "").trim();
  const bridgeDirectory = configuredBridge
    ? path.resolve(expandHome(configuredBridge))
    : path.join(pluginDir, "vendor", "browser-bridge");
  const bridgeEntrypoint = path.join(bridgeDirectory, "scripts", "start-mcp-server-stdio.mjs");

  return {
    cdpHost: assertLoopbackHost(raw.cdpHost),
    cdpPort,
    chromeExecutable: path.resolve(expandHome(String(raw.chromeExecutable || DEFAULTS.chromeExecutable))),
    chromeProfileDir: assertSafeProfileDir(String(raw.chromeProfileDir || DEFAULTS.chromeProfileDir)),
    autoStartChrome: raw.autoStartChrome !== false,
    bridgeDirectory,
    bridgeEntrypoint,
    bridgeAvailable: fs.existsSync(bridgeEntrypoint),
    toolProfile,
  };
}

export { DEFAULTS };
