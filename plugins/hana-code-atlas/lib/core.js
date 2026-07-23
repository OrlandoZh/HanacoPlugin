/**
 * lib/core.js — Path safety, dependency detection, bundle validation, tool helpers
 */

import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ─── Path safety ──────────────────────────────────────────

export async function ensureInsideDir(target, baseDir) {
  let realTarget;
  try { realTarget = await fsp.realpath(target); } catch {
    return { ok: false, error: "target_not_found" };
  }
  let realBase;
  try { realBase = await fsp.realpath(baseDir); } catch {
    return { ok: false, error: "baseDir_not_found" };
  }
  if (!realTarget.startsWith(realBase + path.sep) && realTarget !== realBase) {
    return { ok: false, error: "path_escape", target: realTarget, base: realBase };
  }
  return { ok: true, realTarget, realBase };
}

export function isPathInside(relativePath, _baseDir) {
  if (!relativePath || relativePath.includes("\0")) return false;
  const normalized = path.normalize(relativePath);
  const sep = path.sep;
  return normalized !== ".." && !normalized.startsWith(".." + sep) && !path.isAbsolute(normalized);
}

// ─── Bundle validation ────────────────────────────────────

export async function validateBundle(bundleDir) {
  const kgPath = path.join(bundleDir, ".ua", "knowledge-graph.json");
  const configPath = path.join(bundleDir, ".ua", "config.json");
  const errors = [];
  let graph = null;
  for (const [label, filePath] of [["knowledge-graph", kgPath], ["config", configPath]]) {
    try {
      const stat = await fsp.stat(filePath);
      if (stat.size === 0) {
        errors.push(label + ": empty");
        continue;
      }
      const parsed = JSON.parse(await fsp.readFile(filePath, "utf-8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) errors.push(label + ": expected object");
      if (label === "knowledge-graph") graph = parsed;
    } catch (err) {
      errors.push(label + ": " + (err.code === "ENOENT" ? "missing" : err.message));
    }
  }
  if (graph) {
    if (!Array.isArray(graph.nodes)) errors.push("knowledge-graph: missing nodes array");
    if (!Array.isArray(graph.edges)) errors.push("knowledge-graph: missing edges array");
    if (!Array.isArray(graph.layers)) errors.push("knowledge-graph: missing layers array");
    if (Array.isArray(graph.nodes) && Array.isArray(graph.edges)) {
      const nodeIds = new Set(graph.nodes.map((node) => String(node?.id || "")).filter(Boolean));
      const duplicateCount = graph.nodes.length - nodeIds.size;
      if (duplicateCount > 0) errors.push(`knowledge-graph: ${duplicateCount} duplicate node ids`);
      const danglingEdges = graph.edges.filter((edge) => !nodeIds.has(String(edge?.source || "")) || !nodeIds.has(String(edge?.target || "")));
      if (danglingEdges.length > 0) errors.push(`knowledge-graph: ${danglingEdges.length} dangling edges`);
      if (Array.isArray(graph.layers)) {
        const danglingLayerRefs = graph.layers.flatMap((layer) => layer?.nodeIds || []).filter((nodeId) => !nodeIds.has(String(nodeId)));
        if (danglingLayerRefs.length > 0) errors.push(`knowledge-graph: ${danglingLayerRefs.length} dangling layer node refs`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// ─── Dependency detection ─────────────────────────────────

export async function detectCbmBinary(configuredPath) {
  const candidate = configuredPath || "codebase-memory-mcp";
  try {
    const { stdout } = await execFileAsync(candidate, ["--version"], { timeout: 10000, shell: false });
    return { ok: true, path: candidate, version: (stdout || "").trim() };
  } catch (err) {
    return { ok: false, error: "cbm_not_found: " + err.message };
  }
}

export async function detectPythonBinary(configuredPath) {
  const candidate = configuredPath || "python3";
  try {
    const { stdout } = await execFileAsync(candidate, ["--version"], { timeout: 10000, shell: false });
    const match = (stdout || "").match(/Python (\d+)\.(\d+)/);
    if (!match) return { ok: false, error: "python_version_unparseable" };
    const major = Number(match[1]), minor = Number(match[2]);
    if (major < 3 || (major === 3 && minor < 10)) return { ok: false, error: "python_too_old: " + major + "." + minor };
    return { ok: true, path: candidate, version: major + "." + minor };
  } catch (err) {
    return { ok: false, error: "python_not_found: " + err.message };
  }
}

// ─── Config helpers ───────────────────────────────────────

export async function readConfig(ctx, key, fallback) {
  try { return (await ctx?.config?.get?.(key)) ?? fallback; } catch { return fallback; }
}

// ─── Agent tool result ────────────────────────────────────

export function toToolResult(label, data) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text: "[code-atlas:" + label + "]\n" + text }] };
}
