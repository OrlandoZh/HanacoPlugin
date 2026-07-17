import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONNECTION_MODES = Object.freeze(["dedicated", "existing-chrome"]);
const CHROME_CHANNELS = Object.freeze(["stable", "beta", "dev", "canary"]);

const DEFAULTS = Object.freeze({
  connectionMode: "dedicated",
  cdpHost: "127.0.0.1",
  cdpPort: 19282,
  chromeExecutable: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  chromeProfileDir: "~/.hanako/browser-bridge/chrome-profile",
  autoStartChrome: true,
  existingChromeChannel: "stable",
  existingChromeUserDataDir: "",
  existingChromeRequireExplicitStart: true,
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

export function resolveDefaultChromeUserDataDir(channel = "stable", platform = process.platform) {
  const normalized = String(channel || "stable").trim().toLowerCase();
  if (!CHROME_CHANNELS.includes(normalized)) throw new Error(`Unsupported Chrome channel: ${channel}`);

  const byPlatform = {
    darwin: {
      stable: ["Library", "Application Support", "Google", "Chrome"],
      beta: ["Library", "Application Support", "Google", "Chrome Beta"],
      dev: ["Library", "Application Support", "Google", "Chrome Dev"],
      canary: ["Library", "Application Support", "Google", "Chrome Canary"],
    },
    linux: {
      stable: [".config", "google-chrome"],
      beta: [".config", "google-chrome-beta"],
      dev: [".config", "google-chrome-unstable"],
      canary: [".config", "google-chrome-canary"],
    },
    win32: {
      stable: ["AppData", "Local", "Google", "Chrome", "User Data"],
      beta: ["AppData", "Local", "Google", "Chrome Beta", "User Data"],
      dev: ["AppData", "Local", "Google", "Chrome Dev", "User Data"],
      canary: ["AppData", "Local", "Google", "Chrome SxS", "User Data"],
    },
  };
  const segments = byPlatform[platform]?.[normalized];
  if (!segments) throw new Error(`Chrome user data discovery is not supported on ${platform}`);
  return path.join(os.homedir(), ...segments);
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

  const connectionMode = String(raw.connectionMode || DEFAULTS.connectionMode).trim();
  if (!CONNECTION_MODES.includes(connectionMode)) throw new Error(`Unsupported connection mode: ${connectionMode}`);

  const cdpPort = Number(raw.cdpPort);
  if (!Number.isInteger(cdpPort) || cdpPort < 1024 || cdpPort > 65535) {
    throw new Error(`Invalid CDP port: ${raw.cdpPort}`);
  }
  const toolProfile = String(raw.toolProfile || "workflow");
  if (toolProfile !== "workflow") throw new Error("Only the workflow tool profile is permitted");

  const existingChromeChannel = String(raw.existingChromeChannel || "stable").trim().toLowerCase();
  if (!CHROME_CHANNELS.includes(existingChromeChannel)) {
    throw new Error(`Unsupported Chrome channel: ${raw.existingChromeChannel}`);
  }
  if (raw.existingChromeRequireExplicitStart !== true) {
    throw new Error("existingChromeRequireExplicitStart cannot be disabled");
  }
  const configuredExistingDir = String(raw.existingChromeUserDataDir || "").trim();
  const existingChromeUserDataDir = path.resolve(
    expandHome(configuredExistingDir || resolveDefaultChromeUserDataDir(existingChromeChannel)),
  );

  const pluginDir = path.resolve(ctx.pluginDir || path.join(process.cwd(), "integrations/hanaagent-browser-bridge"));
  const configuredBridge = String(raw.bridgeDirectory || "").trim();
  const bridgeDirectory = configuredBridge
    ? path.resolve(expandHome(configuredBridge))
    : path.join(pluginDir, "vendor", "browser-bridge");
  const bridgeEntrypoint = path.join(bridgeDirectory, "scripts", "start-mcp-server-stdio.mjs");

  const configuredDedicatedProfile = String(raw.chromeProfileDir || DEFAULTS.chromeProfileDir);
  const dedicatedProfile = connectionMode === "dedicated"
    ? assertSafeProfileDir(configuredDedicatedProfile)
    : path.resolve(expandHome(configuredDedicatedProfile));
  return {
    connectionMode,
    ownsBrowser: connectionMode === "dedicated",
    cdpHost: assertLoopbackHost(raw.cdpHost),
    cdpPort,
    chromeExecutable: path.resolve(expandHome(String(raw.chromeExecutable || DEFAULTS.chromeExecutable))),
    chromeProfileDir: dedicatedProfile,
    autoStartChrome: connectionMode === "dedicated" && raw.autoStartChrome !== false,
    existingChromeChannel,
    existingChromeUserDataDir,
    existingChromeRequireExplicitStart: raw.existingChromeRequireExplicitStart,
    bridgeDirectory,
    bridgeEntrypoint,
    bridgeAvailable: fs.existsSync(bridgeEntrypoint),
    toolProfile,
  };
}

export { DEFAULTS, CONNECTION_MODES, CHROME_CHANNELS };
