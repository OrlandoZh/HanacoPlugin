import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const VALID_STATES = new Set(["DONE", "BLOCKED", "NEEDS_INPUT", "HANDOFF", "IN_PROGRESS", "NEEDS_REVIEW"]);

export function parseCheckpointText(text = "") {
  const rawText = typeof text === "string" ? text : "";
  const fields = {};
  for (const line of rawText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_]+)\s*:\s*(.*?)\s*$/i);
    if (!match) continue;
    const key = match[1].toUpperCase();
    if (!["STATE", "FILES_CHANGED", "COMMANDS_RUN", "RESULT", "BLOCKER", "NEXT_ACTION"].includes(key)) continue;
    fields[key] = match[2];
  }

  const state = normalizeState(fields.STATE);
  return {
    state,
    filesChanged: normalizeList(fields.FILES_CHANGED),
    commandsRun: normalizeList(fields.COMMANDS_RUN),
    result: clean(fields.RESULT),
    blocker: clean(fields.BLOCKER),
    nextAction: clean(fields.NEXT_ACTION),
    rawText,
    columnSuggestion: stateToColumn(state),
    complete: Boolean(state && fields.RESULT !== undefined && fields.NEXT_ACTION !== undefined)
  };
}

export function listCheckpoints(dataDir, filters = {}) {
  let checkpoints = readCheckpointFile(dataDir).checkpoints.map(normalizeCheckpoint).filter(Boolean);
  if (filters.taskId) checkpoints = checkpoints.filter((item) => item.taskId === filters.taskId);
  if (filters.sessionPath) checkpoints = checkpoints.filter((item) => item.sessionPath === filters.sessionPath);
  if (filters.state) checkpoints = checkpoints.filter((item) => item.state === normalizeState(filters.state));
  return checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listCheckpointConflicts(dataDir, filters = {}) {
  const checkpoints = listCheckpoints(dataDir, filters);
  const groups = groupConflictCandidates(checkpoints)
    .filter((group) => group.conflict)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return groups;
}

export function listCheckpointReminders(dataDir, filters = {}) {
  let checkpoints = listCheckpoints(dataDir, filters)
    .filter((checkpoint) => checkpoint.reminderAt && !checkpoint.reminderClearedAt);
  if (filters.dueBefore) {
    const dueBefore = new Date(filters.dueBefore).toISOString();
    checkpoints = checkpoints.filter((checkpoint) => checkpoint.reminderAt <= dueBefore);
  }
  if (!filters.includeSuperseded) checkpoints = checkpoints.filter((checkpoint) => !checkpoint.superseded);
  return checkpoints.map((checkpoint) => ({
    id: checkpoint.id,
    checkpointId: checkpoint.id,
    taskId: checkpoint.taskId,
    sessionPath: checkpoint.sessionPath,
    agentId: checkpoint.agentId,
    state: checkpoint.state,
    result: checkpoint.result,
    blocker: checkpoint.blocker,
    nextAction: checkpoint.nextAction,
    reminderAt: checkpoint.reminderAt,
    reminderNote: checkpoint.reminderNote,
    reminderCreatedAt: checkpoint.reminderCreatedAt,
    reminderTriggeredAt: checkpoint.reminderTriggeredAt,
    due: checkpoint.reminderAt <= new Date().toISOString()
  }));
}

export function createCheckpoint(dataDir, input = {}) {
  const parsed = parseCheckpointText(input.text || input.rawText || "");
  if (!parsed.state) return { ok: false, error: "state_required", parsed };

  const file = readCheckpointFile(dataDir);
  const now = new Date().toISOString();
  let checkpoint = normalizeCheckpoint({
    id: clean(input.id) || randomUUID(),
    taskId: clean(input.taskId) || null,
    sessionPath: clean(input.sessionPath) || null,
    agentId: clean(input.agentId) || null,
    source: clean(input.source) || "manual",
    createdAt: now,
    ...parsed
  });
  const checkpoints = file.checkpoints.map(normalizeCheckpoint).filter(Boolean);
  checkpoint = annotateCheckpointConflict(checkpoint, checkpoints);
  checkpoints.push(checkpoint);
  const next = refreshConflictMetadata(checkpoints);
  writeCheckpointFile(dataDir, { checkpoints: next });
  checkpoint = next.find((item) => item.id === checkpoint.id) || checkpoint;
  return { ok: true, checkpoint };
}

export function resolveCheckpointConflict(dataDir, input = {}) {
  const checkpointId = clean(input.checkpointId || input.acceptedCheckpointId);
  if (!checkpointId) return { ok: false, error: "checkpointId_required" };
  const file = readCheckpointFile(dataDir);
  const checkpoints = file.checkpoints.map(normalizeCheckpoint).filter(Boolean);
  const accepted = checkpoints.find((item) => item.id === checkpointId);
  if (!accepted) return { ok: false, error: "checkpoint_not_found" };
  const groupKey = accepted.conflictGroup || conflictKey(accepted);
  const now = new Date().toISOString();
  const resolvedBy = clean(input.resolvedBy) || "hanaagent";
  const next = checkpoints.map((item) => {
    if ((item.conflictGroup || conflictKey(item)) !== groupKey) return item;
    if (item.id === accepted.id) {
      return {
        ...item,
        accepted: true,
        superseded: false,
        conflict: false,
        resolvedAt: now,
        resolvedBy,
        resolution: clean(input.resolution) || "accepted"
      };
    }
    return {
      ...item,
      accepted: false,
      superseded: true,
      conflict: false,
      resolvedAt: now,
      resolvedBy,
      resolution: "superseded"
    };
  });
  writeCheckpointFile(dataDir, { checkpoints: next });
  return {
    ok: true,
    accepted: next.find((item) => item.id === accepted.id),
    superseded: next.filter((item) => (item.conflictGroup || conflictKey(item)) === groupKey && item.id !== accepted.id),
    groupKey
  };
}

export function updateCheckpointReminder(dataDir, checkpointId, input = {}) {
  const id = clean(checkpointId || input.checkpointId);
  if (!id) return { ok: false, error: "checkpointId_required" };
  const file = readCheckpointFile(dataDir);
  const checkpoints = file.checkpoints.map(normalizeCheckpoint).filter(Boolean);
  const index = checkpoints.findIndex((item) => item.id === id);
  if (index === -1) return { ok: false, error: "checkpoint_not_found" };
  const current = checkpoints[index];
  const action = clean(input.action).toLowerCase();
  const now = new Date().toISOString();

  if (["clear", "remove", "dismiss"].includes(action)) {
    checkpoints[index] = {
      ...current,
      reminderAt: "",
      reminderNote: "",
      reminderCreatedAt: current.reminderCreatedAt || "",
      reminderClearedAt: now,
      reminderTriggeredAt: action === "dismiss" ? (current.reminderTriggeredAt || now) : ""
    };
    writeCheckpointFile(dataDir, { checkpoints: refreshConflictMetadata(checkpoints) });
    return { ok: true, checkpoint: checkpoints[index], cleared: true };
  }

  if (action === "trigger") {
    checkpoints[index] = {
      ...current,
      reminderTriggeredAt: now
    };
    writeCheckpointFile(dataDir, { checkpoints: refreshConflictMetadata(checkpoints) });
    return { ok: true, checkpoint: checkpoints[index], triggered: true };
  }

  const reminderAt = normalizeReminderAt(input);
  if (!reminderAt) return { ok: false, error: "reminderAt_required" };
  checkpoints[index] = {
    ...current,
    reminderAt,
    reminderNote: clean(input.note || input.reminderNote) || current.nextAction || current.blocker || current.result,
    reminderCreatedAt: now,
    reminderClearedAt: "",
    reminderTriggeredAt: ""
  };
  writeCheckpointFile(dataDir, { checkpoints: refreshConflictMetadata(checkpoints) });
  return { ok: true, checkpoint: checkpoints[index], reminder: checkpointReminderPayload(checkpoints[index]) };
}

export function deleteCheckpoint(dataDir, checkpointId) {
  const file = readCheckpointFile(dataDir);
  const checkpoints = file.checkpoints.map(normalizeCheckpoint).filter(Boolean);
  const next = checkpoints.filter((item) => item.id !== checkpointId);
  if (next.length === checkpoints.length) return { ok: false, error: "checkpoint_not_found" };
  writeCheckpointFile(dataDir, { checkpoints: refreshConflictMetadata(next) });
  return { ok: true, removed: 1 };
}

export function clearCheckpoints(dataDir, filters = {}) {
  const checkpoints = readCheckpointFile(dataDir).checkpoints.map(normalizeCheckpoint).filter(Boolean);
  const next = checkpoints.filter((item) => {
    if (filters.taskId && item.taskId !== filters.taskId) return true;
    if (filters.sessionPath && item.sessionPath !== filters.sessionPath) return true;
    if (filters.state && item.state !== normalizeState(filters.state)) return true;
    return false;
  });
  writeCheckpointFile(dataDir, { checkpoints: refreshConflictMetadata(next) });
  return { ok: true, removed: checkpoints.length - next.length };
}

export function stateToColumn(state) {
  const column = clean(state).toLowerCase();
  if (["backlog", "running", "review", "blocked", "done"].includes(column)) return column;
  const normalized = normalizeState(state);
  if (normalized === "DONE") return "done";
  if (normalized === "BLOCKED" || normalized === "NEEDS_INPUT") return "blocked";
  if (normalized === "HANDOFF" || normalized === "NEEDS_REVIEW") return "review";
  if (normalized === "IN_PROGRESS") return "running";
  return "backlog";
}

function readCheckpointFile(dataDir) {
  ensureCheckpointFile(dataDir);
  try {
    const raw = fs.readFileSync(checkpointFilePath(dataDir), "utf8").trim();
    if (!raw) return { checkpoints: [] };
    const parsed = JSON.parse(raw);
    return { checkpoints: Array.isArray(parsed?.checkpoints) ? parsed.checkpoints : [] };
  } catch {
    return { checkpoints: [] };
  }
}

function writeCheckpointFile(dataDir, data) {
  ensureCheckpointFile(dataDir);
  const file = checkpointFilePath(dataDir);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ checkpoints: data.checkpoints || [] }, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function ensureCheckpointFile(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = checkpointFilePath(dataDir);
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ checkpoints: [] }, null, 2) + "\n", "utf8");
}

function checkpointFilePath(dataDir) {
  return path.join(dataDir, "checkpoints.json");
}

function normalizeCheckpoint(value) {
  if (!value || typeof value !== "object") return null;
  const id = clean(value.id);
  const state = normalizeState(value.state);
  if (!id || !state) return null;
  return {
    id,
    taskId: clean(value.taskId) || null,
    sessionPath: clean(value.sessionPath) || null,
    agentId: clean(value.agentId) || null,
    source: clean(value.source) || "manual",
    state,
    filesChanged: normalizeList(value.filesChanged),
    commandsRun: normalizeList(value.commandsRun),
    result: clean(value.result),
    blocker: clean(value.blocker),
    nextAction: clean(value.nextAction),
    rawText: clean(value.rawText),
    columnSuggestion: stateToColumn(value.columnSuggestion || state),
    complete: Boolean(value.complete),
    conflictGroup: clean(value.conflictGroup),
    conflict: value.conflict === true,
    conflictStates: Array.isArray(value.conflictStates) ? value.conflictStates.map(normalizeState).filter(Boolean) : [],
    accepted: value.accepted === true,
    superseded: value.superseded === true,
    resolvedAt: clean(value.resolvedAt),
    resolvedBy: clean(value.resolvedBy),
    resolution: clean(value.resolution),
    reminderAt: clean(value.reminderAt),
    reminderNote: clean(value.reminderNote),
    reminderCreatedAt: clean(value.reminderCreatedAt),
    reminderClearedAt: clean(value.reminderClearedAt),
    reminderTriggeredAt: clean(value.reminderTriggeredAt),
    createdAt: clean(value.createdAt) || new Date().toISOString()
  };
}

function normalizeReminderAt(input = {}) {
  const explicit = clean(input.reminderAt || input.dueAt || input.at);
  if (explicit) {
    const date = new Date(explicit);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const minutes = Number(input.minutes || input.delayMinutes || input.inMinutes);
  if (Number.isFinite(minutes) && minutes > 0) {
    return new Date(Date.now() + Math.min(minutes, 60 * 24 * 30) * 60 * 1000).toISOString();
  }
  return "";
}

function checkpointReminderPayload(checkpoint = {}) {
  return {
    id: checkpoint.id,
    checkpointId: checkpoint.id,
    taskId: checkpoint.taskId,
    sessionPath: checkpoint.sessionPath,
    state: checkpoint.state,
    reminderAt: checkpoint.reminderAt,
    reminderNote: checkpoint.reminderNote,
    reminderCreatedAt: checkpoint.reminderCreatedAt
  };
}

function annotateCheckpointConflict(checkpoint, existing) {
  const key = conflictKey(checkpoint);
  if (!key) return checkpoint;
  const related = existing.filter((item) => !item.superseded && conflictKey(item) === key);
  const states = [...new Set([...related.map((item) => item.state), checkpoint.state].filter(Boolean))];
  return {
    ...checkpoint,
    conflictGroup: key,
    conflict: states.length > 1,
    conflictStates: states
  };
}

function refreshConflictMetadata(checkpoints) {
  const groups = groupConflictCandidates(checkpoints);
  const groupByKey = new Map(groups.map((group) => [group.key, group]));
  return checkpoints.map((checkpoint) => {
    if (checkpoint.superseded || checkpoint.accepted) return checkpoint;
    const key = conflictKey(checkpoint);
    const group = groupByKey.get(key);
    if (!group) return { ...checkpoint, conflict: false, conflictStates: [] };
    return {
      ...checkpoint,
      conflictGroup: key,
      conflict: group.conflict,
      conflictStates: group.states
    };
  });
}

function groupConflictCandidates(checkpoints) {
  const groups = new Map();
  for (const checkpoint of checkpoints) {
    if (checkpoint.superseded || checkpoint.accepted) continue;
    const key = conflictKey(checkpoint);
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        taskId: checkpoint.taskId,
        sessionPath: checkpoint.sessionPath,
        agentId: checkpoint.agentId,
        checkpoints: [],
        states: [],
        conflict: false,
        updatedAt: checkpoint.createdAt
      });
    }
    const group = groups.get(key);
    group.checkpoints.push(checkpoint);
    group.states = [...new Set([...group.states, checkpoint.state])];
    group.conflict = group.states.length > 1;
    if (checkpoint.createdAt > group.updatedAt) group.updatedAt = checkpoint.createdAt;
  }
  return [...groups.values()].map((group) => ({
    ...group,
    checkpoints: group.checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }));
}

function conflictKey(checkpoint) {
  const taskId = clean(checkpoint?.taskId);
  if (taskId) return `task:${taskId}`;
  const sessionPath = clean(checkpoint?.sessionPath);
  const agentId = clean(checkpoint?.agentId);
  if (sessionPath) return `session:${sessionPath}`;
  if (agentId) return `agent:${agentId}`;
  return "";
}

function normalizeState(value) {
  const state = clean(value).toUpperCase();
  if (state === "NEEDS-INPUT") return "NEEDS_INPUT";
  if (state === "NEEDS-REVIEW") return "NEEDS_REVIEW";
  return VALID_STATES.has(state) ? state : "";
}

function normalizeList(value) {
  if (Array.isArray(value)) return value.map((item) => clean(item)).filter(Boolean).slice(0, 40);
  const text = clean(value);
  if (!text || /^none$/i.test(text)) return [];
  return text
    .split(/[,;，；]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 40);
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
