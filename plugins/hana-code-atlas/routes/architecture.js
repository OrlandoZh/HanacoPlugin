import { getActiveTaskForProject } from "../lib/build-manager.js";
import {
  adoptArchitectureDraft,
  readArchitectureState,
} from "../lib/architecture-overlay.js";
import {
  cancelArchitectureGeneration,
  getActiveArchitectureTask,
  getArchitectureTask,
  listArchitectureProviders,
  pruneArchitectureTasks,
  startArchitectureGeneration,
  startArchitectureReview,
} from "../lib/architecture-generator-v2.js";
import { isValidProjectId, resolveProject } from "../lib/projects.js";

export default function registerArchitectureRoutes(app, ctx) {
  app.get("/api/architecture/providers", async (c) => {
    const result = await listArchitectureProviders(ctx);
    return c.json(result, result.ok ? 200 : 503);
  });

  app.get("/api/architecture", async (c) => {
    const projectId = c.req.query("projectId") || "";
    if (!isValidProjectId(projectId)) return c.json({ error: "invalid_projectId" }, 400);
    const state = await readArchitectureState(ctx.dataDir, projectId);
    if (!state.ok) return c.json({ error: state.error }, state.error === "project_not_found" ? 404 : 400);
    return c.json({
      ...state,
      activeTask: getActiveArchitectureTask(projectId),
    });
  });

  app.post("/api/architecture/generate", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const projectId = String(body.projectId || "").trim();
    if (!isValidProjectId(projectId)) return c.json({ error: "invalid_projectId" }, 400);
    const project = await resolveProject(ctx.dataDir, projectId);
    if (!project) return c.json({ error: "project_not_found" }, 404);
    const result = startArchitectureGeneration(ctx, {
      projectId,
      providerId: String(body.providerId || "").trim() || undefined,
      model: String(body.model || "").trim() || undefined,
      reviewerProviderId: String(body.reviewerProviderId || "").trim() || undefined,
      reviewerModel: String(body.reviewerModel || "").trim() || undefined,
    });
    if (!result.ok) {
      const status = result.error === "project_build_active" || result.error === "architecture_generation_active" ? 409
        : result.error === "architecture_generation_limit" ? 429 : 400;
      return c.json({ error: result.error, taskId: result.taskId || null }, status);
    }
    return c.json(result, 202);
  });

  app.post("/api/architecture/review", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const projectId = String(body.projectId || "").trim();
    if (!isValidProjectId(projectId)) return c.json({ error: "invalid_projectId" }, 400);
    const project = await resolveProject(ctx.dataDir, projectId);
    if (!project) return c.json({ error: "project_not_found" }, 404);
    const result = startArchitectureReview(ctx, {
      projectId,
      reviewerProviderId: String(body.reviewerProviderId || "").trim() || undefined,
      reviewerModel: String(body.reviewerModel || "").trim() || undefined,
    });
    if (!result.ok) {
      const status = result.error === "project_build_active" || result.error === "architecture_generation_active" ? 409
        : result.error === "architecture_generation_limit" ? 429 : 400;
      return c.json({ error: result.error, taskId: result.taskId || null }, status);
    }
    return c.json(result, 202);
  });

  app.get("/api/architecture/tasks/:taskId", (c) => {
    pruneArchitectureTasks();
    const task = getArchitectureTask(c.req.param("taskId"));
    if (!task) return c.json({ error: "task_not_found" }, 404);
    const projectId = c.req.query("projectId") || "";
    if (!isValidProjectId(projectId)) return c.json({ error: "invalid_projectId" }, 400);
    if (task.projectId !== projectId) return c.json({ error: "task_project_mismatch" }, 403);
    return c.json(task);
  });

  app.post("/api/architecture/tasks/:taskId/cancel", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const task = getArchitectureTask(c.req.param("taskId"));
    if (!task) return c.json({ error: "task_not_found" }, 404);
    const projectId = String(body.projectId || "").trim();
    if (!isValidProjectId(projectId)) return c.json({ error: "invalid_projectId" }, 400);
    if (task.projectId !== projectId) return c.json({ error: "task_project_mismatch" }, 403);
    const result = cancelArchitectureGeneration(c.req.param("taskId"));
    if (!result.ok) return c.json({ error: result.error }, 409);
    return c.json(result);
  });

  app.post("/api/architecture/adopt", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const projectId = String(body.projectId || "").trim();
    const expectedSha256 = String(body.expectedSha256 || "").trim();
    const expectedReviewSha256 = String(body.expectedReviewSha256 || "").trim();
    if (!isValidProjectId(projectId)) return c.json({ error: "invalid_projectId" }, 400);
    if (getActiveTaskForProject(projectId)) return c.json({ error: "project_build_active" }, 409);
    if (getActiveArchitectureTask(projectId)) return c.json({ error: "architecture_generation_active" }, 409);
    const result = await adoptArchitectureDraft(ctx.dataDir, projectId, expectedSha256, expectedReviewSha256);
    if (!result.ok) {
      const status = result.error === "project_not_found" || result.error === "overlay_draft_not_found" ? 404
        : result.error === "overlay_draft_changed" || result.error === "architecture_review_changed" ? 409 : 422;
      return c.json({ error: result.error, validation: result.validation || null }, status);
    }
    return c.json(result);
  });
}
