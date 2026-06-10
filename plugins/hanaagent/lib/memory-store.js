import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const MAX_MEMORY_BYTES = 512 * 1024;

export function listLocalMemory(dataDir, filters = {}) {
  const dir = memoryDir(dataDir);
  ensureMemoryDir(dataDir);
  const query = clean(filters.query).toLowerCase();
  const entries = [];
  for (const file of safeReadDir(dir)) {
    if (!file.endsWith(".md")) continue;
    const fullPath = path.join(dir, file);
    const stat = safeStat(fullPath);
    if (!stat?.isFile() || stat.size > MAX_MEMORY_BYTES) continue;
    const content = fs.readFileSync(fullPath, "utf8");
    const entry = parseMemoryFile(file, content, stat);
    if (query && ![entry.title, entry.summary, entry.content].some((value) => String(value || "").toLowerCase().includes(query))) continue;
    entries.push(entry);
  }
  return {
    ok: true,
    entries: entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, clampInt(filters.limit, 1, 200, 80))
  };
}

export function readLocalMemory(dataDir, memoryId) {
  const id = safeMemoryId(memoryId);
  if (!id) return { ok: false, error: "memoryId_required", entry: null };
  const file = memoryFilePath(dataDir, id);
  if (!fs.existsSync(file)) return { ok: false, error: "memory_not_found", entry: null };
  const stat = safeStat(file);
  if (!stat?.isFile()) return { ok: false, error: "memory_not_found", entry: null };
  if (stat.size > MAX_MEMORY_BYTES) return { ok: false, error: "memory_too_large", entry: null };
  return { ok: true, entry: parseMemoryFile(`${id}.md`, fs.readFileSync(file, "utf8"), stat) };
}

export function writeLocalMemory(dataDir, input = {}) {
  const now = new Date().toISOString();
  const id = safeMemoryId(input.memoryId || input.id || input.title || randomUUID());
  if (!id) return { ok: false, error: "memoryId_required", entry: null };
  const title = clean(input.title) || titleFromId(id);
  const content = typeof input.content === "string" ? input.content : "";
  const summary = clean(input.summary) || firstLine(content).slice(0, 180);
  const body = [
    "---",
    `id: ${id}`,
    `title: ${title.replace(/\n/g, " ")}`,
    `summary: ${summary.replace(/\n/g, " ")}`,
    `updatedAt: ${now}`,
    "---",
    "",
    content
  ].join("\n");
  const size = Buffer.byteLength(body, "utf8");
  if (size > MAX_MEMORY_BYTES) return { ok: false, error: "memory_too_large", size, maxBytes: MAX_MEMORY_BYTES };
  ensureMemoryDir(dataDir);
  fs.writeFileSync(memoryFilePath(dataDir, id), body, "utf8");
  return readLocalMemory(dataDir, id);
}

export function deleteLocalMemory(dataDir, memoryId) {
  const id = safeMemoryId(memoryId);
  if (!id) return { ok: false, error: "memoryId_required" };
  const file = memoryFilePath(dataDir, id);
  if (!fs.existsSync(file)) return { ok: false, error: "memory_not_found" };
  fs.rmSync(file, { force: true });
  return { ok: true, deleted: id };
}

export function searchLocalMemory(dataDir, filters = {}) {
  const query = clean(filters.query);
  if (!query) return { ok: true, query, matches: [] };
  const entries = listLocalMemory(dataDir, { ...filters, limit: 200 }).entries;
  const needle = query.toLowerCase();
  const matches = [];
  for (const entry of entries) {
    const lines = String(entry.content || "").replace(/^\s*\n/, "").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(needle)) {
        matches.push({
          memoryId: entry.memoryId,
          title: entry.title,
          line: index + 1,
          text: line,
          source: entry.source
        });
      }
    });
  }
  return { ok: true, query, matches: matches.slice(0, clampInt(filters.limit, 1, 200, 80)) };
}

function parseMemoryFile(filename, content, stat) {
  const id = safeMemoryId(filename.replace(/\.md$/i, ""));
  const meta = parseFrontmatter(content);
  const body = meta.body;
  return {
    id,
    memoryId: id,
    title: clean(meta.attrs.title) || titleFromId(id),
    summary: clean(meta.attrs.summary) || firstLine(body).slice(0, 180),
    kind: "local-memory",
    source: "hanaagent:memory",
    path: `memory/${id}.md`,
    content: body,
    updatedAt: clean(meta.attrs.updatedAt) || stat.mtime.toISOString(),
    size: stat.size
  };
}

function parseFrontmatter(content) {
  if (!content.startsWith("---\n")) return { attrs: {}, body: content };
  const end = content.indexOf("\n---", 4);
  if (end === -1) return { attrs: {}, body: content };
  const raw = content.slice(4, end).trim();
  const attrs = {};
  for (const line of raw.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    attrs[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return { attrs, body: content.slice(end + 4).replace(/^\s*\n/, "") };
}

function ensureMemoryDir(dataDir) {
  fs.mkdirSync(memoryDir(dataDir), { recursive: true });
}

function memoryDir(dataDir) {
  return path.join(dataDir, "memory");
}

function memoryFilePath(dataDir, memoryId) {
  return path.join(memoryDir(dataDir), `${safeMemoryId(memoryId)}.md`);
}

function safeMemoryId(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/\.\.+/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function titleFromId(id) {
  return clean(id).replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()) || "Memory";
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/).find((line) => line.trim()) || "";
}

function safeReadDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
