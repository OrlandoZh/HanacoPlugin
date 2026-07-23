import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fsp from "node:fs/promises";
import {
  computeProjectId, isValidProjectId, registerProject,
  resolveProject, listProjects, listCbmProjects, parseCbmProjectsOutput,
  unregisterProject, projectDir, projectOverlayPath,
} from "../lib/projects.js";

describe("computeProjectId", () => {
  it("returns 16 hex chars", () => { assert.match(computeProjectId("/a/b"), /^[0-9a-f]{16}$/); });
  it("is stable", () => { assert.equal(computeProjectId("/a/b"), computeProjectId("/a/b")); });
  it("differs for different paths", () => { assert.notEqual(computeProjectId("/a"), computeProjectId("/b")); });
});

describe("isValidProjectId", () => {
  it("accepts 16 hex chars", () => { assert.equal(isValidProjectId("0123456789abcdef"), true); });
  it("rejects too short", () => { assert.equal(isValidProjectId("abcd"), false); });
  it("rejects uppercase", () => { assert.equal(isValidProjectId("0123456789ABCDEF"), false); });
  it("rejects path traversal", () => { assert.equal(isValidProjectId("../../victim"), false); });
  it("rejects absolute path", () => { assert.equal(isValidProjectId("/etc/passwd"), false); });
  it("rejects empty", () => { assert.equal(isValidProjectId(""), false); });
  it("rejects non-string", () => { assert.equal(isValidProjectId(null), false); });
});

describe("cbm project candidates", () => {
  it("parses status-prefixed list_projects output", () => {
    const projects = parseCbmProjectsOutput([
      "level=info msg=mem.init",
      JSON.stringify({ projects: [{ name: "demo", root_path: "/tmp/demo", nodes: 12 }] }),
    ].join("\n"));
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, "demo");
  });

  it("parses pretty-printed list_projects JSON after status lines", () => {
    const projects = parseCbmProjectsOutput([
      "level=info msg=mem.init",
      JSON.stringify({ projects: [{ name: "pretty", root_path: "/tmp/pretty" }] }, null, 2),
    ].join("\n"));
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, "pretty");
  });

  it("returns only accessible, deduplicated project roots", { skip: process.platform === "win32" }, async () => {
    const tempDir = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-candidates-"));
    const projectRoot = path.join(tempDir, "demo-project");
    const fakeCbm = path.join(tempDir, "fake-cbm");
    await fsp.mkdir(projectRoot);
    const payload = {
      projects: [
        { name: "demo-index", root_path: projectRoot, nodes: 12, edges: 18, size_bytes: 1024 },
        { name: "duplicate-index", root_path: projectRoot },
        { name: "stale-index", root_path: path.join(tempDir, "missing") },
      ],
    };
    await fsp.writeFile(fakeCbm, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify(payload))});\n`);
    await fsp.chmod(fakeCbm, 0o755);

    try {
      const result = await listCbmProjects(fakeCbm);
      assert.equal(result.ok, true);
      assert.equal(result.projects.length, 1);
      assert.equal(result.projects[0].root, await fsp.realpath(projectRoot));
      assert.equal(result.projects[0].cbmProjectName, "demo-index");
      assert.equal(result.projects[0].nodes, 12);
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe("registerProject — path validation", () => {
  let dataDir;
  beforeEach(async () => { dataDir = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-")); });
  afterEach(async () => { await fsp.rm(dataDir, { recursive: true, force: true }); });

  it("rejects empty projectRoot", async () => {
    assert.equal((await registerProject({ dataDir, projectRoot: "" })).error, "projectRoot_required");
  });

  it("rejects relative path BEFORE resolve", async () => {
    const r = await registerProject({ dataDir, projectRoot: "relative/path" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "projectRoot_must_be_absolute");
  });

  it("rejects non-absolute via ./prefix", async () => {
    const r = await registerProject({ dataDir, projectRoot: "./something" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "projectRoot_must_be_absolute");
  });

  it("rejects nonexistent absolute path", async () => {
    const r = await registerProject({ dataDir, projectRoot: "/nonexistent/x/y/z" });
    assert.equal(r.ok, false);
  });

  it("registers a real directory", async () => {
    const t = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-real-"));
    const r = await registerProject({ dataDir, projectRoot: t });
    assert.equal(r.ok, true);
    assert.equal(r.created, true);
    await fsp.rm(t, { recursive: true, force: true });
  });

  it("is idempotent", async () => {
    const t = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-"));
    const r1 = await registerProject({ dataDir, projectRoot: t });
    const r2 = await registerProject({ dataDir, projectRoot: t });
    assert.equal(r1.projectId, r2.projectId);
    assert.equal(r2.created, false);
    await fsp.rm(t, { recursive: true, force: true });
  });

  it("refreshes a newly added project-local overlay on idempotent registration", async () => {
    const t = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-overlay-refresh-"));
    const first = await registerProject({ dataDir, projectRoot: t });
    assert.equal(first.meta.hasOverlay, false);
    await fsp.mkdir(path.join(t, ".ua"));
    await fsp.writeFile(path.join(t, ".ua", "overlay.json"), JSON.stringify({ version: "1.0.0" }));
    const second = await registerProject({ dataDir, projectRoot: t });
    assert.equal(second.created, false);
    assert.equal(second.meta.hasOverlay, true);
    const copied = JSON.parse(await fsp.readFile(projectOverlayPath(dataDir, first.projectId), "utf-8"));
    assert.equal(copied.version, "1.0.0");
    await fsp.rm(t, { recursive: true, force: true });
  });

  it("refreshes configured cbm cache state on idempotent registration", async () => {
    const t = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-cache-"));
    const r1 = await registerProject({ dataDir, projectRoot: t });
    const r2 = await registerProject({
      dataDir,
      projectRoot: t,
      cbmBinary: "/usr/bin/false",
      cbmCacheDir: "/tmp/cbm-cache",
    });
    assert.equal(r1.meta.usesConfiguredCbmCache, false);
    assert.equal(r2.created, false);
    assert.equal(r2.meta.usesConfiguredCbmCache, true);
    await fsp.rm(t, { recursive: true, force: true });
  });
});

describe("unregisterProject — path traversal guard", () => {
  let dataDir;
  beforeEach(async () => { dataDir = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-")); });
  afterEach(async () => { await fsp.rm(dataDir, { recursive: true, force: true }); });

  it("rejects path traversal projectId", async () => {
    const r = await unregisterProject(dataDir, "../../victim");
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_projectId");
    // Verify the external directory was NOT deleted
    const stat = await fsp.stat(dataDir);
    assert.ok(stat.isDirectory());
  });

  it("rejects absolute path projectId", async () => {
    const r = await unregisterProject(dataDir, "/etc/passwd");
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_projectId");
  });

  it("rejects short garbage", async () => {
    const r = await unregisterProject(dataDir, "abc");
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_projectId");
  });
});

describe("projectDir — no path escape", () => {
  it("returns null for traversal", () => {
    assert.equal(projectDir("/tmp", "../../etc"), null);
  });
  it("returns null for absolute", () => {
    assert.equal(projectDir("/tmp", "/etc/passwd"), null);
  });
  it("returns path for valid id", () => {
    assert.ok(projectDir("/tmp", "0123456789abcdef").includes("0123456789abcdef"));
  });
});

describe("overlay copy failure → hasOverlay=false", () => {
  let dataDir;
  beforeEach(async () => { dataDir = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-")); });
  afterEach(async () => { await fsp.rm(dataDir, { recursive: true, force: true }); });

  it("sets hasOverlay=false when overlay is invalid JSON", async () => {
    const t = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-ov-"));
    const overlayPath = path.join(t, "overlay.json");
    // Write invalid JSON
    await fsp.writeFile(overlayPath, "NOT JSON{{{");
    const r = await registerProject({ dataDir, projectRoot: t, overlayPath });
    assert.equal(r.ok, true);
    assert.equal(r.meta.hasOverlay, false, "hasOverlay must be false when overlay copy fails");
    await fsp.rm(t, { recursive: true, force: true });
  });
});

describe("projectId collision", () => {
  let dataDir;
  beforeEach(async () => { dataDir = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-")); });
  afterEach(async () => { await fsp.rm(dataDir, { recursive: true, force: true }); });

  it("returns project_id_collision when existing.root differs", async () => {
    const t1 = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-c1-"));
    const r1 = await registerProject({ dataDir, projectRoot: t1 });
    assert.equal(r1.ok, true);
    // Manually tamper project.json to have a different root
    const pjPath = path.join(dataDir, "projects", r1.projectId, "project.json");
    const meta = JSON.parse(await fsp.readFile(pjPath, "utf-8"));
    meta.root = "/different/root/path";
    await fsp.writeFile(pjPath, JSON.stringify(meta, null, 2));
    // Now try registering t1 again — same realpath but existing.root differs
    const r2 = await registerProject({ dataDir, projectRoot: t1 });
    assert.equal(r2.ok, false);
    assert.equal(r2.error, "project_id_collision");
    await fsp.rm(t1, { recursive: true, force: true });
  });
});

describe("profileDir uses fileURLToPath", () => {
  it("registerProject works with profileDir resolution", async () => {
    const dataDir = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-"));
    const t = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-prof-"));
    const r = await registerProject({ dataDir, projectRoot: t });
    assert.equal(r.ok, true);
    await fsp.rm(dataDir, { recursive: true, force: true });
    await fsp.rm(t, { recursive: true, force: true });
  });
});
