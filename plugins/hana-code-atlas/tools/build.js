import { resolveProject, isValidProjectId } from "../lib/projects.js";
import { startBuild } from "../lib/build-manager.js";
import { resolveCbmRuntime } from "../lib/cbm-registry-v1.js";
import { readConfig, toToolResult } from "../lib/core.js";

export const name = "code_atlas_build";
export const description = "Start a cbm2ua build for a registered project. Returns taskId for status tracking. Completed builds auto-promote to current.";
export const parameters = {
  type: "object",
  properties: {
    projectId: {
      type: "string",
      description: "Registered project ID. Use code_atlas_project to list registered projects.",
    },
  },
  required: ["projectId"],
  additionalProperties: false,
};

export async function execute(input = {}, ctx) {
  const projectId = String(input.projectId || "").trim();
  if (!projectId) throw new Error("projectId is required.");
  if (!isValidProjectId(projectId)) return toToolResult("build", { ok: false, error: "invalid_projectId" });

  const meta = await resolveProject(ctx.dataDir, projectId);
  if (!meta) return toToolResult("build", { ok: false, error: "project_not_found" });
  if (!meta.cbmProjectName) return toToolResult("build", { ok: false, error: "cbm_project_not_found" });

  const cbmRuntime = await resolveCbmRuntime(ctx);
  if (!cbmRuntime.ok) return toToolResult("build", { ok: false, error: cbmRuntime.error });
  const pythonBinary = await readConfig(ctx, "pythonBinary", "python3");
  const pipelineTimeoutSeconds = await readConfig(ctx, "pipelineTimeoutSeconds", 300);
  const cbmTimeoutSeconds = await readConfig(ctx, "cbmTimeoutSeconds", 120);
  const maxConcurrent = await readConfig(ctx, "maxConcurrentBuilds", 1);

  const result = startBuild({
    dataDir: ctx.dataDir, projectId, pythonBinary, cbmBinary: cbmRuntime.binary,
    pipelineTimeoutSeconds, cbmTimeoutSeconds, maxConcurrent,
    pluginDir: ctx.pluginDir, cbmCacheDir: cbmRuntime.cacheDir || undefined,
  });
  return toToolResult("build", result);
}
