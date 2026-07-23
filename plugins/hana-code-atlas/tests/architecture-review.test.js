import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import { registerProject } from "../lib/projects.js";
import { writeCurrentPointer } from "../lib/storage.js";
import { readArchitectureState, writeArchitectureDraft } from "../lib/architecture-overlay.js";
import {
  buildArchitectureReviewPrompt,
  hashReviewPrompt,
  validateArchitectureReview,
  writeArchitectureReview,
} from "../lib/architecture-review.js";

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
    verdict: "revise",
    confidence: 0.84,
    summary: "总体边界成立，但服务端职责可以进一步收敛。",
    findings: [{
      severity: "medium",
      layerId: "layer-server",
      issue: "服务端层描述没有明确认证边界。",
      evidencePaths: ["src/server.js"],
      suggestion: "在层描述中补充认证和请求入口职责。",
    }],
    missingAreas: [{
      name: "工程元数据",
      reason: "基础层需要说明构建元数据。",
      evidencePaths: ["package.json"],
    }],
    positiveAspects: ["界面与服务端路径归属互斥。"],
  };
}

describe("Architecture LLM review", () => {
  let dataDir;
  let projectRoot;
  let projectId;

  beforeEach(async () => {
    dataDir = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-review-data-"));
    projectRoot = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-review-root-"));
    projectId = (await registerProject({ dataDir, projectRoot })).projectId;
    const uaDir = path.join(dataDir, "projects", projectId, "builds", "build-1", "full", ".ua");
    await fsp.mkdir(uaDir, { recursive: true });
    await fsp.writeFile(path.join(uaDir, "knowledge-graph.json"), JSON.stringify(graph()));
    await fsp.writeFile(path.join(uaDir, "config.json"), "{}");
    await writeCurrentPointer(dataDir, projectId, { buildId: "build-1", previousBuildId: null });
  });

  afterEach(async () => {
    await fsp.rm(dataDir, { recursive: true, force: true });
    await fsp.rm(projectRoot, { recursive: true, force: true });
  });

  it("validates grounded findings and rejects fabricated review evidence", () => {
    const valid = validateArchitectureReview(review(), overlay(), graph());
    assert.equal(valid.ok, true);
    assert.equal(valid.stats.verdict, "revise");
    const invalid = review();
    invalid.findings[0].layerId = "layer-missing";
    invalid.findings[0].evidencePaths = ["src/fabricated.js"];
    invalid.command = "apply now";
    const result = validateArchitectureReview(invalid, overlay(), graph());
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((issue) => issue.code === "unknown_review_field"));
    assert.ok(result.issues.some((issue) => issue.code === "unknown_review_layer"));
    assert.ok(result.issues.some((issue) => issue.code === "review_evidence_path_not_in_graph"));
  });

  it("stores a review bound to the exact draft and source build", async () => {
    const draft = await writeArchitectureDraft(dataDir, projectId, overlay());
    const prompt = buildArchitectureReviewPrompt({ project: { sourceBuildId: "build-1" }, filePaths: [] }, overlay(), {
      draftSha256: draft.overlaySha256,
      sourceBuildId: "build-1",
    });
    const stored = await writeArchitectureReview(dataDir, projectId, review(), {
      draftSha256: draft.overlaySha256,
      sourceBuildId: "build-1",
      reviewerProviderId: "reviewer",
      reviewerModel: "review-model",
      reviewPromptSha256: hashReviewPrompt(prompt),
    });
    assert.equal(stored.ok, true);
    const state = await readArchitectureState(dataDir, projectId);
    assert.equal(state.hasReview, true);
    assert.equal(state.review.verdict, "revise");
    assert.equal(state.reviewMeta.draftSha256, draft.overlaySha256);
    assert.equal(state.reviewMeta.reviewerModel, "review-model");
  });

  it("invalidates an old review when a new draft is written", async () => {
    const first = await writeArchitectureDraft(dataDir, projectId, overlay());
    await writeArchitectureReview(dataDir, projectId, review(), {
      draftSha256: first.overlaySha256,
      sourceBuildId: "build-1",
    });
    assert.equal((await readArchitectureState(dataDir, projectId)).hasReview, true);
    const replacement = overlay();
    replacement.project.description = "Updated architecture";
    await writeArchitectureDraft(dataDir, projectId, replacement);
    const state = await readArchitectureState(dataDir, projectId);
    assert.equal(state.hasDraft, true);
    assert.equal(state.hasReview, false);
  });

  it("rejects a review after the source build changes", async () => {
    const draft = await writeArchitectureDraft(dataDir, projectId, overlay());
    await writeCurrentPointer(dataDir, projectId, { buildId: "build-2", previousBuildId: "build-1" });
    const result = await writeArchitectureReview(dataDir, projectId, review(), {
      draftSha256: draft.overlaySha256,
      sourceBuildId: "build-1",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "overlay_source_build_changed");
  });
});
