import path from "node:path";
import {
  deleteDryRun,
  diagnostics,
  buildGraph,
  getStatus,
  graphSourcePaths,
  getSavedWikiRoots,
  initWiki,
  listHanaAgents,
  listHanaSessions,
  linkDiagnostics,
  lintWiki,
  lintFixPreview,
  maintenanceDiagnostics,
  rememberWikiRoot,
  removeSavedWikiRoot,
  openWikiFolder,
  runtimeContextStatus,
  resolveWikiRoot,
  saveWikiRoot,
  serveWikiFile,
  sendHanaAgentWorkflow,
  sourceContractDiagnostics,
  sourceCoverage,
  sourceImageDiagnostics,
  sourcePageContractPreview,
  sourceSignalEligibility,
} from "../lib/wiki-core.js?v=0.1.14";

export default function registerViewerRoutes(app, ctx) {
  app.get("/viewer", async (c) => c.html(await renderViewer(c, ctx)));

  app.get("/api/status", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx);
    return c.json(await getStatus(wikiRoot));
  });

  app.get("/api/wiki-roots", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx);
    return c.json({
      ok: true,
      defaultWikiRoot: wikiRoot,
      wikiRoots: await getSavedWikiRoots(ctx),
    });
  });

  app.post("/api/wiki-roots", async (c) => {
    const body = await readJson(c);
    const result = await saveWikiRoot(ctx, typeof body.wikiRoot === "string" ? body.wikiRoot : "");
    return c.json(result, result.ok ? 200 : 422);
  });

  app.delete("/api/wiki-roots", async (c) => {
    const body = await readJson(c);
    const result = await removeSavedWikiRoot(ctx, typeof body.wikiRoot === "string" ? body.wikiRoot : "");
    return c.json(result, result.ok ? 200 : 422);
  });

  app.post("/api/current-root", async (c) => {
    const body = await readJson(c);
    const result = await rememberWikiRoot(ctx, typeof body.wikiRoot === "string" ? body.wikiRoot : "");
    return c.json(result, result.ok ? 200 : 422);
  });

  app.post("/api/open-folder", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx, await readJson(c));
    const result = await openWikiFolder(wikiRoot);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/diagnostics", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx);
    const result = await diagnostics(wikiRoot);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/link-diagnostics", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx);
    const result = await linkDiagnostics(wikiRoot);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/graph-source-paths", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx);
    const result = await graphSourcePaths(wikiRoot);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/source-image-diagnostics", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx);
    const result = await sourceImageDiagnostics(wikiRoot);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/source-contract-diagnostics", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx);
    const result = await sourceContractDiagnostics(wikiRoot);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/maintenance-diagnostics", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx);
    const result = await maintenanceDiagnostics(wikiRoot);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/source-signal-eligibility", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx);
    const result = await sourceSignalEligibility(wikiRoot);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/runtime-context", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx);
    const result = await runtimeContextStatus(wikiRoot);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.post("/api/build", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx, await readJson(c));
    const result = await buildGraph(wikiRoot);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.post("/api/lint", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx, await readJson(c));
    const result = await lintWiki(wikiRoot);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.post("/api/lint-fix-preview", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx, await readJson(c));
    const result = await lintFixPreview(wikiRoot);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.post("/api/init", async (c) => {
    const body = await readJson(c);
    const wikiRoot = await resolveWikiRoot(c, ctx, body);
    const result = await initWiki({ ...body, wikiRoot });
    const statusCode = ["already_initialized", "target_not_empty", "target_not_directory"].includes(result.error) ? 409 : 422;
    return c.json(result, result.ok ? 200 : statusCode);
  });

  app.post("/api/source-coverage", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx, await readJson(c));
    const result = await sourceCoverage(wikiRoot);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.post("/api/delete-dry-run", async (c) => {
    const body = await readJson(c);
    const wikiRoot = await resolveWikiRoot(c, ctx, body);
    const result = await deleteDryRun({ ...body, wikiRoot });
    return c.json(result, result.ok ? 200 : 422);
  });

  app.post("/api/source-page-contract-preview", async (c) => {
    const body = await readJson(c);
    const wikiRoot = await resolveWikiRoot(c, ctx, body);
    const result = await sourcePageContractPreview({ ...body, wikiRoot });
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/agents", async (c) => {
    const result = await listHanaAgents(ctx);
    return c.json(result, result.ok ? 200 : 503);
  });

  app.get("/api/sessions", async (c) => {
    const result = await listHanaSessions(ctx, { agentId: c.req.query("agentId") || "" });
    return c.json(result, result.ok ? 200 : 503);
  });

  app.post("/api/agent-send", async (c) => {
    const body = await readJson(c);
    const wikiRoot = await resolveWikiRoot(c, ctx, body);
    const result = await sendHanaAgentWorkflow(ctx, { ...body, wikiRoot });
    const statusCode = result.ok ? 200 : (result.error === "sessionPath_required" || result.error === "wikiRoot_required" ? 422 : 503);
    return c.json(result, statusCode);
  });

  app.get("/graph", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx);
    const graphPath = path.join(wikiRoot, "wiki", "knowledge-graph.html");
    return serveGraphFile(c, wikiRoot, graphPath, { graphPlaceholder: true });
  });

  app.get("/graph-assets/:file", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx);
    const file = c.req.param("file");
    const filePath = path.join(wikiRoot, "wiki", file);
    return serveGraphFile(c, wikiRoot, filePath);
  });

  app.get("/wiki-file/*", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx);
    const relativePath = decodeURIComponent(c.req.path.split("/wiki-file/")[1] || "");
    const filePath = path.join(wikiRoot, "wiki", relativePath);
    return serveGraphFile(c, wikiRoot, filePath);
  });
}

async function renderViewer(c, ctx) {
  const token = c.req.query("token") || "";
  const hanaCss = c.req.query("hana-css") || "";
  const theme = c.req.query("hana-theme") || "inherit";
  const wikiRoot = await resolveWikiRoot(c, ctx);
  const base = `/api/plugins/${ctx.pluginId}`;
  const graphUrl = addQuery(`${base}/graph`, { token, wikiRoot });
  const statusUrl = addQuery(`${base}/api/status`, { token, wikiRoot });
  const wikiRootsUrl = addQuery(`${base}/api/wiki-roots`, { token, wikiRoot });
  const currentRootUrl = addQuery(`${base}/api/current-root`, { token, wikiRoot });
  const openFolderUrl = addQuery(`${base}/api/open-folder`, { token, wikiRoot });
  const diagnosticsUrl = addQuery(`${base}/api/diagnostics`, { token, wikiRoot });
  const linkDiagnosticsUrl = addQuery(`${base}/api/link-diagnostics`, { token, wikiRoot });
  const graphSourcePathsUrl = addQuery(`${base}/api/graph-source-paths`, { token, wikiRoot });
  const sourceImageDiagnosticsUrl = addQuery(`${base}/api/source-image-diagnostics`, { token, wikiRoot });
  const sourceContractDiagnosticsUrl = addQuery(`${base}/api/source-contract-diagnostics`, { token, wikiRoot });
  const maintenanceDiagnosticsUrl = addQuery(`${base}/api/maintenance-diagnostics`, { token, wikiRoot });
  const buildUrl = addQuery(`${base}/api/build`, { token, wikiRoot });
  const lintUrl = addQuery(`${base}/api/lint`, { token, wikiRoot });
  const initUrl = addQuery(`${base}/api/init`, { token, wikiRoot });
  const coverageUrl = addQuery(`${base}/api/source-coverage`, { token, wikiRoot });
  const deleteDryRunUrl = addQuery(`${base}/api/delete-dry-run`, { token, wikiRoot });
  const agentsUrl = addQuery(`${base}/api/agents`, { token });
  const sessionsUrl = addQuery(`${base}/api/sessions`, { token });
  const agentSendUrl = addQuery(`${base}/api/agent-send`, { token, wikiRoot });

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${hanaCss ? `<link rel="stylesheet" href="${escapeAttr(hanaCss)}">` : ""}
  <title>LLM Wiki 控制台</title>
  <style>
    :root { color-scheme: light; --bg:#f7f5ef; --panel:#fffdf8; --line:#ddd4c2; --text:#26221d; --muted:#6f665a; --accent:#8b2e24; --ok:#1f7a4d; --bad:#a33a2a; --code:#171410; }
    * { box-sizing: border-box; }
    html, body { margin:0; width:100%; height:100%; font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif; color:var(--text); background:var(--bg); }
    body { display:grid; grid-template-rows:auto 1fr; overflow:hidden; }
    header { display:grid; grid-template-columns:auto minmax(220px,1fr) minmax(140px,190px) auto auto auto auto auto auto auto; gap:8px; align-items:center; padding:10px 12px; border-bottom:1px solid var(--line); background:var(--panel); }
    input, select, textarea { padding:0 10px; border:1px solid var(--line); border-radius:6px; background:white; color:var(--text); min-width:0; }
    input, select { height:34px; }
    textarea { width:100%; min-height:76px; padding:8px 10px; resize:vertical; font:13px/1.45 inherit; }
    button, a { min-height:34px; border:1px solid var(--line); border-radius:6px; background:white; color:var(--text); padding:0 10px; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; white-space:nowrap; }
    button.primary { background:var(--accent); color:white; border-color:var(--accent); }
    button:disabled { opacity:.55; cursor:default; }
    .icon-button { width:34px; min-width:34px; padding:0; }
    .icon-button svg { width:18px; height:18px; stroke:currentColor; stroke-width:1.8; fill:none; stroke-linecap:round; stroke-linejoin:round; }
    main { min-height:0; position:relative; display:grid; grid-template-columns:minmax(0,1fr); overflow:hidden; }
    iframe { width:100%; height:100%; border:0; background:white; }
    aside { position:absolute; top:0; right:0; z-index:5; width:min(440px,100%); height:100%; min-height:0; display:grid; grid-template-rows:auto auto auto auto minmax(0,1fr); gap:10px; padding:10px; border-left:1px solid var(--line); background:#fbf8f1; box-shadow:-18px 0 36px rgba(38,34,29,.16); overflow:hidden; transform:translateX(100%); transition:transform .18s ease; }
    body.drawer-open aside { transform:translateX(0); }
    .drawer-head { display:flex; align-items:center; justify-content:space-between; gap:8px; border:0; background:transparent; padding:0; }
    .drawer-head h2 { margin:0; font-size:14px; }
    section { border:1px solid var(--line); background:var(--panel); border-radius:8px; padding:10px; }
    h2 { margin:0 0 8px; font-size:13px; line-height:1.25; }
    .status { font-size:12px; color:var(--muted); white-space:nowrap; }
    .kv { display:grid; grid-template-columns:118px 1fr; gap:5px 8px; font-size:12px; line-height:1.35; }
    .key { color:var(--muted); }
    .value { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ok { color:var(--ok); }
    .bad { color:var(--bad); }
    .tool-row { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; }
    .init-row { display:grid; grid-template-columns:1fr 88px 72px; gap:6px; }
    .agent-row { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px; }
    .agent-actions { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:6px; }
    .diag-actions { display:grid; grid-template-columns:1fr auto; gap:6px; margin-top:8px; }
    pre { margin:0; width:100%; height:100%; min-height:180px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; color:#f6eee1; background:var(--code); border-radius:6px; padding:10px; font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
    @media (max-width: 860px) {
      body { overflow:auto; }
      header { grid-template-columns:1fr 1fr; }
      header strong, header input, header select { grid-column:1 / -1; }
      main { min-height:70vh; }
      aside { width:100%; border-left:0; border-top:1px solid var(--line); }
    }
  </style>
</head>
<body data-hana-theme="${escapeAttr(theme)}">
  <header>
    <strong>LLM Wiki 控制台</strong>
    <input id="wikiRoot" value="${escapeAttr(wikiRoot)}" spellcheck="false" aria-label="Wiki root">
    <select id="savedRoots" aria-label="已保存位置"><option value="">已保存位置</option></select>
    <button id="saveRoot" class="icon-button" title="保存位置" aria-label="保存位置">${iconSvg("save")}</button>
    <button id="removeRoot" class="icon-button" title="删除位置" aria-label="删除位置">${iconSvg("trash")}</button>
    <button id="openFolder" class="icon-button" title="访问文件夹" aria-label="访问文件夹">${iconSvg("folder")}</button>
    <button id="build" class="primary">生成/刷新</button>
    <button id="diagnostics">诊断</button>
    <a id="openGraph" href="${escapeAttr(graphUrl)}" target="_blank">单独打开</a>
    <span id="status" class="status">检查中...</span>
  </header>
  <main>
    <iframe id="graph" src="${escapeAttr(graphUrl)}"></iframe>
    <aside id="drawer" aria-label="诊断面板" aria-hidden="true">
      <section class="drawer-head">
        <h2>诊断面板</h2>
        <button id="closeDrawer" type="button">关闭</button>
      </section>
      <section>
        <h2>状态</h2>
        <div id="summary" class="kv"></div>
        <div class="tool-row" style="margin-top:8px;">
          <button id="runDiagnostics">运行诊断</button>
          <button id="safety">安全诊断</button>
          <button id="lint">结构检查</button>
          <button id="coverage">来源覆盖</button>
          <button id="sourceDiagnostics">来源诊断</button>
          <button id="maintenanceDiagnostics">维护诊断</button>
        </div>
        <div class="diag-actions">
          <input id="sourceFile" placeholder="source/raw 文件名" aria-label="Source file for delete dry-run">
          <button id="deleteDryRun">删除预检</button>
        </div>
      </section>
      <section>
        <h2>初始化</h2>
        <div class="init-row">
          <input id="topic" value="我的知识库" aria-label="Topic">
          <select id="language" aria-label="Language"><option value="zh">中文</option><option value="en">English</option></select>
          <button id="init">初始化</button>
        </div>
      </section>
      <section>
        <h2>Agent 工作流</h2>
        <div class="agent-row">
          <select id="agentSelect" aria-label="选择 Agent"><option value="">选择 Agent</option></select>
          <select id="sessionSelect" aria-label="选择会话"><option value="">选择会话</option></select>
        </div>
        <div class="agent-row">
          <select id="agentAction" aria-label="知识库任务">
            <option value="context">启动知识库上下文</option>
            <option value="ingest">添加素材</option>
            <option value="batch-ingest">批量消化</option>
            <option value="query">查询知识库</option>
            <option value="digest">深度整理</option>
            <option value="update">更新页面</option>
            <option value="maintenance">维护检查</option>
            <option value="crystallize">结晶化对话</option>
          </select>
          <button id="refreshAgents">刷新 Agent</button>
        </div>
        <textarea id="agentInput" aria-label="Agent 任务内容" placeholder="可留空；插件会发送当前知识库上下文"></textarea>
        <div class="agent-actions">
          <button id="sendAgent" class="primary">交给 Agent</button>
          <button id="copyAgentPrompt">复制 Prompt</button>
          <button id="clearAgentInput">清空内容</button>
        </div>
      </section>
      <section style="min-height:0; display:grid; grid-template-rows:auto 1fr;">
        <h2>运行输出</h2>
        <pre id="log">等待操作...</pre>
      </section>
    </aside>
  </main>
  <script>
    const statusEl = document.getElementById("status");
    const rootInput = document.getElementById("wikiRoot");
    const frame = document.getElementById("graph");
    const openGraph = document.getElementById("openGraph");
    const summary = document.getElementById("summary");
    const log = document.getElementById("log");
    const buildButton = document.getElementById("build");
    const saveRootButton = document.getElementById("saveRoot");
    const removeRootButton = document.getElementById("removeRoot");
    const openFolderButton = document.getElementById("openFolder");
    const diagnosticsButton = document.getElementById("diagnostics");
    const runDiagnosticsButton = document.getElementById("runDiagnostics");
    const safetyButton = document.getElementById("safety");
    const lintButton = document.getElementById("lint");
    const coverageButton = document.getElementById("coverage");
    const sourceDiagnosticsButton = document.getElementById("sourceDiagnostics");
    const maintenanceDiagnosticsButton = document.getElementById("maintenanceDiagnostics");
    const initButton = document.getElementById("init");
    const deleteDryRunButton = document.getElementById("deleteDryRun");
    const drawer = document.getElementById("drawer");
    const closeDrawerButton = document.getElementById("closeDrawer");
    const savedRootsSelect = document.getElementById("savedRoots");
    const agentSelect = document.getElementById("agentSelect");
    const sessionSelect = document.getElementById("sessionSelect");
    const agentAction = document.getElementById("agentAction");
    const agentInput = document.getElementById("agentInput");
    const refreshAgentsButton = document.getElementById("refreshAgents");
    const sendAgentButton = document.getElementById("sendAgent");
    const copyAgentPromptButton = document.getElementById("copyAgentPrompt");
    const clearAgentInputButton = document.getElementById("clearAgentInput");
    let lastAgentPrompt = "";

    function openDrawer() {
      document.body.classList.add("drawer-open");
      drawer.setAttribute("aria-hidden", "false");
    }

    function closeDrawer() {
      document.body.classList.remove("drawer-open");
      drawer.setAttribute("aria-hidden", "true");
    }

    function withRoot(url) {
      const u = new URL(url, location.origin);
      u.searchParams.set("wikiRoot", rootInput.value);
      return u.pathname + u.search;
    }

    function showLog(data) {
      const parts = [];
      if (data.error) parts.push("error: " + formatError(data.error));
      if (data.error) {
        const hint = errorHint(data.error);
        if (hint) parts.push(hint);
      }
      if (data.code !== undefined && data.code !== null) parts.push("exit code: " + data.code);
      if (data.stderr) parts.push(data.stderr.trim());
      if (data.counts || data.coverageSummary || data.adapterSummary || data.warnings) {
        parts.push(formatDiagnostics(data));
      }
      if (data.graphContractSummary) {
        parts.push(formatGraphContract(data.graphContractSummary));
      }
      if (data.sourceImageSummary || data.sourceContractSummary) {
        parts.push(formatSourceDiagnostics(data));
      }
      if (data.maintenanceSummary || data.orphanSources || data.purposeHints) {
        parts.push(formatMaintenanceDiagnostics(data));
      }
      if (data.prompt || data.result || data.sessionPath) {
        parts.push(formatAgentResult(data));
      }
      if (data.summary && (data.brokenLinks || data.orphanPages || data.missingSourcePath || data.references)) {
        parts.push(formatSafetyDiagnostics(data));
      }
      if (data.stdout) parts.push(data.stdout.trim());
      log.textContent = parts.filter(Boolean).join("\\n\\n") || JSON.stringify(data, null, 2);
    }

    function formatError(error) {
      const labels = {
        target_not_directory: "目标不是文件夹",
        target_not_empty: "目标目录非空",
        already_initialized: "知识库已初始化",
        not_llm_wiki_root: "不是 LLM Wiki 根目录",
        skill_missing: "Skill 缺失",
        wikiRoot_required: "请先输入位置",
        hana_bus_unavailable: "Hana Agent 通道不可用，请重载 Hana 插件后重试",
        agent_list_failed: "Agent 列表读取失败",
        session_list_failed: "会话列表读取失败",
        sessionPath_required: "请先选择会话",
        session_busy: "目标会话正在运行",
      };
      return labels[error] || error;
    }

    function errorHint(error) {
      const hints = {
        target_not_directory: "当前位置是文件，不是文件夹。请换一个文件夹路径，或先删除/改名这个同名文件后再点击“生成/刷新”。",
        target_not_empty: "为避免覆盖资料，插件不会初始化非空普通目录。请选择空文件夹或不存在的新文件夹路径。",
        not_llm_wiki_root: "请点击顶部“生成/刷新”让插件先安全初始化，或选择一个已有 LLM Wiki 根目录。",
        hana_bus_unavailable: "当前页面拿不到 Hana 原生 Agent 通道。请重载插件或重启 HanaAgent，再回到本页重试。",
        sessionPath_required: "请选择一个已有 Hana 会话；插件不会自动创建新会话。",
        session_busy: "目标会话正在生成。请稍后重试、换一个会话，或复制 Prompt 手动发送。",
      };
      return hints[error] || "";
    }

    function formatAgentResult(data) {
      const lines = ["Agent 投递摘要:"];
      if (data.action) lines.push("任务类型: " + formatAgentAction(data.action));
      if (data.sessionPath) lines.push("目标会话: " + data.sessionPath);
      if (data.result) lines.push("已接收: " + (data.result.accepted ? "是" : "否"));
      if (data.error) lines.push("状态: " + formatError(data.error));
      lines.push("下一步: " + (data.ok
        ? "等待 Agent 在目标会话完成；如有内容写入，请点击顶部“生成/刷新”。"
        : "按上方错误提示处理；必要时可复制 Prompt 手动发送。"));
      if (data.prompt) lines.push("\\n完整 Prompt:\\n" + data.prompt);
      return lines.join("\\n");
    }

    function formatAgentAction(action) {
      const labels = {
        context: "启动知识库上下文",
        ingest: "添加素材",
        "batch-ingest": "批量消化",
        query: "查询知识库",
        digest: "深度整理",
        update: "更新页面",
        maintenance: "维护检查",
        crystallize: "结晶化对话",
      };
      return labels[action] || action || "未指定";
    }

    function formatDiagnostics(data) {
      const lines = ["基础状态:"];
      if (data.counts) {
        lines.push("页面数: " + (data.counts.pages ?? 0));
        lines.push("raw 文件: " + (data.counts.rawFiles ?? 0));
        lines.push("来源/实体/主题: " + [data.counts.sources ?? 0, data.counts.entities ?? 0, data.counts.topics ?? 0].join("/"));
      }
      if (data.coverageSummary) {
        lines.push("\\n来源诊断:");
        lines.push("可覆盖项: " + (data.coverageSummary.applicable_total ?? 0));
        lines.push("已有来源线索: " + (data.coverageSummary.with_source_total ?? data.coverageSummary.covered_total ?? 0));
      }
      if (data.eligibilitySummary) {
        lines.push("来源信号可用: " + (data.eligibilitySummary.eligible ?? 0) + "/" + (data.eligibilitySummary.applicable ?? 0));
      }
      if (data.runtimeContextSummary) {
        lines.push("\\n运行环境:");
        lines.push("布局: " + (data.runtimeContextSummary.layoutMode || "unknown"));
        lines.push("缺失项: " + (data.runtimeContextSummary.missing ?? 0));
      }
      if (data.adapterSummary) {
        lines.push("可用 adapter: " + (data.adapterSummary.available ?? 0) + "/" + (data.adapterSummary.total ?? 0));
      }
      if (data.graphContractSummary) {
        lines.push("\\n图谱诊断: " + ((data.graphContractSummary.issues ?? 0) + " 个问题"));
      }
      if (data.maintenanceSummary) {
        lines.push("\\n维护诊断: " + maintenanceIssueCount(data.maintenanceSummary) + " 个问题");
      }
      if (Array.isArray(data.warnings) && data.warnings.length) {
        lines.push("\\n警告: " + data.warnings.join(", "));
      }
      return lines.join("\\n");
    }

    function formatGraphContract(summary) {
      const lines = ["graph contract:"];
      lines.push("ok: " + Boolean(summary.ok));
      lines.push("graph data/html: " + (summary.graphDataExists ? "yes" : "no") + "/" + (summary.graphHtmlExists ? "yes" : "no"));
      lines.push("nodes/edges: " + (summary.nodes ?? 0) + "/" + (summary.edges ?? 0));
      lines.push("isolated nodes: " + (summary.isolatedNodes ?? 0));
      lines.push("long labels: " + (summary.longLabels ?? 0));
      lines.push("source_path missing/outside/missing files: " + [summary.sourcePathMissing ?? 0, summary.sourcePathOutsideWiki ?? 0, summary.sourcePathMissingFiles ?? 0].join("/"));
      lines.push("broken/orphan/duplicate links: " + [summary.brokenLinks ?? 0, summary.orphanPages ?? 0, summary.duplicateTitles ?? 0].join("/"));
      lines.push("source coverage: " + (summary.sourceCovered ?? 0) + "/" + (summary.sourceApplicable ?? 0));
      lines.push("issues: " + (summary.issues ?? 0));
      if (Array.isArray(summary.warnings) && summary.warnings.length) lines.push("warnings: " + summary.warnings.join(", "));
      return lines.join("\\n");
    }

    function formatSafetyDiagnostics(data) {
      const lines = ["safety diagnostics:"];
      for (const [key, value] of Object.entries(data.summary || {})) {
        lines.push(key + ": " + value);
      }
      if (Array.isArray(data.references)) lines.push("references: " + data.references.length);
      if (Array.isArray(data.brokenLinks) && data.brokenLinks.length) lines.push("broken: " + data.brokenLinks.slice(0, 8).map((item) => item.from + " -> " + item.target).join("; "));
      if (Array.isArray(data.orphanPages) && data.orphanPages.length) lines.push("orphans: " + data.orphanPages.slice(0, 8).join(", "));
      if (Array.isArray(data.missingFiles) && data.missingFiles.length) lines.push("missing source files: " + data.missingFiles.slice(0, 8).map((item) => item.node).join(", "));
      return lines.join("\\n");
    }

    function formatSourceDiagnostics(data) {
      const lines = ["source diagnostics:"];
      const image = data.sourceImageSummary || {};
      const contract = data.sourceContractSummary || {};
      lines.push("source pages: " + (image.sourcePages ?? contract.sourcePages ?? 0));
      lines.push("empty image_paths: " + (image.emptyImagePaths ?? 0));
      lines.push("missing images: " + (image.missingImagePaths ?? 0));
      lines.push("image count mismatches: " + (image.imageCountMismatches ?? 0));
      lines.push("missing source_path: " + (contract.missingSourcePath ?? 0));
      lines.push("missing raw files: " + (contract.missingRawFiles ?? 0));
      lines.push("cache missing: " + (contract.cacheMissing ?? 0));
      return lines.join("\\n");
    }

    function formatMaintenanceDiagnostics(data) {
      const summary = data.maintenanceSummary || data.summary || {};
      const lines = ["维护诊断:"];
      lines.push("孤儿来源: " + (summary.orphanSources ?? 0));
      lines.push("孤儿 raw 文件: " + (summary.orphanRawFiles ?? 0));
      lines.push("缺失 source_path: " + (summary.missingSourcePaths ?? 0));
      lines.push("raw 文件问题: " + (summary.brokenRawFiles ?? 0));
      lines.push("陈旧 cache: " + (summary.staleCacheEntries ?? 0));
      lines.push("source frontmatter 问题: " + (summary.sourceFrontmatterIssues ?? 0));
      lines.push("缺来源信号页面: " + (summary.missingSourceSignals ?? 0));
      lines.push("query/digest 索引缺口: " + (summary.queryDigestIndexGaps ?? 0));
      lines.push("重复标题/文件名: " + (summary.duplicateTitles ?? 0));
      lines.push("purpose.md 提示: " + (summary.purposeHints ?? 0));
      if (Array.isArray(data.orphanSources) && data.orphanSources.length) lines.push("孤儿来源示例: " + data.orphanSources.slice(0, 8).join(", "));
      if (Array.isArray(data.orphanRawFiles) && data.orphanRawFiles.length) lines.push("孤儿 raw 示例: " + data.orphanRawFiles.slice(0, 8).join(", "));
      if (Array.isArray(data.missingSourcePaths) && data.missingSourcePaths.length) lines.push("缺 source_path: " + data.missingSourcePaths.slice(0, 8).join(", "));
      if (Array.isArray(data.brokenRawFiles) && data.brokenRawFiles.length) lines.push("raw 问题: " + data.brokenRawFiles.slice(0, 8).map((item) => item.page || item.source_path || JSON.stringify(item)).join(", "));
      if (Array.isArray(data.staleCacheEntries) && data.staleCacheEntries.length) lines.push("陈旧 cache: " + data.staleCacheEntries.slice(0, 8).map((item) => item.rawPath + " / " + item.reason).join(", "));
      if (Array.isArray(data.sourceFrontmatterIssues) && data.sourceFrontmatterIssues.length) lines.push("frontmatter 问题: " + data.sourceFrontmatterIssues.slice(0, 8).map((item) => item.page).join(", "));
      if (Array.isArray(data.missingSourceSignals) && data.missingSourceSignals.length) lines.push("缺来源信号: " + data.missingSourceSignals.slice(0, 8).map((item) => item.path + " / " + item.reason).join(", "));
      if (data.queryDigestIndexStatus?.missingFromIndex?.length) lines.push("索引缺口: " + data.queryDigestIndexStatus.missingFromIndex.slice(0, 8).map((item) => item.path).join(", "));
      if (Array.isArray(data.duplicateTitles) && data.duplicateTitles.length) lines.push("重复标题: " + data.duplicateTitles.slice(0, 8).map((item) => item.title).join(", "));
      if (Array.isArray(data.purposeHints) && data.purposeHints.length) lines.push("purpose.md 建议: " + data.purposeHints.join(", "));
      return lines.join("\\n");
    }

    function maintenanceIssueCount(summary) {
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
      ].reduce((sum, key) => sum + Number(summary?.[key] || 0), 0);
    }

    function setBusy(button, busy) {
      button.dataset.busy = busy ? "true" : "false";
      button.disabled = busy || button.dataset.locked === "true";
      statusEl.textContent = busy ? "运行中..." : statusEl.textContent;
    }

    function lockButton(button, locked) {
      button.dataset.locked = locked ? "true" : "false";
      button.disabled = locked || button.dataset.busy === "true";
    }

    function renderSummary(data) {
      const rows = [
        ["根目录", data.wikiRoot],
        ["Skill", data.skillRootExists ? "已找到" : "未找到"],
        ["Schema", data.schemaExists ? "存在" : "缺失"],
        ["wiki/", data.wikiDirExists ? "存在" : "缺失"],
        ["index.md", data.indexExists ? "存在" : "缺失"],
        ["研究目标文件", data.purposeExists ? "存在" : "缺失"],
        ["graph-data", data.graphDataExists ? "存在" : "缺失"],
        ["HTML 图谱", data.graphExists ? "存在" : "缺失"],
        ["Mermaid 图谱", data.mermaidGraphExists ? "存在" : "缺失"],
      ];
      summary.innerHTML = rows.map(([key, value]) => {
        const cls = value === "缺失" || value === "未找到" ? "bad" : value === "存在" || value === "已找到" ? "ok" : "";
        return '<div class="key">' + escapeHtml(key) + '</div><div class="value ' + cls + '" title="' + escapeHtml(value || "") + '">' + escapeHtml(value || "") + '</div>';
      }).join("");
      const isWiki = Boolean(data.ok);
      const hasRoot = Boolean(String(data.wikiRoot || rootInput.value || "").trim());
      lockButton(buildButton, !hasRoot || !data.skillRootExists);
      lockButton(diagnosticsButton, false);
      lockButton(runDiagnosticsButton, !isWiki || !data.skillRootExists);
      lockButton(safetyButton, !isWiki || !data.skillRootExists);
      lockButton(lintButton, !isWiki || !data.skillRootExists);
      lockButton(coverageButton, !isWiki || !data.skillRootExists);
      lockButton(sourceDiagnosticsButton, !isWiki || !data.skillRootExists);
      lockButton(maintenanceDiagnosticsButton, !isWiki || !data.skillRootExists);
      lockButton(deleteDryRunButton, !isWiki || !data.skillRootExists);
      lockButton(initButton, isWiki);
      if (!data.skillRootExists) {
        statusEl.textContent = "Skill 缺失";
      } else if (!isWiki) {
        statusEl.textContent = "未初始化";
      } else if (data.graphExists) {
        statusEl.textContent = "图谱已生成";
      } else {
        statusEl.textContent = "可构建";
      }
    }

    function renderDiagnostics(data) {
      summary.querySelectorAll(".diag-row").forEach((node) => node.remove());
      const counts = data.counts || {};
      const coverage = data.coverageSummary || {};
      const adapters = data.adapterSummary || {};
      const extra = [
        ["页面数", counts.pages],
        ["raw 文件", counts.rawFiles],
        ["来源页", counts.sources],
        ["实体/主题", [counts.entities ?? 0, counts.topics ?? 0].join("/")],
        ["Coverage", (coverage.with_source_total ?? coverage.covered_total ?? 0) + "/" + (coverage.applicable_total ?? 0)],
        ["来源信号", data.eligibilitySummary ? ((data.eligibilitySummary.eligible ?? 0) + "/" + (data.eligibilitySummary.applicable ?? 0)) : ""],
        ["运行环境", data.runtimeContextSummary ? ((data.runtimeContextSummary.layoutMode || "unknown") + " / 缺失 " + (data.runtimeContextSummary.missing ?? 0)) : ""],
        ["Adapters", (adapters.available ?? 0) + "/" + (adapters.total ?? 0)],
        ["Purpose", data.purposeSummary?.exists ? "存在" : "缺失"],
        ["图谱契约", data.graphContractSummary ? ((data.graphContractSummary.issues ?? 0) + " 个问题") : ""],
        ["Images", data.sourceImageSummary ? ((data.sourceImageSummary.missingImagePaths ?? 0) + " 缺失") : ""],
        ["Source/cache", data.sourceContractSummary ? ((data.sourceContractSummary.cacheMissing ?? 0) + " cache 缺失") : ""],
        ["维护诊断", data.maintenanceSummary ? (maintenanceIssueCount(data.maintenanceSummary) + " 个问题") : ""],
      ];
      const html = extra.map(([key, value]) => '<div class="key diag-row">' + escapeHtml(key) + '</div><div class="value diag-row" title="' + escapeHtml(value ?? "") + '">' + escapeHtml(value ?? "") + '</div>').join("");
      summary.insertAdjacentHTML("beforeend", html);
    }

    async function refreshStatus(options = {}) {
      const r = await fetch(withRoot(${JSON.stringify(statusUrl)}), { credentials: "include" });
      const data = await r.json();
      renderSummary(data);
      if (options.openHelp !== false && !data.ok && (!rootInput.value || rootInput.value.endsWith("/llm-wiki"))) {
        openDrawer();
        log.textContent = "请选择或输入知识库位置。首次使用时，可以在顶部输入目标路径后点击“生成/刷新”，插件会先安全初始化再生成图谱。非空普通目录会被拒绝写入。";
      }
      return data;
    }

    async function refreshWikiRoots() {
      const r = await fetch(withRoot(${JSON.stringify(wikiRootsUrl)}), { credentials: "include" });
      const data = await r.json();
      const roots = Array.isArray(data.wikiRoots) ? data.wikiRoots : [];
      savedRootsSelect.innerHTML = '<option value="">已保存位置</option>' + roots.map((root) => {
        const selected = root === rootInput.value ? " selected" : "";
        return '<option value="' + escapeHtml(root) + '"' + selected + ' title="' + escapeHtml(root) + '">' + escapeHtml(shortRootName(root)) + '</option>';
      }).join("");
      lockButton(removeRootButton, !savedRootsSelect.value);
      return data;
    }

    async function rememberCurrentRoot() {
      const root = rootInput.value.trim();
      if (!root) return { ok: false, error: "wikiRoot_required" };
      try {
        const r = await fetch(withRoot(${JSON.stringify(currentRootUrl)}), {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ wikiRoot: root }),
        });
        const data = await r.json();
        if (data.ok) await refreshWikiRoots();
        return data;
      } catch (error) {
        return { ok: false, error: "remember_root_failed", stderr: error.message || String(error) };
      }
    }

    async function refreshAgents() {
      setBusy(refreshAgentsButton, true);
      const previousAgent = agentSelect.value;
      const r = await fetch(${JSON.stringify(agentsUrl)}, { credentials: "include" });
      const data = await r.json();
      if (!data.ok) {
        statusEl.textContent = "Agent 读取失败";
        showLog(data);
        setBusy(refreshAgentsButton, false);
        return data;
      }
      const agents = Array.isArray(data.agents) ? data.agents : [];
      agentSelect.innerHTML = '<option value="">选择 Agent</option>' + agents.map((agent) => {
        const selected = agent.id === previousAgent || (!previousAgent && (agent.isCurrent || agent.isPrimary)) ? " selected" : "";
        const label = agent.name || agent.id || "未命名 Agent";
        return '<option value="' + escapeHtml(agent.id || "") + '"' + selected + '>' + escapeHtml(label) + '</option>';
      }).join("");
      await refreshSessions();
      setBusy(refreshAgentsButton, false);
      return data;
    }

    async function refreshSessions() {
      const agentId = agentSelect.value;
      const u = new URL(${JSON.stringify(sessionsUrl)}, location.origin);
      if (agentId) u.searchParams.set("agentId", agentId);
      const previousSession = sessionSelect.value;
      const r = await fetch(u.pathname + u.search, { credentials: "include" });
      const data = await r.json();
      if (!data.ok) {
        sessionSelect.innerHTML = '<option value="">会话读取失败</option>';
        showLog(data);
        return data;
      }
      const sessions = Array.isArray(data.sessions) ? data.sessions : [];
      sessionSelect.innerHTML = '<option value="">选择会话</option>' + sessions.map((session) => {
        const selected = session.path === previousSession ? " selected" : "";
        const label = session.title || session.firstMessage || session.path || "未命名会话";
        const meta = session.agentName ? " · " + session.agentName : "";
        return '<option value="' + escapeHtml(session.path || "") + '"' + selected + ' title="' + escapeHtml(session.path || "") + '">' + escapeHtml(shortText(label, 28) + meta) + '</option>';
      }).join("");
      lockButton(sendAgentButton, !sessionSelect.value);
      return data;
    }

    async function sendAgentWorkflow() {
      openDrawer();
      const sessionPath = sessionSelect.value;
      if (!sessionPath) {
        statusEl.textContent = "请先选择会话";
        showLog({ ok: false, error: "sessionPath_required" });
        return;
      }
      setBusy(sendAgentButton, true);
      const body = {
        wikiRoot: rootInput.value,
        sessionPath,
        action: agentAction.value,
        input: agentInput.value,
      };
      const r = await fetch(withRoot(${JSON.stringify(agentSendUrl)}), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.prompt) lastAgentPrompt = data.prompt;
      statusEl.textContent = data.ok ? "已交给 Agent" : "Agent 调用失败";
      if (data.ok) {
        data.stdout = agentAction.value === "context"
          ? "已把当前知识库上下文发送给 Agent。后续写入完成后，请点击顶部“生成/刷新”。"
          : "任务已交给 Agent。Agent 完成内容写入后，请点击顶部“生成/刷新”更新图谱。";
      }
      showLog(data);
      setBusy(sendAgentButton, false);
    }

    async function copyAgentPrompt() {
      if (!lastAgentPrompt) {
        statusEl.textContent = "暂无可复制 Prompt";
        showLog({ ok: false, error: "no_agent_prompt", stderr: "请先向 Agent 投递一次任务，或在投递失败后再复制 Prompt。" });
        return;
      }
      try {
        await writeClipboardText(lastAgentPrompt);
        statusEl.textContent = "Prompt 已复制";
        showLog({ ok: true, stdout: "Prompt 已复制，可手动粘贴到目标 Hana 会话。" });
      } catch (error) {
        statusEl.textContent = "复制失败";
        showLog({ ok: false, error: "copy_prompt_failed", stderr: error.message || String(error) });
      }
    }

    async function writeClipboardText(text) {
      if (window.hana?.clipboard?.writeText) {
        return window.hana.clipboard.writeText(text);
      }
      try {
        await hanaHostRequest("clipboard.writeText", { text });
        return;
      } catch {
        if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
        throw new Error("clipboard_unavailable");
      }
    }

    function hanaHostRequest(type, payload, timeoutMs = 10000) {
      const params = new URLSearchParams(location.search);
      const explicitOrigin = params.get("hana-host-origin");
      let origin = explicitOrigin || "*";
      if (!explicitOrigin) {
        try { origin = new URL(document.referrer).origin || "*"; } catch { origin = "*"; }
      }
      const id = "llm-wiki-viewer-" + Date.now() + "-" + Math.random().toString(16).slice(2);
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          window.removeEventListener("message", onMessage);
          reject(new Error("host_request_timeout"));
        }, timeoutMs);
        function onMessage(event) {
          if (event.source !== window.parent) return;
          if (origin !== "*" && event.origin !== origin) return;
          const message = event.data || {};
          if (message.protocol !== "hana-plugin" || message.version !== 1 || message.id !== id || message.type !== type) return;
          window.clearTimeout(timer);
          window.removeEventListener("message", onMessage);
          if (message.kind === "error") reject(new Error(message.error?.message || "host_request_failed"));
          else resolve(message.payload);
        }
        window.addEventListener("message", onMessage);
        window.parent?.postMessage?.({ protocol: "hana-plugin", version: 1, id, kind: "request", type, payload }, origin);
      });
    }

    function updateAgentInputPlaceholder() {
      agentInput.placeholder = agentAction.value === "context"
        ? "可留空；插件会发送当前知识库上下文"
        : "粘贴链接、文件路径、问题或维护目标";
    }

    async function saveCurrentRoot() {
      const root = rootInput.value.trim();
      if (!root) {
        statusEl.textContent = "请先输入位置";
        openDrawer();
        log.textContent = "请先在顶部输入知识库位置。";
        return;
      }
      setBusy(saveRootButton, true);
      const r = await fetch(withRoot(${JSON.stringify(wikiRootsUrl)}), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wikiRoot: root }),
      });
      const data = await r.json();
      statusEl.textContent = data.ok ? "位置已保存" : "保存失败";
      if (!data.ok) showLog(data);
      await refreshWikiRoots();
      setBusy(saveRootButton, false);
    }

    async function removeSelectedRoot() {
      const root = savedRootsSelect.value;
      if (!root) {
        statusEl.textContent = "请先选择位置";
        return;
      }
      setBusy(removeRootButton, true);
      const r = await fetch(withRoot(${JSON.stringify(wikiRootsUrl)}), {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wikiRoot: root }),
      });
      const data = await r.json();
      statusEl.textContent = data.ok ? "位置已删除" : "删除失败";
      if (!data.ok) showLog(data);
      if (rootInput.value === root) {
        rootInput.value = data.defaultWikiRoot || "";
        const url = withRoot(${JSON.stringify(graphUrl)});
        frame.src = url;
        openGraph.href = url;
        await refreshStatus();
      }
      await refreshWikiRoots();
      setBusy(removeRootButton, false);
    }

    async function openCurrentFolder() {
      const root = rootInput.value.trim();
      if (!root) {
        statusEl.textContent = "请先输入位置";
        return;
      }
      setBusy(openFolderButton, true);
      await rememberCurrentRoot();
      const r = await fetch(withRoot(${JSON.stringify(openFolderUrl)}), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wikiRoot: root }),
      });
      const data = await r.json();
      statusEl.textContent = data.ok ? "已打开位置" : "打开失败";
      if (!data.ok) {
        openDrawer();
        showLog(data);
      }
      setBusy(openFolderButton, false);
    }

    async function runDiagnostics() {
      openDrawer();
      setBusy(runDiagnosticsButton, true);
      const r = await fetch(withRoot(${JSON.stringify(diagnosticsUrl)}), { credentials: "include" });
      const data = await r.json();
      statusEl.textContent = data.ok ? "诊断完成" : "诊断失败";
      if (data.ok) renderDiagnostics(data);
      showLog(data);
      setBusy(runDiagnosticsButton, false);
    }

    async function runSafetyDiagnostics() {
      openDrawer();
      setBusy(safetyButton, true);
      const [links, graphPaths] = await Promise.all([
        fetch(withRoot(${JSON.stringify(linkDiagnosticsUrl)}), { credentials: "include" }).then((r) => r.json()),
        fetch(withRoot(${JSON.stringify(graphSourcePathsUrl)}), { credentials: "include" }).then((r) => r.json()),
      ]);
      statusEl.textContent = links.ok && graphPaths.ok ? "安全诊断完成" : "安全诊断发现问题";
      showLog({
        ok: links.ok && graphPaths.ok,
        summary: {
          brokenLinks: links.summary?.brokenLinks ?? 0,
          orphanPages: links.summary?.orphanPages ?? 0,
          duplicateTitles: links.summary?.duplicateTitles ?? 0,
          missingSourcePath: graphPaths.summary?.missingSourcePath ?? 0,
          missingSourceFiles: graphPaths.summary?.missingFiles ?? 0,
        },
        brokenLinks: links.brokenLinks || [],
        orphanPages: links.orphanPages || [],
        duplicateTitles: links.duplicateTitles || [],
        missingSourcePath: graphPaths.missingSourcePath || [],
        missingFiles: graphPaths.missingFiles || [],
        stdout: [links.stdout, graphPaths.stdout].filter(Boolean).join("\\n\\n"),
        stderr: [links.stderr, graphPaths.stderr].filter(Boolean).join("\\n"),
        error: links.error || graphPaths.error || "",
      });
      setBusy(safetyButton, false);
    }

    async function runSourceDiagnostics() {
      openDrawer();
      setBusy(sourceDiagnosticsButton, true);
      const [images, contracts] = await Promise.all([
        fetch(withRoot(${JSON.stringify(sourceImageDiagnosticsUrl)}), { credentials: "include" }).then((r) => r.json()),
        fetch(withRoot(${JSON.stringify(sourceContractDiagnosticsUrl)}), { credentials: "include" }).then((r) => r.json()),
      ]);
      statusEl.textContent = images.ok && contracts.ok ? "来源诊断完成" : "来源诊断发现问题";
      showLog({
        ok: images.ok && contracts.ok,
        sourceImageSummary: images.summary || null,
        sourceContractSummary: contracts.summary || null,
        emptyImagePaths: images.emptyImagePaths || [],
        missingImagePaths: images.missingImagePaths || [],
        imageCountMismatches: images.imageCountMismatches || [],
        missingSourcePath: contracts.missingSourcePath || [],
        missingRawFiles: contracts.missingRawFiles || [],
        cacheMissing: contracts.cacheMissing || [],
        cacheMismatches: contracts.cacheMismatches || [],
        stdout: [images.stdout, contracts.stdout].filter(Boolean).join("\\n\\n"),
        stderr: [images.stderr, contracts.stderr].filter(Boolean).join("\\n"),
        error: images.error || contracts.error || "",
      });
      setBusy(sourceDiagnosticsButton, false);
    }

    async function runMaintenanceDiagnostics() {
      openDrawer();
      setBusy(maintenanceDiagnosticsButton, true);
      const r = await fetch(withRoot(${JSON.stringify(maintenanceDiagnosticsUrl)}), { credentials: "include" });
      const data = await r.json();
      statusEl.textContent = data.ok ? "维护诊断完成" : "维护诊断发现问题";
      showLog(data);
      setBusy(maintenanceDiagnosticsButton, false);
    }

    async function runDeleteDryRun() {
      openDrawer();
      setBusy(deleteDryRunButton, true);
      const body = { wikiRoot: rootInput.value, sourceFile: document.getElementById("sourceFile").value };
      const r = await fetch(withRoot(${JSON.stringify(deleteDryRunUrl)}), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      statusEl.textContent = data.ok ? "删除预检完成" : "删除预检失败";
      showLog(data);
      setBusy(deleteDryRunButton, false);
    }

    function defaultTopic() {
      const explicit = document.getElementById("topic").value.trim();
      if (explicit) return explicit;
      return shortRootName(rootInput.value) || "我的知识库";
    }

    async function initCurrentWiki() {
      const body = {
        wikiRoot: rootInput.value,
        topic: defaultTopic(),
        language: document.getElementById("language").value,
      };
      const r = await fetch(withRoot(${JSON.stringify(initUrl)}), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return r.json();
    }

    async function buildCurrentWiki() {
      const r = await fetch(withRoot(${JSON.stringify(buildUrl)}), { method: "POST", credentials: "include" });
      return r.json();
    }

    function combineRunLogs(results) {
      log.textContent = results.map(([label, data]) => {
        const parts = [label];
        if (data.error) parts.push("error: " + data.error);
        if (data.code !== undefined && data.code !== null) parts.push("exit code: " + data.code);
        if (data.stderr) parts.push(data.stderr.trim());
        if (data.stdout) parts.push(data.stdout.trim());
        if (parts.length === 1) parts.push(JSON.stringify(data, null, 2));
        return parts.filter(Boolean).join("\\n");
      }).join("\\n\\n");
    }

    async function generateOrRefresh() {
      const root = rootInput.value.trim();
      if (!root) {
        statusEl.textContent = "请先输入位置";
        log.textContent = "请先在顶部输入知识库位置。";
        return;
      }

      setBusy(buildButton, true);
      await rememberCurrentRoot();
      let status = await refreshStatus({ openHelp: false });
      let data;
      const runLogs = [];
      let buildRan = false;
      let mode = status.graphExists ? "refresh" : "generate";
      if (!status.skillRootExists) {
        data = { ok: false, error: "skill_missing", wikiRoot: status.wikiRoot };
      } else if (status.ok) {
        data = await buildCurrentWiki();
        buildRan = true;
      } else {
        const initData = await initCurrentWiki();
        runLogs.push(["init:", initData]);
        if (initData.ok || initData.error === "already_initialized") {
          status = await refreshStatus({ openHelp: false });
          mode = status.graphExists ? "refresh" : "generate";
          data = await buildCurrentWiki();
          buildRan = true;
        } else {
          data = initData;
        }
      }
      if (buildRan) runLogs.push(["build:", data]);
      statusEl.textContent = data.ok ? (mode === "refresh" ? "刷新完成" : "生成完成") : (formatError(data.error) || (mode === "refresh" ? "刷新失败" : "生成失败"));
      if (runLogs.length > 1) combineRunLogs(runLogs);
      else showLog(data);
      if (data.ok) await saveCurrentRoot();
      await refreshStatus({ openHelp: false });
      if (data.ok) {
        const url = withRoot(${JSON.stringify(graphUrl)}) + "&_=" + Date.now();
        frame.src = url;
        openGraph.href = url;
      }
      setBusy(buildButton, false);
    }

    buildButton.addEventListener("click", generateOrRefresh);

    async function runLint() {
      openDrawer();
      setBusy(lintButton, true);
      const r = await fetch(withRoot(${JSON.stringify(lintUrl)}), { method: "POST", credentials: "include" });
      const data = await r.json();
      statusEl.textContent = data.ok ? "结构检查完成" : "结构检查失败";
      showLog(data);
      setBusy(lintButton, false);
    }

    async function runCoverage() {
      openDrawer();
      setBusy(coverageButton, true);
      const r = await fetch(withRoot(${JSON.stringify(coverageUrl)}), { method: "POST", credentials: "include" });
      const data = await r.json();
      statusEl.textContent = data.ok ? "来源覆盖完成" : "来源覆盖失败";
      showLog(data);
      setBusy(coverageButton, false);
    }

    initButton.addEventListener("click", async () => {
      openDrawer();
      setBusy(initButton, true);
      const data = await initCurrentWiki();
      statusEl.textContent = data.ok ? "初始化完成" : "初始化失败";
      showLog(data);
      if (data.ok) await saveCurrentRoot();
      await refreshStatus();
      setBusy(initButton, false);
    });

    rootInput.addEventListener("change", () => {
      const url = withRoot(${JSON.stringify(graphUrl)});
      frame.src = url;
      openGraph.href = url;
      refreshStatus();
      rememberCurrentRoot();
      refreshWikiRoots();
    });

    savedRootsSelect.addEventListener("change", () => {
      if (!savedRootsSelect.value) return;
      rootInput.value = savedRootsSelect.value;
      const url = withRoot(${JSON.stringify(graphUrl)});
      frame.src = url;
      openGraph.href = url;
      refreshStatus();
      rememberCurrentRoot();
      refreshWikiRoots();
    });

    closeDrawerButton.addEventListener("click", closeDrawer);
    saveRootButton.addEventListener("click", saveCurrentRoot);
    removeRootButton.addEventListener("click", removeSelectedRoot);
    openFolderButton.addEventListener("click", openCurrentFolder);
    diagnosticsButton.addEventListener("click", runDiagnostics);
    runDiagnosticsButton.addEventListener("click", runDiagnostics);
    safetyButton.addEventListener("click", runSafetyDiagnostics);
    deleteDryRunButton.addEventListener("click", runDeleteDryRun);
    lintButton.addEventListener("click", runLint);
    coverageButton.addEventListener("click", runCoverage);
    sourceDiagnosticsButton.addEventListener("click", runSourceDiagnostics);
    maintenanceDiagnosticsButton.addEventListener("click", runMaintenanceDiagnostics);
    refreshAgentsButton.addEventListener("click", refreshAgents);
    agentSelect.addEventListener("change", refreshSessions);
    agentAction.addEventListener("change", updateAgentInputPlaceholder);
    sessionSelect.addEventListener("change", () => lockButton(sendAgentButton, !sessionSelect.value));
    sendAgentButton.addEventListener("click", sendAgentWorkflow);
    copyAgentPromptButton.addEventListener("click", copyAgentPrompt);
    clearAgentInputButton.addEventListener("click", () => { agentInput.value = ""; agentInput.focus(); });

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
    }

    function shortRootName(root) {
      const clean = String(root || "").replace(/[\\\\/]+$/, "");
      const parts = clean.split(/[\\\\/]+/).filter(Boolean);
      return parts[parts.length - 1] || clean || "未命名位置";
    }

    function shortText(value, maxLength) {
      const text = String(value || "").replace(/\\s+/g, " ").trim();
      return text.length > maxLength ? text.slice(0, maxLength - 1) + "…" : text;
    }

    refreshWikiRoots().finally(refreshStatus);
    updateAgentInputPlaceholder();
    refreshAgents();
    window.parent?.postMessage?.({ source: "hana-plugin", type: "ready" }, "*");
  </script>
</body>
</html>`;
}

async function serveGraphFile(c, wikiRoot, filePath, options = {}) {
  const token = c.req.query("token") || "";
  const wikiRootParam = c.req.query("wikiRoot") || wikiRoot;
  const suffix = `?${new URLSearchParams({ token, wikiRoot: wikiRootParam }).toString()}`;
  if (options.graphPlaceholder) {
    const status = await getStatus(wikiRoot);
    if (!status.graphExists) return c.html(renderGraphPlaceholder(status), 404);
  }
  return serveWikiFile(c, wikiRoot, filePath, {
    assetBase: "/api/plugins/llm-wiki-viewer/graph-assets/",
    fileBase: "/api/plugins/llm-wiki-viewer/wiki-file/",
    suffix,
  });
}

function renderGraphPlaceholder(status) {
  const root = escapeAttr(status.wikiRoot || "");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>图谱未生成</title>
  <style>
    :root { color-scheme: light; --bg:#fffdf8; --text:#26221d; --muted:#6f665a; --line:#ddd4c2; --accent:#8b2e24; }
    * { box-sizing:border-box; }
    html, body { margin:0; min-height:100%; font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif; color:var(--text); background:var(--bg); }
    body { display:grid; place-items:start center; padding:56px 18px; }
    .empty { width:min(560px,100%); border:1px solid var(--line); border-radius:8px; padding:20px; background:#fffaf0; box-shadow:0 10px 30px rgba(38,34,29,.08); }
    h1 { margin:0 0 10px; font-size:20px; line-height:1.3; }
    p { margin:8px 0; color:var(--muted); font-size:14px; line-height:1.7; }
    .action { color:var(--accent); font-weight:700; }
    .path { margin-top:12px; padding:8px 10px; border-radius:6px; background:white; border:1px solid var(--line); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  </style>
</head>
<body>
  <main class="empty">
    <h1>图谱还没有生成</h1>
    <p>请点击页面顶部右侧的 <span class="action">生成/刷新</span> 按钮。首次使用时插件会先安全初始化，再生成知识图谱。</p>
    <p>如果这里已经是知识库，再次点击 <span class="action">生成/刷新</span> 会刷新图谱。</p>
    ${root ? `<div class="path" title="${root}">${root}</div>` : ""}
  </main>
</body>
</html>`;
}

async function readJson(c) {
  try { return await c.req.json(); } catch { return {}; }
}

function addQuery(url, params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return `${url}?${search.toString()}`;
}

function iconSvg(name) {
  const icons = {
    save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v6h8V4"/><path d="M8 20v-6h8v6"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M7 7l1 13h8l1-13"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>',
    folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 3h9v10H3z"/><path d="M3 9h18"/></svg>',
  };
  return icons[name] || "";
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
