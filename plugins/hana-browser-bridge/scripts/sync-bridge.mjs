import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { resolveBridgeSource } from "./resolve-bridge-source.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(here, "..");
const bridgeDir = resolveBridgeSource(pluginDir);
const destination = path.join(pluginDir, "vendor", "browser-bridge");

fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(path.join(destination, "scripts"), { recursive: true });
fs.cpSync(path.join(bridgeDir, "lib"), path.join(destination, "lib"), { recursive: true });
fs.cpSync(path.join(bridgeDir, "tools"), path.join(destination, "tools"), { recursive: true });
fs.copyFileSync(path.join(bridgeDir, "scripts", "start-mcp-server-stdio.mjs"), path.join(destination, "scripts", "start-mcp-server-stdio.mjs"));
fs.copyFileSync(path.join(bridgeDir, "package.json"), path.join(destination, "package.json"));
for (const optional of ["LICENSE", "CHANGELOG.md"]) {
  if (fs.existsSync(path.join(bridgeDir, optional))) fs.copyFileSync(path.join(bridgeDir, optional), path.join(destination, optional));
}

let commit = "unknown";
try { commit = execFileSync("git", ["-C", bridgeDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch {}
let dirty = true;
try {
  const status = execFileSync("git", [
    "-C", bridgeDir, "status", "--porcelain", "--untracked-files=no", "--",
    "lib", "tools", "scripts/start-mcp-server-stdio.mjs", "package.json",
  ], { encoding: "utf8" }).trim();
  dirty = status.length > 0;
} catch {}
const pkg = JSON.parse(fs.readFileSync(path.join(bridgeDir, "package.json"), "utf8"));
fs.writeFileSync(path.join(destination, "BUNDLED_VERSION.json"), JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  commit,
  dirty,
  syncedAt: new Date().toISOString(),
}, null, 2) + "\n");
console.log(`Synced browser-bridge ${pkg.version} (${commit.slice(0, 12)}${dirty ? "+dirty" : ""}) -> ${destination}`);
