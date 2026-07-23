import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  projectDir,
  projectJsonPath,
  projectOverlayPath,
  resolveProject,
  isValidProjectId,
} from "./projects.js";
import { currentBundleDir, readCurrentPointer } from "./storage.js";

const DRAFT_FILE = "overlay-draft.json";
const DRAFT_META_FILE = "overlay-draft-meta.json";
const REVIEW_FILE = "overlay-review.json";
const REVIEW_META_FILE = "overlay-review-meta.json";
const MAX_DRAFT_BYTES = 256 * 1024;
const MAX_LAYERS = 24;
const MAX_MACRO_DOMAINS = 12;
const MAX_PATTERNS_PER_LAYER = 40;
const ID_RE = /^(?:layer|macro)-[a-z0-9][a-z0-9-]{1,63}$/;
const GLOB_META_RE = /[*?\[]/;
const GLOB_REGEX_SPECIAL_RE = /[.+^${}()|\\]/g;

function draftPath(dataDir, projectId) {
  const dir = projectDir(dataDir, projectId);
  return dir ? path.join(dir, DRAFT_FILE) : null;
}

function draftMetaPath(dataDir, projectId) {
  const dir = projectDir(dataDir, projectId);
  return dir ? path.join(dir, DRAFT_META_FILE) : null;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalJson(value[key]);
    return result;
  }, {});
}

export function stableOverlayHash(overlay) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalJson(overlay))).digest("hex");
}

function reviewPath(dataDir, projectId) {
  const dir = projectDir(dataDir, projectId);
  return dir ? path.join(dir, REVIEW_FILE) : null;
}

function reviewMetaPath(dataDir, projectId) {
  const dir = projectDir(dataDir, projectId);
  return dir ? path.join(dir, REVIEW_META_FILE) : null;
}

async function atomicWriteJson(targetPath, value) {
  const tmpPath = `${targetPath}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
  try {
    await fsp.rename(tmpPath, targetPath);
  } catch (error) {
    await fsp.rm(tmpPath, { force: true }).catch(() => {});
    throw error;
  }
}

function isSafeText(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function normalizePattern(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function globToRegExp(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(GLOB_REGEX_SPECIAL_RE, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

function matchingPaths(pattern, filePaths) {
  if (!GLOB_META_RE.test(pattern)) {
    const prefix = pattern.endsWith("/") ? pattern : `${pattern}/`;
    return [...filePaths].filter((filePath) => filePath === pattern || filePath.startsWith(prefix));
  }
  const matcher = globToRegExp(pattern);
  return [...filePaths].filter((filePath) => matcher.test(filePath));
}

function patternIssue(pattern, filePaths) {
  if (!pattern || pattern.length > 240 || pattern.includes("\0")) return "invalid_pattern";
  if (path.posix.isAbsolute(pattern) || pattern === ".." || pattern.startsWith("../") || pattern.includes("/../")) {
    return "path_escape";
  }
  if (pattern.startsWith("**/") || pattern === "**" || pattern.includes("[")) return "overbroad_pattern";
  const prefix = pattern.split(/[*?\[]/, 1)[0];
  if (GLOB_META_RE.test(pattern) && (!prefix || prefix === ".")) return "overbroad_pattern";
  return matchingPaths(pattern, filePaths).length > 0 ? null : "pattern_matched_nothing";
}

function validateEvidence(evidence, layerId, filePaths, issues) {
  if (!Array.isArray(evidence) || evidence.length === 0 || evidence.length > 12) {
    issues.push({ code: "invalid_evidence", path: `evidence.${layerId}` });
    return;
  }
  for (const [index, item] of evidence.entries()) {
    if (!item || typeof item !== "object" || !isSafeText(item.path, 240) || !isSafeText(item.reason, 500)) {
      issues.push({ code: "invalid_evidence_item", path: `evidence.${layerId}[${index}]` });
      continue;
    }
    const evidencePath = normalizePattern(item.path);
    if (!filePaths.has(evidencePath)) {
      issues.push({ code: "evidence_path_not_in_graph", path: `evidence.${layerId}[${index}].path`, value: evidencePath });
    }
  }
}

export function validateArchitectureOverlay(overlay, graph) {
  const issues = [];
  if (!overlay || typeof overlay !== "object" || Array.isArray(overlay)) {
    return { ok: false, issues: [{ code: "overlay_must_be_object", path: "$" }] };
  }
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const filePaths = new Set(nodes.map((node) => normalizePattern(node?.filePath)).filter(Boolean));
  if (filePaths.size === 0) issues.push({ code: "graph_has_no_file_paths", path: "$graph" });

  if (!isSafeText(overlay.version, 32)) issues.push({ code: "invalid_version", path: "version" });
  if (overlay.language !== "zh") issues.push({ code: "language_must_be_zh", path: "language" });
  if (overlay.evidenceStatus !== "llm-draft-pending-review") {
    issues.push({ code: "invalid_evidence_status", path: "evidenceStatus" });
  }
  if (!overlay.project || typeof overlay.project !== "object") {
    issues.push({ code: "project_required", path: "project" });
  } else {
    if (!isSafeText(overlay.project.name, 160)) issues.push({ code: "invalid_project_name", path: "project.name" });
    if (!isSafeText(overlay.project.description, 1600)) issues.push({ code: "invalid_project_description", path: "project.description" });
    if (overlay.project.frameworks !== undefined && (!Array.isArray(overlay.project.frameworks) || overlay.project.frameworks.length > 30)) {
      issues.push({ code: "invalid_frameworks", path: "project.frameworks" });
    }
  }

  const layers = overlay.layers;
  if (!Array.isArray(layers) || layers.length < 2 || layers.length > MAX_LAYERS) {
    issues.push({ code: "invalid_layers", path: "layers" });
  }
  const layerIds = new Set();
  const matchedByLayer = new Map();
  for (const [index, layer] of (Array.isArray(layers) ? layers : []).entries()) {
    const base = `layers[${index}]`;
    if (!layer || typeof layer !== "object") {
      issues.push({ code: "invalid_layer", path: base });
      continue;
    }
    if (!ID_RE.test(String(layer.id || "")) || !String(layer.id).startsWith("layer-")) {
      issues.push({ code: "invalid_layer_id", path: `${base}.id` });
    } else if (layerIds.has(layer.id)) {
      issues.push({ code: "duplicate_layer_id", path: `${base}.id`, value: layer.id });
    } else {
      layerIds.add(layer.id);
    }
    if (!isSafeText(layer.name, 120)) issues.push({ code: "invalid_layer_name", path: `${base}.name` });
    if (!isSafeText(layer.description, 1000)) issues.push({ code: "invalid_layer_description", path: `${base}.description` });
    if (!Array.isArray(layer.patterns) || layer.patterns.length === 0 || layer.patterns.length > MAX_PATTERNS_PER_LAYER) {
      issues.push({ code: "invalid_layer_patterns", path: `${base}.patterns` });
    } else {
      const layerMatches = new Set();
      for (const [patternIndex, rawPattern] of layer.patterns.entries()) {
        const pattern = normalizePattern(rawPattern);
        const code = patternIssue(pattern, filePaths);
        if (code) issues.push({ code, path: `${base}.patterns[${patternIndex}]`, value: pattern });
        else for (const filePath of matchingPaths(pattern, filePaths)) layerMatches.add(filePath);
      }
      matchedByLayer.set(layer.id, layerMatches);
    }
  }
  const owners = new Map();
  for (const [layerId, paths] of matchedByLayer) {
    for (const filePath of paths) {
      if (owners.has(filePath)) issues.push({ code: "file_matched_by_multiple_layers", path: "layers", value: filePath, layers: [owners.get(filePath), layerId] });
      else owners.set(filePath, layerId);
    }
  }

  const fallback = overlay.fallbackLayer;
  if (!fallback || typeof fallback !== "object") {
    issues.push({ code: "fallback_layer_required", path: "fallbackLayer" });
  } else {
    if (!ID_RE.test(String(fallback.id || "")) || !String(fallback.id).startsWith("layer-")) {
      issues.push({ code: "invalid_fallback_id", path: "fallbackLayer.id" });
    } else if (layerIds.has(fallback.id)) {
      issues.push({ code: "duplicate_fallback_id", path: "fallbackLayer.id", value: fallback.id });
    } else {
      layerIds.add(fallback.id);
    }
    if (!isSafeText(fallback.name, 120)) issues.push({ code: "invalid_fallback_name", path: "fallbackLayer.name" });
    if (!isSafeText(fallback.description, 1000)) issues.push({ code: "invalid_fallback_description", path: "fallbackLayer.description" });
  }

  const overview = overlay.architectureOverview;
  if (!overview || typeof overview !== "object") {
    issues.push({ code: "architecture_overview_required", path: "architectureOverview" });
  } else {
    if (!isSafeText(overview.projectName, 180)) issues.push({ code: "invalid_overview_name", path: "architectureOverview.projectName" });
    if (!isSafeText(overview.projectDescription, 1800)) issues.push({ code: "invalid_overview_description", path: "architectureOverview.projectDescription" });
    const representatives = Number(overview.representativesPerLayer);
    if (!Number.isInteger(representatives) || representatives < 1 || representatives > 6) {
      issues.push({ code: "invalid_representative_budget", path: "architectureOverview.representativesPerLayer" });
    }
    const edges = Number(overview.maxBackboneEdges);
    if (!Number.isInteger(edges) || edges < 1 || edges > 24) {
      issues.push({ code: "invalid_backbone_budget", path: "architectureOverview.maxBackboneEdges" });
    }
    const macros = overview.macroDomains;
    if (!Array.isArray(macros) || macros.length < 2 || macros.length > MAX_MACRO_DOMAINS) {
      issues.push({ code: "invalid_macro_domains", path: "architectureOverview.macroDomains" });
    }
    const macroIds = new Set();
    const assignedLayers = new Set();
    for (const [index, macro] of (Array.isArray(macros) ? macros : []).entries()) {
      const base = `architectureOverview.macroDomains[${index}]`;
      if (!macro || typeof macro !== "object") {
        issues.push({ code: "invalid_macro_domain", path: base });
        continue;
      }
      if (!ID_RE.test(String(macro.id || "")) || !String(macro.id).startsWith("macro-")) {
        issues.push({ code: "invalid_macro_id", path: `${base}.id` });
      } else if (macroIds.has(macro.id)) {
        issues.push({ code: "duplicate_macro_id", path: `${base}.id`, value: macro.id });
      } else {
        macroIds.add(macro.id);
      }
      if (!isSafeText(macro.name, 120)) issues.push({ code: "invalid_macro_name", path: `${base}.name` });
      if (!isSafeText(macro.description, 1000)) issues.push({ code: "invalid_macro_description", path: `${base}.description` });
      if (!Array.isArray(macro.layerIds) || macro.layerIds.length === 0) {
        issues.push({ code: "invalid_macro_layers", path: `${base}.layerIds` });
      } else {
        for (const layerId of macro.layerIds) {
          if (!layerIds.has(layerId)) issues.push({ code: "unknown_macro_layer", path: `${base}.layerIds`, value: layerId });
          if (assignedLayers.has(layerId)) issues.push({ code: "layer_assigned_twice", path: `${base}.layerIds`, value: layerId });
          assignedLayers.add(layerId);
        }
      }
    }
    for (const layerId of layerIds) {
      if (!assignedLayers.has(layerId)) issues.push({ code: "macro_layer_missing", path: "architectureOverview.macroDomains", value: layerId });
    }
  }

  const evidence = overlay.evidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    issues.push({ code: "evidence_required", path: "evidence" });
  } else {
    for (const layerId of layerIds) validateEvidence(evidence[layerId], layerId, filePaths, issues);
    for (const evidenceLayerId of Object.keys(evidence)) {
      if (!layerIds.has(evidenceLayerId)) issues.push({ code: "unknown_evidence_layer", path: `evidence.${evidenceLayerId}` });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    stats: {
      filePathCount: filePaths.size,
      layerCount: layerIds.size,
      macroDomainCount: Array.isArray(overview?.macroDomains) ? overview.macroDomains.length : 0,
    },
  };
}

export async function readArchitectureState(dataDir, projectId) {
  if (!isValidProjectId(projectId)) return { ok: false, error: "invalid_projectId" };
  const meta = await resolveProject(dataDir, projectId);
  if (!meta) return { ok: false, error: "project_not_found" };
  let draft = null;
  let draftMeta = null;
  try { draft = JSON.parse(await fsp.readFile(draftPath(dataDir, projectId), "utf-8")); } catch { /* no draft */ }
  try { draftMeta = JSON.parse(await fsp.readFile(draftMetaPath(dataDir, projectId), "utf-8")); } catch { /* no metadata */ }
  let review = null;
  let reviewMeta = null;
  try { review = JSON.parse(await fsp.readFile(reviewPath(dataDir, projectId), "utf-8")); } catch { /* no review */ }
  try { reviewMeta = JSON.parse(await fsp.readFile(reviewMetaPath(dataDir, projectId), "utf-8")); } catch { /* no review metadata */ }
  const currentDraftSha256 = draft ? stableOverlayHash(draft) : null;
  const reviewMatchesDraft = !!review && !!reviewMeta
    && reviewMeta.status !== "invalidated"
    && reviewMeta.draftSha256 === currentDraftSha256
    && reviewMeta.reviewReportSha256 === stableOverlayHash(review);
  let adoptedOverlaySha256 = null;
  try {
    const overlay = JSON.parse(await fsp.readFile(projectOverlayPath(dataDir, projectId), "utf-8"));
    adoptedOverlaySha256 = stableOverlayHash(overlay);
  } catch { /* no adopted overlay */ }
  const adoptedAt = Date.parse(meta.overlayAdoptedAt || "");
  const builtAt = Date.parse(meta.lastBuiltAt || "");
  const requiresBuild = Number.isFinite(adoptedAt) && (!Number.isFinite(builtAt) || adoptedAt > builtAt);
  return {
    ok: true,
    projectId,
    hasDraft: !!draft,
    draft,
    draftMeta,
    hasReview: reviewMatchesDraft,
    review: reviewMatchesDraft ? review : null,
    reviewMeta: reviewMatchesDraft ? reviewMeta : null,
    hasAdoptedOverlay: !!adoptedOverlaySha256,
    adoptedOverlaySha256,
    requiresBuild,
  };
}

export async function writeArchitectureDraft(dataDir, projectId, overlay, provenance = {}) {
  if (!isValidProjectId(projectId)) return { ok: false, error: "invalid_projectId" };
  const meta = await resolveProject(dataDir, projectId);
  if (!meta) return { ok: false, error: "project_not_found" };
  const serialized = JSON.stringify(overlay);
  if (Buffer.byteLength(serialized) > MAX_DRAFT_BYTES) return { ok: false, error: "overlay_too_large" };

  const fullDir = await currentBundleDir(dataDir, projectId, "full");
  if (!fullDir) return { ok: false, error: "full_bundle_required" };
  let graph;
  try {
    graph = JSON.parse(await fsp.readFile(path.join(fullDir, ".ua", "knowledge-graph.json"), "utf-8"));
  } catch {
    return { ok: false, error: "full_graph_unreadable" };
  }
  const validation = validateArchitectureOverlay(overlay, graph);
  if (!validation.ok) return { ok: false, error: "overlay_validation_failed", validation };

  const now = new Date().toISOString();
  const sha256 = stableOverlayHash(overlay);
  await atomicWriteJson(draftPath(dataDir, projectId), overlay);
  await atomicWriteJson(draftMetaPath(dataDir, projectId), {
    version: "1.0.0",
    projectId,
    projectRoot: meta.root,
    status: "validated-draft",
    generatedAt: provenance.generatedAt || now,
    validatedAt: now,
    providerId: provenance.providerId || null,
    model: provenance.model || null,
    sourceBuildId: provenance.sourceBuildId || meta.currentBuildId || (await readCurrentPointer(dataDir, projectId))?.buildId || null,
    sourceGitCommitHash: provenance.sourceGitCommitHash || null,
    overlaySha256: sha256,
    usage: provenance.usage || null,
    validation: validation.stats,
  });
  await Promise.all([
    fsp.rm(reviewPath(dataDir, projectId), { force: true }),
    fsp.rm(reviewMetaPath(dataDir, projectId), { force: true }),
  ]);
  return { ok: true, overlaySha256: sha256, validation: validation.stats };
}

export async function adoptArchitectureDraft(dataDir, projectId, expectedSha256, expectedReviewSha256) {
  if (!isValidProjectId(projectId)) return { ok: false, error: "invalid_projectId" };
  const meta = await resolveProject(dataDir, projectId);
  if (!meta) return { ok: false, error: "project_not_found" };
  let overlay;
  let draftMeta;
  let review;
  let reviewMeta;
  try {
    overlay = JSON.parse(await fsp.readFile(draftPath(dataDir, projectId), "utf-8"));
    draftMeta = JSON.parse(await fsp.readFile(draftMetaPath(dataDir, projectId), "utf-8"));
  } catch {
    return { ok: false, error: "overlay_draft_not_found" };
  }
  try {
    review = JSON.parse(await fsp.readFile(reviewPath(dataDir, projectId), "utf-8"));
    reviewMeta = JSON.parse(await fsp.readFile(reviewMetaPath(dataDir, projectId), "utf-8"));
  } catch {
    return { ok: false, error: "architecture_review_required" };
  }
  const sha256 = stableOverlayHash(overlay);
  if (!expectedSha256 || expectedSha256 !== sha256 || draftMeta.overlaySha256 !== sha256) {
    return { ok: false, error: "overlay_draft_changed" };
  }
  const reviewSha256 = stableOverlayHash(review);
  if (!expectedReviewSha256 || expectedReviewSha256 !== reviewSha256
      || reviewMeta.reviewReportSha256 !== reviewSha256 || reviewMeta.draftSha256 !== sha256
      || reviewMeta.status !== "reviewed-draft") {
    return { ok: false, error: "architecture_review_changed" };
  }
  const current = await readCurrentPointer(dataDir, projectId);
  if (!current || !draftMeta.sourceBuildId || draftMeta.sourceBuildId !== current.buildId
      || reviewMeta.sourceBuildId !== current.buildId) {
    return { ok: false, error: "overlay_source_build_changed" };
  }
  const fullDir = await currentBundleDir(dataDir, projectId, "full");
  if (!fullDir) return { ok: false, error: "full_bundle_required" };
  let graph;
  try {
    graph = JSON.parse(await fsp.readFile(path.join(fullDir, ".ua", "knowledge-graph.json"), "utf-8"));
  } catch {
    return { ok: false, error: "full_graph_unreadable" };
  }
  const validation = validateArchitectureOverlay(overlay, graph);
  if (!validation.ok) return { ok: false, error: "overlay_validation_failed", validation };

  const adoptedOverlay = { ...overlay, evidenceStatus: "llm-draft-reviewed-by-human" };
  const adoptedSha256 = stableOverlayHash(adoptedOverlay);
  await atomicWriteJson(projectOverlayPath(dataDir, projectId), adoptedOverlay);
  const projectPath = projectJsonPath(dataDir, projectId);
  const projectMeta = JSON.parse(await fsp.readFile(projectPath, "utf-8"));
  projectMeta.hasOverlay = true;
  projectMeta.overlaySha256 = adoptedSha256;
  projectMeta.overlayReviewSha256 = reviewSha256;
  delete projectMeta.overlayReviewVerdict;
  projectMeta.overlayAdoptedAt = new Date().toISOString();
  await atomicWriteJson(projectPath, projectMeta);
  draftMeta.status = "adopted";
  draftMeta.adoptedAt = projectMeta.overlayAdoptedAt;
  reviewMeta.status = "adopted";
  reviewMeta.adoptedAt = projectMeta.overlayAdoptedAt;
  await Promise.all([
    atomicWriteJson(draftMetaPath(dataDir, projectId), draftMeta),
    atomicWriteJson(reviewMetaPath(dataDir, projectId), reviewMeta),
  ]);
  return { ok: true, overlaySha256: adoptedSha256, draftSha256: sha256, reviewReportSha256: reviewSha256, requiresBuild: true };
}
