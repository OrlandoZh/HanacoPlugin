import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pluginRoot, "..", "..");
const skillRoot = path.join(repoRoot, "skills", "obsidian-wiki-manager", "references", "llm-wiki");
process.env.LLM_WIKI_SKILL_ROOT = skillRoot;
process.env.HOME = await fsp.mkdtemp(path.join(os.tmpdir(), "llm-wiki-viewer-home-"));

const {
  adapterClassify,
  applyGraphPanelControls,
  applyGraphTheme,
  adapterStatus,
  buildGraph,
  buildAgentWorkflowPrompt,
  cacheStatus,
  deleteDryRun,
  diagnostics,
  getSavedWikiRoots,
  getStatus,
  graphSourcePaths,
  initWiki,
  listHanaAgents,
  listHanaSessions,
  linkDiagnostics,
  lintFixPreview,
  maintenanceDiagnostics,
  normalizeAgentDeliveryMode,
  sourceRegistry,
  sourceRegistryLookup,
  lintWiki,
  normalizeAgentWorkflowAction,
  parseTsv,
  removeSavedWikiRoot,
  rememberWikiRoot,
  resolveOpenFolderTarget,
  runtimeContextStatus,
  runSkillScript,
  saveWikiRoot,
  sendHanaAgentWorkflow,
  rewriteGraphSourcePaths,
  sourceCoverage,
  sourceContractDiagnostics,
  sourceImageDiagnostics,
  sourcePageContractPreview,
  sourceSignalEligibility,
  validateStep1,
} = await import("../lib/wiki-core.js");
const adapterClassifyTool = await import("../tools/adapter_classify.js");
const adapterStatusTool = await import("../tools/adapter_status.js");
const registerViewerRoutes = (await import("../routes/viewer.js")).default;
const buildGraphTool = await import("../tools/build_graph.js");
const cacheStatusTool = await import("../tools/cache_status.js");
const deleteDryRunTool = await import("../tools/delete_dry_run.js");
const diagnosticsTool = await import("../tools/diagnostics.js");
const graphSourcePathsTool = await import("../tools/graph_source_paths.js");
const linkDiagnosticsTool = await import("../tools/link_diagnostics.js");
const maintenanceDiagnosticsTool = await import("../tools/maintenance_diagnostics.js");
const statusTool = await import("../tools/status.js");
const lintTool = await import("../tools/lint.js");
const lintFixPreviewTool = await import("../tools/lint_fix_preview.js");
const initTool = await import("../tools/init.js");
const sourceCoverageTool = await import("../tools/source_coverage.js");
const sourceContractDiagnosticsTool = await import("../tools/source_contract_diagnostics.js");
const sourceGetTool = await import("../tools/source_get.js");
const sourceImageDiagnosticsTool = await import("../tools/source_image_diagnostics.js");
const sourceMatchFileTool = await import("../tools/source_match_file.js");
const sourceMatchUrlTool = await import("../tools/source_match_url.js");
const sourceRegistryTool = await import("../tools/source_registry.js");
const sourceSignalEligibilityTool = await import("../tools/source_signal_eligibility.js");
const sourcePageContractPreviewTool = await import("../tools/source_page_contract_preview.js");
const runtimeContextStatusTool = await import("../tools/runtime_context_status.js");
const validateStep1Tool = await import("../tools/validate_step1.js");

test("status identifies non-wiki roots", async () => {
  const dir = await tempDir();
  const status = await getStatus(dir);
  assert.equal(status.ok, false);
  assert.equal(status.schemaExists, false);
  assert.equal(status.wikiDirExists, false);
});

test("saved wiki roots persist through plugin config", async () => {
  const config = createMemoryConfig({ defaultWikiRoot: "~/first", savedWikiRoots: ["~/second", "~/first"] });
  const ctx = { config };
  const first = path.join(process.env.HOME, "first");
  const second = path.join(process.env.HOME, "second");
  assert.deepEqual(await getSavedWikiRoots(ctx), [first, second]);

  const third = path.join(await tempDir(), "third");
  const saved = await saveWikiRoot(ctx, third);
  assert.equal(saved.ok, true, saved.stderr || saved.error);
  assert.equal(saved.defaultWikiRoot, third);
  assert.deepEqual(saved.savedWikiRoots.slice(0, 3), [third, first, second]);
  assert.equal(await config.get("defaultWikiRoot"), third);

  const lastOnly = path.join(await tempDir(), "last-only");
  const remembered = await rememberWikiRoot(ctx, lastOnly);
  assert.equal(remembered.ok, true, remembered.stderr || remembered.error);
  assert.equal(remembered.defaultWikiRoot, lastOnly);
  assert.equal(await config.get("defaultWikiRoot"), lastOnly);
  assert.deepEqual(await getSavedWikiRoots(ctx), [lastOnly, third, first, second]);

  const removed = await removeSavedWikiRoot(ctx, third);
  assert.equal(removed.ok, true, removed.stderr || removed.error);
  assert.deepEqual(removed.savedWikiRoots, [lastOnly, first, second]);
  assert.equal(removed.defaultWikiRoot, lastOnly);
});

test("open folder target resolves directories, files, and missing children", async () => {
  const dir = await tempDir();
  const directory = await resolveOpenFolderTarget(dir);
  assert.equal(directory.ok, true);
  assert.equal(directory.targetPath, dir);
  assert.equal(directory.targetType, "directory");

  const file = path.join(dir, "same-name-file");
  await fsp.writeFile(file, "", "utf8");
  const fileTarget = await resolveOpenFolderTarget(file);
  assert.equal(fileTarget.ok, true);
  assert.equal(fileTarget.targetPath, file);
  assert.equal(fileTarget.targetType, "file");

  const missing = path.join(dir, "missing", "wiki");
  const parentTarget = await resolveOpenFolderTarget(missing);
  assert.equal(parentTarget.ok, true);
  assert.equal(parentTarget.targetPath, dir);
  assert.equal(parentTarget.targetType, "parent");
  assert.equal(parentTarget.missingPath, missing);
});

test("saved wiki roots fall back to plugin data when config schema rejects new field", async () => {
  const dataDir = await tempDir();
  const config = createMemoryConfig({}, { rejectKeys: ["savedWikiRoots"] });
  const ctx = { config, dataDir };
  const wikiRoot = path.join(await tempDir(), "fallback-root");

  const saved = await saveWikiRoot(ctx, wikiRoot);
  assert.equal(saved.ok, true, saved.stderr || saved.error);
  assert.equal(await config.get("defaultWikiRoot"), wikiRoot);
  assert.deepEqual(await getSavedWikiRoots(ctx), [wikiRoot]);
  const rootsFile = path.join(dataDir, "wiki-roots.json");
  assert.equal(fs.existsSync(rootsFile), true);

  const removed = await removeSavedWikiRoot(ctx, wikiRoot);
  assert.equal(removed.ok, true, removed.stderr || removed.error);
  assert.deepEqual(removed.savedWikiRoots, []);
  assert.deepEqual(await getSavedWikiRoots(ctx), []);
  assert.doesNotMatch(await fsp.readFile(rootsFile, "utf8"), new RegExp(escapeRegExp(wikiRoot)));
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

  const fileTarget = path.join(await tempDir(), "same-name-file");
  await fsp.writeFile(fileTarget, "", "utf8");
  const notDirectory = await initWiki({ wikiRoot: fileTarget, topic: "Unsafe", language: "zh" });
  assert.equal(notDirectory.ok, false);
  assert.equal(notDirectory.error, "target_not_directory");

  const emptyRoot = await tempDir();
  const empty = await initWiki({ wikiRoot: emptyRoot, topic: "Empty", language: "zh" });
  assert.equal(empty.ok, true, empty.stderr || empty.error);
  assert.equal(fs.existsSync(path.join(emptyRoot, ".wiki-schema.md")), true);
});

test("lint returns a structured report", async () => {
  const wikiRoot = await createSampleWiki();
  await buildGraph(wikiRoot);
  const result = await lintWiki(wikiRoot);
  assert.equal(result.ok, true, result.stderr || result.error);
  assert.match(result.stdout, /llm-wiki lint/);
  assert.doesNotMatch(result.stdout, /\[\[document\.documentElement\]\]/);
  assert.doesNotMatch(result.stdout, /\[\[素材摘要\]\]/);
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

test("graph HTML keeps selected upstream UI regression contracts", async () => {
  const wikiRoot = await createSampleWiki();
  const result = await buildGraph(wikiRoot);
  assert.equal(result.ok, true, result.stderr || result.error);

  const wikiDir = path.join(wikiRoot, "wiki");
  const htmlPath = path.join(wikiDir, "knowledge-graph.html");
  const washPath = path.join(wikiDir, "graph-wash.js");
  const helperPath = path.join(wikiDir, "graph-wash-helpers.js");
  const html = await fsp.readFile(htmlPath, "utf8");
  const wash = await fsp.readFile(washPath, "utf8");
  const helpers = await fsp.readFile(helperPath, "utf8");

  for (const needle of [
    'button:focus-visible,',
    'input:focus-visible,',
    'id="app"',
    'class="topbar"',
    'class="sidebar"',
    'class="canvas-card"',
    'class="canvas-footer"',
    'class="drawer" id="drawer"',
    'id="node-layer"',
    'id="edge-layer"',
    "国风知识库·数字山水图",
    "文献索引",
    "社区",
    "聚焦",
    "关系置信度",
    "直接提取",
    "推断关联",
    "存在歧义",
    "未核实",
    'data-visual-role="landmark"',
    'data-visual-role="index-slip"',
    'data-visual-role="cinnabar-note"',
    ".node.is-preview-start",
    '.start-card[data-preview-start="true"]',
    '.drawer[data-state="start-preview"]',
    ".queue-item__marker",
    ".mini-map .mini-map-viewport",
    'id="fit-view"',
    "回到全图",
    'id="toggle-dim"',
    "弱化未选中",
    'class="state-dock"',
    'class="search-box"',
    'id="search"',
    "搜索节点、来源或主题",
    'id="no-results"',
    "@media (max-width: 900px)",
    "mobile-atlas-preview",
    "min-height: 44px;",
    ".app[data-reading=\"1\"]",
    ".node-name {",
    ".queue-item__copy strong",
    "text-overflow: ellipsis;",
    "overflow-wrap: anywhere;",
    "word-break: break-word;",
    'id="minimap"',
    'id="mini-map-svg"',
    "小地图",
    "方位图",
    "mini-map-viewport",
    'class="insight"',
    'id="insight-title"',
    'id="insight-copy"',
    '@media (prefers-reduced-motion: reduce) {',
    'id="neighbor-details"',
    'id="neighbor-list"',
    'data-collapsed="1"',
  ]) {
    assert.ok(html.includes(needle), `HTML should contain ${needle}`);
  }

  for (const needle of [
    "cdn.jsdelivr.net",
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    "sample-data.js",
    "vis-network.min.js",
    'id="nav-panel"',
    'id="mode-switch"',
    'id="nav-close"',
    'id="secondary-panel"',
    'id="dr-close"',
    "学习驾驶舱",
  ]) {
    assert.ok(!html.includes(needle), `HTML should not contain ${needle}`);
  }

  for (const needle of [
    'const dataEl = document.getElementById("graph-data");',
    "JSON.parse(dataEl.textContent)",
    "window.SAMPLE_GRAPH",
    'DOMPurify.sanitize(html, { ADD_ATTR: ["target", "data-target", "tabindex"] });',
    "buildAtlasModel(DATA)",
    "deriveAtlasLayout(atlasModel)",
    "resolveAtlasVisibleSnapshot(state.atlasModel, state.atlasLayout, state.ui)",
    "function getPreviewStartEntry",
    "function nodeVisualRole(node, displayMode, previewNodeId)",
    "dataset.visualRole",
    "dataset.previewStart",
    "drawer.dataset.state",
    "从这里开始",
    "focusNode(previewEntry.node.id, true)",
    'getElementById("fit-view")',
    'getElementById("toggle-dim")',
    "function setupViewportInteractions()",
    "function fitVisibleViewport()",
    "setupSearch",
    'getElementById("search")',
    "state.ui.query",
    "renderAtlasView()",
    "button.title = node.label;",
    "dataset.densityMode",
    "queue-item",
    "function renderMinimap()",
    "function setupMinimapNavigation()",
    'getElementById("mini-map-svg")',
    "renderInsights()",
    "edgeStrokeWidth(edge)",
    "edgeOpacity(edge)",
    "edgeStrengthSize(edge)",
    "drawerNeighborsHeading.addEventListener(\"keydown\", (e) => {",
    "function currentDensityMode()",
    "point-plus-focus",
    "overview",
  ]) {
    assert.ok(wash.includes(needle), `graph-wash.js should contain ${needle}`);
  }

  for (const needle of [
    "importantNodeIds",
    "startNodeIds",
    "function zoomAtlasViewport(viewport, factor, screenPoint, viewportSize, options)",
    "function atlasViewportRect(viewport, viewportSize)",
    "function getAtlasDensityMode(count)",
    "function atlasLabelBudget(mode, count)",
    "function atlasEdgeBudget(mode, count)",
  ]) {
    assert.ok(helpers.includes(needle), `graph-wash-helpers.js should contain ${needle}`);
  }

  assert.ok(html.indexOf("graph-wash-helpers.js") < html.indexOf('src="graph-wash.js"'), "helpers should load before graph-wash.js");
});

test("buildGraph rejects non-wiki roots with not_llm_wiki_root", async () => {
  const result = await buildGraph(await tempDir());
  assert.equal(result.ok, false);
  assert.equal(result.error, "not_llm_wiki_root");
});

test("build graph data keeps upstream confidence merge contract", async () => {
  const wikiRoot = await tempDir();
  await fsp.mkdir(path.join(wikiRoot, "wiki", "entities"), { recursive: true });
  await fsp.writeFile(path.join(wikiRoot, "purpose.md"), "# 研究目的\ntest\n", "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "entities", "A.md"), [
    "---",
    "tags: [test]",
    "---",
    "",
    "# A",
    "",
    "正文中提到 [[B]] 是一个相关的模块。",
    "",
    "## 相关页面",
    "",
    "- [[B]] <!-- confidence: INFERRED --> - 推断关联",
    "",
  ].join("\n"), "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "entities", "B.md"), [
    "---",
    "tags: [test]",
    "---",
    "",
    "# B",
    "",
    "## 相关页面",
    "",
    "- [[A]] <!-- confidence: INFERRED --> - 推断关联",
    "",
  ].join("\n"), "utf8");

  const outputPath = path.join(wikiRoot, "graph-data.json");
  const result = await runSkillScript("build-graph-data.sh", [wikiRoot, outputPath], {
    env: { LLM_WIKI_TEST_MODE: "1" },
  });
  assert.equal(result.ok, true, result.stderr || result.error);

  const graph = JSON.parse(await fsp.readFile(outputPath, "utf8"));
  const aToB = graph.edges.find((edge) => edge.from === "A" && edge.to === "B");
  const bToA = graph.edges.find((edge) => edge.from === "B" && edge.to === "A");
  assert.equal(aToB?.type, "INFERRED");
  assert.equal(bToA?.type, "INFERRED");
});

test("build graph data keeps first explicit confidence among mixed annotations", async () => {
  const wikiRoot = await tempDir();
  await fsp.mkdir(path.join(wikiRoot, "wiki", "entities"), { recursive: true });
  await fsp.writeFile(path.join(wikiRoot, "purpose.md"), "# 研究目的\ntest\n", "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "entities", "M.md"), [
    "---",
    "tags: [test]",
    "---",
    "",
    "# M",
    "",
    "See [[N]] <!-- confidence: INFERRED --> in the body.",
    "",
    "## 相关页面",
    "",
    "- [[N]] <!-- confidence: AMBIGUOUS --> - should not override INFERRED",
    "",
  ].join("\n"), "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "entities", "N.md"), [
    "---",
    "tags: [test]",
    "---",
    "",
    "# N",
    "",
    "## 相关页面",
    "",
    "- [[M]]",
    "",
  ].join("\n"), "utf8");

  const outputPath = path.join(wikiRoot, "graph-data.json");
  const result = await runSkillScript("build-graph-data.sh", [wikiRoot, outputPath], {
    env: { LLM_WIKI_TEST_MODE: "1" },
  });
  assert.equal(result.ok, true, result.stderr || result.error);

  const graph = JSON.parse(await fsp.readFile(outputPath, "utf8"));
  const mToN = graph.edges.find((edge) => edge.from === "M" && edge.to === "N");
  assert.equal(mToN?.type, "INFERRED");
});

test("graph analysis helper computes source overlap and reports invalid JSON", async () => {
  const dir = await tempDir();
  const entityDir = path.join(dir, "wiki", "entities");
  await fsp.mkdir(entityDir, { recursive: true });
  await fsp.writeFile(path.join(entityDir, "A.md"), [
    "---",
    "sources: [same.pdf]",
    "---",
    "",
    "# A",
    "",
    "[[B]]",
    "",
  ].join("\n"), "utf8");
  await fsp.writeFile(path.join(entityDir, "B.md"), [
    "---",
    "sources:",
    "  - same.pdf",
    "---",
    "",
    "# B",
    "",
    "[[A]]",
    "",
  ].join("\n"), "utf8");
  await fsp.writeFile(path.join(entityDir, "C.md"), "# C\n\n[[A]]\n", "utf8");

  const nodesPath = path.join(dir, "nodes.json");
  const edgesPath = path.join(dir, "edges.json");
  const outputPath = path.join(dir, "out.json");
  await fsp.writeFile(nodesPath, JSON.stringify([
    { id: "A", label: "A", type: "entity", source_path: path.join(entityDir, "A.md") },
    { id: "B", label: "B", type: "entity", source_path: path.join(entityDir, "B.md") },
    { id: "C", label: "C", type: "entity", source_path: path.join(entityDir, "C.md") },
  ], null, 2), "utf8");
  await fsp.writeFile(edgesPath, JSON.stringify([
    { id: "e1", from: "A", to: "B", type: "EXTRACTED" },
    { id: "e2", from: "B", to: "A", type: "EXTRACTED" },
    { id: "e3", from: "C", to: "A", type: "EXTRACTED" },
  ], null, 2), "utf8");

  const result = await runSkillScript("graph-analysis.js", [nodesPath, edgesPath, outputPath, "0", "500", "250", "1000"]);
  assert.equal(result.ok, true, result.stderr || result.error);

  const analyzed = JSON.parse(await fsp.readFile(outputPath, "utf8"));
  const aToB = analyzed.edges.find((edge) => edge.from === "A" && edge.to === "B");
  const cToA = analyzed.edges.find((edge) => edge.from === "C" && edge.to === "A");
  assert.equal(aToB.weight, 0.667);
  assert.equal(aToB.source_signal_available, true);
  assert.equal(aToB.signals.source_overlap, 1);
  assert.equal(cToA.weight, 0.5);
  assert.equal(cToA.source_signal_available, false);
  assert.equal(cToA.signals.source_overlap, null);

  const badPath = path.join(dir, "bad.json");
  await fsp.writeFile(badPath, "not json", "utf8");
  const bad = await runSkillScript("graph-analysis.js", [badPath, edgesPath, path.join(dir, "bad-out.json"), "0", "500", "250", "1000"]);
  assert.equal(bad.ok, false);
  assert.match([bad.stderr, bad.stdout, bad.error].join("\n"), /Invalid JSON/);
});

test("status identifies purpose and Mermaid graph files", async () => {
  const wikiRoot = await createSampleWiki();
  await fsp.writeFile(path.join(wikiRoot, "wiki", "knowledge-graph.md"), "graph LR\nA-->B\n", "utf8");
  const status = await getStatus(wikiRoot);
  assert.equal(status.ok, true);
  assert.equal(status.purposeExists, true);
  assert.equal(status.purposePath, path.join(wikiRoot, "purpose.md"));
  assert.equal(status.mermaidGraphExists, true);
  assert.equal(status.mermaidGraphPath, path.join(wikiRoot, "wiki", "knowledge-graph.md"));
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

test("source signal eligibility reports page-level source signal readiness", async () => {
  const wikiRoot = await createSampleWiki();
  await fsp.mkdir(path.join(wikiRoot, "wiki", "comparisons"), { recursive: true });
  await fsp.writeFile(path.join(wikiRoot, "wiki", "comparisons", "Bad.md"), [
    "---",
    "sources: [",
    "---",
    "# Bad",
    "",
  ].join("\n"), "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "topics", "Eligible.md"), [
    "---",
    "sources:",
    "  - wiki/sources/sample.md",
    "---",
    "# Eligible",
    "",
  ].join("\n"), "utf8");

  const result = await sourceSignalEligibility(wikiRoot);
  assert.equal(result.ok, false);
  assert.equal(result.summary.applicable >= 4, true);
  assert.equal(result.summary.eligible >= 1, true);
  assert.equal(result.summary.invalidSources, 1);
  assert.ok(result.pages.some((page) => page.path === "wiki/topics/Eligible.md" && page.eligible));
  assert.ok(result.pages.some((page) => page.path === "wiki/comparisons/Bad.md" && page.reason === "invalid_sources"));

  const tool = await sourceSignalEligibilityTool.execute({ wikiRoot });
  assert.equal(tool.details.summary.invalidSources, 1);

  const nonWiki = await sourceSignalEligibility(await tempDir());
  assert.equal(nonWiki.ok, false);
  assert.equal(nonWiki.error, "not_llm_wiki_root");
});

test("runtime context status reports skill layout and missing checks read-only", async () => {
  const wikiRoot = await createSampleWiki();
  const result = await runtimeContextStatus(wikiRoot);
  assert.equal(result.ok, true, result.stderr || result.error);
  assert.equal(result.layoutMode, "installed_skill");
  assert.equal(result.checks.skillRootExists, true);
  assert.equal(result.checks.runtimeContextExists, true);
  assert.equal(result.summary.missing, 0);

  const tool = await runtimeContextStatusTool.execute({ wikiRoot });
  assert.equal(tool.details.ok, true);
  assert.equal(tool.details.summary.layoutMode, "installed_skill");

  const nonWiki = await runtimeContextStatus(await tempDir());
  assert.equal(nonWiki.ok, false);
  assert.equal(nonWiki.error, "not_llm_wiki_root");
});

test("source registry parses TSV into structured sources", async () => {
  const parsed = parseTsv("id\tlabel\none\tOne\ntwo\tTwo\n");
  assert.deepEqual(parsed, [{ id: "one", label: "One" }, { id: "two", label: "Two" }]);

  const registry = await sourceRegistry();
  assert.equal(registry.ok, true, registry.stderr || registry.error);
  assert.ok(registry.sources.some((source) => source.source_category === "core_builtin"));
  assert.ok(registry.sources.some((source) => source.source_category === "optional_adapter"));
  assert.ok(registry.sources.some((source) => source.source_category === "manual_only"));
  assert.ok(registry.counts.core_builtin >= 1);
});

test("source registry lookup wraps get and match commands", async () => {
  const get = await sourceRegistryLookup("get", "plain_text");
  assert.equal(get.ok, true, get.stderr || get.error);
  assert.equal(get.source.source_id, "plain_text");

  const url = await sourceRegistryLookup("match-url", "https://example.com/post");
  assert.equal(url.ok, true, url.stderr || url.error);
  assert.equal(url.source.input_mode, "url");

  const file = await sourceRegistryLookup("match-file", "notes.pdf");
  assert.equal(file.ok, true, file.stderr || file.error);
  assert.equal(file.source.input_mode, "file");

  const missing = await sourceRegistryLookup("get", "missing_source");
  assert.equal(missing.ok, false);
  assert.notEqual(missing.code, 0);
});

test("adapter status wraps summary and single-source checks", async () => {
  const summary = await adapterStatus();
  assert.equal(typeof summary.stdout, "string");
  assert.equal(summary.code, 0, summary.stderr || summary.error);

  const check = await adapterStatus({ sourceId: "plain_text" });
  assert.equal(check.ok, true, check.stderr || check.error);
  assert.ok(Array.isArray(check.adapters));
  assert.equal(check.adapters[0].source_id, "plain_text");

  const unknown = await adapterStatus({ sourceId: "missing_source" });
  assert.equal(unknown.ok, false);
  assert.notEqual(unknown.code, 0);
});

test("adapter classify wraps classify-run diagnostics", async () => {
  const outputPath = path.join(await tempDir(), "adapter-output.txt");
  await fsp.writeFile(outputPath, "extracted body\n", "utf8");
  const result = await adapterClassify({ sourceId: "plain_text", exitCode: 0, outputPath });
  assert.equal(result.ok, true, result.stderr || result.error);
  assert.equal(result.adapters[0].source_id, "plain_text");
  assert.equal(result.adapters[0].state, "available");

  const bad = await adapterClassify({ sourceId: "plain_text", exitCode: "nope", outputPath });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "exitCode_required");
});

test("diagnostics summarizes wiki counts, coverage, adapters, and warnings", async () => {
  const wikiRoot = await createSampleWiki();
  await fsp.mkdir(path.join(wikiRoot, "raw", "notes"), { recursive: true });
  await fsp.writeFile(path.join(wikiRoot, "raw", "notes", "sample.txt"), "raw\n", "utf8");
  const result = await diagnostics(wikiRoot);
  assert.equal(result.ok, true, result.stderr || result.error);
  assert.equal(result.counts.rawFiles, 1);
  assert.equal(result.counts.entities, 2);
  assert.equal(result.counts.topics, 1);
  assert.equal(typeof result.coverageSummary.applicable_total, "number");
  assert.equal(typeof result.eligibilitySummary.applicable, "number");
  assert.equal(typeof result.runtimeContextSummary.missing, "number");
  assert.equal(typeof result.adapterSummary.total, "number");
  assert.ok(result.warnings.includes("graph_data_missing"));
  assert.equal(result.graphContractSummary.graphDataExists, false);
  assert.equal(result.graphContractSummary.graphHtmlExists, false);
  assert.equal(result.graphContractSummary.ok, false);
  assert.ok(result.warnings.includes("graph_contract_issues"));

  await buildGraph(wikiRoot);
  const built = await diagnostics(wikiRoot);
  assert.equal(built.ok, true, built.stderr || built.error);
  assert.equal(built.graphContractSummary.graphDataExists, true);
  assert.equal(built.graphContractSummary.graphHtmlExists, true);
  assert.equal(built.graphContractSummary.graphDataValid, true);
  assert.equal(built.graphContractSummary.graphHtmlReadable, true);
  assert.equal(built.graphContractSummary.hasSearchUi, true);
  assert.equal(built.graphContractSummary.hasToolbar, true);
  assert.equal(built.graphContractSummary.hasMinimap, true);
  assert.equal(typeof built.linkSummary.brokenLinks, "number");
  assert.equal(typeof built.graphSourcePathSummary.missingSourcePath, "number");

  const nonWiki = await diagnostics(await tempDir());
  assert.equal(nonWiki.ok, false);
  assert.equal(nonWiki.error, "not_llm_wiki_root");
});

test("delete dry-run lists source references without deleting files", async () => {
  const wikiRoot = await createSampleWiki();
  await fsp.writeFile(path.join(wikiRoot, "wiki", "sources", "sample.md"), [
    "---",
    "source_path: raw/notes/sample.txt",
    "---",
    "# Sample",
    "",
  ].join("\n"), "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "entities", "Transformer.md"), [
    "# Transformer",
    "",
    "source: raw/notes/sample.txt",
    "",
  ].join("\n"), "utf8");

  const result = await deleteDryRun({ wikiRoot, sourceFile: "raw/notes/sample.txt" });
  assert.equal(result.ok, true, result.stderr || result.error);
  assert.ok(result.references.includes("wiki/entities/Transformer.md"));
  assert.ok(fs.existsSync(path.join(wikiRoot, "wiki", "entities", "Transformer.md")));

  const nonWiki = await deleteDryRun({ wikiRoot: await tempDir(), sourceFile: "sample.txt" });
  assert.equal(nonWiki.ok, false);
  assert.equal(nonWiki.error, "not_llm_wiki_root");
});

test("link diagnostics reports broken links, orphans, and duplicate titles", async () => {
  const wikiRoot = await createSampleWiki();
  await fsp.mkdir(path.join(wikiRoot, "wiki", "misc"), { recursive: true });
  await fsp.writeFile(path.join(wikiRoot, "wiki", "entities", "Duplicate.md"), "# Duplicate\n", "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "topics", "Duplicate.md"), "# Duplicate\n", "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "topics", "Broken.md"), "# Broken\n[[Missing Page]]\n", "utf8");

  const result = await linkDiagnostics(wikiRoot);
  assert.equal(result.ok, true, result.stderr || result.error);
  assert.ok(result.summary.brokenLinks >= 1);
  assert.ok(result.brokenLinks.some((link) => link.target === "Missing Page"));
  assert.ok(result.duplicateTitles.some((item) => item.title === "duplicate"));
  assert.ok(result.orphanPages.includes("wiki/topics/Broken.md"));

  const nonWiki = await linkDiagnostics(await tempDir());
  assert.equal(nonWiki.ok, false);
  assert.equal(nonWiki.error, "not_llm_wiki_root");
});

test("link diagnostics ignores seed overview navigation placeholders", async () => {
  const wikiRoot = path.join(await tempDir(), "seed-wiki");
  const init = await initWiki({ wikiRoot, topic: "Seed Wiki", language: "zh" });
  assert.equal(init.ok, true, init.stderr || init.error);
  const result = await linkDiagnostics(wikiRoot);
  assert.equal(result.ok, true, result.stderr || result.error);
  assert.equal(result.summary.brokenLinks, 0);
  assert.equal(result.brokenLinks.length, 0);
  assert.equal(result.orphanPages.includes("wiki/overview.md"), false);
});

test("graph source path diagnostics reports missing graph source files", async () => {
  const wikiRoot = await createSampleWiki();
  await buildGraph(wikiRoot);
  const healthy = await graphSourcePaths(wikiRoot);
  assert.equal(healthy.ok, true, healthy.stderr || healthy.error);
  assert.equal(healthy.summary.missingFiles, 0);

  const graphPath = path.join(wikiRoot, "wiki", "graph-data.json");
  const graph = JSON.parse(await fsp.readFile(graphPath, "utf8"));
  graph.nodes.push({ id: "Missing", label: "Missing", source_path: path.join(wikiRoot, "wiki", "entities", "Missing.md") });
  await fsp.writeFile(graphPath, JSON.stringify(graph, null, 2), "utf8");
  const missing = await graphSourcePaths(wikiRoot);
  assert.equal(missing.ok, false);
  assert.equal(missing.summary.missingFiles, 1);

  const noGraph = await graphSourcePaths(await createSampleWiki());
  assert.equal(noGraph.ok, false);
  assert.equal(noGraph.error, "graph_data_missing");
});

test("graph build failure reports missing HTML helper without replacing existing graph", async () => {
  const wikiRoot = await createSampleWiki();
  const htmlPath = path.join(wikiRoot, "wiki", "knowledge-graph.html");
  await fsp.writeFile(htmlPath, "stable old html\n", "utf8");

  const brokenSkillRoot = path.join(await tempDir(), "broken-skill");
  await fsp.cp(skillRoot, brokenSkillRoot, { recursive: true });
  await fsp.rm(path.join(brokenSkillRoot, "templates", "graph-styles", "wash", "graph-wash-helpers.js"));

  const originalSkillRoot = process.env.LLM_WIKI_SKILL_ROOT;
  process.env.LLM_WIKI_SKILL_ROOT = brokenSkillRoot;
  try {
    const result = await buildGraph(wikiRoot);
    assert.equal(result.ok, false);
    assert.notEqual(result.code, 0);
    assert.match([result.stdout, result.stderr, result.error].join("\n"), /graph-wash-helpers\.js/);
    assert.equal(await fsp.readFile(htmlPath, "utf8"), "stable old html\n");
  } finally {
    process.env.LLM_WIKI_SKILL_ROOT = originalSkillRoot;
  }
});

test("source image diagnostics reports image frontmatter issues", async () => {
  const wikiRoot = await createSampleWiki();
  await fsp.mkdir(path.join(wikiRoot, "raw", "assets"), { recursive: true });
  await fsp.writeFile(path.join(wikiRoot, "raw", "assets", "ok.png"), "png\n", "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "sources", "image-check.md"), [
    "---",
    "source_path: raw/notes/image-check.txt",
    "images: 3",
    "image_paths:",
    "  - raw/assets/ok.png",
    "  - raw/assets/missing.png",
    "---",
    "# Image Check",
    "",
  ].join("\n"), "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "sources", "empty-images.md"), [
    "---",
    "source_path: raw/notes/empty-images.txt",
    "images: 1",
    "image_paths: []",
    "---",
    "# Empty Images",
    "",
  ].join("\n"), "utf8");

  const result = await sourceImageDiagnostics(wikiRoot);
  assert.equal(result.ok, false);
  assert.equal(result.summary.sourcePages >= 2, true);
  assert.equal(result.summary.emptyImagePaths, 1);
  assert.equal(result.summary.missingImagePaths, 1);
  assert.equal(result.summary.imageCountMismatches, 1);
  assert.ok(result.emptyImagePaths.includes("wiki/sources/empty-images.md"));
  assert.ok(result.missingImagePaths.some((item) => item.image_path === "raw/assets/missing.png"));

  const nonWiki = await sourceImageDiagnostics(await tempDir());
  assert.equal(nonWiki.ok, false);
  assert.equal(nonWiki.error, "not_llm_wiki_root");
});

test("source contract diagnostics reports source_path, raw, and cache issues", async () => {
  const wikiRoot = await createSampleWiki();
  await fsp.mkdir(path.join(wikiRoot, "raw", "notes"), { recursive: true });
  await fsp.writeFile(path.join(wikiRoot, "raw", "notes", "ok.txt"), "raw\n", "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "sources", "ok.md"), [
    "---",
    "source_path: raw/notes/ok.txt",
    "images: 0",
    "image_paths: []",
    "---",
    "# OK",
    "",
  ].join("\n"), "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "sources", "missing-raw.md"), [
    "---",
    "source_path: raw/notes/missing.txt",
    "---",
    "# Missing Raw",
    "",
  ].join("\n"), "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "sources", "missing-source-path.md"), [
    "---",
    "images: 0",
    "---",
    "# Missing Source Path",
    "",
  ].join("\n"), "utf8");
  await fsp.writeFile(path.join(wikiRoot, ".wiki-cache.json"), JSON.stringify({
    entries: {
      "raw/notes/ok.txt": { source_page: "wiki/sources/other.md" },
    },
  }, null, 2), "utf8");

  const result = await sourceContractDiagnostics(wikiRoot);
  assert.equal(result.ok, false);
  assert.equal(result.summary.missingSourcePath, 1);
  assert.equal(result.summary.missingRawFiles, 1);
  assert.equal(result.summary.cacheMissing, 1);
  assert.equal(result.summary.cacheMismatches, 1);
  assert.ok(result.missingSourcePath.includes("wiki/sources/missing-source-path.md"));
  assert.ok(result.missingRawFiles.some((item) => item.source_path === "raw/notes/missing.txt"));
  assert.ok(result.cacheMismatches.some((item) => item.cache_source_page === "wiki/sources/other.md"));

  const nonWiki = await sourceContractDiagnostics(await tempDir());
  assert.equal(nonWiki.ok, false);
  assert.equal(nonWiki.error, "not_llm_wiki_root");
});

test("maintenance diagnostics reports source, raw, cache, source signal, index, and purpose issues", async () => {
  const wikiRoot = await createSampleWiki();
  await fsp.writeFile(path.join(wikiRoot, "purpose.md"), [
    "# 研究目的与方向",
    "",
    "## 核心目标",
    "[待填写]",
    "",
    "## 关键问题",
    "1. [待填写]",
    "",
    "## 研究范围",
    "**涵盖：** [待填写]",
    "",
  ].join("\n"), "utf8");
  await fsp.mkdir(path.join(wikiRoot, "raw", "notes"), { recursive: true });
  await fsp.writeFile(path.join(wikiRoot, "raw", "notes", "used.txt"), "raw\n", "utf8");
  await fsp.writeFile(path.join(wikiRoot, "raw", "notes", "orphan-raw.txt"), "raw\n", "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "sources", "used.md"), [
    "---",
    "source_path: raw/notes/used.txt",
    "source_type: note",
    "sources: []",
    "images: 0",
    "image_paths: []",
    "---",
    "# Used Source",
    "",
  ].join("\n"), "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "sources", "orphan.md"), [
    "---",
    "source_path: raw/notes/missing.txt",
    "source_type: note",
    "sources: []",
    "images: 0",
    "image_paths: []",
    "---",
    "# Orphan Source",
    "",
  ].join("\n"), "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "sources", "missing-source-path.md"), [
    "---",
    "images: 0",
    "---",
    "# Missing Source Path",
    "",
  ].join("\n"), "utf8");
  await fsp.mkdir(path.join(wikiRoot, "wiki", "queries"), { recursive: true });
  await fsp.mkdir(path.join(wikiRoot, "wiki", "synthesis"), { recursive: true });
  await fsp.writeFile(path.join(wikiRoot, "wiki", "queries", "Search.md"), "---\ntype: query\nderived: true\n---\n# Search\n", "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "synthesis", "Digest.md"), "---\ntype: synthesis\nderived: true\n---\n# Digest\n", "utf8");
  await fsp.writeFile(path.join(wikiRoot, ".wiki-cache.json"), JSON.stringify({
    entries: {
      "raw/notes/stale.txt": { source_page: "wiki/sources/stale.md" },
      "raw/notes/used.txt": { source_page: "wiki/sources/used.md" },
    },
  }, null, 2), "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "entities", "Duplicate.md"), [
    "---",
    "sources: []",
    "---",
    "# Duplicate",
    "",
    "source: raw/notes/used.txt",
    "",
  ].join("\n"), "utf8");
  await fsp.writeFile(path.join(wikiRoot, "wiki", "topics", "Duplicate.md"), "# Duplicate\n", "utf8");

  const result = await maintenanceDiagnostics(wikiRoot);
  assert.equal(result.ok, true);
  assert.equal(result.summary.orphanSources >= 1, true);
  assert.equal(result.summary.orphanRawFiles, 1);
  assert.equal(result.summary.missingSourcePaths, 1);
  assert.equal(result.summary.brokenRawFiles, 1);
  assert.equal(result.summary.staleCacheEntries, 1);
  assert.equal(result.summary.sourceFrontmatterIssues >= 1, true);
  assert.equal(result.summary.missingSourceSignals >= 2, true);
  assert.equal(result.summary.queryDigestIndexGaps, 2);
  assert.equal(result.summary.duplicateTitles >= 1, true);
  assert.equal(result.summary.purposeHints >= 3, true);
  assert.ok(result.orphanSources.includes("wiki/sources/orphan.md"));
  assert.deepEqual(result.orphanRawFiles, ["raw/notes/orphan-raw.txt"]);
  assert.ok(result.missingSourcePaths.includes("wiki/sources/missing-source-path.md"));
  assert.ok(result.brokenRawFiles.some((item) => item.source_path === "raw/notes/missing.txt"));
  assert.ok(result.staleCacheEntries.some((item) => item.rawPath === "raw/notes/stale.txt"));
  assert.ok(result.sourceFrontmatterIssues.some((item) => item.page === "wiki/sources/missing-source-path.md"));
  assert.ok(result.missingSourceSignals.some((item) => item.path === "wiki/entities/Duplicate.md" && item.reason === "empty_sources"));
  assert.ok(result.queryDigestIndexStatus.missingFromIndex.some((item) => item.path === "wiki/queries/Search.md"));
  assert.ok(result.queryDigestIndexStatus.missingFromIndex.some((item) => item.path === "wiki/synthesis/Digest.md"));
  assert.ok(result.duplicateTitles.some((item) => item.title === "duplicate"));
  assert.ok(result.purposeHints.includes("core_goal_placeholder"));
  assert.match(result.stdout, /orphan raw files: 1/);
  assert.match(result.stdout, /stale cache entries: 1/);
  assert.match(result.stdout, /query\/digest index gaps: 2/);

  const tool = await maintenanceDiagnosticsTool.execute({ wikiRoot });
  assert.equal(tool.details.summary.missingSourcePaths, 1);
  assert.equal(tool.details.summary.orphanRawFiles, 1);

  const nonWiki = await maintenanceDiagnostics(await tempDir());
  assert.equal(nonWiki.ok, false);
  assert.equal(nonWiki.error, "not_llm_wiki_root");
});

test("cache status and Step 1 validation are read-only wrappers", async () => {
  const wikiRoot = await createSampleWiki();
  await fsp.mkdir(path.join(wikiRoot, "raw", "notes"), { recursive: true });
  const rawFile = path.join(wikiRoot, "raw", "notes", "sample.txt");
  await fsp.writeFile(rawFile, "raw\n", "utf8");
  const cache = await cacheStatus({ wikiRoot, filePath: "raw/notes/sample.txt" });
  assert.equal(cache.ok, true, cache.stderr || cache.error);
  assert.equal(cache.cacheState.kind, "MISS");

  const outside = await cacheStatus({ wikiRoot, filePath: path.join(await tempDir(), "outside.txt") });
  assert.equal(outside.ok, false);
  assert.equal(outside.error, "filePath_outside_wiki_root");

  const jsonFile = path.join(await tempDir(), "step1.json");
  await fsp.writeFile(jsonFile, JSON.stringify({
    entities: [],
    topics: [],
    connections: [],
    contradictions: [],
    new_vs_existing: {},
  }), "utf8");
  const valid = await validateStep1({ jsonFile });
  assert.equal(valid.ok, true, valid.stderr || valid.error);
  assert.match(valid.stdout, /OK: Step 1 JSON validation passed/);

  const invalidFile = path.join(await tempDir(), "bad.json");
  await fsp.writeFile(invalidFile, "{}", "utf8");
  const invalid = await validateStep1({ jsonFile: invalidFile });
  assert.equal(invalid.ok, false);
  assert.notEqual(invalid.code, 0);
});

test("lint fix preview and source page contract preview are read-only", async () => {
  const wikiRoot = await createSampleWiki();
  const missingIndexPage = path.join(wikiRoot, "wiki", "entities", "Unlisted.md");
  await fsp.writeFile(missingIndexPage, "# Unlisted\n", "utf8");
  const indexBefore = await fsp.readFile(path.join(wikiRoot, "index.md"), "utf8");
  const preview = await lintFixPreview(wikiRoot);
  assert.equal(preview.ok, true, preview.stderr || preview.error);
  assert.equal(preview.preview, true);
  assert.equal(preview.summary.wouldModify, true);
  assert.ok(preview.actions.some((action) => action.entry === "Unlisted"));
  assert.equal(await fsp.readFile(path.join(wikiRoot, "index.md"), "utf8"), indexBefore);

  const nonWiki = await lintFixPreview(await tempDir());
  assert.equal(nonWiki.ok, false);
  assert.equal(nonWiki.error, "not_llm_wiki_root");

  await fsp.mkdir(path.join(wikiRoot, "raw", "notes"), { recursive: true });
  const rawFile = path.join(wikiRoot, "raw", "notes", "source.txt");
  const contentFile = path.join(await tempDir(), "source-page.md");
  await fsp.writeFile(rawFile, "raw\n", "utf8");
  await fsp.writeFile(contentFile, "---\nsource_path: raw/notes/source.txt\n---\n# Source\n", "utf8");
  const sourcePreview = await sourcePageContractPreview({
    wikiRoot,
    rawFile: "raw/notes/source.txt",
    outputPath: "wiki/sources/source.md",
    contentFile,
  });
  assert.equal(sourcePreview.ok, true, sourcePreview.stderr || sourcePreview.error);
  assert.equal(sourcePreview.preview, true);
  assert.equal(sourcePreview.summary.wouldWriteSourcePage, true);
  assert.equal(sourcePreview.summary.wouldUpdateCache, true);
  assert.equal(fs.existsSync(path.join(wikiRoot, "wiki", "sources", "source.md")), false);

  await fsp.writeFile(path.join(wikiRoot, "wiki", "sources", "source.md"), "# Existing\n", "utf8");
  const overwrite = await sourcePageContractPreview({
    wikiRoot,
    rawFile,
    outputPath: "wiki/sources/source.md",
    contentFile,
  });
  assert.equal(overwrite.ok, false);
  assert.ok(overwrite.issues.includes("output_would_overwrite"));

  const outside = await sourcePageContractPreview({
    wikiRoot,
    rawFile,
    outputPath: "../outside.md",
    contentFile,
  });
  assert.equal(outside.ok, false);
  assert.equal(outside.error, "outputPath_required");
});

test("tools expose content plus structured details", async () => {
  const wikiRoot = await createSampleWiki();
  const status = await statusTool.execute({ wikiRoot });
  assert.equal(status.details.ok, true);
  assert.equal(status.content[0].type, "text");

  const lint = await lintTool.execute({ wikiRoot });
  assert.equal(lint.details.ok, true);
  assert.match(lint.details.stdout, /llm-wiki lint/);

  const lintFix = await lintFixPreviewTool.execute({ wikiRoot });
  assert.equal(lintFix.details.ok, true);
  assert.equal(lintFix.details.preview, true);

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

  const registry = await sourceRegistryTool.execute({});
  assert.equal(registry.details.ok, true);
  assert.ok(registry.details.sources.length > 0);

  const adapters = await adapterStatusTool.execute({ sourceId: "plain_text" });
  assert.equal(adapters.details.ok, true);
  assert.equal(adapters.details.adapters[0].source_id, "plain_text");

  const diag = await diagnosticsTool.execute({ wikiRoot });
  assert.equal(diag.details.ok, true);
  assert.equal(typeof diag.details.counts.pages, "number");
  assert.equal(diag.details.purposeSummary.exists, true);

  const sourceGet = await sourceGetTool.execute({ sourceId: "plain_text" });
  assert.equal(sourceGet.details.ok, true);
  assert.equal(sourceGet.details.source.source_id, "plain_text");

  const sourceUrl = await sourceMatchUrlTool.execute({ url: "https://example.com/post" });
  assert.equal(sourceUrl.details.ok, true);
  assert.equal(sourceUrl.details.source.input_mode, "url");

  const sourceFile = await sourceMatchFileTool.execute({ filePath: "paper.pdf" });
  assert.equal(sourceFile.details.ok, true);
  assert.equal(sourceFile.details.source.input_mode, "file");

  const links = await linkDiagnosticsTool.execute({ wikiRoot });
  assert.equal(links.details.ok, true);
  assert.equal(typeof links.details.summary.pages, "number");

  const graphPaths = await graphSourcePathsTool.execute({ wikiRoot });
  assert.equal(graphPaths.details.ok, true);

  const eligibility = await sourceSignalEligibilityTool.execute({ wikiRoot });
  assert.equal(typeof eligibility.details.summary.applicable, "number");

  const runtimeContext = await runtimeContextStatusTool.execute({ wikiRoot });
  assert.equal(runtimeContext.details.ok, true);

  const imageDiagnostics = await sourceImageDiagnosticsTool.execute({ wikiRoot });
  assert.equal(imageDiagnostics.details.ok, true);
  assert.equal(typeof imageDiagnostics.details.summary.sourcePages, "number");

  const contractDiagnostics = await sourceContractDiagnosticsTool.execute({ wikiRoot });
  assert.equal(contractDiagnostics.details.ok, true);
  assert.equal(typeof contractDiagnostics.details.summary.cacheMissing, "number");

  const dryRun = await deleteDryRunTool.execute({ wikiRoot, sourceFile: "missing.txt" });
  assert.equal(dryRun.details.ok, true);
  assert.ok(Array.isArray(dryRun.details.references));

  await fsp.mkdir(path.join(wikiRoot, "raw", "notes"), { recursive: true });
  await fsp.writeFile(path.join(wikiRoot, "raw", "notes", "tool.txt"), "tool\n", "utf8");
  const cache = await cacheStatusTool.execute({ wikiRoot, filePath: "raw/notes/tool.txt" });
  assert.equal(cache.details.ok, true);
  assert.equal(cache.details.cacheState.kind, "MISS");

  const sourcePageContent = path.join(await tempDir(), "tool-source.md");
  await fsp.writeFile(sourcePageContent, "---\nsource_path: raw/notes/tool.txt\n---\n# Tool\n", "utf8");
  const sourcePagePreview = await sourcePageContractPreviewTool.execute({
    wikiRoot,
    rawFile: "raw/notes/tool.txt",
    outputPath: "wiki/sources/tool-source.md",
    contentFile: sourcePageContent,
  });
  assert.equal(sourcePagePreview.details.preview, true);

  const outputPath = path.join(await tempDir(), "adapter-tool.txt");
  await fsp.writeFile(outputPath, "adapter\n", "utf8");
  const classify = await adapterClassifyTool.execute({ sourceId: "plain_text", exitCode: 0, outputPath });
  assert.equal(classify.details.ok, true);

  const jsonFile = path.join(await tempDir(), "tool-step1.json");
  await fsp.writeFile(jsonFile, JSON.stringify({
    entities: [],
    topics: [],
    connections: [],
    contradictions: [],
    new_vs_existing: {},
  }), "utf8");
  const step1 = await validateStep1Tool.execute({ jsonFile });
  assert.equal(step1.details.ok, true);

  const nonWikiCoverage = await sourceCoverageTool.execute({ wikiRoot: await tempDir() });
  assert.equal(nonWikiCoverage.details.ok, false);
  assert.equal(nonWikiCoverage.details.error, "not_llm_wiki_root");
});

test("static tool files satisfy Hana loader contract", async () => {
  const expectedNames = [
    "llm_wiki_adapter_classify",
    "llm_wiki_adapter_status",
    "llm_wiki_build_graph",
    "llm_wiki_cache_status",
    "llm_wiki_delete_dry_run",
    "llm_wiki_diagnostics",
    "llm_wiki_graph_source_paths",
    "llm_wiki_init",
    "llm_wiki_link_diagnostics",
    "llm_wiki_lint",
    "llm_wiki_lint_fix_preview",
    "llm_wiki_maintenance_diagnostics",
    "llm_wiki_runtime_context_status",
    "llm_wiki_source_contract_diagnostics",
    "llm_wiki_source_coverage",
    "llm_wiki_source_get",
    "llm_wiki_source_image_diagnostics",
    "llm_wiki_source_match_file",
    "llm_wiki_source_match_url",
    "llm_wiki_source_page_contract_preview",
    "llm_wiki_source_registry",
    "llm_wiki_source_signal_eligibility",
    "llm_wiki_status",
    "llm_wiki_validate_step1",
  ];
  const toolDir = path.join(pluginRoot, "tools");
  const files = (await fsp.readdir(toolDir)).filter((file) => file.endsWith(".js")).sort();
  const loaded = await Promise.all(files.map(async (file) => import(`../tools/${file}`)));
  const names = loaded.map((tool) => tool.name).sort();

  assert.deepEqual(names, expectedNames);
  for (const tool of loaded) {
    assert.equal(typeof tool.name, "string");
    assert.match(tool.name, /^llm_wiki_[a-z0-9_]+$/);
    assert.equal(typeof tool.description, "string");
    assert.ok(tool.description.length > 0);
    assert.equal(typeof tool.parameters, "object");
    assert.equal(tool.parameters.type, "object");
    assert.equal(typeof tool.execute, "function");
  }
  assert.ok(names.every((name) => `llm-wiki-viewer_${name}`.startsWith("llm-wiki-viewer_llm_wiki_")));
});

test("OpenHanako PluginManager loads viewer routes and tools", { skip: !hasOpenHanakoReference() }, async () => {
  const pluginManagerUrl = pathToFileURL(path.join(repoRoot, "reference", "openhanako-main", "core", "plugin-manager.js")).href;
  const { PluginManager } = await import(pluginManagerUrl);
  const dataDir = await tempDir();
  const bus = {
    emit() {},
    subscribe() { return () => {}; },
    request() { return null; },
    handle() { return () => {}; },
  };
  const manager = new PluginManager({
    pluginsDirs: [path.join(repoRoot, "plugins")],
    dataDir,
    bus,
    appVersion: "999.0.0",
  });

  manager.scan();
  await manager.loadAll();
  const diagnostics = manager.getDiagnostics().find((item) => item.id === "llm-wiki-viewer");
  const tools = manager.getAllTools()
    .filter((tool) => tool.name.startsWith("llm-wiki-viewer_"))
    .map((tool) => tool.name)
    .sort();

  assert.equal(diagnostics.status, "loaded");
  assert.equal(diagnostics.activationState, "activated");
  assert.ok(diagnostics.contributions.includes("tools"));
  assert.ok(diagnostics.contributions.includes("routes"));
  assert.ok(diagnostics.routes.hasRouteApp);
  assert.deepEqual(diagnostics.routes.pages.map((page) => page.route), ["/viewer"]);
  assert.deepEqual(tools, [
    "llm-wiki-viewer_llm_wiki_adapter_classify",
    "llm-wiki-viewer_llm_wiki_adapter_status",
    "llm-wiki-viewer_llm_wiki_build_graph",
    "llm-wiki-viewer_llm_wiki_cache_status",
    "llm-wiki-viewer_llm_wiki_delete_dry_run",
    "llm-wiki-viewer_llm_wiki_diagnostics",
    "llm-wiki-viewer_llm_wiki_graph_source_paths",
    "llm-wiki-viewer_llm_wiki_init",
    "llm-wiki-viewer_llm_wiki_link_diagnostics",
    "llm-wiki-viewer_llm_wiki_lint",
    "llm-wiki-viewer_llm_wiki_lint_fix_preview",
    "llm-wiki-viewer_llm_wiki_maintenance_diagnostics",
    "llm-wiki-viewer_llm_wiki_runtime_context_status",
    "llm-wiki-viewer_llm_wiki_source_contract_diagnostics",
    "llm-wiki-viewer_llm_wiki_source_coverage",
    "llm-wiki-viewer_llm_wiki_source_get",
    "llm-wiki-viewer_llm_wiki_source_image_diagnostics",
    "llm-wiki-viewer_llm_wiki_source_match_file",
    "llm-wiki-viewer_llm_wiki_source_match_url",
    "llm-wiki-viewer_llm_wiki_source_page_contract_preview",
    "llm-wiki-viewer_llm_wiki_source_registry",
    "llm-wiki-viewer_llm_wiki_source_signal_eligibility",
    "llm-wiki-viewer_llm_wiki_status",
    "llm-wiki-viewer_llm_wiki_validate_step1",
  ]);
});

test("rewriteGraphSourcePaths rewrites wiki-local markdown links only", () => {
  const wikiRoot = "/tmp/demo-wiki";
  const wikiDir = path.join(wikiRoot, "wiki");
  const html = '<script id="graph-data" type="application/json">{"nodes":[{"source_path":"/tmp/demo-wiki/wiki/entities/A.md"},{"source_path":"/tmp/outside.md"}]}</script>';
  const rewritten = rewriteGraphSourcePaths(html, wikiRoot, wikiDir, "/wiki-file/", "?token=t");
  assert.ok(rewritten.includes('"source_path": "/wiki-file/entities/A.md?token=t"'));
  assert.ok(rewritten.includes('"source_path": "/tmp/outside.md"'));
});

test("applyGraphTheme injects dark graph theme without rewriting source html files", () => {
  const html = '<!doctype html><html lang="zh-Hans"><head><style>:root { --bg: #fff; }</style></head><body><section class="topbar"></section><main class="canvas-card"></main></body></html>';
  const themed = applyGraphTheme(html, "dark");
  assert.match(themed, /<html lang="zh-Hans" data-effective-theme="dark">/);
  assert.match(themed, /id="llm-wiki-viewer-graph-theme"/);
  assert.match(themed, /html\[data-effective-theme="dark"\] \.topbar/);
  assert.match(themed, /--bg: #080c12/);
  assert.match(themed, /--surface: #121820/);
  assert.match(themed, /--cinnabar: #f06455/);
  assert.match(themed, /--jade: #31d6a0/);
  assert.match(themed, /--night: #58a6ff/);
  assert.match(themed, /html\[data-effective-theme="dark"\] \.edge\.extracted/);
  assert.match(themed, /html\[data-effective-theme="dark"\] ::-webkit-scrollbar-thumb/);
});

test("applyGraphPanelControls injects collapsible side panels", () => {
  const html = '<!doctype html><html><head></head><body><main class="app" id="app"><aside class="sidebar"></aside><section class="canvas-card"></section><aside class="drawer"></aside></main></body></html>';
  const enhanced = applyGraphPanelControls(html);
  assert.match(enhanced, /id="llm-wiki-viewer-panel-controls"/);
  assert.match(enhanced, /id="llm-wiki-viewer-panel-script"/);
  assert.match(enhanced, /llm-wiki-viewer-toggle-left/);
  assert.match(enhanced, /llm-wiki-viewer-toggle-right/);
  assert.match(enhanced, /data-left-panel-collapsed/);
  assert.match(enhanced, /data-right-panel-collapsed/);
  assert.match(enhanced, /llm-wiki-viewer-graph-panels/);
  assert.match(enhanced, /\.drawer-body/);
  assert.match(enhanced, /overflow-y: auto/);
  assert.match(enhanced, /overscroll-behavior: contain/);
  assert.match(enhanced, /折叠左侧栏/);
  assert.match(enhanced, /折叠右侧栏/);
  assert.match(enhanced, /leftPanel\.append\(leftButton\)/);
  assert.match(enhanced, /rightPanel\.append\(rightButton\)/);
  assert.doesNotMatch(enhanced, /document\.body\.append\(leftButton, rightButton\)/);
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

  const lintFixPreview = await routes.post("/api/lint-fix-preview", { wikiRoot: nonWikiRoot });
  assert.equal(lintFixPreview.status, 422);
  assert.equal(lintFixPreview.body.error, "not_llm_wiki_root");

  const diagnostics = await routes.get("/api/diagnostics", { wikiRoot: nonWikiRoot });
  assert.equal(diagnostics.status, 422);
  assert.equal(diagnostics.body.error, "not_llm_wiki_root");

  const coverage = await routes.post("/api/source-coverage", { wikiRoot: nonWikiRoot });
  assert.equal(coverage.status, 422);
  assert.equal(coverage.body.error, "not_llm_wiki_root");

  const linkDiagnostics = await routes.get("/api/link-diagnostics", { wikiRoot: nonWikiRoot });
  assert.equal(linkDiagnostics.status, 422);
  assert.equal(linkDiagnostics.body.error, "not_llm_wiki_root");

  const graphSourcePaths = await routes.get("/api/graph-source-paths", { wikiRoot: nonWikiRoot });
  assert.equal(graphSourcePaths.status, 422);
  assert.equal(graphSourcePaths.body.error, "not_llm_wiki_root");

  const sourceImages = await routes.get("/api/source-image-diagnostics", { wikiRoot: nonWikiRoot });
  assert.equal(sourceImages.status, 422);
  assert.equal(sourceImages.body.error, "not_llm_wiki_root");

  const sourceContracts = await routes.get("/api/source-contract-diagnostics", { wikiRoot: nonWikiRoot });
  assert.equal(sourceContracts.status, 422);
  assert.equal(sourceContracts.body.error, "not_llm_wiki_root");

  const maintenance = await routes.get("/api/maintenance-diagnostics", { wikiRoot: nonWikiRoot });
  assert.equal(maintenance.status, 422);
  assert.equal(maintenance.body.error, "not_llm_wiki_root");

  const eligibility = await routes.get("/api/source-signal-eligibility", { wikiRoot: nonWikiRoot });
  assert.equal(eligibility.status, 422);
  assert.equal(eligibility.body.error, "not_llm_wiki_root");

  const runtimeContext = await routes.get("/api/runtime-context", { wikiRoot: nonWikiRoot });
  assert.equal(runtimeContext.status, 422);
  assert.equal(runtimeContext.body.error, "not_llm_wiki_root");

  const deleteDryRun = await routes.post("/api/delete-dry-run", { wikiRoot: nonWikiRoot, sourceFile: "sample.txt" });
  assert.equal(deleteDryRun.status, 422);
  assert.equal(deleteDryRun.body.error, "not_llm_wiki_root");

  const sourcePagePreview = await routes.post("/api/source-page-contract-preview", {
    wikiRoot: nonWikiRoot,
    rawFile: "raw/missing.txt",
    outputPath: "wiki/sources/missing.md",
    contentFile: path.join(await tempDir(), "missing.md"),
  });
  assert.equal(sourcePagePreview.status, 422);
  assert.equal(sourcePagePreview.body.error, "not_llm_wiki_root");

  const emptyRoot = path.join(await tempDir(), "empty-wiki");
  await fsp.mkdir(emptyRoot);
  const initEmpty = await routes.post("/api/init", { wikiRoot: emptyRoot, topic: "Empty Wiki", language: "zh" });
  assert.equal(initEmpty.status, 200);
  assert.equal(initEmpty.body.ok, true);
  const buildEmpty = await routes.post("/api/build", { wikiRoot: emptyRoot });
  assert.equal(buildEmpty.status, 200);
  assert.equal(buildEmpty.body.ok, true);
  assert.ok(fs.existsSync(path.join(emptyRoot, "wiki", "graph-data.json")));
  assert.ok(fs.existsSync(path.join(emptyRoot, "wiki", "knowledge-graph.html")));
  const darkGraph = await routes.get("/graph", { wikiRoot: emptyRoot, theme: "dark" });
  assert.equal(darkGraph.status, 200);
  const darkGraphHtml = await darkGraph.text();
  assert.match(darkGraphHtml, /data-effective-theme="dark"/);
  assert.match(darkGraphHtml, /llm-wiki-viewer-graph-theme/);
  assert.match(darkGraphHtml, /llm-wiki-viewer-panel-controls/);
  assert.match(darkGraphHtml, /llm-wiki-viewer-toggle-left/);
  assert.match(darkGraphHtml, /llm-wiki-viewer-toggle-right/);

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

  const fileTarget = path.join(await tempDir(), "same-name-file");
  await fsp.writeFile(fileTarget, "", "utf8");
  const notDirectory = await routes.post("/api/init", { wikiRoot: fileTarget, topic: "Unsafe", language: "zh" });
  assert.equal(notDirectory.status, 409);
  assert.equal(notDirectory.body.error, "target_not_directory");
});

test("viewer API routes expose safety diagnostics", async () => {
  const routes = registerRoutesForTest();
  const wikiRoot = await createSampleWiki();
  await buildGraph(wikiRoot);
  await fsp.writeFile(path.join(wikiRoot, "wiki", "entities", "Transformer.md"), [
    "# Transformer",
    "",
    "source: raw/notes/sample.txt",
    "[[Missing Page]]",
    "",
  ].join("\n"), "utf8");

  const links = await routes.get("/api/link-diagnostics", { wikiRoot });
  assert.equal(links.status, 200);
  assert.equal(links.body.ok, true);
  assert.ok(links.body.brokenLinks.some((link) => link.target === "Missing Page"));

  const graphPaths = await routes.get("/api/graph-source-paths", { wikiRoot });
  assert.equal(graphPaths.status, 200);
  assert.equal(graphPaths.body.ok, true);
  assert.equal(graphPaths.body.summary.missingFiles, 0);

  const dryRun = await routes.post("/api/delete-dry-run", { wikiRoot, sourceFile: "raw/notes/sample.txt" });
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.ok, true);
  assert.ok(dryRun.body.references.includes("wiki/entities/Transformer.md"));

  const lintFix = await routes.post("/api/lint-fix-preview", { wikiRoot });
  assert.equal(lintFix.status, 200);
  assert.equal(lintFix.body.preview, true);

  await fsp.mkdir(path.join(wikiRoot, "raw", "notes"), { recursive: true });
  await fsp.writeFile(path.join(wikiRoot, "raw", "notes", "route-source.txt"), "raw\n", "utf8");
  const contentFile = path.join(await tempDir(), "route-source.md");
  await fsp.writeFile(contentFile, "---\nsource_path: raw/notes/route-source.txt\n---\n# Route Source\n", "utf8");
  const sourcePage = await routes.post("/api/source-page-contract-preview", {
    wikiRoot,
    rawFile: "raw/notes/route-source.txt",
    outputPath: "wiki/sources/route-source.md",
    contentFile,
  });
  assert.equal(sourcePage.status, 200);
  assert.equal(sourcePage.body.preview, true);
  assert.equal(sourcePage.body.summary.wouldWriteSourcePage, true);

  const sourceImages = await routes.get("/api/source-image-diagnostics", { wikiRoot });
  assert.equal(sourceImages.status, 200);
  assert.equal(sourceImages.body.ok, true);
  assert.equal(typeof sourceImages.body.summary.sourcePages, "number");

  const sourceContracts = await routes.get("/api/source-contract-diagnostics", { wikiRoot });
  assert.equal(sourceContracts.status, 200);
  assert.equal(sourceContracts.body.ok, true);
  assert.equal(sourceContracts.body.summary.cacheMissing >= 0, true);

  const maintenance = await routes.get("/api/maintenance-diagnostics", { wikiRoot });
  assert.equal(maintenance.status, 200);
  assert.equal(typeof maintenance.body.summary.orphanSources, "number");
  assert.equal(Array.isArray(maintenance.body.purposeHints), true);

  const eligibility = await routes.get("/api/source-signal-eligibility", { wikiRoot });
  assert.equal(eligibility.status, 200);
  assert.equal(typeof eligibility.body.summary.applicable, "number");

  const runtimeContext = await routes.get("/api/runtime-context", { wikiRoot });
  assert.equal(runtimeContext.status, 200);
  assert.equal(runtimeContext.body.checks.skillRootExists, true);
});

test("viewer API routes save and list wiki roots", async () => {
  const config = createMemoryConfig({ savedWikiRoots: [] });
  const routes = registerRoutesForTest({ config });
  const first = path.join(await tempDir(), "first");
  const second = path.join(await tempDir(), "second");

  const emptySave = await routes.post("/api/wiki-roots", { wikiRoot: "" });
  assert.equal(emptySave.status, 422);
  assert.equal(emptySave.body.error, "wikiRoot_required");

  const savedFirst = await routes.post("/api/wiki-roots", { wikiRoot: first });
  assert.equal(savedFirst.status, 200);
  assert.equal(savedFirst.body.ok, true);
  assert.deepEqual(savedFirst.body.savedWikiRoots, [first]);

  const savedSecond = await routes.post("/api/wiki-roots", { wikiRoot: second });
  assert.equal(savedSecond.status, 200);
  assert.deepEqual(savedSecond.body.savedWikiRoots, [second, first]);

  const listed = await routes.get("/api/wiki-roots");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.defaultWikiRoot, second);
  assert.deepEqual(listed.body.wikiRoots, [second, first]);

  const currentOnly = path.join(await tempDir(), "current-only");
  const remembered = await routes.post("/api/current-root", { wikiRoot: currentOnly });
  assert.equal(remembered.status, 200);
  assert.equal(remembered.body.defaultWikiRoot, currentOnly);

  const listedAfterRemember = await routes.get("/api/wiki-roots");
  assert.equal(listedAfterRemember.body.defaultWikiRoot, currentOnly);
  assert.deepEqual(listedAfterRemember.body.wikiRoots, [currentOnly, second, first]);

  const removed = await routes.delete("/api/wiki-roots", { wikiRoot: first });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.ok, true);
  assert.deepEqual(removed.body.savedWikiRoots, [currentOnly, second]);
});

test("Hana Agent workflow helpers use native bus session APIs", async () => {
  const calls = [];
  const ctx = {
    bus: {
      async request(type, payload) {
        calls.push([type, payload]);
        if (type === "agent:list") return { agents: [{ id: "agent-1", name: "知识库 Agent", isPrimary: true }] };
        if (type === "session:list") return { sessions: [{ path: "/agents/agent-1/sessions/a.jsonl", title: "Wiki 会话", agentId: payload.agentId }] };
        if (type === "session:create") return { ok: true, sessionPath: "/agents/agent-1/sessions/new.jsonl", agentId: payload.agentId };
        if (type === "session:update") return { ok: true, session: { path: payload.sessionPath, title: payload.title } };
        if (type === "session:send") return { accepted: true, sessionPath: payload.sessionPath };
        throw new Error(`unexpected ${type}`);
      },
    },
  };
  const agents = await listHanaAgents(ctx);
  assert.equal(agents.ok, true);
  assert.equal(agents.agents[0].id, "agent-1");

  const sessions = await listHanaSessions(ctx, { agentId: "agent-1" });
  assert.equal(sessions.ok, true);
  assert.equal(sessions.sessions[0].title, "Wiki 会话");

  const wikiRoot = path.join(await tempDir(), "agent-wiki");
  const sent = await sendHanaAgentWorkflow(ctx, {
    wikiRoot,
    agentId: "agent-1",
    action: "digest",
    input: "AI Agent 记忆机制",
  });
  assert.equal(sent.ok, true);
  assert.equal(sent.deliveryMode, "new");
  assert.equal(sent.sessionPath, "/agents/agent-1/sessions/new.jsonl");
  assert.equal(sent.createdSession.sessionPath, "/agents/agent-1/sessions/new.jsonl");
  assert.equal(sent.createdSession.updateResult.ok, true);
  assert.match(sent.prompt, /请使用 llm-wiki skill/);
  assert.match(sent.prompt, /知识库根目录：/);
  assert.match(sent.prompt, /任务类型：深度整理/);
  assert.match(sent.prompt, /优先读取 knowledge root 下的 purpose\.md/);
  assert.match(sent.prompt, /生成\/刷新/);
  assert.match(sent.prompt, /AI Agent 记忆机制/);
  assert.deepEqual(calls.map(([type]) => type), ["agent:list", "session:list", "session:create", "session:update", "session:send"]);

  const missingSession = await sendHanaAgentWorkflow(ctx, { wikiRoot, action: "query", deliveryMode: "existing" });
  assert.equal(missingSession.ok, false);
  assert.equal(missingSession.error, "sessionPath_required");

  const prompt = buildAgentWorkflowPrompt({ wikiRoot, action: "batch_ingest", input: "/tmp/raw" });
  assert.match(prompt, /任务类型：批量消化/);
  assert.match(prompt, /\/tmp\/raw/);

  assert.equal(normalizeAgentWorkflowAction("context"), "context");
  assert.equal(normalizeAgentWorkflowAction("session-start"), "context");
  assert.equal(normalizeAgentWorkflowAction("启动上下文"), "context");
  assert.equal(normalizeAgentDeliveryMode("new-session"), "new");
  assert.equal(normalizeAgentDeliveryMode("已有会话"), "existing");

  const contextPrompt = buildAgentWorkflowPrompt({ wikiRoot, action: "context" });
  assert.match(contextPrompt, /任务类型：启动知识库上下文/);
  assert.match(contextPrompt, new RegExp(escapeRegExp(wikiRoot)));
  assert.match(contextPrompt, /purpose\.md/);
  assert.match(contextPrompt, /\.wiki-schema\.md/);
  assert.match(contextPrompt, /index\.md/);
  assert.match(contextPrompt, /obsidian-wiki-manager\/references\/llm-wiki\/SKILL\.md/);
  assert.match(contextPrompt, /llm-wiki skill/);
  assert.match(contextPrompt, /生成\/刷新/);

  const contextSent = await sendHanaAgentWorkflow(ctx, {
    wikiRoot,
    sessionPath: "/agents/agent-1/sessions/a.jsonl",
    deliveryMode: "existing",
    action: "context",
  });
  assert.equal(contextSent.ok, true);
  assert.equal(contextSent.action, "context");
  assert.equal(contextSent.deliveryMode, "existing");
  assert.equal(contextSent.sessionPath, "/agents/agent-1/sessions/a.jsonl");
  assert.match(contextSent.prompt, /启动当前知识库上下文/);
});

test("viewer API routes bridge to Hana Agent bus", async () => {
  const wikiRoot = await createSampleWiki();
  const calls = [];
  const bus = {
    async request(type, payload) {
      calls.push([type, payload]);
      if (type === "agent:list") return { agents: [{ id: "a1", name: "主 Agent", isCurrent: true }] };
      if (type === "session:list") return { sessions: [{ path: "/agents/a1/sessions/s1.jsonl", title: "知识库维护", agentId: "a1" }] };
      if (type === "session:create") {
        assert.equal(payload.agentId, "a1");
        assert.equal(payload.ownerPluginId, "llm-wiki-viewer");
        assert.equal(payload.kind, "llm-wiki-workflow");
        assert.equal(payload.visibility, "public");
        return { ok: true, sessionPath: "/agents/a1/sessions/new.jsonl", agentId: "a1", agentName: "主 Agent" };
      }
      if (type === "session:update") {
        assert.equal(payload.sessionPath, "/agents/a1/sessions/new.jsonl");
        assert.match(payload.title, /LLM Wiki/);
        return { ok: true, session: { path: payload.sessionPath, title: payload.title } };
      }
      if (type === "session:send") {
        assert.equal(payload.sessionPath, "/agents/a1/sessions/new.jsonl");
        assert.match(payload.text, /任务类型：维护检查/);
        assert.match(payload.text, new RegExp(escapeRegExp(wikiRoot)));
        return { accepted: true, sessionPath: payload.sessionPath };
      }
      throw new Error("unexpected bus call");
    },
  };
  const routes = registerRoutesForTest({ bus });

  const agents = await routes.get("/api/agents");
  assert.equal(agents.status, 200);
  assert.equal(agents.body.agents[0].name, "主 Agent");

  const sessions = await routes.get("/api/sessions", { agentId: "a1" });
  assert.equal(sessions.status, 200);
  assert.equal(sessions.body.sessions[0].title, "知识库维护");

  const missing = await routes.post("/api/agent-send", { wikiRoot, action: "query", deliveryMode: "existing" });
  assert.equal(missing.status, 422);
  assert.equal(missing.body.error, "sessionPath_required");

  const sent = await routes.post("/api/agent-send", {
    wikiRoot,
    agentId: "a1",
    action: "maintenance",
    input: "检查断链和来源覆盖",
  });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.ok, true);
  assert.equal(sent.body.action, "maintenance");
  assert.equal(sent.body.deliveryMode, "new");
  assert.equal(sent.body.sessionPath, "/agents/a1/sessions/new.jsonl");
  assert.match(sent.body.prompt, /任务类型：维护检查/);
  assert.equal(sent.body.result.accepted, true);
  assert.deepEqual(calls.map(([type]) => type), ["agent:list", "session:list", "session:create", "session:update", "session:send"]);
});

test("viewer API routes report busy Hana Agent sessions", async () => {
  const routes = registerRoutesForTest({
    bus: {
      async request(type) {
        if (type === "session:send") throw new Error("session_busy");
        return {};
      },
    },
  });
  const result = await routes.post("/api/agent-send", {
    wikiRoot: path.join(await tempDir(), "busy-wiki"),
    sessionPath: "/agents/a/sessions/busy.jsonl",
    deliveryMode: "existing",
    action: "ingest",
    input: "https://example.com",
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error, "session_busy");
  assert.equal(result.body.action, "ingest");
  assert.equal(result.body.deliveryMode, "existing");
  assert.equal(result.body.sessionPath, "/agents/a/sessions/busy.jsonl");
  assert.match(result.body.prompt, /任务类型：添加素材/);
});

test("viewer API routes report Hana session creation failures", async () => {
  const routes = registerRoutesForTest({
    bus: {
      async request(type) {
        if (type === "session:create") throw new Error("session_create_failed");
        throw new Error(`unexpected ${type}`);
      },
    },
  });
  const result = await routes.post("/api/agent-send", {
    wikiRoot: path.join(await tempDir(), "new-session-fail-wiki"),
    agentId: "a1",
    action: "context",
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error, "session_create_failed");
  assert.equal(result.body.deliveryMode, "new");
  assert.match(result.body.prompt, /启动当前知识库上下文/);
});

test("graph route shows a Chinese placeholder before graph generation", async () => {
  const routes = registerRoutesForTest();
  const wikiRoot = await createSampleWiki();
  const graph = await routes.get("/graph", { wikiRoot });
  assert.equal(graph.status, 404);
  assert.match(graph.body, /图谱还没有生成/);
  assert.match(graph.body, /生成\/刷新/);
  assert.match(graph.body, /首次使用时插件会先安全初始化/);
  assert.doesNotMatch(graph.body, /Not found\. Generate the graph first\./);
});

test("graph placeholder follows the selected viewer theme", async () => {
  const routes = registerRoutesForTest();
  const wikiRoot = await createSampleWiki();
  const graph = await routes.get("/graph", { wikiRoot, theme: "dark" });
  assert.equal(graph.status, 404);
  assert.match(graph.body, /body\[data-effective-theme="dark"\]/);
  assert.match(graph.body, /<body data-effective-theme="dark">/);
});

test("viewer renders diagnostics as a closable drawer", async () => {
  const routes = registerRoutesForTest();
  const viewer = await routes.get("/viewer", { wikiRoot: await createSampleWiki() });
  assert.equal(viewer.status, 200);
  assert.doesNotMatch(viewer.body, /list="wikiRoots"/);
  assert.doesNotMatch(viewer.body, /<datalist id="wikiRoots">/);
  assert.match(viewer.body, /<select id="savedRoots"/);
  assert.match(viewer.body, /已保存位置/);
  assert.match(viewer.body, /id="openFolder" class="icon-button" title="访问文件夹" aria-label="访问文件夹"/);
  assert.match(viewer.body, /function openCurrentFolder\(\)/);
  assert.match(viewer.body, /api\/open-folder/);
  assert.match(viewer.body, /api\/current-root/);
  assert.match(viewer.body, /function rememberCurrentRoot\(\)/);
  assert.match(viewer.body, /id="removeRoot" class="icon-button" title="删除位置" aria-label="删除位置"/);
  assert.match(viewer.body, /id="saveRoot" class="icon-button" title="保存位置" aria-label="保存位置"/);
  assert.match(viewer.body, /\.icon-button svg/);
  assert.match(viewer.body, /id="themeMode" aria-label="主题"/);
  assert.match(viewer.body, /自动主题/);
  assert.match(viewer.body, /浅色/);
  assert.match(viewer.body, /深色/);
  assert.match(viewer.body, /data-hana-theme=/);
  assert.match(viewer.body, /body\[data-effective-theme="dark"\]/);
  assert.match(viewer.body, /function normalizeThemeMode\(value\)/);
  assert.match(viewer.body, /function applyThemeMode\(mode, options = \{\}\)/);
  assert.match(viewer.body, /localStorage\.setItem\(themeStorageKey, mode\)/);
  assert.match(viewer.body, /llm-wiki-viewer-theme-mode/);
  assert.match(viewer.body, /u\.searchParams\.set\("theme"/);
  assert.match(viewer.body, /themeModeSelect\.addEventListener\("change"/);
  assert.match(viewer.body, /shortRootName\(root\)/);
  assert.match(viewer.body, /function selectedRootForRemoval\(\)/);
  assert.match(viewer.body, /function updateRemoveRootButton\(\)/);
  assert.match(viewer.body, /rootInput\.addEventListener\("input", updateRemoveRootButton\)/);
  assert.match(viewer.body, /请选择或输入知识库位置/);
  assert.match(viewer.body, /先安全初始化再生成图谱/);
  assert.match(viewer.body, /function generateOrRefresh\(\)/);
  assert.match(viewer.body, /目标不是文件夹/);
  assert.match(viewer.body, /请换一个文件夹路径/);
  const generateOrRefresh = viewer.body.match(/async function generateOrRefresh\(\) \{[\s\S]*?buildButton\.addEventListener/)?.[0] || "";
  assert.doesNotMatch(generateOrRefresh, /openDrawer\(\)/);
  assert.doesNotMatch(generateOrRefresh, /window\.confirm/);
  assert.match(generateOrRefresh, /refreshStatus\(\{ openHelp: false \}\)/);
  assert.match(viewer.body, /mode = status\.graphExists \? "refresh" : "generate"/);
  assert.match(viewer.body, /刷新完成/);
  assert.match(viewer.body, /function defaultTopic\(\)/);
  assert.match(viewer.body, /lockButton\(buildButton, !hasRoot \|\| !data\.skillRootExists\)/);
  assert.doesNotMatch(viewer.body, /lockButton\(buildButton, !isWiki \|\| !data\.skillRootExists\)/);
  assert.match(viewer.body, /id="drawer"/);
  assert.match(viewer.body, /id="closeDrawer"/);
  assert.match(viewer.body, /drawer-open/);
  assert.match(viewer.body, /transform:translateX\(100%\)/);
  assert.match(viewer.body, /function openDrawer\(\)/);
  assert.match(viewer.body, /closeDrawerButton\.addEventListener\("click", closeDrawer\)/);
  assert.match(viewer.body, /id="runDiagnostics">运行诊断/);
  assert.match(viewer.body, /id="lint">结构检查/);
  assert.match(viewer.body, /id="coverage">来源覆盖/);
  assert.match(viewer.body, /id="sourceDiagnostics">来源诊断/);
  assert.match(viewer.body, /id="maintenanceDiagnostics">维护诊断/);
  assert.match(viewer.body, /id="init">初始化/);
  assert.match(viewer.body, /研究目标文件/);
  assert.match(viewer.body, /Mermaid 图谱/);
  assert.match(viewer.body, /图谱契约/);
  assert.match(viewer.body, /来源信号/);
  assert.match(viewer.body, /运行环境/);
  assert.match(viewer.body, /function formatGraphContract/);
  assert.match(viewer.body, /graphContractSummary/);
  assert.match(viewer.body, /function runSourceDiagnostics\(\)/);
  assert.match(viewer.body, /function runMaintenanceDiagnostics\(\)/);
  assert.match(viewer.body, /api\/source-image-diagnostics/);
  assert.match(viewer.body, /api\/source-contract-diagnostics/);
  assert.match(viewer.body, /api\/maintenance-diagnostics/);
  assert.match(viewer.body, /基础状态/);
  assert.match(viewer.body, /图谱诊断/);
  assert.match(viewer.body, /维护诊断/);
  assert.match(viewer.body, /孤儿 raw 文件/);
  assert.match(viewer.body, /陈旧 cache/);
  assert.match(viewer.body, /source frontmatter 问题/);
  assert.match(viewer.body, /缺来源信号页面/);
  assert.match(viewer.body, /query\/digest 索引缺口/);
  assert.match(viewer.body, /任务已发送到/);
  assert.match(viewer.body, /Agent 工作流/);
  assert.match(viewer.body, /body \{ display:grid; grid-template-rows:auto 1fr; overflow:hidden; position:relative; \}/);
  assert.match(viewer.body, /\.agent-panel \{ position:absolute; z-index:8;/);
  assert.match(viewer.body, /id="agentToggle" class="icon-button" title="Agent 工作流" aria-label="Agent 工作流" aria-controls="agentPanel" aria-expanded="false"/);
  assert.match(viewer.body, /id="agentPanel" class="agent-panel" aria-label="Agent 工作流" hidden/);
  assert.match(viewer.body, /agent-target-grid/);
  assert.match(viewer.body, /agent-task-grid/);
  assert.match(viewer.body, /agent-command-group/);
  assert.match(viewer.body, /id="agentModeLabel">新会话优先/);
  assert.match(viewer.body, /续聊模式/);
  assert.match(viewer.body, /function toggleAgentPanel\(\)/);
  assert.match(viewer.body, /function setAgentPanelOpen\(open, options = \{\}\)/);
  assert.match(viewer.body, /function notifyGraphResize\(\)/);
  assert.match(viewer.body, /contentWindow\?\.dispatchEvent\(new Event\("resize"\)\)/);
  assert.match(viewer.body, /id="agentSelect"/);
  assert.match(viewer.body, /id="deliveryMode"/);
  assert.match(viewer.body, /新建会话/);
  assert.match(viewer.body, /发送到已有会话/);
  assert.match(viewer.body, /id="agentModeNote" class="agent-mode-note">新会话/);
  assert.doesNotMatch(viewer.body, /避免污染当前上下文/);
  assert.doesNotMatch(viewer.body, /只在需要续聊时选择已有会话/);
  assert.match(viewer.body, /id="sessionSelect"/);
  assert.match(viewer.body, /id="agentAction"/);
  assert.match(viewer.body, /启动知识库上下文/);
  assert.match(viewer.body, /可留空；插件会发送当前知识库上下文/);
  assert.match(viewer.body, /function updateAgentInputPlaceholder\(\)/);
  assert.match(viewer.body, /已把当前知识库上下文发送到/);
  assert.match(viewer.body, /function updateAgentDeliveryMode\(\)/);
  assert.match(viewer.body, /aria-label="刷新 Agent"/);
  assert.match(viewer.body, /aria-label="复制 Prompt"/);
  assert.match(viewer.body, /aria-label="清空内容"/);
  assert.match(viewer.body, /function copyAgentPrompt\(\)/);
  assert.match(viewer.body, /function writeClipboardText\(text\)/);
  assert.match(viewer.body, /clipboard\.writeText/);
  assert.match(viewer.body, /Agent 投递摘要/);
  assert.match(viewer.body, /任务类型: /);
  assert.match(viewer.body, /目标会话: /);
  assert.match(viewer.body, /已接收: /);
  assert.match(viewer.body, /完整 Prompt/);
  assert.match(viewer.body, /目标会话正在生成。请稍后重试、换一个会话，或复制 Prompt 手动发送。/);
  assert.match(viewer.body, /添加素材/);
  assert.match(viewer.body, /深度整理/);
  assert.match(viewer.body, /更新页面/);
  assert.match(viewer.body, /维护检查/);
  assert.match(viewer.body, /结晶化对话/);
  assert.match(viewer.body, /id="sendAgent" class="primary">交给 Agent/);
  assert.match(viewer.body, /function refreshAgents\(\)/);
  assert.match(viewer.body, /function sendAgentWorkflow\(\)/);
  assert.match(viewer.body, /api\/agent-send/);
  const agentToggleIndex = viewer.body.indexOf('id="agentToggle"');
  const agentPanelIndex = viewer.body.indexOf('id="agentPanel"');
  const mainIndex = viewer.body.indexOf("<main>");
  const aside = viewer.body.match(/<aside[\s\S]*?<\/aside>/)?.[0] || "";
  assert.ok(agentToggleIndex > 0 && agentPanelIndex > agentToggleIndex && mainIndex > agentPanelIndex);
  assert.doesNotMatch(aside, /id="agentSelect"/);
  const header = viewer.body.match(/<header>[\s\S]*?<\/header>/)?.[0] || "";
  assert.match(header, /id="agentToggle"/);
  assert.match(header, /id="diagnostics">诊断/);
  assert.doesNotMatch(header, /id="safety"/);
  assert.doesNotMatch(header, /id="lint"/);
  assert.doesNotMatch(header, /id="coverage"/);
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

function registerRoutesForTest(options = {}) {
  const handlers = { get: new Map(), post: new Map(), delete: new Map() };
  const app = {
    get(pathname, handler) { handlers.get.set(pathname, handler); },
    post(pathname, handler) { handlers.post.set(pathname, handler); },
    delete(pathname, handler) { handlers.delete.set(pathname, handler); },
  };
  const ctx = {
    pluginId: "llm-wiki-viewer",
    config: options.config || createMemoryConfig(),
    bus: options.bus,
  };
  registerViewerRoutes(app, ctx);

  return {
    async get(pathname, query = {}) {
      const handler = handlers.get.get(pathname);
      assert.ok(handler, `Missing GET route ${pathname}`);
      return handler(createContext({}, query));
    },
    async post(pathname, body = {}) {
      const handler = handlers.post.get(pathname);
      assert.ok(handler, `Missing POST route ${pathname}`);
      return handler(createContext(body));
    },
    async delete(pathname, body = {}) {
      const handler = handlers.delete.get(pathname);
      assert.ok(handler, `Missing DELETE route ${pathname}`);
      return handler(createContext(body));
    },
  };
}

function createMemoryConfig(initial = {}, options = {}) {
  const state = { ...initial };
  const rejectKeys = new Set(options.rejectKeys || []);
  function rejectIfNeeded(values) {
    if (Object.keys(values).some((key) => rejectKeys.has(key))) {
      throw new Error("Plugin config validation failed");
    }
  }
  return {
    async get(key) {
      return state[key];
    },
    async set(key, value) {
      rejectIfNeeded({ [key]: value });
      if (value === undefined) delete state[key];
      else state[key] = value;
    },
    async setMany(values) {
      rejectIfNeeded(values);
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete state[key];
        else state[key] = value;
      }
      return { ...state };
    },
  };
}

function hasOpenHanakoReference() {
  return fs.existsSync(path.join(repoRoot, "reference", "openhanako-main", "core", "plugin-manager.js"));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createContext(body = {}, query = {}) {
  return {
    req: {
      async json() { return body; },
      query(key) { return query[key] || ""; },
      param() { return ""; },
      path: "",
    },
    json(value, status = 200) {
      return { body: value, status };
    },
    text(value, status = 200) {
      return { body: value, status };
    },
    html(value, status = 200) {
      return { body: value, status };
    },
  };
}
