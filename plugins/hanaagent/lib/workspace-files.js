import fs from "node:fs";
import path from "node:path";

const DEFAULT_IGNORES = new Set([".git", "node_modules", ".next", ".turbo", ".cache", "__pycache__", ".venv", "dist"]);
const TEXT_EXTENSIONS = new Set([
  ".c", ".cc", ".css", ".csv", ".env", ".go", ".h", ".html", ".java", ".js", ".json", ".jsx", ".md", ".mjs",
  ".py", ".rs", ".sh", ".sql", ".svelte", ".toml", ".ts", ".tsx", ".txt", ".xml", ".yaml", ".yml"
]);
const IMAGE_EXTENSIONS = new Set([".gif", ".jpeg", ".jpg", ".png", ".svg", ".webp"]);
const MAX_TEXT_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function listWorkspaceRoots(ctx) {
  const roots = configuredWorkspaceRoots(ctx);
  return {
    ok: true,
    roots: roots.map((root) => ({
      id: root.id,
      label: root.label,
      path: root.path,
      writable: root.writable
    }))
  };
}

export function listWorkspaceFiles(ctx, input = {}) {
  const resolved = resolveWorkspacePath(ctx, input);
  if (!resolved.ok) return resolved;
  const depth = clampInt(input.depth, 0, 5, 2);
  const maxEntries = clampInt(input.maxEntries, 20, 2000, 300);
  const entries = [];
  walkDirectory(resolved.path, {
    rootPath: resolved.root.path,
    depth,
    maxEntries,
    entries
  });
  return {
    ok: true,
    root: publicRoot(resolved.root),
    path: resolved.path,
    relativePath: relativePath(resolved.root.path, resolved.path),
    entries,
    truncated: entries.length >= maxEntries
  };
}

export function readWorkspaceFile(ctx, input = {}) {
  const resolved = resolveWorkspacePath(ctx, input);
  if (!resolved.ok) return resolved;
  const stat = safeStat(resolved.path);
  if (!stat) return { ok: false, error: "file_not_found" };
  if (!stat.isFile()) return { ok: false, error: "not_a_file" };
  const ext = path.extname(resolved.path).toLowerCase();
  const kind = fileKind(resolved.path);
  const maxBytes = kind === "image" ? MAX_IMAGE_BYTES : MAX_TEXT_BYTES;
  if (stat.size > maxBytes) return { ok: false, error: "file_too_large", size: stat.size, maxBytes };
  if (kind === "image") {
    const content = fs.readFileSync(resolved.path).toString("base64");
    return {
      ok: true,
      root: publicRoot(resolved.root),
      path: resolved.path,
      relativePath: relativePath(resolved.root.path, resolved.path),
      kind,
      mime: mimeForExtension(ext),
      encoding: "base64",
      content,
      size: stat.size,
      writable: resolved.root.writable
    };
  }
  if (kind !== "text") return { ok: false, error: "unsupported_file_type", extension: ext };
  const content = fs.readFileSync(resolved.path, "utf8");
  return {
    ok: true,
    root: publicRoot(resolved.root),
    path: resolved.path,
    relativePath: relativePath(resolved.root.path, resolved.path),
    kind,
    mime: "text/plain; charset=utf-8",
    encoding: "utf8",
    content,
    size: Buffer.byteLength(content, "utf8"),
    writable: resolved.root.writable
  };
}

export function writeWorkspaceFile(ctx, input = {}) {
  const resolved = resolveWorkspacePath(ctx, input);
  if (!resolved.ok) return resolved;
  if (!resolved.root.writable) return { ok: false, error: "root_readonly" };
  const content = typeof input.content === "string" ? input.content : "";
  const size = Buffer.byteLength(content, "utf8");
  if (size > MAX_TEXT_BYTES) return { ok: false, error: "content_too_large", size, maxBytes: MAX_TEXT_BYTES };
  const ext = path.extname(resolved.path).toLowerCase();
  if (fileKind(resolved.path) !== "text") return { ok: false, error: "unsupported_file_type", extension: ext };
  const parent = resolveExistingParent(resolved.path);
  if (!parent || !isInside(parent, resolved.root.realPath)) return { ok: false, error: "path_not_allowed" };
  if (fs.existsSync(resolved.path)) {
    const stat = fs.lstatSync(resolved.path);
    if (stat.isSymbolicLink() || !stat.isFile()) return { ok: false, error: "not_a_regular_file" };
  }
  fs.mkdirSync(path.dirname(resolved.path), { recursive: true });
  fs.writeFileSync(resolved.path, content, "utf8");
  return readWorkspaceFile(ctx, input);
}

export function uploadWorkspaceFile(ctx, input = {}) {
  const resolved = resolveWorkspacePath(ctx, input);
  if (!resolved.ok) return resolved;
  if (!resolved.root.writable) return { ok: false, error: "root_readonly" };
  const kind = fileKind(resolved.path);
  if (kind !== "text" && kind !== "image") return { ok: false, error: "unsupported_file_type", extension: path.extname(resolved.path).toLowerCase() };
  const parent = resolveExistingParent(resolved.path);
  if (!parent || !isInside(parent, resolved.root.realPath)) return { ok: false, error: "path_not_allowed" };
  if (fs.existsSync(resolved.path)) {
    const stat = fs.lstatSync(resolved.path);
    if (stat.isSymbolicLink() || !stat.isFile()) return { ok: false, error: "not_a_regular_file" };
    if (input.overwrite === false) return { ok: false, error: "path_exists" };
  }

  let bytes;
  const encoding = clean(input.encoding || input.contentEncoding);
  if (encoding === "base64") {
    const content = typeof input.content === "string" ? input.content : "";
    bytes = Buffer.from(content, "base64");
    if (content && bytes.length === 0) return { ok: false, error: "invalid_base64" };
  } else if (typeof input.content === "string") {
    bytes = Buffer.from(input.content, "utf8");
  } else {
    return { ok: false, error: "content_required" };
  }

  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, error: "content_too_large", size: bytes.length, maxBytes: MAX_UPLOAD_BYTES };
  if (kind === "text" && bytes.length > MAX_TEXT_BYTES) return { ok: false, error: "content_too_large", size: bytes.length, maxBytes: MAX_TEXT_BYTES };
  if (kind === "image" && bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: "content_too_large", size: bytes.length, maxBytes: MAX_IMAGE_BYTES };

  fs.mkdirSync(path.dirname(resolved.path), { recursive: true });
  fs.writeFileSync(resolved.path, bytes);
  const file = readWorkspaceFile(ctx, input);
  return {
    ...file,
    uploaded: true,
    upload: {
      filename: clean(input.filename || path.basename(resolved.path)),
      encoding: encoding === "base64" ? "base64" : "utf8",
      bytes: bytes.length
    }
  };
}

export function diffWorkspaceFile(ctx, input = {}) {
  const current = readWorkspaceFile(ctx, input);
  if (!current.ok) return current;
  if (current.kind !== "text") return { ok: false, error: "unsupported_file_type" };
  const nextContent = typeof input.content === "string" ? input.content : "";
  const before = current.content || "";
  const after = nextContent;
  const diff = buildUnifiedDiff(before, after, {
    from: `a/${current.relativePath || input.path || "file"}`,
    to: `b/${current.relativePath || input.path || "file"}`
  });
  return {
    ok: true,
    root: current.root,
    path: current.path,
    relativePath: current.relativePath,
    kind: "text-diff",
    changed: before !== after,
    stats: countDiffStats(diff),
    diff
  };
}

export function createWorkspaceDirectory(ctx, input = {}) {
  const resolved = resolveWorkspacePath(ctx, input);
  if (!resolved.ok) return resolved;
  if (!resolved.root.writable) return { ok: false, error: "root_readonly" };
  if (fs.existsSync(resolved.path)) return { ok: false, error: "path_exists" };
  const parent = resolveExistingParent(resolved.path);
  if (!parent || !isInside(parent, resolved.root.realPath)) return { ok: false, error: "path_not_allowed" };
  fs.mkdirSync(resolved.path, { recursive: true });
  return {
    ok: true,
    action: "mkdir",
    root: publicRoot(resolved.root),
    path: resolved.path,
    relativePath: relativePath(resolved.root.path, resolved.path)
  };
}

export function renameWorkspacePath(ctx, input = {}) {
  const from = resolveWorkspacePath(ctx, {
    rootId: input.rootId,
    path: input.path || input.from || input.fromPath
  });
  if (!from.ok) return from;
  if (!from.root.writable) return { ok: false, error: "root_readonly" };
  const fromStat = safeLstat(from.path);
  if (!fromStat) return { ok: false, error: "file_not_found" };
  if (fromStat.isSymbolicLink()) return { ok: false, error: "symlink_not_allowed" };
  if (path.resolve(from.path) === from.root.realPath) return { ok: false, error: "cannot_rename_root" };
  const to = resolveWorkspacePath(ctx, {
    rootId: from.root.id,
    path: input.to || input.toPath || input.newPath || input.name
  });
  if (!to.ok) return to;
  if (!isInside(to.path, from.root.realPath)) return { ok: false, error: "path_not_allowed" };
  if (fs.existsSync(to.path)) return { ok: false, error: "path_exists" };
  const parent = resolveExistingParent(to.path);
  if (!parent || !isInside(parent, from.root.realPath)) return { ok: false, error: "path_not_allowed" };
  fs.renameSync(from.path, to.path);
  return {
    ok: true,
    action: "rename",
    root: publicRoot(from.root),
    from: relativePath(from.root.path, from.path),
    to: relativePath(from.root.path, to.path),
    path: to.path,
    relativePath: relativePath(from.root.path, to.path)
  };
}

export function deleteWorkspacePath(ctx, input = {}) {
  const resolved = resolveWorkspacePath(ctx, input);
  if (!resolved.ok) return resolved;
  if (!resolved.root.writable) return { ok: false, error: "root_readonly" };
  const stat = safeLstat(resolved.path);
  if (!stat) return { ok: false, error: "file_not_found" };
  if (stat.isSymbolicLink()) return { ok: false, error: "symlink_not_allowed" };
  if (path.resolve(resolved.path) === resolved.root.realPath) return { ok: false, error: "cannot_delete_root" };
  if (stat.isDirectory()) fs.rmSync(resolved.path, { recursive: true, force: true });
  else if (stat.isFile()) fs.rmSync(resolved.path, { force: true });
  else return { ok: false, error: "not_a_regular_path" };
  return {
    ok: true,
    action: "delete",
    root: publicRoot(resolved.root),
    deleted: relativePath(resolved.root.path, resolved.path)
  };
}

export function resolveWorkspacePath(ctx, input = {}) {
  const roots = configuredWorkspaceRoots(ctx);
  const rootId = clean(input.rootId) || roots[0]?.id || "";
  const root = roots.find((item) => item.id === rootId || item.path === rootId);
  if (!root) return { ok: false, error: "workspace_root_not_found" };
  const requestPath = clean(input.path || input.relativePath || ".");
  const candidate = path.resolve(root.path, requestPath);
  if (!isInside(candidate, root.realPath)) return { ok: false, error: "path_not_allowed" };
  if (fs.existsSync(candidate)) {
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink()) return { ok: false, error: "symlink_not_allowed" };
    const real = fs.realpathSync(candidate);
    if (!isInside(real, root.realPath)) return { ok: false, error: "path_not_allowed" };
    return { ok: true, root, path: real };
  }
  const parent = resolveExistingParent(candidate);
  if (!parent || !isInside(parent, root.realPath)) return { ok: false, error: "path_not_allowed" };
  return { ok: true, root, path: candidate };
}

function configuredWorkspaceRoots(ctx) {
  const config = safeConfig(ctx);
  const roots = [];
  const rawRoots = Array.isArray(config.workspaceRoots) ? config.workspaceRoots : [];
  for (const item of rawRoots) {
    const value = typeof item === "string" ? { path: item } : item && typeof item === "object" ? item : null;
    if (!value) continue;
    const resolved = normalizeRoot(value.path, {
      id: clean(value.id),
      label: clean(value.label),
      writable: value.writable !== false
    });
    if (resolved) roots.push(resolved);
  }
  const dataRoot = normalizeRoot(ctx?.dataDir, {
    id: "plugin-data",
    label: "Plugin Data",
    writable: true
  });
  if (dataRoot) roots.push(dataRoot);
  return dedupeRoots(roots);
}

function normalizeRoot(rootPath, input = {}) {
  const raw = clean(rootPath);
  if (!raw) return null;
  try {
    fs.mkdirSync(raw, { recursive: true });
    const realPath = fs.realpathSync(raw);
    return {
      id: input.id || rootId(realPath),
      label: input.label || path.basename(realPath) || realPath,
      path: realPath,
      realPath,
      writable: input.writable !== false
    };
  } catch {
    return null;
  }
}

function dedupeRoots(roots) {
  const seen = new Set();
  const next = [];
  for (const root of roots) {
    if (seen.has(root.realPath)) continue;
    seen.add(root.realPath);
    next.push(root);
  }
  return next;
}

function walkDirectory(dirPath, input) {
  if (input.entries.length >= input.maxEntries) return;
  let children = [];
  try {
    children = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  children.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  for (const child of children) {
    if (input.entries.length >= input.maxEntries) return;
    if (DEFAULT_IGNORES.has(child.name)) continue;
    const childPath = path.join(dirPath, child.name);
    let stat = null;
    try {
      stat = fs.lstatSync(childPath);
      if (stat.isSymbolicLink()) continue;
    } catch {
      continue;
    }
    const entry = {
      name: child.name,
      path: childPath,
      relativePath: relativePath(input.rootPath, childPath),
      type: child.isDirectory() ? "directory" : "file",
      kind: child.isDirectory() ? "directory" : fileKind(childPath),
      size: stat.size,
      updatedAt: stat.mtime.toISOString()
    };
    input.entries.push(entry);
    if (child.isDirectory() && input.depth > 0) {
      walkDirectory(childPath, {
        ...input,
        depth: input.depth - 1
      });
    }
  }
}

function resolveExistingParent(candidate) {
  let current = path.dirname(candidate);
  while (current && current !== path.dirname(current)) {
    if (fs.existsSync(current)) {
      try {
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink() || !stat.isDirectory()) return null;
        return fs.realpathSync(current);
      } catch {
        return null;
      }
    }
    current = path.dirname(current);
  }
  return null;
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function safeLstat(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch {
    return null;
  }
}

function fileKind(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (TEXT_EXTENSIONS.has(ext) || !ext) return "text";
  return "binary";
}

function mimeForExtension(ext) {
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  return "application/octet-stream";
}

function publicRoot(root) {
  return {
    id: root.id,
    label: root.label,
    path: root.path,
    writable: root.writable
  };
}

function relativePath(rootPath, filePath) {
  const rel = path.relative(rootPath, filePath);
  return rel || ".";
}

function isInside(candidate, root) {
  const next = path.resolve(candidate);
  const base = path.resolve(root);
  return next === base || next.startsWith(base + path.sep);
}

function rootId(rootPath) {
  return rootPath.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(-48) || "workspace";
}

function safeConfig(ctx) {
  try {
    return typeof ctx?.config?.getAll === "function" ? ctx.config.getAll() || {} : {};
  } catch {
    return {};
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

function buildUnifiedDiff(before, after, input = {}) {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const operations = diffLineOperations(beforeLines, afterLines);
  if (operations.every((op) => op.type === "context")) {
    return [
      `--- ${input.from || "a/file"}`,
      `+++ ${input.to || "b/file"}`,
      "@@ no changes @@"
    ].join("\n");
  }
  return [
    `--- ${input.from || "a/file"}`,
    `+++ ${input.to || "b/file"}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...operations.map((op) => `${opPrefix(op.type)}${op.line}`)
  ].join("\n");
}

function splitLines(value) {
  const text = String(value || "");
  if (!text) return [];
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function diffLineOperations(beforeLines, afterLines) {
  const rows = beforeLines.length + 1;
  const cols = afterLines.length + 1;
  const table = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = beforeLines.length - 1; i >= 0; i -= 1) {
    for (let j = afterLines.length - 1; j >= 0; j -= 1) {
      table[i][j] = beforeLines[i] === afterLines[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < beforeLines.length && j < afterLines.length) {
    if (beforeLines[i] === afterLines[j]) {
      ops.push({ type: "context", line: beforeLines[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ type: "remove", line: beforeLines[i] });
      i += 1;
    } else {
      ops.push({ type: "add", line: afterLines[j] });
      j += 1;
    }
  }
  while (i < beforeLines.length) {
    ops.push({ type: "remove", line: beforeLines[i] });
    i += 1;
  }
  while (j < afterLines.length) {
    ops.push({ type: "add", line: afterLines[j] });
    j += 1;
  }
  return ops;
}

function opPrefix(type) {
  if (type === "add") return "+";
  if (type === "remove") return "-";
  return " ";
}

function countDiffStats(diff) {
  const lines = String(diff || "").split(/\r?\n/).slice(3);
  return {
    additions: lines.filter((line) => line.startsWith("+")).length,
    deletions: lines.filter((line) => line.startsWith("-")).length,
    lines: lines.length
  };
}
