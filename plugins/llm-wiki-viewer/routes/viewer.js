import path from "node:path";
import {
  buildGraph,
  getStatus,
  initWiki,
  lintWiki,
  resolveWikiRoot,
  serveWikiFile,
  sourceCoverage,
} from "../lib/wiki-core.js";

export default function registerViewerRoutes(app, ctx) {
  app.get("/viewer", async (c) => c.html(await renderViewer(c, ctx)));

  app.get("/api/status", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx);
    return c.json(await getStatus(wikiRoot));
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

  app.post("/api/init", async (c) => {
    const body = await readJson(c);
    const wikiRoot = await resolveWikiRoot(c, ctx, body);
    const result = await initWiki({ ...body, wikiRoot });
    const statusCode = ["already_initialized", "target_not_empty"].includes(result.error) ? 409 : 422;
    return c.json(result, result.ok ? 200 : statusCode);
  });

  app.post("/api/source-coverage", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx, await readJson(c));
    const result = await sourceCoverage(wikiRoot);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/graph", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx);
    const graphPath = path.join(wikiRoot, "wiki", "knowledge-graph.html");
    return serveGraphFile(c, wikiRoot, graphPath);
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
  const buildUrl = addQuery(`${base}/api/build`, { token, wikiRoot });
  const lintUrl = addQuery(`${base}/api/lint`, { token, wikiRoot });
  const initUrl = addQuery(`${base}/api/init`, { token, wikiRoot });
  const coverageUrl = addQuery(`${base}/api/source-coverage`, { token, wikiRoot });

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
    header { display:grid; grid-template-columns:auto minmax(220px,1fr) auto auto auto auto auto; gap:8px; align-items:center; padding:10px 12px; border-bottom:1px solid var(--line); background:var(--panel); }
    input, select { height:34px; padding:0 10px; border:1px solid var(--line); border-radius:6px; background:white; color:var(--text); min-width:0; }
    button, a { min-height:34px; border:1px solid var(--line); border-radius:6px; background:white; color:var(--text); padding:0 10px; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; white-space:nowrap; }
    button.primary { background:var(--accent); color:white; border-color:var(--accent); }
    button:disabled { opacity:.55; cursor:default; }
    main { min-height:0; display:grid; grid-template-columns:minmax(0,1fr) 360px; }
    iframe { width:100%; height:100%; border:0; background:white; }
    aside { min-height:0; display:grid; grid-template-rows:auto auto minmax(0,1fr); gap:10px; padding:10px; border-left:1px solid var(--line); background:#fbf8f1; overflow:hidden; }
    section { border:1px solid var(--line); background:var(--panel); border-radius:8px; padding:10px; }
    h2 { margin:0 0 8px; font-size:13px; line-height:1.25; }
    .status { font-size:12px; color:var(--muted); white-space:nowrap; }
    .kv { display:grid; grid-template-columns:118px 1fr; gap:5px 8px; font-size:12px; line-height:1.35; }
    .key { color:var(--muted); }
    .value { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ok { color:var(--ok); }
    .bad { color:var(--bad); }
    .init-row { display:grid; grid-template-columns:1fr 88px 72px; gap:6px; }
    pre { margin:0; width:100%; height:100%; min-height:180px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; color:#f6eee1; background:var(--code); border-radius:6px; padding:10px; font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
    @media (max-width: 860px) {
      body { overflow:auto; }
      header { grid-template-columns:1fr 1fr; }
      header strong, header input { grid-column:1 / -1; }
      main { grid-template-columns:1fr; grid-template-rows:70vh auto; }
      aside { border-left:0; border-top:1px solid var(--line); overflow:visible; }
    }
  </style>
</head>
<body data-hana-theme="${escapeAttr(theme)}">
  <header>
    <strong>LLM Wiki 控制台</strong>
    <input id="wikiRoot" value="${escapeAttr(wikiRoot)}" spellcheck="false" aria-label="Wiki root">
    <button id="build" class="primary">生成/刷新</button>
    <button id="lint">Lint</button>
    <button id="coverage">Coverage</button>
    <a id="openGraph" href="${escapeAttr(graphUrl)}" target="_blank">单独打开</a>
    <span id="status" class="status">检查中...</span>
  </header>
  <main>
    <iframe id="graph" src="${escapeAttr(graphUrl)}"></iframe>
    <aside>
      <section>
        <h2>状态</h2>
        <div id="summary" class="kv"></div>
      </section>
      <section>
        <h2>初始化</h2>
        <div class="init-row">
          <input id="topic" value="我的知识库" aria-label="Topic">
          <select id="language" aria-label="Language"><option value="zh">中文</option><option value="en">English</option></select>
          <button id="init">Init</button>
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
    const lintButton = document.getElementById("lint");
    const coverageButton = document.getElementById("coverage");
    const initButton = document.getElementById("init");

    function withRoot(url) {
      const u = new URL(url, location.origin);
      u.searchParams.set("wikiRoot", rootInput.value);
      return u.pathname + u.search;
    }

    function showLog(data) {
      const parts = [];
      if (data.error) parts.push("error: " + data.error);
      if (data.code !== undefined && data.code !== null) parts.push("exit code: " + data.code);
      if (data.stderr) parts.push(data.stderr.trim());
      if (data.stdout) parts.push(data.stdout.trim());
      log.textContent = parts.filter(Boolean).join("\\n\\n") || JSON.stringify(data, null, 2);
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
        ["graph-data", data.graphDataExists ? "存在" : "缺失"],
        ["HTML 图谱", data.graphExists ? "存在" : "缺失"],
      ];
      summary.innerHTML = rows.map(([key, value]) => {
        const cls = value === "缺失" || value === "未找到" ? "bad" : value === "存在" || value === "已找到" ? "ok" : "";
        return '<div class="key">' + escapeHtml(key) + '</div><div class="value ' + cls + '" title="' + escapeHtml(value || "") + '">' + escapeHtml(value || "") + '</div>';
      }).join("");
      const isWiki = Boolean(data.ok);
      lockButton(buildButton, !isWiki || !data.skillRootExists);
      lockButton(lintButton, !isWiki || !data.skillRootExists);
      lockButton(coverageButton, !isWiki || !data.skillRootExists);
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

    async function refreshStatus() {
      const r = await fetch(withRoot(${JSON.stringify(statusUrl)}), { credentials: "include" });
      const data = await r.json();
      renderSummary(data);
      return data;
    }

    buildButton.addEventListener("click", async () => {
      setBusy(buildButton, true);
      const r = await fetch(withRoot(${JSON.stringify(buildUrl)}), { method: "POST", credentials: "include" });
      const data = await r.json();
      statusEl.textContent = data.ok ? "生成完成" : "生成失败";
      showLog(data);
      await refreshStatus();
      const url = withRoot(${JSON.stringify(graphUrl)}) + "&_=" + Date.now();
      frame.src = url;
      openGraph.href = url;
      setBusy(buildButton, false);
    });

    lintButton.addEventListener("click", async () => {
      setBusy(lintButton, true);
      const r = await fetch(withRoot(${JSON.stringify(lintUrl)}), { method: "POST", credentials: "include" });
      const data = await r.json();
      statusEl.textContent = data.ok ? "Lint 完成" : "Lint 失败";
      showLog(data);
      setBusy(lintButton, false);
    });

    coverageButton.addEventListener("click", async () => {
      setBusy(coverageButton, true);
      const r = await fetch(withRoot(${JSON.stringify(coverageUrl)}), { method: "POST", credentials: "include" });
      const data = await r.json();
      statusEl.textContent = data.ok ? "Coverage 完成" : "Coverage 失败";
      showLog(data);
      setBusy(coverageButton, false);
    });

    initButton.addEventListener("click", async () => {
      setBusy(initButton, true);
      const body = { wikiRoot: rootInput.value, topic: document.getElementById("topic").value, language: document.getElementById("language").value };
      const r = await fetch(withRoot(${JSON.stringify(initUrl)}), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      statusEl.textContent = data.ok ? "初始化完成" : "初始化失败";
      showLog(data);
      await refreshStatus();
      setBusy(initButton, false);
    });

    rootInput.addEventListener("change", () => {
      const url = withRoot(${JSON.stringify(graphUrl)});
      frame.src = url;
      openGraph.href = url;
      refreshStatus();
    });

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[ch]));
    }

    refreshStatus();
    window.parent?.postMessage?.({ source: "hana-plugin", type: "ready" }, "*");
  </script>
</body>
</html>`;
}

async function serveGraphFile(c, wikiRoot, filePath) {
  const token = c.req.query("token") || "";
  const wikiRootParam = c.req.query("wikiRoot") || wikiRoot;
  const suffix = `?${new URLSearchParams({ token, wikiRoot: wikiRootParam }).toString()}`;
  return serveWikiFile(c, wikiRoot, filePath, {
    assetBase: "/api/plugins/llm-wiki-viewer/graph-assets/",
    fileBase: "/api/plugins/llm-wiki-viewer/wiki-file/",
    suffix,
  });
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

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}
