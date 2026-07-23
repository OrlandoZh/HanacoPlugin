import { registerProject, unregisterProject, isValidProjectId } from "../lib/projects.js";
import { resolveCbmRuntime } from "../lib/cbm-registry-v1.js";
import { toToolResult } from "../lib/core.js";
import { getActiveTaskForProject } from "../lib/build-manager.js";

export const name = "code_atlas_project";
export const description = "Manage Code Atlas projects: register a new project root or remove an existing project.";
export const parameters = {
  type: "object",
  properties: {
    action: { type: "string", description: "add or remove", enum: ["add", "remove"] },
    projectRoot: { type: "string", description: "Absolute project root path for add." },
    projectId: { type: "string", description: "Project ID for remove." },
  },
  required: ["action"],
  additionalProperties: false,
};

export async function execute(input = {}, ctx) {
  const action = String(input.action || "").trim();
  if (action === "add") {
    const projectRoot = String(input.projectRoot || "").trim();
    if (!projectRoot) return toToolResult("project", { ok: false, error: "projectRoot_required" });
    const cbmRuntime = await resolveCbmRuntime(ctx);
    if (!cbmRuntime.ok) return toToolResult("project", { ok: false, error: cbmRuntime.error });
    const result = await registerProject({
      dataDir: ctx.dataDir,
      projectRoot,
      cbmBinary: cbmRuntime.binary,
      cbmCacheDir: cbmRuntime.cacheDir || undefined,
    });
    return toToolResult("project", result);
  }
  if (action === "remove") {
    const projectId = String(input.projectId || "").trim();
    if (!projectId || !isValidProjectId(projectId)) return toToolResult("project", { ok: false, error: "invalid_projectId" });
    const activeTask = getActiveTaskForProject(projectId);
    if (activeTask) {
      return toToolResult("project", { ok: false, error: "project_build_active", ...activeTask });
    }
    const result = await unregisterProject(ctx.dataDir, projectId);
    return toToolResult("project", result);
  }
  return toToolResult("project", { ok: false, error: "unknown_action" });
}
