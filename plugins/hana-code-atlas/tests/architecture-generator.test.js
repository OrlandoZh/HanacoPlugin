import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import { registerProject } from "../lib/projects.js";
import { writeCurrentPointer } from "../lib/storage.js";
import {
  cancelAllArchitectureTasks,
  cancelArchitectureGeneration,
  getArchitectureTask,
  startArchitectureGeneration,
  startArchitectureReview,
} from "../lib/architecture-generator.js";
import { readArchitectureState } from "../lib/architecture-overlay.js";

const originalFetch = globalThis.fetch;

function graph() {
  return {
    project: { description: "test graph" },
    nodes: [
      { id: "file:src/server.js", type: "file", filePath: "src/server.js" },
      { id: "file:src/ui.js", type: "file", filePath: "src/ui.js" },
      { id: "file:package.json", type: "file", filePath: "package.json" },
    ],
    edges: [],
    layers: [],
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
    verdict: "pass",
    confidence: 0.91,
    summary: "架构职责和路径证据一致。",
    findings: [],
    missingAreas: [],
    positiveAspects: ["服务端和界面边界清晰。"],
  };
}

function response(content) {
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 100, completion_tokens: 40 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

async function waitForTask(taskId, statuses = new Set(["completed", "review_failed", "failed", "cancelled"])) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const task = getArchitectureTask(taskId);
    if (task && statuses.has(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`task timeout: ${taskId}`);
}

describe("Architecture generation and independent review task", () => {
  let dataDir;
  let projectRoot;
  let projectId;
  let ctx;

  beforeEach(async () => {
    dataDir = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-generator-data-"));
    projectRoot = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-generator-root-"));
    projectId = (await registerProject({ dataDir, projectRoot })).projectId;
    const fullDir = path.join(dataDir, "projects", projectId, "builds", "build-1", "full");
    await fsp.mkdir(path.join(fullDir, ".ua"), { recursive: true });
    await fsp.mkdir(path.join(fullDir, "source-preview"), { recursive: true });
    await fsp.writeFile(path.join(fullDir, ".ua", "knowledge-graph.json"), JSON.stringify(graph()));
    await fsp.writeFile(path.join(fullDir, ".ua", "source-preview-meta.json"), JSON.stringify({ files: [] }));
    await writeCurrentPointer(dataDir, projectId, { buildId: "build-1", previousBuildId: null });
    ctx = {
      dataDir,
      config: { get: async () => "" },
      bus: {
        async request(type, payload) {
          if (type === "provider:models-by-type") {
            return { models: [
              { provider: "generator", id: "model-g" },
              { provider: "reviewer", id: "model-r" },
            ] };
          }
          if (type === "provider:credentials") {
            return { apiKey: "test", baseUrl: `https://${payload.providerId}.example/v1`, api: "openai-completions" };
          }
          throw new Error(`unexpected channel: ${type}`);
        },
      },
    };
  });

  afterEach(async () => {
    cancelAllArchitectureTasks();
    globalThis.fetch = originalFetch;
    await fsp.rm(dataDir, { recursive: true, force: true });
    await fsp.rm(projectRoot, { recursive: true, force: true });
  });

  it("calls separate generator and reviewer models and stores a bound report", async () => {
    const requests = [];
    globalThis.fetch = async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return requests.length === 1 ? response(JSON.stringify(overlay())) : response(JSON.stringify(review()));
    };
    const started = startArchitectureGeneration(ctx, {
      projectId,
      providerId: "generator",
      model: "model-g",
      reviewerProviderId: "reviewer",
      reviewerModel: "model-r",
    });
    assert.equal(started.ok, true);
    const task = await waitForTask(started.taskId);
    assert.equal(task.status, "completed", JSON.stringify(task));
    assert.equal(task.providerId, "generator");
    assert.equal(task.reviewerProviderId, "reviewer");
    assert.equal(task.reviewVerdict, "pass");
    assert.equal(requests.length, 2);
    assert.match(requests[0].url, /generator\.example/);
    assert.match(requests[1].url, /reviewer\.example/);
    assert.match(requests[1].body.messages[0].content, /独立的代码架构审查员/);
    const state = await readArchitectureState(dataDir, projectId);
    assert.equal(state.hasDraft, true);
    assert.equal(state.hasReview, true);
    assert.equal(state.reviewMeta.draftSha256, state.draftMeta.overlaySha256);
    assert.equal(state.reviewMeta.sourceBuildId, "build-1");
  });

  it("exposes monotonic checkpoint progress for generation and review", async () => {
    let callCount = 0;
    let releaseGeneration;
    let releaseReview;
    globalThis.fetch = async () => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise((resolve) => { releaseGeneration = () => resolve(response(JSON.stringify(overlay()))); });
      }
      return new Promise((resolve) => { releaseReview = () => resolve(response(JSON.stringify(review()))); });
    };
    const started = startArchitectureGeneration(ctx, { projectId });
    const generating = await waitForTask(started.taskId, new Set(["generating"]));
    assert.equal(generating.progress, 20);
    releaseGeneration();
    const reviewing = await waitForTask(started.taskId, new Set(["reviewing"]));
    assert.equal(reviewing.progress, 65);
    releaseReview();
    const completed = await waitForTask(started.taskId);
    assert.equal(completed.status, "completed");
    assert.equal(completed.progress, 100);
  });

  it("accepts explicit provider/model pairs when discovery is unavailable", async () => {
    ctx.bus.request = async (type, payload) => {
      if (type === "provider:models-by-type") throw new Error("NO_HANDLER");
      if (type === "provider:credentials") {
        return { apiKey: "test", baseUrl: `https://${payload.providerId}.example/v1`, api: "openai-completions" };
      }
      throw new Error(`unexpected channel: ${type}`);
    };
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount += 1;
      return callCount === 1 ? response(JSON.stringify(overlay())) : response(JSON.stringify(review()));
    };
    const started = startArchitectureGeneration(ctx, {
      projectId,
      providerId: "manual-generator",
      model: "manual-model-g",
      reviewerProviderId: "manual-reviewer",
      reviewerModel: "manual-model-r",
    });
    const task = await waitForTask(started.taskId);
    assert.equal(task.status, "completed", JSON.stringify(task));
    assert.equal(task.providerId, "manual-generator");
    assert.equal(task.reviewerProviderId, "manual-reviewer");
    assert.equal(callCount, 2);
  });

  it("keeps the validated draft but does not fabricate review completion when review output is invalid", async () => {
    let callCount = 0;
    globalThis.fetch = async () => {
      callCount += 1;
      return callCount === 1 ? response(JSON.stringify(overlay())) : response("not-json");
    };
    const started = startArchitectureGeneration(ctx, { projectId });
    const task = await waitForTask(started.taskId);
    assert.equal(task.status, "review_failed");
    assert.equal(task.error, "architecture_review_output_not_json");
    let state = await readArchitectureState(dataDir, projectId);
    assert.equal(state.hasDraft, true);
    assert.equal(state.hasReview, false);

    globalThis.fetch = async () => response(JSON.stringify(review()));
    const retried = startArchitectureReview(ctx, {
      projectId,
      reviewerProviderId: "reviewer",
      reviewerModel: "model-r",
    });
    assert.equal(retried.ok, true);
    const retryTask = await waitForTask(retried.taskId);
    assert.equal(retryTask.status, "completed", JSON.stringify(retryTask));
    assert.equal(retryTask.kind, "review");
    assert.equal(retryTask.progress, 100);
    state = await readArchitectureState(dataDir, projectId);
    assert.equal(state.hasReview, true);
  });

  it("cannot overwrite cancellation with review completion", async () => {
    let callCount = 0;
    let reviewStarted;
    const reviewStartedPromise = new Promise((resolve) => { reviewStarted = resolve; });
    globalThis.fetch = async (_url, init) => {
      callCount += 1;
      if (callCount === 1) return response(JSON.stringify(overlay()));
      reviewStarted();
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    };
    const started = startArchitectureGeneration(ctx, { projectId });
    await reviewStartedPromise;
    assert.equal(cancelArchitectureGeneration(started.taskId).ok, true);
    const task = await waitForTask(started.taskId);
    assert.equal(task.status, "cancelled");
    const state = await readArchitectureState(dataDir, projectId);
    assert.equal(state.hasDraft, true);
    assert.equal(state.hasReview, false);
  });
});
