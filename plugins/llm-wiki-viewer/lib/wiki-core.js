import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SCRIPT_TIMEOUT_MS = 60000;

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

export function expandHome(value) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  if (raw === "~") return getHome();
  if (raw.startsWith("~/")) return path.join(getHome(), raw.slice(2));
  return raw;
}

export async function getStatus(wikiRoot) {
  const root = expandHome(wikiRoot);
  const schema = path.join(root, ".wiki-schema.md");
  const wikiDir = path.join(root, "wiki");
  const graph = path.join(wikiDir, "knowledge-graph.html");
  const data = path.join(wikiDir, "graph-data.json");
  const index = path.join(root, "index.md");
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
    cacheExists: fs.existsSync(cache),
    graphDataExists: fs.existsSync(data),
    graphExists: fs.existsSync(graph),
    graphDataPath: data,
    graphPath: graph,
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
  return { ...result, wikiRoot: status.wikiRoot, skillRoot: status.skillRoot, status };
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
