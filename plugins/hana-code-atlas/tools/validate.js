import { resolveProject, isValidProjectId } from "../lib/projects.js";
import { currentBundleDir, ALLOWED_BUNDLE_NAMES } from "../lib/storage.js";
import { validateBundle, toToolResult } from "../lib/core.js";
import fsp from "node:fs/promises";
import path from "node:path";

export const name = "code_atlas_validate";
export const description = "Validate Code Atlas bundle artifacts for a registered project.";
export const parameters = {
  type: "object",
  properties: {
    projectId: { type: "string", description: "Registered project ID." },
    bundle: { type: "string", description: "full or architecture", enum: ["full", "architecture"], default: "full" },
  },
  required: ["projectId"],
  additionalProperties: false,
};

export async function execute(input = {}, ctx) {
  const projectId = String(input.projectId || "").trim();
  const bundle = String(input.bundle || "full");
  if (!projectId) throw new Error("projectId is required.");
  if (!isValidProjectId(projectId)) return toToolResult("validate", { ok: false, error: "invalid_projectId" });
  if (!ALLOWED_BUNDLE_NAMES.has(bundle)) return toToolResult("validate", { ok: false, error: "invalid_bundle" });

  const meta = await resolveProject(ctx.dataDir, projectId);
  if (!meta) return toToolResult("validate", { ok: false, error: "project_not_found" });

  const bundDir = await currentBundleDir(ctx.dataDir, projectId, bundle);
  if (!bundDir) return toToolResult("validate", { ok: false, bundle, error: "no_current_build" });

  const valid = await validateBundle(bundDir);
  if (!valid.ok) return toToolResult("validate", { ok: false, bundle, errors: valid.errors });

  const issues = [];
  try {
    const kg = JSON.parse(await fsp.readFile(path.join(bundDir, ".ua", "knowledge-graph.json"), "utf-8"));
    const nodeIds = new Set((kg.nodes || []).map((n) => n.id));
    for (const edge of kg.edges || []) {
      if (!nodeIds.has(edge.source)) issues.push("edge source missing: " + edge.source);
      if (!nodeIds.has(edge.target)) issues.push("edge target missing: " + edge.target);
    }
  } catch (err) { issues.push("graph_parse_error: " + err.message); }

  return toToolResult("validate", { ok: issues.length === 0, bundle, issueCount: issues.length, issues: issues.slice(0, 20) });
}
