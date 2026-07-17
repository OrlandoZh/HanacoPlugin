import fs from "node:fs";
import path from "node:path";

function isBridgeDirectory(candidate) {
  if (!candidate) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(candidate, "package.json"), "utf8"));
    return pkg.name === "browser-bridge"
      && fs.existsSync(path.join(candidate, "lib"))
      && fs.existsSync(path.join(candidate, "tools"))
      && fs.existsSync(path.join(candidate, "scripts", "start-mcp-server-stdio.mjs"));
  } catch {
    return false;
  }
}

function cliValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : "";
}

export function resolveBridgeSource(pluginDir, argv = process.argv.slice(2), env = process.env) {
  const repoRoot = path.resolve(pluginDir, "..", "..");
  const configPath = path.join(pluginDir, "browser-bridge.source.json");
  let configured = "";
  if (fs.existsSync(configPath)) {
    try {
      configured = JSON.parse(fs.readFileSync(configPath, "utf8")).bridgeDirectory || "";
    } catch (error) {
      throw new Error(`Invalid ${configPath}: ${error.message}`);
    }
  }

  const candidates = [
    cliValue(argv, "--bridge-dir"),
    env.BROWSER_BRIDGE_DIR,
    env.BB_SOURCE_DIR,
    configured,
    path.resolve(repoRoot, "..", "browser-bridge"),
  ].filter(Boolean).map((candidate) => path.resolve(candidate));

  const match = candidates.find(isBridgeDirectory);
  if (match) return match;

  const checked = candidates.length ? candidates.map((item) => `  - ${item}`).join("\n") : "  - (none)";
  throw new Error(
    "Cannot locate the browser-bridge source repository.\n" +
    "Set BROWSER_BRIDGE_DIR, pass --bridge-dir, or create browser-bridge.source.json.\n" +
    `Checked:\n${checked}`,
  );
}
