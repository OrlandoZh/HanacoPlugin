import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const skillRoot = path.join(repoRoot, "skills", "obsidian-wiki-manager", "references", "llm-wiki");
process.env.LLM_WIKI_SKILL_ROOT = skillRoot;
process.env.HOME = await fsp.mkdtemp(path.join(os.tmpdir(), "llm-wiki-viewer-home-"));

const {
  buildGraph,
  getStatus,
  initWiki,
  lintWiki,
  runSkillScript,
  rewriteGraphSourcePaths,
  sourceCoverage,
} = await import("../lib/wiki-core.js");
const registerViewerRoutes = (await import("../routes/viewer.js")).default;
const buildGraphTool = await import("../tools/build_graph.js");
const statusTool = await import("../tools/status.js");
const lintTool = await import("../tools/lint.js");
const initTool = await import("../tools/init.js");
const sourceCoverageTool = await import("../tools/source_coverage.js");

test("status identifies non-wiki roots", async () => {
  const dir = await tempDir();
  const status = await getStatus(dir);
  assert.equal(status.ok, false);
  assert.equal(status.schemaExists, false);
  assert.equal(status.wikiDirExists, false);
});

test("init creates Chinese and English wiki roots", async () => {
  const zhRoot = path.join(await tempDir(), "zh-wiki");
  const zh = await initWiki({ wikiRoot: zhRoot, topic: "测试知识库", language: "zh" });
  assert.equal(zh.ok, true, zh.stderr || zh.error);
  assert.equal(fs.existsSync(path.join(zhRoot, ".wiki-schema.md")), true);
  assert.match(await fsp.readFile(path.join(zhRoot, ".wiki-schema.md"), "utf8"), /语言：中文/);

  const enRoot = path.join(await tempDir(), "en-wiki");
  const en = await initWiki({ wikiRoot: enRoot, topic: "Test Wiki", language: "en" });
  assert.equal(en.ok, true, en.stderr || en.error);
  assert.match(await fsp.readFile(path.join(enRoot, ".wiki-schema.md"), "utf8"), /语言：English/);
  assert.match(await fsp.readFile(path.join(enRoot, "index.md"), "utf8"), /Topic: Test Wiki/);
  const overview = await fsp.readFile(path.join(enRoot, "wiki", "overview.md"), "utf8");
  assert.match(overview, /Test Wiki .* Wiki Overview/);
  assert.match(overview, /About this wiki/);
});

test("init refuses initialized and non-empty target directories", async () => {
  const initializedRoot = path.join(await tempDir(), "initialized");
  const init = await initWiki({ wikiRoot: initializedRoot, topic: "Existing", language: "zh" });
  assert.equal(init.ok, true, init.stderr || init.error);
  const existing = await initWiki({ wikiRoot: initializedRoot, topic: "Again", language: "zh" });
  assert.equal(existing.ok, false);
  assert.equal(existing.error, "already_initialized");

  const nonEmptyRoot = await tempDir();
  await fsp.writeFile(path.join(nonEmptyRoot, "notes.md"), "keep me\n", "utf8");
  const nonEmpty = await initWiki({ wikiRoot: nonEmptyRoot, topic: "Unsafe", language: "zh" });
  assert.equal(nonEmpty.ok, false);
  assert.equal(nonEmpty.error, "target_not_empty");

  const emptyRoot = await tempDir();
  const empty = await initWiki({ wikiRoot: emptyRoot, topic: "Empty", language: "zh" });
  assert.equal(empty.ok, true, empty.stderr || empty.error);
  assert.equal(fs.existsSync(path.join(emptyRoot, ".wiki-schema.md")), true);
});

test("lint returns a structured report", async () => {
  const wikiRoot = await createSampleWiki();
  const result = await lintWiki(wikiRoot);
  assert.equal(result.ok, true, result.stderr || result.error);
  assert.match(result.stdout, /llm-wiki lint/);
});

test("buildGraph generates graph data and html", async () => {
  const wikiRoot = await createSampleWiki();
  const result = await buildGraph(wikiRoot);
  assert.equal(result.ok, true, result.stderr || result.error);
  assert.equal(fs.existsSync(path.join(wikiRoot, "wiki", "graph-data.json")), true);
  assert.equal(fs.existsSync(path.join(wikiRoot, "wiki", "knowledge-graph.html")), true);

  const graphData = JSON.parse(await fsp.readFile(path.join(wikiRoot, "wiki", "graph-data.json"), "utf8"));
  assert.ok(graphData.nodes.some((node) => node.id === "Transformer"));
  assert.ok(graphData.edges.some((edge) => edge.from === "Transformer" && edge.to === "Attention"));
});

test("buildGraph rejects non-wiki roots with not_llm_wiki_root", async () => {
  const result = await buildGraph(await tempDir());
  assert.equal(result.ok, false);
  assert.equal(result.error, "not_llm_wiki_root");
});

test("source signal coverage script returns JSON summary", async () => {
  const wikiRoot = await createSampleWiki();
  const result = await sourceCoverage(wikiRoot);
  assert.equal(result.ok, true, result.stderr || result.error);
  const coverage = result.coverage;
  assert.equal(typeof coverage.summary.applicable_total, "number");
  assert.ok(Array.isArray(coverage.pages));
  assert.ok(coverage.pages.some((page) => page.path === "wiki/entities/Transformer.md"));

  const nonWiki = await sourceCoverage(await tempDir());
  assert.equal(nonWiki.ok, false);
  assert.equal(nonWiki.error, "not_llm_wiki_root");
});

test("tools expose content plus structured details", async () => {
  const wikiRoot = await createSampleWiki();
  const status = await statusTool.execute({ wikiRoot });
  assert.equal(status.details.ok, true);
  assert.equal(status.content[0].type, "text");

  const lint = await lintTool.execute({ wikiRoot });
  assert.equal(lint.details.ok, true);
  assert.match(lint.details.stdout, /llm-wiki lint/);

  const build = await buildGraphTool.execute({ wikiRoot });
  assert.equal(build.details.ok, true);
  assert.equal(fs.existsSync(build.details.graphPath), true);

  const initRoot = path.join(await tempDir(), "tool-init");
  const init = await initTool.execute({ wikiRoot: initRoot, topic: "Tool Init", language: "en" });
  assert.equal(init.details.ok, true);
  assert.match(await fsp.readFile(path.join(initRoot, ".wiki-schema.md"), "utf8"), /语言：English/);

  const coverage = await sourceCoverageTool.execute({ wikiRoot });
  assert.equal(coverage.details.ok, true);
  assert.equal(typeof coverage.details.coverage.summary.applicable_total, "number");

  const nonWikiCoverage = await sourceCoverageTool.execute({ wikiRoot: await tempDir() });
  assert.equal(nonWikiCoverage.details.ok, false);
  assert.equal(nonWikiCoverage.details.error, "not_llm_wiki_root");
});

test("rewriteGraphSourcePaths rewrites wiki-local markdown links only", () => {
  const wikiRoot = "/tmp/demo-wiki";
  const wikiDir = path.join(wikiRoot, "wiki");
  const html = '<script id="graph-data" type="application/json">{"nodes":[{"source_path":"/tmp/demo-wiki/wiki/entities/A.md"},{"source_path":"/tmp/outside.md"}]}</script>';
  const rewritten = rewriteGraphSourcePaths(html, wikiRoot, wikiDir, "/wiki-file/", "?token=t");
  assert.ok(rewritten.includes('"source_path": "/wiki-file/entities/A.md?token=t"'));
  assert.ok(rewritten.includes('"source_path": "/tmp/outside.md"'));
});

test("viewer API routes return expected failure status codes", async () => {
  const routes = registerRoutesForTest();

  const nonWikiRoot = await tempDir();
  const build = await routes.post("/api/build", { wikiRoot: nonWikiRoot });
  assert.equal(build.status, 422);
  assert.equal(build.body.error, "not_llm_wiki_root");

  const lint = await routes.post("/api/lint", { wikiRoot: nonWikiRoot });
  assert.equal(lint.status, 422);
  assert.equal(lint.body.error, "not_llm_wiki_root");

  const initializedRoot = path.join(await tempDir(), "initialized");
  const init = await initWiki({ wikiRoot: initializedRoot, topic: "Existing", language: "zh" });
  assert.equal(init.ok, true, init.stderr || init.error);
  const already = await routes.post("/api/init", { wikiRoot: initializedRoot, topic: "Again", language: "zh" });
  assert.equal(already.status, 409);
  assert.equal(already.body.error, "already_initialized");

  const nonEmptyRoot = await tempDir();
  await fsp.writeFile(path.join(nonEmptyRoot, "notes.md"), "keep me\n", "utf8");
  const nonEmpty = await routes.post("/api/init", { wikiRoot: nonEmptyRoot, topic: "Unsafe", language: "zh" });
  assert.equal(nonEmpty.status, 409);
  assert.equal(nonEmpty.body.error, "target_not_empty");
});

async function createSampleWiki() {
  const wikiRoot = path.join(await tempDir(), "sample-wiki");
  const init = await initWiki({ wikiRoot, topic: "Sample Wiki", language: "zh" });
  assert.equal(init.ok, true, init.stderr || init.error);

  await fsp.writeFile(path.join(wikiRoot, "wiki", "entities", "Transformer.md"), [
    "# Transformer",
    "",
    "Transformer 使用 [[Attention]]，也关联 [[Architecture]]。",
    "",
  ].join("\n"), "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "entities", "Attention.md"), [
    "# Attention",
    "",
    "Attention 是 [[Transformer]] 的核心机制。",
    "",
  ].join("\n"), "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "topics", "Architecture.md"), [
    "# Architecture",
    "",
    "架构主题连接 [[Transformer]]。",
    "",
  ].join("\n"), "utf8");
  await fsp.writeFile(path.join(wikiRoot, "index.md"), [
    "# Sample Wiki",
    "",
    "- [[Transformer]]",
    "- [[Attention]]",
    "- [[Architecture]]",
    "",
  ].join("\n"), "utf8");
  return wikiRoot;
}

async function tempDir() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "llm-wiki-viewer-"));
}

function registerRoutesForTest() {
  const handlers = { get: new Map(), post: new Map() };
  const app = {
    get(pathname, handler) { handlers.get.set(pathname, handler); },
    post(pathname, handler) { handlers.post.set(pathname, handler); },
  };
  const ctx = {
    pluginId: "llm-wiki-viewer",
    config: { async get() { return ""; } },
  };
  registerViewerRoutes(app, ctx);

  return {
    async post(pathname, body = {}) {
      const handler = handlers.post.get(pathname);
      assert.ok(handler, `Missing POST route ${pathname}`);
      return handler(createContext(body));
    },
  };
}

function createContext(body = {}) {
  return {
    req: {
      async json() { return body; },
      query() { return ""; },
      param() { return ""; },
      path: "",
    },
    json(value, status = 200) {
      return { body: value, status };
    },
    text(value, status = 200) {
      return { body: value, status };
    },
  };
}
