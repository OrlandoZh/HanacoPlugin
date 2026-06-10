import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const VALID_RECORD_TYPES = new Set(["artifact", "approval", "learning"]);
const VALID_APPROVAL_STATES = new Set(["pending", "approved", "denied"]);

export function listRunRecords(dataDir, filters = {}) {
  let records = readRunFile(dataDir).records.map(normalizeRecord).filter(Boolean);
  if (filters.type) records = records.filter((record) => record.type === clean(filters.type));
  if (filters.missionId) records = records.filter((record) => record.missionId === clean(filters.missionId));
  if (filters.assignmentId) records = records.filter((record) => record.assignmentId === clean(filters.assignmentId));
  if (filters.sessionPath) records = records.filter((record) => record.sessionPath === clean(filters.sessionPath));
  if (filters.state) records = records.filter((record) => record.state === clean(filters.state));
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function createRunRecord(dataDir, input = {}) {
  const type = normalizeType(input.type);
  const title = clean(input.title || input.name || input.label);
  if (!title) return { ok: false, error: "title_required" };
  const now = new Date().toISOString();
  const record = normalizeRecord({
    id: clean(input.id) || randomUUID(),
    type,
    title,
    summary: clean(input.summary || input.description),
    content: typeof input.content === "string" ? input.content : "",
    language: clean(input.language),
    path: clean(input.path || input.filePath),
    missionId: clean(input.missionId),
    assignmentId: clean(input.assignmentId),
    taskId: clean(input.taskId),
    sessionPath: clean(input.sessionPath),
    agentId: clean(input.agentId),
    state: normalizeState(type, input.state || input.status),
    risk: clean(input.risk),
    tool: clean(input.tool || input.toolName),
    requester: clean(input.requester || input.agentName),
    createdAt: now,
    updatedAt: now,
    resolvedAt: null,
    meta: input.meta && typeof input.meta === "object" ? input.meta : {}
  });

  const file = readRunFile(dataDir);
  file.records.push(record);
  writeRunFile(dataDir, { records: file.records.map(normalizeRecord).filter(Boolean) });
  return { ok: true, record };
}

export function updateRunRecord(dataDir, recordId, updates = {}) {
  const file = readRunFile(dataDir);
  const records = file.records.map(normalizeRecord).filter(Boolean);
  const index = records.findIndex((record) => record.id === recordId);
  if (index === -1) return { ok: false, error: "record_not_found" };
  const current = records[index];
  const next = normalizeRecord({
    ...current,
    ...(typeof updates.title === "string" ? { title: updates.title } : {}),
    ...(typeof updates.summary === "string" || typeof updates.description === "string" ? { summary: updates.summary || updates.description } : {}),
    ...(typeof updates.content === "string" ? { content: updates.content } : {}),
    ...(typeof updates.language === "string" ? { language: updates.language } : {}),
    ...(typeof updates.path === "string" || typeof updates.filePath === "string" ? { path: updates.path || updates.filePath } : {}),
    ...(typeof updates.state === "string" || typeof updates.status === "string" ? { state: normalizeState(current.type, updates.state || updates.status) } : {}),
    ...(typeof updates.risk === "string" ? { risk: updates.risk } : {}),
    ...(updates.meta && typeof updates.meta === "object" ? { meta: updates.meta } : {}),
    updatedAt: new Date().toISOString()
  });
  if (current.type === "approval" && current.state !== next.state && ["approved", "denied"].includes(next.state)) {
    next.resolvedAt = next.resolvedAt || next.updatedAt;
  }
  records[index] = next;
  writeRunFile(dataDir, { records });
  return { ok: true, record: next };
}

export function deleteRunRecord(dataDir, recordId) {
  const file = readRunFile(dataDir);
  const records = file.records.map(normalizeRecord).filter(Boolean);
  const next = records.filter((record) => record.id !== recordId);
  if (next.length === records.length) return { ok: false, error: "record_not_found" };
  writeRunFile(dataDir, { records: next });
  return { ok: true, deleted: recordId };
}

export function summarizeRunRecords(records = []) {
  const summary = {
    artifacts: 0,
    approvals: 0,
    pendingApprovals: 0,
    learnings: 0
  };
  for (const record of Array.isArray(records) ? records : []) {
    if (record.type === "artifact") summary.artifacts += 1;
    if (record.type === "approval") {
      summary.approvals += 1;
      if (record.state === "pending") summary.pendingApprovals += 1;
    }
    if (record.type === "learning") summary.learnings += 1;
  }
  return summary;
}

export function materializeRunRecordFile(dataDir, recordId, input = {}) {
  const record = listRunRecords(dataDir, { includeAll: true }).find((item) => item.id === recordId);
  if (!record) return { ok: false, error: "record_not_found" };
  if (record.type !== "artifact") return { ok: false, error: "artifact_record_required" };
  const content = typeof input.content === "string" ? input.content : record.content;
  if (!content && !record.summary) return { ok: false, error: "artifact_content_required" };

  const ext = extensionForLanguage(input.language || record.language || "markdown");
  const filename = `${safeFilename(record.title || "artifact")}-${record.id.slice(0, 8)}${ext}`;
  const dir = artifactDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content || record.summary || "", "utf8");

  const updated = updateRunRecord(dataDir, record.id, {
    path: filePath,
    language: input.language || record.language || languageForExtension(ext),
    meta: {
      ...record.meta,
      materializedAt: new Date().toISOString(),
      filename,
      size: Buffer.byteLength(content || record.summary || "", "utf8")
    }
  });
  return {
    ok: true,
    record: updated.ok ? updated.record : record,
    file: {
      filePath,
      filename,
      size: Buffer.byteLength(content || record.summary || "", "utf8"),
      mime: mimeForExtension(ext)
    }
  };
}

export function readRunRecordArtifactFile(dataDir, recordId) {
  const record = listRunRecords(dataDir, { includeAll: true }).find((item) => item.id === recordId);
  if (!record) return { ok: false, error: "record_not_found" };
  const filePath = clean(record.path);
  if (!filePath) return { ok: false, error: "artifact_file_missing" };
  const root = artifactDir(dataDir);
  const resolved = path.resolve(filePath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return { ok: false, error: "artifact_file_outside_data_dir" };
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return { ok: false, error: "artifact_file_not_found" };
  const content = fs.readFileSync(resolved, "utf8");
  return {
    ok: true,
    record,
    file: {
      filePath: resolved,
      filename: path.basename(resolved),
      size: Buffer.byteLength(content, "utf8"),
      mime: mimeForExtension(path.extname(resolved))
    },
    content
  };
}

function readRunFile(dataDir) {
  ensureRunFile(dataDir);
  try {
    const raw = fs.readFileSync(runFilePath(dataDir), "utf8").trim();
    if (!raw) return { records: [] };
    const parsed = JSON.parse(raw);
    return { records: Array.isArray(parsed?.records) ? parsed.records : [] };
  } catch {
    return { records: [] };
  }
}

function writeRunFile(dataDir, data) {
  ensureRunFile(dataDir);
  const file = runFilePath(dataDir);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ records: data.records || [] }, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function ensureRunFile(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = runFilePath(dataDir);
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ records: [] }, null, 2) + "\n", "utf8");
}

function runFilePath(dataDir) {
  return path.join(dataDir, "run-records.json");
}

function artifactDir(dataDir) {
  return path.join(dataDir, "artifacts");
}

function normalizeRecord(value) {
  if (!value || typeof value !== "object") return null;
  const id = clean(value.id);
  const type = normalizeType(value.type);
  const title = clean(value.title || value.name || value.label);
  if (!id || !title) return null;
  const createdAt = clean(value.createdAt || value.created_at) || new Date().toISOString();
  const updatedAt = clean(value.updatedAt || value.updated_at) || createdAt;
  return {
    id,
    type,
    title,
    summary: clean(value.summary || value.description),
    content: typeof value.content === "string" ? value.content : "",
    language: clean(value.language),
    path: clean(value.path || value.filePath),
    missionId: clean(value.missionId || value.mission_id),
    assignmentId: clean(value.assignmentId || value.assignment_id),
    taskId: clean(value.taskId || value.task_id),
    sessionPath: clean(value.sessionPath || value.session_path),
    agentId: clean(value.agentId || value.agent_id),
    state: normalizeState(type, value.state || value.status),
    risk: clean(value.risk),
    tool: clean(value.tool || value.toolName),
    requester: clean(value.requester || value.agentName),
    createdAt,
    updatedAt,
    resolvedAt: clean(value.resolvedAt || value.resolved_at) || null,
    meta: value.meta && typeof value.meta === "object" ? value.meta : {}
  };
}

function normalizeType(value) {
  const type = clean(value).toLowerCase();
  return VALID_RECORD_TYPES.has(type) ? type : "artifact";
}

function normalizeState(type, value) {
  const state = clean(value).toLowerCase();
  if (type === "approval") return VALID_APPROVAL_STATES.has(state) ? state : "pending";
  if (type === "artifact") return state || "available";
  return state || "captured";
}

function extensionForLanguage(language) {
  const value = clean(language).toLowerCase();
  if (value === "json") return ".json";
  if (value === "html") return ".html";
  if (value === "text" || value === "txt") return ".txt";
  if (value === "javascript" || value === "js") return ".js";
  if (value === "typescript" || value === "ts") return ".ts";
  return ".md";
}

function languageForExtension(ext) {
  const value = clean(ext).toLowerCase();
  if (value === ".json") return "json";
  if (value === ".html") return "html";
  if (value === ".txt") return "text";
  if (value === ".js") return "javascript";
  if (value === ".ts") return "typescript";
  return "markdown";
}

function mimeForExtension(ext) {
  const value = clean(ext).toLowerCase();
  if (value === ".json") return "application/json; charset=utf-8";
  if (value === ".html") return "text/html; charset=utf-8";
  if (value === ".txt") return "text/plain; charset=utf-8";
  if (value === ".js") return "text/javascript; charset=utf-8";
  if (value === ".ts") return "text/typescript; charset=utf-8";
  return "text/markdown; charset=utf-8";
}

function safeFilename(value) {
  return (clean(value) || "artifact")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "artifact";
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
