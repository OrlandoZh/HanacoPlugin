/**
 * lib/storage.js — Immutable builds, atomic current.json pointer, retention
 *
 * Promotion merges pipeline-written build-meta.json with promotion fields.
 * After success, updates project.json lastBuiltAt and currentBuildId.
 */

import fsp from "node:fs/promises";
import path from "node:path";
import { validateBundle, isPathInside, ensureInsideDir } from "./core.js";
import { projectDir, projectJsonPath, isValidProjectId } from "./projects.js";

// ─── Constants ────────────────────────────────────────────

export const ALLOWED_BUNDLE_NAMES = new Set(["full", "architecture"]);

export const UA_DATA_FILES = new Set([
  "knowledge-graph.json",
  "domain-graph.json",
  "diff-overlay.json",
  "meta.json",
  "config.json",
  "semantic-meta.json",
  "overview-meta.json",
  "source-preview-meta.json",
]);

const MAX_SOURCE_FILE_BYTES = 1024 * 1024;

// ─── Build directory helpers ──────────────────────────────

export function buildsDir(dataDir, projectId) {
  if (!isValidProjectId(projectId)) return null;
  const dir = projectDir(dataDir, projectId);
  return dir ? path.join(dir, "builds") : null;
}

export function buildDir(dataDir, projectId, buildId) {
  const bDir = buildsDir(dataDir, projectId);
  return bDir ? path.join(bDir, buildId) : null;
}

export function currentJsonPath(dataDir, projectId) {
  if (!isValidProjectId(projectId)) return null;
  const dir = projectDir(dataDir, projectId);
  return dir ? path.join(dir, "current.json") : null;
}

export async function currentBundleDir(dataDir, projectId, bundle) {
  if (!isValidProjectId(projectId)) return null;
  if (!ALLOWED_BUNDLE_NAMES.has(bundle)) return null;
  const current = await readCurrentPointer(dataDir, projectId);
  if (!current) return null;
  const bDir = buildDir(dataDir, projectId, current.buildId);
  return bDir ? path.join(bDir, bundle) : null;
}

// ─── Current pointer ──────────────────────────────────────

export async function readCurrentPointer(dataDir, projectId) {
  const cp = currentJsonPath(dataDir, projectId);
  if (!cp) return null;
  try {
    const content = await fsp.readFile(cp, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function writeCurrentPointer(dataDir, projectId, pointer) {
  const targetPath = currentJsonPath(dataDir, projectId);
  if (!targetPath) return;
  const tmpPath = targetPath + ".tmp";
  await fsp.writeFile(tmpPath, JSON.stringify(pointer, null, 2));
  await fsp.rename(tmpPath, targetPath);
}

// ─── Staging validation ───────────────────────────────────

export async function validateStaging(stagingRoot) {
  const errors = [];

  const fullDir = path.join(stagingRoot, "full");
  const fullValid = await validateBundle(fullDir);
  if (!fullValid.ok) {
    errors.push(...fullValid.errors.map((e) => "full/" + e));
  }

  // source-preview-meta.json files array
  const fullMetaPath = path.join(fullDir, ".ua", "source-preview-meta.json");
  try {
    const content = await fsp.readFile(fullMetaPath, "utf-8");
    const meta = JSON.parse(content);
    if (!Array.isArray(meta.files)) {
      errors.push("full/.ua/source-preview-meta.json: missing files array");
    }
  } catch (err) {
    if (err.code !== "ENOENT") {
      errors.push("full/.ua/source-preview-meta.json: " + err.message);
    }
  }

  const archDir = path.join(stagingRoot, "architecture");
  let hasArchitecture = false;
  try {
    const stat = await fsp.stat(archDir);
    if (stat.isDirectory()) {
      hasArchitecture = true;
      const archValid = await validateBundle(archDir);
      if (!archValid.ok) {
        errors.push(...archValid.errors.map((e) => "architecture/" + e));
      }
      const archMetaPath = path.join(archDir, ".ua", "source-preview-meta.json");
      try {
        const content = await fsp.readFile(archMetaPath, "utf-8");
        const meta = JSON.parse(content);
        if (!Array.isArray(meta.files)) {
          errors.push("architecture/.ua/source-preview-meta.json: missing files array");
        }
      } catch (err2) {
        if (err2.code !== "ENOENT") {
          errors.push("architecture/.ua/source-preview-meta.json: " + err2.message);
        }
      }
    }
  } catch { /* no architecture bundle */ }

  if (errors.length > 0) {
    return { ok: false, errors, hasArchitecture };
  }
  return { ok: true, errors: [], hasArchitecture };
}

// ─── Promotion with build-meta merge + project.json update ─

export async function promoteBuild(dataDir, projectId, buildId, stagingRoot) {
  if (!isValidProjectId(projectId)) {
    return { ok: false, error: "invalid_projectId" };
  }

  const validation = await validateStaging(stagingRoot);
  if (!validation.ok) {
    return { ok: false, error: "staging_validation_failed: " + validation.errors.join("; ") };
  }

  const bDir = buildDir(dataDir, projectId, buildId);
  if (!bDir) return { ok: false, error: "invalid_projectId" };

  const buildsD = buildsDir(dataDir, projectId);
  await fsp.mkdir(buildsD, { recursive: true });

  // Rename staging → immutable build
  try {
    await fsp.rename(stagingRoot, bDir);
  } catch {
    try {
      await fsp.cp(stagingRoot, bDir, { recursive: true });
      await fsp.rm(stagingRoot, { recursive: true, force: true });
    } catch (copyErr) {
      return { ok: false, error: "promote_rename_failed: " + copyErr.message };
    }
  }

  // Merge build-meta.json: read pipeline-written, add promotion fields
  let buildMeta = {};
  try {
    const existing = await fsp.readFile(path.join(bDir, "build-meta.json"), "utf-8");
    buildMeta = JSON.parse(existing);
  } catch { /* no pipeline-written meta; start fresh */ }

  // Add/overwrite promotion fields
  Object.assign(buildMeta, {
    buildId,
    projectId,
    hasArchitecture: validation.hasArchitecture,
    promotedAt: new Date().toISOString(),
  });

  // Read overlay hash from semantic-meta if present
  try {
    const fullMeta = JSON.parse(
      await fsp.readFile(path.join(bDir, "full", ".ua", "semantic-meta.json"), "utf-8")
    );
    if (fullMeta.overlaySha256) buildMeta.overlaySha256 = fullMeta.overlaySha256;
  } catch { /* ok */ }

  await fsp.writeFile(path.join(bDir, "build-meta.json"), JSON.stringify(buildMeta, null, 2));

  // Read current pointer for previousBuildId
  const current = await readCurrentPointer(dataDir, projectId);
  const previousBuildId = current ? current.buildId : null;

  // Write current.json atomically
  const pointer = {
    buildId,
    previousBuildId,
    promotedAt: new Date().toISOString(),
  };
  await writeCurrentPointer(dataDir, projectId, pointer);

  // Retain current + previous, delete older
  await retainBuilds(dataDir, projectId, buildId, previousBuildId);

  // Update project.json lastBuiltAt + currentBuildId
  const pjPath = projectJsonPath(dataDir, projectId);
  if (pjPath) {
    try {
      const pjContent = await fsp.readFile(pjPath, "utf-8");
      const pjMeta = JSON.parse(pjContent);
      pjMeta.lastBuiltAt = new Date().toISOString();
      pjMeta.currentBuildId = buildId;
      await fsp.writeFile(pjPath, JSON.stringify(pjMeta, null, 2));
    } catch { /* best effort */ }
  }

  return { ok: true, buildId };
}

async function retainBuilds(dataDir, projectId, currentBuildId, previousBuildId) {
  const retain = new Set([currentBuildId, previousBuildId].filter(Boolean));
  const bDir = buildsDir(dataDir, projectId);
  if (!bDir) return;
  let entries;
  try {
    entries = await fsp.readdir(bDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (retain.has(entry.name)) continue;
    try {
      await fsp.rm(path.join(bDir, entry.name), { recursive: true, force: true });
    } catch { /* best effort */ }
  }
}

// ─── Source preview reads ─────────────────────────────────

export async function readSourcePreviewFile(dataDir, projectId, bundle, relativePath) {
  if (!isValidProjectId(projectId)) return { ok: false, error: "invalid_projectId", status: 400 };
  if (!ALLOWED_BUNDLE_NAMES.has(bundle)) return { ok: false, error: "invalid_bundle", status: 400 };
  if (!relativePath || relativePath.includes("\0")) return { ok: false, error: "invalid_path", status: 400 };
  if (!isPathInside(relativePath, "")) return { ok: false, error: "path_escape", status: 400 };

  const bundDir = await currentBundleDir(dataDir, projectId, bundle);
  if (!bundDir) return { ok: false, error: "no_current_build", status: 404 };

  const previewDir = path.join(bundDir, "source-preview");

  let registeredPaths = new Set();
  try {
    const metaContent = await fsp.readFile(
      path.join(bundDir, ".ua", "source-preview-meta.json"), "utf-8"
    );
    const meta = JSON.parse(metaContent);
    if (Array.isArray(meta.files)) {
      for (const f of meta.files) {
        registeredPaths.add(f.relativePath || f.path || f);
      }
    }
  } catch { /* no meta */ }

  if (!isPathInside(relativePath, previewDir)) {
    return { ok: false, error: "path_escape", status: 400 };
  }
  if (!registeredPaths.has(relativePath)) {
    return { ok: false, error: "not_in_graph", status: 404 };
  }

  const absolutePath = path.resolve(previewDir, relativePath);
  const inside = await ensureInsideDir(absolutePath, previewDir);
  if (!inside.ok) return { ok: false, error: inside.error, status: 403 };

  let stat;
  try { stat = await fsp.stat(absolutePath); } catch {
    return { ok: false, error: "file_not_found", status: 404 };
  }
  if (!stat.isFile()) return { ok: false, error: "not_a_file", status: 400 };
  if (stat.size > MAX_SOURCE_FILE_BYTES) return { ok: false, error: "file_too_large", status: 413 };

  const buffer = await fsp.readFile(absolutePath);
  if (buffer.includes(0)) return { ok: false, error: "binary_file", status: 415 };

  return {
    ok: true,
    content: buffer.toString("utf-8"),
    sizeBytes: buffer.byteLength,
    lineCount: buffer.toString("utf-8").split(/\r\n|\n|\r/).length,
  };
}

// ─── UA data file reads ───────────────────────────────────

export async function readUaDataFile(dataDir, projectId, bundle, fileName) {
  if (!isValidProjectId(projectId)) return { ok: false, error: "invalid_projectId", status: 400 };
  if (!ALLOWED_BUNDLE_NAMES.has(bundle)) return { ok: false, error: "invalid_bundle", status: 400 };
  if (!UA_DATA_FILES.has(fileName)) return { ok: false, error: "unknown_data_file", status: 400 };

  const bundDir = await currentBundleDir(dataDir, projectId, bundle);
  if (!bundDir) return { ok: false, error: "no_current_build", status: 404 };

  const filePath = path.join(bundDir, ".ua", fileName);
  const inside = await ensureInsideDir(filePath, bundDir);
  if (!inside.ok) return { ok: false, error: inside.error, status: 403 };
  try {
    const content = await fsp.readFile(filePath, "utf-8");
    return { ok: true, content };
  } catch (err) {
    if (err.code === "ENOENT") return { ok: false, error: "not_found", status: 404 };
    return { ok: false, error: err.message, status: 500 };
  }
}
