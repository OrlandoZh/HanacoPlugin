/**
 * lib/projects.js — Unified project registry
 *
 * projectId  = SHA-256 prefix (16 hex chars) of the project realpath.
 * HTTP registration does NOT check an old allowlist — any valid directory can register.
 * cbm project name is discovered from `cbm cli list_projects` matching root_path.
 * Both HTTP and Agent tool call the same registerProject function.
 *
 * Security:
 *   - isAbsolute checked BEFORE resolve (relative paths rejected)
 *   - projectId validated /^[0-9a-f]{16}$/ at all entry points
 *   - projectDir prevents path traversal via projectId
 */

import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { discoverCbmProject } from "./cbm-registry-v1.js";

export {
  parseCbmProjectsOutput,
  listCbmProjects,
  discoverCbmProject,
} from "./cbm-registry-v1.js";

// ─── projectId validation ─────────────────────────────────

const PROJECT_ID_RE = /^[0-9a-f]{16}$/;

/**
 * Validate a projectId string.
 * Must be exactly 16 lowercase hex characters.
 */
export function isValidProjectId(id) {
  return typeof id === "string" && PROJECT_ID_RE.test(id);
}

/**
 * Generate a stable projectId from a realpath.
 * Returns the first 16 hex characters of SHA-256(realpath).
 */
export function computeProjectId(realpath) {
  return crypto.createHash("sha256").update(realpath).digest("hex").slice(0, 16);
}

// ─── Project data directory ───────────────────────────────

/**
 * Get the project data directory under dataDir.
 * projectId must be validated before calling.
 * Layout: dataDir/projects/<projectId>/
 */
export function projectDir(dataDir, projectId) {
  // projectId is already validated at entry points, but guard against misuse
  if (!isValidProjectId(projectId)) return null;
  return path.join(dataDir, "projects", projectId);
}

/**
 * Path to project.json for a given projectId.
 */
export function projectJsonPath(dataDir, projectId) {
  const dir = projectDir(dataDir, projectId);
  return dir ? path.join(dir, "project.json") : null;
}

/**
 * Path to project overlay.json (trusted plugin data copy).
 */
export function projectOverlayPath(dataDir, projectId) {
  const dir = projectDir(dataDir, projectId);
  return dir ? path.join(dir, "overlay.json") : null;
}

// ─── Read / resolve project ───────────────────────────────

/**
 * Read project.json for a projectId.
 * Returns null if not found or projectId is invalid.
 */
export async function readProject(dataDir, projectId) {
  if (!isValidProjectId(projectId)) return null;
  const pjPath = projectJsonPath(dataDir, projectId);
  if (!pjPath) return null;
  try {
    const content = await fsp.readFile(pjPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Resolve projectId to project metadata (including realpath).
 * Returns null if projectId is not registered or directory gone.
 */
export async function resolveProject(dataDir, projectId) {
  const meta = await readProject(dataDir, projectId);
  if (!meta) return null;
  try {
    const currentReal = await fsp.realpath(meta.root);
    if (currentReal !== meta.root) return null; // symlink drift
  } catch {
    return null; // directory gone
  }
  return meta;
}

/**
 * List all registered projects.
 * Returns array of { projectId, root, name, cbmProjectName, hasOverlay, ... }.
 */
export async function listProjects(dataDir) {
  const projectsDir = path.join(dataDir, "projects");
  let entries;
  try {
    entries = await fsp.readdir(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!isValidProjectId(entry.name)) continue; // skip invalid dir names
    const meta = await readProject(dataDir, entry.name);
    if (meta) {
      results.push({ projectId: entry.name, ...meta });
    }
  }
  return results;
}

// ─── Unified registerProject ──────────────────────────────

/**
 * Register a project by its root path.
 * This is the single registration function used by both HTTP and Agent tool.
 *
 * Security: isAbsolute checked BEFORE resolve — relative paths rejected.
 */
export async function registerProject(opts) {
  const { dataDir, projectRoot, cbmBinary, overlayPath, cbmCacheDir } = opts;

  // 1. Validate input — isAbsolute FIRST, before resolve
  if (!projectRoot || typeof projectRoot !== "string") {
    return { ok: false, error: "projectRoot_required" };
  }
  // MUST be absolute BEFORE resolve (resolve would make relative paths absolute)
  if (!path.isAbsolute(projectRoot)) {
    return { ok: false, error: "projectRoot_must_be_absolute" };
  }

  // 2. Realpath (resolve symlinks)
  let realResolved;
  try {
    realResolved = await fsp.realpath(projectRoot);
  } catch {
    return { ok: false, error: "projectRoot_not_found" };
  }

  // 3. Must be a directory
  try {
    const stat = await fsp.stat(realResolved);
    if (!stat.isDirectory()) {
      return { ok: false, error: "projectRoot_not_a_directory" };
    }
  } catch {
    return { ok: false, error: "projectRoot_not_accessible" };
  }

  // 4. Compute projectId
  const projectId = computeProjectId(realResolved);

  // 5. Check if already registered (idempotent) or collision
  const existing = await readProject(dataDir, projectId);
  if (existing) {
    if (existing.root === realResolved) {
      // Same path — idempotent refresh. Always re-discover so a changed
      // CBM_CACHE_DIR cannot leave a stale project name behind.
      let updated = false;
      if (cbmBinary) {
        const cbmResult = await discoverCbmProject(cbmBinary, realResolved, 15000, cbmCacheDir || undefined);
        if (cbmResult.ok && existing.cbmProjectName !== cbmResult.cbmProjectName) {
          existing.cbmProjectName = cbmResult.cbmProjectName;
          updated = true;
        }
      }
      const usesConfiguredCbmCache = !!cbmCacheDir;
      if (existing.usesConfiguredCbmCache !== usesConfiguredCbmCache) {
        existing.usesConfiguredCbmCache = usesConfiguredCbmCache;
        updated = true;
      }
      const sourceOverlayPath = overlayPath || path.join(realResolved, ".ua", "overlay.json");
      try {
        const overlayReal = await fsp.realpath(sourceOverlayPath);
        if (overlayReal.startsWith(realResolved + path.sep)) {
          const content = await fsp.readFile(overlayReal, "utf-8");
          JSON.parse(content);
          await fsp.writeFile(projectOverlayPath(dataDir, projectId), content);
          if (!existing.hasOverlay) {
            existing.hasOverlay = true;
            updated = true;
          }
        }
      } catch { /* no new project overlay */ }
      if (updated) {
        const pjPath = projectJsonPath(dataDir, projectId);
        await fsp.writeFile(pjPath, JSON.stringify(existing, null, 2));
      }
      return { ok: true, projectId, created: false, meta: existing };
    } else {
      // SHA-256 prefix collision: different realpath, same projectId
      return { ok: false, error: "project_id_collision", projectId, existingRoot: existing.root, newRoot: realResolved };
    }
  }

  // 6. Discover cbm project name
  let cbmProjectName = null;
  if (cbmBinary) {
    const cbmResult = await discoverCbmProject(cbmBinary, realResolved, 15000, cbmCacheDir || undefined);
    if (cbmResult.ok) {
      cbmProjectName = cbmResult.cbmProjectName;
    }
  }

  // 7. Handle overlay — failure must leave hasOverlay=false
  let hasOverlay = false;
  let finalOverlayPath = null;
  if (overlayPath) {
    try {
      const overlayReal = await fsp.realpath(overlayPath);
      if (overlayReal.startsWith(realResolved + path.sep) || overlayReal === realResolved) {
        finalOverlayPath = overlayReal;
        hasOverlay = true;
      }
    } catch { /* overlay not found */ }
  }

  if (!hasOverlay) {
    const projectOverlay = path.join(realResolved, ".ua", "overlay.json");
    try {
      const overlayReal = await fsp.realpath(projectOverlay);
      if (overlayReal.startsWith(realResolved + path.sep)) {
        finalOverlayPath = overlayReal;
        hasOverlay = true;
      }
    } catch { /* no project overlay */ }

    if (!hasOverlay) {
      const profileDir = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "..", "pipeline", "profiles"
      );
      const basename = path.basename(realResolved);
      for (const candidate of [basename + ".zh.json", basename + ".json"]) {
        try {
          const profilePath = path.join(profileDir, candidate);
          await fsp.access(profilePath);
          finalOverlayPath = profilePath;
          hasOverlay = true;
          break;
        } catch { /* next */ }
      }
    }
  }

  // 8. Create project directory and write metadata
  const pDir = projectDir(dataDir, projectId);
  await fsp.mkdir(pDir, { recursive: true });

  // Copy overlay into trusted plugin data — failure resets hasOverlay to false
  if (hasOverlay && finalOverlayPath) {
    try {
      const content = await fsp.readFile(finalOverlayPath, "utf-8");
      JSON.parse(content); // validate JSON
      await fsp.writeFile(projectOverlayPath(dataDir, projectId), content);
    } catch {
      // Copy or validation failed — must NOT claim overlay exists
      hasOverlay = false;
      finalOverlayPath = null;
    }
  }

  const meta = {
    projectId,
    root: realResolved,
    name: path.basename(realResolved),
    cbmProjectName,
    hasOverlay,
    addedAt: new Date().toISOString(),
    lastBuiltAt: null,
    currentBuildId: null,
    usesConfiguredCbmCache: !!cbmCacheDir,
  };

  const pjPath = projectJsonPath(dataDir, projectId);
  await fsp.writeFile(pjPath, JSON.stringify(meta, null, 2));

  return { ok: true, projectId, created: true, meta };
}

/**
 * Remove a project from the registry.
 * Only deletes plugin data, not source files.
 * projectId is strictly validated to prevent path traversal.
 */
export async function unregisterProject(dataDir, projectId) {
  if (!isValidProjectId(projectId)) {
    return { ok: false, error: "invalid_projectId" };
  }
  const pDir = projectDir(dataDir, projectId);
  if (!pDir) return { ok: false, error: "invalid_projectId" };
  // Verify the directory actually is a project directory (contains project.json)
  const pjPath = projectJsonPath(dataDir, projectId);
  if (!pjPath) return { ok: false, error: "invalid_projectId" };
  try {
    await fsp.access(pjPath);
  } catch {
    return { ok: false, error: "project_not_found" };
  }
  try {
    await fsp.rm(pDir, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
