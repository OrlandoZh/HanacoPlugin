import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import registerApiRoutes from "../routes/api.js";
import { execute as executeProjectTool } from "../tools/project.js";
import { registerProject } from "../lib/projects.js";
import { startBuild, cancelAllTasks } from "../lib/build-manager.js";

function parseToolResult(result) {
  return JSON.parse(result.content[0].text.split("\n").slice(1).join("\n"));
}

describe("active build project removal guard", () => {
  let dataDir;
  let projectRoot;
  let projectId;

  beforeEach(async () => {
    dataDir = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-remove-data-"));
    projectRoot = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-remove-root-"));
    const registered = await registerProject({ dataDir, projectRoot });
    projectId = registered.projectId;
    cancelAllTasks();
  });

  afterEach(async () => {
    cancelAllTasks();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fsp.rm(dataDir, { recursive: true, force: true });
    await fsp.rm(projectRoot, { recursive: true, force: true });
  });

  function startPendingBuild() {
    const result = startBuild({
      dataDir,
      projectId,
      pythonBinary: "/nonexistent/python-binary-that-must-not-spawn",
      pluginDir: "/tmp",
    });
    assert.equal(result.ok, true);
    return result;
  }

  it("HTTP DELETE returns 409 while a project build is active", async () => {
    const build = startPendingBuild();
    const handlers = new Map();
    const app = {
      get() {},
      post() {},
      delete(route, handler) { handlers.set(route, handler); },
    };
    registerApiRoutes(app, { dataDir });

    const response = await handlers.get("/api/projects/:projectId")({
      req: { param: () => projectId },
      json: (body, status = 200) => ({ body, status }),
    });

    assert.equal(response.status, 409);
    assert.equal(response.body.error, "project_build_active");
    assert.equal(response.body.taskId, build.taskId);
  });

  it("Agent project remove returns project_build_active", async () => {
    const build = startPendingBuild();
    const result = parseToolResult(await executeProjectTool(
      { action: "remove", projectId },
      { dataDir, config: { get: async () => "" } },
    ));

    assert.equal(result.ok, false);
    assert.equal(result.error, "project_build_active");
    assert.equal(result.taskId, build.taskId);
  });
});
