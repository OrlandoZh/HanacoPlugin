import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const VALID_ACTIONS = new Set([
  "dispatch",
  "sync-history",
  "mark-blocked",
  "request-review",
  "complete",
  "monitor",
  "escalate"
]);

const VALID_SEVERITIES = new Set(["info", "warn", "critical"]);
const VALID_LOOP_STATES = new Set(["idle", "active", "paused", "completed", "stopped", "escalated"]);

export function listAutopilotRuns(dataDir, filters = {}) {
  let runs = readAutopilotFile(dataDir).runs.map(normalizeRun).filter(Boolean);
  if (filters.missionId) runs = runs.filter((run) => run.missionId === clean(filters.missionId));
  if (filters.mode) runs = runs.filter((run) => run.mode === clean(filters.mode));
  return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function latestAutopilotRun(dataDir, filters = {}) {
  return listAutopilotRuns(dataDir, filters)[0] || null;
}

export function recordAutopilotRun(dataDir, input = {}) {
  const run = normalizeRun({
    id: clean(input.id) || randomUUID(),
    missionId: clean(input.missionId),
    mode: clean(input.mode) || "preview",
    createdAt: clean(input.createdAt) || new Date().toISOString(),
    summary: clean(input.summary),
    suggestions: Array.isArray(input.suggestions) ? input.suggestions : [],
    applied: Array.isArray(input.applied) ? input.applied : [],
    errors: Array.isArray(input.errors) ? input.errors : []
  });
  const file = readAutopilotFile(dataDir);
  file.runs.push(run);
  writeAutopilotFile(dataDir, { runs: file.runs.slice(-120) });
  return { ok: true, run };
}

export function getAutopilotLoopState(dataDir) {
  return normalizeLoopState(readAutopilotStateFile(dataDir));
}

export function startAutopilotLoop(dataDir, input = {}) {
  const now = clean(input.startedAt) || new Date().toISOString();
  const current = getAutopilotLoopState(dataDir);
  const loop = normalizeLoopState({
    ...current,
    id: clean(input.id) || current.id || randomUUID(),
    state: "active",
    mode: clean(input.mode) === "run" ? "run" : "preview",
    maxIterations: clampInt(input.maxIterations, 1, 100, current.maxIterations || 12),
    maxMissionsPerTick: clampInt(input.maxMissionsPerTick, 1, 20, current.maxMissionsPerTick || 5),
    escalationThreshold: clampInt(input.escalationThreshold, 1, 20, current.escalationThreshold || 3),
    intervalMinutes: clampInt(input.intervalMinutes, 1, 1440, current.intervalMinutes || 15),
    iteration: input.reset === false ? current.iteration : 0,
    consecutiveCritical: input.reset === false ? current.consecutiveCritical : 0,
    startedAt: input.reset === false && current.startedAt ? current.startedAt : now,
    updatedAt: now,
    pausedAt: "",
    stoppedAt: "",
    completedAt: "",
    escalatedAt: "",
    reason: clean(input.reason) || "loop_started",
    lastTick: input.reset === false ? current.lastTick : null,
    history: input.reset === false ? current.history : []
  });
  writeAutopilotStateFile(dataDir, loop);
  return { ok: true, loop };
}

export function pauseAutopilotLoop(dataDir, input = {}) {
  return updateAutopilotLoopState(dataDir, {
    state: "paused",
    pausedAt: clean(input.pausedAt) || new Date().toISOString(),
    reason: clean(input.reason) || "loop_paused"
  });
}

export function resumeAutopilotLoop(dataDir, input = {}) {
  const current = getAutopilotLoopState(dataDir);
  if (current.state !== "paused") return { ok: false, error: "loop_not_paused", loop: current };
  return updateAutopilotLoopState(dataDir, {
    state: "active",
    pausedAt: "",
    reason: clean(input.reason) || "loop_resumed"
  });
}

export function stopAutopilotLoop(dataDir, input = {}) {
  return updateAutopilotLoopState(dataDir, {
    state: "stopped",
    stoppedAt: clean(input.stoppedAt) || new Date().toISOString(),
    reason: clean(input.reason) || "loop_stopped"
  });
}

export function completeAutopilotLoop(dataDir, input = {}) {
  return updateAutopilotLoopState(dataDir, {
    state: "completed",
    completedAt: clean(input.completedAt) || new Date().toISOString(),
    reason: clean(input.reason) || "loop_completed"
  });
}

export function escalateAutopilotLoop(dataDir, input = {}) {
  return updateAutopilotLoopState(dataDir, {
    state: "escalated",
    escalatedAt: clean(input.escalatedAt) || new Date().toISOString(),
    reason: clean(input.reason) || "loop_escalated"
  });
}

export function recordAutopilotLoopTick(dataDir, input = {}) {
  const current = getAutopilotLoopState(dataDir);
  const now = clean(input.generatedAt) || new Date().toISOString();
  if (current.state !== "active") {
    return { ok: false, error: current.state === "paused" ? "loop_paused" : "loop_not_active", loop: current };
  }
  const criticalCount = countCriticalSuggestions(input.result);
  const consecutiveCritical = criticalCount ? current.consecutiveCritical + 1 : 0;
  let state = current.state;
  let reason = clean(input.reason) || current.reason || "loop_tick";
  let completedAt = current.completedAt;
  let escalatedAt = current.escalatedAt;
  if (current.iteration + 1 >= current.maxIterations) {
    state = "completed";
    reason = "max_iterations_reached";
    completedAt = now;
  }
  if (consecutiveCritical >= current.escalationThreshold) {
    state = "escalated";
    reason = "critical_threshold_reached";
    escalatedAt = now;
  }
  const tick = {
    id: clean(input.id) || randomUUID(),
    reason: clean(input.reason) || "loop",
    mode: clean(input.mode) || clean(input.result?.mode) || current.mode,
    iteration: current.iteration + 1,
    scanned: Number(input.result?.scanned || 0),
    criticalCount,
    runIds: extractRunIds(input.result),
    ok: input.result?.ok !== false,
    generatedAt: now
  };
  const loop = normalizeLoopState({
    ...current,
    state,
    iteration: tick.iteration,
    consecutiveCritical,
    updatedAt: now,
    completedAt,
    escalatedAt,
    reason,
    lastTick: tick,
    history: [...current.history, tick].slice(-80)
  });
  writeAutopilotStateFile(dataDir, loop);
  return { ok: true, loop, tick };
}

function updateAutopilotLoopState(dataDir, patch = {}) {
  const current = getAutopilotLoopState(dataDir);
  const loop = normalizeLoopState({
    ...current,
    ...patch,
    updatedAt: clean(patch.updatedAt) || new Date().toISOString()
  });
  writeAutopilotStateFile(dataDir, loop);
  return { ok: true, loop };
}

export function buildAutopilotPlan({ mission, tasks = [], checkpoints = [], sessionStatuses = {} } = {}) {
  const suggestions = [];
  const normalizedMission = mission && typeof mission === "object" ? mission : null;
  if (!normalizedMission) {
    return { ok: false, error: "mission_required", suggestions: [], summary: "暂无活动任务。" };
  }

  const now = Date.now();
  const assignments = Array.isArray(normalizedMission.assignments) ? normalizedMission.assignments : [];
  const taskById = new Map(tasks.map((task) => [clean(task.id), task]).filter(([id]) => id));
  const checkpointsByTask = groupBy(checkpoints, (checkpoint) => clean(checkpoint.taskId));
  const ready = [];
  const blocked = [];
  const review = [];
  const stale = [];
  const done = [];

  for (const assignment of assignments) {
    const task = assignment.taskId ? taskById.get(assignment.taskId) : null;
    const latestCheckpoint = latestByDate(checkpointsByTask.get(assignment.taskId) || [], "createdAt");
    const status = sessionStatusFor(sessionStatuses, assignment.sessionPath || normalizedMission.sessionPath);
    const state = clean(assignment.state).toLowerCase();
    const ageMinutes = minutesSince(assignment.updatedAt || normalizedMission.updatedAt, now);
    const statusAgeMinutes = minutesSince(status?.lastSeen || status?.updatedAt || status?.createdAt, now);

    if (state === "queued") {
      ready.push(assignment);
      suggestions.push(suggestion({
        action: "dispatch",
        severity: "info",
        mission: normalizedMission,
        assignment,
        task,
        reason: "任务分派仍在排队，尚未发送给执行智能体。",
        payload: { assignmentId: assignment.id, sessionPath: assignment.sessionPath || normalizedMission.sessionPath || "" }
      }));
    }

    if (state === "running" || state === "checkpointed") {
      if (assignment.sessionPath) {
        suggestions.push(suggestion({
          action: "sync-history",
          severity: "info",
          mission: normalizedMission,
          assignment,
          task,
          reason: "可以扫描运行中的执行智能体，查找包含证据的检查点。",
          payload: {
            sessionPath: assignment.sessionPath,
            taskId: assignment.taskId || "",
            assignmentId: assignment.id,
            missionId: normalizedMission.id
          }
        }));
      }
      if (ageMinutes >= 30 || statusAgeMinutes >= 20 || status?.state === "stale") {
        stale.push(assignment);
        suggestions.push(suggestion({
          action: "mark-blocked",
          severity: "warn",
          mission: normalizedMission,
          assignment,
          task,
          reason: `执行智能体已 ${Math.max(ageMinutes, statusAgeMinutes, 0)} 分钟没有新更新，可能已经停滞。`,
          payload: {
            assignmentId: assignment.id,
            state: "blocked",
            blocker: "自动驾驶检测到执行智能体停滞：近期没有检查点或会话更新。",
            nextAction: "复核执行智能体输出、同步会话历史，或重新投递任务分派。"
          }
        }));
      }
    }

    if (state === "blocked") {
      blocked.push(assignment);
      suggestions.push(suggestion({
        action: "escalate",
        severity: "critical",
        mission: normalizedMission,
        assignment,
        task,
        reason: assignment.blocker || latestCheckpoint?.blocker || "任务分派受阻，需要操作员处理。",
        payload: {
          assignmentId: assignment.id,
          blocker: assignment.blocker || latestCheckpoint?.blocker || "",
          nextAction: assignment.nextAction || latestCheckpoint?.nextAction || "请求澄清，或转交复核者。"
        }
      }));
    }

    if (state === "review" || latestCheckpoint?.state === "NEEDS_REVIEW" || latestCheckpoint?.state === "HANDOFF") {
      review.push(assignment);
      suggestions.push(suggestion({
        action: "request-review",
        severity: "info",
        mission: normalizedMission,
        assignment,
        task,
        reason: "执行智能体已交接输出，完成前应先复核。",
        payload: { assignmentId: assignment.id, state: "review" }
      }));
    }

    if (state === "done") done.push(assignment);
  }

  if (assignments.length && done.length === assignments.length && normalizedMission.state !== "complete") {
    suggestions.push(suggestion({
      action: "complete",
      severity: "info",
      mission: normalizedMission,
      reason: "所有任务分派均已完成，可以将任务标记为完成。",
      payload: { missionId: normalizedMission.id }
    }));
  }

  if (!suggestions.length) {
    suggestions.push(suggestion({
      action: "monitor",
      severity: "info",
      mission: normalizedMission,
      reason: "无需调整路由，继续监控活动中的执行智能体。",
      payload: { missionId: normalizedMission.id }
    }));
  }

  return {
    ok: true,
    missionId: normalizedMission.id,
    summary: [
      `${ready.length} queued`,
      `${assignments.filter((item) => ["running", "checkpointed"].includes(clean(item.state).toLowerCase())).length} active`,
      `${review.length} review`,
      `${blocked.length} blocked`,
      `${stale.length} stale`,
      `${done.length} done`
    ].join(", "),
    suggestions
  };
}

function suggestion(input = {}) {
  const assignment = input.assignment || null;
  const task = input.task || null;
  const mission = input.mission || null;
  const action = clean(input.action);
  const severity = clean(input.severity);
  return {
    id: clean(input.id) || randomUUID(),
    action: VALID_ACTIONS.has(action) ? action : "monitor",
    severity: VALID_SEVERITIES.has(severity) ? severity : "info",
    missionId: clean(input.missionId) || clean(mission?.id),
    missionTitle: clean(mission?.title),
    assignmentId: clean(input.assignmentId) || clean(assignment?.id),
    assignmentLabel: clean(assignment?.label),
    taskId: clean(input.taskId) || clean(task?.id) || clean(assignment?.taskId),
    sessionPath: clean(input.sessionPath) || clean(assignment?.sessionPath) || clean(mission?.sessionPath),
    reason: clean(input.reason),
    payload: input.payload && typeof input.payload === "object" ? input.payload : {},
    createdAt: new Date().toISOString()
  };
}

function normalizeRun(value) {
  if (!value || typeof value !== "object") return null;
  const id = clean(value.id);
  if (!id) return null;
  return {
    id,
    missionId: clean(value.missionId),
    mode: clean(value.mode) || "preview",
    createdAt: clean(value.createdAt) || new Date().toISOString(),
    summary: clean(value.summary),
    suggestions: Array.isArray(value.suggestions) ? value.suggestions.map(normalizeSuggestion).filter(Boolean) : [],
    applied: Array.isArray(value.applied) ? value.applied : [],
    errors: Array.isArray(value.errors) ? value.errors : []
  };
}

function normalizeLoopState(value = {}) {
  const state = VALID_LOOP_STATES.has(clean(value.state)) ? clean(value.state) : "idle";
  return {
    id: clean(value.id),
    state,
    mode: clean(value.mode) === "run" ? "run" : "preview",
    maxIterations: clampInt(value.maxIterations, 1, 100, 12),
    maxMissionsPerTick: clampInt(value.maxMissionsPerTick, 1, 20, 5),
    escalationThreshold: clampInt(value.escalationThreshold, 1, 20, 3),
    intervalMinutes: clampInt(value.intervalMinutes, 1, 1440, 15),
    iteration: clampInt(value.iteration, 0, 100000, 0),
    consecutiveCritical: clampInt(value.consecutiveCritical, 0, 100000, 0),
    startedAt: clean(value.startedAt),
    updatedAt: clean(value.updatedAt),
    pausedAt: clean(value.pausedAt),
    stoppedAt: clean(value.stoppedAt),
    completedAt: clean(value.completedAt),
    escalatedAt: clean(value.escalatedAt),
    reason: clean(value.reason),
    lastTick: value.lastTick && typeof value.lastTick === "object" ? {
      id: clean(value.lastTick.id),
      reason: clean(value.lastTick.reason),
      mode: clean(value.lastTick.mode) || "preview",
      iteration: clampInt(value.lastTick.iteration, 0, 100000, 0),
      scanned: clampInt(value.lastTick.scanned, 0, 100000, 0),
      criticalCount: clampInt(value.lastTick.criticalCount, 0, 100000, 0),
      runIds: Array.isArray(value.lastTick.runIds) ? value.lastTick.runIds.map(clean).filter(Boolean).slice(0, 50) : [],
      ok: value.lastTick.ok !== false,
      generatedAt: clean(value.lastTick.generatedAt)
    } : null,
    history: Array.isArray(value.history) ? value.history.map((item) => normalizeLoopState({ lastTick: item }).lastTick).filter(Boolean).slice(-80) : []
  };
}

function normalizeSuggestion(value) {
  if (!value || typeof value !== "object") return null;
  const action = clean(value.action);
  return {
    id: clean(value.id) || randomUUID(),
    action: VALID_ACTIONS.has(action) ? action : "monitor",
    severity: VALID_SEVERITIES.has(clean(value.severity)) ? clean(value.severity) : "info",
    missionId: clean(value.missionId),
    missionTitle: clean(value.missionTitle),
    assignmentId: clean(value.assignmentId),
    assignmentLabel: clean(value.assignmentLabel),
    taskId: clean(value.taskId),
    sessionPath: clean(value.sessionPath),
    reason: clean(value.reason),
    payload: value.payload && typeof value.payload === "object" ? value.payload : {},
    createdAt: clean(value.createdAt) || new Date().toISOString()
  };
}

function readAutopilotFile(dataDir) {
  ensureAutopilotFile(dataDir);
  try {
    const raw = fs.readFileSync(autopilotFilePath(dataDir), "utf8").trim();
    if (!raw) return { runs: [] };
    const parsed = JSON.parse(raw);
    return { runs: Array.isArray(parsed?.runs) ? parsed.runs : [] };
  } catch {
    return { runs: [] };
  }
}

function readAutopilotStateFile(dataDir) {
  ensureAutopilotStateFile(dataDir);
  try {
    const raw = fs.readFileSync(autopilotStateFilePath(dataDir), "utf8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeAutopilotStateFile(dataDir, data) {
  ensureAutopilotStateFile(dataDir);
  const file = autopilotStateFilePath(dataDir);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(normalizeLoopState(data), null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function writeAutopilotFile(dataDir, data) {
  ensureAutopilotFile(dataDir);
  const file = autopilotFilePath(dataDir);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ runs: data.runs || [] }, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function ensureAutopilotFile(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = autopilotFilePath(dataDir);
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ runs: [] }, null, 2) + "\n", "utf8");
}

function ensureAutopilotStateFile(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = autopilotStateFilePath(dataDir);
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(normalizeLoopState(), null, 2) + "\n", "utf8");
}

function autopilotFilePath(dataDir) {
  return path.join(dataDir, "autopilot-runs.json");
}

function autopilotStateFilePath(dataDir) {
  return path.join(dataDir, "autopilot-state.json");
}

function countCriticalSuggestions(result = {}) {
  const suggestions = [];
  for (const item of Array.isArray(result.results) ? result.results : []) {
    if (Array.isArray(item.suggestions)) suggestions.push(...item.suggestions);
  }
  if (Array.isArray(result.suggestions)) suggestions.push(...result.suggestions);
  return suggestions.filter((item) => item?.severity === "critical" || item?.action === "escalate").length;
}

function extractRunIds(result = {}) {
  const ids = [];
  for (const item of Array.isArray(result.results) ? result.results : []) {
    const id = clean(item.runId);
    if (id) ids.push(id);
  }
  const id = clean(result.run?.id || result.runId);
  if (id) ids.push(id);
  return [...new Set(ids)].slice(0, 50);
}

function groupBy(items, keyFn) {
  const groups = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function latestByDate(items, key) {
  return [...(items || [])].sort((a, b) => clean(b?.[key]).localeCompare(clean(a?.[key])))[0] || null;
}

function sessionStatusFor(statuses, sessionPath) {
  const key = clean(sessionPath);
  if (!key || !statuses || typeof statuses !== "object") return null;
  const value = statuses[key] || statuses[encodeURIComponent(key)];
  return value && typeof value === "object" ? value : null;
}

function minutesSince(value, now = Date.now()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.round((now - date.getTime()) / 60000));
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}
