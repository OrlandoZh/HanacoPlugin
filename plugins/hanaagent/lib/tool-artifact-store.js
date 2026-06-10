import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const INLINE_TOOL_OUTPUT_LIMIT = 4000;
const PREVIEW_LIMIT = 1000;

export function externalizeLargeToolOutputs(dataDir, input = {}) {
  const sessionPath = clean(input.sessionPath);
  const messages = Array.isArray(input.messages) ? input.messages : [];
  if (!sessionPath || !messages.length) return { messages, artifacts: [] };
  const artifacts = [];
  const nextMessages = messages.map((message) => {
    const text = typeof message.text === "string" ? message.text : "";
    if (text.length <= INLINE_TOOL_OUTPUT_LIMIT || !isToolOutputMessage(message)) return message;
    const artifact = writeToolArtifact(dataDir, {
      sessionPath,
      messageId: message.id,
      toolCallId: inferToolCallId(message),
      role: message.role,
      toolName: inferToolName(message),
      content: text,
      createdAt: message.createdAt
    });
    artifacts.push(artifact);
    return {
      ...message,
      text: compactToolArtifactPointer(artifact),
      artifactPointer: {
        artifactId: artifact.artifactId,
        kind: artifact.kind,
        title: artifact.title,
        summary: artifact.summary,
        contentSize: artifact.contentSize,
        preview: artifact.preview,
        fullContentAvailable: true
      },
      raw: {
        ...(message.raw || {}),
        hanaagentArtifactPointer: {
          artifactId: artifact.artifactId,
          contentSize: artifact.contentSize,
          originalRole: message.role || "",
          policy: "externalized-large-tool-output"
        }
      }
    };
  });
  return { messages: nextMessages, artifacts };
}

export function listToolArtifacts(dataDir, filters = {}) {
  const index = readToolArtifactIndex(dataDir);
  let artifacts = index.artifacts;
  const sessionPath = clean(filters.sessionPath || filters.sessionId);
  if (sessionPath) artifacts = artifacts.filter((artifact) => artifact.sessionPath === sessionPath || artifact.sessionId === sessionPath);
  return artifacts
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .slice(0, clampInt(filters.limit, 1, 500, 100));
}

export function readToolArtifact(dataDir, artifactId) {
  const id = clean(artifactId);
  if (!id) return { ok: false, error: "artifactId_required" };
  const artifact = readToolArtifactIndex(dataDir).artifacts.find((item) => item.artifactId === id || item.id === id);
  if (!artifact) return { ok: false, error: "artifact_not_found" };
  const filePath = path.resolve(toolArtifactDir(dataDir), artifact.contentPath || "");
  const root = path.resolve(toolArtifactDir(dataDir));
  if (filePath !== root && !filePath.startsWith(root + path.sep)) return { ok: false, error: "artifact_path_outside_data_dir" };
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return { ok: false, error: "artifact_file_not_found" };
  const raw = fs.readFileSync(filePath, "utf8");
  let content = raw;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.content === "string") content = parsed.content;
  } catch {
    content = raw;
  }
  return {
    ok: true,
    artifact,
    content
  };
}

function writeToolArtifact(dataDir, input = {}) {
  const content = typeof input.content === "string" ? input.content : "";
  const now = new Date().toISOString();
  const toolName = clean(input.toolName) || "tool";
  const kind = inferArtifactKind(toolName, content);
  const artifactId = stableArtifactId(input.sessionPath, input.messageId, input.toolCallId, toolName, content);
  const dir = toolArtifactDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${artifactId}.json`;
  const filePath = path.join(dir, filename);
  const payload = {
    artifactId,
    sessionPath: clean(input.sessionPath),
    messageId: clean(input.messageId),
    toolCallId: clean(input.toolCallId),
    toolName,
    role: clean(input.role),
    kind,
    title: `${toolName} output`,
    summary: `${toolName} output externalized (${formatChars(content.length)}). Full output stored as artifact ${artifactId}.`,
    content,
    contentSize: content.length,
    createdAt: clean(input.createdAt) || now,
    updatedAt: now
  };
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const artifact = {
    id: artifactId,
    artifactId,
    kind: payload.kind,
    title: payload.title,
    summary: payload.summary,
    sessionId: payload.sessionPath,
    sessionPath: payload.sessionPath,
    messageId: payload.messageId,
    toolCallId: payload.toolCallId,
    toolName: payload.toolName,
    contentPath: filename,
    preview: compactPreview(content),
    contentPreview: compactPreview(content),
    contentSize: payload.contentSize,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    source: "hanaagent-tool-artifacts",
    metadata: {
      role: payload.role,
      policy: "externalized-large-tool-output",
      inlineLimit: INLINE_TOOL_OUTPUT_LIMIT
    }
  };
  upsertToolArtifactIndex(dataDir, artifact);
  return artifact;
}

function compactToolArtifactPointer(artifact) {
  return [
    artifact.summary || `Tool output externalized as artifact ${artifact.artifactId}.`,
    `Preview: ${artifact.preview || artifact.contentPreview}`,
    `Open via /api/artifacts/${encodeURIComponent(artifact.artifactId)} for full content.`
  ].join("\n");
}

function isToolOutputMessage(message = {}) {
  const role = clean(message.role).toLowerCase();
  if (["tool", "toolresult", "tool_result", "function"].includes(role)) return true;
  const raw = message.raw && typeof message.raw === "object" ? message.raw : {};
  if (raw.tool_call_id || raw.tool_use_id || raw.toolName || raw.tool_name) return true;
  return Array.isArray(raw.content) && raw.content.some((part) => /tool[_-]?result/i.test(clean(part?.type)));
}

function inferToolName(message = {}) {
  const raw = message.raw && typeof message.raw === "object" ? message.raw : {};
  return clean(raw.toolName || raw.tool_name || raw.name || raw.tool?.name || raw.function?.name || message.toolName || message.name) || clean(message.role) || "tool-output";
}

function inferToolCallId(message = {}) {
  const raw = message.raw && typeof message.raw === "object" ? message.raw : {};
  return clean(raw.toolCallId || raw.tool_call_id || raw.tool_use_id || raw.id || message.toolCallId || message.tool_call_id || message.tool_use_id);
}

function inferArtifactKind(toolName, text) {
  const name = clean(toolName).toLowerCase();
  const content = String(text || "");
  if (name.includes("read_file") || name === "read" || name === "file_read" || name.includes("file")) return "file_read";
  if (name.includes("terminal") || name.includes("exec") || name.includes("bash") || name.includes("shell")) return "terminal_log";
  if (name.includes("skill")) return "skill_doc";
  if (name.includes("patch") || name.includes("diff") || /^diff --git/m.test(content)) return "diff";
  return "tool_output";
}

function stableArtifactId(sessionPath, messageId, toolCallId, toolName, content) {
  const hash = createHash("sha256")
    .update([clean(sessionPath), clean(messageId), clean(toolCallId), clean(toolName), content].join("\n---hanaagent-tool-artifact---\n"))
    .digest("hex")
    .slice(0, 16);
  return `toolout_${hash}`;
}

function compactPreview(value) {
  const text = String(value || "").replace(/\r\n/g, "\n").trim();
  if (text.length > PREVIEW_LIMIT) return `${text.slice(0, PREVIEW_LIMIT).trimEnd()}...`;
  return text || "(empty tool output)";
}

function formatChars(size) {
  if (size < 1024) return `${size} chars`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}k chars`;
  return `${(size / (1024 * 1024)).toFixed(1)}m chars`;
}

function readToolArtifactIndex(dataDir) {
  const file = toolArtifactIndexPath(dataDir);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return { artifacts: Array.isArray(parsed?.artifacts) ? parsed.artifacts.map(normalizeArtifact).filter(Boolean) : [] };
  } catch {
    return { artifacts: [] };
  }
}

function upsertToolArtifactIndex(dataDir, artifact) {
  fs.mkdirSync(toolArtifactDir(dataDir), { recursive: true });
  const index = readToolArtifactIndex(dataDir);
  const next = index.artifacts.filter((item) => item.artifactId !== artifact.artifactId);
  next.push(normalizeArtifact(artifact));
  fs.writeFileSync(toolArtifactIndexPath(dataDir), `${JSON.stringify({ artifacts: next }, null, 2)}\n`, "utf8");
}

function normalizeArtifact(value) {
  if (!value || typeof value !== "object") return null;
  const artifactId = clean(value.artifactId || value.id);
  if (!artifactId) return null;
  return {
    id: artifactId,
    artifactId,
    kind: clean(value.kind) || "tool-output",
    title: clean(value.title) || "Tool output",
    summary: clean(value.summary),
    sessionId: clean(value.sessionId || value.sessionPath),
    sessionPath: clean(value.sessionPath || value.sessionId),
    messageId: clean(value.messageId),
    toolCallId: clean(value.toolCallId),
    toolName: clean(value.toolName),
    contentPath: clean(value.contentPath),
    preview: clean(value.preview || value.contentPreview),
    contentPreview: clean(value.contentPreview),
    contentSize: Number.isFinite(Number(value.contentSize)) ? Number(value.contentSize) : 0,
    createdAt: clean(value.createdAt) || new Date().toISOString(),
    updatedAt: clean(value.updatedAt) || clean(value.createdAt) || new Date().toISOString(),
    source: clean(value.source) || "hanaagent-tool-artifacts",
    metadata: value.metadata && typeof value.metadata === "object" ? value.metadata : {}
  };
}

function toolArtifactDir(dataDir) {
  return path.join(dataDir, "tool-artifacts");
}

function toolArtifactIndexPath(dataDir) {
  return path.join(toolArtifactDir(dataDir), "index.json");
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanMultiline(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}
