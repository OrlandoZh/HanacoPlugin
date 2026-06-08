import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SCRIPT_TIMEOUT_MS = 60000;
const AGENT_WORKFLOW_SPECS = {
  context: {
    label: "启动知识库上下文",
    instruction: "请启动当前知识库上下文：读取知识库根目录下的 purpose.md、.wiki-schema.md、index.md，并准备按 obsidian-wiki-manager/references/llm-wiki/SKILL.md 的工作流处理后续任务。本消息只用于建立上下文和准备工作，不需要写入内容。",
  },
  ingest: {
    label: "添加素材",
    instruction: "请将用户输入中的链接、文件路径或粘贴文本作为素材，执行 ingest 工作流，把有价值的内容整理进知识库。",
  },
  "batch-ingest": {
    label: "批量消化",
    instruction: "请将用户输入中的文件夹路径或多条素材列表作为批量素材，执行 batch-ingest 工作流，逐项处理并汇总跳过/成功/失败情况。",
  },
  query: {
    label: "查询知识库",
    instruction: "请围绕用户问题执行 query 工作流，优先检索并综合当前知识库内容；如果回答值得持久化，请按 skill 规则询问用户是否保存。",
  },
  digest: {
    label: "深度整理",
    instruction: "请围绕用户主题执行 digest 工作流，跨素材综合，生成适合持久保存的深度报告或用户指定格式。",
  },
  update: {
    label: "更新页面",
    instruction: "请根据用户输入执行低风险更新：先定位相关 wiki 页面，说明拟更新内容；需要写入时按 llm-wiki 规则维护链接、source 线索和变更说明。",
  },
  maintenance: {
    label: "维护检查",
    instruction: "请执行知识库状态/健康检查：检查 schema、purpose、素材数量、lint 风险、断链、source_path 和后续维护建议。危险操作只做建议，不直接删除。",
  },
  crystallize: {
    label: "结晶化对话",
    instruction: "请将用户输入或当前会话中有价值的内容按 crystallize 工作流沉淀到知识库，使用 synthesis/session 约定并标明推断性内容。",
  },
};

export function getHome() {
  return process.env.HOME || process.env.USERPROFILE || "";
}

export function getSkillRoot() {
  return process.env.LLM_WIKI_SKILL_ROOT
    || path.join(getHome(), ".hanako", "skills", "obsidian-wiki-manager", "references", "llm-wiki");
}

export function getDefaultWikiRoot() {
  return process.env.LLM_WIKI_DEFAULT_ROOT || path.join(getHome(), "Documents", "llm-wiki");
}

export async function resolveWikiRoot(c, ctx, body = {}) {
  const fromBody = typeof body.wikiRoot === "string" ? body.wikiRoot : "";
  const fromQuery = c?.req?.query?.("wikiRoot") || "";
  const fromConfig = await readConfig(ctx, "defaultWikiRoot", "");
  return expandHome(fromBody || fromQuery || fromConfig || getDefaultWikiRoot());
}

export async function readConfig(ctx, key, fallback) {
  try {
    const value = await ctx?.config?.get?.(key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

export function normalizeWikiRootEntry(value) {
  const root = expandHome(value);
  return root ? path.resolve(root) : "";
}

export async function getSavedWikiRoots(ctx) {
  const saved = await readConfig(ctx, "savedWikiRoots", []);
  const defaultRoot = normalizeWikiRootEntry(await readConfig(ctx, "defaultWikiRoot", ""));
  const savedFromFile = await readSavedWikiRootsFile(ctx);
  const roots = Array.isArray(saved) ? saved : [];
  return uniqueWikiRoots([defaultRoot, ...roots, ...savedFromFile]);
}

export async function saveWikiRoot(ctx, wikiRoot) {
  const root = normalizeWikiRootEntry(wikiRoot);
  if (!root) return { ok: false, error: "wikiRoot_required", wikiRoot: root };

  const savedWikiRoots = uniqueWikiRoots([root, ...(await getSavedWikiRoots(ctx))]).slice(0, 20);
  try {
    if (typeof ctx?.config?.setMany === "function") {
      await ctx.config.setMany({ defaultWikiRoot: root, savedWikiRoots });
    } else {
      await ctx?.config?.set?.("defaultWikiRoot", root);
      await ctx?.config?.set?.("savedWikiRoots", savedWikiRoots);
    }
  } catch (error) {
    try {
      await ctx?.config?.set?.("defaultWikiRoot", root);
      await writeSavedWikiRootsFile(ctx, savedWikiRoots);
    } catch (fallbackError) {
      return {
        ok: false,
        error: "config_write_failed",
        wikiRoot: root,
        stderr: [error.message, fallbackError.message].filter(Boolean).join("\n"),
      };
    }
  }

  return {
    ok: true,
    wikiRoot: root,
    defaultWikiRoot: root,
    savedWikiRoots,
  };
}

export async function rememberWikiRoot(ctx, wikiRoot) {
  const root = normalizeWikiRootEntry(wikiRoot);
  if (!root) return { ok: false, error: "wikiRoot_required", wikiRoot: root };
  try {
    await ctx?.config?.set?.("defaultWikiRoot", root);
  } catch (error) {
    return {
      ok: false,
      error: "config_write_failed",
      wikiRoot: root,
      stderr: error.message,
    };
  }
  return {
    ok: true,
    wikiRoot: root,
    defaultWikiRoot: root,
  };
}

export async function removeSavedWikiRoot(ctx, wikiRoot) {
  const root = normalizeWikiRootEntry(wikiRoot);
  if (!root) return { ok: false, error: "wikiRoot_required", wikiRoot: root };

  const savedWikiRoots = (await getSavedWikiRoots(ctx)).filter((item) => item !== root);
  const currentDefault = normalizeWikiRootEntry(await readConfig(ctx, "defaultWikiRoot", ""));
  const defaultWikiRoot = currentDefault === root ? (savedWikiRoots[0] || "") : currentDefault;
  try {
    if (typeof ctx?.config?.setMany === "function") {
      await ctx.config.setMany({ defaultWikiRoot, savedWikiRoots });
    } else {
      await ctx?.config?.set?.("defaultWikiRoot", defaultWikiRoot);
      await ctx?.config?.set?.("savedWikiRoots", savedWikiRoots);
    }
  } catch (error) {
    try {
      await ctx?.config?.set?.("defaultWikiRoot", defaultWikiRoot);
      await writeSavedWikiRootsFile(ctx, savedWikiRoots);
    } catch (fallbackError) {
      return {
        ok: false,
        error: "config_write_failed",
        wikiRoot: root,
        stderr: [error.message, fallbackError.message].filter(Boolean).join("\n"),
      };
    }
  }

  return {
    ok: true,
    wikiRoot: root,
    defaultWikiRoot,
    savedWikiRoots,
  };
}

export async function resolveOpenFolderTarget(wikiRoot) {
  const root = normalizeWikiRootEntry(wikiRoot);
  if (!root) return { ok: false, error: "wikiRoot_required", wikiRoot: root };

  try {
    const stat = await fsp.stat(root);
    if (stat.isDirectory()) {
      return { ok: true, wikiRoot: root, targetPath: root, targetType: "directory" };
    }
    return { ok: true, wikiRoot: root, targetPath: root, targetType: "file" };
  } catch (error) {
    if (error.code !== "ENOENT") return { ok: false, error: error.message, wikiRoot: root };
  }

  let parent = path.dirname(root);
  while (parent && parent !== path.dirname(parent)) {
    try {
      const stat = await fsp.stat(parent);
      if (stat.isDirectory()) {
        return { ok: true, wikiRoot: root, targetPath: parent, targetType: "parent", missingPath: root };
      }
    } catch {
      // Keep walking upward until an existing parent directory is found.
    }
    parent = path.dirname(parent);
  }
  return { ok: false, error: "parent_not_found", wikiRoot: root };
}

export async function openWikiFolder(wikiRoot) {
  const target = await resolveOpenFolderTarget(wikiRoot);
  if (!target.ok) return target;

  const platform = process.platform;
  let command;
  let args;
  if (platform === "darwin") {
    command = "open";
    args = target.targetType === "file" ? ["-R", target.targetPath] : [target.targetPath];
  } else if (platform === "win32") {
    command = "explorer.exe";
    args = target.targetType === "file" ? ["/select,", target.targetPath] : [target.targetPath];
  } else {
    command = "xdg-open";
    args = [target.targetType === "file" ? path.dirname(target.targetPath) : target.targetPath];
  }

  try {
    await execFileAsync(command, args, { timeout: 10000 });
    return { ...target, command, args, opened: true };
  } catch (error) {
    return {
      ...target,
      ok: false,
      error: "open_failed",
      command,
      args,
      stderr: error.stderr || error.message,
      code: error.code ?? null,
    };
  }
}

export function expandHome(value) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  if (raw === "~") return getHome();
  if (raw.startsWith("~/")) return path.join(getHome(), raw.slice(2));
  return raw;
}

function uniqueWikiRoots(values) {
  const seen = new Set();
  const roots = [];
  for (const value of values || []) {
    const root = normalizeWikiRootEntry(value);
    if (!root || seen.has(root)) continue;
    seen.add(root);
    roots.push(root);
  }
  return roots;
}

async function readSavedWikiRootsFile(ctx) {
  const filePath = savedWikiRootsFile(ctx);
  if (!filePath) return [];
  try {
    const parsed = JSON.parse(await fsp.readFile(filePath, "utf8"));
    return Array.isArray(parsed?.wikiRoots) ? parsed.wikiRoots : [];
  } catch {
    return [];
  }
}

async function writeSavedWikiRootsFile(ctx, wikiRoots) {
  const filePath = savedWikiRootsFile(ctx);
  if (!filePath) throw new Error("plugin_data_dir_unavailable");
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify({ wikiRoots }, null, 2)}\n`, "utf8");
}

function savedWikiRootsFile(ctx) {
  return ctx?.dataDir ? path.join(ctx.dataDir, "wiki-roots.json") : "";
}

export async function getStatus(wikiRoot) {
  const root = expandHome(wikiRoot);
  const schema = path.join(root, ".wiki-schema.md");
  const wikiDir = path.join(root, "wiki");
  const graph = path.join(wikiDir, "knowledge-graph.html");
  const mermaidGraph = path.join(wikiDir, "knowledge-graph.md");
  const data = path.join(wikiDir, "graph-data.json");
  const index = path.join(root, "index.md");
  const purpose = path.join(root, "purpose.md");
  const cache = path.join(root, ".wiki-cache.json");
  const skillRoot = getSkillRoot();
  return {
    ok: fs.existsSync(schema) && fs.existsSync(wikiDir),
    wikiRoot: root,
    skillRoot,
    skillRootExists: fs.existsSync(skillRoot),
    schemaExists: fs.existsSync(schema),
    wikiDirExists: fs.existsSync(wikiDir),
    indexExists: fs.existsSync(index),
    purposeExists: fs.existsSync(purpose),
    cacheExists: fs.existsSync(cache),
    graphDataExists: fs.existsSync(data),
    graphExists: fs.existsSync(graph),
    mermaidGraphExists: fs.existsSync(mermaidGraph),
    purposePath: purpose,
    graphDataPath: data,
    graphPath: graph,
    mermaidGraphPath: mermaidGraph,
  };
}

export async function buildGraph(wikiRoot) {
  const status = await getStatus(wikiRoot);
  if (!status.ok) {
    return { ok: false, error: "not_llm_wiki_root", wikiRoot: status.wikiRoot, status };
  }

  const data = await runSkillScript("build-graph-data.sh", [status.wikiRoot]);
  if (!data.ok) return { ...data, wikiRoot: status.wikiRoot, status };

  const html = await runSkillScript("build-graph-html.sh", [status.wikiRoot]);
  if (!html.ok) return { ...html, wikiRoot: status.wikiRoot, status };

  return {
    ok: true,
    wikiRoot: status.wikiRoot,
    skillRoot: status.skillRoot,
    graphPath: path.join(status.wikiRoot, "wiki", "knowledge-graph.html"),
    stdout: [data.stdout, html.stdout].filter(Boolean).join("\n"),
    stderr: [data.stderr, html.stderr].filter(Boolean).join("\n"),
    status: await getStatus(status.wikiRoot),
  };
}

export async function lintWiki(wikiRoot) {
  const status = await getStatus(wikiRoot);
  if (!status.ok) {
    return { ok: false, error: "not_llm_wiki_root", wikiRoot: status.wikiRoot, status };
  }
  const result = await runSkillScript("lint-runner.sh", [status.wikiRoot]);
  if (result.stdout) result.stdout = filterLintReport(result.stdout);
  return { ...result, wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status };
}

export async function lintFixPreview(wikiRoot) {
  const status = await getStatus(wikiRoot);
  if (!status.ok) {
    return { ok: false, error: "not_llm_wiki_root", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status };
  }

  const result = await runSkillScript("lint-fix.sh", [status.wikiRoot, "--dry-run"]);
  const actions = parseLintFixPreviewActions(result.stdout);
  return {
    ...result,
    wikiRoot: status.wikiRoot,
    skillRoot: status.skillRoot,
    status,
    preview: true,
    actions,
    summary: {
      actions: actions.length,
      wouldModify: actions.length > 0,
    },
  };
}

export async function sourceCoverage(wikiRoot) {
  const status = await getStatus(wikiRoot);
  if (!status.ok) {
    return { ok: false, error: "not_llm_wiki_root", wikiRoot: status.wikiRoot, status };
  }

  const result = await runSkillScript("source-signal-coverage.js", [status.wikiRoot]);
  const output = {
    ...result,
    wikiRoot: status.wikiRoot,
    skillRoot: status.skillRoot,
    status,
  };
  if (result.stdout) {
    try {
      output.coverage = JSON.parse(result.stdout);
    } catch {
      // Keep raw stdout as the source of truth when the script emits non-JSON diagnostics.
    }
  }
  return output;
}

export async function sourceSignalEligibility(wikiRoot) {
  const status = await getStatus(wikiRoot);
  if (!status.ok) {
    return { ok: false, error: "not_llm_wiki_root", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status };
  }

  const scanKinds = [
    { subdir: "entities", pageType: "entity", applicable: true },
    { subdir: "topics", pageType: "topic", applicable: true },
    { subdir: "sources", pageType: "source", applicable: true },
    { subdir: "comparisons", pageType: "comparison", applicable: true },
    { subdir: "queries", pageType: "query", applicable: false },
    { subdir: "synthesis", pageType: "synthesis", applicable: false },
  ];
  const pages = [];
  for (const kind of scanKinds) {
    const dir = path.join(status.wikiRoot, "wiki", kind.subdir);
    for (const page of await collectMarkdownPagesInDirSafe(status.wikiRoot, dir)) {
      const content = await fsp.readFile(page.absolutePath, "utf8");
      const extracted = extractFrontmatterBlock(content);
      const eligibility = evaluateSourceSignalEligibility({
        applicable: kind.applicable,
        frontmatter: extracted.frontmatter,
      });
      pages.push({
        path: page.relativePath,
        pageType: kind.pageType,
        applicable: kind.applicable,
        hasFrontmatter: extracted.hasFrontmatter,
        eligible: eligibility.eligible,
        reason: eligibility.reason,
        sources: eligibility.sources,
      });
    }
  }

  const summary = {
    pages: pages.length,
    applicable: pages.filter((page) => page.applicable).length,
    eligible: pages.filter((page) => page.eligible).length,
    notApplicable: pages.filter((page) => page.reason === "not_applicable").length,
    missingSources: pages.filter((page) => page.reason === "missing_sources").length,
    emptySources: pages.filter((page) => page.reason === "empty_sources").length,
    invalidSources: pages.filter((page) => page.reason === "invalid_sources").length,
  };
  return {
    ok: summary.invalidSources === 0,
    wikiRoot: status.wikiRoot,
    skillRoot: status.skillRoot,
    status,
    summary,
    pages,
    stdout: formatSourceSignalEligibilitySummary(summary),
    stderr: "",
    code: 0,
  };
}

export async function runtimeContextStatus(wikiRoot) {
  const status = await getStatus(wikiRoot);
  if (!status.ok) {
    return { ok: false, error: "not_llm_wiki_root", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status };
  }

  const skillRoot = status.skillRoot;
  const layoutMode = fs.existsSync(path.join(skillRoot, ".git")) ? "source_checkout" : "installed_skill";
  const optionalAdapterRoot = layoutMode === "source_checkout" ? path.join(skillRoot, "deps") : path.dirname(skillRoot);
  const paths = {
    skillRoot,
    scriptsDir: path.join(skillRoot, "scripts"),
    runtimeContextScript: path.join(skillRoot, "scripts", "runtime-context.sh"),
    sourceRegistry: path.join(skillRoot, "scripts", "source-registry.sh"),
    adapterState: path.join(skillRoot, "scripts", "adapter-state.sh"),
    optionalAdapterRoot,
  };
  const checks = {
    skillRootExists: fs.existsSync(paths.skillRoot),
    scriptsDirExists: fs.existsSync(paths.scriptsDir),
    runtimeContextExists: fs.existsSync(paths.runtimeContextScript),
    sourceRegistryExists: fs.existsSync(paths.sourceRegistry),
    adapterStateExists: fs.existsSync(paths.adapterState),
    optionalAdapterRootExists: fs.existsSync(paths.optionalAdapterRoot),
  };
  const missing = Object.entries(checks)
    .filter(([, exists]) => !exists)
    .map(([key]) => key);
  const summary = {
    layoutMode,
    optionalAdapterRoot,
    missing: missing.length,
  };
  return {
    ok: missing.length === 0,
    wikiRoot: status.wikiRoot,
    skillRoot,
    status,
    layoutMode,
    optionalAdapterRoot,
    paths,
    checks,
    missing,
    summary,
    stdout: formatRuntimeContextStatusSummary(summary, checks),
    stderr: "",
    code: 0,
  };
}

export async function sourceRegistry() {
  const result = await runSkillScript("source-registry.sh", ["list"]);
  const output = {
    ...result,
    skillRoot: getSkillRoot(),
  };
  if (result.stdout) {
    output.sources = parseTsv(result.stdout);
    output.counts = countBy(output.sources, "source_category");
  }
  return output;
}

export async function sourceRegistryLookup(command, value) {
  const commandName = String(command || "").trim();
  const lookupValue = String(value || "").trim();
  if (!["get", "match-url", "match-file"].includes(commandName)) {
    return { ok: false, error: "unsupported_source_registry_command", skillRoot: getSkillRoot() };
  }
  if (!lookupValue) {
    return { ok: false, error: "source_registry_value_required", skillRoot: getSkillRoot() };
  }

  const result = await runSkillScript("source-registry.sh", [commandName, lookupValue]);
  const output = {
    ...result,
    command: commandName,
    value: lookupValue,
    skillRoot: getSkillRoot(),
  };
  if (result.stdout) {
    output.sources = parseSourceRegistryRows(result.stdout);
    output.source = output.sources[0] || null;
  }
  return output;
}

export async function adapterStatus(input = {}) {
  const sourceId = String(input.sourceId || "").trim();
  const args = sourceId ? ["check", sourceId] : ["summary-human"];
  const result = await runSkillScript("adapter-state.sh", args);
  const output = {
    ...result,
    sourceId: sourceId || undefined,
    skillRoot: getSkillRoot(),
  };
  if (result.stdout && sourceId) {
    output.adapters = parseTsv(result.stdout);
  }
  return output;
}

export async function adapterClassify(input = {}) {
  const sourceId = String(input.sourceId || "").trim();
  const exitCode = String(input.exitCode ?? "").trim();
  const outputPath = expandHome(input.outputPath || "");
  if (!sourceId) return { ok: false, error: "sourceId_required", skillRoot: getSkillRoot() };
  if (!/^-?\d+$/.test(exitCode)) return { ok: false, error: "exitCode_required", sourceId, skillRoot: getSkillRoot() };
  if (!outputPath) return { ok: false, error: "outputPath_required", sourceId, skillRoot: getSkillRoot() };

  const result = await runSkillScript("adapter-state.sh", ["classify-run", sourceId, exitCode, outputPath]);
  const output = {
    ...result,
    sourceId,
    exitCode: Number(exitCode),
    outputPath,
    skillRoot: getSkillRoot(),
  };
  if (result.stdout) output.adapters = parseTsv(result.stdout);
  return output;
}

export async function diagnostics(wikiRoot) {
  const status = await getStatus(wikiRoot);
  if (!status.ok) {
    return { ok: false, error: "not_llm_wiki_root", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status };
  }

  const counts = await collectWikiCounts(status.wikiRoot);
  const [coverage, eligibility, runtimeContext, registry, adapters, sourceImages, sourceContracts, links, graphPaths, maintenance] = await Promise.all([
    sourceCoverage(status.wikiRoot),
    sourceSignalEligibility(status.wikiRoot),
    runtimeContextStatus(status.wikiRoot),
    sourceRegistry(),
    adapterStatus(),
    sourceImageDiagnostics(status.wikiRoot),
    sourceContractDiagnostics(status.wikiRoot),
    linkDiagnostics(status.wikiRoot),
    graphSourcePaths(status.wikiRoot),
    maintenanceDiagnostics(status.wikiRoot),
  ]);
  const coverageSummary = coverage.coverage?.summary || null;
  const adapterSummary = summarizeAdapterOutput(adapters.stdout);
  const purposeSummary = await summarizePurpose(status.wikiRoot);
  const graphContractSummary = await summarizeGraphContract(status, links, graphPaths, coverageSummary);
  const warnings = [];
  if (!status.skillRootExists) warnings.push("skill_root_missing");
  if (!status.purposeExists) warnings.push("purpose_missing");
  if (!status.graphDataExists) warnings.push("graph_data_missing");
  if (!status.graphExists) warnings.push("graph_html_missing");
  if (!coverage.ok) warnings.push("source_coverage_failed");
  if (!eligibility.ok) warnings.push("source_signal_eligibility_issues");
  if (!runtimeContext.ok) warnings.push("runtime_context_issues");
  if (!registry.ok) warnings.push("source_registry_failed");
  if (!adapters.ok) warnings.push("adapter_status_failed");
  if (!sourceImages.ok) warnings.push("source_image_diagnostics_failed");
  if (!sourceContracts.ok) warnings.push("source_contract_diagnostics_failed");
  if (!links.ok) warnings.push("link_diagnostics_failed");
  if (!graphPaths.ok) warnings.push("graph_source_paths_failed");
  if ((maintenance.warnings || []).length > 0) warnings.push("maintenance_diagnostics_issues");
  if (!graphContractSummary.ok) warnings.push("graph_contract_issues");

  return {
    ok: true,
    wikiRoot: status.wikiRoot,
    skillRoot: status.skillRoot,
    status: await getStatus(status.wikiRoot),
    counts,
    coverageSummary,
    eligibilitySummary: eligibility.summary || null,
    runtimeContextSummary: runtimeContext.summary || null,
    adapterSummary,
    purposeSummary,
    sourceImageSummary: sourceImages.summary || null,
    sourceContractSummary: sourceContracts.summary || null,
    linkSummary: links.summary || null,
    graphSourcePathSummary: graphPaths.summary || null,
    graphContractSummary,
    maintenanceSummary: maintenance.summary || null,
    sourceRegistryCounts: registry.counts || {},
    warnings,
    stdout: [
      formatDiagnosticsSummary(counts, coverageSummary, adapterSummary, warnings, {
        purposeSummary,
        eligibilitySummary: eligibility.summary,
        runtimeContextSummary: runtimeContext.summary,
        sourceImageSummary: sourceImages.summary,
        sourceContractSummary: sourceContracts.summary,
        linkSummary: links.summary,
        graphSourcePathSummary: graphPaths.summary,
        graphContractSummary,
        maintenanceSummary: maintenance.summary,
      }),
      adapters.stdout ? `\nAdapter status:\n${adapters.stdout.trim()}` : "",
    ].filter(Boolean).join("\n"),
    stderr: [coverage.stderr, eligibility.stderr, runtimeContext.stderr, registry.stderr, adapters.stderr, sourceImages.stderr, sourceContracts.stderr, links.stderr, graphPaths.stderr, maintenance.stderr].filter(Boolean).join("\n"),
  };
}

export async function maintenanceDiagnostics(wikiRoot) {
  const status = await getStatus(wikiRoot);
  if (!status.ok) {
    return { ok: false, error: "not_llm_wiki_root", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status };
  }

  const [sourceContracts, links, purposeSummary, eligibility] = await Promise.all([
    sourceContractDiagnostics(status.wikiRoot),
    linkDiagnostics(status.wikiRoot),
    summarizePurpose(status.wikiRoot),
    sourceSignalEligibility(status.wikiRoot),
  ]);
  const sourcePages = await collectSourcePages(status.wikiRoot);
  const sourceReferences = await collectSourceReferenceCounts(status.wikiRoot, sourcePages);
  const orphanSources = sourcePages
    .filter((page) => (sourceReferences.get(page.relativePath) || 0) === 0)
    .map((page) => page.relativePath);
  const rawFiles = await collectRawFiles(status.wikiRoot);
  const orphanRawFiles = await collectOrphanRawFiles(status.wikiRoot, rawFiles, sourcePages);
  const cache = await readWikiCache(status.wikiRoot);
  const staleCacheEntries = await collectStaleCacheEntries(status.wikiRoot, cache);
  const sourceFrontmatterIssues = await collectSourceFrontmatterIssues(sourcePages);
  const missingSourceSignals = (eligibility.pages || [])
    .filter((page) => page.applicable && page.reason !== "ok")
    .map((page) => ({
      path: page.path,
      pageType: page.pageType,
      reason: page.reason,
    }));
  const queryDigestIndexStatus = await collectQueryDigestIndexStatus(status.wikiRoot);
  const purposeHints = await collectPurposeHints(status.wikiRoot, purposeSummary);
  const duplicateTitles = links.duplicateTitles || [];
  const missingSourcePaths = sourceContracts.missingSourcePath || [];
  const brokenRawFiles = [
    ...(sourceContracts.missingRawFiles || []),
    ...(sourceContracts.outsideWikiRoot || []),
  ];
  const warnings = [];
  if (!sourceContracts.ok) warnings.push("source_contract_issues");
  if (!links.ok) warnings.push("link_diagnostics_issues");
  if (orphanSources.length > 0) warnings.push("orphan_sources");
  if (orphanRawFiles.length > 0) warnings.push("orphan_raw_files");
  if (staleCacheEntries.length > 0) warnings.push("stale_cache_entries");
  if (sourceFrontmatterIssues.length > 0) warnings.push("source_frontmatter_issues");
  if (missingSourceSignals.length > 0) warnings.push("missing_source_signals");
  if (queryDigestIndexStatus.missingFromIndex.length > 0) warnings.push("query_digest_index_gaps");
  if (purposeHints.length > 0) warnings.push("purpose_needs_attention");

  const summary = {
    sourcePages: sourcePages.length,
    rawFiles: rawFiles.length,
    orphanSources: orphanSources.length,
    orphanRawFiles: orphanRawFiles.length,
    missingSourcePaths: missingSourcePaths.length,
    brokenRawFiles: brokenRawFiles.length,
    staleCacheEntries: staleCacheEntries.length,
    sourceFrontmatterIssues: sourceFrontmatterIssues.length,
    missingSourceSignals: missingSourceSignals.length,
    queryDigestIndexGaps: queryDigestIndexStatus.missingFromIndex.length,
    duplicateTitles: duplicateTitles.length,
    purposeHints: purposeHints.length,
  };

  return {
    ok: true,
    wikiRoot: status.wikiRoot,
    skillRoot: status.skillRoot,
    status,
    summary,
    orphanSources,
    orphanRawFiles,
    missingSourcePaths,
    brokenRawFiles,
    staleCacheEntries,
    sourceFrontmatterIssues,
    missingSourceSignals,
    queryDigestIndexStatus,
    duplicateTitles,
    purposeHints,
    warnings,
    stdout: formatMaintenanceDiagnosticsSummary(summary, warnings),
    stderr: [sourceContracts.stderr, links.stderr, eligibility.stderr, cache.ok ? "" : cache.error].filter(Boolean).join("\n"),
    code: 0,
  };
}

export async function deleteDryRun(input = {}) {
  const status = await getStatus(input.wikiRoot);
  if (!status.ok) {
    return { ok: false, error: "not_llm_wiki_root", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status };
  }
  const sourceFile = String(input.sourceFile || "").trim();
  if (!sourceFile) {
    return { ok: false, error: "sourceFile_required", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status };
  }

  const result = await runSkillScript("delete-helper.sh", ["scan-refs", status.wikiRoot, sourceFile]);
  return {
    ...result,
    wikiRoot: status.wikiRoot,
    skillRoot: status.skillRoot,
    sourceFile,
    references: parseLines(result.stdout),
    status,
  };
}

export async function linkDiagnostics(wikiRoot) {
  const status = await getStatus(wikiRoot);
  if (!status.ok) {
    return { ok: false, error: "not_llm_wiki_root", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status };
  }

  const pages = (await collectMarkdownPages(status.wikiRoot)).filter((page) => !isSeedNavigationPage(page.relativePath));
  const byRel = new Map(pages.map((page) => [normalizePageKey(page.relativePath), page]));
  const byStem = new Map();
  for (const page of pages) {
    const stem = path.basename(page.relativePath, ".md").toLowerCase();
    if (!byStem.has(stem)) byStem.set(stem, []);
    byStem.get(stem).push(page);
  }

  const inbound = new Map(pages.map((page) => [page.relativePath, 0]));
  const brokenLinks = [];
  for (const page of pages) {
    const content = await fsp.readFile(page.absolutePath, "utf8");
    for (const target of extractWikiLinks(content)) {
      const resolved = resolveWikiLink(target, byRel, byStem);
      if (resolved) {
        inbound.set(resolved.relativePath, (inbound.get(resolved.relativePath) || 0) + 1);
      } else {
        brokenLinks.push({ from: page.relativePath, target, type: "wiki_link" });
      }
    }
    for (const target of extractMarkdownLinks(content)) {
      const resolved = resolveMarkdownLink(page.relativePath, target, byRel);
      if (resolved) {
        inbound.set(resolved.relativePath, (inbound.get(resolved.relativePath) || 0) + 1);
      } else {
        brokenLinks.push({ from: page.relativePath, target, type: "markdown_link" });
      }
    }
  }

  const duplicateTitles = [...byStem.entries()]
    .filter(([, matches]) => matches.length > 1)
    .map(([title, matches]) => ({ title, paths: matches.map((page) => page.relativePath) }));
  const orphanPages = pages
    .filter((page) => page.relativePath.startsWith("wiki/") && (inbound.get(page.relativePath) || 0) === 0)
    .map((page) => page.relativePath);
  const summary = {
    pages: pages.length,
    brokenLinks: brokenLinks.length,
    orphanPages: orphanPages.length,
    duplicateTitles: duplicateTitles.length,
  };

  return {
    ok: true,
    wikiRoot: status.wikiRoot,
    skillRoot: status.skillRoot,
    status,
    summary,
    brokenLinks,
    orphanPages,
    duplicateTitles,
    stdout: formatLinkDiagnosticsSummary(summary),
    stderr: "",
    code: 0,
  };
}

export async function graphSourcePaths(wikiRoot) {
  const status = await getStatus(wikiRoot);
  if (!status.ok) {
    return { ok: false, error: "not_llm_wiki_root", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status };
  }
  if (!status.graphDataExists) {
    return { ok: false, error: "graph_data_missing", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status };
  }

  let data;
  try {
    data = JSON.parse(await fsp.readFile(status.graphDataPath, "utf8"));
  } catch (error) {
    return { ok: false, error: "graph_data_invalid", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status, stderr: error.message, code: null };
  }

  const wikiDir = path.resolve(status.wikiRoot, "wiki");
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const missingSourcePath = [];
  const outsideWiki = [];
  const missingFiles = [];
  for (const node of nodes) {
    if (!node || typeof node.source_path !== "string" || !node.source_path.trim()) {
      missingSourcePath.push(node?.id || node?.label || "(unknown)");
      continue;
    }
    const sourcePath = path.resolve(status.wikiRoot, node.source_path);
    if (!sourcePath.startsWith(wikiDir + path.sep)) {
      outsideWiki.push({ node: node.id || node.label || "(unknown)", source_path: node.source_path });
      continue;
    }
    if (!fs.existsSync(sourcePath)) {
      missingFiles.push({ node: node.id || node.label || "(unknown)", source_path: node.source_path });
    }
  }
  const summary = {
    nodes: nodes.length,
    withSourcePath: nodes.length - missingSourcePath.length,
    missingSourcePath: missingSourcePath.length,
    outsideWiki: outsideWiki.length,
    missingFiles: missingFiles.length,
  };
  return {
    ok: missingSourcePath.length === 0 && outsideWiki.length === 0 && missingFiles.length === 0,
    wikiRoot: status.wikiRoot,
    skillRoot: status.skillRoot,
    status,
    summary,
    missingSourcePath,
    outsideWiki,
    missingFiles,
    stdout: formatGraphSourcePathSummary(summary),
    stderr: "",
    code: 0,
  };
}

export async function sourceImageDiagnostics(wikiRoot) {
  const status = await getStatus(wikiRoot);
  if (!status.ok) {
    return { ok: false, error: "not_llm_wiki_root", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status };
  }

  const pages = await collectSourcePages(status.wikiRoot);
  const missingImagePaths = [];
  const emptyImagePaths = [];
  const imageCountMismatches = [];
  const invalidImageCounts = [];
  for (const page of pages) {
    const frontmatter = await readFrontmatter(page.absolutePath);
    const images = Number.parseInt(String(frontmatter.images ?? "0"), 10);
    const imagePaths = parseFrontmatterList(frontmatter.image_paths);
    if (!Number.isFinite(images) || images < 0) {
      invalidImageCounts.push({ page: page.relativePath, images: frontmatter.images ?? "" });
    }
    if (images > 0 && imagePaths.length === 0) {
      emptyImagePaths.push(page.relativePath);
    }
    if (imagePaths.length > 0 && Number.isFinite(images) && images !== imagePaths.length) {
      imageCountMismatches.push({ page: page.relativePath, images, imagePaths: imagePaths.length });
    }
    for (const imagePath of imagePaths) {
      const absolute = resolveWikiScopedPath(status.wikiRoot, imagePath);
      if (!isInside(status.wikiRoot, absolute) || !fs.existsSync(absolute)) {
        missingImagePaths.push({ page: page.relativePath, image_path: imagePath });
      }
    }
  }
  const summary = {
    sourcePages: pages.length,
    emptyImagePaths: emptyImagePaths.length,
    missingImagePaths: missingImagePaths.length,
    imageCountMismatches: imageCountMismatches.length,
    invalidImageCounts: invalidImageCounts.length,
  };
  return {
    ok: summary.emptyImagePaths === 0 && summary.missingImagePaths === 0 && summary.imageCountMismatches === 0 && summary.invalidImageCounts === 0,
    wikiRoot: status.wikiRoot,
    skillRoot: status.skillRoot,
    status,
    summary,
    emptyImagePaths,
    missingImagePaths,
    imageCountMismatches,
    invalidImageCounts,
    stdout: formatSourceImageDiagnosticsSummary(summary),
    stderr: "",
    code: 0,
  };
}

export async function sourceContractDiagnostics(wikiRoot) {
  const status = await getStatus(wikiRoot);
  if (!status.ok) {
    return { ok: false, error: "not_llm_wiki_root", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status };
  }

  const pages = await collectSourcePages(status.wikiRoot);
  const cache = await readWikiCache(status.wikiRoot);
  const missingSourcePath = [];
  const missingRawFiles = [];
  const outsideWikiRoot = [];
  const cacheMissing = [];
  const cacheMismatches = [];
  for (const page of pages) {
    const frontmatter = await readFrontmatter(page.absolutePath);
    const rawPath = String(frontmatter.source_path || "").trim();
    if (!rawPath) {
      missingSourcePath.push(page.relativePath);
      continue;
    }
    const absoluteRaw = resolveWikiScopedPath(status.wikiRoot, rawPath);
    if (!isInside(status.wikiRoot, absoluteRaw)) {
      outsideWikiRoot.push({ page: page.relativePath, source_path: rawPath });
      continue;
    }
    if (!fs.existsSync(absoluteRaw)) {
      missingRawFiles.push({ page: page.relativePath, source_path: rawPath });
    }
    const relativeRaw = normalizeSlash(path.relative(status.wikiRoot, absoluteRaw));
    const entry = cache.entries?.[relativeRaw];
    if (!entry) {
      cacheMissing.push({ page: page.relativePath, source_path: rawPath });
    } else if (entry.source_page && normalizeSlash(entry.source_page) !== page.relativePath) {
      cacheMismatches.push({ page: page.relativePath, source_path: rawPath, cache_source_page: entry.source_page });
    }
  }
  const summary = {
    sourcePages: pages.length,
    missingSourcePath: missingSourcePath.length,
    missingRawFiles: missingRawFiles.length,
    outsideWikiRoot: outsideWikiRoot.length,
    cacheMissing: cacheMissing.length,
    cacheMismatches: cacheMismatches.length,
    cacheReadable: cache.ok,
  };
  return {
    ok: summary.missingSourcePath === 0 && summary.missingRawFiles === 0 && summary.outsideWikiRoot === 0 && summary.cacheMissing === 0 && summary.cacheMismatches === 0,
    wikiRoot: status.wikiRoot,
    skillRoot: status.skillRoot,
    status,
    summary,
    missingSourcePath,
    missingRawFiles,
    outsideWikiRoot,
    cacheMissing,
    cacheMismatches,
    stdout: formatSourceContractDiagnosticsSummary(summary),
    stderr: cache.ok ? "" : cache.error,
    code: 0,
  };
}

export async function cacheStatus(input = {}) {
  const status = await getStatus(input.wikiRoot);
  if (!status.ok) {
    return { ok: false, error: "not_llm_wiki_root", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status };
  }
  const filePath = resolveWikiScopedPath(status.wikiRoot, input.filePath || "");
  if (!filePath) {
    return { ok: false, error: "filePath_required", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status };
  }
  if (!isInside(status.wikiRoot, filePath)) {
    return { ok: false, error: "filePath_outside_wiki_root", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, filePath, status };
  }

  const state = await readOnlyCacheCheck(status.wikiRoot, filePath);
  return {
    ok: true,
    wikiRoot: status.wikiRoot,
    skillRoot: status.skillRoot,
    filePath,
    stdout: `${state}\n`,
    stderr: "",
    code: 0,
    cacheState: parseCacheState(state),
    status,
  };
}

export async function sourcePageContractPreview(input = {}) {
  const status = await getStatus(input.wikiRoot);
  if (!status.ok) {
    return { ok: false, error: "not_llm_wiki_root", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status };
  }

  const rawFile = resolveWikiScopedPath(status.wikiRoot, input.rawFile || "");
  const outputPath = normalizeSourceOutputPath(input.outputPath || "");
  const contentFile = expandHome(input.contentFile || "");
  if (!rawFile) return { ok: false, error: "rawFile_required", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status };
  if (!outputPath) return { ok: false, error: "outputPath_required", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status };
  if (!contentFile) return { ok: false, error: "contentFile_required", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status };
  if (!isInside(status.wikiRoot, rawFile)) {
    return { ok: false, error: "rawFile_outside_wiki_root", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, rawFile, status };
  }

  const fullOutputPath = path.resolve(status.wikiRoot, outputPath);
  if (!isInside(path.join(status.wikiRoot, "wiki", "sources"), fullOutputPath)) {
    return { ok: false, error: "outputPath_outside_sources", wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, outputPath, fullOutputPath, status };
  }

  const checks = {
    rawFileExists: fs.existsSync(rawFile) && fs.statSync(rawFile).isFile(),
    contentFileExists: fs.existsSync(contentFile) && fs.statSync(contentFile).isFile(),
    outputExists: fs.existsSync(fullOutputPath),
    outputParentExists: fs.existsSync(path.dirname(fullOutputPath)),
  };
  const cacheState = checks.rawFileExists ? parseCacheState(await readOnlyCacheCheck(status.wikiRoot, rawFile)) : null;
  const issues = [];
  if (!checks.rawFileExists) issues.push("raw_file_missing");
  if (!checks.contentFileExists) issues.push("content_file_missing");
  if (checks.outputExists) issues.push("output_would_overwrite");

  const summary = {
    issues: issues.length,
    wouldWriteSourcePage: issues.length === 0,
    wouldUpdateCache: issues.length === 0,
    cacheHit: Boolean(cacheState?.hit),
  };
  return {
    ok: issues.length === 0,
    wikiRoot: status.wikiRoot,
    skillRoot: status.skillRoot,
    status,
    preview: true,
    rawFile,
    outputPath,
    fullOutputPath,
    contentFile,
    checks,
    cacheState,
    issues,
    summary,
    stdout: formatSourcePageContractPreviewSummary(summary, issues, { rawFile, outputPath, contentFile, cacheState }),
    stderr: "",
    code: 0,
  };
}

export async function validateStep1(input = {}) {
  const jsonFile = expandHome(input.jsonFile || "");
  if (!jsonFile) return { ok: false, error: "jsonFile_required", skillRoot: getSkillRoot() };
  const result = await runSkillScript("validate-step1.sh", [jsonFile]);
  return {
    ...result,
    jsonFile,
    skillRoot: getSkillRoot(),
  };
}

export async function listHanaAgents(ctx) {
  try {
    if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", agents: [] };
    const result = await ctx.bus.request("agent:list", {});
    return {
      ok: true,
      agents: Array.isArray(result?.agents) ? result.agents : [],
    };
  } catch (error) {
    return { ok: false, error: "agent_list_failed", stderr: error.message, agents: [] };
  }
}

export async function listHanaSessions(ctx, input = {}) {
  try {
    if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", sessions: [] };
    const agentId = String(input.agentId || "").trim();
    const result = await ctx.bus.request("session:list", agentId ? { agentId } : {});
    return {
      ok: true,
      agentId: agentId || undefined,
      sessions: Array.isArray(result?.sessions) ? result.sessions : [],
    };
  } catch (error) {
    return { ok: false, error: "session_list_failed", stderr: error.message, sessions: [] };
  }
}

export async function sendHanaAgentWorkflow(ctx, input = {}) {
  const sessionPath = String(input.sessionPath || "").trim();
  if (!sessionPath) return { ok: false, error: "sessionPath_required" };
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", sessionPath };

  const wikiRoot = normalizeWikiRootEntry(input.wikiRoot || "");
  if (!wikiRoot) return { ok: false, error: "wikiRoot_required", sessionPath };

  const action = normalizeAgentWorkflowAction(input.action);
  const prompt = buildAgentWorkflowPrompt({
    wikiRoot,
    action,
    input: input.input,
    notes: input.notes,
  });

  try {
    const result = await ctx.bus.request("session:send", {
      sessionPath,
      text: prompt,
    });
    return {
      ok: true,
      wikiRoot,
      sessionPath,
      action,
      prompt,
      result,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || "agent_send_failed",
      wikiRoot,
      sessionPath,
      action,
      prompt,
      stderr: error.stack || error.message,
    };
  }
}

export function normalizeAgentWorkflowAction(action) {
  const raw = String(action || "").trim().toLowerCase();
  const aliases = {
    context: "context",
    start: "context",
    "session-start": "context",
    session_start: "context",
    "start-context": "context",
    start_context: "context",
    "启动上下文": "context",
    "知识库上下文": "context",
    ingest: "ingest",
    "batch-ingest": "batch-ingest",
    batch_ingest: "batch-ingest",
    query: "query",
    digest: "digest",
    update: "update",
    "update-page": "update",
    update_page: "update",
    maintenance: "maintenance",
    maintain: "maintenance",
    status: "maintenance",
    crystallize: "crystallize",
  };
  return aliases[raw] || "ingest";
}

export function buildAgentWorkflowPrompt(input = {}) {
  const wikiRoot = normalizeWikiRootEntry(input.wikiRoot || "");
  const action = normalizeAgentWorkflowAction(input.action);
  const userInput = String(input.input || "").trim();
  const notes = String(input.notes || "").trim();
  const spec = AGENT_WORKFLOW_SPECS[action] || AGENT_WORKFLOW_SPECS.ingest;
  if (action === "context") {
    const lines = [
      "请启动当前知识库上下文。",
      "",
      `知识库根目录：${wikiRoot}`,
      `任务类型：${spec.label}`,
      "",
      "执行要求：",
      "- 当前消息用于建立上下文和准备工作，不需要写入或改动知识库内容。",
      "- 请读取并理解 knowledge root 下的 purpose.md；如果缺失，请建议用户补充研究目标、关键问题和范围。",
      "- 请检查 .wiki-schema.md 和 index.md，确认后续任务都以这个知识库根目录为准。",
      "- 后续用户可能要求添加素材、批量消化、查询知识库、深度整理、更新页面、结晶化对话或维护检查。",
      "- 请按 obsidian-wiki-manager/references/llm-wiki/SKILL.md 中的 llm-wiki skill 工作流规则处理后续任务。",
      "- 后续如果完成了内容写入或更新，请提醒用户回到 LLM Wiki 控制台点击“生成/刷新”更新图谱。",
      "",
      "具体任务：",
      spec.instruction,
    ];
    if (userInput) {
      lines.push("", "用户输入：", userInput);
    }
    if (notes) {
      lines.push("", "补充说明：", notes);
    }
    return lines.join("\n");
  }
  const lines = [
    "请使用 llm-wiki skill 处理下面的知识库任务。",
    "",
    `知识库根目录：${wikiRoot}`,
    `任务类型：${spec.label}`,
    "",
    "执行要求：",
    "- 请按 llm-wiki skill 的对应工作流执行，不要把结果只停留在聊天总结里。",
    "- 如需读写知识库文件，请以这个知识库根目录为准；不要改写其他目录。",
    "- 请优先读取 knowledge root 下的 purpose.md；如果缺失，请建议用户补充研究目标、关键问题和范围。",
    "- 如果任务涉及素材消化，请先执行 skill 要求的隐私自查确认流程。",
    "- 如果需要用户确认、缺少素材、会话正在忙或路径不可用，请直接在当前 Hana 会话里说明下一步。",
    "- 完成后请说明写入/更新了哪些 wiki 页面，并建议用户回到 LLM Wiki 控制台点击“生成/刷新”更新图谱。",
    "",
    "具体任务：",
    spec.instruction,
  ];
  if (userInput) {
    lines.push("", "用户输入：", userInput);
  }
  if (notes) {
    lines.push("", "补充说明：", notes);
  }
  return lines.join("\n");
}

export async function initWiki(input = {}) {
  const wikiRoot = expandHome(input.wikiRoot);
  if (!wikiRoot) return { ok: false, error: "wikiRoot_required", wikiRoot };

  const safety = await checkInitSafety(wikiRoot);
  if (!safety.ok) {
    return {
      ok: false,
      error: safety.error,
      wikiRoot,
      status: await getStatus(wikiRoot),
    };
  }

  const topic = String(input.topic || "").trim() || "我的知识库";
  const languageCode = normalizeLanguage(input.language);
  const languageLabel = languageCode === "en" ? "English" : "中文";
  const result = await runSkillScript("init-wiki.sh", [wikiRoot, topic, languageLabel]);
  if (!result.ok) return { ...result, wikiRoot, language: languageCode };

  try {
    if (languageCode === "en") {
      await localizeEnglishSeedFiles(wikiRoot, topic);
    }
    await fsp.writeFile(path.join(getHome(), ".llm-wiki-path"), `${wikiRoot}\n`, "utf8");
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      wikiRoot,
      language: languageCode,
      stdout: result.stdout,
      stderr: result.stderr,
      code: null,
    };
  }

  return {
    ok: true,
    wikiRoot,
    skillRoot: getSkillRoot(),
    language: languageCode,
    stdout: result.stdout,
    stderr: result.stderr,
    status: await getStatus(wikiRoot),
  };
}

export async function runSkillScript(scriptName, args = [], options = {}) {
  const scriptPath = path.join(getSkillRoot(), "scripts", scriptName);
  const command = scriptName.endsWith(".js") ? "node" : "bash";
  try {
    const result = await execFileAsync(command, [scriptPath, ...args], {
      timeout: options.timeout ?? SCRIPT_TIMEOUT_MS,
      env: { ...process.env, ...(options.env || {}) },
    });
    return {
      ok: true,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      code: 0,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      code: error.code ?? null,
    };
  }
}

export function toToolResult(action, result) {
  const wikiRoot = result.wikiRoot ? `: ${result.wikiRoot}` : "";
  const state = result.ok ? "completed" : `failed${result.error ? ` (${result.error})` : ""}`;
  return {
    content: [{ type: "text", text: `LLM Wiki ${action} ${state}${wikiRoot}` }],
    details: result,
  };
}

export function parseTsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return [];
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });
}

export function parseSourceRegistryRows(text) {
  const headers = [
    "source_id",
    "source_label",
    "source_category",
    "input_mode",
    "match_rule",
    "raw_dir",
    "adapter_name",
    "dependency_name",
    "dependency_type",
    "fallback_hint",
  ];
  return String(text || "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const cells = line.split("\t");
      const row = {};
      headers.forEach((header, index) => {
        row[header] = cells[index] ?? "";
      });
      return row;
    });
}

export async function serveWikiFile(c, wikiRoot, filePath, options = {}) {
  const wikiDir = path.resolve(wikiRoot, "wiki");
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(wikiDir + path.sep)) return c.text("Forbidden", 403);
  try {
    let body = await fsp.readFile(resolved);
    if (resolved.endsWith("knowledge-graph.html")) {
      const base = options.assetBase || "/api/plugins/llm-wiki-viewer/graph-assets/";
      const fileBase = options.fileBase || "/api/plugins/llm-wiki-viewer/wiki-file/";
      const suffix = options.suffix || "";
      body = Buffer.from(applyGraphTheme(rewriteGraphSourcePaths(String(body), wikiRoot, wikiDir, fileBase, suffix), options.theme)
        .replaceAll('src="d3.min.js"', `src="${base}d3.min.js${suffix}"`)
        .replaceAll('src="rough.min.js"', `src="${base}rough.min.js${suffix}"`)
        .replaceAll('src="marked.min.js"', `src="${base}marked.min.js${suffix}"`)
        .replaceAll('src="purify.min.js"', `src="${base}purify.min.js${suffix}"`)
        .replaceAll('src="graph-wash-helpers.js"', `src="${base}graph-wash-helpers.js${suffix}"`)
        .replaceAll('src="graph-wash.js"', `src="${base}graph-wash.js${suffix}"`));
    }
    return new Response(body, { headers: { "content-type": mimeFor(resolved) } });
  } catch {
    return c.text("Not found. Generate the graph first.", 404);
  }
}

export function applyGraphTheme(html, theme = "") {
  const mode = theme === "dark" ? "dark" : "light";
  let themed = String(html || "");
  if (/<html\b/i.test(themed)) {
    themed = themed.replace(/<html\b([^>]*)>/i, (match, attrs) => {
      if (/\bdata-effective-theme=/.test(attrs)) return match;
      return `<html${attrs} data-effective-theme="${mode}">`;
    });
  }
  if (themed.includes("llm-wiki-viewer-graph-theme")) return themed;
  const css = `<style id="llm-wiki-viewer-graph-theme">
    html[data-effective-theme="dark"] {
      color-scheme: dark;
      --bg: #101417;
      --surface: #1d2328;
      --surface-2: #242b31;
      --vellum: #2b3339;
      --mist: #20262b;
      --ink: #f2f0eb;
      --muted: #aeb8bf;
      --faint: #7f8c94;
      --rule: #3a444b;
      --line: #4a555d;
      --cinnabar: #d45f50;
      --cinnabar-2: #ff8a78;
      --jade: #65a384;
      --green: #65d99a;
      --night: #7fb5c7;
      --amber: #d7a959;
      --violet: #b69ac7;
      --shadow: 0 18px 36px rgba(0, 0, 0, .38);
      --soft-shadow: 0 10px 24px rgba(0, 0, 0, .3);
    }
    html[data-effective-theme="dark"] body {
      background:
        radial-gradient(circle at 18% 12%, rgba(42, 50, 56, .72), transparent 28%),
        radial-gradient(circle at 90% 18%, rgba(101, 163, 132, .12), transparent 28%),
        linear-gradient(145deg, #101417 0%, #161c20 48%, #1b2024 100%);
      color: var(--ink);
    }
    html[data-effective-theme="dark"] body::before {
      opacity: .18;
      mix-blend-mode: screen;
    }
    html[data-effective-theme="dark"] body::after {
      background:
        linear-gradient(90deg, transparent 0 86px, rgba(212, 95, 80, .18) 86px 87px, transparent 87px),
        linear-gradient(180deg, rgba(255, 255, 255, .05), transparent 22%);
    }
    html[data-effective-theme="dark"] .topbar,
    html[data-effective-theme="dark"] .mobile-atlas-preview,
    html[data-effective-theme="dark"] .sidebar,
    html[data-effective-theme="dark"] .drawer,
    html[data-effective-theme="dark"] .canvas-card,
    html[data-effective-theme="dark"] .empty-state,
    html[data-effective-theme="dark"] .state-panel,
    html[data-effective-theme="dark"] .queue-card,
    html[data-effective-theme="dark"] .start-card,
    html[data-effective-theme="dark"] .neighbor-card,
    html[data-effective-theme="dark"] .note-card,
    html[data-effective-theme="dark"] .legend-card,
    html[data-effective-theme="dark"] .mini-map {
      background: rgba(29, 35, 40, .84);
      border-color: rgba(74, 85, 93, .9);
      box-shadow: var(--soft-shadow);
    }
    html[data-effective-theme="dark"] .status-pill,
    html[data-effective-theme="dark"] .chip,
    html[data-effective-theme="dark"] .icon-button,
    html[data-effective-theme="dark"] .ghost-button,
    html[data-effective-theme="dark"] .state-button,
    html[data-effective-theme="dark"] .search-box input,
    html[data-effective-theme="dark"] .nav-item,
    html[data-effective-theme="dark"] .source-card,
    html[data-effective-theme="dark"] .detail-card {
      background: rgba(36, 43, 49, .88);
      border-color: rgba(74, 85, 93, .92);
      color: var(--ink);
    }
    html[data-effective-theme="dark"] .primary-button {
      background: var(--cinnabar);
      border-color: var(--cinnabar);
      color: #fff8f4;
    }
    html[data-effective-theme="dark"] .brand p,
    html[data-effective-theme="dark"] .section-title,
    html[data-effective-theme="dark"] .status-pill,
    html[data-effective-theme="dark"] .chip,
    html[data-effective-theme="dark"] .muted {
      color: var(--muted);
    }
    html[data-effective-theme="dark"] .canvas,
    html[data-effective-theme="dark"] .canvas-stage,
    html[data-effective-theme="dark"] #graph-canvas {
      background: rgba(16, 20, 23, .42);
    }
    html[data-effective-theme="dark"] .node {
      box-shadow: 0 12px 24px rgba(0, 0, 0, .24);
    }
  </style>`;
  return themed.replace("</head>", `${css}\n</head>`);
}

export function rewriteGraphSourcePaths(html, wikiRoot, wikiDir, fileBase, suffix) {
  const match = html.match(/<script\b(?=[^>]*\bid=["']graph-data["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>/i);
  if (!match || match.index == null) return html;
  const jsonStart = match.index + match[0].length;
  const end = html.indexOf("</script>", jsonStart);
  if (end < 0) return html;

  const before = html.slice(0, jsonStart);
  const rawJson = html.slice(jsonStart, end).replace(/<\\\/script>/gi, "</script>");
  const after = html.slice(end);
  try {
    const data = JSON.parse(rawJson);
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    for (const node of nodes) {
      if (!node || typeof node.source_path !== "string") continue;
      const absolute = path.resolve(wikiRoot, node.source_path);
      if (!absolute.startsWith(wikiDir + path.sep)) continue;
      const relative = path.relative(wikiDir, absolute).split(path.sep).map(encodeURIComponent).join("/");
      node.source_path = `${fileBase}${relative}${suffix}`;
    }
    const json = JSON.stringify(data, null, 2).replace(/<\/script>/gi, "<\\/script>");
    return `${before}${json}${after}`;
  } catch {
    return html;
  }
}

export function mimeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function normalizeLanguage(language) {
  const raw = String(language || "zh").trim().toLowerCase();
  return raw === "en" || raw === "english" ? "en" : "zh";
}

async function checkInitSafety(wikiRoot) {
  if (fs.existsSync(path.join(wikiRoot, ".wiki-schema.md"))) {
    return { ok: false, error: "already_initialized" };
  }
  try {
    const entries = await fsp.readdir(wikiRoot);
    if (entries.length > 0) return { ok: false, error: "target_not_empty" };
  } catch (error) {
    if (error.code === "ENOTDIR") return { ok: false, error: "target_not_directory" };
    if (error.code !== "ENOENT") return { ok: false, error: error.message };
  }
  return { ok: true };
}

async function localizeEnglishSeedFiles(wikiRoot, topic) {
  const date = new Date().toISOString().slice(0, 10);
  const replacements = {
    "{{DATE}}": date,
    "{{TOPIC}}": topic,
    "{{WIKI_ROOT}}": wikiRoot,
    "{{LANGUAGE}}": "English",
  };
  const files = [
    ["index-en-template.md", "index.md"],
    ["overview-en-template.md", path.join("wiki", "overview.md")],
    ["log-en-template.md", "log.md"],
  ];
  for (const [templateName, outputName] of files) {
    const templatePath = path.join(getSkillRoot(), "templates", templateName);
    const outputPath = path.join(wikiRoot, outputName);
    let content = await fsp.readFile(templatePath, "utf8");
    for (const [needle, value] of Object.entries(replacements)) {
      content = content.replaceAll(needle, value);
    }
    await fsp.writeFile(outputPath, content, "utf8");
  }
}

async function collectWikiCounts(wikiRoot) {
  const wikiDir = path.join(wikiRoot, "wiki");
  const rawDir = path.join(wikiRoot, "raw");
  const sections = {
    sources: path.join(wikiDir, "sources"),
    entities: path.join(wikiDir, "entities"),
    topics: path.join(wikiDir, "topics"),
    queries: path.join(wikiDir, "queries"),
    synthesis: path.join(wikiDir, "synthesis"),
    comparisons: path.join(wikiDir, "comparisons"),
  };
  const sectionCounts = {};
  for (const [key, dir] of Object.entries(sections)) {
    sectionCounts[key] = await countFiles(dir, ".md");
  }
  const rawFiles = await countFiles(rawDir);
  return {
    pages: Object.values(sectionCounts).reduce((sum, value) => sum + value, 0),
    rawFiles,
    ...sectionCounts,
  };
}

async function countFiles(dir, extension = "") {
  let total = 0;
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += await countFiles(fullPath, extension);
      } else if (!extension || entry.name.endsWith(extension)) {
        total += 1;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return total;
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows || []) {
    const value = row?.[key] || "unknown";
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function summarizeAdapterOutput(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return { available: 0, unavailable: 0, total: 0 };
  const stateMatchers = [
    ["not_installed", ["not_installed", "未安装"]],
    ["env_unavailable", ["env_unavailable", "环境不满足"]],
    ["runtime_failed", ["runtime_failed", "运行失败"]],
    ["unsupported", ["unsupported", "不支持自动提取"]],
    ["empty_result", ["empty_result", "结果为空"]],
    ["available", ["available", "可用"]],
  ];
  const states = stateMatchers.map(([state]) => state);
  const summary = Object.fromEntries(states.map((state) => [state, 0]));
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith("- ")) continue;
    for (const [state, needles] of stateMatchers) {
      if (needles.some((needle) => line.includes(needle))) {
        summary[state] += 1;
        break;
      }
    }
  }
  summary.total = states.reduce((sum, state) => sum + summary[state], 0);
  summary.unavailable = summary.total - summary.available;
  return summary;
}

function formatDiagnosticsSummary(counts, coverageSummary, adapterSummary, warnings, extras = {}) {
  const parts = [
    "LLM Wiki diagnostics",
    `pages: ${counts.pages}`,
    `raw files: ${counts.rawFiles}`,
  ];
  if (extras.purposeSummary) {
    parts.push(`purpose exists: ${extras.purposeSummary.exists ? "yes" : "no"}`);
  }
  if (coverageSummary) {
    parts.push(`coverage applicable: ${coverageSummary.applicable_total ?? 0}`);
    parts.push(`coverage with source: ${coverageSummary.with_source_total ?? coverageSummary.covered_total ?? 0}`);
  }
  if (extras.eligibilitySummary) {
    parts.push(`eligibility ok: ${extras.eligibilitySummary.eligible ?? 0}/${extras.eligibilitySummary.applicable ?? 0}`);
  }
  if (extras.runtimeContextSummary) {
    parts.push(`runtime context: ${extras.runtimeContextSummary.layoutMode}, missing ${extras.runtimeContextSummary.missing}`);
  }
  if (adapterSummary) {
    parts.push(`adapters available: ${adapterSummary.available}/${adapterSummary.total}`);
  }
  if (extras.sourceImageSummary) {
    parts.push(`source image issues: ${extras.sourceImageSummary.emptyImagePaths + extras.sourceImageSummary.missingImagePaths + extras.sourceImageSummary.imageCountMismatches + extras.sourceImageSummary.invalidImageCounts}`);
  }
  if (extras.sourceContractSummary) {
    parts.push(`source contract issues: ${extras.sourceContractSummary.missingSourcePath + extras.sourceContractSummary.missingRawFiles + extras.sourceContractSummary.outsideWikiRoot + extras.sourceContractSummary.cacheMissing + extras.sourceContractSummary.cacheMismatches}`);
  }
  if (extras.linkSummary) {
    parts.push(`link issues: ${extras.linkSummary.brokenLinks + extras.linkSummary.orphanPages + extras.linkSummary.duplicateTitles}`);
  }
  if (extras.graphSourcePathSummary) {
    parts.push(`graph source_path issues: ${extras.graphSourcePathSummary.missingSourcePath + extras.graphSourcePathSummary.outsideWiki + extras.graphSourcePathSummary.missingFiles}`);
  }
  if (extras.graphContractSummary) {
    parts.push(`graph contract issues: ${extras.graphContractSummary.issues}`);
  }
  if (extras.maintenanceSummary) {
    parts.push(`maintenance issues: ${countMaintenanceIssues(extras.maintenanceSummary)}`);
  }
  if (warnings.length > 0) {
    parts.push(`warnings: ${warnings.join(", ")}`);
  }
  return parts.join("\n");
}

async function summarizeGraphContract(status, links, graphPaths, coverageSummary) {
  const summary = {
    ok: true,
    graphDataExists: status.graphDataExists,
    graphHtmlExists: status.graphExists,
    graphDataValid: false,
    graphHtmlReadable: false,
    nodes: 0,
    edges: 0,
    sourceNodes: 0,
    isolatedNodes: 0,
    longLabels: 0,
    sourcePathMissing: graphPaths.summary?.missingSourcePath ?? 0,
    sourcePathOutsideWiki: graphPaths.summary?.outsideWiki ?? 0,
    sourcePathMissingFiles: graphPaths.summary?.missingFiles ?? 0,
    brokenLinks: links.summary?.brokenLinks ?? 0,
    orphanPages: links.summary?.orphanPages ?? 0,
    duplicateTitles: links.summary?.duplicateTitles ?? 0,
    sourceApplicable: coverageSummary?.applicable_total ?? 0,
    sourceCovered: coverageSummary?.with_source_total ?? coverageSummary?.covered_total ?? 0,
    routeOpenableSourcePaths: graphPaths.ok,
    issues: 0,
    warnings: [],
  };

  if (status.graphDataExists) {
    try {
      const data = JSON.parse(await fsp.readFile(status.graphDataPath, "utf8"));
      const nodes = Array.isArray(data.nodes) ? data.nodes : [];
      const edges = Array.isArray(data.edges) ? data.edges : [];
      const degree = new Map(nodes.map((node) => [String(node.id || node.label || ""), 0]));
      for (const edge of edges) {
        const from = String(edge.from || "");
        const to = String(edge.to || "");
        if (degree.has(from)) degree.set(from, degree.get(from) + 1);
        if (degree.has(to)) degree.set(to, degree.get(to) + 1);
      }
      summary.graphDataValid = true;
      summary.nodes = nodes.length;
      summary.edges = edges.length;
      summary.sourceNodes = nodes.filter((node) => node.type === "source").length;
      summary.isolatedNodes = [...degree.values()].filter((value) => value === 0).length;
      summary.longLabels = nodes.filter((node) => String(node.label || node.id || "").length > 48).length;
    } catch (error) {
      summary.warnings.push(`graph_data_invalid:${error.message}`);
    }
  }

  if (status.graphExists) {
    try {
      const html = await fsp.readFile(status.graphPath, "utf8");
      summary.graphHtmlReadable = true;
      summary.hasEmbeddedGraphData = html.includes('id="graph-data"') && html.includes("application/json");
      summary.hasSearchUi = html.includes('id="search"') || html.includes('class="search-box"');
      summary.hasToolbar = html.includes('id="fit-view"') && html.includes('id="toggle-dim"');
      summary.hasMinimap = html.includes('id="mini-map-svg"') || html.includes('id="minimap"');
    } catch (error) {
      summary.warnings.push(`graph_html_unreadable:${error.message}`);
    }
  }

  const issueFields = [
    "sourcePathMissing",
    "sourcePathOutsideWiki",
    "sourcePathMissingFiles",
    "brokenLinks",
    "duplicateTitles",
  ];
  summary.issues = issueFields.reduce((sum, key) => sum + Number(summary[key] || 0), 0);
  if (!summary.graphDataExists) summary.issues += 1;
  if (!summary.graphHtmlExists) summary.issues += 1;
  if (summary.graphDataExists && !summary.graphDataValid) summary.issues += 1;
  if (summary.graphHtmlExists && !summary.graphHtmlReadable) summary.issues += 1;
  summary.ok = summary.issues === 0;
  return summary;
}

function parseLines(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function filterLintReport(stdout) {
  const graphNoise = new Set([
    "document.documentElement",
    "document.querySelector(t)",
    "t",
    "素材摘要",
    "实体页",
    "主题页",
    "对比分析",
    "综合分析",
    "Source Summaries",
    "Entity Pages",
    "Topic Pages",
    "Comparisons",
    "Synthesis",
  ]);
  const lines = String(stdout || "").split(/\r?\n/);
  const filtered = [];
  let inBrokenSection = false;
  let brokenCount = 0;
  let brokenPlaceholderIndex = -1;
  for (const line of lines) {
    if (line.startsWith("--- ")) {
      if (inBrokenSection && brokenCount > 0 && brokenPlaceholderIndex >= 0) {
        filtered.splice(brokenPlaceholderIndex, 1);
      }
      inBrokenSection = line.includes("断链");
      brokenCount = 0;
      brokenPlaceholderIndex = -1;
      filtered.push(line);
      continue;
    }
    if (inBrokenSection) {
      const match = line.match(/^\s*断链:\s*\[\[(.*)\]\]\s*$/);
      if (match && isLintBrokenLinkNoise(match[1], graphNoise)) continue;
      if (line.includes("（无断链）")) brokenPlaceholderIndex = filtered.length;
      if (match) brokenCount += 1;
    }
    filtered.push(line);
  }
  if (inBrokenSection && brokenCount > 0 && brokenPlaceholderIndex >= 0) {
    filtered.splice(brokenPlaceholderIndex, 1);
  }
  return filtered.join("\n");
}

function isLintBrokenLinkNoise(target, graphNoise) {
  return graphNoise.has(target) || target.startsWith("^") || target.includes("\\");
}

async function collectMarkdownPages(wikiRoot) {
  const roots = [path.join(wikiRoot, "index.md"), path.join(wikiRoot, "log.md"), path.join(wikiRoot, "wiki")];
  const pages = [];
  for (const root of roots) {
    try {
      const stat = await fsp.stat(root);
      if (stat.isFile() && root.endsWith(".md")) {
        pages.push({ absolutePath: root, relativePath: normalizeSlash(path.relative(wikiRoot, root)) });
      } else if (stat.isDirectory()) {
        pages.push(...await collectMarkdownPagesInDir(wikiRoot, root));
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return pages.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function collectSourcePages(wikiRoot) {
  const sourceDir = path.join(wikiRoot, "wiki", "sources");
  try {
    const stat = await fsp.stat(sourceDir);
    if (!stat.isDirectory()) return [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return collectMarkdownPagesInDir(wikiRoot, sourceDir);
}

async function collectRawFiles(wikiRoot) {
  const rawDir = path.join(wikiRoot, "raw");
  const files = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push({
          absolutePath: fullPath,
          relativePath: normalizeSlash(path.relative(wikiRoot, fullPath)),
        });
      }
    }
  }
  await walk(rawDir);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function summarizePurpose(wikiRoot) {
  const purposePath = path.join(wikiRoot, "purpose.md");
  try {
    const content = await fsp.readFile(purposePath, "utf8");
    const firstMeaningfulLine = String(content)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#") && !line.startsWith("---")) || "";
    return {
      exists: true,
      path: purposePath,
      bytes: Buffer.byteLength(content, "utf8"),
      preview: firstMeaningfulLine.slice(0, 160),
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { exists: false, path: purposePath, bytes: 0, preview: "" };
    }
    return { exists: false, path: purposePath, bytes: 0, preview: "", error: error.message };
  }
}

async function collectSourceReferenceCounts(wikiRoot, sourcePages) {
  const counts = new Map(sourcePages.map((page) => [page.relativePath, 0]));
  const sourceHints = [];
  for (const page of sourcePages) {
    const frontmatter = await readFrontmatter(page.absolutePath);
    sourceHints.push({
      page,
      stem: path.posix.basename(page.relativePath, ".md").toLowerCase(),
      relativePath: normalizeSlash(page.relativePath).toLowerCase(),
      sourcePath: String(frontmatter.source_path || "").trim().toLowerCase(),
    });
  }

  const pages = (await collectMarkdownPages(wikiRoot)).filter((page) => !page.relativePath.startsWith("wiki/sources/"));
  for (const page of pages) {
    const content = (await fsp.readFile(page.absolutePath, "utf8")).toLowerCase();
    for (const hint of sourceHints) {
      const referenced = content.includes(hint.relativePath)
        || content.includes(`[[${hint.stem}`)
        || (hint.sourcePath && content.includes(hint.sourcePath));
      if (referenced) counts.set(hint.page.relativePath, (counts.get(hint.page.relativePath) || 0) + 1);
    }
  }
  return counts;
}

async function collectOrphanRawFiles(wikiRoot, rawFiles, sourcePages) {
  const referencedRaw = new Set();
  for (const page of sourcePages) {
    const frontmatter = await readFrontmatter(page.absolutePath);
    const rawPath = String(frontmatter.source_path || "").trim();
    if (!rawPath) continue;
    const absolute = resolveWikiScopedPath(wikiRoot, rawPath);
    if (isInside(wikiRoot, absolute)) {
      referencedRaw.add(normalizeSlash(path.relative(wikiRoot, absolute)).toLowerCase());
    }
  }
  return rawFiles
    .filter((file) => !referencedRaw.has(file.relativePath.toLowerCase()))
    .map((file) => file.relativePath);
}

async function collectStaleCacheEntries(wikiRoot, cache) {
  if (!cache.ok) return [];
  const stale = [];
  for (const [rawPath, entry] of Object.entries(cache.entries || {})) {
    const rawAbsolute = resolveWikiScopedPath(wikiRoot, rawPath);
    const sourcePage = String(entry?.source_page || "").trim();
    const sourceAbsolute = sourcePage ? resolveWikiScopedPath(wikiRoot, sourcePage) : "";
    const rawExists = Boolean(rawAbsolute && isInside(wikiRoot, rawAbsolute) && fs.existsSync(rawAbsolute));
    const sourceExists = Boolean(sourceAbsolute && isInside(wikiRoot, sourceAbsolute) && fs.existsSync(sourceAbsolute));
    if (!rawExists || !sourcePage || !sourceExists) {
      stale.push({
        rawPath,
        source_page: sourcePage,
        rawExists,
        sourceExists,
        reason: !rawExists ? "raw_missing" : !sourcePage ? "source_page_missing" : "source_page_file_missing",
      });
    }
  }
  return stale;
}

async function collectSourceFrontmatterIssues(sourcePages) {
  const requiredFields = ["tags", "created", "updated", "sources", "source_type", "source_path", "images", "image_paths"];
  const issues = [];
  for (const page of sourcePages) {
    const frontmatter = await readFrontmatter(page.absolutePath);
    const missing = requiredFields.filter((field) => !(field in frontmatter));
    const invalid = [];
    if ("images" in frontmatter) {
      const imageCount = Number.parseInt(String(frontmatter.images), 10);
      if (!Number.isFinite(imageCount) || imageCount < 0) invalid.push("images");
    }
    if ("image_paths" in frontmatter && !Array.isArray(parseFrontmatterList(frontmatter.image_paths))) {
      invalid.push("image_paths");
    }
    if (missing.length > 0 || invalid.length > 0) {
      issues.push({
        page: page.relativePath,
        missing,
        invalid,
      });
    }
  }
  return issues;
}

async function collectQueryDigestIndexStatus(wikiRoot) {
  const indexPath = path.join(wikiRoot, "index.md");
  let indexContent = "";
  try {
    indexContent = await fsp.readFile(indexPath, "utf8");
  } catch {
    indexContent = "";
  }
  const queryPages = await collectMarkdownPagesInDirSafe(wikiRoot, path.join(wikiRoot, "wiki", "queries"));
  const digestPages = await collectMarkdownPagesInDirSafe(wikiRoot, path.join(wikiRoot, "wiki", "synthesis"));
  const pages = [
    ...queryPages.map((page) => ({ ...page, pageType: "query" })),
    ...digestPages.map((page) => ({ ...page, pageType: "digest" })),
  ];
  const missingFromIndex = pages
    .filter((page) => !indexMentionsPage(indexContent, page.relativePath))
    .map((page) => ({ path: page.relativePath, pageType: page.pageType }));
  return {
    indexExists: fs.existsSync(indexPath),
    queries: queryPages.length,
    digests: digestPages.length,
    indexed: pages.length - missingFromIndex.length,
    missingFromIndex,
  };
}

function indexMentionsPage(indexContent, relativePath) {
  const content = String(indexContent || "").toLowerCase();
  const normalized = normalizeSlash(relativePath);
  const stem = path.posix.basename(normalized, ".md");
  return content.includes(normalized.toLowerCase())
    || content.includes(`[[${stem.toLowerCase()}`)
    || content.includes(`](${normalized.toLowerCase()})`);
}

async function collectPurposeHints(wikiRoot, purposeSummary) {
  if (!purposeSummary.exists) return ["purpose_missing"];

  let content = "";
  try {
    content = await fsp.readFile(path.join(wikiRoot, "purpose.md"), "utf8");
  } catch {
    return ["purpose_unreadable"];
  }

  const hints = [];
  if (hasPlaceholderSection(content, "核心目标")) hints.push("core_goal_placeholder");
  if (hasPlaceholderSection(content, "关键问题")) hints.push("key_questions_placeholder");
  if (hasPlaceholderSection(content, "研究范围")) hints.push("scope_placeholder");
  if (content.replace(/<!--[\s\S]*?-->/g, "").replace(/[#*\-\s:[\]待填写涵盖不涵盖：]/g, "").trim().length < 12) {
    hints.push("purpose_too_sparse");
  }
  return [...new Set(hints)];
}

function hasPlaceholderSection(content, heading) {
  const section = extractMarkdownSection(content, heading);
  if (!section) return true;
  return /\[待填写\]|TODO|TBD|待补充/i.test(section);
}

function extractMarkdownSection(content, heading) {
  const lines = String(content || "").split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^#{1,6}\\s+${escapeRegExp(heading)}\\s*$`).test(line.trim()));
  if (start < 0) return "";
  const level = lines[start].match(/^(#+)/)?.[1].length || 1;
  const collected = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^(#+)\s+/);
    if (match && match[1].length <= level) break;
    collected.push(lines[index]);
  }
  return collected.join("\n").trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readFrontmatter(filePath) {
  const content = await fsp.readFile(filePath, "utf8");
  const lines = String(content).split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return {};
  const data = {};
  let currentKey = "";
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "---") break;
    const listMatch = line.match(/^\s*-\s*(.+?)\s*$/);
    if (currentKey && listMatch) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(unquoteYamlValue(listMatch[1]));
      continue;
    }
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) continue;
    currentKey = keyMatch[1];
    const rawValue = keyMatch[2].trim();
    data[currentKey] = rawValue ? parseYamlScalarOrInlineList(rawValue) : [];
  }
  return data;
}

function parseYamlScalarOrInlineList(value) {
  const raw = String(value || "").trim();
  if (raw === "[]") return [];
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw.slice(1, -1)
      .split(",")
      .map((item) => unquoteYamlValue(item.trim()))
      .filter(Boolean);
  }
  return unquoteYamlValue(raw);
}

function unquoteYamlValue(value) {
  return String(value || "").trim().replace(/^["']|["']$/g, "");
}

function parseFrontmatterList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    const parsed = parseYamlScalarOrInlineList(value);
    return Array.isArray(parsed) ? parsed : [parsed].filter(Boolean);
  }
  return [];
}

async function readWikiCache(wikiRoot) {
  const cacheFile = path.join(wikiRoot, ".wiki-cache.json");
  try {
    const parsed = JSON.parse(await fsp.readFile(cacheFile, "utf8"));
    return { ok: true, entries: parsed.entries || {} };
  } catch (error) {
    if (error.code === "ENOENT") return { ok: false, error: "cache_missing", entries: {} };
    return { ok: false, error: "cache_invalid", entries: {} };
  }
}

function isSeedNavigationPage(relativePath) {
  return normalizeSlash(relativePath) === "wiki/overview.md";
}

async function collectMarkdownPagesInDir(wikiRoot, dir) {
  const pages = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      pages.push(...await collectMarkdownPagesInDir(wikiRoot, fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      pages.push({ absolutePath: fullPath, relativePath: normalizeSlash(path.relative(wikiRoot, fullPath)) });
    }
  }
  return pages;
}

async function collectMarkdownPagesInDirSafe(wikiRoot, dir) {
  try {
    const stat = await fsp.stat(dir);
    if (!stat.isDirectory()) return [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return collectMarkdownPagesInDir(wikiRoot, dir);
}

function extractFrontmatterBlock(text) {
  const content = String(text || "");
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { hasFrontmatter: false, frontmatter: "", body: content };
  }
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) return { hasFrontmatter: false, frontmatter: "", body: content };
  return { hasFrontmatter: true, frontmatter: match[1], body: match[2] };
}

function evaluateSourceSignalEligibility(input = {}) {
  if (!input.applicable) return { eligible: false, reason: "not_applicable", sources: [] };
  const parsed = parseSourcesSignalFrontmatter(input.frontmatter);
  if (!parsed.hasField) return { eligible: false, reason: "missing_sources", sources: [] };
  if (!parsed.parsed) return { eligible: false, reason: "invalid_sources", sources: [] };
  if (parsed.sources.length === 0) return { eligible: false, reason: "empty_sources", sources: [] };
  return { eligible: true, reason: "ok", sources: parsed.sources };
}

function parseSourcesSignalFrontmatter(frontmatter) {
  if (!frontmatter) return { hasField: false, parsed: false, sources: [] };
  const lines = String(frontmatter).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^sources:\s*(.*)$/);
    if (!match) continue;

    const rest = match[1].trim();
    if (rest) {
      if (!rest.startsWith("[")) {
        const single = normalizeSourceSignalToken(rest);
        return { hasField: true, parsed: Boolean(single), sources: single ? [single] : [] };
      }
      const parsedInline = parseInlineSourceSignals(rest);
      return {
        hasField: true,
        parsed: parsedInline.ok,
        sources: parsedInline.ok ? sortedUnique(parsedInline.values) : [],
      };
    }

    const collected = [];
    let parsed = true;
    let consumed = 0;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const line = lines[cursor];
      if (!line.trim()) {
        consumed += 1;
        continue;
      }
      if (/^[^\s-]/.test(line)) break;
      const itemMatch = line.match(/^\s*-\s*(.+)$/);
      if (!itemMatch) {
        parsed = false;
        consumed += 1;
        continue;
      }
      const token = normalizeSourceSignalToken(itemMatch[1]);
      if (token) collected.push(token);
      consumed += 1;
    }
    index += consumed;
    return { hasField: true, parsed, sources: parsed ? sortedUnique(collected) : [] };
  }
  return { hasField: false, parsed: false, sources: [] };
}

function parseInlineSourceSignals(raw) {
  const trimmed = String(raw || "").trim();
  if (trimmed === "[]") return { ok: true, values: [] };
  if (!(trimmed.startsWith("[") && trimmed.endsWith("]"))) return { ok: false, values: [] };
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return { ok: true, values: [] };
  return {
    ok: true,
    values: inner.split(",").map(normalizeSourceSignalToken).filter(Boolean),
  };
}

function normalizeSourceSignalToken(token) {
  let value = String(token || "").trim();
  if (!value) return null;
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1).trim();
  }
  return value || null;
}

function sortedUnique(values) {
  return [...new Set(values || [])].sort();
}

function extractWikiLinks(content) {
  const links = [];
  for (const match of String(content || "").matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const target = match[1].split("|")[0].split("#")[0].trim();
    if (target) links.push(target);
  }
  return links;
}

function extractMarkdownLinks(content) {
  const links = [];
  for (const match of String(content || "").matchAll(/(?<!!)\[[^\]\n]*\]\(([^)\n]+)\)/g)) {
    const target = match[1].split("#")[0].trim();
    if (target && !/^[a-z][a-z0-9+.-]*:/i.test(target) && target.endsWith(".md")) links.push(target);
  }
  return links;
}

function resolveWikiLink(target, byRel, byStem) {
  const normalized = normalizePageKey(target.endsWith(".md") ? target : `${target}.md`);
  const directCandidates = [
    normalized,
    normalizePageKey(path.posix.join("wiki", normalized)),
    normalizePageKey(path.posix.join("wiki/entities", normalized)),
    normalizePageKey(path.posix.join("wiki/topics", normalized)),
    normalizePageKey(path.posix.join("wiki/sources", normalized)),
  ];
  for (const candidate of directCandidates) {
    if (byRel.has(candidate)) return byRel.get(candidate);
  }
  const stem = path.posix.basename(normalized, ".md").toLowerCase();
  const matches = byStem.get(stem) || [];
  return matches.length === 1 ? matches[0] : null;
}

function resolveMarkdownLink(fromRelativePath, target, byRel) {
  const base = path.posix.dirname(normalizeSlash(fromRelativePath));
  const normalized = normalizePageKey(path.posix.normalize(path.posix.join(base, target)));
  if (byRel.has(normalized)) return byRel.get(normalized);
  const rootRelative = normalizePageKey(target);
  return byRel.get(rootRelative) || byRel.get(normalizePageKey(path.posix.join("wiki", rootRelative))) || null;
}

function normalizePageKey(value) {
  return normalizeSlash(String(value || "").replace(/^\/+/, "")).toLowerCase();
}

function normalizeSlash(value) {
  return String(value || "").split(path.sep).join("/");
}

function resolveWikiScopedPath(wikiRoot, filePath) {
  const raw = String(filePath || "").trim();
  if (!raw) return "";
  if (path.isAbsolute(expandHome(raw))) return path.resolve(expandHome(raw));
  return path.resolve(wikiRoot, raw);
}

function isInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  return resolvedTarget === resolvedRoot || resolvedTarget.startsWith(resolvedRoot + path.sep);
}

function parseCacheState(stdout) {
  const state = String(stdout || "").trim().split(/\r?\n/).find(Boolean) || "";
  const [kind, reason] = state.split(":");
  return {
    state,
    kind: kind || "",
    reason: reason || "",
    hit: kind === "HIT" || kind === "HIT(repaired)",
  };
}

function parseLintFixPreviewActions(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("[dry-run]"))
    .map((line) => {
      const match = line.match(/Would add \[\[(.+?)\]\] under (.+?) section$/);
      return {
        action: "add_index_entry",
        entry: match?.[1] || "",
        section: match?.[2] || "",
        text: line,
      };
    });
}

function normalizeSourceOutputPath(value) {
  const raw = normalizeSlash(String(value || "").trim()).replace(/^\/+/, "");
  if (!raw || raw.includes("\0")) return "";
  const normalized = normalizeSlash(path.posix.normalize(raw));
  if (normalized.startsWith("../") || normalized === ".." || path.isAbsolute(normalized)) return "";
  return normalized;
}

async function readOnlyCacheCheck(wikiRoot, filePath) {
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return "MISS:file_not_found";
    throw error;
  }
  if (!stat.isFile()) return "MISS:not_file";

  const cacheFile = path.join(wikiRoot, ".wiki-cache.json");
  let cache;
  try {
    cache = JSON.parse(await fsp.readFile(cacheFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return "MISS";
    return "MISS:cache_invalid";
  }

  const relativePath = normalizeSlash(path.relative(wikiRoot, filePath));
  const entry = cache?.entries?.[relativePath];
  if (!entry) return "MISS:no_entry";

  const digest = crypto
    .createHash("sha256")
    .update(Buffer.from(relativePath, "utf8"))
    .update(Buffer.from([0]))
    .update(await fsp.readFile(filePath))
    .digest("hex");
  if (entry.hash !== `sha256:${digest}`) return "MISS:hash_changed";

  const sourcePage = entry.source_page;
  if (!sourcePage) return "MISS:no_entry";
  const sourcePath = path.isAbsolute(sourcePage) ? sourcePage : path.join(wikiRoot, sourcePage);
  return fs.existsSync(sourcePath) ? "HIT" : "MISS:no_source";
}

function formatLinkDiagnosticsSummary(summary) {
  return [
    "LLM Wiki link diagnostics",
    `pages: ${summary.pages}`,
    `broken links: ${summary.brokenLinks}`,
    `orphan pages: ${summary.orphanPages}`,
    `duplicate titles: ${summary.duplicateTitles}`,
  ].join("\n");
}

function formatGraphSourcePathSummary(summary) {
  return [
    "LLM Wiki graph source path diagnostics",
    `nodes: ${summary.nodes}`,
    `with source_path: ${summary.withSourcePath}`,
    `missing source_path: ${summary.missingSourcePath}`,
    `outside wiki: ${summary.outsideWiki}`,
    `missing files: ${summary.missingFiles}`,
  ].join("\n");
}

function formatSourceImageDiagnosticsSummary(summary) {
  return [
    "LLM Wiki source image diagnostics",
    `source pages: ${summary.sourcePages}`,
    `empty image_paths: ${summary.emptyImagePaths}`,
    `missing image paths: ${summary.missingImagePaths}`,
    `image count mismatches: ${summary.imageCountMismatches}`,
    `invalid image counts: ${summary.invalidImageCounts}`,
  ].join("\n");
}

function formatSourceContractDiagnosticsSummary(summary) {
  return [
    "LLM Wiki source contract diagnostics",
    `source pages: ${summary.sourcePages}`,
    `missing source_path: ${summary.missingSourcePath}`,
    `missing raw files: ${summary.missingRawFiles}`,
    `outside wiki root: ${summary.outsideWikiRoot}`,
    `cache missing: ${summary.cacheMissing}`,
    `cache mismatches: ${summary.cacheMismatches}`,
    `cache readable: ${summary.cacheReadable ? "yes" : "no"}`,
  ].join("\n");
}

function formatMaintenanceDiagnosticsSummary(summary, warnings) {
  return [
    "LLM Wiki maintenance diagnostics",
    `source pages: ${summary.sourcePages}`,
    `raw files: ${summary.rawFiles}`,
    `orphan sources: ${summary.orphanSources}`,
    `orphan raw files: ${summary.orphanRawFiles}`,
    `missing source_path: ${summary.missingSourcePaths}`,
    `broken raw files: ${summary.brokenRawFiles}`,
    `stale cache entries: ${summary.staleCacheEntries}`,
    `source frontmatter issues: ${summary.sourceFrontmatterIssues}`,
    `missing source signals: ${summary.missingSourceSignals}`,
    `query/digest index gaps: ${summary.queryDigestIndexGaps}`,
    `duplicate titles: ${summary.duplicateTitles}`,
    `purpose hints: ${summary.purposeHints}`,
    `warnings: ${warnings.length ? warnings.join(", ") : "none"}`,
  ].join("\n");
}

function countMaintenanceIssues(summary = {}) {
  return [
    "orphanSources",
    "orphanRawFiles",
    "missingSourcePaths",
    "brokenRawFiles",
    "staleCacheEntries",
    "sourceFrontmatterIssues",
    "missingSourceSignals",
    "queryDigestIndexGaps",
    "duplicateTitles",
    "purposeHints",
  ].reduce((sum, key) => sum + Number(summary[key] || 0), 0);
}

function formatSourceSignalEligibilitySummary(summary) {
  return [
    "LLM Wiki source signal eligibility",
    `pages: ${summary.pages}`,
    `applicable: ${summary.applicable}`,
    `eligible: ${summary.eligible}`,
    `missing sources: ${summary.missingSources}`,
    `empty sources: ${summary.emptySources}`,
    `invalid sources: ${summary.invalidSources}`,
  ].join("\n");
}

function formatRuntimeContextStatusSummary(summary, checks) {
  return [
    "LLM Wiki runtime context status",
    `layout mode: ${summary.layoutMode}`,
    `optional adapter root: ${summary.optionalAdapterRoot}`,
    `skill root exists: ${checks.skillRootExists ? "yes" : "no"}`,
    `scripts dir exists: ${checks.scriptsDirExists ? "yes" : "no"}`,
    `runtime-context.sh exists: ${checks.runtimeContextExists ? "yes" : "no"}`,
    `missing checks: ${summary.missing}`,
  ].join("\n");
}

function formatSourcePageContractPreviewSummary(summary, issues, paths) {
  return [
    "LLM Wiki source page contract preview",
    `raw file: ${paths.rawFile}`,
    `output path: ${paths.outputPath}`,
    `content file: ${paths.contentFile}`,
    `cache state: ${paths.cacheState?.state || "unknown"}`,
    `would write source page: ${summary.wouldWriteSourcePage ? "yes" : "no"}`,
    `would update cache: ${summary.wouldUpdateCache ? "yes" : "no"}`,
    `issues: ${issues.length ? issues.join(", ") : "none"}`,
  ].join("\n");
}
