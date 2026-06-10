import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const VALID_MISSION_STATES = new Set(["draft", "planning", "active", "paused", "complete", "cancelled", "blocked"]);
const VALID_MISSION_PHASES = new Set(["home", "preview", "active", "complete"]);
const VALID_ASSIGNMENT_STATES = new Set(["queued", "running", "checkpointed", "blocked", "review", "done", "cancelled"]);
const MAX_MISSION_WORKERS = 24;

const ROSTER_METADATA_FIELDS = [
  "specialty",
  "model",
  "mission",
  "profile",
  "modes",
  "tools",
  "skills",
  "capabilities",
  "preferredTaskTypes",
  "greenlightRequiredFor",
  "maxConcurrentTasks",
  "acceptsBroadcast",
  "reviewRequired",
  "plugins",
  "pluginToolsets",
  "mcpServers",
  "wrapper",
  "defaultCwd"
];

const DEFAULT_ROLES = [
  {
    id: "orchestrator",
    label: "编排",
    lane: "orchestrate",
    summary: "拆解目标、明确执行顺序、维护 mission 事件。",
    priority: "high"
  },
  {
    id: "builder",
    label: "构建",
    lane: "build",
    summary: "完成主要实现或交付物，并给出验证证据。",
    priority: "high"
  },
  {
    id: "reviewer",
    label: "复核",
    lane: "review",
    summary: "检查缺陷、风险、遗漏测试和发布阻塞。",
    priority: "medium"
  },
  {
    id: "qa",
    label: "验证",
    lane: "qa",
    summary: "运行或设计验收检查，记录命令和结果。",
    priority: "medium"
  },
  {
    id: "scribe",
    label: "记录",
    lane: "handoff",
    summary: "沉淀交付说明、操作方式、风险和下一步。",
    priority: "low"
  }
];

export function getMissionRoles() {
  return DEFAULT_ROLES.map((role) => ({ ...role }));
}

export function listMissions(dataDir, filters = {}) {
  let missions = readMissionFile(dataDir).missions.map(normalizeMission).filter(Boolean);
  if (filters.state) missions = missions.filter((mission) => mission.state === normalizeMissionState(filters.state));
  if (filters.includeArchived !== true) missions = missions.filter((mission) => !["cancelled"].includes(mission.state));
  return missions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getMission(dataDir, missionId) {
  return readMissionFile(dataDir).missions.map(normalizeMission).filter(Boolean).find((mission) => mission.id === missionId) || null;
}

export function createMission(dataDir, input = {}) {
  const title = clean(input.title) || clean(input.name) || clip(clean(input.goal || input.mission), 80);
  const goal = clean(input.goal || input.mission || input.title);
  if (!goal) return { ok: false, error: "goal_required" };

  const now = new Date().toISOString();
  const roles = selectRoles(input);
  const missionId = clean(input.id) || randomUUID();
  const assignments = roles.map((role, index) => normalizeAssignment({
    id: `${missionId}-${role.id}`,
    roleId: role.id,
    label: role.label,
    lane: role.lane,
    task: buildAssignmentTask(goal, role, input),
    rationale: role.summary,
    state: index === 0 ? "running" : "queued",
    taskId: null,
    sessionPath: clean(resolveLaneValue(input, role, index, "sessionPath") || input.sessionPath) || null,
    agentId: clean(resolveLaneValue(input, role, index, "agentId") || input.agentId) || null,
    cwd: clean(resolveLaneValue(input, role, index, "cwd") || input.cwd || input.defaultCwd) || null,
    priority: role.priority,
    roster: role.roster || {},
    position: index,
    createdAt: now,
    updatedAt: now
  })).filter(Boolean);

  const mission = normalizeMission({
    id: missionId,
    title: title || "Untitled mission",
    goal,
    notes: clean(input.notes),
    mode: clean(input.mode) || "dispatch",
    templateId: clean(input.templateId) || "orchestrate",
    templateLabel: clean(input.templateLabel) || null,
    state: clean(input.state) || "active",
    phase: clean(input.phase) || "preview",
    createdBy: clean(input.createdBy) || "hanaagent-conductor",
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    completedAt: null,
    totalTokens: 0,
    summary: "",
    sessionPath: clean(input.sessionPath) || null,
    agentId: clean(input.agentId) || null,
    assignments,
    events: [
      event("mission_created", "Mission created", { mode: clean(input.mode) || "dispatch" }),
      event("assignments_planned", `${assignments.length} assignments planned`, {
        assignmentIds: assignments.map((assignment) => assignment.id)
      })
    ]
  });

  const file = readMissionFile(dataDir);
  file.missions.push(mission);
  writeMissionFile(dataDir, { missions: file.missions.map(normalizeMission).filter(Boolean) });
  return { ok: true, mission };
}

export function updateMission(dataDir, missionId, updates = {}) {
  const file = readMissionFile(dataDir);
  const index = file.missions.findIndex((mission) => normalizeMission(mission)?.id === missionId);
  if (index === -1) return { ok: false, error: "mission_not_found" };

  const current = normalizeMission(file.missions[index]);
  const next = normalizeMission({
    ...current,
    ...(typeof updates.title === "string" ? { title: updates.title } : {}),
    ...(typeof updates.goal === "string" || typeof updates.mission === "string" ? { goal: updates.goal || updates.mission } : {}),
    ...(typeof updates.notes === "string" ? { notes: updates.notes } : {}),
    ...(typeof updates.state === "string" ? { state: updates.state } : {}),
    ...(typeof updates.phase === "string" ? { phase: updates.phase } : {}),
    ...(typeof updates.summary === "string" ? { summary: updates.summary } : {}),
    ...(Number.isFinite(Number(updates.totalTokens)) ? { totalTokens: Number(updates.totalTokens) } : {}),
    ...(typeof updates.sessionPath === "string" ? { sessionPath: updates.sessionPath } : {}),
    ...(typeof updates.agentId === "string" ? { agentId: updates.agentId } : {}),
    updatedAt: new Date().toISOString()
  });
  file.missions[index] = next;
  writeMissionFile(dataDir, { missions: file.missions.map(normalizeMission).filter(Boolean) });
  return { ok: true, mission: next };
}

export function updateMissionAssignment(dataDir, missionId, assignmentId, updates = {}) {
  const file = readMissionFile(dataDir);
  const missions = file.missions.map(normalizeMission).filter(Boolean);
  const mission = missions.find((item) => item.id === missionId);
  if (!mission) return { ok: false, error: "mission_not_found" };
  const assignment = mission.assignments.find((item) => item.id === assignmentId);
  if (!assignment) return { ok: false, error: "assignment_not_found" };

  const previousState = assignment.state;
  if (typeof updates.state === "string") assignment.state = normalizeAssignmentState(updates.state);
  if (typeof updates.output === "string") assignment.output = clean(updates.output);
  if (typeof updates.result === "string") assignment.result = clean(updates.result);
  if (typeof updates.blocker === "string") assignment.blocker = clean(updates.blocker);
  if (typeof updates.nextAction === "string") assignment.nextAction = clean(updates.nextAction);
  if (Number.isFinite(Number(updates.tokenCount))) assignment.tokenCount = Math.max(0, Math.round(Number(updates.tokenCount)));
  if (typeof updates.sessionPath === "string") assignment.sessionPath = clean(updates.sessionPath) || null;
  if (typeof updates.agentId === "string") assignment.agentId = clean(updates.agentId) || null;

  const now = new Date().toISOString();
  assignment.updatedAt = now;
  mission.updatedAt = now;
  mission.state = deriveMissionState(mission.assignments);
  mission.phase = deriveMissionPhase(mission);
  mission.totalTokens = sumAssignmentTokens(mission.assignments);
  if (mission.state === "complete" && !mission.completedAt) {
    mission.completedAt = now;
    mission.summary = mission.summary || buildMissionSummary(mission);
    mission.events.push(event("mission_completed", "Mission completed", { totalTokens: mission.totalTokens }));
  }
  mission.events.push(event("assignment_updated", `${assignment.label}: ${previousState} -> ${assignment.state}`, {
    assignmentId,
    previousState,
    state: assignment.state
  }));
  writeMissionFile(dataDir, { missions: upsertMission(missions, mission) });
  return { ok: true, mission, assignment };
}

export function stopMission(dataDir, missionId, input = {}) {
  const file = readMissionFile(dataDir);
  const missions = file.missions.map(normalizeMission).filter(Boolean);
  const mission = missions.find((item) => item.id === missionId);
  if (!mission) return { ok: false, error: "mission_not_found" };
  const now = new Date().toISOString();
  for (const assignment of mission.assignments) {
    if (!["done", "cancelled"].includes(assignment.state)) {
      assignment.state = "cancelled";
      assignment.updatedAt = now;
    }
  }
  mission.state = "cancelled";
  mission.phase = "complete";
  mission.completedAt = mission.completedAt || now;
  mission.updatedAt = now;
  mission.summary = mission.summary || buildMissionSummary(mission);
  mission.events.push(event("mission_stopped", clean(input.reason) || "Mission stopped", { reason: clean(input.reason) }));
  writeMissionFile(dataDir, { missions: upsertMission(missions, mission) });
  return { ok: true, mission };
}

export function completeMission(dataDir, missionId, input = {}) {
  const file = readMissionFile(dataDir);
  const missions = file.missions.map(normalizeMission).filter(Boolean);
  const mission = missions.find((item) => item.id === missionId);
  if (!mission) return { ok: false, error: "mission_not_found" };
  const now = new Date().toISOString();
  for (const assignment of mission.assignments) {
    if (!["done", "cancelled"].includes(assignment.state)) {
      assignment.state = "done";
      assignment.updatedAt = now;
    }
  }
  mission.state = "complete";
  mission.phase = "complete";
  mission.completedAt = mission.completedAt || now;
  mission.updatedAt = now;
  mission.totalTokens = sumAssignmentTokens(mission.assignments);
  mission.summary = clean(input.summary) || mission.summary || buildMissionSummary(mission);
  mission.events.push(event("mission_completed", "Mission marked complete", { totalTokens: mission.totalTokens }));
  writeMissionFile(dataDir, { missions: upsertMission(missions, mission) });
  return { ok: true, mission };
}

export function linkMissionAssignmentTask(dataDir, missionId, assignmentId, taskId) {
  const file = readMissionFile(dataDir);
  const mission = file.missions.map(normalizeMission).filter(Boolean).find((item) => item.id === missionId);
  if (!mission) return { ok: false, error: "mission_not_found" };
  const assignment = mission.assignments.find((item) => item.id === assignmentId);
  if (!assignment) return { ok: false, error: "assignment_not_found" };
  assignment.taskId = clean(taskId) || null;
  assignment.updatedAt = new Date().toISOString();
  mission.updatedAt = assignment.updatedAt;
  mission.events.push(event("assignment_linked", `Linked ${assignment.label} to task`, { assignmentId, taskId: assignment.taskId }));
  writeMissionFile(dataDir, { missions: upsertMission(file.missions, mission) });
  return { ok: true, mission, assignment };
}

export function updateMissionFromCheckpoint(dataDir, input = {}) {
  const taskId = clean(input.taskId);
  const state = clean(input.state).toUpperCase();
  if (!taskId || !state) return { ok: false, error: "taskId_state_required" };

  const file = readMissionFile(dataDir);
  const missions = file.missions.map(normalizeMission).filter(Boolean);
  const mission = missions.find((item) => item.assignments.some((assignment) => assignment.taskId === taskId));
  if (!mission) return { ok: false, error: "mission_not_found" };
  const assignment = mission.assignments.find((item) => item.taskId === taskId);
  if (!assignment) return { ok: false, error: "assignment_not_found" };

  assignment.state = checkpointStateToAssignmentState(state);
  assignment.result = clean(input.result) || assignment.result;
  assignment.blocker = clean(input.blocker) || assignment.blocker;
  assignment.nextAction = clean(input.nextAction) || assignment.nextAction;
  assignment.output = clean(input.rawText || input.output) || assignment.output;
  if (Number.isFinite(Number(input.tokenCount))) assignment.tokenCount = Math.max(0, Math.round(Number(input.tokenCount)));
  assignment.updatedAt = new Date().toISOString();
  mission.updatedAt = assignment.updatedAt;
  mission.events.push(event("checkpoint", `${assignment.label}: ${state}`, {
    assignmentId: assignment.id,
    taskId,
    state,
    result: clean(input.result),
    blocker: clean(input.blocker),
    nextAction: clean(input.nextAction)
  }));
  mission.state = deriveMissionState(mission.assignments);
  mission.phase = deriveMissionPhase(mission);
  mission.totalTokens = sumAssignmentTokens(mission.assignments);
  if (mission.state === "complete") {
    mission.completedAt = mission.completedAt || assignment.updatedAt;
    mission.summary = mission.summary || buildMissionSummary(mission);
    mission.events.push(event("mission_completed", "Mission completed", { totalTokens: mission.totalTokens }));
  }
  writeMissionFile(dataDir, { missions: upsertMission(missions, mission) });
  return { ok: true, mission, assignment };
}

export function appendMissionEvent(dataDir, missionId, input = {}) {
  const file = readMissionFile(dataDir);
  const mission = file.missions.map(normalizeMission).filter(Boolean).find((item) => item.id === missionId);
  if (!mission) return { ok: false, error: "mission_not_found" };
  mission.events.push(event(clean(input.type) || "note", clean(input.label) || clean(input.message) || "Mission event", input.meta || {}));
  mission.updatedAt = new Date().toISOString();
  writeMissionFile(dataDir, { missions: upsertMission(file.missions, mission) });
  return { ok: true, mission };
}

export function buildConductorPrompt({ mission, assignment, checkpointContract = [] }) {
  const contract = Array.isArray(checkpointContract) && checkpointContract.length
    ? checkpointContract
    : [
        "STATE: DONE | BLOCKED | NEEDS_INPUT | HANDOFF | IN_PROGRESS | NEEDS_REVIEW",
        "FILES_CHANGED: exact paths or none",
        "COMMANDS_RUN: exact commands or none",
        "RESULT: concrete result/proof",
        "BLOCKER: blocker or none",
        "NEXT_ACTION: exact recommended next action"
      ];
  const brief = buildSwarmBrief({ mission, assignment, checkpointContract: contract });
  const lines = [
    "你是 Hanaco Conductor 指挥台中的 worker。",
    "",
    "SwarmBrief:",
    "```yaml",
    formatSwarmBrief(brief),
    "```",
    "",
    `Mission: ${mission.title}`,
    `Mission ID: ${mission.id}`,
    "",
    "总体目标：",
    mission.goal,
    ""
  ];
  if (mission.notes) lines.push("补充上下文：", mission.notes, "");
  lines.push(
    `你的角色：${assignment.label}`,
    `Assignment ID: ${assignment.id}`,
    "",
    "你的任务：",
    assignment.task,
    "",
    "执行要求：",
    "- 只处理自己 assignment 的边界，必要时指出依赖和阻塞。",
    "- 输出具体证据，包括文件、命令、结果或需要用户确认的问题。",
    "- 回复末尾必须附带 checkpoint 合约块。",
    "",
    "Checkpoint 合约：",
    ...contract
  );
  return lines.join("\n");
}

export function buildMissionBriefs(mission, options = {}) {
  const normalized = normalizeMission(mission);
  if (!normalized) return [];
  return normalized.assignments.map((assignment) => buildSwarmBrief({
    mission: normalized,
    assignment,
    checkpointContract: options.checkpointContract
  }));
}

export function buildSwarmBrief({ mission, assignment, checkpointContract = [] } = {}) {
  const normalizedMission = normalizeMission(mission);
  const normalizedAssignment = normalizeAssignment(assignment);
  if (!normalizedMission || !normalizedAssignment) return null;
  const roster = normalizedAssignment.roster || {};
  const contract = Array.isArray(checkpointContract) && checkpointContract.length
    ? checkpointContract
    : [
        "STATE: DONE | BLOCKED | NEEDS_INPUT | HANDOFF | IN_PROGRESS | NEEDS_REVIEW",
        "FILES_CHANGED: exact paths or none",
        "COMMANDS_RUN: exact commands or none",
        "RESULT: concrete result/proof",
        "BLOCKER: blocker or none",
        "NEXT_ACTION: exact recommended next action"
      ];
  const cwd = clean(roster.defaultCwd) || normalizedAssignment.cwd || normalizedMission.cwd || "";
  const project = clean(roster.project)
    || clean(roster.profile)
    || (cwd ? path.basename(cwd) : "")
    || normalizedMission.title
    || normalizedMission.id;
  const worker = clean(roster.id)
    || normalizedAssignment.roleId
    || normalizedAssignment.label
    || normalizedAssignment.id;
  const brief = {
    brief_id: `brief-${briefTimestamp(normalizedMission.createdAt)}-${slug(`${normalizedMission.id}-${normalizedAssignment.id}`)}`,
    worker,
    project,
    goal: normalizedMission.goal,
    why_now: normalizedMission.notes || `Created by ${normalizedMission.createdBy} in ${normalizedMission.mode} mode.`,
    scope: compactList([
      `Assignment boundary: ${firstLine(normalizedAssignment.task || normalizedAssignment.rationale) || normalizedAssignment.label}`,
      normalizedAssignment.lane ? `Lane: ${normalizedAssignment.lane}` : "",
      normalizedAssignment.cwd || cwd ? `Working directory: ${normalizedAssignment.cwd || cwd}` : ""
    ]),
    deliverables: compactList([
      inferDeliverable(normalizedAssignment),
      "Checkpoint with files changed, commands run, proof, blockers, and next action.",
      Array.isArray(roster.skills) && roster.skills.length ? `Use relevant skills: ${roster.skills.join(", ")}` : ""
    ]),
    test_or_proof: compactList([
      "Run or name the narrowest meaningful verification for this assignment.",
      "Include exact commands, artifact paths, screenshots, review notes, or byte/file evidence.",
      normalizedAssignment.priority === "high" || roster.reviewRequired === true ? "Mark NEEDS_REVIEW when evidence requires operator or reviewer judgment." : ""
    ]),
    constraints: compactList([
      "Stay inside the assignment scope; report dependency conflicts instead of widening scope silently.",
      "Do not perform irreversible or externally visible actions without explicit Greenlight.",
      Array.isArray(roster.greenlightRequiredFor) && roster.greenlightRequiredFor.length ? `Greenlight required for: ${roster.greenlightRequiredFor.join(", ")}` : "",
      Array.isArray(roster.tools) && roster.tools.length ? `Available tools: ${roster.tools.join(", ")}` : "",
      Array.isArray(roster.capabilities) && roster.capabilities.length ? `Capabilities: ${roster.capabilities.join(", ")}` : ""
    ]),
    checkpoint_contract: checkpointContractObject(contract),
    escalation: {
      on_blocked: "Return STATE: BLOCKED or NEEDS_INPUT with exact blocker and requested decision.",
      on_done: "Return STATE: DONE with concrete proof, files changed, commands run, and next action."
    },
    budget: {
      wall_clock_hours: Number.isFinite(Number(roster.wallClockHours || roster.wall_clock_hours)) ? Number(roster.wallClockHours || roster.wall_clock_hours) : 2,
      max_concurrent_tasks: Number.isFinite(Number(roster.maxConcurrentTasks)) ? Number(roster.maxConcurrentTasks) : 1
    }
  };
  const workerContext = {};
  for (const key of ["model", "specialty", "profile", "wrapper", "mission"]) {
    if (roster[key]) workerContext[key] = roster[key];
  }
  for (const key of ["tools", "skills", "modes", "plugins", "pluginToolsets", "mcpServers", "preferredTaskTypes"]) {
    if (Array.isArray(roster[key]) && roster[key].length) workerContext[key] = roster[key];
  }
  if (roster.acceptsBroadcast === true || roster.acceptsBroadcast === false) workerContext.acceptsBroadcast = roster.acceptsBroadcast;
  if (roster.reviewRequired === true || roster.reviewRequired === false) workerContext.reviewRequired = roster.reviewRequired;
  if (Object.keys(workerContext).length) brief.worker_context = workerContext;
  return brief;
}

export function formatSwarmBrief(brief) {
  if (!brief || typeof brief !== "object") return "";
  return yamlLines(brief).join("\n");
}

export function buildMissionReport(mission) {
  const normalized = normalizeMission(mission);
  if (!normalized) return "";
  const stats = missionStats(normalized);
  const durationMs = Math.max(0, new Date(normalized.completedAt || normalized.updatedAt || normalized.createdAt).getTime() - new Date(normalized.startedAt || normalized.createdAt).getTime());
  const lines = [
    "# Mission Report",
    "",
    `**Goal:** ${normalized.goal}`,
    `**Status:** ${normalized.state}`,
    `**Team:** ${normalized.assignments.length}-worker team`,
    `**Started:** ${formatDate(normalized.startedAt)}`,
    `**Completed:** ${formatDate(normalized.completedAt || normalized.updatedAt)}`,
    `**Duration:** ${formatDuration(durationMs)}`,
    `**Outcome:** ${missionOutcome(normalized, stats)}`,
    "",
    "## Executive Summary",
    normalized.summary || buildMissionSummary(normalized),
    "",
    "## Tasks",
    `- Total: ${stats.total}`,
    `- Done: ${stats.done}`,
    `- Blocked: ${stats.blocked}`,
    `- Review: ${stats.review}`,
    `- Cancelled: ${stats.cancelled}`,
    "",
    "## Worker Summary"
  ];

  if (!normalized.assignments.length) {
    lines.push("*No worker assignments captured*");
  } else {
    for (const assignment of normalized.assignments) {
      lines.push(`### ${assignment.label}`);
      lines.push(`- State: ${assignment.state}`);
      if (assignment.task) lines.push(`- Task: ${firstLine(assignment.task)}`);
      if (assignment.result) lines.push(`- Result: ${assignment.result}`);
      if (assignment.blocker) lines.push(`- Blocker: ${assignment.blocker}`);
      if (assignment.nextAction) lines.push(`- Next action: ${assignment.nextAction}`);
      if (assignment.tokenCount) lines.push(`- Tokens: ${assignment.tokenCount.toLocaleString()}`);
      if (assignment.output && assignment.output !== assignment.result) {
        lines.push("", "```text", clip(assignment.output, 1800), "```");
      }
      lines.push("");
    }
  }

  lines.push("## Event Timeline");
  if (!normalized.events.length) {
    lines.push("*No events captured*");
  } else {
    for (const eventEntry of normalized.events.slice(-30)) {
      lines.push(`- ${formatDate(eventEntry.at)} — ${eventEntry.type}: ${eventEntry.label}`);
    }
  }
  lines.push("", "## Cost Estimate", `- Tokens: ${normalized.totalTokens.toLocaleString()}`, `- Estimated cost: $${estimateMissionCost(normalized.totalTokens).toFixed(4)}`);
  return lines.join("\n");
}

export function buildMissionExport(mission) {
  const normalized = normalizeMission(mission);
  if (!normalized) return null;
  const report = buildMissionReport(normalized);
  return {
    id: normalized.id,
    name: normalized.title,
    goal: normalized.goal,
    status: normalized.state,
    teamName: `${normalized.assignments.length}-worker team`,
    startedAt: normalized.startedAt,
    completedAt: normalized.completedAt,
    durationMs: Math.max(0, new Date(normalized.completedAt || normalized.updatedAt || normalized.createdAt).getTime() - new Date(normalized.startedAt || normalized.createdAt).getTime()),
    tokenCount: normalized.totalTokens,
    costEstimate: estimateMissionCost(normalized.totalTokens),
    assignments: normalized.assignments,
    events: normalized.events,
    summary: normalized.summary || buildMissionSummary(normalized),
    report
  };
}

export function buildContinuationPrompt(mission, instructions = "") {
  const normalized = normalizeMission(mission);
  if (!normalized) return "";
  const summary = normalized.summary || buildMissionSummary(normalized);
  const workerLines = normalized.assignments
    .filter((assignment) => assignment.result || assignment.output || assignment.nextAction || assignment.blocker)
    .slice(0, 8)
    .map((assignment) => `- ${assignment.label} [${assignment.state}]: ${assignment.result || assignment.nextAction || assignment.blocker || firstLine(assignment.output)}`);
  return [
    "CONTINUATION OF PREVIOUS MISSION",
    `Original mission id: ${normalized.id}`,
    `Original goal: ${normalized.goal}`,
    "",
    "Previous output summary:",
    clip(summary, 1800),
    "",
    workerLines.length ? "Worker notes:" : "",
    ...workerLines,
    "",
    "New instructions:",
    clean(instructions) || "Continue building on the previous work.",
    "",
    "Please continue from the existing state, preserve completed work, call out blockers, and end with the checkpoint contract."
  ].filter((line) => line !== "").join("\n");
}

function selectRoles(input) {
  const maxWorkers = clampInt(input.maxWorkers || input.maxParallel || 4, 1, MAX_MISSION_WORKERS);
  const roleIds = Array.isArray(input.roles) ? input.roles.map((item) => clean(item)).filter(Boolean) : [];
  const dynamicRoles = buildLaneRoles(input, roleIds);
  const pool = dynamicRoles.length
    ? dynamicRoles
    : roleIds.length
      ? DEFAULT_ROLES.filter((role) => roleIds.includes(role.id) || roleIds.includes(role.lane))
      : DEFAULT_ROLES;
  return (pool.length ? pool : DEFAULT_ROLES).slice(0, maxWorkers);
}

function buildAssignmentTask(goal, role, input) {
  const notes = clean(input.notes);
  const mode = clean(input.mode) || "dispatch";
  const rosterLines = buildRosterTaskLines(role.roster);
  return [
    role.summary,
    rosterLines.length ? "" : null,
    ...rosterLines,
    "",
    `目标：${goal}`,
    notes ? `上下文：${notes}` : "",
    `模式：${mode === "review" ? "复核" : mode === "plan" ? "计划" : "执行"}`,
    "",
    "交付标准：给出清晰结论、证据、风险和下一步。"
  ].filter(Boolean).join("\n");
}

function resolveLaneValue(input, role, index, field) {
  const lanes = Array.isArray(input.lanes) ? input.lanes : [];
  const lane = lanes.find((item) => {
    const id = clean(item.id);
    const roleId = clean(item.roleId || item.role_id);
    return id === role.id || id === role.lane || roleId === role.id || roleId === role.lane;
  }) || lanes[index] || null;
  return lane && typeof lane === "object" ? lane[field] : "";
}

function buildLaneRoles(input, roleIds) {
  const lanes = Array.isArray(input.lanes) ? input.lanes.filter((lane) => lane && typeof lane === "object") : [];
  if (!lanes.length) return [];
  const wanted = new Set(roleIds);
  const filtered = wanted.size
    ? lanes.filter((lane) => {
      const id = clean(lane.id);
      const roleId = clean(lane.roleId || lane.role_id || lane.role);
      const profile = clean(lane.profile);
      return wanted.has(id) || wanted.has(roleId) || wanted.has(profile);
    })
    : lanes;
  return filtered.map((lane, index) => roleFromLane(lane, index)).filter(Boolean);
}

function roleFromLane(lane, index) {
  const id = clean(lane.id) || clean(lane.roleId || lane.role_id || lane.profile) || `worker-${index + 1}`;
  if (!id) return null;
  const builtin = DEFAULT_ROLES.find((role) => role.id === id || role.id === clean(lane.roleId || lane.role_id) || role.lane === id);
  const label = clean(lane.label || lane.name) || clean(lane.role) || builtin?.label || id;
  const laneId = clean(lane.lane) || clean(lane.roleId || lane.role_id || lane.profile) || builtin?.lane || id;
  const summary = clean(lane.mission)
    || clean(lane.specialty)
    || clean(lane.rationale)
    || builtin?.summary
    || `Execute the ${label} lane with checkpointed evidence.`;
  return {
    id,
    label,
    lane: laneId,
    summary,
    priority: clean(lane.priority) || builtin?.priority || inferPriority(lane, laneId),
    roster: extractRosterMetadata(lane)
  };
}

function extractRosterMetadata(lane) {
  const roster = {};
  for (const field of ROSTER_METADATA_FIELDS) {
    const value = lane[field] ?? lane[toSnake(field)];
    if (Array.isArray(value)) {
      const array = value.map(clean).filter(Boolean);
      if (array.length) roster[field] = array;
    } else if (typeof value === "boolean") {
      roster[field] = value;
    } else if (Number.isFinite(Number(value)) && ["maxConcurrentTasks"].includes(field)) {
      roster[field] = clampInt(value, 1, 99, 1);
    } else if (clean(value)) {
      roster[field] = clean(value);
    }
  }
  return roster;
}

function buildRosterTaskLines(roster = {}) {
  const lines = [];
  if (roster.specialty) lines.push(`专长：${roster.specialty}`);
  if (roster.model) lines.push(`建议模型：${roster.model}`);
  if (Array.isArray(roster.tools) && roster.tools.length) lines.push(`可用工具：${roster.tools.join(", ")}`);
  if (Array.isArray(roster.skills) && roster.skills.length) lines.push(`技能：${roster.skills.join(", ")}`);
  if (Array.isArray(roster.capabilities) && roster.capabilities.length) lines.push(`能力：${roster.capabilities.join(", ")}`);
  if (Array.isArray(roster.greenlightRequiredFor) && roster.greenlightRequiredFor.length) {
    lines.push(`需要 Greenlight 的动作：${roster.greenlightRequiredFor.join(", ")}`);
  }
  if (roster.wrapper) lines.push(`Wrapper：${roster.wrapper}`);
  return lines;
}

function inferPriority(lane, laneId) {
  const text = `${laneId} ${clean(lane.role)} ${clean(lane.profile)} ${normalizeArrayText(lane.greenlightRequiredFor)}`.toLowerCase();
  if (/orchestr|builder|implement|merge|gate/.test(text)) return "high";
  if (/review|qa|verify|research|ops/.test(text)) return "medium";
  return "low";
}

function deriveMissionState(assignments) {
  if (!assignments.length) return "draft";
  if (assignments.some((assignment) => assignment.state === "blocked")) return "blocked";
  if (assignments.every((assignment) => assignment.state === "done")) return "complete";
  if (assignments.some((assignment) => ["running", "checkpointed", "review"].includes(assignment.state))) return "active";
  return "planning";
}

function deriveMissionPhase(mission) {
  if (mission.state === "complete" || mission.state === "cancelled") return "complete";
  if (mission.state === "planning" || mission.assignments.every((assignment) => assignment.state === "queued")) return "preview";
  if (mission.state === "draft") return "home";
  return "active";
}

function sumAssignmentTokens(assignments) {
  return assignments.reduce((sum, assignment) => sum + (Number.isFinite(Number(assignment.tokenCount)) ? Number(assignment.tokenCount) : 0), 0);
}

function buildMissionSummary(mission) {
  const done = mission.assignments.filter((assignment) => assignment.state === "done").length;
  const blocked = mission.assignments.filter((assignment) => assignment.state === "blocked").length;
  const cancelled = mission.assignments.filter((assignment) => assignment.state === "cancelled").length;
  const lines = [
    `Mission: ${mission.title}`,
    `Status: ${mission.state}`,
    `Assignments: ${done}/${mission.assignments.length} done${blocked ? `, ${blocked} blocked` : ""}${cancelled ? `, ${cancelled} cancelled` : ""}`
  ];
  const outputs = mission.assignments
    .filter((assignment) => assignment.result || assignment.output || assignment.nextAction)
    .slice(0, 8)
    .map((assignment) => `- ${assignment.label}: ${assignment.result || assignment.output || assignment.nextAction}`);
  if (outputs.length) lines.push("Worker outputs:", ...outputs);
  return lines.join("\n");
}

function missionStats(mission) {
  const assignments = Array.isArray(mission.assignments) ? mission.assignments : [];
  return {
    total: assignments.length,
    done: assignments.filter((assignment) => assignment.state === "done").length,
    blocked: assignments.filter((assignment) => assignment.state === "blocked").length,
    review: assignments.filter((assignment) => assignment.state === "review").length,
    cancelled: assignments.filter((assignment) => assignment.state === "cancelled").length
  };
}

function missionOutcome(mission, stats) {
  if (mission.state === "complete" || (stats.total > 0 && stats.done >= stats.total)) return "Complete";
  if (mission.state === "cancelled") return "Stopped";
  if (stats.blocked > 0) return "Blocked";
  return "Partial";
}

function estimateMissionCost(tokens) {
  return (Math.max(0, Number(tokens) || 0) / 1000000) * 5;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return clean(value) || "Unknown";
  return date.toISOString();
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 1) return `${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 1) return `${minutes}m ${seconds}s`;
  return `${hours}h ${remMinutes}m`;
}

function firstLine(value) {
  return clean(value).split(/\r?\n/).find((line) => line.trim()) || "";
}

function inferDeliverable(assignment) {
  const text = `${assignment.task || ""}\n${assignment.rationale || ""}`.toLowerCase();
  if (/doc|readme|文档|记录|handoff|report|报告/.test(text)) return "Updated documentation, report, or handoff artifact with exact path.";
  if (/review|复核|审查|gate|risk|风险/.test(text)) return "Review finding list with severity, file/line evidence, and approval recommendation.";
  if (/test|qa|验证|smoke|proof|验收/.test(text)) return "Verification result with exact command, status, and evidence.";
  if (/build|implement|code|构建|实现|patch|fix/.test(text)) return "Implemented patch or concrete code change with changed paths and verification.";
  return "Concrete assignment result with evidence and next action.";
}

function checkpointContractObject(contract) {
  const states = [];
  const object = {
    state: "DONE|HANDOFF|BLOCKED|NEEDS_REVIEW|NEEDS_INPUT|IN_PROGRESS",
    files_changed: "list exact paths or none",
    commands_run: "list exact commands or none",
    proof: "tests/build/smoke/review evidence",
    next_action: "exact handoff or next step",
    blockers: "exact blocker or none"
  };
  for (const line of contract) {
    const text = clean(line);
    if (!text) continue;
    const [key, ...rest] = text.split(":");
    const normalizedKey = clean(key).toLowerCase();
    const value = clean(rest.join(":"));
    if (normalizedKey === "state" && value) {
      object.state = value.replace(/\s*\|\s*/g, "|");
      states.push(...value.split("|").map(clean).filter(Boolean));
    } else if (normalizedKey === "files_changed" && value) object.files_changed = value;
    else if (normalizedKey === "commands_run" && value) object.commands_run = value;
    else if (normalizedKey === "result" && value) object.proof = value;
    else if (normalizedKey === "next_action" && value) object.next_action = value;
    else if (normalizedKey === "blocker" && value) object.blockers = value;
  }
  if (states.length) object.allowed_states = [...new Set(states)];
  return object;
}

function compactList(items) {
  return items.map(clean).filter(Boolean);
}

function briefTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(Date.now());
  return date.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
}

function slug(value) {
  const text = clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return text || "mission";
}

function yamlLines(value, indent = 0) {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return [`${pad}[]`];
    return value.flatMap((item) => {
      if (item && typeof item === "object") {
        const nested = yamlLines(item, indent + 2);
        return [`${pad}- ${nested[0].trimStart()}`, ...nested.slice(1)];
      }
      return [`${pad}- ${yamlScalar(item)}`];
    });
  }
  if (!value || typeof value !== "object") return [`${pad}${yamlScalar(value)}`];
  const lines = [];
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null || item === "" || (Array.isArray(item) && !item.length)) continue;
    if (item && typeof item === "object") {
      lines.push(`${pad}${key}:`);
      lines.push(...yamlLines(item, indent + 2));
    } else {
      lines.push(`${pad}${key}: ${yamlScalar(item)}`);
    }
  }
  return lines.length ? lines : [`${pad}{}`];
}

function yamlScalar(value) {
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const text = clean(value);
  if (!text) return '""';
  if (/^[A-Za-z0-9_./@:+-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function checkpointStateToAssignmentState(state) {
  if (state === "DONE") return "done";
  if (state === "BLOCKED" || state === "NEEDS_INPUT") return "blocked";
  if (state === "HANDOFF" || state === "NEEDS_REVIEW") return "review";
  if (state === "IN_PROGRESS") return "running";
  return "checkpointed";
}

function readMissionFile(dataDir) {
  ensureMissionFile(dataDir);
  try {
    const raw = fs.readFileSync(missionFilePath(dataDir), "utf8").trim();
    if (!raw) return { missions: [] };
    const parsed = JSON.parse(raw);
    return { missions: Array.isArray(parsed?.missions) ? parsed.missions : [] };
  } catch {
    return { missions: [] };
  }
}

function writeMissionFile(dataDir, data) {
  ensureMissionFile(dataDir);
  const file = missionFilePath(dataDir);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ missions: data.missions || [] }, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function ensureMissionFile(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = missionFilePath(dataDir);
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ missions: [] }, null, 2) + "\n", "utf8");
}

function missionFilePath(dataDir) {
  return path.join(dataDir, "missions.json");
}

function normalizeMission(value) {
  if (!value || typeof value !== "object") return null;
  const id = clean(value.id);
  const goal = clean(value.goal || value.mission);
  if (!id || !goal) return null;
  const createdAt = clean(value.createdAt || value.created_at) || new Date().toISOString();
  const updatedAt = clean(value.updatedAt || value.updated_at) || createdAt;
  const assignments = Array.isArray(value.assignments) ? value.assignments.map(normalizeAssignment).filter(Boolean) : [];
  return {
    id,
    title: clean(value.title || value.name) || clip(goal, 80) || "Untitled mission",
    goal,
    notes: clean(value.notes),
    mode: clean(value.mode) || "dispatch",
    templateId: clean(value.templateId) || "orchestrate",
    templateLabel: clean(value.templateLabel) || null,
    state: normalizeMissionState(value.state),
    phase: normalizeMissionPhase(value.phase || value.conductorPhase || deriveMissionPhase({ state: normalizeMissionState(value.state), assignments })),
    createdBy: clean(value.createdBy || value.created_by) || "hanaagent-conductor",
    createdAt,
    updatedAt,
    startedAt: clean(value.startedAt || value.started_at) || createdAt,
    completedAt: clean(value.completedAt || value.completed_at) || null,
    totalTokens: Number.isFinite(Number(value.totalTokens || value.total_tokens)) ? Math.max(0, Math.round(Number(value.totalTokens || value.total_tokens))) : sumAssignmentTokens(assignments),
    summary: clean(value.summary || value.completeSummary),
    sessionPath: clean(value.sessionPath || value.session_id) || null,
    agentId: clean(value.agentId || value.agent_id) || null,
    cwd: clean(value.cwd) || null,
    assignments,
    events: normalizeEvents(value.events)
  };
}

function normalizeAssignment(value) {
  if (!value || typeof value !== "object") return null;
  const id = clean(value.id);
  const label = clean(value.label || value.roleId || value.role);
  if (!id || !label) return null;
  const createdAt = clean(value.createdAt || value.created_at) || new Date().toISOString();
  const updatedAt = clean(value.updatedAt || value.updated_at) || createdAt;
  return {
    id,
    roleId: clean(value.roleId || value.role_id) || null,
    label,
    lane: clean(value.lane) || clean(value.roleId) || "worker",
    task: clean(value.task || value.prompt),
    rationale: clean(value.rationale),
    state: normalizeAssignmentState(value.state),
    taskId: clean(value.taskId || value.task_id) || null,
    sessionPath: clean(value.sessionPath || value.session_id) || null,
    agentId: clean(value.agentId || value.agent_id) || null,
    cwd: clean(value.cwd) || null,
    priority: clean(value.priority) || "medium",
    roster: normalizeRosterMetadata(value.roster),
    output: clean(value.output),
    result: clean(value.result),
    blocker: clean(value.blocker),
    nextAction: clean(value.nextAction || value.next_action),
    tokenCount: Number.isFinite(Number(value.tokenCount || value.token_count)) ? Math.max(0, Math.round(Number(value.tokenCount || value.token_count))) : 0,
    position: Number.isFinite(Number(value.position)) ? Number(value.position) : 0,
    createdAt,
    updatedAt
  };
}

function normalizeEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.map((item) => {
    if (!item || typeof item !== "object") return null;
    const id = clean(item.id) || randomUUID();
    const type = clean(item.type) || "note";
    const label = clean(item.label || item.message);
    if (!label) return null;
    return {
      id,
      type,
      label,
      at: clean(item.at || item.createdAt) || new Date().toISOString(),
      meta: item.meta && typeof item.meta === "object" ? item.meta : {}
    };
  }).filter(Boolean);
}

function event(type, label, meta = {}) {
  return {
    id: randomUUID(),
    type,
    label,
    at: new Date().toISOString(),
    meta: meta && typeof meta === "object" ? meta : {}
  };
}

function normalizeMissionState(value) {
  const state = clean(value).toLowerCase();
  return VALID_MISSION_STATES.has(state) ? state : "active";
}

function normalizeMissionPhase(value) {
  const phase = clean(value).toLowerCase();
  return VALID_MISSION_PHASES.has(phase) ? phase : "active";
}

function normalizeAssignmentState(value) {
  const state = clean(value).toLowerCase();
  if (state === "in_progress") return "running";
  return VALID_ASSIGNMENT_STATES.has(state) ? state : "queued";
}

function normalizeRosterMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const roster = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalizedKey = clean(key);
    if (!normalizedKey) continue;
    if (Array.isArray(raw)) {
      const array = raw.map(clean).filter(Boolean).slice(0, 80);
      if (array.length) roster[normalizedKey] = array;
    } else if (typeof raw === "boolean") {
      roster[normalizedKey] = raw;
    } else if (Number.isFinite(Number(raw))) {
      roster[normalizedKey] = Number(raw);
    } else if (clean(raw)) {
      roster[normalizedKey] = clean(raw);
    }
  }
  return roster;
}

function upsertMission(missions, mission) {
  const normalized = normalizeMission(mission);
  const next = missions.map(normalizeMission).filter(Boolean);
  const index = next.findIndex((item) => item.id === normalized.id);
  if (index === -1) next.push(normalized);
  else next[index] = normalized;
  return next;
}

function clampInt(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function clip(value, max) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toSnake(value) {
  return clean(value).replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

function normalizeArrayText(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean).join(" ");
  return clean(value);
}
