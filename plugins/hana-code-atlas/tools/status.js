import { listProjects, resolveProject, isValidProjectId } from "../lib/projects.js";
import { currentBundleDir, readCurrentPointer } from "../lib/storage.js";
import { validateBundle, readConfig, detectCbmBinary, detectPythonBinary, toToolResult } from "../lib/core.js";

export const name = "code_atlas_status";
export const description = "Query Code Atlas status: dependencies, registered projects, and bundle state.";
export const parameters = {
  type: "object",
  properties: {
    projectId: { type: "string", description: "Optional specific projectId." },
  },
  additionalProperties: false,
};

export async function execute(input = {}, ctx) {
  const cbmBinary = await readConfig(ctx, "cbmBinary", "");
  const pythonBinary = await readConfig(ctx, "pythonBinary", "python3");
  const [cbmStatus, pythonStatus] = await Promise.all([
    detectCbmBinary(cbmBinary), detectPythonBinary(pythonBinary),
  ]);
  const result = { cbm: cbmStatus, python: pythonStatus };

  const projectId = String(input.projectId || "").trim();
  if (projectId) {
    if (!isValidProjectId(projectId)) return toToolResult("status", { ...result, error: "invalid_projectId" });
    const meta = await resolveProject(ctx.dataDir, projectId);
    if (!meta) return toToolResult("status", { ...result, error: "project_not_found" });
    const current = await readCurrentPointer(ctx.dataDir, projectId);
    let hasArchitecture = false, hasFull = false;
    if (current) {
      const archDir = await currentBundleDir(ctx.dataDir, projectId, "architecture");
      const fullDir = await currentBundleDir(ctx.dataDir, projectId, "full");
      if (archDir) hasArchitecture = (await validateBundle(archDir).catch(() => ({ ok: false }))).ok;
      if (fullDir) hasFull = (await validateBundle(fullDir).catch(() => ({ ok: false }))).ok;
    }
    result.project = { projectId: meta.projectId, name: meta.name, root: meta.root,
      cbmProjectName: meta.cbmProjectName, hasOverlay: !!meta.hasOverlay,
      hasArchitecture, hasFull, currentBuildId: current ? current.buildId : null };
  } else {
    const projects = await listProjects(ctx.dataDir);
    result.registeredProjects = projects.length;
  }
  return toToolResult("status", result);
}
