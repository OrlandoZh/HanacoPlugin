import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fsp from "node:fs/promises";
import {
  promoteBuild, readCurrentPointer, currentBundleDir, validateStaging,
  buildDir, ALLOWED_BUNDLE_NAMES, UA_DATA_FILES, readUaDataFile, readSourcePreviewFile,
} from "../lib/storage.js";
import { registerProject } from "../lib/projects.js";

async function createValidStaging(stagingRoot, withArchitecture = false) {
  const fullUa = path.join(stagingRoot, "full", ".ua");
  await fsp.mkdir(fullUa, { recursive: true });
  await fsp.writeFile(path.join(fullUa, "knowledge-graph.json"), '{"version":"1.0.0","nodes":[],"edges":[],"layers":[],"tour":[]}');
  await fsp.writeFile(path.join(fullUa, "config.json"), '{"autoUpdate":false}');
  await fsp.writeFile(path.join(fullUa, "semantic-meta.json"), '{"version":"1.0.0"}');
  await fsp.writeFile(path.join(fullUa, "source-preview-meta.json"), '{"version":"1.0.0","copiedFiles":0,"files":[]}');
  const spDir = path.join(stagingRoot, "full", "source-preview");
  await fsp.mkdir(spDir, { recursive: true });

  if (withArchitecture) {
    const archUa = path.join(stagingRoot, "architecture", ".ua");
    await fsp.mkdir(archUa, { recursive: true });
    await fsp.writeFile(path.join(archUa, "knowledge-graph.json"), '{"version":"1.0.0","nodes":[],"edges":[],"layers":[],"tour":[]}');
    await fsp.writeFile(path.join(archUa, "config.json"), '{"autoUpdate":false}');
    await fsp.writeFile(path.join(archUa, "overview-meta.json"), '{"version":"1.0.0"}');
    await fsp.writeFile(path.join(archUa, "source-preview-meta.json"), '{"version":"1.0.0","copiedFiles":0,"files":[]}');
    await fsp.mkdir(path.join(stagingRoot, "architecture", "source-preview"), { recursive: true });
  }

  // Pipeline-written build-meta.json (with evidence fields)
  await fsp.writeFile(
    path.join(stagingRoot, "build-meta.json"),
    JSON.stringify({ cbmProjectName: "test-cbm", pipelineVersion: "0.2.0", gitCommitHash: "abc123", nodeCount: 0, edgeCount: 0 })
  );
}

describe("validateStaging", () => {
  it("passes valid full-only", async () => {
    const d = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-"));
    await createValidStaging(d, false);
    const r = await validateStaging(d);
    assert.equal(r.ok, true); assert.equal(r.hasArchitecture, false);
    await fsp.rm(d, { recursive: true, force: true });
  });
  it("passes valid dual", async () => {
    const d = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-"));
    await createValidStaging(d, true);
    const r = await validateStaging(d);
    assert.equal(r.ok, true); assert.equal(r.hasArchitecture, true);
    await fsp.rm(d, { recursive: true, force: true });
  });
  it("fails for missing full", async () => {
    const d = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-"));
    await fsp.mkdir(d, { recursive: true });
    assert.equal((await validateStaging(d)).ok, false);
    await fsp.rm(d, { recursive: true, force: true });
  });
});

describe("promoteBuild", () => {
  let dataDir, tmpProject, projectId;
  beforeEach(async () => {
    dataDir = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-"));
    tmpProject = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-"));
    projectId = (await registerProject({ dataDir, projectRoot: tmpProject })).projectId;
  });
  afterEach(async () => {
    await fsp.rm(dataDir, { recursive: true, force: true });
    await fsp.rm(tmpProject, { recursive: true, force: true });
  });

  it("promotes staging to immutable build", async () => {
    const s = path.join(dataDir, "projects", projectId, "staging", "t1");
    await createValidStaging(s, false);
    const r = await promoteBuild(dataDir, projectId, "build-001", s);
    assert.equal(r.ok, true);
    const b = buildDir(dataDir, projectId, "build-001");
    assert.ok((await fsp.stat(b)).isDirectory());
  });

  it("merges pipeline build-meta.json (preserves evidence)", async () => {
    const s = path.join(dataDir, "projects", projectId, "staging", "t1");
    await createValidStaging(s, false);
    await promoteBuild(dataDir, projectId, "build-001", s);
    const meta = JSON.parse(await fsp.readFile(path.join(buildDir(dataDir, projectId, "build-001"), "build-meta.json"), "utf-8"));
    // Pipeline fields preserved
    assert.equal(meta.cbmProjectName, "test-cbm");
    assert.equal(meta.pipelineVersion, "0.2.0");
    assert.equal(meta.gitCommitHash, "abc123");
    // Promotion fields added
    assert.equal(meta.buildId, "build-001");
    assert.equal(meta.projectId, projectId);
    assert.ok(meta.promotedAt);
  });

  it("writes current.json atomically", async () => {
    const s = path.join(dataDir, "projects", projectId, "staging", "t1");
    await createValidStaging(s, false);
    await promoteBuild(dataDir, projectId, "build-001", s);
    const p = await readCurrentPointer(dataDir, projectId);
    assert.equal(p.buildId, "build-001");
    assert.equal(p.previousBuildId, null);
  });

  it("chains current→previous", async () => {
    const s1 = path.join(dataDir, "projects", projectId, "staging", "t1");
    await createValidStaging(s1, false); await promoteBuild(dataDir, projectId, "b1", s1);
    const s2 = path.join(dataDir, "projects", projectId, "staging", "t2");
    await createValidStaging(s2, false); await promoteBuild(dataDir, projectId, "b2", s2);
    const p = await readCurrentPointer(dataDir, projectId);
    assert.equal(p.buildId, "b2"); assert.equal(p.previousBuildId, "b1");
  });

  it("retains only current+previous", async () => {
    for (const [i, bid] of ["b1","b2","b3"].entries()) {
      const s = path.join(dataDir, "projects", projectId, "staging", "t" + i);
      await createValidStaging(s, false);
      await promoteBuild(dataDir, projectId, bid, s);
    }
    const p = await readCurrentPointer(dataDir, projectId);
    assert.equal(p.buildId, "b3"); assert.equal(p.previousBuildId, "b2");
    let exists = true;
    try { await fsp.stat(buildDir(dataDir, projectId, "b1")); } catch { exists = false; }
    assert.equal(exists, false, "b1 should be deleted");
  });

  it("updates project.json lastBuiltAt + currentBuildId", async () => {
    const s = path.join(dataDir, "projects", projectId, "staging", "t1");
    await createValidStaging(s, false);
    await promoteBuild(dataDir, projectId, "build-001", s);
    const { readProject } = await import("../lib/projects.js");
    const pj = await readProject(dataDir, projectId);
    assert.ok(pj.lastBuiltAt);
    assert.equal(pj.currentBuildId, "build-001");
  });

  it("rejects invalid projectId", async () => {
    const r = await promoteBuild(dataDir, "../../victim", "b1", "/tmp");
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_projectId");
  });
});

describe("ALLOWED_BUNDLE_NAMES", () => {
  it("has full+architecture", () => { assert.ok(ALLOWED_BUNDLE_NAMES.has("full")); assert.ok(ALLOWED_BUNDLE_NAMES.has("architecture")); });
});

describe("UA_DATA_FILES", () => {
  it("includes key files", () => { assert.ok(UA_DATA_FILES.has("knowledge-graph.json")); assert.ok(UA_DATA_FILES.has("source-preview-meta.json")); });
  it("excludes arbitrary", () => { assert.ok(!UA_DATA_FILES.has("evil.json")); });
});

describe("readUaDataFile", () => {
  let dataDir, tmpProject, projectId;
  beforeEach(async () => {
    dataDir = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-"));
    tmpProject = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-"));
    projectId = (await registerProject({ dataDir, projectRoot: tmpProject })).projectId;
    const s = path.join(dataDir, "projects", projectId, "staging", "t");
    await createValidStaging(s, false);
    await promoteBuild(dataDir, projectId, "b-read", s);
  });
  afterEach(async () => {
    await fsp.rm(dataDir, { recursive: true, force: true });
    await fsp.rm(tmpProject, { recursive: true, force: true });
  });
  it("reads knowledge-graph.json", async () => {
    const r = await readUaDataFile(dataDir, projectId, "full", "knowledge-graph.json");
    assert.equal(r.ok, true);
  });
  it("rejects unknown filename", async () => {
    assert.equal((await readUaDataFile(dataDir, projectId, "full", "evil.json")).error, "unknown_data_file");
  });
  it("rejects invalid bundle", async () => {
    assert.equal((await readUaDataFile(dataDir, projectId, "hacked", "knowledge-graph.json")).error, "invalid_bundle");
  });
  it("rejects invalid projectId", async () => {
    assert.equal((await readUaDataFile(dataDir, "../../victim", "full", "knowledge-graph.json")).error, "invalid_projectId");
  });
});

describe("currentBundleDir", () => {
  it("returns null for invalid projectId", async () => {
    assert.equal(await currentBundleDir("/tmp", "../../victim", "full"), null);
  });
});
