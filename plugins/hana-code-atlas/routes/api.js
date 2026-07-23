/**
 * routes/api.js — Project, status, graph and source-preview APIs
 *
 * All APIs use projectId (validated /^[0-9a-f]{16}$/), not absolute roots.
 * Bundle enum: full | architecture (allowlisted).
 * UA data files: allowlisted set.
 */

import { listProjects, resolveProject, isValidProjectId } from "../lib/projects.js";
import { listCbmProjects, resolveCbmRuntime } from "../lib/cbm-registry-v1.js";
import { validateBundle } from "../lib/core.js";
import { getActiveTaskForProject } from "../lib/build-manager.js";
import {
  currentBundleDir, readUaDataFile, readSourcePreviewFile,
  readCurrentPointer, ALLOWED_BUNDLE_NAMES,
} from "../lib/storage.js";

export default function registerApiRoutes(app, ctx) {
  // ── Project list ────────────────────────────────────────
  app.get("/api/projects", async (c) => {
    const projects = await listProjects(ctx.dataDir);
    const enriched = await Promise.all(projects.map(async (p) => {
      const current = await readCurrentPointer(ctx.dataDir, p.projectId);
      let hasArchitecture = false;
      let hasFull = false;
      if (current) {
        const archDir = await currentBundleDir(ctx.dataDir, p.projectId, "architecture");
        const fullDir = await currentBundleDir(ctx.dataDir, p.projectId, "full");
        if (archDir) hasArchitecture = (await validateBundle(archDir).catch(() => ({ ok: false }))).ok;
        if (fullDir) hasFull = (await validateBundle(fullDir).catch(() => ({ ok: false }))).ok;
      }
      return {
        projectId: p.projectId,
        name: p.name,
        root: p.root,
        cbmProjectName: p.cbmProjectName || null,
        hasOverlay: !!p.hasOverlay,
        overlaySha256: p.overlaySha256 || null,
        overlayAdoptedAt: p.overlayAdoptedAt || null,
        hasArchitecture,
        hasFull,
        lastBuiltAt: p.lastBuiltAt || null,
        currentBuildId: current ? current.buildId : null,
      };
    }));
    return c.json({ projects: enriched });
  });

  // ── Indexed project candidates ─────────────────────────
  app.get("/api/project-candidates", async (c) => {
    const runtime = await resolveCbmRuntime(ctx);
    const registry = {
      source: runtime.source,
      binarySource: runtime.binarySource,
      cacheDir: runtime.cacheDir || null,
    };
    if (!runtime.ok) {
      return c.json({ ok: false, error: runtime.error, candidates: [], registry }, 503);
    }

    const result = await listCbmProjects(runtime.binary, 15000, runtime.cacheDir || undefined);
    if (!result.ok) {
      return c.json({ ok: false, error: result.error, candidates: [], registry }, 503);
    }

    const candidates = result.projects.slice(0, 500);
    return c.json({
      ok: true,
      candidates,
      registry: {
        ...registry,
        candidateCount: result.projects.length,
        truncated: result.projects.length > candidates.length,
        durationMs: result.durationMs,
      },
    });
  });

  // ── Register project ────────────────────────────────────
  app.post("/api/projects", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const projectRoot = String(body.projectRoot || "").trim();
    if (!projectRoot) return c.json({ error: "projectRoot_required" }, 400);

    const { registerProject } = await import("../lib/projects.js");
    const runtime = await resolveCbmRuntime(ctx);
    if (!runtime.ok) return c.json({ error: runtime.error }, 503);
    const result = await registerProject({
      dataDir: ctx.dataDir,
      projectRoot,
      cbmBinary: runtime.binary,
      cbmCacheDir: runtime.cacheDir || undefined,
    });
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({ ok: true, projectId: result.projectId, created: result.created, project: result.meta }, result.created ? 201 : 200);
  });

  // ── Delete project ──────────────────────────────────────
  app.delete("/api/projects/:projectId", async (c) => {
    const projectId = c.req.param("projectId");
    if (!isValidProjectId(projectId)) return c.json({ error: "invalid_projectId" }, 400);
    const activeTask = getActiveTaskForProject(projectId);
    if (activeTask) {
      return c.json({ error: "project_build_active", taskId: activeTask.taskId, status: activeTask.status }, 409);
    }
    const { unregisterProject } = await import("../lib/projects.js");
    const result = await unregisterProject(ctx.dataDir, projectId);
    if (!result.ok) return c.json({ error: result.error }, result.error === "project_not_found" ? 404 : 500);
    return c.json({ ok: true });
  });

  // ── Project status with bundle validation ───────────────
  app.get("/api/status", async (c) => {
    const projectId = c.req.query("projectId") || "";
    const bundle = c.req.query("bundle") || "full";
    if (!projectId) return c.json({ error: "projectId_required" }, 400);
    if (!isValidProjectId(projectId)) return c.json({ error: "invalid_projectId" }, 400);
    if (!ALLOWED_BUNDLE_NAMES.has(bundle)) return c.json({ error: "invalid_bundle" }, 400);

    const meta = await resolveProject(ctx.dataDir, projectId);
    if (!meta) return c.json({ error: "project_not_found" }, 404);

    const current = await readCurrentPointer(ctx.dataDir, projectId);
    let hasArchitecture = false;
    let hasFull = false;
    let hasBundle = false;
    if (current) {
      const archDir = await currentBundleDir(ctx.dataDir, projectId, "architecture");
      const fullDir = await currentBundleDir(ctx.dataDir, projectId, "full");
      if (archDir) hasArchitecture = (await validateBundle(archDir).catch(() => ({ ok: false }))).ok;
      if (fullDir) hasFull = (await validateBundle(fullDir).catch(() => ({ ok: false }))).ok;
      hasBundle = bundle === "architecture" ? hasArchitecture : hasFull;
    }

    return c.json({
      ok: true,
      projectId,
      bundle,
      hasBundle,
      hasArchitecture,
      hasFull,
      project: meta,
      currentBuildId: current ? current.buildId : null,
      previousBuildId: current ? current.previousBuildId : null,
    });
  });

  // ── UA data endpoint ────────────────────────────────────
  app.get("/api/ua/:fileName", async (c) => {
    const fileName = c.req.param("fileName");
    const projectId = c.req.query("projectId") || "";
    const bundle = c.req.query("bundle") || "full";
    if (!projectId) return c.json({ error: "projectId_required" }, 400);

    const result = await readUaDataFile(ctx.dataDir, projectId, bundle, fileName);
    if (!result.ok) return c.json({ error: result.error }, result.status || 500);
    try {
      return c.json(JSON.parse(result.content));
    } catch {
      return c.text(result.content);
    }
  });

  // ── Source preview ──────────────────────────────────────
  app.get("/api/source", async (c) => {
    const projectId = c.req.query("projectId") || "";
    const bundle = c.req.query("bundle") || "full";
    const filePath = c.req.query("path") || "";
    if (!projectId || !filePath) return c.json({ error: "projectId_and_path_required" }, 400);

    const result = await readSourcePreviewFile(ctx.dataDir, projectId, bundle, filePath);
    if (!result.ok) return c.json({ error: result.error }, result.status || 500);

    return c.json({
      path: filePath,
      content: result.content,
      sizeBytes: result.sizeBytes,
      lineCount: result.lineCount,
    });
  });
}
