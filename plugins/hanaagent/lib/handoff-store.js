import fs from "node:fs";
import path from "node:path";

const MAX_HANDOFF_BYTES = 512 * 1024;

export function materializeHandoff(dataDir, input = {}) {
  const checkpoint = input.checkpoint || {};
  if (String(checkpoint.state || "").toUpperCase() !== "HANDOFF") {
    return { ok: false, error: "handoff_checkpoint_required" };
  }
  const workerId = safeId(input.workerId || input.assignmentId || checkpoint.agentId || checkpoint.taskId || checkpoint.sessionPath || "worker");
  if (!workerId) return { ok: false, error: "workerId_required" };
  const now = clean(input.createdAt || checkpoint.createdAt) || new Date().toISOString();
  const content = buildHandoffMarkdown({ ...input, checkpoint, workerId, createdAt: now });
  const size = Buffer.byteLength(content, "utf8");
  if (size > MAX_HANDOFF_BYTES) return { ok: false, error: "handoff_too_large", size, maxBytes: MAX_HANDOFF_BYTES };

  const dir = handoffDir(dataDir);
  fs.mkdirSync(dir, { recursive: true });
  const latest = path.join(dir, `${workerId}-latest.md`);
  const archive = path.join(dir, `${workerId}-${timestampId(now)}.md`);
  const latestTmp = `${latest}.${process.pid}.${Date.now()}.tmp`;
  const archiveTmp = `${archive}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(latestTmp, content, "utf8");
  fs.renameSync(latestTmp, latest);
  fs.writeFileSync(archiveTmp, content, "utf8");
  fs.renameSync(archiveTmp, archive);
  return {
    ok: true,
    handoff: {
      workerId,
      title: `交接：${workerId}`,
      latestPath: latest,
      archivePath: archive,
      memoryPath: `memory/handoffs/swarm/${workerId}-latest.md`,
      archiveMemoryPath: `memory/handoffs/swarm/${path.basename(archive)}`,
      size,
      createdAt: now,
      checkpointId: checkpoint.id || "",
      sessionPath: checkpoint.sessionPath || "",
      taskId: checkpoint.taskId || "",
      agentId: checkpoint.agentId || "",
      summary: checkpoint.result || checkpoint.nextAction || "执行智能体交接"
    }
  };
}

export function listHandoffs(dataDir, filters = {}) {
  const dir = handoffDir(dataDir);
  const entries = [];
  for (const file of safeReadDir(dir)) {
    if (!file.endsWith("-latest.md")) continue;
    const fullPath = path.join(dir, file);
    const stat = safeStat(fullPath);
    if (!stat?.isFile() || stat.size > MAX_HANDOFF_BYTES) continue;
    const workerId = file.replace(/-latest\.md$/i, "");
    if (filters.workerId && workerId !== safeId(filters.workerId)) continue;
    const content = fs.readFileSync(fullPath, "utf8");
    entries.push(parseHandoff(workerId, fullPath, content, stat));
  }
  return {
    ok: true,
    handoffs: entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, clampInt(filters.limit, 1, 200, 80))
  };
}

export function readHandoff(dataDir, workerId) {
  const id = safeId(workerId);
  if (!id) return { ok: false, error: "workerId_required", handoff: null };
  const file = path.join(handoffDir(dataDir), `${id}-latest.md`);
  const stat = safeStat(file);
  if (!stat?.isFile()) return { ok: false, error: "handoff_not_found", handoff: null };
  if (stat.size > MAX_HANDOFF_BYTES) return { ok: false, error: "handoff_too_large", handoff: null };
  return { ok: true, handoff: parseHandoff(id, file, fs.readFileSync(file, "utf8"), stat) };
}

function buildHandoffMarkdown(input = {}) {
  const checkpoint = input.checkpoint || {};
  return [
    "---",
    "schema: hanaagent.workerHandoff",
    "version: 1",
    `workerId: ${input.workerId}`,
    input.missionId ? `missionId: ${clean(input.missionId)}` : "",
    input.assignmentId ? `assignmentId: ${clean(input.assignmentId)}` : "",
    checkpoint.taskId ? `taskId: ${clean(checkpoint.taskId)}` : "",
    checkpoint.sessionPath ? `sessionPath: ${clean(checkpoint.sessionPath)}` : "",
    checkpoint.agentId ? `agentId: ${clean(checkpoint.agentId)}` : "",
    checkpoint.id ? `checkpointId: ${clean(checkpoint.id)}` : "",
    `createdAt: ${clean(input.createdAt)}`,
    "---",
    "",
    `# Worker Handoff: ${input.workerId}`,
    "",
    "## Result",
    checkpoint.result || "-",
    "",
    "## Files Changed",
    listBlock(checkpoint.filesChanged),
    "",
    "## Commands Run",
    listBlock(checkpoint.commandsRun),
    "",
    "## Blocker",
    checkpoint.blocker || "none",
    "",
    "## Next Action",
    checkpoint.nextAction || "-",
    "",
    "## Raw Checkpoint",
    "```text",
    checkpoint.rawText || "",
    "```"
  ].filter((line) => line !== "").join("\n");
}

function parseHandoff(workerId, filePath, content, stat) {
  const meta = parseFrontmatter(content);
  return {
    workerId,
    title: `交接：${workerId}`,
    memoryId: `handoff-${workerId}`,
    kind: "worker-handoff",
    source: "hanaagent:handoff",
    path: `memory/handoffs/swarm/${workerId}-latest.md`,
    filePath,
    content: meta.body,
    summary: firstLineAfter(meta.body, "## Result") || firstLine(meta.body),
    missionId: clean(meta.attrs.missionId),
    assignmentId: clean(meta.attrs.assignmentId),
    taskId: clean(meta.attrs.taskId),
    sessionPath: clean(meta.attrs.sessionPath),
    agentId: clean(meta.attrs.agentId),
    checkpointId: clean(meta.attrs.checkpointId),
    createdAt: clean(meta.attrs.createdAt) || stat.birthtime.toISOString(),
    updatedAt: stat.mtime.toISOString(),
    size: stat.size
  };
}

function handoffDir(dataDir) {
  return path.join(dataDir, "memory", "handoffs", "swarm");
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

function listBlock(values) {
  const list = Array.isArray(values) ? values.map(clean).filter(Boolean) : [];
  return list.length ? list.map((item) => `- ${item}`).join("\n") : "- none";
}

function firstLineAfter(content, heading) {
  const lines = String(content || "").split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() === heading);
  if (index === -1) return "";
  return lines.slice(index + 1).find((line) => line.trim() && !line.trim().startsWith("#")) || "";
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

function timestampId(value) {
  return clean(value).replace(/[^0-9TZ]+/g, "").replace(/Z$/, "") || String(Date.now());
}

function safeId(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/\.\.+/g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
