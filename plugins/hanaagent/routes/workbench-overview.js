import {
  getWorkbenchState,
  listUsage,
  getAgentConfig,
  listAgentSkills,
  listHostCheckpoints,
  listMemoryEntries,
  listHostTasks,
  listDeferredTasks,
  getBlueprint
} from "../lib/hanaagent-core.js"
import {
  listTasks
} from "../lib/task-store.js"
import {
  listCheckpoints,
  listCheckpointConflicts
} from "../lib/checkpoint-store.js"
import {
  listRunRecords,
  summarizeRunRecords,
  updateRunRecord
} from "../lib/run-store.js"
import {
  buildMissionInbox
} from "../lib/mission-inbox.js"
import {
  buildIntegrationCatalog
} from "../lib/integration-catalog.js"
import {
  listWorkspaceRoots
} from "../lib/workspace-files.js"
import {
  listAutopilotRuns,
  latestAutopilotRun,
  getAutopilotLoopState
} from "../lib/autopilot-store.js"
import {
  getAutopilotScheduleConfig
} from "../lib/autopilot-scheduler.js"
import {
  listHandoffs
} from "../lib/handoff-store.js"
import {
  listLocalMemory
} from "../lib/memory-store.js"
import {
  listOperationProfiles,
  buildOperationsOverview
} from "../lib/operations-profile.js"
import {
  listJobs
} from "../lib/job-store.js"
import {
  listMissions,
  appendMissionEvent
} from "../lib/mission-store.js"
import {
  buildWorkerIdeSnapshot
} from "../lib/worker-ide.js"
import {
  buildWorkerLifecycle
} from "../lib/worker-lifecycle.js"
import {
  activityTimestamp,
  buildSetupDoctor,
  clampRouteNumber,
  cleanString,
  computeHostGaps,
  firstCompatLine,
  overviewMissionItems
} from "./workbench-utils.js"

export async function buildOverview(ctx) {
  const incidents = [];
  const state = await getWorkbenchState(ctx);
  let tasks = [];
  let checkpoints = [];
  let missions = [];
  let usage = null;
  let hostCheckpoints = [];
  let agentProfiles = [];
  let agentSkills = [];
  let memoryEntries = [];
  let handoffs = [];
  let integrations = null;
  let runRecords = [];
  let inbox = null;
  let workspaceRoots = [];
  let autopilotRuns = [];
  let autopilot = null;
  let jobs = [];
  let operationProfiles = [];
  let hostTasks = [];
  let deferredTasks = [];
  try {
    tasks = listTasks(ctx.dataDir, { includeDone: true });
  } catch (error) {
    incidents.push({
      id: "task-store",
      severity: "error",
      source: "tasks",
      label: "Task store unavailable",
      detail: error?.message || String(error)
    });
  }
  try {
    checkpoints = listCheckpoints(ctx.dataDir);
  } catch (error) {
    incidents.push({
      id: "checkpoint-store",
      severity: "error",
      source: "checkpoints",
      label: "Checkpoint store unavailable",
      detail: error?.message || String(error)
    });
  }
  try {
    missions = listMissions(ctx.dataDir);
  } catch (error) {
    incidents.push({
      id: "mission-store",
      severity: "error",
      source: "missions",
      label: "Mission store unavailable",
      detail: error?.message || String(error)
    });
  }
  try {
    usage = await listUsage(ctx, { limit: 80 });
    if (!usage.ok) {
      incidents.push({
        id: "usage-ledger",
        severity: "warn",
        source: "usage",
        label: "Usage ledger unavailable",
        detail: usage.error
      });
    }
  } catch (error) {
    incidents.push({
      id: "usage-ledger",
      severity: "warn",
      source: "usage",
      label: "Usage ledger unavailable",
      detail: error?.message || String(error)
    });
  }
  try {
    const hostCheckpointResult = await listHostCheckpoints(ctx, {});
    hostCheckpoints = hostCheckpointResult.checkpoints || [];
    if (!hostCheckpointResult.ok) {
      incidents.push({
        id: "host-checkpoints",
        severity: "warn",
        source: "checkpoint",
        label: "Host checkpoints unavailable",
        detail: hostCheckpointResult.error
      });
    }
  } catch (error) {
    incidents.push({
      id: "host-checkpoints",
      severity: "warn",
      source: "checkpoint",
      label: "Host checkpoints unavailable",
      detail: error?.message || String(error)
    });
  }
  try {
    if (state.capabilities?.agentConfig) {
      const profiles = await Promise.all((state.agents || []).slice(0, 8).map((agent) => getAgentConfig(ctx, { agentId: agent.id })));
      agentProfiles = profiles.filter((profile) => profile.ok);
    }
  } catch (error) {
    incidents.push({
      id: "agent-profile",
      severity: "warn",
      source: "agent",
      label: "Agent profile unavailable",
      detail: error?.message || String(error)
    });
  }
  try {
    if (state.capabilities?.agentSkills) {
      const skills = await Promise.all((state.agents || []).slice(0, 8).map((agent) => listAgentSkills(ctx, { agentId: agent.id })));
      agentSkills = skills.filter((entry) => entry.ok);
    }
  } catch (error) {
    incidents.push({
      id: "agent-skills",
      severity: "warn",
      source: "agent",
      label: "Agent skills unavailable",
      detail: error?.message || String(error)
    });
  }
  try {
    handoffs = listHandoffs(ctx.dataDir, { limit: 80 }).handoffs || [];
    const localMemory = listLocalMemory(ctx.dataDir, { limit: 40 }).entries || [];
    if (state.capabilities?.memoryList) {
      const memoryResult = await listMemoryEntries(ctx, { limit: 40 });
      memoryEntries = [...handoffs, ...localMemory, ...(memoryResult.entries || [])];
      if (!memoryResult.ok) {
        incidents.push({
          id: "memory-list",
          severity: "warn",
          source: "memory",
          label: "Memory browser unavailable",
          detail: memoryResult.error
        });
      }
    } else {
      memoryEntries = [...handoffs, ...localMemory];
    }
  } catch (error) {
    incidents.push({
      id: "memory-list",
      severity: "warn",
      source: "memory",
      label: "Memory browser unavailable",
      detail: error?.message || String(error)
    });
  }
  try {
    integrations = await buildIntegrationCatalog(ctx, { agentId: state.config?.defaultAgentId || "" });
  } catch (error) {
    incidents.push({
      id: "integration-catalog",
      severity: "warn",
      source: "integrations",
      label: "Integration catalog unavailable",
      detail: error?.message || String(error)
    });
  }
  try {
    runRecords = listRunRecords(ctx.dataDir);
  } catch (error) {
    incidents.push({
      id: "run-records",
      severity: "error",
      source: "run",
      label: "Run console records unavailable",
      detail: error?.message || String(error)
    });
  }
  try {
    inbox = buildMissionInbox({ missions, tasks, checkpoints, runRecords });
  } catch (error) {
    incidents.push({
      id: "mission-inbox",
      severity: "error",
      source: "inbox",
      label: "Mission inbox unavailable",
      detail: error?.message || String(error)
    });
  }
  try {
    workspaceRoots = listWorkspaceRoots(ctx).roots || [];
  } catch (error) {
    incidents.push({
      id: "workspace-files",
      severity: "warn",
      source: "files",
      label: "Workspace files unavailable",
      detail: error?.message || String(error)
    });
  }
  try {
    autopilotRuns = listAutopilotRuns(ctx.dataDir);
    autopilot = latestAutopilotRun(ctx.dataDir);
  } catch (error) {
    incidents.push({
      id: "autopilot-store",
      severity: "error",
      source: "autopilot",
      label: "Autopilot records unavailable",
      detail: error?.message || String(error)
    });
  }
  try {
    jobs = listJobs(ctx.dataDir);
  } catch (error) {
    incidents.push({
      id: "job-store",
      severity: "error",
      source: "jobs",
      label: "Jobs store unavailable",
      detail: error?.message || String(error)
    });
  }
  try {
    operationProfiles = listOperationProfiles(ctx.dataDir);
  } catch (error) {
    incidents.push({
      id: "operation-profiles",
      severity: "error",
      source: "operations",
      label: "Operations profiles unavailable",
      detail: error?.message || String(error)
    });
  }
  try {
    const hostTaskResult = await listHostTasks(ctx, { pluginId: ctx.pluginId || "hanaagent" });
    hostTasks = hostTaskResult.tasks || [];
    if (!hostTaskResult.ok) {
      incidents.push({
        id: "host-tasks",
        severity: "warn",
        source: "task",
        label: "Host task runtime unavailable",
        detail: hostTaskResult.error
      });
    }
  } catch (error) {
    incidents.push({
      id: "host-tasks",
      severity: "warn",
      source: "task",
      label: "Host task runtime unavailable",
      detail: error?.message || String(error)
    });
  }
  try {
    const deferredResult = await listDeferredTasks(ctx, {});
    deferredTasks = deferredResult.pending || [];
    if (!deferredResult.ok) {
      incidents.push({
        id: "deferred-tasks",
        severity: "warn",
        source: "deferred",
        label: "Deferred task runtime unavailable",
        detail: deferredResult.error
      });
    }
  } catch (error) {
    incidents.push({
      id: "deferred-tasks",
      severity: "warn",
      source: "deferred",
      label: "Deferred task runtime unavailable",
      detail: error?.message || String(error)
    });
  }

  for (const error of state.capabilities?.errors || []) {
    incidents.push({
      id: `capability-${error}`,
      severity: "warn",
      source: "capability",
      label: "Hana bus capability degraded",
      detail: error
    });
  }

  const taskCounts = countTasks(tasks);
  const checkpointCounts = countCheckpoints(checkpoints);
  const checkpointConflicts = listCheckpointConflicts(ctx.dataDir);
  const missionCounts = countMissions(missions);
  const workerCards = buildWorkerCards(state.agents, state.sessions, tasks, checkpoints, missions);
  const usageAttribution = buildUsageAttribution(usage?.entries || [], { missions, tasks, sessions: state.sessions });
  const hostGaps = computeHostGaps(state.capabilities || {});
  const autopilotSchedule = getAutopilotScheduleConfig(ctx);
  const autopilotStatus = ctx._hanaagentAutopilot?.status?.() || null;
  const autopilotLoop = getAutopilotLoopState(ctx.dataDir);
  const jobSchedulerStatus = ctx._hanaagentJobs?.status?.() || null;
  const operations = buildOperationsOverview({
    capabilities: state.capabilities || {},
    agents: state.agents,
    sessions: state.sessions,
    workerCards,
    hostTasks,
    deferredTasks,
    inbox,
    autopilotSchedule,
    profiles: operationProfiles
  });
  const setupDoctor = buildSetupDoctor({
    state,
    agentProfiles,
    workspaceRoots,
    incidents,
    hostGaps,
    operations,
    integrations
  });
  const activeMission = missions.find((mission) => ["preview", "active"].includes(mission.phase)) || missions.find((mission) => ["active", "blocked", "planning", "paused"].includes(mission.state)) || missions[0] || null;
  const swarmActivity = buildSwarmActivity({ tasks, checkpoints, runRecords, missions, workerCards, jobs }, { limit: 80 });
  const agentOutputs = buildAgentOutputs({ tasks, checkpoints, runRecords, missions, workerCards, jobs, sessions: state.sessions }, { limit: 80 });
  const workerArtifacts = buildWorkerArtifacts({ tasks, checkpoints, runRecords, missions, workerCards, jobs, sessions: state.sessions, workspaceRoots }, { limit: 80 });
  const approvals = buildApprovalQueue(ctx, { limit: 80 });
  return {
    ...state,
    ok: Boolean(state.ok || tasks.length >= 0),
    overview: {
      generatedAt: new Date().toISOString(),
      sections: {
        capabilities: state.capabilities || null,
        agents: { total: state.agents.length, items: state.agents },
        sessions: { total: state.sessions.length, items: state.sessions },
        tasks: { total: tasks.length, byColumn: taskCounts, items: tasks },
        checkpoints: { total: checkpoints.length, byState: checkpointCounts, items: checkpoints, conflicts: checkpointConflicts },
        hostCheckpoints: { total: hostCheckpoints.length, items: hostCheckpoints },
        usage: { ...(usage || { ok: false, entries: [], summary: { count: 0, totalTokens: 0, costUsd: 0 } }), attribution: usageAttribution },
        agentProfiles: { total: agentProfiles.length, items: agentProfiles },
        agentSkills: { total: agentSkills.reduce((sum, entry) => sum + (entry.skills || []).length, 0), items: agentSkills },
        memory: { total: memoryEntries.length, items: memoryEntries },
        handoffs: { total: handoffs.length, items: handoffs },
        integrations: integrations || { ok: false, items: [], health: { total: 0 } },
        workspaceFiles: { roots: workspaceRoots.length, items: workspaceRoots },
        runRecords: { total: runRecords.length, summary: summarizeRunRecords(runRecords), items: runRecords },
        agentOutputs: { total: agentOutputs.outputs.length, summary: agentOutputs.summary, items: agentOutputs.outputs, availableFilters: agentOutputs.availableFilters },
        swarmActivity: { total: swarmActivity.items.length, summary: swarmActivity.summary, items: swarmActivity.items },
        workerArtifacts: { total: workerArtifacts.items.length, summary: workerArtifacts.summary, items: workerArtifacts.items },
        approvals: { total: approvals.approvals.length, summary: approvals.summary, pending: approvals.pending, history: approvals.history, items: approvals.approvals },
        inbox: inbox || { ok: false, items: [], summary: { total: 0 } },
        autopilot: { total: autopilotRuns.length, latest: autopilot, items: autopilotRuns, schedule: autopilotSchedule, status: autopilotStatus, loop: autopilotLoop },
        jobs: { total: jobs.length, items: jobs, enabled: jobs.filter((job) => job.status === "enabled").length, paused: jobs.filter((job) => job.status === "paused").length, scheduler: jobSchedulerStatus },
        operations,
        setupDoctor,
        operationProfiles: { total: operationProfiles.length, items: operationProfiles },
        hostTasks: { total: hostTasks.length, items: hostTasks },
        deferredTasks: { total: deferredTasks.length, items: deferredTasks },
        missions: { total: missions.length, byState: missionCounts, active: activeMission, items: missions },
        workers: { total: workerCards.length, items: workerCards },
        hostGaps,
        blueprint: state.blueprint || getBlueprint()
      },
      incidents
    },
    tasks,
    checkpoints,
    checkpointConflicts,
    hostCheckpoints,
    usage,
    usageAttribution,
    agentProfiles,
    agentSkills,
    memoryEntries,
    handoffs,
    integrations,
    workspaceRoots,
    runRecords,
    runRecordSummary: summarizeRunRecords(runRecords),
    agentOutputs,
    swarmActivity,
    workerArtifacts,
    approvals,
    inbox,
    inboxSummary: inbox?.summary || null,
    autopilot,
    autopilotRuns,
    autopilotSchedule,
    autopilotStatus,
    autopilotLoop,
    jobs,
    jobScheduler: jobSchedulerStatus,
    operations,
    setupDoctor,
    operationProfiles,
    hostTasks,
    deferredTasks,
    missions,
    activeMission,
    workerCards,
    capabilities: {
      ...state.capabilities,
      taskStore: incidents.every((item) => item.id !== "task-store"),
      checkpointStore: incidents.every((item) => item.id !== "checkpoint-store"),
      missionStore: incidents.every((item) => item.id !== "mission-store"),
      missionPhases: true,
      missionControls: true,
      checkpointInbox: true,
      missionInbox: incidents.every((item) => item.id !== "mission-inbox"),
      toolTrace: true,
      liveSessionEvents: typeof ctx?.bus?.subscribe === "function",
      reviewGate: incidents.every((item) => !["task-store", "checkpoint-store", "mission-store", "run-records"].includes(item.id)),
      hostCheckpoints: Boolean(state.capabilities?.checkpointList || state.capabilities?.checkpointFindBySessionSince),
      usageLedger: Boolean(state.capabilities?.usageList),
      agentProfile: Boolean(state.capabilities?.agentConfig),
      agentSkills: Boolean(state.capabilities?.agentSkills),
      memoryReadonly: Boolean(state.capabilities?.memoryList),
      memoryEditable: true,
      durableHandoffs: true,
      integrationCatalog: incidents.every((item) => item.id !== "integration-catalog"),
      globalSearch: true,
      workspaceFiles: incidents.every((item) => item.id !== "workspace-files"),
      runRecords: incidents.every((item) => item.id !== "run-records"),
      agentOutputs: incidents.every((item) => !["run-records", "job-store"].includes(item.id)),
      swarmActivity: true,
      workerArtifacts: incidents.every((item) => item.id !== "run-records"),
      approvals: incidents.every((item) => item.id !== "run-records"),
      autopilot: incidents.every((item) => item.id !== "autopilot-store"),
      autopilotScheduler: true,
      jobs: incidents.every((item) => item.id !== "job-store"),
      operationsProfiles: incidents.every((item) => item.id !== "operation-profiles"),
      hostTaskRuntime: Boolean(state.capabilities?.taskList || state.capabilities?.taskRegister || state.capabilities?.taskUpdate),
      deferredTaskRuntime: Boolean(state.capabilities?.deferredListPending || state.capabilities?.deferredRegister || state.capabilities?.deferredQuery),
      workerCards: true,
      workerDrilldown: true,
      workerIde: true,
      terminal: Boolean(state.capabilities?.terminalList || state.capabilities?.terminalStart || state.capabilities?.terminalRead || state.capabilities?.terminalWrite || state.capabilities?.terminalClose),
      conductor: true,
      overview: true
    }
  };
}

function countTasks(tasks) {
  const counts = { backlog: 0, running: 0, review: 0, blocked: 0, done: 0 };
  for (const task of tasks) {
    const column = task.column || task.lane || "backlog";
    counts[column] = (counts[column] || 0) + 1;
  }
  return counts;
}

function countCheckpoints(checkpoints) {
  const counts = { DONE: 0, BLOCKED: 0, NEEDS_INPUT: 0, HANDOFF: 0, IN_PROGRESS: 0, NEEDS_REVIEW: 0 };
  for (const checkpoint of checkpoints) counts[checkpoint.state] = (counts[checkpoint.state] || 0) + 1;
  return counts;
}

export function assignmentStateToColumn(state) {
  const normalized = String(state || "").toLowerCase();
  if (normalized === "done" || normalized === "cancelled") return "done";
  if (normalized === "blocked") return "blocked";
  if (normalized === "review" || normalized === "checkpointed") return "review";
  if (normalized === "running") return "running";
  return "backlog";
}

function countMissions(missions) {
  const counts = { draft: 0, planning: 0, active: 0, paused: 0, complete: 0, cancelled: 0, blocked: 0 };
  for (const mission of missions) counts[mission.state] = (counts[mission.state] || 0) + 1;
  return counts;
}

function buildUsageAttribution(entries = [], context = {}) {
  const usageEntries = Array.isArray(entries) ? entries : [];
  const missions = Array.isArray(context.missions) ? context.missions : [];
  const tasks = Array.isArray(context.tasks) ? context.tasks : [];
  const sessions = Array.isArray(context.sessions) ? context.sessions : [];
  const missionBuckets = new Map();
  const assignmentBuckets = new Map();
  const sessionBuckets = new Map();

  for (const entry of usageEntries) {
    const sessionPath = cleanString(entry.sessionPath);
    const agentId = cleanString(entry.agentId);
    const matchedSessions = sessions.filter((session) => sessionPath && (session.path === sessionPath || session.sessionPath === sessionPath));
    if (sessionPath) addUsageBucket(sessionBuckets, sessionPath, {
      id: sessionPath,
      label: matchedSessions[0]?.title || sessionPath.split("/").pop() || sessionPath,
      kind: "session",
      sessionPath
    }, entry);

    const matchedTasks = tasks.filter((task) => {
      return (sessionPath && task.sessionPath === sessionPath)
        || (agentId && task.assignee === agentId)
        || (entry.taskId && (task.id === entry.taskId || task.taskId === entry.taskId));
    });
    for (const task of matchedTasks) {
      if (task.missionId) {
        const mission = missions.find((item) => item.id === task.missionId) || {};
        addUsageBucket(missionBuckets, task.missionId, {
          id: task.missionId,
          label: mission.title || task.missionId,
          kind: "mission",
          missionId: task.missionId
        }, entry);
      }
      if (task.assignmentId) {
        const assignment = findMissionAssignment(missions, task.assignmentId) || {};
        addUsageBucket(assignmentBuckets, task.assignmentId, {
          id: task.assignmentId,
          label: assignment.label || task.title || task.assignmentId,
          kind: "assignment",
          assignmentId: task.assignmentId,
          missionId: task.missionId || assignment.missionId || ""
        }, entry);
      }
    }

    for (const mission of missions) {
      const assignments = Array.isArray(mission.assignments) ? mission.assignments : [];
      const missionMatched = (sessionPath && mission.sessionPath === sessionPath) || (agentId && mission.agentId === agentId);
      if (missionMatched) {
        addUsageBucket(missionBuckets, mission.id, { id: mission.id, label: mission.title || mission.id, kind: "mission", missionId: mission.id }, entry);
      }
      for (const assignment of assignments) {
        const assignmentMatched = (sessionPath && assignment.sessionPath === sessionPath) || (agentId && assignment.agentId === agentId);
        if (!assignmentMatched) continue;
        addUsageBucket(missionBuckets, mission.id, { id: mission.id, label: mission.title || mission.id, kind: "mission", missionId: mission.id }, entry);
        addUsageBucket(assignmentBuckets, assignment.id, {
          id: assignment.id,
          label: assignment.label || assignment.id,
          kind: "assignment",
          assignmentId: assignment.id,
          missionId: mission.id
        }, entry);
      }
    }
  }

  const sortBuckets = (items) => Array.from(items.values())
    .sort((a, b) => b.summary.totalTokens - a.summary.totalTokens || String(a.label).localeCompare(String(b.label)));
  return {
    missions: sortBuckets(missionBuckets),
    assignments: sortBuckets(assignmentBuckets),
    sessions: sortBuckets(sessionBuckets),
    summary: {
      attributedMissionTokens: sumBucketTokens(missionBuckets),
      attributedAssignmentTokens: sumBucketTokens(assignmentBuckets),
      attributedSessionTokens: sumBucketTokens(sessionBuckets),
      missionCount: missionBuckets.size,
      assignmentCount: assignmentBuckets.size,
      sessionCount: sessionBuckets.size
    }
  };
}

function addUsageBucket(map, id, meta, entry) {
  if (!id || !entry) return;
  const key = String(id);
  if (!map.has(key)) {
    map.set(key, {
      ...meta,
      entries: [],
      summary: { count: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 }
    });
  }
  const bucket = map.get(key);
  if (bucket.entries.some((item) => item.id === entry.id || item.requestId === entry.requestId)) return;
  bucket.entries.push(entry);
  bucket.summary = summarizeUsageLike(bucket.entries);
}

function findMissionAssignment(missions, assignmentId) {
  for (const mission of Array.isArray(missions) ? missions : []) {
    const assignment = (mission.assignments || []).find((item) => item.id === assignmentId);
    if (assignment) return { ...assignment, missionId: mission.id, missionTitle: mission.title };
  }
  return null;
}

export function buildAgentOutputs(overview = {}, input = {}) {
  const limit = clampRouteNumber(input.limit, 1, 200, 40);
  const filter = normalizeAgentOutputFilter(input.filter);
  const agentFilter = cleanString(input.agentId);
  const missionFilter = cleanString(input.missionId);
  const sessionFilter = cleanString(input.sessionPath);
  const missions = overviewMissionItems(overview);
  const checkpoints = Array.isArray(overview.checkpoints) ? overview.checkpoints : overview.overview?.sections?.checkpoints?.items || [];
  const runRecords = Array.isArray(overview.runRecords) ? overview.runRecords : overview.overview?.sections?.runRecords?.items || [];
  const workerCards = Array.isArray(overview.workerCards) ? overview.workerCards : overview.overview?.sections?.workers?.items || [];
  const jobs = Array.isArray(overview.jobs) ? overview.jobs : overview.overview?.sections?.jobs?.items || [];
  const assignmentIndex = buildAssignmentActivityIndex(missions, workerCards);
  const outputs = [];
  const seen = new Set();
  const push = (output) => {
    const item = normalizeAgentOutput(output, assignmentIndex);
    if (!item) return;
    if (agentFilter && item.agentId !== agentFilter) return;
    if (missionFilter && item.missionId !== missionFilter) return;
    if (sessionFilter && item.sessionKey !== sessionFilter && item.chatSessionKey !== sessionFilter) return;
    if (filter !== "all" && item.status !== filter) return;
    if (seen.has(item.id)) return;
    seen.add(item.id);
    outputs.push(item);
  };

  for (const job of jobs) {
    for (const run of Array.isArray(job.runs) ? job.runs : []) {
      push({
        id: `job:${job.id}:${run.id}`,
        source: "job",
        agentId: job.agentId || run.agentId || "",
        agentName: job.agentId || "Scheduled Job",
        jobId: job.id,
        jobName: job.title || job.name || job.id,
        timestamp: activityTimestamp(run.createdAt || job.lastRunAt || job.updatedAt),
        status: run.status === "success" ? "ok" : run.status === "failed" ? "error" : run.status === "skipped" ? "unknown" : "running",
        statusLabel: run.status || "",
        failureKind: run.status === "failed" ? "runtime" : undefined,
        summary: run.summary || run.error || job.title || "Job output",
        fullOutput: run.output || run.error || safeJsonForOutput(run.result) || run.summary || "",
        error: run.error || "",
        missionId: job.missionId || run.missionId || "",
        sessionKey: run.sessionPath || "",
        meta: { type: job.type || "", mode: job.mode || "", schedule: job.schedule?.expression || "" }
      });
    }
  }

  for (const record of runRecords) {
    const assignment = findActivityAssignment(assignmentIndex, record);
    const status = agentOutputStatusFromRunRecord(record);
    push({
      id: `run-record:${record.id}`,
      source: "run-record",
      agentId: record.agentId || assignment?.agentId || "",
      agentName: record.requester || assignment?.assignmentLabel || record.agentId || "Run Console",
      jobName: record.type || "Run Console",
      timestamp: activityTimestamp(record.updatedAt || record.createdAt),
      status,
      statusLabel: record.state || record.type || status,
      failureKind: record.type === "approval" && record.state === "pending" ? "approval" : status === "error" ? "runtime" : undefined,
      summary: record.summary || firstCompatLine(record.content) || record.title || "",
      fullOutput: record.content || record.summary || record.path || "",
      error: status === "error" ? record.summary || record.title || "" : "",
      missionId: record.missionId || assignment?.missionId || "",
      missionTitle: assignment?.missionTitle || "",
      assignmentId: record.assignmentId || assignment?.assignmentId || "",
      sessionKey: record.sessionPath || assignment?.sessionPath || "",
      meta: { type: record.type || "", tool: record.tool || "", path: record.path || "" }
    });
  }

  for (const checkpoint of checkpoints) {
    const assignment = findActivityAssignment(assignmentIndex, checkpoint);
    const status = agentOutputStatusFromCheckpoint(checkpoint);
    push({
      id: `checkpoint-output:${checkpoint.id || checkpoint.checkpointId || checkpoint.createdAt}`,
      source: "checkpoint",
      agentId: checkpoint.agentId || assignment?.agentId || "",
      agentName: assignment?.assignmentLabel || checkpoint.agentId || "Checkpoint",
      jobName: "Checkpoint",
      timestamp: activityTimestamp(checkpoint.createdAt || checkpoint.updatedAt),
      status,
      statusLabel: checkpoint.state || checkpoint.columnSuggestion || status,
      failureKind: status === "error" ? "runtime" : undefined,
      summary: checkpoint.result || checkpoint.blocker || checkpoint.nextAction || checkpoint.label || "Checkpoint output",
      fullOutput: checkpoint.rawText || checkpoint.text || [
        checkpoint.state ? `STATE: ${checkpoint.state}` : "",
        checkpoint.result ? `RESULT: ${checkpoint.result}` : "",
        checkpoint.blocker ? `BLOCKER: ${checkpoint.blocker}` : "",
        checkpoint.nextAction ? `NEXT_ACTION: ${checkpoint.nextAction}` : ""
      ].filter(Boolean).join("\n"),
      error: status === "error" ? checkpoint.blocker || "" : "",
      missionId: assignment?.missionId || checkpoint.missionId || "",
      missionTitle: assignment?.missionTitle || "",
      assignmentId: assignment?.assignmentId || checkpoint.assignmentId || "",
      sessionKey: checkpoint.sessionPath || assignment?.sessionPath || "",
      meta: { taskId: checkpoint.taskId || "", accepted: Boolean(checkpoint.accepted) }
    });
  }

  for (const mission of missions) {
    for (const assignment of Array.isArray(mission.assignments) ? mission.assignments : []) {
      if (!assignment.output && !assignment.result && !assignment.blocker && !assignment.nextAction) continue;
      const status = agentOutputStatusFromAssignment(assignment);
      push({
        id: `assignment-output:${mission.id}:${assignment.id}:${assignment.updatedAt || assignment.state}`,
        source: "assignment",
        agentId: assignment.agentId || "",
        agentName: assignment.label || assignment.id,
        jobName: mission.title || "Mission Assignment",
        timestamp: activityTimestamp(assignment.updatedAt || assignment.createdAt || mission.updatedAt),
        status,
        statusLabel: assignment.state || status,
        failureKind: status === "error" ? "runtime" : undefined,
        summary: assignment.result || assignment.blocker || assignment.nextAction || firstCompatLine(assignment.output) || assignment.task,
        fullOutput: assignment.output || assignment.result || assignment.blocker || assignment.nextAction || assignment.task || "",
        error: status === "error" ? assignment.blocker || "" : "",
        missionId: mission.id,
        missionTitle: mission.title,
        assignmentId: assignment.id,
        sessionKey: assignment.sessionPath || "",
        meta: { taskId: assignment.taskId || "", roleId: assignment.roleId || "" }
      });
    }
  }

  outputs.sort((a, b) => b.timestamp - a.timestamp || String(b.id).localeCompare(String(a.id)));
  const allOutputs = filter === "all"
    ? outputs
    : buildAgentOutputs(overview, { ...input, filter: "all", limit: 200, agentId: agentFilter, missionId: missionFilter, sessionPath: sessionFilter }).outputs;
  return {
    outputs: outputs.slice(0, limit),
    summary: summarizeAgentOutputs(allOutputs),
    availableFilters: agentOutputFilters(allOutputs),
    filters: { filter, agentId: agentFilter, missionId: missionFilter, sessionPath: sessionFilter, limit }
  };
}

function normalizeAgentOutput(output = {}, assignmentIndex) {
  const assignment = output.assignmentId ? assignmentIndex.byAssignmentId.get(output.assignmentId) : null;
  const fullOutput = cleanString(output.fullOutput);
  const summary = cleanString(output.summary || firstCompatLine(fullOutput));
  if (!summary && !fullOutput) return null;
  const timestamp = Number(output.timestamp) || activityTimestamp(output.at || output.createdAt || output.updatedAt);
  return {
    id: cleanString(output.id) || `output:${timestamp}:${summary.slice(0, 32)}`,
    source: cleanString(output.source) || "hanaagent",
    agentId: cleanString(output.agentId || assignment?.agentId),
    agentName: cleanString(output.agentName || assignment?.assignmentLabel || output.agentId) || "HanaAgent",
    agentEmoji: cleanString(output.agentEmoji) || agentEmojiForOutput(output),
    jobId: cleanString(output.jobId),
    jobName: cleanString(output.jobName) || cleanString(output.source) || "Output",
    timestamp,
    at: timestamp ? new Date(timestamp).toISOString() : "",
    durationMs: Number(output.durationMs || 0) || undefined,
    status: normalizeAgentOutputStatus(output.status),
    statusLabel: cleanString(output.statusLabel || output.status),
    failureKind: cleanString(output.failureKind) || undefined,
    summary,
    fullOutput: fullOutput || summary,
    model: cleanString(output.model),
    sessionKey: cleanString(output.sessionKey || output.sessionPath || assignment?.sessionPath),
    chatSessionKey: cleanString(output.chatSessionKey || output.sessionKey || output.sessionPath || assignment?.sessionPath),
    error: cleanString(output.error),
    missionId: cleanString(output.missionId || assignment?.missionId),
    missionTitle: cleanString(output.missionTitle || assignment?.missionTitle),
    assignmentId: cleanString(output.assignmentId || assignment?.assignmentId),
    meta: output.meta && typeof output.meta === "object" ? output.meta : {}
  };
}

function normalizeAgentOutputFilter(value) {
  const text = cleanString(value).toLowerCase();
  return ["all", "ok", "error", "running", "unknown"].includes(text) ? text : "all";
}

function normalizeAgentOutputStatus(value) {
  const text = cleanString(value).toLowerCase();
  if (text === "success" || text === "done" || text === "complete" || text === "approved") return "ok";
  if (text === "failed" || text === "blocked" || text === "denied" || text === "error") return "error";
  if (text === "running" || text === "pending" || text === "review" || text === "checkpointed") return "running";
  return ["ok", "unknown"].includes(text) ? text : "unknown";
}

function agentOutputStatusFromRunRecord(record = {}) {
  if (record.type === "approval" && record.state === "pending") return "running";
  if (record.state === "denied" || record.state === "failed" || record.state === "blocked") return "error";
  if (record.state === "pending" || record.state === "review") return "running";
  return "ok";
}

function agentOutputStatusFromCheckpoint(checkpoint = {}) {
  const state = cleanString(checkpoint.state || checkpoint.columnSuggestion).toLowerCase();
  if (state.includes("blocked") || state.includes("fail")) return "error";
  if (state.includes("done") || state.includes("complete") || state.includes("accepted")) return "ok";
  if (state.includes("review") || state.includes("progress") || state.includes("running")) return "running";
  return checkpoint.accepted ? "ok" : "unknown";
}

function agentOutputStatusFromAssignment(assignment = {}) {
  const state = cleanString(assignment.state).toLowerCase();
  if (state === "done" || state === "complete") return "ok";
  if (state === "blocked" || assignment.blocker) return "error";
  if (state === "running" || state === "review" || state === "checkpointed") return "running";
  return "unknown";
}

function agentEmojiForOutput(output = {}) {
  const source = cleanString(output.source);
  if (source === "job") return "J";
  if (source === "run-record") return "R";
  if (source === "checkpoint") return "C";
  if (source === "assignment") return "A";
  return "H";
}

function summarizeAgentOutputs(outputs = []) {
  const byStatus = { all: outputs.length, ok: 0, error: 0, running: 0, unknown: 0 };
  let latestAt = "";
  for (const output of outputs) {
    byStatus[output.status] = (byStatus[output.status] || 0) + 1;
    if (!latestAt || output.timestamp > activityTimestamp(latestAt)) latestAt = output.at;
  }
  return {
    total: outputs.length,
    byStatus,
    latestAt,
    errors: byStatus.error || 0,
    running: byStatus.running || 0
  };
}

function agentOutputFilters(outputs = []) {
  const summary = summarizeAgentOutputs(outputs).byStatus;
  return [
    { id: "all", label: "All", count: summary.all || 0 },
    { id: "ok", label: "Success", count: summary.ok || 0 },
    { id: "error", label: "Errors", count: summary.error || 0 },
    { id: "running", label: "Running", count: summary.running || 0 }
  ];
}

function safeJsonForOutput(value) {
  if (!value || typeof value !== "object") return "";
  try {
    const text = JSON.stringify(value, null, 2);
    return text === "{}" ? "" : text;
  } catch {
    return "";
  }
}
export function buildApprovalQueue(ctx, input = {}) {
  const limit = clampRouteNumber(input.limit, 1, 200, 80);
  const statusFilter = normalizeApprovalStatus(input.status);
  const missionFilter = cleanString(input.missionId);
  const assignmentFilter = cleanString(input.assignmentId);
  const sessionFilter = cleanString(input.sessionPath);
  const missions = listMissions(ctx.dataDir, { includeArchived: true });
  const workerCards = buildWorkerCards([], [], listTasks(ctx.dataDir, { includeDone: true }), listCheckpoints(ctx.dataDir), missions);
  const assignmentIndex = buildAssignmentActivityIndex(missions, workerCards);
  const records = listRunRecords(ctx.dataDir, { type: "approval" });
  const approvals = records.map((record) => normalizeApprovalRecord(record, assignmentIndex)).filter(Boolean)
    .filter((approval) => !statusFilter || approval.status === statusFilter)
    .filter((approval) => !missionFilter || approval.missionId === missionFilter)
    .filter((approval) => !assignmentFilter || approval.assignmentId === assignmentFilter || approval.workerId === assignmentFilter)
    .filter((approval) => !sessionFilter || approval.sessionPath === sessionFilter)
    .sort((a, b) => b.requestedAt - a.requestedAt || String(b.id).localeCompare(String(a.id)));
  const pending = approvals.filter((approval) => approval.status === "pending");
  const history = approvals.filter((approval) => approval.status !== "pending");
  return {
    approvals: approvals.slice(0, limit),
    pending: pending.slice(0, limit),
    history: history.slice(0, limit),
    summary: summarizeApprovals(approvals),
    filters: { status: statusFilter || "all", missionId: missionFilter, assignmentId: assignmentFilter, sessionPath: sessionFilter, limit }
  };
}

function normalizeApprovalRecord(record = {}, assignmentIndex) {
  const assignment = findActivityAssignment(assignmentIndex, record);
  const status = normalizeApprovalStatus(record.state) || "pending";
  const requestedAt = activityTimestamp(record.createdAt || record.updatedAt) || Date.now();
  const resolvedAt = record.resolvedAt ? activityTimestamp(record.resolvedAt) : (status === "pending" ? null : activityTimestamp(record.updatedAt));
  const action = cleanString(record.title || record.summary || record.tool || "Approval requested");
  const context = cleanString(record.content || record.summary || record.path || "");
  return {
    id: cleanString(record.id),
    approvalId: cleanString(record.id),
    source: "agent",
    agentId: cleanString(record.agentId || assignment?.agentId),
    agentName: cleanString(record.requester || assignment?.assignmentLabel || record.agentId || assignment?.agentId) || "HanaAgent",
    action,
    tool: cleanString(record.tool || record.meta?.tool || "run-console"),
    toolName: cleanString(record.tool || record.meta?.tool || action.split(/[\s:(]/)[0] || "approval"),
    context,
    input: record.meta?.input || record.meta?.patch || record.meta?.suggestion || undefined,
    risk: approvalRisk(record),
    requestedAt,
    resolvedAt,
    status,
    missionId: cleanString(record.missionId || assignment?.missionId),
    missionTitle: cleanString(assignment?.missionTitle),
    assignmentId: cleanString(record.assignmentId || assignment?.assignmentId),
    workerId: cleanString(assignment?.workerId || record.assignmentId),
    sessionPath: cleanString(record.sessionPath || assignment?.sessionPath),
    recordId: cleanString(record.id),
    meta: record.meta && typeof record.meta === "object" ? record.meta : {}
  };
}

function normalizeApprovalStatus(value) {
  const text = cleanString(value).toLowerCase();
  if (text === "approve" || text === "approved" || text === "allow" || text === "accepted") return "approved";
  if (text === "deny" || text === "denied" || text === "reject" || text === "rejected") return "denied";
  if (text === "pending" || text === "review" || text === "running") return "pending";
  return "";
}

function approvalRisk(record = {}) {
  const text = `${record.title || ""} ${record.summary || ""} ${record.content || ""} ${record.tool || ""}`.toLowerCase();
  if (record.risk && ["low", "medium", "high"].includes(cleanString(record.risk).toLowerCase())) return cleanString(record.risk).toLowerCase();
  if (/(rm\s+-rf|drop\s+table|truncate|sudo|chmod\s+777|delete\s+all|force|secret|token|credential)/.test(text)) return "high";
  if (/(write|edit|patch|install|deploy|execute|run|kill|delete|update|network|shell|terminal)/.test(text)) return "medium";
  return "low";
}

function summarizeApprovals(approvals = []) {
  const byStatus = { pending: 0, approved: 0, denied: 0 };
  const byRisk = { low: 0, medium: 0, high: 0 };
  let latestRequestedAt = 0;
  let latestResolvedAt = 0;
  for (const approval of approvals) {
    byStatus[approval.status] = (byStatus[approval.status] || 0) + 1;
    byRisk[approval.risk] = (byRisk[approval.risk] || 0) + 1;
    latestRequestedAt = Math.max(latestRequestedAt, Number(approval.requestedAt || 0));
    latestResolvedAt = Math.max(latestResolvedAt, Number(approval.resolvedAt || 0));
  }
  return {
    total: approvals.length,
    pending: byStatus.pending || 0,
    approved: byStatus.approved || 0,
    denied: byStatus.denied || 0,
    byStatus,
    byRisk,
    latestRequestedAt: latestRequestedAt ? new Date(latestRequestedAt).toISOString() : "",
    latestResolvedAt: latestResolvedAt ? new Date(latestResolvedAt).toISOString() : ""
  };
}

export function resolveApprovalRecord(ctx, approvalId, action, body = {}) {
  const id = cleanString(approvalId).replace(/^gw-/, "");
  const status = normalizeApprovalStatus(action);
  if (!id) return { ok: false, error: "approvalId_required" };
  if (!["approved", "denied"].includes(status)) return { ok: false, error: "unsupported_approval_action", action };
  const result = updateRunRecord(ctx.dataDir, id, {
    state: status,
    meta: {
      ...(listRunRecords(ctx.dataDir, { type: "approval" }).find((record) => record.id === id)?.meta || {}),
      resolvedBy: cleanString(body.resolvedBy || body.user || "hanaagent"),
      resolveReason: cleanString(body.reason || body.note),
      resolvedVia: "hanaagent-approvals"
    }
  });
  if (!result.ok) return { ok: false, error: "approval_not_found", approvalId: id };
  if (result.record.missionId) {
    appendMissionEvent(ctx.dataDir, result.record.missionId, {
      type: "approval_resolved",
      label: `${result.record.title}: ${status}`,
      meta: {
        recordId: result.record.id,
        approvalId: result.record.id,
        assignmentId: result.record.assignmentId,
        state: result.record.state,
        reason: cleanString(body.reason || body.note)
      }
    });
  }
  const queueFilters = {
    limit: 80,
    missionId: result.record.missionId,
    assignmentId: result.record.assignmentId,
    sessionPath: result.record.sessionPath
  };
  const queue = buildApprovalQueue(ctx, queueFilters);
  const globalQueue = buildApprovalQueue(ctx, { limit: 80 });
  return {
    ok: true,
    approval: normalizeApprovalRecord(result.record, buildAssignmentActivityIndex(listMissions(ctx.dataDir, { includeArchived: true }), [])),
    record: result.record,
    summary: queue.summary,
    globalSummary: globalQueue.summary,
    pending: queue.pending,
    history: queue.history,
    action: status === "approved" ? "approve" : "deny"
  };
}

export function buildWorkerArtifacts(overview = {}, input = {}) {
  const limit = clampRouteNumber(input.limit, 1, 200, 40);
  const workerFilter = cleanString(input.workerId);
  const missionFilter = cleanString(input.missionId);
  const assignmentFilter = cleanString(input.assignmentId);
  const missions = overviewMissionItems(overview);
  const runRecords = Array.isArray(overview.runRecords) ? overview.runRecords : overview.overview?.sections?.runRecords?.items || [];
  const workerCards = Array.isArray(overview.workerCards) ? overview.workerCards : overview.overview?.sections?.workers?.items || [];
  const tasks = Array.isArray(overview.tasks) ? overview.tasks : overview.overview?.sections?.tasks?.items || [];
  const assignmentIndex = buildAssignmentActivityIndex(missions, workerCards);
  const buckets = new Map();
  const seenArtifacts = new Set();
  const seenPreviews = new Set();

  const ensureBucket = (seed = {}) => {
    const assignment = seed.assignmentId ? assignmentIndex.byAssignmentId.get(seed.assignmentId) : findActivityAssignment(assignmentIndex, seed);
    const workerId = cleanString(seed.workerId || assignment?.workerId || seed.assignmentId || seed.agentId || "workspace");
    const assignmentId = cleanString(seed.assignmentId || assignment?.assignmentId);
    const missionId = cleanString(seed.missionId || assignment?.missionId);
    if (workerFilter && workerId !== workerFilter && assignmentId !== workerFilter && cleanString(seed.agentId || assignment?.agentId) !== workerFilter) return null;
    if (missionFilter && missionId !== missionFilter) return null;
    if (assignmentFilter && assignmentId !== assignmentFilter && workerId !== assignmentFilter) return null;
    const key = assignmentId || workerId || "workspace";
    if (!buckets.has(key)) {
      buckets.set(key, {
        id: key,
        workerId,
        workerName: cleanString(seed.workerName || assignment?.assignmentLabel || workerId),
        agentId: cleanString(seed.agentId || assignment?.agentId),
        assignmentId,
        missionId,
        missionTitle: cleanString(seed.missionTitle || assignment?.missionTitle),
        sessionPath: cleanString(seed.sessionPath || assignment?.sessionPath),
        artifacts: [],
        previews: [],
        changedFiles: [],
        syntheticArtifacts: [],
        updatedAt: "",
        timestamp: 0
      });
    }
    return buckets.get(key);
  };

  const addArtifact = (record, assignment) => {
    const bucket = ensureBucket({
      workerId: assignment?.workerId || record.workerId,
      workerName: assignment?.assignmentLabel || record.requester,
      agentId: record.agentId || assignment?.agentId,
      assignmentId: record.assignmentId || assignment?.assignmentId,
      missionId: record.missionId || assignment?.missionId,
      missionTitle: assignment?.missionTitle,
      sessionPath: record.sessionPath || assignment?.sessionPath,
      taskId: record.taskId
    });
    if (!bucket) return;
    const artifact = runRecordToWorkerArtifact(record, assignment);
    if (!artifact || seenArtifacts.has(artifact.id)) return;
    seenArtifacts.add(artifact.id);
    bucket.artifacts.push(artifact);
    bumpWorkerArtifactBucket(bucket, artifact.updatedAt || artifact.createdAt);
    const preview = runRecordToWorkerPreview(record, assignment);
    if (preview && !seenPreviews.has(preview.id)) {
      seenPreviews.add(preview.id);
      bucket.previews.push(preview);
      bumpWorkerArtifactBucket(bucket, preview.updatedAt);
    }
  };

  for (const mission of missions) {
    for (const assignment of Array.isArray(mission.assignments) ? mission.assignments : []) {
      ensureBucket({
        workerId: assignment.id,
        workerName: assignment.label,
        agentId: assignment.agentId,
        assignmentId: assignment.id,
        missionId: mission.id,
        missionTitle: mission.title,
        sessionPath: assignment.sessionPath
      });
    }
  }

  for (const card of workerCards) {
    ensureBucket({
      workerId: card.activeAssignment?.id || card.id,
      workerName: card.name,
      agentId: card.agentId,
      assignmentId: card.activeAssignment?.id || card.activeTask?.assignmentId,
      missionId: card.activeAssignment?.missionId || card.activeTask?.missionId,
      missionTitle: card.activeAssignment?.missionTitle,
      sessionPath: card.sessions?.[0]?.path
    });
  }

  for (const record of runRecords) {
    if (record.type !== "artifact" && !record.meta?.previewUrl && !record.previewUrl) continue;
    addArtifact(record, findActivityAssignment(assignmentIndex, record));
  }

  for (const task of tasks) {
    const files = normalizeChangedFilesFromTask(task);
    if (!files.length) continue;
    const assignment = findActivityAssignment(assignmentIndex, task);
    const bucket = ensureBucket({
      workerId: assignment?.workerId || task.assignmentId || task.assignee,
      workerName: assignment?.assignmentLabel || task.assignee,
      agentId: task.assignee || assignment?.agentId,
      assignmentId: task.assignmentId || assignment?.assignmentId,
      missionId: task.missionId || assignment?.missionId,
      missionTitle: assignment?.missionTitle,
      sessionPath: task.sessionPath || assignment?.sessionPath,
      taskId: task.id || task.taskId
    });
    if (!bucket) continue;
    for (const file of files) addWorkerChangedFile(bucket, file, task);
  }

  for (const bucket of buckets.values()) {
    bucket.artifacts.sort((a, b) => activityTimestamp(b.updatedAt || b.createdAt) - activityTimestamp(a.updatedAt || a.createdAt));
    bucket.previews.sort((a, b) => activityTimestamp(b.updatedAt) - activityTimestamp(a.updatedAt));
    bucket.changedFiles = bucket.changedFiles.slice(0, 12);
    bucket.syntheticArtifacts = bucket.syntheticArtifacts.slice(0, 12);
  }

  const items = Array.from(buckets.values())
    .filter((bucket) => bucket.artifacts.length || bucket.previews.length || bucket.changedFiles.length || bucket.syntheticArtifacts.length)
    .sort((a, b) => b.timestamp - a.timestamp || String(a.workerName || a.workerId).localeCompare(String(b.workerName || b.workerId)))
    .slice(0, limit);
  return {
    items,
    summary: summarizeWorkerArtifacts(items),
    filters: { workerId: workerFilter, missionId: missionFilter, assignmentId: assignmentFilter, limit }
  };
}

function runRecordToWorkerArtifact(record = {}, assignment = null) {
  const kind = normalizeWorkerArtifactKind(record.meta?.kind || record.kind || record.type, record);
  const updatedAt = cleanString(record.updatedAt || record.createdAt);
  return {
    id: cleanString(record.id),
    kind,
    label: cleanString(record.title || record.meta?.filename || record.path || record.id) || "Artifact",
    title: cleanString(record.title),
    summary: cleanString(record.summary || firstCompatLine(record.content)),
    path: cleanString(record.path || record.meta?.path || record.meta?.filename),
    workerId: cleanString(assignment?.workerId || record.workerId || record.assignmentId),
    agentId: cleanString(record.agentId || assignment?.agentId),
    assignmentId: cleanString(record.assignmentId || assignment?.assignmentId),
    missionId: cleanString(record.missionId || assignment?.missionId),
    missionTitle: cleanString(assignment?.missionTitle),
    sessionPath: cleanString(record.sessionPath || assignment?.sessionPath),
    source: "run-console",
    state: cleanString(record.state),
    contentType: cleanString(record.meta?.mime || record.meta?.contentType),
    sizeBytes: Number(record.meta?.size || record.meta?.sizeBytes || 0) || null,
    createdAt: cleanString(record.createdAt),
    updatedAt,
    materialized: Boolean(record.path),
    contentUrl: record.path ? "" : "",
    recordId: cleanString(record.id),
    meta: { tool: cleanString(record.tool), language: cleanString(record.language) }
  };
}

function runRecordToWorkerPreview(record = {}, assignment = null) {
  const url = cleanString(record.meta?.previewUrl || record.previewUrl);
  if (!url) return null;
  return {
    id: `preview:${record.id}`,
    label: cleanString(record.meta?.previewLabel || record.title || "Preview"),
    url,
    source: cleanString(record.meta?.previewSource || record.tool) || "run-console",
    status: cleanString(record.meta?.previewStatus) || "ready",
    workerId: cleanString(assignment?.workerId || record.workerId || record.assignmentId),
    agentId: cleanString(record.agentId || assignment?.agentId),
    assignmentId: cleanString(record.assignmentId || assignment?.assignmentId),
    missionId: cleanString(record.missionId || assignment?.missionId),
    updatedAt: cleanString(record.updatedAt || record.createdAt)
  };
}

function normalizeWorkerArtifactKind(value, record = {}) {
  const text = cleanString(value).toLowerCase();
  if (["file", "diff", "patch", "build", "log", "report", "preview"].includes(text)) return text;
  const language = cleanString(record.language).toLowerCase();
  const filePath = cleanString(record.path || record.meta?.filename).toLowerCase();
  if (language === "diff" || filePath.endsWith(".diff")) return "diff";
  if (filePath.endsWith(".patch")) return "patch";
  if (language === "log" || filePath.endsWith(".log")) return "log";
  if (language === "html" || filePath.endsWith(".html")) return "preview";
  if (language === "markdown" || filePath.endsWith(".md")) return "report";
  if (record.meta?.previewUrl || record.previewUrl) return "preview";
  return "file";
}

function normalizeChangedFilesFromTask(task = {}) {
  const candidates = [
    task.changedFiles,
    task.filesChanged,
    task.meta?.changedFiles,
    task.meta?.filesChanged
  ];
  for (const value of candidates) {
    if (Array.isArray(value)) return value.map(normalizeChangedFileEntry).filter(Boolean);
    if (typeof value === "string") return value.split(/[\n,]+/).map((entry) => normalizeChangedFileEntry(entry)).filter(Boolean);
  }
  return [];
}

function normalizeChangedFileEntry(value) {
  if (!value) return null;
  if (typeof value === "string") {
    const pathValue = cleanString(value);
    return pathValue ? { path: pathValue, relativePath: pathValue } : null;
  }
  if (typeof value === "object") {
    const pathValue = cleanString(value.relativePath || value.path || value.filePath);
    if (!pathValue) return null;
    return {
      path: pathValue,
      relativePath: cleanString(value.relativePath) || pathValue,
      rootId: cleanString(value.rootId),
      rootLabel: cleanString(value.rootLabel),
      status: cleanString(value.status)
    };
  }
  return null;
}

function addWorkerChangedFile(bucket, file, task = {}) {
  const pathValue = cleanString(file.relativePath || file.path);
  if (!pathValue || bucket.changedFiles.some((item) => item.path === pathValue)) return;
  const changed = {
    id: `changed:${bucket.id}:${pathValue}`,
    path: pathValue,
    relativePath: pathValue,
    rootId: cleanString(file.rootId),
    rootLabel: cleanString(file.rootLabel),
    status: cleanString(file.status || task.column || task.status),
    source: "task-board",
    taskId: cleanString(task.id || task.taskId),
    updatedAt: cleanString(task.updatedAt || task.createdAt)
  };
  bucket.changedFiles.push(changed);
  bucket.syntheticArtifacts.push({
    id: `synthetic:${bucket.id}:${pathValue}`,
    kind: pathValue.endsWith("/") ? "file" : "diff",
    label: path.basename(pathValue.replace(/\/$/, "")) || pathValue,
    path: pathValue,
    workerId: bucket.workerId,
    agentId: bucket.agentId,
    assignmentId: bucket.assignmentId,
    missionId: bucket.missionId,
    source: "inferred",
    updatedAt: changed.updatedAt
  });
  bumpWorkerArtifactBucket(bucket, changed.updatedAt);
}

function bumpWorkerArtifactBucket(bucket, at) {
  const timestamp = activityTimestamp(at);
  if (timestamp >= bucket.timestamp) {
    bucket.timestamp = timestamp;
    bucket.updatedAt = cleanString(at) || bucket.updatedAt;
  }
}

function summarizeWorkerArtifacts(items = []) {
  const byKind = {};
  let latestAt = "";
  let artifacts = 0;
  let previews = 0;
  let changedFiles = 0;
  for (const item of items) {
    artifacts += item.artifacts.length + item.syntheticArtifacts.length;
    previews += item.previews.length;
    changedFiles += item.changedFiles.length;
    for (const artifact of [...item.artifacts, ...item.syntheticArtifacts]) {
      byKind[artifact.kind] = (byKind[artifact.kind] || 0) + 1;
    }
    if (!latestAt || item.timestamp > activityTimestamp(latestAt)) latestAt = item.updatedAt;
  }
  return {
    totalWorkers: items.length,
    artifacts,
    previews,
    changedFiles,
    byKind,
    latestAt
  };
}
export function buildSwarmActivity(overview = {}, input = {}) {
  const limit = clampRouteNumber(input.limit, 1, 200, 40);
  const workerFilter = cleanString(input.workerId);
  const missionFilter = cleanString(input.missionId);
  const missions = overviewMissionItems(overview);
  const checkpoints = Array.isArray(overview.checkpoints) ? overview.checkpoints : overview.overview?.sections?.checkpoints?.items || [];
  const runRecords = Array.isArray(overview.runRecords) ? overview.runRecords : overview.overview?.sections?.runRecords?.items || [];
  const tasks = Array.isArray(overview.tasks) ? overview.tasks : overview.overview?.sections?.tasks?.items || [];
  const workerCards = Array.isArray(overview.workerCards) ? overview.workerCards : overview.overview?.sections?.workers?.items || [];
  const jobs = Array.isArray(overview.jobs) ? overview.jobs : overview.overview?.sections?.jobs?.items || [];
  const assignmentIndex = buildAssignmentActivityIndex(missions, workerCards);
  const rows = [];
  const seen = new Set();
  const push = (row) => {
    const item = normalizeSwarmActivityRow(row, assignmentIndex);
    if (!item) return;
    if (workerFilter && item.workerId !== workerFilter && item.assignmentId !== workerFilter && item.agentId !== workerFilter) return;
    if (missionFilter && item.missionId !== missionFilter) return;
    const key = item.id || `${item.kind}:${item.workerId}:${item.missionId}:${item.assignmentId}:${item.at}:${item.text}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(item);
  };

  for (const mission of missions) {
    for (const event of Array.isArray(mission.events) ? mission.events : []) {
      const assignment = event.meta?.assignmentId ? assignmentIndex.byAssignmentId.get(event.meta.assignmentId) : null;
      push({
        id: `event:${mission.id}:${event.id || event.at || event.type}`,
        kind: event.type === "swarmbrief_artifact" ? "artifact" : "event",
        source: "mission-event",
        title: event.label || event.type || "Mission event",
        text: event.detail || event.message || event.label || event.type || "Mission event",
        at: event.at || event.createdAt || mission.updatedAt,
        missionId: mission.id,
        missionTitle: mission.title,
        assignmentId: event.meta?.assignmentId || "",
        workerId: event.meta?.workerId || assignment?.workerId || "",
        agentId: assignment?.agentId || "",
        status: event.type || "",
        meta: event.meta || {}
      });
    }
    for (const assignment of Array.isArray(mission.assignments) ? mission.assignments : []) {
      push({
        id: `assignment:${mission.id}:${assignment.id}:${assignment.updatedAt || assignment.state}`,
        kind: assignment.state === "blocked" ? "blocker" : "worker",
        source: "mission-assignment",
        title: assignment.label || assignment.id,
        text: assignment.output || assignment.result || assignment.blocker || assignment.nextAction || assignment.task || "",
        at: assignment.updatedAt || assignment.createdAt || mission.updatedAt,
        missionId: mission.id,
        missionTitle: mission.title,
        assignmentId: assignment.id,
        workerId: assignment.id,
        agentId: assignment.agentId || "",
        status: assignment.state || ""
      });
    }
  }

  for (const checkpoint of checkpoints) {
    const assignment = findActivityAssignment(assignmentIndex, checkpoint);
    push({
      id: `checkpoint:${checkpoint.id || checkpoint.checkpointId || checkpoint.createdAt}`,
      kind: checkpoint.state === "BLOCKED" || checkpoint.columnSuggestion === "blocked" ? "blocker" : "checkpoint",
      source: "checkpoint",
      title: checkpoint.state || checkpoint.label || "Checkpoint",
      text: checkpoint.result || checkpoint.lastResult || checkpoint.rawText || checkpoint.text || checkpoint.label || "",
      at: checkpoint.createdAt || checkpoint.updatedAt,
      missionId: assignment?.missionId || checkpoint.missionId || "",
      missionTitle: assignment?.missionTitle || "",
      assignmentId: assignment?.assignmentId || checkpoint.assignmentId || "",
      workerId: assignment?.workerId || checkpoint.workerId || "",
      agentId: checkpoint.agentId || assignment?.agentId || "",
      sessionPath: checkpoint.sessionPath || assignment?.sessionPath || "",
      status: checkpoint.state || checkpoint.columnSuggestion || ""
    });
  }

  for (const record of runRecords) {
    const assignment = findActivityAssignment(assignmentIndex, record);
    push({
      id: `run:${record.id}`,
      kind: record.type || "run-record",
      source: "run-console",
      title: record.title || record.type || "Run record",
      text: record.summary || record.content || record.path || "",
      at: record.updatedAt || record.createdAt,
      missionId: record.missionId || assignment?.missionId || "",
      missionTitle: assignment?.missionTitle || "",
      assignmentId: record.assignmentId || assignment?.assignmentId || "",
      workerId: assignment?.workerId || record.workerId || "",
      agentId: record.agentId || assignment?.agentId || "",
      sessionPath: record.sessionPath || assignment?.sessionPath || "",
      status: record.state || record.type || ""
    });
  }

  for (const card of workerCards) {
    push({
      id: `worker:${card.id}:${card.status}:${card.latestCheckpoint?.createdAt || card.activeTask?.updatedAt || ""}`,
      kind: card.status === "blocked" ? "blocker" : "worker",
      source: "worker-card",
      title: card.name || card.id || "Worker",
      text: card.latestCheckpoint?.result || card.latestCheckpoint?.rawText || card.activeTask?.title || card.activeAssignment?.task || "Worker status updated",
      at: card.latestCheckpoint?.createdAt || card.activeAssignment?.updatedAt || card.activeTask?.updatedAt || card.activeTask?.createdAt,
      missionId: card.activeAssignment?.missionId || card.activeTask?.missionId || "",
      missionTitle: card.activeAssignment?.missionTitle || "",
      assignmentId: card.activeAssignment?.id || card.activeTask?.assignmentId || "",
      workerId: card.activeAssignment?.id || card.id || "",
      agentId: card.agentId || "",
      status: card.status || ""
    });
  }

  for (const task of tasks.filter((item) => !["done", "cancelled"].includes(String(item.column || item.status || "").toLowerCase()))) {
    const assignment = findActivityAssignment(assignmentIndex, task);
    push({
      id: `task:${task.id}:${task.updatedAt || task.createdAt}`,
      kind: task.column === "blocked" ? "blocker" : "task",
      source: "task-board",
      title: task.title || task.id || "Task",
      text: task.description || task.summary || task.title || "",
      at: task.updatedAt || task.createdAt,
      missionId: task.missionId || assignment?.missionId || "",
      missionTitle: assignment?.missionTitle || "",
      assignmentId: task.assignmentId || assignment?.assignmentId || "",
      workerId: assignment?.workerId || task.assignmentId || "",
      agentId: task.assignee || assignment?.agentId || "",
      sessionPath: task.sessionPath || assignment?.sessionPath || "",
      status: task.column || task.status || ""
    });
  }

  for (const job of jobs) {
    const latestRun = Array.isArray(job.runs) ? job.runs[0] : null;
    if (!latestRun) continue;
    push({
      id: `job:${job.id}:${latestRun.id || latestRun.createdAt}`,
      kind: "job",
      source: "scheduled-job",
      title: job.title || job.name || job.id,
      text: latestRun.summary || latestRun.output || latestRun.status || "",
      at: latestRun.createdAt || job.lastRunAt || job.updatedAt,
      missionId: job.missionId || latestRun.missionId || "",
      assignmentId: latestRun.assignmentId || "",
      workerId: latestRun.workerId || "",
      agentId: job.agentId || latestRun.agentId || "",
      status: latestRun.status || job.status || ""
    });
  }

  rows.sort((a, b) => b.timestamp - a.timestamp || String(b.id).localeCompare(String(a.id)));
  const items = rows.slice(0, limit);
  return {
    items,
    summary: summarizeSwarmActivity(items),
    filters: { workerId: workerFilter, missionId: missionFilter, limit }
  };
}

export function buildAssignmentActivityIndex(missions = [], workerCards = []) {
  const byAssignmentId = new Map();
  const byTaskId = new Map();
  const bySessionPath = new Map();
  const byAgentId = new Map();
  for (const mission of Array.isArray(missions) ? missions : []) {
    for (const assignment of Array.isArray(mission.assignments) ? mission.assignments : []) {
      const entry = {
        workerId: assignment.id,
        assignmentId: assignment.id,
        assignmentLabel: assignment.label || assignment.id,
        agentId: assignment.agentId || "",
        sessionPath: assignment.sessionPath || "",
        missionId: mission.id || "",
        missionTitle: mission.title || ""
      };
      if (entry.assignmentId) byAssignmentId.set(entry.assignmentId, entry);
      if (assignment.taskId) byTaskId.set(assignment.taskId, entry);
      if (entry.sessionPath && !bySessionPath.has(entry.sessionPath)) bySessionPath.set(entry.sessionPath, entry);
      if (entry.agentId && !byAgentId.has(entry.agentId)) byAgentId.set(entry.agentId, entry);
    }
  }
  for (const card of Array.isArray(workerCards) ? workerCards : []) {
    const assignment = card.activeAssignment || {};
    const entry = {
      workerId: assignment.id || card.id || "",
      assignmentId: assignment.id || card.activeTask?.assignmentId || "",
      assignmentLabel: assignment.label || card.name || card.id || "",
      agentId: card.agentId || assignment.agentId || "",
      sessionPath: assignment.sessionPath || card.sessions?.[0]?.path || "",
      missionId: assignment.missionId || card.activeTask?.missionId || "",
      missionTitle: assignment.missionTitle || ""
    };
    if (entry.assignmentId && !byAssignmentId.has(entry.assignmentId)) byAssignmentId.set(entry.assignmentId, entry);
    if (card.activeTask?.id && !byTaskId.has(card.activeTask.id)) byTaskId.set(card.activeTask.id, entry);
    if (entry.sessionPath && !bySessionPath.has(entry.sessionPath)) bySessionPath.set(entry.sessionPath, entry);
    if (entry.agentId && !byAgentId.has(entry.agentId)) byAgentId.set(entry.agentId, entry);
  }
  return { byAssignmentId, byTaskId, bySessionPath, byAgentId };
}

export function findActivityAssignment(index, item = {}) {
  return index.byAssignmentId.get(item.assignmentId)
    || index.byTaskId.get(item.taskId || item.id)
    || index.bySessionPath.get(item.sessionPath)
    || index.byAgentId.get(item.agentId || item.assignee)
    || null;
}

function normalizeSwarmActivityRow(row = {}, assignmentIndex) {
  const assignment = row.assignmentId ? assignmentIndex.byAssignmentId.get(row.assignmentId) : null;
  const timestamp = activityTimestamp(row.at);
  const text = cleanString(row.text || row.title);
  if (!text && !row.title) return null;
  return {
    id: cleanString(row.id) || "",
    kind: cleanString(row.kind) || "event",
    source: cleanString(row.source) || "hanaagent",
    title: cleanString(row.title) || cleanString(row.kind) || "Swarm activity",
    text,
    at: cleanString(row.at) || (timestamp ? new Date(timestamp).toISOString() : ""),
    timestamp,
    missionId: cleanString(row.missionId || assignment?.missionId),
    missionTitle: cleanString(row.missionTitle || assignment?.missionTitle),
    assignmentId: cleanString(row.assignmentId || assignment?.assignmentId),
    workerId: cleanString(row.workerId || assignment?.workerId || row.assignmentId),
    workerName: cleanString(row.workerName || assignment?.assignmentLabel || row.workerId || row.assignmentId || row.agentId),
    agentId: cleanString(row.agentId || assignment?.agentId),
    sessionPath: cleanString(row.sessionPath || assignment?.sessionPath),
    status: cleanString(row.status),
    meta: row.meta || {}
  };
}
function summarizeSwarmActivity(items = []) {
  const byKind = {};
  let latestAt = "";
  for (const item of items) {
    byKind[item.kind] = (byKind[item.kind] || 0) + 1;
    if (!latestAt || item.timestamp > activityTimestamp(latestAt)) latestAt = item.at;
  }
  return {
    total: items.length,
    byKind,
    blockers: items.filter((item) => item.kind === "blocker" || item.status === "blocked").length,
    review: items.filter((item) => item.status === "review" || item.status === "NEEDS_REVIEW").length,
    latestAt
  };
}

function sumBucketTokens(map) {
  let total = 0;
  for (const bucket of map.values()) total += Number(bucket.summary?.totalTokens || 0);
  return total;
}

export function buildWorkerCards(agents, sessions, tasks, checkpoints, missions = []) {
  const cards = [];
  const activeCheckpoints = (Array.isArray(checkpoints) ? checkpoints : [])
    .filter((checkpoint) => !checkpoint.superseded)
    .sort((a, b) => Number(b.accepted === true) - Number(a.accepted === true) || String(b.createdAt).localeCompare(String(a.createdAt)));
  const agentList = Array.isArray(agents) ? agents : [];
  const sessionList = Array.isArray(sessions) ? sessions : [];
  const assignments = Array.isArray(missions)
    ? missions.flatMap((mission) => mission.assignments.map((assignment) => ({ ...assignment, missionId: mission.id, missionTitle: mission.title, missionState: mission.state })))
    : [];
  for (const agent of agentList) {
    const agentSessions = sessionList.filter((session) => session.agentId === agent.id || session.agentName === agent.name);
    const fallbackSessions = agentSessions.length ? agentSessions : sessionList.filter((session) => !session.agentId && !session.agentName);
    const relatedSessions = fallbackSessions.slice(0, 5);
    const sessionPaths = new Set(relatedSessions.map((session) => session.path));
    const relatedTasks = tasks.filter((task) => task.assignee === agent.id || sessionPaths.has(task.sessionPath));
    const latestCheckpoint = activeCheckpoints.find((checkpoint) => checkpoint.agentId === agent.id || sessionPaths.has(checkpoint.sessionPath)) || null;
    const activeTask = relatedTasks.find((task) => task.column === "running") || relatedTasks.find((task) => task.column === "blocked") || relatedTasks[0] || null;
    const activeAssignment = assignments.find((assignment) => assignment.agentId === agent.id || sessionPaths.has(assignment.sessionPath) || assignment.taskId === activeTask?.id) || null;
    cards.push({
      id: agent.id || agent.name,
      name: agent.name,
      agentId: agent.id,
      status: latestCheckpoint?.state || (activeTask ? activeTask.column : "idle"),
      sessionCount: relatedSessions.length,
      taskCount: relatedTasks.length,
      activeTask,
      activeAssignment,
      latestCheckpoint,
      sessions: relatedSessions
    });
  }
  if (!cards.length && assignments.length) {
    for (const assignment of assignments.slice(0, 8)) {
      const task = tasks.find((item) => item.id === assignment.taskId) || null;
      cards.push({
        id: assignment.id,
        name: assignment.label,
        agentId: assignment.agentId,
        status: assignment.state,
        sessionCount: assignment.sessionPath ? 1 : 0,
        taskCount: task ? 1 : 0,
        activeTask: task,
        activeAssignment: assignment,
        latestCheckpoint: activeCheckpoints.find((checkpoint) => checkpoint.taskId === assignment.taskId) || null,
        sessions: []
      });
    }
  }
  return cards;
}

export function buildWorkerDrilldown(overview, workerId) {
  const id = cleanString(workerId);
  if (!id) return { ok: false, error: "workerId_required" };
  const workerCards = Array.isArray(overview?.workerCards) ? overview.workerCards : [];
  const worker = workerCards.find((card) => card.id === id || card.agentId === id || card.activeAssignment?.id === id);
  const agents = Array.isArray(overview?.agents) ? overview.agents : [];
  const sessions = Array.isArray(overview?.sessions) ? overview.sessions : [];
  const tasks = Array.isArray(overview?.tasks) ? overview.tasks : [];
  const checkpoints = Array.isArray(overview?.checkpoints) ? overview.checkpoints : [];
  const missions = Array.isArray(overview?.missions) ? overview.missions : [];
  const runRecords = Array.isArray(overview?.runRecords) ? overview.runRecords : [];
  const handoffs = Array.isArray(overview?.handoffs) ? overview.handoffs : [];
  const hostTasks = Array.isArray(overview?.hostTasks) ? overview.hostTasks : [];
  const deferredTasks = Array.isArray(overview?.deferredTasks) ? overview.deferredTasks : [];
  const usageEntries = Array.isArray(overview?.usage?.entries) ? overview.usage.entries : [];
  const assignments = missions.flatMap((mission) => (mission.assignments || []).map((assignment) => ({
    ...assignment,
    missionId: mission.id,
    missionTitle: mission.title,
    missionState: mission.state
  })));
  const directAssignment = assignments.find((assignment) => assignment.id === id);
  const agent = agents.find((item) => item.id === id || item.id === worker?.agentId) || null;
  const assignment = directAssignment || worker?.activeAssignment || null;
  const sessionPathSet = new Set([
    ...(Array.isArray(worker?.sessions) ? worker.sessions.map((session) => session.path) : []),
    assignment?.sessionPath,
    ...sessions.filter((session) => agent && (session.agentId === agent.id || session.agentName === agent.name)).map((session) => session.path)
  ].filter(Boolean));
  const assignmentIds = new Set([
    assignment?.id,
    ...(agent ? assignments.filter((item) => item.agentId === agent.id || sessionPathSet.has(item.sessionPath)).map((item) => item.id) : [])
  ].filter(Boolean));
  const taskIds = new Set([
    assignment?.taskId,
    ...tasks.filter((task) => assignmentIds.has(task.assignmentId) || sessionPathSet.has(task.sessionPath) || (agent && task.assignee === agent.id)).map((task) => task.id || task.taskId)
  ].filter(Boolean));
  const relatedSessions = sessions.filter((session) => sessionPathSet.has(session.path));
  const relatedTasks = tasks.filter((task) => taskIds.has(task.id || task.taskId) || assignmentIds.has(task.assignmentId) || sessionPathSet.has(task.sessionPath) || (agent && task.assignee === agent.id));
  const relatedCheckpoints = checkpoints.filter((checkpoint) => taskIds.has(checkpoint.taskId) || sessionPathSet.has(checkpoint.sessionPath) || (agent && checkpoint.agentId === agent.id));
  const relatedRunRecords = runRecords.filter((record) => assignmentIds.has(record.assignmentId) || taskIds.has(record.taskId) || sessionPathSet.has(record.sessionPath) || (agent && record.agentId === agent.id));
  const relatedHandoffs = handoffs.filter((handoff) => assignmentIds.has(handoff.assignmentId) || taskIds.has(handoff.taskId) || sessionPathSet.has(handoff.sessionPath) || (agent && handoff.agentId === agent.id) || handoff.workerId === cleanString(assignment?.id || worker?.id || id));
  const relatedHostTasks = hostTasks.filter((task) => {
    const meta = task.meta || {};
    return assignmentIds.has(meta.assignmentId)
      || taskIds.has(meta.taskId)
      || taskIds.has(meta.localTaskId)
      || taskIds.has(task.localTaskId)
      || sessionPathSet.has(task.parentSessionPath || task.sessionPath)
      || (agent && task.agentId === agent.id);
  });
  const relatedDeferredTasks = deferredTasks.filter((task) => sessionPathSet.has(task.sessionPath) || taskIds.has(task.taskId || task.id));
  const relatedUsage = usageEntries.filter((entry) => {
    const attribution = entry.usageContext?.attribution || {};
    return sessionPathSet.has(attribution.sessionPath || entry.sessionPath) || (agent && (attribution.agentId === agent.id || entry.agentId === agent.id));
  });
  const usage = {
    entries: relatedUsage,
    summary: summarizeUsageLike(relatedUsage)
  };

  const resolvedWorker = worker || {
    id: assignment?.id || agent?.id || id,
    name: assignment?.label || agent?.name || id,
    agentId: agent?.id || assignment?.agentId || "",
    status: assignment?.state || "unknown",
    activeAssignment: assignment,
    activeTask: relatedTasks[0] || null,
    latestCheckpoint: relatedCheckpoints[0] || null,
    sessions: relatedSessions
  };
  if (!worker && !agent && !assignment && !relatedSessions.length && !relatedTasks.length) {
    return { ok: false, error: "worker_not_found", workerId: id };
  }
  const lifecycle = buildWorkerLifecycle({
    worker: resolvedWorker,
    agent,
    assignment,
    sessions: relatedSessions,
    tasks: relatedTasks,
    checkpoints: relatedCheckpoints,
    runRecords: relatedRunRecords,
    handoffs: relatedHandoffs,
    hostTasks: relatedHostTasks,
    deferredTasks: relatedDeferredTasks,
    usage,
    policy: overview?.config?.workerLifecyclePolicy
  });
  const ide = buildWorkerIdeSnapshot({
    worker: resolvedWorker,
    agent,
    assignment,
    sessions: relatedSessions,
    tasks: relatedTasks,
    checkpoints: relatedCheckpoints,
    runRecords: relatedRunRecords,
    handoffs: relatedHandoffs,
    hostTasks: relatedHostTasks,
    deferredTasks: relatedDeferredTasks,
    usage,
    lifecycle,
    workspaceRoots: overview.workspaceRoots || overview.overview?.sections?.workspaceFiles?.items || [],
    terminalAvailable: Boolean(overview.capabilities?.terminal)
  });
  const workerArtifacts = buildWorkerArtifacts(overview, {
    workerId: resolvedWorker.id || id,
    assignmentId: assignment?.id || "",
    limit: 20
  });
  const workerArtifactBuckets = workerArtifacts.items.length ? workerArtifacts : buildWorkerArtifacts(overview, {
    workerId: id,
    limit: 20
  });
  return {
    ok: true,
    workerId: id,
    worker: resolvedWorker,
    ide,
    lifecycle,
    agent,
    assignment,
    sessions: relatedSessions,
    tasks: relatedTasks,
    checkpoints: relatedCheckpoints,
    runRecords: relatedRunRecords,
    workerArtifacts: workerArtifactBuckets,
    handoffs: relatedHandoffs,
    hostTasks: relatedHostTasks,
    deferredTasks: relatedDeferredTasks,
    usage,
    summary: {
      sessions: relatedSessions.length,
      tasks: relatedTasks.length,
      checkpoints: relatedCheckpoints.length,
      runRecords: relatedRunRecords.length,
      artifacts: workerArtifactBuckets.summary?.artifacts || 0,
      previews: workerArtifactBuckets.summary?.previews || 0,
      changedFiles: workerArtifactBuckets.summary?.changedFiles || 0,
      handoffs: relatedHandoffs.length,
      hostTasks: relatedHostTasks.length,
      deferredTasks: relatedDeferredTasks.length,
      usageTokens: usage.summary.totalTokens
    }
  };
}

function summarizeUsageLike(entries = []) {
  const summary = {
    count: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0
  };
  for (const entry of Array.isArray(entries) ? entries : []) {
    const usage = entry.usage || entry;
    const prompt = Number(usage.prompt_tokens ?? usage.promptTokens ?? 0) || 0;
    const completion = Number(usage.completion_tokens ?? usage.completionTokens ?? 0) || 0;
    summary.count += 1;
    summary.promptTokens += prompt;
    summary.completionTokens += completion;
    summary.totalTokens += Number(usage.total_tokens ?? usage.totalTokens ?? prompt + completion) || 0;
    summary.costUsd += Number(entry.costUsd ?? entry.cost_usd ?? 0) || 0;
  }
  return summary;
}
