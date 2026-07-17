import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { resolveBridgeSource } from "./resolve-bridge-source.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(here, "..");
const bridgeDir = resolveBridgeSource(pluginDir);
const pkg = JSON.parse(fs.readFileSync(path.join(pluginDir, "package.json"), "utf8"));
const distDir = path.join(pluginDir, "dist");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hana-browser-bridge-package-"));
const stage = path.join(tempRoot, pkg.name);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

run(process.execPath, [path.join(here, "sync-bridge.mjs"), "--bridge-dir", bridgeDir]);
run(process.execPath, [path.join(here, "generate-tools.mjs"), "--bridge-dir", bridgeDir]);
const bundledMetadata = JSON.parse(fs.readFileSync(
  path.join(pluginDir, "vendor", "browser-bridge", "BUNDLED_VERSION.json"),
  "utf8",
));
if (bundledMetadata.dirty && process.env.ALLOW_DIRTY_BRIDGE_PACKAGE !== "1") {
  throw new Error(
    "Refusing to package a dirty browser-bridge runtime. Commit the core runtime changes first, "
    + "or set ALLOW_DIRTY_BRIDGE_PACKAGE=1 only for a non-release development bundle.",
  );
}
fs.mkdirSync(stage, { recursive: true });
for (const entry of fs.readdirSync(pluginDir)) {
  if (["node_modules", "dist", "test"].includes(entry)) continue;
  fs.cpSync(path.join(pluginDir, entry), path.join(stage, entry), { recursive: true });
}
run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: stage });
fs.mkdirSync(distDir, { recursive: true });
const zipPath = path.join(distDir, `${pkg.name}-${pkg.version}.zip`);
fs.rmSync(zipPath, { force: true });
run("zip", ["-qr", zipPath, "."], { cwd: stage });
const sha = crypto.createHash("sha256").update(fs.readFileSync(zipPath)).digest("hex");
fs.writeFileSync(`${zipPath}.sha256`, `${sha}  ${path.basename(zipPath)}\n`);
fs.rmSync(tempRoot, { recursive: true, force: true });
console.log(`Created ${zipPath}`);
console.log(`SHA256 ${sha}`);
