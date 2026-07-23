import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import path from "node:path";
import registerApiRoutes from "../routes/api.js";
import { resolveCbmRuntime } from "../lib/cbm-registry-v1.js";

function setupCandidateHandler(ctx) {
  const handlers = new Map();
  const app = {
    get(route, handler) { handlers.set(route, handler); },
    post() {},
    delete() {},
  };
  registerApiRoutes(app, ctx);
  return handlers.get("/api/project-candidates");
}

function jsonContext() {
  return {
    json(body, status = 200) { return { body, status }; },
  };
}

describe("GET /api/project-candidates", () => {
  it("returns usable cbm-indexed roots", { skip: process.platform === "win32" }, async () => {
    const tempDir = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-candidate-api-"));
    const projectRoot = path.join(tempDir, "indexed-project");
    const fakeCbm = path.join(tempDir, "fake-cbm");
    await fsp.mkdir(projectRoot);
    const payload = {
      projects: [{ name: "indexed-project-key", root_path: projectRoot, nodes: 42, edges: 81 }],
    };
    await fsp.writeFile(fakeCbm, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify(payload))});\n`);
    await fsp.chmod(fakeCbm, 0o755);

    try {
      const handler = setupCandidateHandler({
        dataDir: tempDir,
        config: {
          get: async (key) => key === "cbmBinary" ? fakeCbm : "",
        },
      });
      const response = await handler(jsonContext());
      assert.equal(response.status, 200);
      assert.equal(response.body.ok, true);
      assert.deepEqual(response.body.candidates.map((candidate) => candidate.root), [await fsp.realpath(projectRoot)]);
      assert.equal(response.body.candidates[0].cbmProjectName, "indexed-project-key");
      assert.equal(response.body.registry.source, "cbm-default");
      assert.equal(response.body.registry.candidateCount, 1);
      assert.equal(response.body.registry.truncated, false);
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("reuses the Hana MCP connector registry when plugin settings are empty", { skip: process.platform === "win32" }, async () => {
    const tempDir = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-mcp-registry-"));
    const dataDir = path.join(tempDir, "hana-code-atlas");
    const mcpDir = path.join(tempDir, "mcp");
    const projectRoot = path.join(tempDir, "connector-project");
    const cacheDir = path.join(tempDir, "cbm-cache");
    const fakeCbm = path.join(tempDir, "fake-cbm");
    await fsp.mkdir(dataDir);
    await fsp.mkdir(mcpDir);
    await fsp.mkdir(projectRoot);
    await fsp.mkdir(cacheDir);
    const payload = { projects: [{ name: "connector-project-key", root_path: projectRoot, nodes: 7 }] };
    await fsp.writeFile(fakeCbm, `#!/usr/bin/env node\nif (process.env.CBM_CACHE_DIR !== ${JSON.stringify(cacheDir)}) process.exit(9);\nconsole.log(${JSON.stringify(JSON.stringify(payload))});\n`);
    await fsp.chmod(fakeCbm, 0o755);
    await fsp.writeFile(path.join(mcpDir, "config.json"), JSON.stringify({
      global: {
        mcp: {
          connectors: [{
            id: "codebase-memory-mcp",
            command: fakeCbm,
            env: { CBM_CACHE_DIR: cacheDir },
          }],
        },
      },
    }));

    try {
      const handler = setupCandidateHandler({
        dataDir,
        config: { get: async () => "" },
      });
      const response = await handler(jsonContext());
      assert.equal(response.status, 200);
      assert.equal(response.body.ok, true);
      assert.equal(response.body.registry.source, "mcp-connector");
      assert.equal(response.body.registry.binarySource, "mcp-connector");
      assert.equal(response.body.registry.cacheDir, cacheDir);
      assert.equal(response.body.candidates[0].cbmProjectName, "connector-project-key");
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns 503 instead of pretending an unavailable registry is empty", async () => {
    const handler = setupCandidateHandler({
      dataDir: "/tmp",
      config: { get: async () => "/nonexistent/cbm-binary" },
    });
    const response = await handler(jsonContext());
    assert.equal(response.status, 503);
    assert.match(response.body.error, /^cbm_list_projects_failed:/);
    assert.deepEqual(response.body.candidates, []);
  });

  it("lets explicit plugin cache config override an invalid lower-priority environment value", async () => {
    const runtime = await resolveCbmRuntime({
      dataDir: "/tmp/hana-code-atlas",
      config: {
        get: async (key) => key === "cbmCacheDir" ? "/configured/cache" : "/configured/cbm",
      },
    }, { CBM_CACHE_DIR: "relative/env/cache" });
    assert.equal(runtime.ok, true);
    assert.equal(runtime.cacheDir, "/configured/cache");
    assert.equal(runtime.source, "plugin-config");
    assert.equal(runtime.binarySource, "plugin-config");
  });

  it("uses and validates the process environment only when plugin cache config is empty", async () => {
    const fromEnv = await resolveCbmRuntime({
      dataDir: "/tmp/no-mcp/hana-code-atlas",
      config: { get: async () => "" },
    }, { CBM_CACHE_DIR: "/environment/cache" });
    assert.equal(fromEnv.ok, true);
    assert.equal(fromEnv.cacheDir, "/environment/cache");
    assert.equal(fromEnv.source, "process-env");

    const invalidEnv = await resolveCbmRuntime({
      dataDir: "/tmp/no-mcp/hana-code-atlas",
      config: { get: async () => "" },
    }, { CBM_CACHE_DIR: "relative/cache" });
    assert.equal(invalidEnv.ok, false);
    assert.equal(invalidEnv.error, "CBM_CACHE_DIR_must_be_absolute");
  });

  it("reports cache and binary provenance independently", async () => {
    const tempDir = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-runtime-source-"));
    const dataDir = path.join(tempDir, "hana-code-atlas");
    const mcpDir = path.join(tempDir, "mcp");
    await fsp.mkdir(dataDir);
    await fsp.mkdir(mcpDir);
    await fsp.writeFile(path.join(mcpDir, "config.json"), JSON.stringify({
      global: {
        mcp: {
          connectors: [{
            id: "codebase-memory-mcp",
            command: "/connector/cbm",
            env: { CBM_CACHE_DIR: "/connector/cache" },
          }],
        },
      },
    }));
    try {
      const runtime = await resolveCbmRuntime({
        dataDir,
        config: {
          get: async (key) => key === "cbmCacheDir" ? "/plugin/cache" : "",
        },
      }, {});
      assert.equal(runtime.ok, true);
      assert.equal(runtime.cacheDir, "/plugin/cache");
      assert.equal(runtime.source, "plugin-config");
      assert.equal(runtime.binary, "/connector/cbm");
      assert.equal(runtime.binarySource, "mcp-connector");
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("imports cbm runtime from a versioned module at every hot-reloaded entry", async () => {
    const entryFiles = [
      "../routes/api.js",
      "../routes/build.js",
      "../routes/viewer.js",
      "../tools/project.js",
      "../tools/build.js",
    ];
    for (const entryFile of entryFiles) {
      const source = await fsp.readFile(new URL(entryFile, import.meta.url), "utf-8");
      assert.match(source, /from "\.\.\/lib\/cbm-registry-v1\.js"/, entryFile);
    }
    const apiSource = await fsp.readFile(new URL("../routes/api.js", import.meta.url), "utf-8");
    assert.doesNotMatch(apiSource, /listProjects,\s*listCbmProjects/);
  });
});
