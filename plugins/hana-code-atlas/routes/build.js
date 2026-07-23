/**
 * routes/build.js — Build start, task status, cancel APIs
 */

import { isValidProjectId } from "../lib/projects.js";
import { startBuild, getTaskDetail, cancelTask as cancelBuildTask, listTasks, pruneTasks } from "../lib/build-manager.js";
import { resolveCbmRuntime } from "../lib/cbm-registry-v1.js";
import { readConfig } from "../lib/core.js";

export default function registerBuildRoutes(app, ctx) {
  app.post("/api/build", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const projectId = String(body.projectId || "").trim();
    if (!projectId) return c.json({ error: "projectId_required" }, 400);
    if (!isValidProjectId(projectId)) return c.json({ error: "invalid_projectId" }, 400);

    const { resolveProject } = await import("../lib/projects.js");
    const meta = await resolveProject(ctx.dataDir, projectId);
    if (!meta) return c.json({ error: "project_not_found" }, 404);

    if (!meta.cbmProjectName) {
      return c.json({ error: "cbm_project_not_found", hint: "Register project with a matching cbm index first" }, 400);
    }

    const cbmRuntime = await resolveCbmRuntime(ctx);
    if (!cbmRuntime.ok) return c.json({ error: cbmRuntime.error }, 503);
    const pythonBinary = await readConfig(ctx, "pythonBinary", "python3");
    const pipelineTimeoutSeconds = await readConfig(ctx, "pipelineTimeoutSeconds", 300);
    const cbmTimeoutSeconds = await readConfig(ctx, "cbmTimeoutSeconds", 120);
    const maxConcurrent = await readConfig(ctx, "maxConcurrentBuilds", 1);

    const result = startBuild({
      dataDir: ctx.dataDir, projectId, pythonBinary, cbmBinary: cbmRuntime.binary,
      pipelineTimeoutSeconds, cbmTimeoutSeconds, maxConcurrent,
      pluginDir: ctx.pluginDir, cbmCacheDir: cbmRuntime.cacheDir || undefined,
    });

    if (!result.ok) return c.json({ error: result.error, taskId: result.taskId || null }, 409);
    return c.json({ ok: true, taskId: result.taskId, buildId: result.buildId }, 202);
  });

  app.get("/api/tasks/:taskId", (c) => {
    const detail = getTaskDetail(c.req.param("taskId"));
    if (!detail) return c.json({ error: "task_not_found" }, 404);
    return c.json(detail);
  });

  app.post("/api/tasks/:taskId/cancel", (c) => {
    const result = cancelBuildTask(c.req.param("taskId"));
    if (!result.ok) {
      const status = result.error === "task_not_found" ? 404 : 409;
      return c.json({ error: result.error }, status);
    }
    return c.json({ ok: true });
  });

  app.get("/api/tasks", (c) => {
    pruneTasks();
    return c.json({ tasks: listTasks() });
  });
}
