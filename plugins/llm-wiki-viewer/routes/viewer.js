import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const HOME = process.env.HOME || process.env.USERPROFILE || "";
const SKILL_ROOT = process.env.LLM_WIKI_SKILL_ROOT
  || path.join(HOME, ".hanako", "skills", "obsidian-wiki-manager", "references", "llm-wiki");
const DEFAULT_VAULT_WIKI = process.env.LLM_WIKI_DEFAULT_ROOT
  || path.join(HOME, "Documents", "llm-wiki");

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

  app.get("/graph", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx);
    const graphPath = path.join(wikiRoot, "wiki", "knowledge-graph.html");
    return serveWikiFile(c, wikiRoot, graphPath);
  });

  app.get("/graph-assets/:file", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx);
    const file = c.req.param("file");
    const filePath = path.join(wikiRoot, "wiki", file);
    return serveWikiFile(c, wikiRoot, filePath);
  });

  app.get("/wiki-file/*", async (c) => {
    const wikiRoot = await resolveWikiRoot(c, ctx);
    const relativePath = decodeURIComponent(c.req.path.split("/wiki-file/")[1] || "");
    const filePath = path.join(wikiRoot, "wiki", relativePath);
    return serveWikiFile(c, wikiRoot, filePath);
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

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${hanaCss ? `<link rel="stylesheet" href="${escapeAttr(hanaCss)}">` : ""}
  <title>LLM Wiki 图谱</title>
  <style>
    :root { color-scheme: light; --bg:#f7f5ef; --panel:#fffdf8; --line:#ddd4c2; --text:#26221d; --muted:#6f665a; --accent:#8b2e24; }
    * { box-sizing: border-box; }
    html, body { margin:0; width:100%; height:100%; font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif; color:var(--text); background:var(--bg); }
    body { display:grid; grid-template-rows:auto 1fr; overflow:hidden; }
    header { display:flex; gap:10px; align-items:center; padding:10px 12px; border-bottom:1px solid var(--line); background:var(--panel); }
    input { flex:1; min-width:180px; height:34px; padding:0 10px; border:1px solid var(--line); border-radius:6px; background:white; color:var(--text); }
    button, a { min-height:34px; border:1px solid var(--line); border-radius:6px; background:white; color:var(--text); padding:0 10px; text-decoration:none; display:inline-flex; align-items:center; cursor:pointer; }
    button.primary { background:var(--accent); color:white; border-color:var(--accent); }
    .meta { font-size:12px; color:var(--muted); white-space:nowrap; }
    iframe { width:100%; height:100%; border:0; background:white; }
  </style>
</head>
<body data-hana-theme="${escapeAttr(theme)}">
  <header>
    <strong>LLM Wiki 图谱</strong>
    <input id="wikiRoot" value="${escapeAttr(wikiRoot)}" spellcheck="false">
    <button id="build" class="primary">生成/刷新</button>
    <a id="openGraph" href="${escapeAttr(graphUrl)}" target="_blank">单独打开</a>
    <span id="status" class="meta">检查中...</span>
  </header>
  <iframe id="graph" src="${escapeAttr(graphUrl)}"></iframe>
  <script>
    const statusEl = document.getElementById("status");
    const rootInput = document.getElementById("wikiRoot");
    const frame = document.getElementById("graph");
    const openGraph = document.getElementById("openGraph");
    function withRoot(url) {
      const u = new URL(url, location.origin);
      u.searchParams.set("wikiRoot", rootInput.value);
      return u.pathname + u.search;
    }
    async function refreshStatus() {
      const r = await fetch(withRoot(${JSON.stringify(statusUrl)}), { credentials: "include" });
      const data = await r.json();
      statusEl.textContent = data.graphExists ? "图谱已生成" : data.schemaExists ? "待生成图谱" : "不是 llm-wiki 根目录";
    }
    document.getElementById("build").addEventListener("click", async () => {
      statusEl.textContent = "生成中...";
      const r = await fetch(withRoot(${JSON.stringify(buildUrl)}), { method: "POST", credentials: "include" });
      const data = await r.json();
      statusEl.textContent = data.ok ? "生成完成" : "生成失败";
      if (!data.ok) console.error(data);
      const url = withRoot(${JSON.stringify(graphUrl)}) + "&_=" + Date.now();
      frame.src = url;
      openGraph.href = url;
    });
    rootInput.addEventListener("change", () => {
      const url = withRoot(${JSON.stringify(graphUrl)});
      frame.src = url;
      openGraph.href = url;
      refreshStatus();
    });
    refreshStatus();
    window.parent?.postMessage?.({ source: "hana-plugin", type: "ready" }, "*");
  </script>
</body>
</html>`;
}

async function resolveWikiRoot(c, ctx, body = {}) {
  const fromBody = typeof body.wikiRoot === "string" ? body.wikiRoot : "";
  const fromQuery = c.req.query("wikiRoot") || "";
  const fromConfig = await readConfig(ctx, "defaultWikiRoot", "");
  return expandHome(fromBody || fromQuery || fromConfig || DEFAULT_VAULT_WIKI);
}

async function buildGraph(wikiRoot) {
  const status = await getStatus(wikiRoot);
  if (!status.schemaExists || !status.wikiDirExists) {
    return { ok: false, error: "not_llm_wiki_root", wikiRoot, status };
  }
  const dataScript = path.join(SKILL_ROOT, "scripts", "build-graph-data.sh");
  const htmlScript = path.join(SKILL_ROOT, "scripts", "build-graph-html.sh");
  try {
    const data = await run("bash", [dataScript, wikiRoot], { timeout: 60000 });
    const html = await run("bash", [htmlScript, wikiRoot], { timeout: 60000 });
    return {
      ok: true,
      wikiRoot,
      graphPath: path.join(wikiRoot, "wiki", "knowledge-graph.html"),
      stdout: [data.stdout, html.stdout].filter(Boolean).join("\n"),
      stderr: [data.stderr, html.stderr].filter(Boolean).join("\n"),
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      wikiRoot,
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      code: error.code ?? null,
    };
  }
}

async function getStatus(wikiRoot) {
  const schema = path.join(wikiRoot, ".wiki-schema.md");
  const wikiDir = path.join(wikiRoot, "wiki");
  const graph = path.join(wikiDir, "knowledge-graph.html");
  const data = path.join(wikiDir, "graph-data.json");
  return {
    wikiRoot,
    skillRoot: SKILL_ROOT,
    schemaExists: fs.existsSync(schema),
    wikiDirExists: fs.existsSync(wikiDir),
    graphDataExists: fs.existsSync(data),
    graphExists: fs.existsSync(graph),
    graphPath: graph,
  };
}

async function serveWikiFile(c, wikiRoot, filePath) {
  const wikiDir = path.resolve(wikiRoot, "wiki");
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(wikiDir + path.sep)) return c.text("Forbidden", 403);
  try {
    let body = await fsp.readFile(resolved);
    if (resolved.endsWith("knowledge-graph.html")) {
      const base = `/api/plugins/llm-wiki-viewer/graph-assets/`;
      const fileBase = `/api/plugins/llm-wiki-viewer/wiki-file/`;
      const token = c.req.query("token") || "";
      const wikiRootParam = c.req.query("wikiRoot") || wikiRoot;
      const suffix = `?${new URLSearchParams({ token, wikiRoot: wikiRootParam }).toString()}`;
      body = Buffer.from(rewriteGraphSourcePaths(String(body), wikiRoot, wikiDir, fileBase, suffix)
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

function rewriteGraphSourcePaths(html, wikiRoot, wikiDir, fileBase, suffix) {
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

async function readJson(c) {
  try { return await c.req.json(); } catch { return {}; }
}

async function readConfig(ctx, key, fallback) {
  try {
    const value = await ctx.config?.get?.(key);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function expandHome(value) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  if (raw === "~") return HOME;
  if (raw.startsWith("~/")) return path.join(HOME, raw.slice(2));
  return raw;
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

function mimeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}
