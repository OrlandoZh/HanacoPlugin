/**
 * scripts/pack-ua-assets.mjs
 *
 * 将已构建并验收的 UA Human Layout dist 产物复制到
 * assets/ua/viewer/，并生成带 SHA-256 的资产 manifest。
 *
 * 产物目录故意使用 viewer/ 而非 dist/，以避免触发仓库根
 * .gitignore 中的 dist/ 规则。
 *
 * 行为：
 *   - 先清空目标目录，再复制 dist，避免旧 hash chunk 残留
 *   - 生成 manifest.json 时排除自身
 *   - 计算 assetSetSha256：按 path 排序后，对 "path|size|sha256\n" 拼接串求 SHA-256
 */

import {
  cpSync,
  mkdirSync,
  existsSync,
  statSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { resolve, join } from "node:path";
import crypto from "node:crypto";

const PLUGIN_ROOT = resolve(import.meta.dirname, "..");
const VIEWER_DIR = join(PLUGIN_ROOT, "assets", "ua", "viewer");
const MANIFEST_NAME = "manifest.json";

// 默认从 .run/ua-human-viewer/v2.9.0-human-20/ 复制
// 可通过 UA_DIST_ROOT 环境变量覆盖
const DEFAULT_DIST_ROOT = resolve(
  PLUGIN_ROOT,
  "..", "..", "..", "..", "..",
  ".run", "ua-human-viewer", "v2.9.0-human-20"
);
const DIST_ROOT = process.env.UA_DIST_ROOT || DEFAULT_DIST_ROOT;

console.log("UA dist root:", DIST_ROOT);
console.log("Assets target:", VIEWER_DIR);

const distDir = join(DIST_ROOT, "dist");
if (!existsSync(distDir)) {
  console.error("ERROR: dist/ not found at", distDir);
  console.error("Set UA_DIST_ROOT to the Understand-Anything viewer build directory.");
  process.exit(1);
}

// 先清空目标目录，防止旧 hash chunk 残留
if (existsSync(VIEWER_DIR)) {
  console.log("Removing existing viewer target...");
  rmSync(VIEWER_DIR, { recursive: true, force: true });
}
mkdirSync(VIEWER_DIR, { recursive: true });

// 复制 dist/
cpSync(distDir, VIEWER_DIR, { recursive: true, force: true });

// 对 index.html 做确定性 sanitize：直接去除 favicon/Google Fonts/preconnect 外链，
// 使直接访问 assets/ua/viewer/index.html 也不会触发外网请求。
// wrapper rewrite 保留作为第二层防御。
const indexPath = join(VIEWER_DIR, "index.html");
if (existsSync(indexPath)) {
  const rawIndex = readFileSync(indexPath, "utf-8");
  const sanitized = sanitizeUaIndexHtml(rawIndex);
  writeFileSync(indexPath, sanitized);
}

// 生成资产 hash manifest（排除 manifest.json 自身）
const entries = [];
let totalBytes = 0;

function sanitizeUaIndexHtml(html) {
  return html
    // 移除 favicon
    .replace(/<link[^>]*rel=["']icon["'][^>]*>/gi, "")
    .replace(/<link[^>]*rel=["']shortcut icon["'][^>]*>/gi, "")
    // 移除 Google Fonts 与预连接
    .replace(/<link[^>]*href=["']https:\/\/fonts\.googleapis\.com\/[^"']*["'][^>]*>/gi, "")
    .replace(/<link[^>]*href=["']https:\/\/fonts\.gstatic\.com\/[^"']*["'][^>]*>/gi, "")
    .replace(/<link[^>]*rel=["']preconnect["'][^>]*>/gi, "");
}

function walkDir(dir, rel) {
  for (const name of readdirSync(join(dir, rel))) {
    const p = join(rel, name);
    const fullPath = join(dir, p);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(dir, p);
      continue;
    }
    // 排除 manifest 自身
    if (p === `.${MANIFEST_NAME}` || p === MANIFEST_NAME) {
      continue;
    }
    const normalizedPath = p.replace(/\\/g, "/");
    const hash = crypto.createHash("sha256").update(readFileSync(fullPath)).digest("hex");
    entries.push({ path: normalizedPath, sizeBytes: stat.size, sha256: hash });
    totalBytes += stat.size;
  }
}

try {
  walkDir(VIEWER_DIR, ".");
} catch (err) {
  console.error("manifest walk failed:", err.message);
  process.exit(1);
}

const sorted = entries.sort((a, b) => a.path.localeCompare(b.path));

// 确定性 assetSetSha256：排序后每条 "path|sizeBytes|sha256\n"
const assetSetInput = sorted
  .map((f) => `${f.path}|${f.sizeBytes}|${f.sha256}`)
  .join("\n") + "\n";
const assetSetSha256 = crypto.createHash("sha256").update(assetSetInput).digest("hex");

const manifest = {
  generatedAt: new Date().toISOString(),
  source: "Understand Anything Viewer 2.9.0 Human Layout dist",
  assetSetSha256,
  totalBytes,
  fileCount: sorted.length,
  files: sorted,
};

writeFileSync(join(VIEWER_DIR, MANIFEST_NAME), JSON.stringify(manifest, null, 2));

// 校验与 UPSTREAM.json 的 distSha256 一致
const UPSTREAM_PATH = join(PLUGIN_ROOT, "third_party", "understand-anything", "UPSTREAM.json");
let upstreamMatch = false;
try {
  const upstream = JSON.parse(readFileSync(UPSTREAM_PATH, "utf-8"));
  if (upstream.distSha256 === assetSetSha256) {
    upstreamMatch = true;
    console.log("UPSTREAM.json distSha256 matches assetSetSha256");
  } else {
    console.error("WARNING: UPSTREAM.json distSha256 does not match generated assetSetSha256");
    console.error(`  UPSTREAM: ${upstream.distSha256}`);
    console.error(`  manifest: ${assetSetSha256}`);
    console.error(`  Update UPSTREAM.json distSha256 after verifying the new asset set.`);
  }
} catch (err) {
  console.error("WARNING: could not read/parse UPSTREAM.json for distSha256 verification:", err.message);
}

console.log(`Packed: ${manifest.fileCount} files, ${totalBytes} bytes total`);
console.log(`assetSetSha256: ${assetSetSha256}`);
console.log("manifest.json generated");
console.log("Done.");

if (!upstreamMatch) {
  process.exit(2);
}
