/**
 * scripts/package-plugin.mjs
 *
 * 可重现、可审计的 Hana Code Atlas 插件 zip 打包。
 *
 * 设计目标：
 *   - 显式 include allowlist：只打包指定顶层条目
 *   - 打包前硬校验：必需文件、assets manifest 三方一致
 *     （磁盘文件 ↔ manifest 条目 ↔ manifest.assetSetSha256 ↔ UPSTREAM.distSha256）、
 *     human-layout.patch SHA 与 UPSTREAM 一致、hana adapter patch 必须 superseded、
 *     禁止 TBD 出现在 active patch/hash 字段
 *   - 可重现：临时 staging、固定 SOURCE_DATE_EPOCH、统一 mtime、zip -X、排序文件列表
 *   - 打包后验证：zip entry 无绝对路径/../、无 symlink、无排除项，manifest 位于根
 *   - 写 sha256 sidecar
 *
 * 用法：
 *   node scripts/package-plugin.mjs                      # 打包到 dist/
 *   SOURCE_DATE_EPOCH=1234567890 node scripts/package-plugin.mjs
 *
 * 导出的 helpers 可在 tests/package-plugin.test.js 中直接测试；
 * 实际打包仅在直接执行本文件时发生（import.meta.url === 主模块 URL）。
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
  lstatSync,
  readdirSync,
  copyFileSync,
  mkdirSync,
  rmSync,
  mkdtempSync,
  utimesSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

// ─── 常量 ──────────────────────────────────────────────

const PLUGIN_ROOT = resolve(import.meta.dirname, "..");

/** 2000-01-01T00:00:00Z — UA upstream commit 时间未知时的默认 SOURCE_DATE_EPOCH */
export const DEFAULT_SOURCE_DATE_EPOCH = 946684800;

/**
 * 显式 include allowlist（顶层条目，相对插件根）。
 * 以 / 结尾表示目录（递归包含）；否则为精确文件名。
 * docs/ 可选包含（这里选择包含）。
 */
export const INCLUDE_TOP_LEVEL = [
  "manifest.json",
  "index.js",
  "README.md",
  "package.json",
  "assets/",
  "lib/",
  "routes/",
  "tools/",
  "pipeline/",
  "third_party/",
  "docs/",
];

/** 打包前必须存在的文件/目录（相对插件根） */
export const REQUIRED_PATHS = [
  "manifest.json",
  "index.js",
  "README.md",
  "package.json",
  "assets",
  "lib",
  "routes",
  "tools",
  "pipeline",
  "third_party/understand-anything",
  "assets/ua/viewer/manifest.json",
  "assets/ua/embedded/manifest.json",
  "assets/ua/embedded/viewer.js",
  "assets/ua/embedded/viewer.css",
  "assets/ua/hana-overlay.js",
  "assets/ua/hana-overlay.css",
  "third_party/pixelarticons/LICENSE",
  "third_party/understand-anything/UPSTREAM.json",
  "third_party/understand-anything/human-layout.patch",
];

// ─── PackError ─────────────────────────────────────────

export class PackError extends Error {
  constructor(message, issues = []) {
    const detail = issues.length ? `${message}:\n  - ${issues.join("\n  - ")}` : message;
    super(detail);
    this.name = "PackError";
    this.issues = issues;
  }
}

// ─── 纯 helpers（无副作用，可单测）─────────────────────

/**
 * 规范化相对路径：去掉前导 ./ 和前导 /
 */
export function normalizeRelPath(p) {
  let norm = p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
  // 去掉尾部 / （目录标记），统一按文件路径处理
  norm = norm.replace(/\/+$/, "");
  return norm;
}

/**
 * 判断相对路径是否命中 include allowlist（顶层匹配）
 */
export function isAllowlisted(relPath) {
  const p = normalizeRelPath(relPath);
  if (!p) return false;
  return INCLUDE_TOP_LEVEL.some((entry) => {
    if (entry.endsWith("/")) {
      return p === entry.slice(0, -1) || p.startsWith(entry);
    }
    return p === entry;
  });
}

/**
 * 判断相对路径是否命中排除规则。
 * 排除：tests 目录、dist 目录、node_modules、__pycache__、*.pyc、
 *       .DS_Store、隐藏缓存（以 . 开头的段）、runtime test 文件、symlink
 */
export function isExcluded(relPath) {
  const p = normalizeRelPath(relPath);
  if (!p) return true;
  const segs = p.split("/");
  for (const seg of segs) {
    // 隐藏文件/缓存（. 开头）
    if (seg.startsWith(".")) return true;
    if (seg === "__pycache__") return true;
    if (seg === "tests") return true;
    if (seg === "dist") return true;
    if (seg === "node_modules") return true;
  }
  const base = segs[segs.length - 1];
  // *.pyc
  if (/\.pyc$/i.test(base)) return true;
  // runtime test 文件
  if (/^test_.*\.py$/i.test(base)) return true;
  if (/.*_test\.py$/i.test(base)) return true;
  if (/\.(test|spec)\.(js|mjs|ts)$/i.test(base)) return true;
  // .DS_Store（已被 . 规则覆盖，显式列出以防遗漏）
  if (base === ".DS_Store") return true;
  return false;
}

/**
 * 同时满足 allowlist 且不排除 → 应打包
 */
export function shouldPackage(relPath) {
  return isAllowlisted(relPath) && !isExcluded(relPath);
}

/**
 * 计算文件的 SHA-256（同步，读取整个文件）
 */
export function computeFileSha256(filePath) {
  return crypto.createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/**
 * 确定性 assetSetSha256：按 path 排序后，对 "path|sizeBytes|sha256\n" 拼接求 SHA-256。
 * 与 pack-ua-assets.mjs / viewer-wrapper.test.js 的约定完全一致。
 */
export function computeAssetSetSha256(entries) {
  const input =
    entries
      .slice()
      .sort((a, b) => String(a.path).localeCompare(String(b.path)))
      .map((f) => `${f.path}|${f.sizeBytes}|${f.sha256}`)
      .join("\n") + "\n";
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * 解析 SOURCE_DATE_EPOCH 环境变量，返回 epoch 秒数。
 * - 环境变量存在且为非负整数 → 使用该值
 * - 否则 → 默认 DEFAULT_SOURCE_DATE_EPOCH (2000-01-01)
 */
export function resolveSourceDateEpoch(env = process.env) {
  const raw = env.SOURCE_DATE_EPOCH;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
      throw new PackError(`invalid SOURCE_DATE_EPOCH: ${raw} (must be a non-negative integer)`);
    }
    return n;
  }
  return DEFAULT_SOURCE_DATE_EPOCH;
}

/**
 * 纯函数：检查 zip entry 名列表是否有违规。
 * 返回违规描述数组（空 = 全部通过）。
 */
export function checkZipEntryNames(entryNames) {
  const violations = [];
  let manifestAtRoot = false;

  for (const raw of entryNames) {
    const name = String(raw).trim();
    if (!name) continue;

    // 绝对路径
    if (name.startsWith("/")) {
      violations.push(`absolute path: ${name}`);
    }
    // 反斜杠（Windows 风格）
    if (name.includes("\\")) {
      violations.push(`backslash in entry: ${name}`);
    }
    // 路径穿越 ..
    if (name.includes("..")) {
      violations.push(`path traversal: ${name}`);
    }
    // 前导 ./
    if (name.startsWith("./")) {
      violations.push(`leading ./: ${name}`);
    }
    // 排除项
    if (isExcluded(name)) {
      violations.push(`excluded entry in zip: ${name}`);
    }
    // 非 allowlist
    if (!isAllowlisted(name)) {
      violations.push(`non-allowlisted entry: ${name}`);
    }
    // manifest 位于根
    if (name === "manifest.json") {
      manifestAtRoot = true;
    }
  }

  if (!manifestAtRoot) {
    violations.push("manifest.json not found at zip root");
  }

  return violations;
}

/**
 * 纯函数：从 zipinfo 详细输出中提取 symlink entry 名称。
 * zipinfo 详细行以 Unix 权限字符串开头，symlink 为 'l' 开头。
 */
export function findSymlinkEntriesFromZipinfo(zipinfoOutput) {
  const symlinks = [];
  for (const line of String(zipinfoOutput).split("\n")) {
    // 权限字符串 10 字符，symlink 首字符为 'l'
    if (/^l[rwxst-]{9}\s/.test(line)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2) {
        symlinks.push(parts[parts.length - 1]);
      }
    }
  }
  return symlinks;
}

// ─── 校验（读盘但无副作用，可对真实插件根调用）─────────

/**
 * 校验必需文件/目录存在
 */
export function validateRequiredFiles(pluginRoot = PLUGIN_ROOT) {
  const issues = [];
  for (const rel of REQUIRED_PATHS) {
    if (!existsSync(join(pluginRoot, rel))) {
      issues.push(`required path missing: ${rel}`);
    }
  }
  return issues;
}

/**
 * 校验 assets/ua/viewer/manifest.json 三方一致：
 *   磁盘文件 path/size/hash ↔ manifest 条目 ↔ manifest.assetSetSha256 ↔ UPSTREAM.distSha256
 */
export function validateAssetManifest(pluginRoot = PLUGIN_ROOT) {
  const viewerDir = join(pluginRoot, "assets", "ua", "viewer");
  const manifestPath = join(viewerDir, "manifest.json");
  const issues = [];

  if (!existsSync(manifestPath)) {
    issues.push("assets/ua/viewer/manifest.json not found");
    return issues;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch (err) {
    issues.push(`cannot parse asset manifest: ${err.message}`);
    return issues;
  }

  if (!Array.isArray(manifest.files)) {
    issues.push("asset manifest has no files[] array");
    return issues;
  }

  // 逐条校验磁盘文件 path/size/hash
  for (const entry of manifest.files) {
    const filePath = join(viewerDir, entry.path);
    if (!existsSync(filePath)) {
      issues.push(`asset missing on disk: ${entry.path}`);
      continue;
    }
    const stat = statSync(filePath);
    if (stat.size !== entry.sizeBytes) {
      issues.push(
        `asset size mismatch: ${entry.path} (disk ${stat.size} vs manifest ${entry.sizeBytes})`,
      );
    }
    const hash = computeFileSha256(filePath);
    if (hash !== entry.sha256) {
      issues.push(`asset hash mismatch: ${entry.path}`);
    }
    // 禁止 TBD
    if (entry.sha256 === "TBD") {
      issues.push(`asset sha256 is TBD: ${entry.path}`);
    }
  }

  // 重算 assetSetSha256 并与 manifest 记录值比对
  const recomputed = computeAssetSetSha256(manifest.files);
  if (recomputed !== manifest.assetSetSha256) {
    issues.push(
      `assetSetSha256 mismatch: manifest says ${manifest.assetSetSha256}, recomputed ${recomputed}`,
    );
  }

  // 禁止 TBD
  if (manifest.assetSetSha256 === "TBD") {
    issues.push("manifest.assetSetSha256 is TBD");
  }

  // 三方一致：manifest.assetSetSha256 ↔ UPSTREAM.distSha256
  const upstreamPath = join(pluginRoot, "third_party", "understand-anything", "UPSTREAM.json");
  if (existsSync(upstreamPath)) {
    let upstream;
    try {
      upstream = JSON.parse(readFileSync(upstreamPath, "utf-8"));
    } catch {
      upstream = null;
    }
    if (upstream && upstream.distSha256 !== undefined) {
      if (manifest.assetSetSha256 !== upstream.distSha256) {
        issues.push(
          `three-way mismatch: manifest.assetSetSha256 (${manifest.assetSetSha256}) != UPSTREAM.distSha256 (${upstream.distSha256})`,
        );
      }
    }
  }

  return issues;
}

/**
 * 校验由锁定 Viewer asset set 派生的自包含 JS/CSS。
 */
export function validateEmbeddedViewer(pluginRoot = PLUGIN_ROOT) {
  const embeddedDir = join(pluginRoot, "assets", "ua", "embedded");
  const manifestPath = join(embeddedDir, "manifest.json");
  const sourceManifestPath = join(pluginRoot, "assets", "ua", "viewer", "manifest.json");
  const issues = [];

  let manifest;
  let sourceManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    sourceManifest = JSON.parse(readFileSync(sourceManifestPath, "utf-8"));
  } catch (err) {
    issues.push(`cannot parse embedded Viewer manifest: ${err.message}`);
    return issues;
  }

  if (manifest.source?.assetSetSha256 !== sourceManifest.assetSetSha256) {
    issues.push("embedded Viewer source asset-set hash does not match locked Viewer manifest");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== 2) {
    issues.push("embedded Viewer manifest must list viewer.js and viewer.css");
    return issues;
  }

  const expectedNames = new Set(["viewer.js", "viewer.css"]);
  for (const entry of manifest.files) {
    if (!expectedNames.delete(entry.path)) {
      issues.push(`unexpected embedded Viewer file: ${entry.path}`);
      continue;
    }
    const filePath = join(embeddedDir, entry.path);
    if (!existsSync(filePath)) {
      issues.push(`embedded Viewer file missing: ${entry.path}`);
      continue;
    }
    const size = statSync(filePath).size;
    if (size !== entry.sizeBytes) {
      issues.push(`embedded Viewer size mismatch: ${entry.path} (disk ${size} vs manifest ${entry.sizeBytes})`);
    }
    const hash = computeFileSha256(filePath);
    if (hash !== entry.sha256 || entry.sha256 === "TBD") {
      issues.push(`embedded Viewer hash mismatch: ${entry.path}`);
    }
  }
  for (const name of expectedNames) issues.push(`embedded Viewer manifest missing: ${name}`);

  return issues;
}

/**
 * 校验 UPSTREAM.json patch 字段：
 *   - human-layout.patch SHA 与 UPSTREAM 一致（active patch）
 *   - hana-plugin-adapter patch status 必须 superseded
 *   - 禁止 TBD 出现在 active patch sha256 / distSha256
 */
export function validateUpstreamPatches(pluginRoot = PLUGIN_ROOT) {
  const upstreamPath = join(pluginRoot, "third_party", "understand-anything", "UPSTREAM.json");
  const issues = [];

  if (!existsSync(upstreamPath)) {
    issues.push("UPSTREAM.json not found");
    return issues;
  }

  let upstream;
  try {
    upstream = JSON.parse(readFileSync(upstreamPath, "utf-8"));
  } catch (err) {
    issues.push(`cannot parse UPSTREAM.json: ${err.message}`);
    return issues;
  }

  const patchesDir = join(pluginRoot, "third_party", "understand-anything");

  // distSha256 禁止 TBD
  if (upstream.distSha256 === "TBD") {
    issues.push("UPSTREAM.distSha256 is TBD");
  }

  if (Array.isArray(upstream.patches)) {
    for (const patch of upstream.patches) {
      const isSuperseded = patch.status === "superseded";

      if (!isSuperseded) {
        // active patch：sha256 禁止 TBD，且必须与磁盘文件一致
        if (patch.sha256 === "TBD") {
          issues.push(`active patch ${patch.id} has TBD sha256`);
          continue;
        }
        const patchFile = join(patchesDir, patch.file);
        if (!existsSync(patchFile)) {
          issues.push(`active patch file missing: ${patch.file}`);
          continue;
        }
        const actualHash = computeFileSha256(patchFile);
        if (actualHash !== patch.sha256) {
          issues.push(
            `patch sha256 mismatch: ${patch.id} (disk ${actualHash} vs UPSTREAM ${patch.sha256})`,
          );
        }
      }
    }
  }

  // hana-plugin-adapter 必须 superseded
  const adapterPatch = (upstream.patches || []).find((p) => p.id === "hana-plugin-adapter");
  if (adapterPatch && adapterPatch.status !== "superseded") {
    issues.push(
      `hana-plugin-adapter patch status must be superseded, got "${adapterPatch.status}"`,
    );
  }

  return issues;
}

/**
 * 汇总所有打包前校验。任一失败 → 抛 PackError。
 */
export function validateForPackaging(pluginRoot = PLUGIN_ROOT) {
  const issues = [
    ...validateRequiredFiles(pluginRoot),
    ...validateAssetManifest(pluginRoot),
    ...validateEmbeddedViewer(pluginRoot),
    ...validateUpstreamPatches(pluginRoot),
  ];
  if (issues.length) {
    throw new PackError("pre-pack validation failed", issues);
  }
}

// ─── 打包（有副作用，仅 direct execution 调用）─────────

/**
 * 将 allowlisted 文件复制到 staging 目录，跳过 symlink/排除项，
 * 统一 mtime 为 epoch。返回排序后的相对路径列表。
 */
function stageFiles(pluginRoot, stagingDir, epoch) {
  const stagedFiles = [];
  const atime = new Date(epoch * 1000);
  const mtime = new Date(epoch * 1000);

  function walk(dir, rel) {
    let entries;
    try {
      entries = readdirSync(join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const relPath = rel ? `${rel}/${ent.name}` : ent.name;
      const fullPath = join(dir, relPath);
      const lst = lstatSync(fullPath);

      // 跳过 symlink（一律不打包）
      if (lst.isSymbolicLink()) continue;

      if (lst.isDirectory()) {
        // 不递归进排除目录
        if (isExcluded(relPath)) continue;
        walk(dir, relPath);
        continue;
      }

      if (!lst.isFile()) continue;

      // allowlist + 排除
      if (!isAllowlisted(relPath)) continue;
      if (isExcluded(relPath)) continue;

      // 复制到 staging
      const destPath = join(stagingDir, relPath);
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(fullPath, destPath);

      // 统一 mtime（可重现的关键）
      utimesSync(destPath, atime, mtime);

      stagedFiles.push(relPath);
    }
  }

  walk(pluginRoot, "");

  // 排序确保 zip entry 顺序确定
  stagedFiles.sort((a, b) => a.localeCompare(b));
  return stagedFiles;
}

/**
 * 使用 zip -X -@ 创建可重现 zip。
 * - -X 剥离 extra field（扩展时间戳等非确定性数据）
 * - -@ 从 stdin 读取文件名列表（已排序）
 * - 文件 mtime 已在 staging 阶段统一
 */
function createReproducibleZip(stagingDir, stagedFiles, zipPath) {
  // 移除已存在的 zip，避免 zip 追加模式
  if (existsSync(zipPath)) {
    rmSync(zipPath, { force: true });
  }

  const input = stagedFiles.join("\n") + "\n";
  try {
    execFileSync("zip", ["-X", "-@", zipPath], {
      cwd: stagingDir,
      input,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    // 清理可能的部分 zip
    if (existsSync(zipPath)) rmSync(zipPath, { force: true });
    const stderr = err.stderr ? err.stderr.toString().trim() : "";
    throw new PackError(`zip creation failed${stderr ? `: ${stderr}` : ""}`);
  }
}

/**
 * 打包后验证 zip 内容
 */
function verifyZip(zipPath) {
  // 1. entry 名列表
  let listOutput;
  try {
    listOutput = execFileSync("unzip", ["-Z1", zipPath], {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    throw new PackError(`cannot list zip entries: ${err.message}`);
  }
  const entries = listOutput
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const nameViolations = checkZipEntryNames(entries);
  if (nameViolations.length) {
    throw new PackError("zip entry verification failed", nameViolations);
  }

  // 2. symlink 检测
  let infoOutput;
  try {
    infoOutput = execFileSync("unzip", ["-Z", zipPath], {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    throw new PackError(`cannot read zipinfo: ${err.message}`);
  }
  const symlinks = findSymlinkEntriesFromZipinfo(infoOutput);
  if (symlinks.length) {
    throw new PackError(`zip contains symlink entries`, symlinks);
  }

  return { entryCount: entries.length };
}

/**
 * 写 sha256 sidecar（shasum -c 兼容格式：<hash>  <filename>）
 */
function writeSha256Sidecar(zipPath, zipName) {
  const hash = computeFileSha256(zipPath);
  const sidecarPath = `${zipPath}.sha256`;
  writeFileSync(sidecarPath, `${hash}  ${zipName}\n`);
  return hash;
}

// ─── main（仅 direct execution）────────────────────────

async function main() {
  const pluginRoot = PLUGIN_ROOT;

  console.log("Hana Code Atlas plugin packager");
  console.log(`Plugin root: ${pluginRoot}`);

  // 1. 打包前校验
  console.log("\n[1/5] Pre-pack validation...");
  validateForPackaging(pluginRoot);
  console.log("  ✓ All validations passed");

  // 2. 读取版本
  const pkg = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf-8"));
  const manifest = JSON.parse(readFileSync(join(pluginRoot, "manifest.json"), "utf-8"));
  if (pkg.version !== manifest.version) {
    throw new PackError(
      `version mismatch: package.json ${pkg.version} vs manifest.json ${manifest.version}`,
    );
  }
  const version = pkg.version;
  const zipName = `hana-code-atlas-${version}.zip`;
  const outDir = join(pluginRoot, "dist");
  const zipPath = join(outDir, zipName);

  // 3. staging + zip
  const epoch = resolveSourceDateEpoch();
  console.log(`\n[2/5] Staging files (SOURCE_DATE_EPOCH=${epoch})...`);
  const stagingDir = mkdtempSync(join(tmpdir(), "hca-pack-"));
  let stagedFiles;
  try {
    stagedFiles = stageFiles(pluginRoot, stagingDir, epoch);
    console.log(`  ✓ Staged ${stagedFiles.length} files`);

    console.log("\n[3/5] Creating reproducible zip...");
    mkdirSync(outDir, { recursive: true });
    createReproducibleZip(stagingDir, stagedFiles, zipPath);
    const sizeBytes = statSync(zipPath).size;
    console.log(`  ✓ Created dist/${zipName} (${sizeBytes} bytes)`);
  } finally {
    // 无论成功失败都清理临时 staging
    rmSync(stagingDir, { recursive: true, force: true });
  }

  // 4. 打包后验证
  console.log("\n[4/5] Verifying zip...");
  const { entryCount } = verifyZip(zipPath);
  console.log(`  ✓ ${entryCount} entries: no symlink/traversal/excluded, manifest.json at root`);

  // 5. sha256 sidecar
  console.log("\n[5/5] Writing sha256 sidecar...");
  const sha256 = writeSha256Sidecar(zipPath, zipName);
  console.log(`  ✓ dist/${zipName}.sha256`);
  console.log(`  SHA-256: ${sha256}`);

  console.log("\nDone.");
  console.log(`  Zip:  dist/${zipName}`);
  console.log(`  Hash: dist/${zipName}.sha256`);
  console.log(`  Size: ${statSync(zipPath).size} bytes`);
  console.log(`  Entries: ${entryCount}`);
}

// ─── direct execution guard ────────────────────────────

const _isMain =
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (_isMain) {
  main().catch((err) => {
    console.error(err.message || String(err));
    process.exit(1);
  });
}
