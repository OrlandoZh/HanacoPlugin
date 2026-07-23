import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import registerArchitectureRoutes from "../routes/architecture.js";
import { registerProject } from "../lib/projects.js";
import { writeCurrentPointer } from "../lib/storage.js";

function setup(ctx) {
  const handlers = new Map();
  const app = {
    get(route, handler) { handlers.set(`GET ${route}`, handler); },
    post(route, handler) { handlers.set(`POST ${route}`, handler); },
  };
  registerArchitectureRoutes(app, ctx);
  return handlers;
}

function responseContext({ query = {}, params = {}, body = {} } = {}) {
  return {
    req: {
      query: (key) => query[key],
      param: (key) => params[key],
      json: async () => body,
    },
    json: (value, status = 200) => ({ value, status }),
  };
}

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("Architecture task project binding", () => {
  let dataDir;
  let projectRoot;
  let projectId;
  let handlers;

  beforeEach(async () => {
    dataDir = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-arch-route-"));
    projectRoot = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-arch-route-root-"));
    projectId = (await registerProject({ dataDir, projectRoot })).projectId;
    const fullUa = path.join(dataDir, "projects", projectId, "builds", "build-1", "full", ".ua");
    await fsp.mkdir(fullUa, { recursive: true });
    await fsp.writeFile(path.join(fullUa, "knowledge-graph.json"), JSON.stringify({ nodes: [{ id: "file:a", type: "file", filePath: "a.js" }], edges: [], layers: [] }));
    await fsp.writeFile(path.join(fullUa, "source-preview-meta.json"), JSON.stringify({ files: [] }));
    await writeCurrentPointer(dataDir, projectId, { buildId: "build-1" });
    handlers = setup({
      dataDir,
      config: { get: async () => "" },
      bus: {
        async request(type) {
          if (type === "provider:models-by-type") return { models: [{ provider: "mock", id: "m" }] };
          if (type === "provider:credentials") return { apiKey: "x", baseUrl: "https://invalid", api: "openai-completions" };
          return {};
        },
      },
    });
  });

  afterEach(async () => {
    await fsp.rm(dataDir, { recursive: true, force: true });
    await fsp.rm(projectRoot, { recursive: true, force: true });
  });

  it("uses a versioned runtime import to bypass stale reload exports", () => {
    const routeSource = readFileSync(path.join(PLUGIN_ROOT, "routes", "architecture.js"), "utf-8");
    const lifecycleSource = readFileSync(path.join(PLUGIN_ROOT, "index.js"), "utf-8");
    const compatibilitySource = readFileSync(path.join(PLUGIN_ROOT, "lib", "architecture-generator.js"), "utf-8");
    assert.match(routeSource, /architecture-generator-v2\.js/);
    assert.match(lifecycleSource, /architecture-generator-v2\.js/);
    assert.match(compatibilitySource, /export \* from "\.\/architecture-generator-v2\.js"/);
  });

  it("registers the independent review retry endpoint", async () => {
    const handler = handlers.get("POST /api/architecture/review");
    assert.equal(typeof handler, "function");
    const response = await handler(responseContext({ body: { projectId: "bad" } }));
    assert.equal(response.status, 400);
    assert.equal(response.value.error, "invalid_projectId");
  });

  it("requires matching projectId for task reads and cancellation", async () => {
    const started = await handlers.get("POST /api/architecture/generate")(responseContext({ body: { projectId, providerId: "mock", model: "m" } }));
    assert.equal(started.status, 202);
    const taskId = started.value.taskId;
    const mismatchId = "0".repeat(16);
    const read = await handlers.get("GET /api/architecture/tasks/:taskId")(responseContext({ query: { projectId: mismatchId }, params: { taskId } }));
    assert.equal(read.status, 403);
    assert.equal(read.value.error, "task_project_mismatch");
    const cancel = await handlers.get("POST /api/architecture/tasks/:taskId/cancel")(responseContext({ body: { projectId: mismatchId }, params: { taskId } }));
    assert.equal(cancel.status, 403);
    assert.equal(cancel.value.error, "task_project_mismatch");
  });
});
