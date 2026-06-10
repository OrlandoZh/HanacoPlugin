import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(pluginDir, "../..");
const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "manifest.json"), "utf8"));
const outDir = path.join(repoRoot, "dist", "plugins");
const stageDir = path.join(outDir, `${manifest.id}-package`);
const packageRoot = path.join(stageDir, manifest.id);
const zipPath = path.join(outDir, `${manifest.id}-${manifest.version}.zip`);

const include = [
  "manifest.json",
  "index.js",
  "README.md",
  "package.json",
  "lib",
  "routes"
];

fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(packageRoot, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

for (const entry of include) {
  const src = path.join(pluginDir, entry);
  if (!fs.existsSync(src)) continue;
  const dest = path.join(packageRoot, entry);
  fs.cpSync(src, dest, { recursive: true, filter: shouldCopy });
}

fs.rmSync(zipPath, { force: true });
const result = spawnSync("zip", ["-qr", zipPath, manifest.id], {
  cwd: stageDir,
  stdio: "inherit"
});
if (result.status !== 0) {
  throw new Error(`zip failed with status ${result.status}`);
}

console.log(zipPath);

function shouldCopy(src) {
  const base = path.basename(src);
  if (base === ".DS_Store") return false;
  if (base === "node_modules") return false;
  if (base === "tests") return false;
  if (base.startsWith(".")) return false;
  return true;
}
