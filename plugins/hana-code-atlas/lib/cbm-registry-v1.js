/**
 * cbm registry discovery isolated behind a versioned module path.
 *
 * Hana hot-reloads plugin entry modules with a cache-busting query, while
 * transitive ESM imports can remain cached. Keep this module's public contract
 * stable; use a new versioned path if that contract must change later.
 */

import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MCP_CONFIG_MAX_BYTES = 2 * 1024 * 1024;

function asTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

async function readPluginConfig(ctx, key) {
  try {
    return asTrimmedString(await ctx?.config?.get?.(key));
  } catch {
    return "";
  }
}

function findCbmConnector(config) {
  const connectors = config?.global?.mcp?.connectors;
  if (!Array.isArray(connectors)) return null;
  const matches = connectors.filter((connector) => {
    const id = asTrimmedString(connector?.id).toLowerCase();
    const name = asTrimmedString(connector?.name).toLowerCase();
    const command = asTrimmedString(connector?.command).toLowerCase();
    const commandName = path.basename(command).replace(/\.exe$/, "");
    return id === "codebase-memory-mcp"
      || name === "codebase-memory-mcp"
      || commandName === "codebase-memory-mcp";
  });
  return matches.find((connector) => asTrimmedString(connector?.id).toLowerCase() === "codebase-memory-mcp")
    || matches[0]
    || null;
}

async function readMcpConnector(ctx) {
  const dataDir = asTrimmedString(ctx?.dataDir);
  if (!dataDir || !path.isAbsolute(dataDir)) return null;
  const configPath = path.join(path.dirname(dataDir), "mcp", "config.json");
  try {
    const stat = await fsp.stat(configPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MCP_CONFIG_MAX_BYTES) return null;
    const config = JSON.parse(await fsp.readFile(configPath, "utf-8"));
    return findCbmConnector(config);
  } catch {
    return null;
  }
}

/**
 * Resolve the cbm command and registry with explicit, observable precedence:
 * plugin config -> process environment -> Hana MCP connector -> cbm defaults.
 */
export async function resolveCbmRuntime(ctx, env = process.env) {
  const configuredBinary = await readPluginConfig(ctx, "cbmBinary");
  const configuredCacheDir = await readPluginConfig(ctx, "cbmCacheDir");

  if (configuredCacheDir && !path.isAbsolute(configuredCacheDir)) {
    return {
      ok: false,
      error: "cbmCacheDir_must_be_absolute",
      binary: configuredBinary || "codebase-memory-mcp",
      cacheDir: null,
      source: "plugin-config",
      binarySource: configuredBinary ? "plugin-config" : "cbm-default",
    };
  }

  const envCacheDir = asTrimmedString(env?.CBM_CACHE_DIR);
  if (!configuredCacheDir && envCacheDir && !path.isAbsolute(envCacheDir)) {
    return {
      ok: false,
      error: "CBM_CACHE_DIR_must_be_absolute",
      binary: configuredBinary || "codebase-memory-mcp",
      cacheDir: null,
      source: "process-env",
      binarySource: configuredBinary ? "plugin-config" : "cbm-default",
    };
  }

  let connector = null;
  if (!configuredBinary || (!configuredCacheDir && !envCacheDir)) {
    connector = await readMcpConnector(ctx);
  }

  const connectorBinary = asTrimmedString(connector?.command);
  const connectorCacheDir = asTrimmedString(connector?.env?.CBM_CACHE_DIR);
  const usableConnectorCache = path.isAbsolute(connectorCacheDir) ? connectorCacheDir : "";

  let cacheDir = null;
  let source = "cbm-default";
  if (configuredCacheDir) {
    cacheDir = configuredCacheDir;
    source = "plugin-config";
  } else if (envCacheDir) {
    cacheDir = envCacheDir;
    source = "process-env";
  } else if (usableConnectorCache) {
    cacheDir = usableConnectorCache;
    source = "mcp-connector";
  }

  const binary = configuredBinary || connectorBinary || "codebase-memory-mcp";
  const binarySource = configuredBinary
    ? "plugin-config"
    : connectorBinary
      ? "mcp-connector"
      : "cbm-default";

  return {
    ok: true,
    binary,
    cacheDir,
    source,
    binarySource,
  };
}

export function parseCbmProjectsOutput(stdout) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("level="));
  if (lines.length === 0) return [];

  try {
    const value = JSON.parse(lines.join("\n"));
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.projects)) return value.projects;
  } catch { /* try line-delimited output below */ }

  const projects = [];
  for (const line of lines) {
    try {
      const value = JSON.parse(line);
      if (Array.isArray(value)) return value;
      if (Array.isArray(value?.projects)) return value.projects;
      if (value?.root_path || value?.root || value?.path) projects.push(value);
    } catch { /* skip non-JSON status lines */ }
  }
  return projects;
}

/**
 * List usable cbm projects from a registry. Stale and inaccessible roots are
 * omitted so every returned candidate can be registered immediately.
 */
export async function listCbmProjects(cbmBinary, timeoutMs = 15000, cacheDir) {
  const startedAt = Date.now();
  try {
    const env = { ...process.env };
    if (cacheDir) env.CBM_CACHE_DIR = cacheDir;
    const { stdout } = await execFileAsync(
      cbmBinary || "codebase-memory-mcp",
      ["cli", "list_projects", "{}"],
      { timeout: timeoutMs, shell: false, maxBuffer: 2 * 1024 * 1024, env }
    );
    const candidates = [];
    const seenRoots = new Set();
    for (const item of parseCbmProjectsOutput(stdout)) {
      const rootPath = asTrimmedString(item?.root_path || item?.root || item?.path);
      const cbmProjectName = asTrimmedString(item?.project || item?.name || item?.project_name);
      if (!rootPath || !cbmProjectName) continue;
      try {
        const root = await fsp.realpath(rootPath);
        const stat = await fsp.stat(root);
        if (!stat.isDirectory() || seenRoots.has(root)) continue;
        seenRoots.add(root);
        candidates.push({
          cbmProjectName,
          root,
          name: path.basename(root),
          nodes: Number.isFinite(Number(item.nodes)) ? Number(item.nodes) : null,
          edges: Number.isFinite(Number(item.edges)) ? Number(item.edges) : null,
          sizeBytes: Number.isFinite(Number(item.size_bytes)) ? Number(item.size_bytes) : null,
        });
      } catch { /* omit stale or inaccessible registry entries */ }
    }
    candidates.sort((a, b) => a.name.localeCompare(b.name) || a.root.localeCompare(b.root));
    return { ok: true, projects: candidates, durationMs: Date.now() - startedAt };
  } catch (err) {
    return {
      ok: false,
      error: "cbm_list_projects_failed: " + err.message,
      projects: [],
      durationMs: Date.now() - startedAt,
    };
  }
}

export async function discoverCbmProject(cbmBinary, projectRealpath, timeoutMs = 15000, cacheDir) {
  const result = await listCbmProjects(cbmBinary, timeoutMs, cacheDir);
  if (!result.ok) return { ok: false, error: result.error };
  const match = result.projects.find((project) => project.root === projectRealpath);
  return { ok: true, cbmProjectName: match?.cbmProjectName || null };
}
