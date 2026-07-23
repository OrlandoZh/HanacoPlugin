import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fsp from "node:fs/promises";
import { isPathInside, ensureInsideDir, validateBundle, toToolResult } from "../lib/core.js";

describe("isPathInside", () => {
  it("allows normal relative paths", () => { assert.equal(isPathInside("src/main.ts", "/p"), true); });
  it("rejects path traversal", () => { assert.equal(isPathInside("..", "/p"), false); assert.equal(isPathInside("../etc", "/p"), false); });
  it("rejects absolute paths", () => { assert.equal(isPathInside("/etc/passwd", "/p"), false); });
  it("rejects null bytes", () => { assert.equal(isPathInside("foo\0bar", "/p"), false); });
});

describe("toToolResult", () => {
  it("wraps string data", () => { const r = toToolResult("t", "hi"); assert.ok(r.content[0].text.includes("[code-atlas:t]")); });
  it("wraps object data", () => { const r = toToolResult("t", { ok: true }); assert.ok(r.content[0].text.includes('"ok": true')); });
});

describe("ensureInsideDir", () => {
  it("allows paths inside", async () => {
    const d = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-"));
    const s = path.join(d, "sub"); await fsp.mkdir(s);
    assert.equal((await ensureInsideDir(s, d)).ok, true);
    await fsp.rm(d, { recursive: true, force: true });
  });
  it("rejects non-existent", async () => { assert.equal((await ensureInsideDir("/nope/x", "/tmp")).ok, false); });
});

describe("validateBundle", () => {
  it("fails for missing .ua", async () => {
    const d = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-"));
    assert.equal((await validateBundle(d)).ok, false);
    await fsp.rm(d, { recursive: true, force: true });
  });
  it("succeeds for a structurally valid bundle", async () => {
    const d = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-"));
    const u = path.join(d, ".ua"); await fsp.mkdir(u);
    await fsp.writeFile(path.join(u, "knowledge-graph.json"), '{"nodes":[],"edges":[],"layers":[]}');
    await fsp.writeFile(path.join(u, "config.json"), '{}');
    assert.equal((await validateBundle(d)).ok, true);
    await fsp.rm(d, { recursive: true, force: true });
  });
  it("rejects malformed graphs and dangling edges", async () => {
    const d = await fsp.mkdtemp(path.join(process.env.TMPDIR || "/tmp", "hca-"));
    const u = path.join(d, ".ua"); await fsp.mkdir(u);
    await fsp.writeFile(path.join(u, "knowledge-graph.json"), JSON.stringify({
      nodes: [{ id: "a" }],
      edges: [{ source: "a", target: "missing" }],
      layers: [{ id: "l", nodeIds: ["missing"] }],
    }));
    await fsp.writeFile(path.join(u, "config.json"), '{}');
    const result = await validateBundle(d);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes("dangling edges")));
    assert.ok(result.errors.some((error) => error.includes("dangling layer node refs")));
    await fsp.rm(d, { recursive: true, force: true });
  });
});
