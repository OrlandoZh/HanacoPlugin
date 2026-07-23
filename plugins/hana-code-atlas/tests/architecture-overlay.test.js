import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import { registerProject, projectOverlayPath } from "../lib/projects.js";
import { writeCurrentPointer } from "../lib/storage.js";
import {
  adoptArchitectureDraft,
  readArchitectureState,
  stableOverlayHash,
  validateArchitectureOverlay,
  writeArchitectureDraft,
} from "../lib/architecture-overlay.js";
import { writeArchitectureReview } from "../lib/architecture-review.js";

function graph() {
  return {
    nodes: [
      { id: "file:src/server.js", type: "file", filePath: "src/server.js" },
      { id: "file:src/ui.js", type: "file", filePath: "src/ui.js" },
      { id: "file:package.json", type: "file", filePath: "package.json" },
    ],
    edges: [],
  };
}

function overlay() {
  return {
    version: "1.0.0",
    language: "zh",
    evidenceStatus: "llm-draft-pending-review",
    project: { name: "Demo", description: "Demo architecture", frameworks: [] },
    excludePaths: [],
    layers: [
      { id: "layer-server", name: "服务端", description: "服务端入口", patterns: ["src/server.js"] },
      { id: "layer-ui", name: "界面", description: "用户界面", patterns: ["src/ui.js"] },
    ],
    fallbackLayer: { id: "layer-foundation", name: "工程基础", description: "工程配置" },
    architectureOverview: {
      projectName: "Demo · 架构总览",
      projectDescription: "宏观架构",
      representativesPerLayer: 2,
      maxBackboneEdges: 8,
      macroDomains: [
        { id: "macro-product", name: "产品", description: "产品能力", layerIds: ["layer-server", "layer-ui"] },
        { id: "macro-foundation", name: "基础", description: "工程基础", layerIds: ["layer-foundation"] },
      ],
    },
    evidence: {
      "layer-server": [{ path: "src/server.js", reason: "服务端入口" }],
      "layer-ui": [{ path: "src/ui.js", reason: "界面入口" }],
      "layer-foundation": [{ path: "package.json", reason: "工程配置" }],
    },
  };
}

function review() {
  return {
    version: "1.0.0",
    verdict: "pass",
    confidence: 0.9,
    summary: "语义边界和路径证据一致。",
    findings: [],
    missingAreas: [],
    positiveAspects: ["服务端、界面和工程基础职责清晰。"],
  };
}

describe("Architecture overlay validation and adoption", () => {
  let dataDir;

  it("uses the compact sorted cross-language SHA contract", () => {
    const value = { z: "中文", a: { b: 2, a: [true, null, "x"] } };
    assert.equal(stableOverlayHash(value), "512d769c00f278a3c72ea1214bc256c77527d3fa4b36b5b602181387f6c55698");
    assert.equal(stableOverlayHash({ a: { a: [true, null, "x"], b: 2 }, z: "中文" }), stableOverlayHash(value));
  });
  let projectRoot;
  let projectId;
  let buildDir;

  beforeEach(async () => {
    dataDir = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-arch-data-"));
    projectRoot = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-arch-root-"));
    const registered = await registerProject({ dataDir, projectRoot });
    projectId = registered.projectId;
    buildDir = path.join(dataDir, "projects", projectId, "builds", "build-1", "full", ".ua");
    await fsp.mkdir(buildDir, { recursive: true });
    await fsp.writeFile(path.join(buildDir, "knowledge-graph.json"), JSON.stringify(graph()));
    await fsp.writeFile(path.join(buildDir, "config.json"), "{}");
    await writeCurrentPointer(dataDir, projectId, { buildId: "build-1", previousBuildId: null });
  });

  afterEach(async () => {
    await fsp.rm(dataDir, { recursive: true, force: true });
    await fsp.rm(projectRoot, { recursive: true, force: true });
  });

  it("accepts a fully evidenced overlay", () => {
    const result = validateArchitectureOverlay(overlay(), graph());
    assert.equal(result.ok, true);
    assert.equal(result.stats.layerCount, 3);
    assert.equal(result.stats.macroDomainCount, 2);
  });

  it("rejects fabricated evidence, broad patterns and duplicate semantic ownership", () => {
    const draft = overlay();
    draft.layers[0].patterns = ["**/server.js"];
    draft.layers[1].patterns = ["src/*.js"];
    draft.evidence["layer-ui"][0].path = "src/missing.js";
    const result = validateArchitectureOverlay(draft, graph());
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === "overbroad_pattern"));
    assert.ok(result.issues.some((issue) => issue.code === "evidence_path_not_in_graph"));
  });

  it("stores a validated draft but does not adopt it implicitly", async () => {
    const stored = await writeArchitectureDraft(dataDir, projectId, overlay(), { providerId: "test", model: "model" });
    assert.equal(stored.ok, true);
    await assert.rejects(fsp.access(projectOverlayPath(dataDir, projectId)));
    const state = await readArchitectureState(dataDir, projectId);
    assert.equal(state.hasDraft, true);
    assert.equal(state.hasAdoptedOverlay, false);
    assert.equal(state.draftMeta.status, "validated-draft");
  });

  it("requires both reviewed draft and review hashes before atomic adoption", async () => {
    const stored = await writeArchitectureDraft(dataDir, projectId, overlay());
    const withoutReview = await adoptArchitectureDraft(dataDir, projectId, stored.overlaySha256, "0".repeat(64));
    assert.equal(withoutReview.ok, false);
    assert.equal(withoutReview.error, "architecture_review_required");
    const reviewed = await writeArchitectureReview(dataDir, projectId, review(), {
      draftSha256: stored.overlaySha256,
      sourceBuildId: "build-1",
    });
    const stale = await adoptArchitectureDraft(dataDir, projectId, "0".repeat(64), reviewed.reviewReportSha256);
    assert.equal(stale.ok, false);
    assert.equal(stale.error, "overlay_draft_changed");
    const staleReview = await adoptArchitectureDraft(dataDir, projectId, stored.overlaySha256, "0".repeat(64));
    assert.equal(staleReview.ok, false);
    assert.equal(staleReview.error, "architecture_review_changed");

    const adopted = await adoptArchitectureDraft(dataDir, projectId, stored.overlaySha256, reviewed.reviewReportSha256);
    assert.equal(adopted.ok, true);
    assert.equal(adopted.requiresBuild, true);
    const adoptedOverlay = JSON.parse(await fsp.readFile(projectOverlayPath(dataDir, projectId), "utf-8"));
    assert.equal(adoptedOverlay.architectureOverview.projectName, "Demo · 架构总览");
    assert.equal(adoptedOverlay.evidenceStatus, "llm-draft-reviewed-by-human");
    const projectMeta = JSON.parse(await fsp.readFile(path.join(dataDir, "projects", projectId, "project.json"), "utf-8"));
    assert.equal(projectMeta.hasOverlay, true);
    assert.equal(projectMeta.overlaySha256, stableOverlayHash(adoptedOverlay));
    assert.equal(projectMeta.overlaySha256, adopted.overlaySha256);
    assert.notEqual(projectMeta.overlaySha256, stored.overlaySha256);
    assert.equal(projectMeta.overlayReviewSha256, reviewed.reviewReportSha256);
    assert.equal(Object.hasOwn(projectMeta, "overlayReviewVerdict"), false);
    assert.equal((await readArchitectureState(dataDir, projectId)).requiresBuild, true);
  });

  it("rejects adoption after the source Full build changes", async () => {
    const stored = await writeArchitectureDraft(dataDir, projectId, overlay());
    const reviewed = await writeArchitectureReview(dataDir, projectId, review(), {
      draftSha256: stored.overlaySha256,
      sourceBuildId: "build-1",
    });
    await writeCurrentPointer(dataDir, projectId, { buildId: "build-2", previousBuildId: "build-1" });
    const result = await adoptArchitectureDraft(dataDir, projectId, stored.overlaySha256, reviewed.reviewReportSha256);
    assert.equal(result.ok, false);
    assert.equal(result.error, "overlay_source_build_changed");
  });
});
