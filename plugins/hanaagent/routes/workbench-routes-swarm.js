import {
  abortSession,
  getSessionHistory,
  listMemoryEntries,
  sendSessionMessage
} from "../lib/hanaagent-core.js";
import {
  createTask,
  listTasks,
  moveTask,
  updateTask
} from "../lib/task-store.js";
import {
  createCheckpoint
} from "../lib/checkpoint-store.js";
import {
  listHandoffs,
  materializeHandoff
} from "../lib/handoff-store.js";
import {
  getOperationProfile,
  importSwarmRoster,
  listOperationProfiles,
  profileToSwarmRoster
} from "../lib/operations-profile.js";
import {
  listLocalMemory,
  writeLocalMemory
} from "../lib/memory-store.js";
import {
  appendMissionEvent,
  buildMissionExport,
  buildMissionReport,
  createMission,
  getMission,
  getMissionRoles,
  listMissions,
  stopMission,
  updateMissionAssignment
} from "../lib/mission-store.js";
import {
  buildHandoffPrompt,
  buildWorkerLifecycle
} from "../lib/worker-lifecycle.js";
import {
  cleanString,
  clampRouteNumber,
  clipForEvent,
  firstCompatLine,
  normalizeStringListCompat,
  overviewMissionItems,
  toSnakeCompat,
  readJson
} from "./workbench-utils.js";

// Cross-module dependencies — assigned in registerSwarmRoutes from workbench.js
let buildOverview = null
let buildWorkerDrilldown = null
let dispatchAssignmentForMission = null
let createMissionTasks = null
let syncAssignmentHostTask = null
let syncMissionHostTasks = null
let launchAssignmentWorkerSession = null
let assignmentStateToColumn = null

function upsertSwarmRosterWorkerProfile(dataDir, input = {}) {
  const batchWorkers = normalizeCompatRosterWorkers(input);
  if (batchWorkers.length > 1 || Array.isArray(input.workers) || Array.isArray(input.roster?.workers)) {
    return upsertSwarmRosterWorkersProfile(dataDir, input, batchWorkers);
  }
  const worker = normalizeCompatRosterWorker(input.worker || input);
  if (!worker) return { ok: false, error: "worker_required" };
  const profileId = cleanString(input.profileId || input.profile || "swarm-roster");
  const existing = getOperationProfile(dataDir, profileId);
  const currentRoster = existing
    ? profileToSwarmRoster(existing)
    : {
        version: 1,
        metadata: {
          schema: "hanaagent.swarmRoster",
          source: "hanaagent",
          profileId,
          profileLabel: "Swarm Roster",
          exportedAt: new Date().toISOString()
        },
        workers: []
      };
  const workers = [
    ...(currentRoster?.workers || []).filter((item) => cleanString(item.id) !== worker.id),
    worker
  ];
  const imported = importSwarmRoster(dataDir, {
    roster: {
      ...currentRoster,
      workers,
      metadata: {
        ...(currentRoster?.metadata || {}),
        profileId,
        profileLabel: cleanString(existing?.label) || "Swarm Roster"
      }
    },
    id: profileId,
    label: cleanString(existing?.label) || "Swarm Roster",
    overwrite: true
  });
  const profile = imported.profile || getOperationProfile(dataDir, profileId);
  return {
    ok: imported.ok,
    path: "hanaagent://operation-profiles",
    profile,
    roster: profile ? profileToSwarmRoster(profile) : null,
    savedAt: Date.now(),
    error: imported.error
  };
}

function upsertSwarmRosterWorkersProfile(dataDir, input = {}, workers = []) {
  const normalizedWorkers = workers.length ? workers : normalizeCompatRosterWorkers(input);
  if (!normalizedWorkers.length) return { ok: false, error: "worker_required" };
  const profileId = cleanString(input.profileId || input.profile || input.id || input.roster?.metadata?.profileId || "swarm-roster");
  const existing = getOperationProfile(dataDir, profileId);
  const currentRoster = existing
    ? profileToSwarmRoster(existing)
    : {
        version: 1,
        metadata: {
          schema: "hanaagent.swarmRoster",
          source: "hanaagent",
          profileId,
          profileLabel: cleanString(input.label || input.name) || "Swarm Roster",
          exportedAt: new Date().toISOString()
        },
        workers: []
      };
  const replace = input.replace === true || input.overwrite === true || input.mode === "replace";
  const byId = new Map();
  if (!replace) {
    for (const worker of currentRoster?.workers || []) {
      const normalized = normalizeCompatRosterWorker(worker);
      if (normalized) byId.set(normalized.id, normalized);
    }
  }
  for (const worker of normalizedWorkers) byId.set(worker.id, worker);
  const nextRoster = {
    ...(input.roster && typeof input.roster === "object" ? input.roster : currentRoster),
    version: Number(input.roster?.version || currentRoster?.version || 1),
    metadata: {
      ...(currentRoster?.metadata || {}),
      ...(input.roster?.metadata || {}),
      schema: "hanaagent.swarmRoster",
      source: "hanaagent",
      profileId,
      profileLabel: cleanString(input.label || input.name || existing?.label || input.roster?.metadata?.profileLabel) || "Swarm Roster",
      exportedAt: new Date().toISOString()
    },
    workers: Array.from(byId.values())
  };
  const imported = importSwarmRoster(dataDir, {
    roster: nextRoster,
    id: profileId,
    label: cleanString(input.label || input.name || existing?.label || nextRoster.metadata?.profileLabel) || "Swarm Roster",
    overwrite: true
  });
  const profile = imported.profile || getOperationProfile(dataDir, profileId);
  return {
    ok: imported.ok,
    path: "hanaagent://operation-profiles",
    profile,
    roster: profile ? profileToSwarmRoster(profile) : null,
    savedAt: Date.now(),
    merged: !replace,
    workerCount: normalizedWorkers.length,
    error: imported.error
  };
}

function normalizeCompatRosterWorkers(input = {}) {
  const rawWorkers = Array.isArray(input.workers)
    ? input.workers
    : Array.isArray(input.roster?.workers)
      ? input.roster.workers
      : Array.isArray(input.worker)
        ? input.worker
        : [];
  const seen = new Set();
  const workers = [];
  for (const item of rawWorkers) {
    const worker = normalizeCompatRosterWorker(item);
    if (!worker || seen.has(worker.id)) continue;
    seen.add(worker.id);
    workers.push(worker);
  }
  return workers;
}

function normalizeCompatRosterWorker(input = {}) {
  if (!input || typeof input !== "object") return null;
  const id = cleanString(input.id || input.workerId || input.worker_id || input.name);
  if (!id) return null;
  const worker = {
    id,
    name: cleanString(input.name || input.label) || id,
    role: cleanString(input.role || input.roleId || input.role_id || input.profile) || id
  };
  for (const key of ["specialty", "model", "mission", "profile", "wrapper", "defaultCwd", "cwd", "agentId", "sessionPath"]) {
    const value = cleanString(input[key] || input[toSnakeCompat(key)]);
    if (value) worker[key] = value;
  }
  for (const key of ["modes", "tools", "skills", "capabilities", "preferredTaskTypes", "greenlightRequiredFor", "plugins", "pluginToolsets", "mcpServers"]) {
    const values = normalizeStringListCompat(input[key] || input[toSnakeCompat(key)]);
    if (values.length) worker[key] = values;
  }
  if (typeof input.acceptsBroadcast === "boolean" || typeof input.accepts_broadcast === "boolean") worker.acceptsBroadcast = input.acceptsBroadcast === true || input.accepts_broadcast === true;
  if (typeof input.reviewRequired === "boolean" || typeof input.review_required === "boolean") worker.reviewRequired = input.reviewRequired === true || input.review_required === true;
  if (Number.isFinite(Number(input.maxConcurrentTasks || input.max_concurrent_tasks))) worker.maxConcurrentTasks = clampRouteNumber(input.maxConcurrentTasks || input.max_concurrent_tasks, 1, 99, 1);
  return worker;
}

async function handleSwarmDispatchRoute(ctx, body = {}) {
  const assignments = parseCompatDispatchAssignments(body);
  if (!assignments.length) return { ok: false, error: "assignment_not_found", results: [] };
  const missionId = cleanString(body.missionId);
  let mission = missionId ? getMission(ctx.dataDir, missionId) : null;
  let created = null;
  if (!mission) {
    const lanes = assignments.map((assignment) => ({
      id: assignment.workerId,
      roleId: assignment.workerId,
      label: assignment.workerId,
      mission: assignment.task,
      acceptsBroadcast: true,
      reviewRequired: assignment.reviewRequired === true
    }));
    const result = createMission(ctx.dataDir, {
      goal: cleanString(body.missionTitle) || cleanString(body.prompt) || assignments[0].task,
      title: cleanString(body.missionTitle) || `Swarm dispatch: ${clipForEvent(assignments[0].task, 80)}`,
      notes: assignments.map((assignment) => `${assignment.workerId}: ${assignment.rationale || assignment.task}`).join("\n"),
      roles: assignments.map((assignment) => assignment.workerId),
      lanes,
      maxWorkers: assignments.length,
      sessionPath: cleanString(body.sessionPath),
      agentId: cleanString(body.agentId),
      mode: "dispatch",
      templateId: "orchestrate",
      templateLabel: "Swarm compatibility dispatch",
      createdBy: "hanaagent-swarm-dispatch"
    });
    if (!result.ok) return result;
    created = result.mission;
    createMissionTasks(ctx, created, "hanaagent-swarm-dispatch");
    mission = getMission(ctx.dataDir, created.id) || created;
  }
  if (!mission) return { ok: false, error: "mission_not_found", results: [] };
  const results = [];
  for (const request of assignments) {
    const assignment = mission.assignments.find((item) => item.id === request.assignmentId || item.id === request.workerId || item.roleId === request.workerId || item.label === request.workerId)
      || mission.assignments.find((item) => item.label === request.workerId)
      || null;
    if (!assignment) {
      results.push({ workerId: request.workerId, ok: false, error: "assignment_not_found", output: "", durationMs: 0, exitCode: null });
      continue;
    }
    if (request.task && request.task !== assignment.task) {
      updateMissionAssignment(ctx.dataDir, mission.id, assignment.id, {
        state: assignment.state,
        nextAction: request.task
      });
    }
    const started = Date.now();
    const sent = await dispatchAssignmentForMission(ctx, mission, assignment, {
      sessionPath: cleanString(body.sessionPath) || assignment.sessionPath || mission.sessionPath
    });
    results.push({
      workerId: request.workerId,
      assignmentId: assignment.id,
      ok: sent.ok,
      output: sent.prompt || "",
      error: sent.ok ? null : sent.error || "dispatch_failed",
      durationMs: Date.now() - started,
      exitCode: sent.ok ? 0 : null,
      delivery: sent.ok ? "session" : "degraded",
      checkpointStatus: body.waitForCheckpoint === true ? "not-requested" : "not-requested",
      brief: sent.brief || null,
      hostTask: sent.hostTask || null,
      sessionPath: sent.sessionPath || cleanString(body.sessionPath) || assignment.sessionPath || mission.sessionPath
    });
  }
  const latest = getMission(ctx.dataDir, mission.id) || mission;
  return {
    ok: results.some((item) => item.ok),
    mode: "hanaagent-swarm-compat",
    missionId: latest.id,
    mission: latest,
    created: Boolean(created),
    results,
    dispatchedAt: Date.now()
  };
}

function parseCompatDispatchAssignments(body = {}) {
  if (Array.isArray(body.assignments)) {
    return body.assignments.map((item) => ({
      workerId: cleanString(item?.workerId || item?.worker_id || item?.id),
      task: cleanString(item?.task || item?.prompt),
      rationale: cleanString(item?.rationale),
      assignmentId: cleanString(item?.assignmentId || item?.assignment_id),
      reviewRequired: item?.reviewRequired === true || item?.review_required === true
    })).filter((item) => item.workerId && item.task);
  }
  const workerIds = normalizeStringListCompat(body.workerIds || body.worker_ids || body.workers || body.workerId);
  const prompt = cleanString(body.prompt || body.task || body.message);
  if (!workerIds.length || !prompt) return [];
  return workerIds.map((workerId) => ({
    workerId,
    task: prompt,
    rationale: cleanString(body.rationale),
    assignmentId: "",
    reviewRequired: body.reviewRequired === true
  }));
}

async function handleSwarmCheckpointRoute(ctx, body = {}) {
  const workerId = cleanString(body.workerId || body.worker_id);
  if (!workerId) return { ok: false, error: "workerId required" };
  const state = cleanString(body.state || body.checkpointStatus || body.checkpoint_status || "IN_PROGRESS");
  const checkpointText = buildCompatCheckpointText(body, state);
  const mission = findMissionByWorkerId(ctx.dataDir, workerId, body);
  const assignment = mission
    ? mission.assignments.find((item) => item.id === cleanString(body.assignmentId || body.assignment_id) || item.id === workerId || item.roleId === workerId || item.label === workerId)
      || mission.assignments.find((item) => item.agentId && item.agentId === cleanString(body.agentId))
      || null
    : null;
  const taskId = cleanString(body.taskId || body.task_id) || assignment?.taskId || "";
  let checkpoint = null;
  if (taskId || cleanString(body.sessionPath) || cleanString(body.agentId) || assignment) {
    checkpoint = createCheckpoint(ctx.dataDir, {
      taskId,
      sessionPath: cleanString(body.sessionPath) || assignment?.sessionPath || mission?.sessionPath || "",
      agentId: cleanString(body.agentId) || assignment?.agentId || mission?.agentId || "",
      text: checkpointText,
      createdBy: "hanaagent-swarm-checkpoint"
    });
  }
  let missionUpdate = null;
  if (mission && assignment) {
    missionUpdate = updateMissionAssignment(ctx.dataDir, mission.id, assignment.id, {
      state: compatCheckpointToAssignmentState(state),
      result: cleanString(body.lastResult || body.last_result || body.result),
      output: checkpointText,
      blocker: cleanString(body.blockedReason || body.blocked_reason || body.blocker),
      nextAction: cleanString(body.nextAction || body.next_action),
      tokenCount: body.tokenCount || body.token_count
    });
    if (missionUpdate.ok && missionUpdate.assignment.taskId) {
      moveTask(ctx.dataDir, missionUpdate.assignment.taskId, assignmentStateToColumn(missionUpdate.assignment.state));
      missionUpdate.hostTaskUpdate = await syncAssignmentHostTask(ctx, missionUpdate.mission, missionUpdate.assignment, missionUpdate.assignment.state, {
        result: missionUpdate.assignment.result ? { result: missionUpdate.assignment.result } : undefined,
        reason: missionUpdate.assignment.blocker || ""
      });
    }
  }
  appendSwarmCompatRuntimeEvent(ctx.dataDir, {
    workerId,
    missionId: mission?.id || cleanString(body.missionId || body.mission_id),
    assignmentId: assignment?.id || cleanString(body.assignmentId || body.assignment_id),
    checkpoint: checkpoint?.checkpoint || null,
    body
  });
  return {
    ok: true,
    workerId,
    runtimePath: "hanaagent://missions",
    checkpoint: checkpoint?.checkpoint || {
      state,
      lastCheckIn: new Date().toISOString(),
      lastResult: cleanString(body.lastResult || body.last_result || body.result),
      nextAction: cleanString(body.nextAction || body.next_action),
      blockedReason: cleanString(body.blockedReason || body.blocked_reason || body.blocker)
    },
    missionUpdate,
    savedAt: Date.now()
  };
}

function buildCompatCheckpointText(body, state) {
  const normalizedState = compatCheckpointState(state);
  return [
    `STATE: ${normalizedState}`,
    `FILES_CHANGED: ${normalizeStringListCompat(body.filesChanged || body.files_changed).join(", ") || "none"}`,
    `COMMANDS_RUN: ${normalizeStringListCompat(body.commandsRun || body.commands_run).join(", ") || "none"}`,
    `RESULT: ${cleanString(body.lastResult || body.last_result || body.result || body.lastSummary || body.last_summary || body.currentTask || body.current_task) || "Runtime checkpoint updated"}`,
    `BLOCKER: ${cleanString(body.blockedReason || body.blocked_reason || body.blocker) || "none"}`,
    `NEXT_ACTION: ${cleanString(body.nextAction || body.next_action) || "continue"}`
  ].join("\n");
}

function compatCheckpointState(value) {
  const text = cleanString(value).toUpperCase();
  if (text === "DONE" || text === "COMPLETE" || text === "COMPLETED") return "DONE";
  if (text === "BLOCKED" || text === "NEEDS_INPUT") return "BLOCKED";
  if (text === "HANDOFF") return "HANDOFF";
  if (text === "REVIEW" || text === "NEEDS_REVIEW") return "NEEDS_REVIEW";
  return "IN_PROGRESS";
}

function compatCheckpointToAssignmentState(value) {
  const state = compatCheckpointState(value);
  if (state === "DONE") return "done";
  if (state === "BLOCKED") return "blocked";
  if (state === "HANDOFF" || state === "NEEDS_REVIEW") return "review";
  return "running";
}

function findMissionByWorkerId(dataDir, workerId, input = {}) {
  const missionId = cleanString(input.missionId || input.mission_id);
  if (missionId) return getMission(dataDir, missionId);
  return listMissions(dataDir, { includeArchived: true }).find((mission) => {
    return mission.assignments.some((assignment) => assignment.id === workerId || assignment.roleId === workerId || assignment.label === workerId || assignment.agentId === cleanString(input.agentId));
  }) || null;
}

function appendSwarmCompatRuntimeEvent(dataDir, input = {}) {
  if (!input.missionId) return null;
  return appendMissionEvent(dataDir, input.missionId, {
    type: "swarm_checkpoint",
    label: `来自 ${input.workerId} 的智能体群组检查点`,
    meta: {
      workerId: input.workerId,
      assignmentId: input.assignmentId || "",
      checkpointId: input.checkpoint?.id || "",
      state: input.checkpoint?.state || cleanString(input.body?.state || input.body?.checkpointStatus)
    }
  });
}

export function buildSwarmRuntimeCompat(overview = {}, input = {}) {
  const limit = clampRouteNumber(input.limit, 1, 200, 100);
  const workerId = cleanString(input.workerId);
  const cards = Array.isArray(overview.workerCards) ? overview.workerCards : [];
  const missions = overviewMissionItems(overview);
  const assignments = missions.flatMap((mission) => (mission.assignments || []).map((assignment) => ({ ...assignment, mission })));
  const ids = new Set([
    ...assignments.map((assignment) => cleanString(assignment.id)).filter(Boolean),
    ...cards.map((card) => cleanString(card.activeAssignment?.id || card.id)).filter(Boolean)
  ]);
  const entries = [];
  for (const id of Array.from(ids)) {
    if (workerId && workerId !== id) continue;
    const card = cards.find((item) => item.id === id) || {};
    const assignment = assignments.find((item) => item.id === id || item.agentId === card.agentId || item.sessionPath === card.sessionPath) || card.activeAssignment || {};
    entries.push(buildSwarmRuntimeEntryCompat({ id, card, assignment, overview }));
    if (entries.length >= limit) break;
  }
  const checkedAt = Date.now();
  const result = {
    ok: true,
    checkedAt,
    registryVersion: 1,
    workspaceRoot: "",
    tmuxAvailable: false,
    mode: {
      mode: "openhanako-plugin",
      source: "hanaagent",
      note: "运行时状态通过 OpenHanako 插件能力代理，而不是来自 Hermes tmux 文件。"
    },
    entries
  };
  result.workers = entries;
  result.runtime = {
    checkedAt,
    registryVersion: result.registryVersion,
    workspaceRoot: result.workspaceRoot,
    tmuxAvailable: result.tmuxAvailable,
    entries,
    workers: entries,
    mode: result.mode
  };
  return result;
}

function buildSwarmRuntimeEntryCompat({ id, card = {}, assignment = {}, overview = {} }) {
  const roster = assignment.roster || card.roster || {};
  const sessionPath = cleanString(assignment.sessionPath || card.sessionPath);
  const tasks = Array.isArray(overview.tasks) ? overview.tasks.filter((task) => task.assignmentId === assignment.id || task.assignee === assignment.agentId || task.sessionPath === sessionPath) : [];
  const checkpoints = Array.isArray(overview.checkpoints) ? overview.checkpoints.filter((checkpoint) => checkpoint.taskId === assignment.taskId || checkpoint.sessionPath === sessionPath || checkpoint.agentId === assignment.agentId) : [];
  const runRecords = Array.isArray(overview.runRecords) ? overview.runRecords.filter((record) => record.assignmentId === assignment.id || record.sessionPath === sessionPath || record.agentId === assignment.agentId) : [];
  const latestCheckpoint = checkpoints[0] || card.latestCheckpoint || null;
  const state = runtimeStateFromAssignment(assignment.state || card.status);
  const checkpointStatus = runtimeCheckpointStatusFromState(assignment.state || latestCheckpoint?.state);
  const terminalKind = sessionPath ? "session" : assignment.cwd || roster.defaultCwd ? "shell" : "none";
  return {
    workerId: id,
    displayName: cleanString(card.name || assignment.label) || id,
    humanLabel: cleanString(`${assignment.label || card.name || id}${assignment.lane ? ` (${assignment.lane})` : ""}`),
    role: cleanString(assignment.roleId || roster.profile || roster.role || assignment.lane) || "worker",
    specialty: cleanString(roster.specialty) || null,
    mission: cleanString(roster.mission || assignment.mission?.goal || assignment.task) || null,
    skills: Array.isArray(roster.skills) ? roster.skills : [],
    capabilities: Array.isArray(roster.capabilities) ? roster.capabilities : [],
    source: "openhanako-plugin",
    pid: null,
    startedAt: assignment.createdAt ? Date.parse(assignment.createdAt) || null : null,
    lastOutputAt: assignment.updatedAt ? Date.parse(assignment.updatedAt) || null : null,
    cwd: cleanString(assignment.cwd || roster.defaultCwd) || null,
    currentTask: cleanString(assignment.task || card.currentTask?.title || card.task) || null,
    activeTool: null,
    state,
    phase: cleanString(assignment.mission?.phase || assignment.mission?.state || state) || state,
    checkpointStatus,
    needsHuman: assignment.state === "blocked" || assignment.state === "review" || checkpointStatus === "needs_input",
    blockedReason: cleanString(assignment.blocker) || null,
    lastCheckIn: cleanString(latestCheckpoint?.createdAt || assignment.updatedAt) || null,
    lastSummary: cleanString(assignment.output || assignment.result || card.latestCheckpoint?.result) || null,
    nextAction: cleanString(assignment.nextAction) || null,
    lastResult: cleanString(assignment.result || latestCheckpoint?.result) || null,
    assignedTaskCount: tasks.length,
    cronJobCount: 0,
    tmuxSession: null,
    tmuxAttachable: false,
    recentLogTail: cleanString(assignment.output || latestCheckpoint?.rawText) || null,
    lastSessionStartedAt: null,
    logPath: null,
    terminalKind,
    profilePath: cleanString(roster.profile) || "",
    wrapperPath: cleanString(roster.wrapper) || null,
    boundary: {
      sessionPath,
      agentId: cleanString(assignment.agentId || card.agentId),
      cwd: cleanString(assignment.cwd || roster.defaultCwd)
    },
    lifecycle: {
      state,
      phase: cleanString(assignment.mission?.phase || assignment.mission?.state || state) || state,
      checkpointStatus,
      needsHuman: assignment.state === "blocked" || assignment.state === "review" || checkpointStatus === "needs_input",
      blockedReason: cleanString(assignment.blocker) || null,
      startedAt: assignment.createdAt ? Date.parse(assignment.createdAt) || null : null,
      lastOutputAt: assignment.updatedAt ? Date.parse(assignment.updatedAt) || null : null,
      lastCheckIn: cleanString(latestCheckpoint?.createdAt || assignment.updatedAt) || null,
      lastSummary: cleanString(assignment.output || assignment.result) || null,
      lastResult: cleanString(assignment.result || latestCheckpoint?.result) || null,
      nextAction: cleanString(assignment.nextAction) || null,
      pid: null,
      tmuxSession: null,
      tmuxAttachable: false,
      terminalKind
    },
    session: {
      sessionPath,
      title: cleanString(card.sessionTitle || assignment.label || id),
      source: sessionPath ? "openhanako-session" : "unavailable"
    },
    dispatch: {
      mode: "session:send",
      dispatchable: Boolean(sessionPath),
      lastDispatchAt: cleanString(assignment.updatedAt) || null,
      lastDispatchResult: assignment.state || card.status || ""
    },
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      state: task.column || task.status || "",
      priority: task.priority || "",
      assignmentId: task.assignmentId || ""
    })),
    artifacts: runRecords.filter((record) => record.type === "artifact").map((record) => ({
      id: record.id,
      title: record.title,
      path: record.path || record.meta?.path || "",
      state: record.state || ""
    })),
    previews: runRecords.filter((record) => record.meta?.previewUrl || record.previewUrl).map((record) => ({
      id: record.id,
      title: record.title,
      url: record.meta?.previewUrl || record.previewUrl,
      source: record.tool || "run-record"
    }))
  };
}

function buildSwarmHealthCompat(overview = {}, input = {}) {
  const runtime = buildSwarmRuntimeCompat(overview, input);
  const workers = runtime.entries.map((entry) => {
    const model = cleanString(entry.worker_context?.model || entry.model || entry.roster?.model) || cleanString(entry.boundary?.model) || "unknown";
    const wrapperFound = Boolean(entry.wrapperPath);
    const profileFound = Boolean(entry.profilePath || entry.boundary?.sessionPath || entry.boundary?.agentId);
    const degraded = entry.state === "blocked" || entry.needsHuman || entry.checkpointStatus === "blocked" || !entry.dispatch.dispatchable;
    return {
      workerId: entry.workerId,
      displayName: entry.displayName,
      humanLabel: entry.humanLabel,
      role: entry.role,
      specialty: entry.specialty,
      mission: entry.mission,
      skills: entry.skills,
      capabilities: entry.capabilities,
      profileFound,
      wrapperFound,
      model,
      provider: "openhanako",
      recentAuthErrors: 0,
      recentFallbacks: 0,
      lastErrorAt: degraded ? entry.lastCheckIn : null,
      lastErrorMessage: entry.blockedReason || (!entry.dispatch.dispatchable ? "未绑定 OpenHanako 会话路径" : null),
      lastFallbackAt: null,
      lastFallbackMessage: null,
      modelAuthStatus: "unknown",
      primaryAuthOk: null,
      fallbackActive: false,
      fallbackProvider: null,
      fallbackModel: null,
      state: entry.state,
      checkpointStatus: entry.checkpointStatus,
      needsHuman: entry.needsHuman
    };
  });
  const warnings = [];
  const blocked = workers.filter((worker) => worker.state === "blocked" || worker.checkpointStatus === "blocked").length;
  const missingSession = runtime.entries.filter((entry) => !entry.blockedReason && !entry.dispatch.dispatchable).length;
  if (blocked) warnings.push(`${blocked} worker(s) are blocked.`);
  if (missingSession) warnings.push(`${missingSession} worker(s) have no bound OpenHanako session path.`);
  return {
    ok: true,
    checkedAt: Date.now(),
    fetchedAt: Date.now(),
    workspaceModel: "openhanako",
    agentApiUrl: "openhanako://plugin-capabilities",
    claudeApiUrl: "openhanako://plugin-capabilities",
    workers,
    summary: {
      totalWorkers: workers.length,
      wrappersConfigured: workers.filter((worker) => worker.wrapperFound).length,
      totalAuthErrors24h: 0,
      totalFallbacks24h: 0,
      workersUsingFallback: 0,
      workersPrimaryAuthFailed: 0,
      distinctModels: Array.from(new Set(workers.map((worker) => worker.model))).filter((value) => value && value !== "unknown"),
      distinctProviders: ["openhanako"],
      degraded: warnings.length > 0,
      warnings
    }
  };
}

async function handleSwarmDirectChatCompat(ctx, body = {}) {
  const workerId = cleanString(body.workerId || body.worker_id);
  const prompt = cleanString(body.prompt || body.message || body.text);
  const limit = clampRouteNumber(body.limit, 1, 100, 30);
  if (!workerId || !isSafeCompatId(workerId)) {
    return {
      ok: false,
      workerId,
      delivered: false,
      error: "Invalid workerId",
      sessionId: null,
      sessionTitle: null,
      messages: [],
      source: "unavailable",
      fetchedAt: Date.now()
    };
  }
  if (!prompt) {
    return {
      ok: false,
      workerId,
      delivered: false,
      error: "Missing prompt",
      sessionId: null,
      sessionTitle: null,
      messages: [],
      source: "unavailable",
      fetchedAt: Date.now()
    };
  }
  const overview = await buildOverview(ctx);
  const drilldown = buildWorkerDrilldown(overview, workerId);
  if (!drilldown.ok) {
    return {
      ok: false,
      workerId,
      delivered: false,
      error: "worker_not_found",
      sessionId: null,
      sessionTitle: null,
      messages: [],
      source: "unavailable",
      fetchedAt: Date.now()
    };
  }
  const sessionPath = cleanString(body.sessionPath)
    || drilldown.ide?.identity?.sessionPath
    || drilldown.assignment?.sessionPath
    || drilldown.sessions?.[0]?.path
    || "";
  const sent = await sendSessionMessage(ctx, { sessionPath, text: prompt });
  const history = sent.ok ? await getSessionHistory(ctx, { sessionPath, limit }) : { ok: false, messages: [], error: sent.error };
  return {
    ok: sent.ok,
    workerId,
    delivered: sent.ok,
    delivery: sent.ok ? "session:send" : undefined,
    error: sent.ok ? null : sent.error || "dispatch_failed",
    sessionId: sessionPath || null,
    sessionTitle: drilldown.sessions?.find((item) => item.path === sessionPath)?.title || drilldown.worker?.name || drilldown.assignment?.label || workerId,
    messages: Array.isArray(history.messages) ? history.messages.slice(-limit) : [],
    source: history.ok ? "session:history" : "unavailable",
    fetchedAt: Date.now(),
    toolTrace: history.toolTrace || null
  };
}

async function handleSwarmDecomposeCompat(ctx, body = {}) {
  const prompt = cleanString(body.prompt || body.mission || body.goal);
  if (!prompt) return { ok: false, error: "prompt required" };
  if (prompt.length > 16000) return { ok: false, error: "prompt too long" };
  const workers = normalizeCompatWorkerHints(body.workers && Array.isArray(body.workers)
    ? body.workers
    : profileToSwarmRoster(getOperationProfile(ctx.dataDir, cleanString(body.profileId || body.profile) || "swarm-roster") || getOperationProfile(ctx.dataDir, "builder"))?.workers || []);
  if (!workers.length) return { ok: false, error: "workers[] required" };
  const orchestratorPrompt = buildSwarmDecomposeOrchestratorPrompt({ prompt, workers });
  const fallback = heuristicSwarmAssignments(prompt, workers);
  let orchestratorDispatch = null;
  const sessionPath = cleanString(body.sessionPath || body.orchestratorSessionPath || body.orchestrator_session_path);
  if (body.dispatchToSession === true || body.dispatch_to_session === true) {
    orchestratorDispatch = await sendSessionMessage(ctx, {
      sessionPath,
      text: orchestratorPrompt
    });
  }
  return {
    ok: true,
    fallback: true,
    warning: "HanaAgent returned deterministic fallback assignments. Use orchestratorPrompt or dispatchToSession=true to ask an OpenHanako session to produce the Hermes JSON decomposition.",
    decomposedAt: Date.now(),
    model: cleanString(body.model) || "openhanako-orchestrator",
    mode: "openhanako-plugin",
    workers,
    rosterText: formatSwarmDecomposeRoster(workers),
    orchestratorPrompt,
    orchestratorDispatch,
    ...fallback
  };
}

function buildSwarmKanbanCompat(ctx) {
  return {
    ok: true,
    cards: listTasks(ctx.dataDir, { includeDone: true }).map(taskToSwarmKanbanCard),
    backend: {
      source: "hanaagent-task-store",
      path: "hanaagent://tasks",
      columns: ["backlog", "todo", "ready", "running", "review", "blocked", "done"]
    }
  };
}

function createSwarmKanbanCardCompat(ctx, body = {}) {
  const result = createTask(ctx.dataDir, {
    title: body.title,
    description: cleanString(body.spec || body.description || body.notes),
    column: compatKanbanStatusToColumn(body.status || body.column || body.lane),
    assignee: cleanString(body.assignedWorker || body.assignee || body.workerId),
    tags: body.acceptanceCriteria ? ["swarm-kanban", ...normalizeStringListCompat(body.acceptanceCriteria).slice(0, 6)] : ["swarm-kanban"],
    missionId: cleanString(body.missionId),
    createdBy: cleanString(body.createdBy) || "swarm-kanban",
    id: cleanString(body.idempotencyKey || body.id),
    mode: "swarm-kanban"
  });
  if (!result.ok) return { ok: false, error: result.error === "title_required" ? "title required" : result.error };
  return { ok: true, card: taskToSwarmKanbanCard(result.task), backend: buildSwarmKanbanCompat(ctx).backend };
}

function updateSwarmKanbanCardCompat(ctx, body = {}) {
  const id = cleanString(body.id || body.cardId || body.taskId);
  if (!id) return { ok: false, error: "id required" };
  const updates = {
    ...(typeof body.title === "string" ? { title: body.title } : {}),
    ...(typeof body.spec === "string" || typeof body.description === "string" ? { description: body.spec || body.description } : {}),
    ...(body.status || body.column || body.lane ? { column: compatKanbanStatusToColumn(body.status || body.column || body.lane) } : {}),
    ...(typeof body.assignedWorker === "string" || typeof body.assignee === "string" ? { assignee: body.assignedWorker || body.assignee } : {}),
    ...(typeof body.missionId === "string" ? { missionId: body.missionId } : {}),
    ...(Array.isArray(body.acceptanceCriteria) || typeof body.acceptanceCriteria === "string" ? { tags: ["swarm-kanban", ...normalizeStringListCompat(body.acceptanceCriteria).slice(0, 6)] } : {})
  };
  const result = updateTask(ctx.dataDir, id, updates);
  if (!result.ok) return { ok: false, error: "Card not found" };
  return { ok: true, card: taskToSwarmKanbanCard(result.task), backend: buildSwarmKanbanCompat(ctx).backend };
}

async function readSwarmMemoryCompat(ctx, input = {}) {
  const workerId = cleanString(input.workerId || input.worker_id);
  const kind = compatMemoryKind(input.kind);
  const missionId = cleanString(input.missionId || input.mission_id);
  const broadQuery = workerId || missionId || "";
  const [host, local, handoffs] = await Promise.all([
    listMemoryEntries(ctx, { query: broadQuery, limit: input.limit || 80 }),
    Promise.resolve(listLocalMemory(ctx.dataDir, { query: broadQuery, limit: input.limit || 80 })),
    Promise.resolve(listHandoffs(ctx.dataDir, { workerId, limit: input.limit || 80 }))
  ]);
  const events = [];
  const entries = [
    ...(handoffs.handoffs || []),
    ...(local.entries || []),
    ...(host.entries || [])
  ].filter((entry) => {
    const haystack = [
      entry.workerId,
      entry.assignmentId,
      entry.missionId,
      entry.agentId,
      entry.sessionPath,
      entry.title,
      entry.summary,
      entry.content
    ].map(cleanString).join(" ").toLowerCase();
    if (workerId && !haystack.includes(workerId.toLowerCase())) return false;
    if (missionId && !haystack.includes(missionId.toLowerCase())) return false;
    return true;
  });
  for (const entry of entries) {
    events.push({
      id: entry.id || entry.memoryId || entry.workerId,
      workerId: workerId || entry.workerId || "",
      missionId: missionId || entry.missionId || "",
      kind,
      type: entry.kind || "note",
      title: entry.title || entry.summary || "Memory",
      summary: entry.summary || firstCompatLine(entry.content),
      content: entry.content || entry.summary || "",
      updatedAt: entry.updatedAt || entry.createdAt || ""
    });
  }
  return {
    ok: true,
    workerId: workerId || null,
    kind,
    missionId: missionId || null,
    date: cleanString(input.date) || null,
    events,
    entries,
    source: host.ok ? "host+local" : "local",
    fetchedAt: Date.now(),
    error: host.ok ? undefined : host.error
  };
}

function writeSwarmMemoryCompat(ctx, body = {}) {
  const workerId = cleanString(body.workerId || body.worker_id);
  if (!workerId || !isSafeCompatId(workerId)) return { ok: false, error: "Valid workerId required" };
  if (body.scaffold === true) {
    const result = writeLocalMemory(ctx.dataDir, {
      memoryId: `swarm-${workerId}-profile`,
      title: cleanString(body.name) || `${workerId} profile`,
      summary: cleanString(body.role || body.specialty) || "Swarm worker profile",
      content: [
        `Worker: ${workerId}`,
        cleanString(body.name) ? `Name: ${cleanString(body.name)}` : "",
        cleanString(body.role) ? `Role: ${cleanString(body.role)}` : "",
        cleanString(body.specialty) ? `Specialty: ${cleanString(body.specialty)}` : "",
        cleanString(body.model) ? `Model: ${cleanString(body.model)}` : ""
      ].filter(Boolean).join("\n")
    });
    return { ok: result.ok, workerId, action: "scaffolded", entry: result.entry, error: result.error };
  }
  const kind = compatMemoryKind(body.kind);
  const missionId = cleanString(body.missionId || body.mission_id);
  if (kind === "handoff") {
    if (!missionId) return { ok: false, error: "Valid missionId required for handoff writes" };
    const content = typeof body.content === "string" ? body.content : "";
    if (!content.trim()) return { ok: false, error: "handoff content required" };
    const checkpoint = {
      id: `swarm-memory-${Date.now()}`,
      state: "HANDOFF",
      rawText: content,
      result: cleanString(body.summary) || firstCompatLine(content),
      createdAt: new Date().toISOString()
    };
    const result = materializeHandoff(ctx.dataDir, {
      checkpoint,
      workerId,
      missionId,
      assignmentId: cleanString(body.assignmentId || body.assignment_id)
    });
    if (result.ok) {
      appendMissionEvent(ctx.dataDir, missionId, {
        type: "swarm_memory_handoff",
        label: `已为 ${workerId} 写入智能体群组交接记忆`,
        meta: { workerId, assignmentId: cleanString(body.assignmentId || body.assignment_id), memoryPath: result.handoff?.memoryPath || "" }
      });
    }
    return { ok: result.ok, workerId, kind, ...result };
  }
  const eventType = compatMemoryEventType(body.eventType || body.event_type);
  const content = typeof body.content === "string" ? body.content : cleanString(body.summary);
  const title = cleanString(body.title) || `${workerId} ${eventType}`;
  const result = writeLocalMemory(ctx.dataDir, {
    memoryId: `swarm-${workerId}-${missionId || "shared"}-${Date.now()}`,
    title,
    summary: cleanString(body.summary) || firstCompatLine(content) || `${eventType} event`,
    content: [
      `Worker: ${workerId}`,
      missionId ? `Mission: ${missionId}` : "",
      cleanString(body.assignmentId || body.assignment_id) ? `Assignment: ${cleanString(body.assignmentId || body.assignment_id)}` : "",
      `Kind: ${kind}`,
      `Event: ${eventType}`,
      "",
      content,
      body.event && typeof body.event === "object" ? `\nEvent JSON:\n${JSON.stringify(body.event, null, 2)}` : ""
    ].filter(Boolean).join("\n")
  });
  return { ok: result.ok, workerId, kind, eventType, entry: result.entry, error: result.error };
}

function buildSwarmReportsCompat(ctx, input = {}) {
  const missionId = cleanString(input.missionId || input.mission_id);
  const workerId = cleanString(input.workerId || input.worker_id);
  const limit = clampRouteNumber(input.limit, 1, 500, 100);
  const missions = (missionId ? [getMission(ctx.dataDir, missionId)].filter(Boolean) : listMissions(ctx.dataDir, { includeArchived: true }))
    .filter((mission) => !workerId || (mission.assignments || []).some((assignment) => assignment.id === workerId || assignment.roleId === workerId || assignment.label === workerId || assignment.agentId === workerId))
    .slice(0, limit);
  return {
    ok: true,
    fetchedAt: Date.now(),
    missionId: missionId || null,
    workerId: workerId || null,
    reports: missions.map((mission) => ({
      id: `report-${mission.id}`,
      missionId: mission.id,
      title: mission.title,
      state: mission.state,
      phase: mission.phase,
      updatedAt: mission.updatedAt,
      report: buildMissionReport(mission),
      export: buildMissionExport(mission)
    }))
  };
}

async function buildSwarmProjectCompat(ctx, input = {}) {
  const workerId = cleanString(input.workerId || input.worker_id);
  if (!workerId || !isSafeCompatId(workerId)) return { ok: false, error: "workerId required" };
  const overview = await buildOverview(ctx);
  const drilldown = buildWorkerDrilldown(overview, workerId);
  if (!drilldown.ok) {
    return {
      ok: false,
      workerId,
      cwd: null,
      projectName: null,
      branch: null,
      changedFiles: [],
      previewUrls: [],
      packageScripts: [],
      previewSource: "none",
      fetchedAt: Date.now(),
      error: "worker_not_found"
    };
  }
  const project = drilldown.ide?.files?.project || {};
  const previews = Array.isArray(drilldown.ide?.previews) ? drilldown.ide.previews : [];
  return {
    ok: true,
    workerId,
    cwd: cleanString(project.cwd || drilldown.assignment?.cwd) || null,
    projectName: cleanString(project.projectName) || null,
    branch: cleanString(project.branch) || null,
    changedFiles: Array.isArray(project.changedFiles) ? project.changedFiles : [],
    previewUrls: previews.map((preview) => preview.url).filter(Boolean),
    packageScripts: Array.isArray(project.packageScripts) ? project.packageScripts : [],
    packageManager: cleanString(project.packageManager) || null,
    previewSource: previews.length ? "worker-ide" : "none",
    fetchedAt: Date.now(),
    source: "openhanako-worker-ide"
  };
}

async function buildSwarmEnvironmentCompat(ctx) {
  const overview = await buildOverview(ctx);
  const runtime = buildSwarmRuntimeCompat(overview, {});
  return {
    ok: true,
    generatedAt: Date.now(),
    mode: "openhanako-plugin",
    source: "hanaagent",
    plugin: {
      id: ctx.pluginId || "hanaagent",
      dataDir: ctx.dataDir
    },
    capabilities: overview.capabilities || {},
    workspaceRoots: overview.workspaceRoots || [],
    roster: {
      profiles: (overview.operationProfiles || []).map((profile) => ({ id: profile.id, label: profile.label, laneCount: profile.lanes?.length || 0 })),
      workers: runtime.entries.map((entry) => ({ workerId: entry.workerId, role: entry.role, sessionPath: entry.boundary?.sessionPath || "", cwd: entry.cwd || "" }))
    },
    warnings: overview.setupDoctor?.blocking?.concat(overview.setupDoctor?.warnings || []) || []
  };
}

async function buildSwarmLifecycleCompat(ctx, input = {}) {
  const overview = await buildOverview(ctx);
  const workerId = cleanString(input.workerId || input.worker_id);
  const runtime = buildSwarmRuntimeCompat(overview, { workerId });
  const workers = runtime.entries.map((entry) => {
    const drilldown = buildWorkerDrilldown(overview, entry.workerId);
    return {
      workerId: entry.workerId,
      checkedAt: Date.now(),
      state: drilldown.lifecycle?.state || entry.state,
      recommendedAction: drilldown.lifecycle?.recommendedAction || (entry.needsHuman ? "review" : "monitor"),
      sessionPath: entry.boundary?.sessionPath || "",
      lifecycle: drilldown.lifecycle || entry.lifecycle,
      runtime: entry
    };
  });
  return { ok: true, checkedAt: Date.now(), workers };
}

async function handleSwarmLifecycleCompat(ctx, body = {}) {
  const action = cleanString(body.action);
  const workerId = cleanString(body.workerId || body.worker_id);
  if (action === "auto-sweep") {
    const overview = await buildOverview(ctx);
    const runtime = buildSwarmRuntimeCompat(overview, {});
    const workers = [];
    for (const entry of runtime.entries) {
      const drilldown = buildWorkerDrilldown(overview, entry.workerId);
      workers.push({
        workerId: entry.workerId,
        state: drilldown.lifecycle?.state || entry.state,
        recommendedAction: drilldown.lifecycle?.recommendedAction || "monitor",
        actionTaken: "observed"
      });
    }
    return { ok: true, action, sweep: { checkedAt: Date.now(), workers } };
  }
  if (!workerId) return { ok: false, error: "workerId required" };
  if (action === "request-handoff") {
    const overview = await buildOverview(ctx);
    const drilldown = buildWorkerDrilldown(overview, workerId);
    if (!drilldown.ok) return { ok: false, workerId, action, error: "worker_not_found" };
    const lifecycle = buildWorkerLifecycle({
      worker: drilldown.worker,
      assignment: drilldown.assignment,
      sessions: drilldown.sessions,
      checkpoints: drilldown.checkpoints,
      usage: drilldown.usage,
      policy: body.policy
    });
    const prompt = buildHandoffPrompt({ worker: drilldown.worker, assignment: drilldown.assignment, lifecycle });
    const sessionPath = cleanString(body.sessionPath) || lifecycle.sessionPath || drilldown.ide?.identity?.sessionPath || "";
    const sent = await sendSessionMessage(ctx, { sessionPath, text: prompt });
    return { ok: sent.ok, workerId, action, prompt, lifecycle, sessionPath, error: sent.ok ? undefined : sent.error };
  }
  if (action === "renew") {
    const result = await handleSwarmTmuxStartCompat(ctx, { workerId, sessionPath: body.sessionPath });
    return { ok: result.ok, workerId, action, renewed: result.ok, ...result };
  }
  if (action === "notify-handoff-written") {
    const mission = findMissionByWorkerId(ctx.dataDir, workerId, body);
    if (mission) appendMissionEvent(ctx.dataDir, mission.id, {
      type: "swarm_handoff_written",
      label: `已为 ${workerId} 写入交接`,
      meta: { workerId }
    });
    return { ok: true, workerId, action };
  }
  return { ok: false, error: "Unsupported action" };
}

async function handleSwarmTmuxStartCompat(ctx, body = {}) {
  const workerId = cleanString(body.workerId || body.worker_id);
  if (!workerId || !isSafeCompatId(workerId)) return { ok: false, error: "workerId required" };
  const overview = await buildOverview(ctx);
  const drilldown = buildWorkerDrilldown(overview, workerId);
  if (!drilldown.ok) return { ok: false, error: "worker_not_found", workerId };
  const mission = drilldown.assignment?.missionId ? getMission(ctx.dataDir, drilldown.assignment.missionId) : null;
  const existingSessionPath = drilldown.ide?.identity?.sessionPath || drilldown.assignment?.sessionPath || "";
  let session = null;
  if (!existingSessionPath && mission && drilldown.assignment) {
    session = await launchAssignmentWorkerSession(ctx, mission, drilldown.assignment, {
      sessionPath: cleanString(body.sessionPath),
      agentId: cleanString(body.agentId)
    });
  }
  return {
    ok: Boolean(session?.ok || drilldown.ide?.identity?.sessionPath || drilldown.assignment?.sessionPath),
    workerId,
    sessionName: `openhanako-${workerId}`,
    alreadyRunning: Boolean(existingSessionPath),
    started: Boolean(session?.ok),
    tmuxBin: null,
    mode: "openhanako-managed-session",
    note: "HanaAgent 不会直接启动 Hermes tmux；它通过插件能力创建或绑定 OpenHanako 执行智能体会话。",
    sessionPath: session?.sessionPath || existingSessionPath,
    session,
    error: session && !session.ok ? session.error : undefined
  };
}

async function handleSwarmTmuxStopCompat(ctx, body = {}) {
  const workerId = cleanString(body.workerId || body.worker_id);
  if (!workerId || !isSafeCompatId(workerId)) return { ok: false, error: "workerId required" };
  const overview = await buildOverview(ctx);
  const drilldown = buildWorkerDrilldown(overview, workerId);
  if (!drilldown.ok) return { ok: false, error: "worker_not_found", workerId };
  const sessionPath = cleanString(body.sessionPath) || drilldown.ide?.identity?.sessionPath || drilldown.assignment?.sessionPath || "";
  const aborted = sessionPath ? await abortSession(ctx, { sessionPath, reason: cleanString(body.reason) || "Stopped through HanaAgent swarm-tmux-stop compatibility API" }) : { ok: true, skipped: true };
  if (drilldown.assignment?.missionId && drilldown.assignment?.id) {
    const updated = updateMissionAssignment(ctx.dataDir, drilldown.assignment.missionId, drilldown.assignment.id, {
      state: "cancelled",
      blocker: cleanString(body.reason) || "Stopped through HanaAgent swarm-tmux-stop compatibility API"
    });
    if (updated.ok && updated.assignment.taskId) moveTask(ctx.dataDir, updated.assignment.taskId, "done");
  }
  return {
    ok: aborted.ok,
    workerId,
    sessionName: `openhanako-${workerId}`,
    wasRunning: Boolean(sessionPath),
    killed: aborted.ok && Boolean(sessionPath),
    runtimePatched: true,
    mode: "openhanako-managed-session",
    sessionPath,
    abort: aborted,
    error: aborted.ok ? undefined : aborted.error
  };
}

function handleSwarmTmuxScrollCompat(body = {}) {
  const workerId = cleanString(body.workerId || body.worker_id);
  const direction = body.direction === "up" || body.direction === "down" ? body.direction : "";
  const lines = clampRouteNumber(body.lines, 1, 100, 8);
  if (!workerId || !isSafeCompatId(workerId)) return { ok: false, error: "workerId required" };
  if (!direction) return { ok: false, error: "direction must be up or down" };
  return {
    ok: true,
    workerId,
    session: cleanString(body.session) || `openhanako-${workerId}`,
    direction,
    lines,
    mode: "openhanako-managed-session",
    note: "终端滚动由 OpenHanako 的浏览器或会话管理；未执行 tmux 复制模式命令。"
  };
}

async function handleSwarmOrchestratorLoopCompat(ctx, body = {}) {
  const requested = normalizeStringListCompat(body.workerIds || body.worker_ids);
  const dryRun = body.dryRun === true;
  const overview = await buildOverview(ctx);
  const runtime = buildSwarmRuntimeCompat(overview, {});
  const workerIds = requested.length ? requested : runtime.entries.map((entry) => entry.workerId);
  const results = [];
  for (const workerId of workerIds) {
    const drilldown = buildWorkerDrilldown(overview, workerId);
    if (!drilldown.ok) {
      results.push({ workerId, status: "unavailable", checkpoint: null, action: "Worker not found.", runtimePath: "hanaagent://workers", error: "worker_not_found" });
      continue;
    }
    const latest = drilldown.checkpoints?.[0] || null;
    const staleMinutes = clampRouteNumber(body.staleMinutes || body.stale_minutes, 1, 240, 10);
    const lastAt = Date.parse(latest?.createdAt || drilldown.assignment?.updatedAt || drilldown.worker?.updatedAt || "") || 0;
    const stale = !lastAt || Date.now() - lastAt > staleMinutes * 60 * 1000;
    const status = latest ? "checkpointed" : stale ? "stale" : "waiting";
    results.push({
      workerId,
      status,
      checkpoint: latest ? {
        stateLabel: latest.state,
        checkpointStatus: runtimeCheckpointStatusFromState(latest.state),
        result: latest.result,
        blocker: latest.blocker,
        nextAction: latest.nextAction,
        filesChanged: latest.filesChanged || [],
        commandsRun: latest.commandsRun || [],
        raw: latest.rawText || ""
      } : null,
      action: latest
        ? compatLoopActionForCheckpoint(latest)
        : stale
          ? "No recent checkpoint found; orchestrator should re-prompt this worker with the required checkpoint format."
          : "No checkpoint found yet; continue monitoring.",
      runtimePath: "hanaagent://missions"
    });
  }
  const summary = {
    checkpointed: results.filter((item) => item.status === "checkpointed").length,
    stale: results.filter((item) => item.status === "stale").length,
    waiting: results.filter((item) => item.status === "waiting" || item.status === "already_processed").length,
    unavailable: results.filter((item) => item.status === "unavailable").length
  };
  let continuation = null;
  if (body.autoContinue === true && !dryRun) {
    const assignments = results
      .filter((item) => item.status === "stale")
      .map((item) => ({
        workerId: item.workerId,
        task: "You were dispatched a HanaAgent Swarm task but no parseable checkpoint was found. Return ONLY the required checkpoint format now: STATE, FILES_CHANGED, COMMANDS_RUN, RESULT, BLOCKER, NEXT_ACTION.",
        rationale: "Worker was stale or did not return a parseable checkpoint."
      }));
    continuation = assignments.length ? await handleSwarmDispatchRoute(ctx, {
      missionId: cleanString(body.missionId || body.mission_id),
      assignments,
      sessionPath: cleanString(body.sessionPath)
    }) : null;
  }
  return {
    ok: true,
    checkedAt: Date.now(),
    dryRun,
    mode: { mode: "openhanako-plugin", source: "hanaagent" },
    autoContinue: body.autoContinue === true,
    allowExecution: body.allowExecution === true,
    staleMinutes: clampRouteNumber(body.staleMinutes || body.stale_minutes, 1, 240, 10),
    missionId: cleanString(body.missionId || body.mission_id) || null,
    summary,
    results,
    orchestrationPrompt: null,
    continuation
  };
}

function handleSwarmRuntimeResetCompat(ctx, body = {}) {
  const requested = Array.isArray(body.workerIds || body.worker_ids)
    ? normalizeStringListCompat(body.workerIds || body.worker_ids)
    : [];
  const actor = cleanString(body.actor) || "swarm-runtime-reset";
  const reason = cleanString(body.reason) || "Swarm runtime reset from HanaAgent compatibility API";
  const missions = listMissions(ctx.dataDir, { includeArchived: true });
  const assignments = missions.flatMap((mission) => (mission.assignments || []).map((assignment) => ({ mission, assignment })));
  const targets = requested.length
    ? assignments.filter(({ assignment }) => requested.includes(assignment.id) || requested.includes(assignment.roleId) || requested.includes(assignment.label))
    : assignments;
  const results = targets.map(({ mission, assignment }) => {
    const result = updateMissionAssignment(ctx.dataDir, mission.id, assignment.id, {
      state: "queued",
      output: "",
      result: "",
      blocker: "",
      nextAction: reason
    });
    if (result.ok && assignment.taskId) moveTask(ctx.dataDir, assignment.taskId, "backlog");
    return {
      ok: result.ok,
      workerId: assignment.id,
      missionId: mission.id,
      assignmentId: assignment.id,
      runtimePath: "hanaagent://missions",
      error: result.ok ? undefined : result.error
    };
  });
  const resetCount = results.filter((result) => result.ok).length;
  const failureCount = results.length - resetCount;
  return {
    ok: failureCount === 0,
    actor,
    reason,
    workerIds: targets.map(({ assignment }) => assignment.id),
    results,
    resetCount,
    failureCount,
    resetAt: Date.now()
  };
}

function normalizeCompatWorkerHints(workers = []) {
  return (Array.isArray(workers) ? workers : []).map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const id = cleanString(entry.id || entry.workerId || entry.worker_id || entry.name);
    if (!id || id === "workspace") return null;
    return {
      id,
      role: cleanString(entry.role || entry.roleId || entry.role_id),
      model: cleanString(entry.model),
      specialty: cleanString(entry.specialty),
      mission: cleanString(entry.mission),
      skills: normalizeStringListCompat(entry.skills),
      capabilities: normalizeStringListCompat(entry.capabilities),
      notes: cleanString(entry.notes)
    };
  }).filter(Boolean);
}

function buildSwarmDecomposeOrchestratorPrompt({ prompt, workers }) {
  const rosterText = formatSwarmDecomposeRoster(workers);
  return [
    "You are an orchestrator that decomposes a single high-level user prompt into focused sub-tasks routed to the most appropriate worker agents in a parallel Hanaco/Hermes-style swarm.",
    "",
    "Rules:",
    '- Output ONLY valid minified JSON matching this shape: {"assignments":[{"workerId":"swarm1","task":"...","rationale":"..."}],"unassigned":["...optional reasons"]}',
    "- Use only the worker IDs that exist in the provided roster.",
    "- Each task must be a complete, self-contained instruction the worker can execute without additional context.",
    "- Prefer workers whose role, specialty, mission, skills, and capabilities match the task.",
    "- Assign implementation tasks to builder/UI/backend lanes, research to research lanes, review/quality gates to reviewer lanes, PR/issue tasks to PR lanes, and ops/runtime tasks to ops/backend lanes.",
    "- Skip workers that don't fit. Do not pad assignments.",
    "- Never invent worker IDs.",
    "- Keep rationale short (one sentence).",
    "",
    "Available swarm workers:",
    rosterText,
    "",
    "User prompt to decompose:",
    prompt,
    "",
    "Return the JSON now."
  ].join("\n");
}

function formatSwarmDecomposeRoster(workers = []) {
  return (Array.isArray(workers) ? workers : [])
    .map((worker) => {
      const parts = [
        worker.role ? `role=${worker.role}` : "",
        worker.model ? `model=${worker.model}` : "",
        worker.specialty ? `specialty=${worker.specialty}` : "",
        worker.mission ? `mission=${worker.mission}` : "",
        worker.skills?.length ? `skills=${worker.skills.join(",")}` : "",
        worker.capabilities?.length ? `capabilities=${worker.capabilities.join(",")}` : "",
        worker.notes ? `notes=${worker.notes}` : ""
      ].filter(Boolean).join("; ");
      return `- ${worker.id}${parts ? ` - ${parts}` : ""}`;
    })
    .join("\n");
}

function heuristicSwarmAssignments(prompt, workers) {
  const ranked = [...workers]
    .map((worker) => ({ worker, score: scoreCompatWorker(prompt, worker) }))
    .sort((a, b) => b.score - a.score || a.worker.id.localeCompare(b.worker.id));
  const selected = ranked.filter((row) => row.score > 0).slice(0, Math.min(3, workers.length));
  const fallback = selected.length ? selected : ranked.slice(0, Math.min(2, workers.length));
  return {
    assignments: fallback.map(({ worker }) => ({
      workerId: worker.id,
      task: `Handle your lane for this HanaAgent Swarm mission and return the required proof checkpoint. Mission: ${prompt}`,
      rationale: `Deterministic roster match for ${worker.role || worker.id}.`
    })),
    unassigned: selected.length ? [] : ["No confident role match; used deterministic roster fallback."]
  };
}

function scoreCompatWorker(prompt, worker) {
  const text = [worker.id, worker.role, worker.model, worker.specialty, worker.mission, ...(worker.skills || []), ...(worker.capabilities || []), worker.notes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const lower = cleanString(prompt).toLowerCase();
  let score = 0;
  const pairs = [
    [/research|investigate|options|tradeoff|source|synth/i, ["research", "analysis"]],
    [/build|implement|code|patch|ui|frontend|backend|api|fix/i, ["builder", "implementation", "ui", "backend", "runtime"]],
    [/review|test|verify|quality|regression|gate/i, ["reviewer", "review", "pr", "issues"]],
    [/pr|issue|github|repro/i, ["pr", "issues", "github"]],
    [/ops|health|runtime|tmux|gateway|terminal/i, ["ops", "runtime", "backend", "terminal"]],
    [/docs|handoff|spec|readme/i, ["docs", "scribe", "writer"]]
  ];
  for (const [pattern, terms] of pairs) {
    if (!pattern.test(lower)) continue;
    for (const term of terms) if (text.includes(term)) score += 3;
  }
  if (text.includes("swarm-worker-core")) score += 1;
  return score;
}

function taskToSwarmKanbanCard(task = {}) {
  return {
    id: task.id,
    title: task.title,
    spec: task.description || "",
    acceptanceCriteria: (task.tags || []).filter((tag) => tag !== "swarm-kanban"),
    assignedWorker: task.assignee || null,
    reviewer: null,
    status: compatColumnToKanbanStatus(task.column || task.lane),
    missionId: task.missionId || null,
    reportPath: null,
    createdBy: task.createdBy || "hanaagent",
    parents: [],
    idempotencyKey: task.id,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    task
  };
}

function compatKanbanStatusToColumn(value) {
  const status = cleanString(value).toLowerCase();
  if (status === "todo" || status === "ready" || status === "backlog") return "backlog";
  if (status === "running" || status === "in_progress") return "running";
  if (status === "review") return "review";
  if (status === "blocked") return "blocked";
  if (status === "done") return "done";
  return "backlog";
}

function compatColumnToKanbanStatus(value) {
  const column = cleanString(value).toLowerCase();
  if (column === "running" || column === "review" || column === "blocked" || column === "done") return column;
  return "backlog";
}

function compatMemoryKind(value) {
  const kind = cleanString(value).toLowerCase();
  return ["profile", "mission", "episodic", "handoff", "shared"].includes(kind) ? kind : "profile";
}

function compatMemoryEventType(value) {
  const eventType = cleanString(value).toLowerCase();
  return ["mission-start", "dispatch", "checkpoint", "handoff-requested", "handoff-written", "resume", "blocked", "complete", "note"].includes(eventType) ? eventType : "note";
}

function compatLoopActionForCheckpoint(checkpoint = {}) {
  const state = String(checkpoint.state || "").toUpperCase();
  if (state === "DONE") return "Worker completed its assigned task. Orchestrator should route review or next dependent task.";
  if (state === "BLOCKED") return "Worker is blocked. Orchestrator should reroute, supply missing context, or escalate.";
  if (state === "NEEDS_INPUT") return "Worker needs input. Orchestrator should answer if possible, otherwise ask the user.";
  if (state === "HANDOFF") return "Worker handed off context. Orchestrator should pass handoff to the next lane.";
  return "Worker is still active. Orchestrator should monitor for staleness.";
}

function isSafeCompatId(value) {
  return /^[a-z0-9][a-z0-9_-]{0,127}$/i.test(cleanString(value));
}

function runtimeStateFromAssignment(value) {
  const state = cleanString(value).toLowerCase();
  if (state === "done") return "idle";
  if (state === "blocked") return "blocked";
  if (state === "review") return "reviewing";
  if (state === "running" || state === "checkpointed") return "executing";
  if (state === "cancelled") return "offline";
  return "waiting";
}

function runtimeCheckpointStatusFromState(value) {
  const state = cleanString(value).toLowerCase();
  if (state === "done" || state === "done") return "done";
  if (state === "blocked" || state === "needs_input") return "blocked";
  if (state === "review" || state === "needs_review") return "handoff";
  if (state === "running" || state === "checkpointed" || state === "in_progress") return "in_progress";
  return "none";
}

async function handleHermesConductorSpawnCompat(ctx, body = {}) {
  const goal = cleanString(body.goal || body.prompt || body.mission);
  if (!goal) return { ok: false, error: "goal_required" };
  const result = createMission(ctx.dataDir, {
    goal,
    title: cleanString(body.name || body.title) || `Conductor: ${goal.slice(0, 60)}`,
    mode: cleanString(body.mode) || "conductor",
    sessionPath: cleanString(body.sessionPath || body.sessionKey),
    agentId: cleanString(body.agentId),
    maxWorkers: body.maxParallel || body.maxWorkers || 1,
    createdBy: "hermes-conductor-spawn",
    notes: cleanString(body.notes || body.instructions),
    supervised: body.supervised === true
  });
  if (!result.ok) return result;
  const taskResults = createMissionTasks(ctx, result.mission, "hermes-conductor-spawn");
  const mission = getMission(ctx.dataDir, result.mission.id) || result.mission;
  let dispatch = null;
  if (body.dispatch !== false) {
    dispatch = [];
    for (const assignment of mission.assignments || []) {
      dispatch.push(await dispatchAssignmentForMission(ctx, mission, assignment, {
        sessionPath: cleanString(body.sessionPath || body.sessionKey) || assignment.sessionPath || mission.sessionPath
      }));
    }
  }
  return {
    ok: true,
    mode: "native-swarm",
    note: "HanaAgent maps Hermes conductor-spawn to OpenHanako-safe Mission + assignment dispatch.",
    missionId: mission.id,
    id: mission.id,
    name: mission.title,
    sessionKey: mission.sessionPath || "",
    mission,
    tasks: taskResults.map((item) => item.task),
    dispatch
  };
}

async function handleHermesConductorStopCompat(ctx, body = {}) {
  const missionIds = Array.isArray(body.missionIds) ? body.missionIds.map(cleanString).filter(Boolean) : [cleanString(body.missionId)].filter(Boolean);
  const sessionPaths = Array.isArray(body.sessionKeys) ? body.sessionKeys.map(cleanString).filter(Boolean) : [cleanString(body.sessionPath || body.sessionKey)].filter(Boolean);
  let stoppedMissions = 0;
  let cancelledNativeMissions = 0;
  const results = [];
  for (const missionId of missionIds) {
    const result = stopMission(ctx.dataDir, missionId, { reason: cleanString(body.reason) || "Conductor mission stopped by user" });
    results.push(result);
    if (result.ok) {
      stoppedMissions += 1;
      cancelledNativeMissions += 1;
      await syncMissionHostTasks(ctx, result.mission, "cancelled", { reason: cleanString(body.reason) || "conductor-stop" });
    }
  }
  const aborts = [];
  for (const sessionPath of sessionPaths) aborts.push(await abortSession(ctx, { sessionPath }));
  return {
    ok: true,
    deleted: aborts.filter((item) => item.ok).length,
    stoppedMissions,
    cancelledNativeMissions,
    results,
    aborts
  };
}


export function registerSwarmRoutes(app, ctx, deps) {
  buildOverview = deps.buildOverview
  buildWorkerDrilldown = deps.buildWorkerDrilldown
  dispatchAssignmentForMission = deps.dispatchAssignmentForMission
  createMissionTasks = deps.createMissionTasks
  syncAssignmentHostTask = deps.syncAssignmentHostTask
  syncMissionHostTasks = deps.syncMissionHostTasks
  launchAssignmentWorkerSession = deps.launchAssignmentWorkerSession
  assignmentStateToColumn = deps.assignmentStateToColumn


  app.get("/api/mission-roles", (c) => {
    return c.json({ ok: true, roles: getMissionRoles() });
  });

  app.get("/api/swarm-roster", (c) => {
    const profileId = cleanString(c.req.query("profileId") || c.req.query("profile") || c.req.query("id") || "swarm-roster");
    const profile = getOperationProfile(ctx.dataDir, profileId)
      || listOperationProfiles(ctx.dataDir).find((item) => item.lanes?.some((lane) => lane.acceptsBroadcast === true || lane.skills?.length || lane.tools?.length))
      || getOperationProfile(ctx.dataDir, "builder");
    const roster = profile ? profileToSwarmRoster(profile) : { version: 1, metadata: { schema: "hanaagent.swarmRoster", source: "hanaagent" }, workers: [] };
    return c.json({
      ok: true,
      path: "hanaagent://operation-profiles",
      profile,
      roster,
      fetchedAt: Date.now()
    });
  });

  app.post("/api/swarm-roster", async (c) => {
    const body = await readJson(c);
    const result = upsertSwarmRosterWorkerProfile(ctx.dataDir, body);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.post("/api/swarm-dispatch", async (c) => {
    const result = await handleSwarmDispatchRoute(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : result.error === "assignment_not_found" || result.error === "mission_not_found" ? 404 : 422);
  });

  app.get("/api/swarm-missions", (c) => {
    const id = cleanString(c.req.query("id") || c.req.query("missionId"));
    const limit = clampRouteNumber(c.req.query("limit"), 1, 100, 20);
    const mission = id ? getMission(ctx.dataDir, id) : null;
    const missions = id ? [] : listMissions(ctx.dataDir, { includeArchived: c.req.query("includeArchived") === "true" }).slice(0, limit);
    const reports = (id && mission ? [mission] : missions).map((item) => ({
      missionId: item.id,
      title: item.title,
      state: item.state,
      updatedAt: item.updatedAt,
      report: buildMissionReport(item)
    }));
    return c.json({
      ok: true,
      path: "hanaagent://missions",
      mission,
      missions,
      reports,
      fetchedAt: Date.now()
    }, id && !mission ? 404 : 200);
  });

  app.post("/api/swarm-missions", async (c) => {
    const body = await readJson(c);
    const action = cleanString(body.action);
    if (action !== "cancel") return c.json({ ok: false, error: "Unsupported action" }, 400);
    const missionId = cleanString(body.missionId);
    if (!missionId) return c.json({ ok: false, error: "missionId required" }, 400);
    const mission = getMission(ctx.dataDir, missionId);
    if (!mission) return c.json({ ok: false, error: "Mission or assignment not found" }, 404);
    const assignmentId = cleanString(body.assignmentId);
    const workerId = cleanString(body.workerId);
    let result;
    if (assignmentId || workerId) {
      const assignment = mission.assignments.find((item) => item.id === assignmentId || item.id === workerId || item.roleId === workerId || item.label === workerId);
      if (!assignment) return c.json({ ok: false, error: "Mission or assignment not found" }, 404);
      result = updateMissionAssignment(ctx.dataDir, mission.id, assignment.id, {
        state: "cancelled",
        blocker: cleanString(body.reason) || "由 HanaAgent 智能体群组兼容 API 取消"
      });
      if (result.ok && result.assignment.taskId) moveTask(ctx.dataDir, result.assignment.taskId, "done");
      if (result.ok) {
        result.hostTaskUpdate = await syncAssignmentHostTask(ctx, result.mission, result.assignment, "cancelled", {
          reason: cleanString(body.reason) || "cancelled"
        });
      }
      return c.json({ ok: result.ok, action, result, cancelledAt: Date.now() }, result.ok ? 200 : 404);
    }
    result = stopMission(ctx.dataDir, mission.id, { reason: cleanString(body.reason) || "由 HanaAgent 智能体群组兼容 API 取消" });
    if (result.ok) {
      result.hostTaskUpdates = await syncMissionHostTasks(ctx, result.mission, "cancelled", {
        reason: cleanString(body.reason) || "cancelled"
      });
    }
    return c.json({ ok: result.ok, action, result, cancelledAt: Date.now() }, result.ok ? 200 : 404);
  });

  app.post("/api/swarm-checkpoint", async (c) => {
    const result = await handleSwarmCheckpointRoute(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/swarm-runtime", async (c) => {
    const overview = await buildOverview(ctx);
    const result = buildSwarmRuntimeCompat(overview, {
      workerId: c.req.query("workerId") || "",
      limit: c.req.query("limit") || ""
    });
    return c.json(result);
  });

  app.get("/api/swarm-health", async (c) => {
    const overview = await buildOverview(ctx);
    const result = buildSwarmHealthCompat(overview, {
      workerId: c.req.query("workerId") || ""
    });
    return c.json(result);
  });

  app.get("/api/swarm-chat", async (c) => {
    const workerId = cleanString(c.req.query("workerId") || c.req.query("worker"));
    if (!workerId) return c.json({ ok: false, error: "workerId required" }, 400);
    const overview = await buildOverview(ctx);
    const drilldown = buildWorkerDrilldown(overview, workerId);
    if (!drilldown.ok) return c.json({ ok: false, error: "worker_not_found", workerId, messages: [], source: "unavailable", fetchedAt: Date.now() }, 404);
    const limit = clampRouteNumber(c.req.query("limit"), 1, 100, 30);
    const sessionPath = cleanString(c.req.query("sessionPath")) || drilldown.ide?.identity?.sessionPath || drilldown.assignment?.sessionPath || drilldown.sessions?.[0]?.path || "";
    if (!sessionPath) {
      return c.json({
        ok: true,
        workerId,
        sessionId: null,
        sessionTitle: null,
        messages: [],
        source: "unavailable",
        fetchedAt: Date.now(),
        error: "sessionPath_required"
      });
    }
    const history = await getSessionHistory(ctx, { sessionPath, limit });
    return c.json({
      ok: history.ok,
      workerId,
      sessionId: sessionPath,
      sessionTitle: drilldown.sessions?.find((item) => item.path === sessionPath)?.title || drilldown.worker?.name || drilldown.assignment?.label || workerId,
      messages: Array.isArray(history.messages) ? history.messages.slice(-limit) : [],
      source: history.ok ? "session:history" : "unavailable",
      fetchedAt: Date.now(),
      error: history.ok ? undefined : history.error,
      toolTrace: history.toolTrace || null
    }, history.ok ? 200 : 503);
  });

  app.post("/api/swarm-direct-chat", async (c) => {
    const result = await handleSwarmDirectChatCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : result.error === "Invalid workerId" || result.error === "Missing prompt" ? 400 : 503);
  });

  app.post("/api/swarm-decompose", async (c) => {
    const result = await handleSwarmDecomposeCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : 400);
  });

  app.get("/api/swarm-kanban", (c) => {
    return c.json(buildSwarmKanbanCompat(ctx));
  });

  app.post("/api/swarm-kanban", async (c) => {
    const result = createSwarmKanbanCardCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : 400);
  });

  app.patch("/api/swarm-kanban", async (c) => {
    const result = updateSwarmKanbanCardCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : result.error === "Card not found" ? 404 : 400);
  });

  app.get("/api/swarm-memory", async (c) => {
    const result = await readSwarmMemoryCompat(ctx, {
      workerId: c.req.query("workerId") || "",
      kind: c.req.query("kind") || "",
      missionId: c.req.query("missionId") || "",
      date: c.req.query("date") || "",
      limit: c.req.query("limit") || ""
    });
    return c.json(result, result.ok ? 200 : 400);
  });

  app.get("/api/swarm-memory/search", async (c) => {
    const result = await readSwarmMemoryCompat(ctx, {
      workerId: c.req.query("workerId") || "",
      kind: c.req.query("kind") || "",
      missionId: c.req.query("missionId") || "",
      query: c.req.query("query") || c.req.query("q") || "",
      limit: c.req.query("limit") || ""
    });
    return c.json({
      ok: result.ok,
      query: c.req.query("query") || c.req.query("q") || "",
      results: result.entries || result.memories || [],
      entries: result.entries || result.memories || [],
      source: result.source || "hanaagent-swarm-memory",
      error: result.error
    }, result.ok ? 200 : 400);
  });

  app.post("/api/swarm-memory", async (c) => {
    const result = writeSwarmMemoryCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : 400);
  });

  app.get("/api/swarm-reports", (c) => {
    return c.json(buildSwarmReportsCompat(ctx, {
      missionId: c.req.query("missionId") || "",
      workerId: c.req.query("workerId") || "",
      limit: c.req.query("limit") || ""
    }));
  });

  app.get("/api/swarm-project", async (c) => {
    const result = await buildSwarmProjectCompat(ctx, {
      workerId: c.req.query("workerId") || ""
    });
    return c.json(result, result.ok === false ? 400 : 200);
  });

  app.get("/api/swarm-environment", async (c) => {
    return c.json(await buildSwarmEnvironmentCompat(ctx));
  });

  app.get("/api/swarm-lifecycle", async (c) => {
    const result = await buildSwarmLifecycleCompat(ctx, {
      workerId: c.req.query("workerId") || ""
    });
    return c.json(result);
  });

  app.post("/api/swarm-lifecycle", async (c) => {
    const result = await handleSwarmLifecycleCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : result.error === "workerId required" || result.error === "Unsupported action" ? 400 : 503);
  });

  app.post("/api/swarm-tmux-start", async (c) => {
    const result = await handleSwarmTmuxStartCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : result.error === "workerId required" ? 400 : 503);
  });

  app.post("/api/swarm-tmux-stop", async (c) => {
    const result = await handleSwarmTmuxStopCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : result.error === "workerId required" ? 400 : 503);
  });

  app.post("/api/swarm-tmux-scroll", async (c) => {
    const result = handleSwarmTmuxScrollCompat(await readJson(c));
    return c.json(result, result.ok ? 200 : result.error === "workerId required" || result.error === "direction must be up or down" ? 400 : 503);
  });

  app.post("/api/swarm-orchestrator-loop", async (c) => {
    const result = await handleSwarmOrchestratorLoopCompat(ctx, await readJson(c));
    return c.json(result);
  });

  app.post("/api/swarm-runtime/reset", async (c) => {
    const result = handleSwarmRuntimeResetCompat(ctx, await readJson(c));
    return c.json(result, result.failureCount > 0 ? 207 : 200);
  });

  app.post("/api/conductor-spawn", async (c) => {
    const result = await handleHermesConductorSpawnCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : 422);
  });

  app.post("/api/conductor-stop", async (c) => {
    const result = await handleHermesConductorStopCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : 422);
  });
}
