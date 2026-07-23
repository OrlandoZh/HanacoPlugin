import {
  buildAutopilotPlan,
  completeAutopilotLoop,
  escalateAutopilotLoop,
  getAutopilotLoopState,
  latestAutopilotRun,
  listAutopilotRuns,
  pauseAutopilotLoop,
  recordAutopilotLoopTick,
  recordAutopilotRun,
  resumeAutopilotLoop,
  startAutopilotLoop,
  stopAutopilotLoop
} from "../lib/autopilot-store.js"
import {
  getAutopilotScheduleConfig,
  setAutopilotScheduleConfig
} from "../lib/autopilot-scheduler.js"
import {
  abortSession,
  cancelHostTask,
  completeHostTask,
  createSession,
  dispatchMission,
  getBlueprint,
  getSessionHistory,
  getSessionStatus,
  hasBusCapability,
  listSessions,
  registerHostTask,
  sendSessionMessage,
  updateHostTask
} from "../lib/hanaagent-core.js"
import {
  batchUpdateTasks,
  clearDoneTasks,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  moveTask,
  updateTask
} from "../lib/task-store.js"
import {
  clearCheckpoints,
  createCheckpoint,
  deleteCheckpoint,
  listCheckpointConflicts,
  listCheckpointReminders,
  listCheckpoints,
  resolveCheckpointConflict,
  updateCheckpointReminder
} from "../lib/checkpoint-store.js"
import {
  createRunRecord,
  deleteRunRecord,
  listRunRecords,
  materializeRunRecordFile,
  readRunRecordArtifactFile,
  summarizeRunRecords,
  updateRunRecord
} from "../lib/run-store.js"
import {
  buildReviewGate,
  formatReviewGateReport
} from "../lib/review-gate.js"
import {
  buildMissionInbox
} from "../lib/mission-inbox.js"
import {
  listToolArtifacts,
  readToolArtifact
} from "../lib/tool-artifact-store.js"
import {
  materializeHandoff
} from "../lib/handoff-store.js"
import {
  createJob,
  deleteJob,
  getJob,
  listJobs,
  recordJobRun,
  setJobStatus,
  updateJob
} from "../lib/job-store.js"
import {
  appendMissionEvent,
  buildConductorPrompt,
  buildContinuationPrompt,
  buildMissionBriefs,
  buildMissionExport,
  buildMissionReport,
  buildSwarmBrief,
  completeMission,
  createMission,
  formatSwarmBrief,
  getMission,
  getMissionRoles,
  linkMissionAssignmentTask,
  listMissions,
  stopMission,
  updateMission,
  updateMissionAssignment,
  updateMissionFromCheckpoint
} from "../lib/mission-store.js"
import { workflowToMissionInput } from "../lib/workflow-store.js"
import {
  readJson,
  cleanString,
  clampRouteNumber,
  clampNumber,
  clipForEvent,
  escapeHtmlText,
  activityTimestamp,
  normalizeBoardWipLimits,
  normalizeModelMetadataConfig,
  normalizePinnedModels,
  normalizePinnedSessions,
  normalizeSessionAliases,
  normalizeSessionTombstones,
  normalizeSavedBoardViews,
  normalizeWorkbenchModes,
  normalizeWorkbenchNotifications,
  normalizeWorkbenchOnboarding,
  normalizeWorkbenchSettings,
  firstCompatLine
} from "./workbench-utils.js"

// Cross-module dependencies — assigned in registerMissionRoutes from workbench.js
let buildOverview = null
let buildApprovalQueue = null
let resolveApprovalRecord = null
let assignmentStateToColumn = null

function stageArtifactFile(ctx, input = {}) {
  const sessionPath = cleanString(input.sessionPath);
  const filePath = cleanString(input.filePath);
  if (!sessionPath || !filePath) return { ok: false, error: "sessionPath_or_filePath_missing" };
  if (typeof ctx?.stageFile !== "function") return { ok: false, error: "stageFile_unavailable" };
  try {
    const staged = ctx.stageFile({
      sessionPath,
      filePath,
      label: cleanString(input.label) || undefined
    });
    return { ok: true, ...staged };
  } catch (error) {
    return { ok: false, error: error?.message || "stageFile_failed" };
  }
}

async function registerArtifactHtmlPreview(ctx, c, artifact, input = {}) {
  const html = buildArtifactPreviewHtml(artifact);
  const payload = {
    title: artifact.record?.title || artifact.file?.filename || "HanaAgent artifact",
    content: html,
    sourceFilePath: artifact.file?.filePath
  };
  if (typeof ctx?.registerHtmlPreview === "function") {
    try {
      const result = await ctx.registerHtmlPreview(payload, { request: c.req.raw, pluginId: ctx.pluginId });
      return {
        ok: result?.ok !== false,
        source: "host-api",
        record: artifact.record,
        file: artifact.file,
        previewId: cleanString(result?.id || result?.previewId),
        previewUrl: cleanString(result?.previewUrl || result?.url),
        expiresAt: result?.expiresAt || null,
        result
      };
    } catch (error) {
      return { ok: false, error: error?.message || "html_preview_register_failed", source: "host-api" };
    }
  }

  const requestUrl = new URL(c.req.url);
  const targetUrl = new URL("/api/preview/html", requestUrl.origin);
  const headers = { "content-type": "application/json" };
  const auth = c.req.header("authorization");
  if (auth) headers.authorization = auth;
  const token = c.req.query("token");
  if (token) targetUrl.searchParams.set("token", token);
  try {
    const res = await fetch(targetUrl.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || "html_preview_register_failed", status: res.status, source: "host-route" };
    return {
      ok: true,
      source: "host-route",
      record: artifact.record,
      file: artifact.file,
      previewId: cleanString(data.id || data.previewId),
      previewUrl: cleanString(data.previewUrl || data.url),
      expiresAt: data.expiresAt || null,
      result: data
    };
  } catch (error) {
    return { ok: false, error: error?.message || "html_preview_register_failed", source: "host-route" };
  }
}

function buildArtifactPreviewHtml(artifact) {
  const record = artifact.record || {};
  const file = artifact.file || {};
  const content = typeof artifact.content === "string" ? artifact.content : "";
  const title = escapeHtmlText(record.title || file.filename || "HanaAgent artifact");
  const summary = escapeHtmlText(record.summary || "");
  const language = escapeHtmlText(record.language || "");
  const body = artifactContentToHtml(content, file.mime || "", record.language || "");
  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    "<style>",
    "body{margin:0;font:14px/1.55 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#f7f7f3;color:#222}",
    "main{max-width:960px;margin:0 auto;padding:24px}",
    "header{border-bottom:1px solid #ddd;padding-bottom:12px;margin-bottom:16px}",
    "h1{font-size:24px;margin:0 0 8px}",
    ".meta{color:#666;font-size:12px}",
    "pre{white-space:pre-wrap;word-break:break-word;background:#111;color:#f6f6f6;border-radius:8px;padding:16px;overflow:auto}",
    "article{background:white;border:1px solid #ddd;border-radius:8px;padding:18px}",
    "</style>",
    "</head>",
    "<body>",
    "<main>",
    `<header><h1>${title}</h1><div class="meta">${language}${summary ? " · " + summary : ""}</div></header>`,
    body,
    "</main>",
    "</body>",
    "</html>"
  ].join("");
}

function artifactContentToHtml(content, mime, language) {
  const lowerMime = cleanString(mime).toLowerCase();
  const lowerLanguage = cleanString(language).toLowerCase();
  const escaped = escapeHtmlText(content || "");
  if (lowerMime.includes("html") || lowerLanguage === "html") return content || "";
  if (lowerMime.includes("markdown") || lowerLanguage === "markdown" || lowerLanguage === "md") {
    return `<article><pre>${escaped}</pre></article>`;
  }
  return `<pre>${escaped}</pre>`;
}


async function registerAssignmentHostTask(ctx, mission, assignment, input = {}) {
  const taskId = hostTaskIdForAssignment(mission.id, assignment.id);
  const sessionPath = cleanString(input.sessionPath || assignment.sessionPath || mission.sessionPath);
  const result = await registerHostTask(ctx, {
    taskId,
    type: "hanaagent-assignment",
    pluginId: ctx.pluginId || "hanaagent",
    sessionPath,
    parentSessionPath: sessionPath,
    agentId: assignment.agentId || mission.agentId || "",
    persist: true,
    meta: {
      label: `${assignment.label}: ${mission.title}`,
      missionId: mission.id,
      missionTitle: mission.title,
      assignmentId: assignment.id,
      assignmentLabel: assignment.label,
      taskId: assignment.taskId || "",
      lane: assignment.lane || "",
      priority: assignment.priority || "",
      state: "running"
    }
  });
  if (result.ok) {
    const progress = assignmentProgressForState("running");
    const update = await updateHostTask(ctx, {
      taskId,
      status: "running",
      message: `${assignment.label} dispatched`,
      progress,
      meta: {
        missionId: mission.id,
        assignmentId: assignment.id,
        taskId: assignment.taskId || "",
        state: "running"
      }
    });
    return { ...result, taskId, update };
  }
  return { ...result, taskId };
}

export async function launchAssignmentWorkerSession(ctx, mission, assignment, input = {}) {
  const title = cleanString(input.title)
    || `${mission.title || "Mission"} / ${assignment.label || assignment.roleId || "worker"}`;
  const sessionResult = await createSession(ctx, {
    agentId: cleanString(input.agentId) || assignment.agentId || mission.agentId || "",
    cwd: cleanString(input.cwd) || cleanString(input.workspacePath) || "",
    model: cleanString(input.model) || "",
    title,
    missionId: mission.id,
    assignmentId: assignment.id,
    memoryEnabled: input.memoryEnabled
  });
  if (!sessionResult.ok || !sessionResult.session?.path) {
    const fallbackSessionPath = cleanString(input.sessionPath)
      || cleanString(assignment.sessionPath)
      || cleanString(mission.sessionPath);
    if (fallbackSessionPath && hasBusCapability(ctx, "session:send")) {
      const listed = await listSessions(ctx, { agentId: assignment.agentId || mission.agentId || "" });
      const existing = listed.sessions.find((session) => session.path === fallbackSessionPath);
      if (existing) return bindAssignmentToExistingSession(ctx, mission, assignment, existing, sessionResult);
    }
    return {
      ok: false,
      assignmentId: assignment.id,
      stage: "session:create",
      error: fallbackSessionPath ? "existing_session_required" : (sessionResult.error || "session_create_failed"),
      fallbackSessionPath,
      sessionCreate: sessionResult
    };
  }

  const sessionPath = sessionResult.session.path;
  const prompt = buildConductorPrompt({
    mission,
    assignment,
    checkpointContract: getBlueprint().checkpointContract
  });
  const dispatchResult = await dispatchMission(ctx, {
    sessionPath,
    mission: prompt,
    templateId: mission.templateId,
    mode: mission.mode,
    notes: ""
  });
  if (!dispatchResult.ok) {
    const retryable = dispatchResult.error === "session_busy";
    updateMissionAssignment(ctx.dataDir, mission.id, assignment.id, {
      state: retryable ? "queued" : "blocked",
      sessionPath,
      sessionBindingKind: "dedicated",
      sessionBoundAt: new Date().toISOString(),
      sessionOriginAssignmentId: assignment.id,
      blocker: dispatchResult.error || "worker dispatch failed",
      nextAction: retryable
        ? "目标会话正在运行；稍后重试投递。"
        : "请检查 session:send 能力，然后重试启动智能体群组。"
    });
    return {
      ok: false,
      assignmentId: assignment.id,
      sessionPath,
      stage: "session:send",
      error: dispatchResult.error || "dispatch_failed",
      ...(retryable ? { retryable: true } : {}),
      sessionCreate: sessionResult,
      dispatch: dispatchResult
    };
  }

  const updated = updateMissionAssignment(ctx.dataDir, mission.id, assignment.id, {
    state: "running",
    sessionPath,
    sessionBindingKind: "dedicated",
    sessionBoundAt: new Date().toISOString(),
    sessionOriginAssignmentId: assignment.id,
    agentId: sessionResult.session.agentId || assignment.agentId || mission.agentId || ""
  });
  const updatedMission = updated.mission || getMission(ctx.dataDir, mission.id) || mission;
  const updatedAssignment = updated.assignment || updatedMission.assignments.find((item) => item.id === assignment.id) || assignment;
  const hostTask = await registerAssignmentHostTask(ctx, updatedMission, updatedAssignment, { sessionPath });
  return {
    ok: true,
    assignmentId: assignment.id,
    sessionPath,
    session: sessionResult.session,
    sessionCreate: sessionResult,
    dispatch: dispatchResult,
    hostTask
  };
}

async function bindAssignmentToExistingSession(ctx, mission, assignment, session, sessionResult) {
  const sessionPath = session.path;
  const updated = updateMissionAssignment(ctx.dataDir, mission.id, assignment.id, {
    state: "running",
    sessionPath,
    sessionBindingKind: "shared",
    sessionBoundAt: new Date().toISOString(),
    sessionOriginAssignmentId: assignment.id,
    agentId: session.agentId || assignment.agentId || mission.agentId || "",
    nextAction: "宿主 session:create 不可用；执行通道已绑定到现有会话。自动检查点投影已暂停，请手动同步历史。"
  });
  const updatedMission = updated.mission || getMission(ctx.dataDir, mission.id) || mission;
  const updatedAssignment = updated.assignment || updatedMission.assignments.find((item) => item.id === assignment.id) || assignment;
  const hostTask = await registerAssignmentHostTask(ctx, updatedMission, updatedAssignment, { sessionPath });
  return {
    ok: true,
    degraded: true,
    dedicated: false,
    assignmentId: assignment.id,
    sessionPath,
    session: {
      path: sessionPath,
      sessionPath,
      title: session.title || updatedAssignment.label || assignment.roleId || "Worker",
      agentId: session.agentId || updatedAssignment.agentId || mission.agentId || "",
      status: session.status || "bound-existing",
      raw: session.raw || session
    },
    sessionCreate: sessionResult,
    dispatch: {
      ok: false,
      skipped: true,
      error: sessionResult.error || "session_create_unavailable",
      nextAction: "请使用执行智能体聊天将提示词发送到已绑定会话，或配置宿主 session:create 能力以创建专用执行智能体会话。"
    },
    hostTask
  };
}

export async function syncMissionHostTasks(ctx, mission, state, input = {}) {
  const assignments = Array.isArray(mission?.assignments) ? mission.assignments : [];
  const updates = [];
  for (const assignment of assignments) {
    updates.push(await syncAssignmentHostTask(ctx, mission, assignment, state, input));
  }
  return updates;
}

export async function syncAssignmentHostTask(ctx, mission, assignment, state, input = {}) {
  const taskId = hostTaskIdForAssignment(mission.id, assignment.id);
  const normalized = String(state || assignment.state || "").toLowerCase();
  if (normalized === "done" || normalized === "complete") {
    return completeHostTask(ctx, {
      taskId,
      result: input.result || {
        ok: true,
        missionId: mission.id,
        assignmentId: assignment.id,
        result: assignment.result || "",
        nextAction: assignment.nextAction || ""
      }
    });
  }
  if (normalized === "cancelled") {
    return cancelHostTask(ctx, {
      taskId,
      reason: cleanString(input.reason) || "assignment cancelled"
    });
  }
  if (normalized === "blocked") {
    return updateHostTask(ctx, {
      taskId,
      status: "blocked",
      message: assignment.blocker || cleanString(input.reason) || "assignment blocked",
      progress: assignmentProgressForState("blocked"),
      meta: { missionId: mission.id, assignmentId: assignment.id, state: "blocked" }
    });
  }
  if (normalized === "review" || normalized === "checkpointed") {
    return updateHostTask(ctx, {
      taskId,
      status: "review",
      message: assignment.nextAction || "assignment ready for review",
      progress: assignmentProgressForState("review"),
      meta: { missionId: mission.id, assignmentId: assignment.id, state: normalized }
    });
  }
  return updateHostTask(ctx, {
    taskId,
    status: "running",
    message: `${assignment.label} ${normalized || "running"}`,
    progress: assignmentProgressForState("running"),
    meta: { missionId: mission.id, assignmentId: assignment.id, state: normalized || "running" }
  });
}

function hostTaskIdForAssignment(missionId, assignmentId) {
  return `hanaagent-${safeTaskIdPart(missionId)}-${safeTaskIdPart(assignmentId)}`;
}

function safeTaskIdPart(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}

function assignmentProgressForState(state) {
  const normalized = String(state || "").toLowerCase();
  if (normalized === "done" || normalized === "complete") return { current: 1, total: 1, percent: 100 };
  if (normalized === "review" || normalized === "checkpointed") return { current: 4, total: 5, percent: 80 };
  if (normalized === "blocked") return { current: 1, total: 5, percent: 20 };
  return { current: 1, total: 5, percent: 20 };
}

function cleanReason(value) {
  return cleanString(value).slice(0, 240);
}

function buildMissionReviewGate(ctx, missionId) {
  const mission = getMission(ctx.dataDir, missionId);
  if (!mission) return { ok: false, error: "mission_not_found" };
  const tasks = listTasks(ctx.dataDir, { includeDone: true });
  const checkpoints = listCheckpoints(ctx.dataDir);
  const runRecords = listRunRecords(ctx.dataDir);
  const gate = buildReviewGate({ mission, tasks, checkpoints, runRecords });
  if (!gate.ok) return gate;
  return {
    ok: true,
    mission,
    gate,
    report: formatReviewGateReport(gate)
  };
}

function buildMissionInboxSnapshot(ctx, input = {}) {
  const missionId = cleanString(input.missionId);
  const allMissions = listMissions(ctx.dataDir, { includeArchived: true });
  const missions = missionId ? allMissions.filter((mission) => mission.id === missionId) : allMissions;
  if (missionId && !missions.length) return { ok: false, error: "mission_not_found" };
  const tasks = listTasks(ctx.dataDir, { includeDone: true });
  const checkpoints = listCheckpoints(ctx.dataDir);
  const runRecords = listRunRecords(ctx.dataDir);
  return buildMissionInbox({ missions, tasks, checkpoints, runRecords });
}


function firstNonEmptyServerLine(value) {
  return String(value || "").split(/\r?\n/).find((line) => line.trim())?.trim() || "";
}

async function runMissionAutopilot(ctx, mission, input = {}) {
  const mode = cleanString(input.mode) === "run" ? "run" : "preview";
  const tasks = listTasks(ctx.dataDir, { includeDone: true });
  const checkpoints = listCheckpoints(ctx.dataDir);
  const sessionStatuses = await collectMissionSessionStatuses(ctx, mission);
  const plan = buildAutopilotPlan({ mission, tasks, checkpoints, sessionStatuses });
  if (!plan.ok) return plan;

  const applied = [];
  const errors = [];
  if (mode === "run") {
    for (const suggestion of plan.suggestions) {
      try {
        const result = await applyAutopilotSuggestion(ctx, mission, suggestion);
        if (result) applied.push({ suggestionId: suggestion.id, action: suggestion.action, result });
      } catch (error) {
        errors.push({
          suggestionId: suggestion.id,
          action: suggestion.action,
          error: error?.message || String(error)
        });
      }
    }
  }

  const runResult = recordAutopilotRun(ctx.dataDir, {
    missionId: mission.id,
    mode,
    summary: plan.summary,
    suggestions: plan.suggestions,
    applied,
    errors
  });
  appendMissionEvent(ctx.dataDir, mission.id, {
    type: mode === "run" ? "autopilot_run" : "autopilot_preview",
    label: `${mode === "run" ? "自动驾驶已执行" : "自动驾驶预览"}：${plan.summary}`,
    meta: {
      runId: runResult.run.id,
      suggestions: plan.suggestions.map((item) => ({ id: item.id, action: item.action, assignmentId: item.assignmentId })),
      applied,
      errors
    }
  });
  return { ok: true, run: runResult.run, plan, mission: getMission(ctx.dataDir, mission.id) || mission };
}

export async function runAutopilotTick(ctx, input = {}) {
  const reason = cleanString(input.reason) || "manual";
  const loopBefore = getAutopilotLoopState(ctx.dataDir);
  const loopDriven = loopBefore.state === "active" && reason !== "manual";
  const automatedReason = ["interval", "startup"].includes(reason) || reason.startsWith("job:");
  if (automatedReason && loopBefore.state === "paused") {
    return {
      ok: true,
      skipped: true,
      reason: "loop_paused",
      mode: loopBefore.mode,
      scanned: 0,
      results: [],
      errors: [],
      loop: loopBefore,
      schedule: getAutopilotScheduleConfig(ctx),
      generatedAt: new Date().toISOString()
    };
  }
  if (["interval", "startup"].includes(reason) && ["completed", "stopped", "escalated"].includes(loopBefore.state)) {
    return {
      ok: true,
      skipped: true,
      reason: `loop_${loopBefore.state}`,
      mode: loopBefore.mode,
      scanned: 0,
      results: [],
      errors: [],
      loop: loopBefore,
      schedule: getAutopilotScheduleConfig(ctx),
      generatedAt: new Date().toISOString()
    };
  }
  const config = input.config && typeof input.config === "object"
    ? input.config
    : getAutopilotScheduleConfig(ctx);
  const mode = loopDriven ? loopBefore.mode : cleanString(config.mode) === "run" ? "run" : "preview";
  const maxMissions = Math.max(1, Math.min(20, Number(loopDriven ? loopBefore.maxMissionsPerTick : config.maxMissionsPerTick) || 5));
  const missions = listMissions(ctx.dataDir, { includeArchived: false })
    .filter((mission) => ["active", "blocked", "planning", "paused"].includes(mission.state) || ["preview", "active"].includes(mission.phase))
    .slice(0, maxMissions);
  const results = [];
  const errors = [];
  for (const mission of missions) {
    try {
      const result = await runMissionAutopilot(ctx, mission, { mode });
      results.push({
        missionId: mission.id,
        ok: result.ok,
        runId: result.run?.id || "",
        summary: result.run?.summary || result.plan?.summary || "",
        suggestions: result.run?.suggestions?.length || result.plan?.suggestions?.length || 0,
        applied: result.run?.applied?.length || 0,
        errors: result.run?.errors?.length || 0
      });
      appendMissionEvent(ctx.dataDir, mission.id, {
        type: "autopilot_tick",
        label: `自动驾驶单次检查（${mode}）：${result.run?.summary || result.plan?.summary || "完成"}`,
        meta: {
          reason,
          runId: result.run?.id || "",
          mode
        }
      });
    } catch (error) {
      errors.push({ missionId: mission.id, error: error?.message || String(error) });
    }
  }
  const result = {
    ok: errors.length === 0,
    reason,
    mode,
    scanned: missions.length,
    results,
    errors,
    schedule: getAutopilotScheduleConfig(ctx),
    generatedAt: new Date().toISOString()
  };
  if (loopBefore.state === "active") {
    const loopResult = recordAutopilotLoopTick(ctx.dataDir, { reason, mode, result, generatedAt: result.generatedAt });
    result.loop = loopResult.loop;
    result.loopTick = loopResult.tick || null;
  } else {
    result.loop = loopBefore;
  }
  return result;
}

export async function triggerJob(ctx, jobId, input = {}) {
  const job = getJob(ctx.dataDir, jobId);
  if (!job) return { ok: false, error: "job_not_found" };
  if (job.status === "paused" && input.force !== true) {
    const skipped = recordJobRun(ctx.dataDir, job.id, {
      status: "skipped",
      summary: "定时作业已暂停",
      output: "运行已暂停的定时作业需要 force=true。",
      result: { status: job.status }
    });
    return { ok: true, skipped: true, job: skipped.job, run: skipped.run };
  }
  try {
    let result;
    if (job.type === "mission-autopilot") {
      const missionId = cleanString(input.missionId) || job.missionId;
      const mission = getMission(ctx.dataDir, missionId);
      if (!mission) throw new Error("mission_not_found");
      result = await runMissionAutopilot(ctx, mission, {
        mode: cleanString(input.mode) || job.mode || "preview"
      });
    } else if (job.type === "dispatch-prompt") {
      result = await triggerDispatchPromptJob(ctx, job, input);
    } else {
      result = await runAutopilotTick(ctx, {
        reason: `job:${job.id}`,
        config: {
          ...getAutopilotScheduleConfig(ctx),
          mode: cleanString(input.mode) || job.mode || "preview",
          maxMissionsPerTick: input.maxMissionsPerTick || job.payload.maxMissionsPerTick || 5
        }
      });
    }
    const recorded = recordJobRun(ctx.dataDir, job.id, {
      status: result?.ok === false ? "failed" : "success",
      summary: summarizeJobResult(job, result),
      output: JSON.stringify(result, null, 2),
      result,
      error: result?.ok === false ? result.error || "job_failed" : ""
    });
    return { ok: result?.ok !== false, job: recorded.job, run: recorded.run, result };
  } catch (error) {
    const recorded = recordJobRun(ctx.dataDir, job.id, {
      status: "failed",
      summary: error?.message || "job_failed",
      output: error?.stack || error?.message || String(error),
      error: error?.message || String(error)
    });
    return { ok: false, error: error?.message || "job_failed", job: recorded.job, run: recorded.run };
  }
}

async function triggerDispatchPromptJob(ctx, job, input = {}) {
  const sessionPath = cleanString(input.sessionPath) || cleanString(job.payload.sessionPath) || "";
  const prompt = cleanString(input.prompt) || job.prompt || cleanString(job.payload.prompt);
  if (!sessionPath) return { ok: false, error: "sessionPath_required" };
  if (!prompt) return { ok: false, error: "prompt_required" };
  return dispatchMission(ctx, {
    sessionPath,
    agentId: cleanString(input.agentId) || job.agentId,
    mission: prompt,
    notes: cleanString(input.notes) || cleanString(job.payload.notes),
    mode: cleanString(input.mode) || job.mode || "preview",
    templateId: cleanString(job.payload.templateId)
  });
}

function summarizeJobResult(job, result) {
  if (!result) return `${job.title} finished`;
  if (job.type === "mission-autopilot") return result.run?.summary || result.plan?.summary || `${job.title} mission autopilot finished`;
  if (job.type === "dispatch-prompt") return result.ok ? `Prompt dispatched to ${result.sessionPath || "session"}` : result.error || "dispatch failed";
  return `Autopilot tick ${result.mode || job.mode || "preview"} scanned ${result.scanned || 0} mission(s)`;
}

async function collectMissionSessionStatuses(ctx, mission) {
  const statuses = {};
  const sessionPaths = [...new Set([
    mission.sessionPath,
    ...(Array.isArray(mission.assignments) ? mission.assignments.map((assignment) => assignment.sessionPath) : [])
  ].map(cleanString).filter(Boolean))];
  for (const sessionPath of sessionPaths) {
    const result = await getSessionStatus(ctx, { sessionPath });
    if (result.ok && result.status) statuses[sessionPath] = result.status;
  }
  return statuses;
}

export async function dispatchAssignmentForMission(ctx, mission, assignment, input = {}) {
  const sessionPath = cleanString(input.sessionPath) || assignment.sessionPath || mission.sessionPath;
  const prompt = buildConductorPrompt({
    mission,
    assignment,
    checkpointContract: getBlueprint().checkpointContract
  });
  const result = await dispatchMission(ctx, {
    sessionPath,
    mission: prompt,
    templateId: mission.templateId,
    mode: mission.mode,
    notes: ""
  });
  let hostTask = null;
  let assignmentUpdate = null;
  if (result.ok) {
    assignmentUpdate = updateMissionAssignment(ctx.dataDir, mission.id, assignment.id, {
      state: "running",
      sessionPath: result.sessionPath || sessionPath
    });
    const updatedMission = assignmentUpdate.mission || getMission(ctx.dataDir, mission.id) || mission;
    const updatedAssignment = assignmentUpdate.assignment || updatedMission.assignments.find((item) => item.id === assignment.id) || assignment;
    hostTask = await registerAssignmentHostTask(ctx, updatedMission, updatedAssignment, {
      sessionPath: result.sessionPath || sessionPath
    });
  }
  return {
    assignmentId: assignment.id,
    brief: buildSwarmBrief({ mission, assignment, checkpointContract: getBlueprint().checkpointContract }),
    hostTask,
    assignmentUpdate,
    ...result
  };
}

async function startContinuationAssignments(ctx, mission, input = {}) {
  const max = clampNumber(input.dispatchLimit || input.limit || input.maxDispatch || mission.assignments?.length || 1, 1, 12, 1);
  const targets = (Array.isArray(mission?.assignments) ? mission.assignments : [])
    .filter((assignment) => !["done", "cancelled"].includes(assignment.state))
    .slice(0, max);
  const results = [];
  for (const assignment of targets) {
    let sessionPath = cleanString(input.sessionPath) || cleanString(assignment.sessionPath) || cleanString(mission.sessionPath);
    let ensure = null;
    if (input.ensureSession !== false && (!sessionPath || input.dedicatedSession === true || input.createSession === true)) {
      ensure = await launchAssignmentWorkerSession(ctx, mission, assignment, {
        agentId: input.agentId || assignment.agentId || mission.agentId || "",
        cwd: input.cwd || input.workspacePath || assignment.cwd || "",
        model: input.model || "",
        title: input.title ? `${input.title} / ${assignment.label}` : `${mission.title} / ${assignment.label}`,
        sessionPath
      });
      sessionPath = cleanString(ensure.sessionPath) || sessionPath;
    }
    const dispatch = ensure?.dispatch?.ok
      ? ensure.dispatch
      : sessionPath
        ? await dispatchAssignmentForMission(ctx, mission, assignment, { sessionPath })
        : { ok: false, assignmentId: assignment.id, error: "sessionPath_required", sessionPath: "" };
    results.push({
      assignmentId: assignment.id,
      sessionPath: dispatch.sessionPath || sessionPath,
      ok: Boolean(dispatch.ok),
      ensure,
      dispatch,
      hostTask: dispatch.hostTask || ensure?.hostTask || null,
      error: dispatch.ok ? "" : dispatch.error || ensure?.error || "dispatch_failed"
    });
  }
  appendMissionEvent(ctx.dataDir, mission.id, {
    type: "continuation_dispatch",
    label: `续接任务已投递 ${results.filter((item) => item.ok).length}/${results.length} 个任务分派`,
    meta: {
      assignmentIds: targets.map((assignment) => assignment.id),
      sessionPaths: results.map((item) => item.sessionPath).filter(Boolean),
      hostTaskIds: results.map((item) => item.hostTask?.taskId).filter(Boolean),
      errors: results.filter((item) => !item.ok).map((item) => ({ assignmentId: item.assignmentId, error: item.error }))
    }
  });
  appendMissionEvent(ctx.dataDir, mission.id, {
    type: "host_task_sync",
    label: `续接任务已注册 ${results.filter((item) => item.hostTask?.ok).length}/${results.length} 个宿主任务`,
    meta: { hostTasks: results.map((item) => item.hostTask).filter(Boolean) }
  });
  return results;
}

async function applyAutopilotSuggestion(ctx, mission, suggestion) {
  if (!suggestion || suggestion.action === "monitor") return null;
  if (suggestion.action === "dispatch") {
    const assignment = (mission.assignments || []).find((item) => item.id === suggestion.assignmentId);
    if (!assignment) return { ok: false, error: "assignment_not_found", assignmentId: suggestion.assignmentId };
    return dispatchAssignmentForMission(ctx, mission, assignment, {
      sessionPath: suggestion.payload?.sessionPath || suggestion.sessionPath
    });
  }
  if (suggestion.action === "sync-history") {
    return syncHistoryCheckpoints(ctx, {
      sessionPath: suggestion.payload?.sessionPath || suggestion.sessionPath,
      taskId: suggestion.payload?.taskId || suggestion.taskId,
      missionId: mission.id,
      assignmentId: suggestion.payload?.assignmentId || suggestion.assignmentId,
      limit: 80
    });
  }
  if (suggestion.action === "escalate") {
    const record = createRunRecord(ctx.dataDir, {
      type: "approval",
      title: `Autopilot escalation: ${suggestion.assignmentLabel || suggestion.assignmentId || mission.title || "assignment"}`,
      summary: suggestion.reason || "Assignment needs operator attention.",
      content: [
        `Mission: ${mission.title || mission.id}`,
        `Assignment: ${suggestion.assignmentLabel || suggestion.assignmentId || "-"}`,
        `Reason: ${suggestion.reason || "-"}`,
        `Next action: ${suggestion.payload?.nextAction || "-"}`
      ].join("\n"),
      missionId: mission.id,
      assignmentId: suggestion.assignmentId,
      taskId: suggestion.taskId,
      sessionPath: suggestion.sessionPath,
      state: "pending",
      risk: suggestion.severity || "critical",
      requester: "hanaagent-autopilot",
      meta: {
        suggestionId: suggestion.id,
        action: suggestion.action,
        payload: suggestion.payload || {}
      }
    });
    appendMissionEvent(ctx.dataDir, mission.id, {
      type: "autopilot_escalation",
      label: `自动驾驶升级：${suggestion.reason || suggestion.assignmentLabel || suggestion.assignmentId}`,
      meta: { suggestion, approvalId: record.record?.id || "" }
    });
    return record;
  }
  if (suggestion.action === "mark-blocked") {
    const result = updateMissionAssignment(ctx.dataDir, mission.id, suggestion.assignmentId, {
      state: "blocked",
      blocker: suggestion.payload?.blocker || suggestion.reason,
      nextAction: suggestion.payload?.nextAction || "需要操作员复核"
    });
    if (result.ok && result.assignment.taskId) moveTask(ctx.dataDir, result.assignment.taskId, "blocked");
    if (result.ok) await syncAssignmentHostTask(ctx, result.mission, result.assignment, "blocked", { reason: result.assignment.blocker });
    return result;
  }
  if (suggestion.action === "request-review") {
    const result = updateMissionAssignment(ctx.dataDir, mission.id, suggestion.assignmentId, { state: "review" });
    if (result.ok && result.assignment.taskId) moveTask(ctx.dataDir, result.assignment.taskId, "review");
    if (result.ok) await syncAssignmentHostTask(ctx, result.mission, result.assignment, "review", {});
    return result;
  }
  if (suggestion.action === "complete") {
    return completeMission(ctx.dataDir, mission.id, { summary: "所有任务分派完成后，HanaAgent 自动驾驶已完成此任务。" });
  }
  return null;
}

function buildRunLearnings(ctx, input = {}) {
  const limit = clampRouteNumber(input.limit, 1, 200, 80);
  const categoryFilter = normalizeLearningCategory(input.category);
  const missionFilter = cleanString(input.missionId);
  const assignmentFilter = cleanString(input.assignmentId);
  const sessionFilter = cleanString(input.sessionPath);
  const missions = listMissions(ctx.dataDir, { includeArchived: true });
  const missionMap = new Map(missions.map((mission) => [mission.id, mission]));
  const learnings = listRunRecords(ctx.dataDir, { type: "learning" })
    .map((record) => normalizeRunLearning(record, missionMap))
    .filter((learning) => !categoryFilter || learning.category === categoryFilter)
    .filter((learning) => !missionFilter || learning.missionId === missionFilter)
    .filter((learning) => !assignmentFilter || learning.assignmentId === assignmentFilter || learning.workerId === assignmentFilter)
    .filter((learning) => !sessionFilter || learning.sessionPath === sessionFilter)
    .sort((a, b) => b.createdAt - a.createdAt || String(b.id).localeCompare(String(a.id)));
  return {
    ok: true,
    learnings: learnings.slice(0, limit),
    summary: summarizeRunLearnings(learnings),
    filters: { category: categoryFilter || "all", missionId: missionFilter, assignmentId: assignmentFilter, sessionPath: sessionFilter, limit },
    mode: "openhanako-plugin",
    source: "hanaagent-run-learnings"
  };
}

function normalizeRunLearning(record = {}, missionMap = new Map()) {
  const mission = missionMap.get(record.missionId);
  const assignment = Array.isArray(mission?.assignments) ? mission.assignments.find((item) => item.id === record.assignmentId) : null;
  const text = cleanString(record.content || record.summary || record.title);
  return {
    id: cleanString(record.id),
    recordId: cleanString(record.id),
    title: cleanString(record.title),
    text,
    summary: cleanString(record.summary || firstCompatLine(text)),
    category: normalizeLearningCategory(record.meta?.category || record.category || record.state || record.title || text) || "optimization",
    missionId: cleanString(record.missionId),
    missionTitle: cleanString(mission?.title),
    assignmentId: cleanString(record.assignmentId),
    workerId: cleanString(record.assignmentId || assignment?.id),
    workerLabel: cleanString(assignment?.label),
    sessionPath: cleanString(record.sessionPath),
    agentId: cleanString(record.agentId || assignment?.agentId),
    requester: cleanString(record.requester),
    createdAt: activityTimestamp(record.createdAt || record.updatedAt) || Date.now(),
    updatedAt: activityTimestamp(record.updatedAt || record.createdAt) || Date.now(),
    meta: record.meta && typeof record.meta === "object" ? record.meta : {}
  };
}

function normalizeLearningCategory(value) {
  const text = cleanString(value).toLowerCase();
  if (!text || text === "all") return "";
  if (/success|win|worked|pass|done|成功|可复用/.test(text)) return "success";
  if (/failure|fail|error|blocked|regress|失败|错误|阻塞/.test(text)) return "failure";
  if (/optimization|optimise|optimize|perf|cost|token|speed|改进|优化|节省/.test(text)) return "optimization";
  if (["success", "failure", "optimization"].includes(text)) return text;
  return "";
}

function summarizeRunLearnings(learnings = []) {
  const byCategory = { success: 0, failure: 0, optimization: 0 };
  let latestAt = 0;
  for (const learning of learnings) {
    byCategory[learning.category] = (byCategory[learning.category] || 0) + 1;
    latestAt = Math.max(latestAt, Number(learning.createdAt || learning.updatedAt || 0));
  }
  return {
    total: learnings.length,
    byCategory,
    latestAt: latestAt ? new Date(latestAt).toISOString() : ""
  };
}

function buildRunCompare(ctx, input = {}) {
  const runA = buildRunSnapshot(ctx, {
    runId: input.runA,
    missionId: input.missionA,
    assignmentId: input.assignmentA
  });
  const runB = buildRunSnapshot(ctx, {
    runId: input.runB,
    missionId: input.missionB,
    assignmentId: input.assignmentB
  });
  if (!runA || !runB) return { ok: false, error: "run_pair_required", detail: "Provide runA/runB record ids or missionA/missionB ids." };
  const metrics = [
    compareStatusMetric(runA.status, runB.status),
    compareLowerMetric("duration", "Duration", runA.durationMs, runB.durationMs, formatDurationLabel),
    compareLowerMetric("tokens", "Token Count", runA.tokenCount, runB.tokenCount, (value) => String(Math.round(value || 0))),
    compareLowerMetric("cost", "Cost", runA.costEstimate, runB.costEstimate, formatBackendUsd),
    compareNeutralMetric("agents", "Agent Count", runA.agentCount, runB.agentCount, (value) => String(Math.round(value || 0))),
    compareNeutralMetric("artifacts", "Artifacts", runA.artifactCount, runB.artifactCount, (value) => String(Math.round(value || 0))),
    compareLowerMetric("pendingApprovals", "Pending Approvals", runA.pendingApprovals, runB.pendingApprovals, (value) => String(Math.round(value || 0))),
    compareNeutralMetric("learnings", "Learnings", runA.learningCount, runB.learningCount, (value) => String(Math.round(value || 0)))
  ];
  return {
    ok: true,
    runA,
    runB,
    metrics,
    recommendation: buildRunCompareRecommendation(metrics),
    mode: "openhanako-plugin",
    source: "hanaagent-run-compare"
  };
}

function buildRunSnapshot(ctx, input = {}) {
  const runId = cleanString(input.runId);
  const missionId = cleanString(input.missionId);
  const assignmentId = cleanString(input.assignmentId);
  const missions = listMissions(ctx.dataDir, { includeArchived: true });
  const records = listRunRecords(ctx.dataDir);
  const checkpoints = listCheckpoints(ctx.dataDir);
  if (missionId) {
    const mission = missions.find((item) => item.id === missionId);
    if (!mission) return null;
    return missionRunSnapshot(mission, { records, checkpoints });
  }
  if (assignmentId) {
    const mission = missions.find((item) => Array.isArray(item.assignments) && item.assignments.some((assignment) => assignment.id === assignmentId));
    const assignment = mission?.assignments?.find((item) => item.id === assignmentId);
    if (!mission || !assignment) return null;
    return assignmentRunSnapshot(mission, assignment, { records, checkpoints });
  }
  if (runId) {
    const record = records.find((item) => item.id === runId);
    if (!record) return null;
    const mission = record.missionId ? missions.find((item) => item.id === record.missionId) : null;
    const assignment = mission?.assignments?.find((item) => item.id === record.assignmentId) || null;
    return recordRunSnapshot(record, mission, assignment, { records, checkpoints });
  }
  return null;
}

function missionRunSnapshot(mission, context = {}) {
  const assignments = Array.isArray(mission.assignments) ? mission.assignments : [];
  const relatedRecords = (context.records || []).filter((record) => record.missionId === mission.id);
  const relatedCheckpoints = (context.checkpoints || []).filter((checkpoint) => checkpoint.missionId === mission.id);
  const started = activityTimestamp(mission.startedAt || mission.createdAt);
  const ended = activityTimestamp(mission.completedAt || mission.updatedAt || mission.createdAt);
  const tokenCount = Number(mission.totalTokens || 0) || assignments.reduce((sum, item) => sum + Number(item.tokenCount || 0), 0) || estimateTextTokens(assignments.map((item) => `${item.task || ""}\n${item.output || ""}\n${item.result || ""}`).join("\n"));
  return {
    id: mission.id,
    kind: "mission",
    title: mission.title || firstCompatLine(mission.goal) || mission.id,
    status: mission.state || mission.phase || "queued",
    startedAt: started || ended || Date.now(),
    completedAt: ended || started || Date.now(),
    durationMs: started && ended ? Math.max(0, ended - started) : 0,
    tokenCount,
    costEstimate: estimateBackendCost(tokenCount),
    agentCount: new Set(assignments.map((item) => item.agentId || item.id).filter(Boolean)).size || assignments.length,
    artifactCount: relatedRecords.filter((item) => item.type === "artifact").length,
    pendingApprovals: relatedRecords.filter((item) => item.type === "approval" && item.state === "pending").length,
    learningCount: relatedRecords.filter((item) => item.type === "learning").length,
    checkpointCount: relatedCheckpoints.length,
    missionId: mission.id,
    assignmentId: "",
    source: "mission-store"
  };
}

function assignmentRunSnapshot(mission, assignment, context = {}) {
  const relatedRecords = (context.records || []).filter((record) => record.assignmentId === assignment.id || (record.missionId === mission.id && !record.assignmentId));
  const relatedCheckpoints = (context.checkpoints || []).filter((checkpoint) => checkpoint.assignmentId === assignment.id);
  const started = activityTimestamp(assignment.startedAt || mission.startedAt || mission.createdAt);
  const ended = activityTimestamp(assignment.completedAt || assignment.updatedAt || mission.updatedAt || mission.createdAt);
  const tokenCount = Number(assignment.tokenCount || 0) || estimateTextTokens(`${assignment.task || ""}\n${assignment.output || ""}\n${assignment.result || ""}`);
  return {
    id: assignment.id,
    kind: "assignment",
    title: `${assignment.label || assignment.id}: ${mission.title || mission.id}`,
    status: assignment.state || "queued",
    startedAt: started || ended || Date.now(),
    completedAt: ended || started || Date.now(),
    durationMs: started && ended ? Math.max(0, ended - started) : 0,
    tokenCount,
    costEstimate: estimateBackendCost(tokenCount),
    agentCount: assignment.agentId ? 1 : 0,
    artifactCount: relatedRecords.filter((item) => item.type === "artifact").length,
    pendingApprovals: relatedRecords.filter((item) => item.type === "approval" && item.state === "pending").length,
    learningCount: relatedRecords.filter((item) => item.type === "learning").length,
    checkpointCount: relatedCheckpoints.length,
    missionId: mission.id,
    assignmentId: assignment.id,
    source: "mission-assignment"
  };
}

function recordRunSnapshot(record, mission, assignment, context = {}) {
  const groupMissionId = record.missionId || mission?.id || "";
  const groupAssignmentId = record.assignmentId || assignment?.id || "";
  const relatedRecords = (context.records || []).filter((item) => item.id === record.id || (groupAssignmentId && item.assignmentId === groupAssignmentId) || (groupMissionId && item.missionId === groupMissionId && !item.assignmentId));
  const relatedCheckpoints = (context.checkpoints || []).filter((checkpoint) => (groupAssignmentId && checkpoint.assignmentId === groupAssignmentId) || (groupMissionId && checkpoint.missionId === groupMissionId));
  const started = activityTimestamp(record.createdAt);
  const ended = activityTimestamp(record.resolvedAt || record.updatedAt || record.createdAt);
  const tokenCount = Number(record.meta?.tokenCount || 0) || estimateTextTokens(`${record.title || ""}\n${record.summary || ""}\n${record.content || ""}`);
  return {
    id: record.id,
    kind: "run-record",
    title: record.title || record.id,
    status: record.state || record.type || "captured",
    startedAt: started || ended || Date.now(),
    completedAt: ended || started || Date.now(),
    durationMs: started && ended ? Math.max(0, ended - started) : 0,
    tokenCount,
    costEstimate: estimateBackendCost(tokenCount),
    agentCount: record.agentId ? 1 : 0,
    artifactCount: relatedRecords.filter((item) => item.type === "artifact").length,
    pendingApprovals: relatedRecords.filter((item) => item.type === "approval" && item.state === "pending").length,
    learningCount: relatedRecords.filter((item) => item.type === "learning").length,
    checkpointCount: relatedCheckpoints.length,
    missionId: groupMissionId,
    assignmentId: groupAssignmentId,
    source: "run-record"
  };
}

function compareStatusMetric(left, right) {
  const delta = compareStatusScore(left, right);
  return {
    id: "status",
    label: "状态",
    left,
    right,
    leftLabel: left || "-",
    rightLabel: right || "-",
    tone: delta > 0 ? "better" : delta < 0 ? "worse" : "same",
    arrow: delta > 0 ? "up" : delta < 0 ? "down" : "=",
    deltaLabel: delta > 0 ? "改善" : delta < 0 ? "退化" : "相同"
  };
}

function compareLowerMetric(id, label, left, right, formatter) {
  const result = compareNumbers(left, right, "lower");
  return {
    id,
    label,
    left,
    right,
    leftLabel: formatter(left),
    rightLabel: formatter(right),
    ...result
  };
}

function compareNeutralMetric(id, label, left, right, formatter) {
  const result = compareNumbers(left, right, "neutral");
  return {
    id,
    label,
    left,
    right,
    leftLabel: formatter(left),
    rightLabel: formatter(right),
    ...result
  };
}

function compareNumbers(leftValue, rightValue, mode) {
  const left = Number(leftValue || 0);
  const right = Number(rightValue || 0);
  if (left === right) return { tone: "same", arrow: "=", delta: 0, deltaLabel: "相同" };
  const pct = left <= 0 ? 100 : Math.abs((right - left) / left) * 100;
  if (mode === "lower") {
    return {
      tone: right < left ? "better" : "worse",
      arrow: right < left ? "up" : "down",
      delta: right - left,
      deltaLabel: `${pct.toFixed(1)}%`
    };
  }
  return {
    tone: "neutral",
    arrow: right > left ? "up" : "down",
    delta: right - left,
    deltaLabel: `${pct.toFixed(1)}%`
  };
}

function compareStatusScore(left, right) {
  return statusScore(right) - statusScore(left);
}

function statusScore(value) {
  const text = cleanString(value).toLowerCase();
  if (["complete", "completed", "success", "done", "approved"].includes(text)) return 4;
  if (["review", "needs_review", "checkpointed"].includes(text)) return 3;
  if (["running", "active", "captured"].includes(text)) return 2;
  if (["queued", "pending", "backlog"].includes(text)) return 1;
  if (["failed", "error", "cancelled", "blocked", "denied"].includes(text)) return 0;
  return 1;
}

function buildRunCompareRecommendation(metrics = []) {
  const better = metrics.filter((metric) => metric.tone === "better").length;
  const worse = metrics.filter((metric) => metric.tone === "worse").length;
  if (better > worse) return "Run B looks better on the lower-is-better metrics; inspect neutral increases for scope differences.";
  if (worse > better) return "Run B regressed on key metrics; review status, pending approvals, duration, token, and cost deltas.";
  return "Runs are broadly comparable; use artifacts, checkpoints, and learnings to choose the stronger outcome.";
}

function estimateTextTokens(value) {
  const text = cleanString(value);
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function estimateBackendCost(tokens) {
  return (Math.max(0, Number(tokens) || 0) / 1000000) * 5;
}

function formatBackendUsd(value) {
  return `$${Number(value || 0).toFixed(value >= 0.1 ? 2 : 4)}`;
}

function formatDurationLabel(ms) {
  const value = Math.max(0, Number(ms) || 0);
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60000) return `${Math.round(value / 1000)}s`;
  const minutes = Math.floor(value / 60000);
  const seconds = Math.round((value % 60000) / 1000);
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function createMissionTasks(ctx, mission, createdBy = "hanaagent-conductor") {
  const taskResults = [];
  for (const assignment of Array.isArray(mission?.assignments) ? mission.assignments : []) {
    const column = assignment.state === "running" ? "running" : "backlog";
    const taskResult = createTask(ctx.dataDir, {
      title: `${assignment.label}: ${mission.title}`,
      description: assignment.task,
      column,
      priority: assignment.priority,
      assignee: assignment.agentId || mission.agentId,
      sessionPath: assignment.sessionPath || mission.sessionPath,
      templateId: mission.templateId,
      templateLabel: assignment.label,
      missionId: mission.id,
      assignmentId: assignment.id,
      mode: mission.mode,
      tags: ["hanaagent", "mission", createdBy.includes("continuation") ? "continuation" : "", assignment.lane].filter(Boolean),
      position: assignment.position,
      createdBy
    });
    if (taskResult.ok) {
      taskResults.push(taskResult);
      linkMissionAssignmentTask(ctx.dataDir, mission.id, assignment.id, taskResult.task.id);
    }
  }
  return taskResults;
}

export function createWorkflowMission(ctx, workflow, body = {}) {
  const compiled = workflowToMissionInput(workflow, body);
  if (!compiled.ok) return compiled;
  const result = createMission(ctx.dataDir, compiled.missionInput);
  if (!result.ok) return result;
  const taskResults = createMissionTasks(ctx, result.mission, "hanaagent-workflow");
  const mission = getMission(ctx.dataDir, result.mission.id) || result.mission;
  appendMissionEvent(ctx.dataDir, mission.id, {
    type: "workflow_compiled",
    label: `工作流已编译：${workflow.name}`,
    meta: { workflowId: workflow.id, workflowName: workflow.name }
  });
  return {
    ok: true,
    workflow,
    compiled: compiled.missionInput,
    mission: getMission(ctx.dataDir, mission.id) || mission,
    tasks: taskResults.map((item) => item.task)
  };
}



export async function syncHistoryCheckpoints(ctx, input = {}) {
  const history = await getSessionHistory(ctx, {
    sessionPath: input.sessionPath,
    limit: input.limit || 60
  });
  if (!history.ok) return { ok: false, error: history.error, history, created: [] };

  const created = [];
  const messages = Array.isArray(history.messages) ? history.messages : [];
  const checkpointMessages = messages.filter((message) => looksLikeCheckpoint(message.text));
  const existing = listCheckpoints(ctx.dataDir, {
    sessionPath: history.sessionPath,
    taskId: input.taskId || ""
  });
  for (const message of checkpointMessages) {
    if (existing.some((item) => item.rawText === message.text)) continue;
    const checkpoint = createCheckpoint(ctx.dataDir, {
      text: message.text,
      taskId: input.taskId || "",
      sessionPath: history.sessionPath,
      agentId: input.agentId || "",
      source: "session-history"
    });
    if (!checkpoint.ok) continue;
    checkpoint.handoff = materializeCheckpointHandoff(ctx, checkpoint.checkpoint, {
      ...input,
      sessionPath: history.sessionPath,
      tokenCount: message.tokenCount,
      source: "session-history"
    });
    if (input.taskId && input.applyToTask !== false && !checkpoint.checkpoint.conflict) {
      checkpoint.taskUpdate = moveTask(ctx.dataDir, input.taskId, checkpoint.checkpoint.columnSuggestion);
      checkpoint.missionUpdate = updateMissionFromCheckpoint(ctx.dataDir, {
        taskId: input.taskId,
        state: checkpoint.checkpoint.state,
        result: checkpoint.checkpoint.result,
        blocker: checkpoint.checkpoint.blocker,
        nextAction: checkpoint.checkpoint.nextAction,
        rawText: checkpoint.checkpoint.rawText,
        tokenCount: message.tokenCount
      });
    } else if (input.missionId && input.assignmentId && !checkpoint.checkpoint.conflict) {
      checkpoint.missionUpdate = updateMissionAssignment(ctx.dataDir, input.missionId, input.assignmentId, {
        state: checkpointStateToAssignmentState(checkpoint.checkpoint.state),
        output: checkpoint.checkpoint.rawText,
        result: checkpoint.checkpoint.result,
        blocker: checkpoint.checkpoint.blocker,
        nextAction: checkpoint.checkpoint.nextAction,
        tokenCount: message.tokenCount,
        sessionPath: history.sessionPath,
        agentId: input.agentId || ""
      });
    }
    created.push(checkpoint);
    existing.push(checkpoint.checkpoint);
  }

  if (input.missionId) {
    appendMissionEvent(ctx.dataDir, input.missionId, {
      type: "history_sync",
      label: `已从会话历史同步 ${created.length} 个检查点`,
      meta: { sessionPath: history.sessionPath, created: created.map((item) => item.checkpoint?.id).filter(Boolean) }
    });
  }

  return {
    ok: true,
    history,
    scanned: messages.length,
    matched: checkpointMessages.length,
    created
  };
}

function looksLikeCheckpoint(text) {
  const value = typeof text === "string" ? text : "";
  return /^\s*STATE\s*:/im.test(value) && /^\s*(RESULT|NEXT_ACTION)\s*:/im.test(value);
}

function checkpointStateToAssignmentState(state) {
  const normalized = String(state || "").toUpperCase();
  if (normalized === "DONE") return "done";
  if (normalized === "BLOCKED" || normalized === "NEEDS_INPUT") return "blocked";
  if (normalized === "HANDOFF" || normalized === "NEEDS_REVIEW") return "review";
  if (normalized === "IN_PROGRESS") return "running";
  return "checkpointed";
}

function materializeCheckpointHandoff(ctx, checkpoint, input = {}) {
  if (!checkpoint || checkpoint.state !== "HANDOFF") return null;
  const mission = input.missionId ? getMission(ctx.dataDir, input.missionId) : findMissionByCheckpoint(ctx.dataDir, checkpoint, input);
  const assignment = input.assignmentId && mission
    ? (mission.assignments || []).find((item) => item.id === input.assignmentId)
    : mission
      ? (mission.assignments || []).find((item) => item.taskId === checkpoint.taskId || item.sessionPath === checkpoint.sessionPath || item.agentId === checkpoint.agentId)
      : null;
  const result = materializeHandoff(ctx.dataDir, {
    checkpoint,
    workerId: input.workerId || assignment?.id || checkpoint.agentId || checkpoint.taskId || checkpoint.sessionPath,
    missionId: mission?.id || input.missionId,
    assignmentId: assignment?.id || input.assignmentId,
    createdAt: checkpoint.createdAt
  });
  if (result.ok && mission?.id) {
    appendMissionEvent(ctx.dataDir, mission.id, {
      type: "worker_handoff_materialized",
      label: `已保存 ${result.handoff.workerId} 的交接`,
      meta: {
        workerId: result.handoff.workerId,
        assignmentId: assignment?.id || input.assignmentId || "",
        checkpointId: checkpoint.id,
        memoryPath: result.handoff.memoryPath,
        archiveMemoryPath: result.handoff.archiveMemoryPath
      }
    });
  }
  return result;
}

function findMissionByCheckpoint(dataDir, checkpoint, input = {}) {
  const missions = listMissions(dataDir);
  for (const mission of missions) {
    const assignment = (mission.assignments || []).find((item) => {
      return (input.assignmentId && item.id === input.assignmentId)
        || (checkpoint.taskId && item.taskId === checkpoint.taskId)
        || (checkpoint.sessionPath && item.sessionPath === checkpoint.sessionPath)
        || (checkpoint.agentId && item.agentId === checkpoint.agentId);
    });
    if (assignment) return mission;
  }
  return null;
}

function buildMissionBroadcastPrompt({ mission, assignment, message }) {
  const roster = assignment?.roster || {};
  const brief = buildSwarmBrief({ mission, assignment, checkpointContract: getBlueprint().checkpointContract });
  const lines = [
    "HANACO SWARM BROADCAST",
    "",
    "SwarmBrief:",
    "```yaml",
    formatSwarmBrief(brief),
    "```",
    "",
    `Mission ID: ${mission.id}`,
    `Mission: ${mission.title}`,
    `Assignment ID: ${assignment.id}`,
    `Worker: ${assignment.label || assignment.roleId || assignment.id}`,
    roster.wrapper ? `Wrapper: ${roster.wrapper}` : "",
    Array.isArray(roster.tools) && roster.tools.length ? `Tools: ${roster.tools.join(", ")}` : "",
    Array.isArray(roster.skills) && roster.skills.length ? `Skills: ${roster.skills.join(", ")}` : "",
    Array.isArray(roster.greenlightRequiredFor) && roster.greenlightRequiredFor.length ? `Greenlight required for: ${roster.greenlightRequiredFor.join(", ")}` : "",
    "",
    "Broadcast instructions:",
    message,
    "",
    "Apply this only within your assignment boundary. If the broadcast conflicts with your current task, report the conflict instead of guessing.",
    "",
    "Checkpoint contract:",
    "STATE: DONE | BLOCKED | NEEDS_INPUT | HANDOFF | IN_PROGRESS | NEEDS_REVIEW",
    "FILES_CHANGED: exact paths or none",
    "COMMANDS_RUN: exact commands or none",
    "RESULT: concrete result/proof",
    "BLOCKER: blocker or none",
    "NEXT_ACTION: exact recommended next action"
  ];
  return lines.filter(Boolean).join("\n");
}










function buildHermesArtifactsCompat(ctx, input = {}) {
  const sessionPath = cleanString(input.sessionId || input.sessionPath);
  const limit = clampRouteNumber(input.limit, 1, 500, 100);
  const records = listRunRecords(ctx.dataDir, {
    type: "artifact",
    sessionPath
  });
  const toolArtifacts = listToolArtifacts(ctx.dataDir, { sessionPath, limit });
  const artifacts = [
    ...records.map(runRecordToHermesArtifactCompat),
    ...toolArtifacts.map(toolArtifactToHermesArtifactCompat)
  ]
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .slice(0, limit);
  return {
    ok: true,
    artifacts,
    source: "hanaagent-artifacts",
    summary: {
      total: artifacts.length,
      runRecords: records.length,
      toolOutputs: toolArtifacts.length
    }
  };
}

function buildHermesArtifactCompat(ctx, artifactId) {
  const record = listRunRecords(ctx.dataDir, { type: "artifact" }).find((item) => item.id === artifactId);
  if (!record) {
    const toolArtifact = readToolArtifact(ctx.dataDir, artifactId);
    if (!toolArtifact.ok) return { ok: false, error: "Artifact not found" };
    return {
      ok: true,
      artifact: {
        ...toolArtifactToHermesArtifactCompat(toolArtifact.artifact),
        content: toolArtifact.content
      },
      source: "hanaagent-tool-artifacts"
    };
  }
  return {
    ok: true,
    artifact: runRecordToHermesArtifactCompat(record),
    source: "hanaagent-run-records"
  };
}

function runRecordToHermesArtifactCompat(record = {}) {
  return {
    id: record.id,
    artifactId: record.id,
    sessionId: record.sessionPath || "",
    sessionPath: record.sessionPath || "",
    title: record.title,
    name: record.title,
    summary: record.summary || "",
    content: record.content || "",
    language: record.language || "",
    path: record.path || "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    tool: record.tool || "",
    metadata: {
      missionId: record.missionId || "",
      assignmentId: record.assignmentId || "",
      taskId: record.taskId || "",
      agentId: record.agentId || "",
      ...record.meta
    }
  };
}

function toolArtifactToHermesArtifactCompat(artifact = {}) {
  const preview = artifact.preview || artifact.contentPreview || "";
  return {
    id: artifact.artifactId || artifact.id,
    artifactId: artifact.artifactId || artifact.id,
    kind: artifact.kind || "tool_output",
    sessionId: artifact.sessionId || artifact.sessionPath || "",
    sessionPath: artifact.sessionPath || artifact.sessionId || "",
    messageId: artifact.messageId || "",
    toolCallId: artifact.toolCallId || "",
    title: artifact.title || "Tool output",
    name: artifact.title || "Tool output",
    summary: artifact.summary || preview || "",
    content: "",
    preview,
    contentPreview: preview,
    contentSize: artifact.contentSize || 0,
    language: "text",
    path: artifact.contentPath || "",
    createdAt: artifact.createdAt || "",
    updatedAt: artifact.updatedAt || artifact.createdAt || "",
    tool: artifact.toolName || "",
    metadata: {
      ...(artifact.metadata || {}),
      source: artifact.source || "hanaagent-tool-artifacts",
      lazyLoaded: true
    }
  };
}

function buildHermesTasksCompat(ctx, c) {
  const tasks = listTasks(ctx.dataDir, {
    includeDone: c.req.query("includeDone") === "true" || c.req.query("include_done") === "true",
    column: normalizeHermesTaskColumn(c.req.query("column") || ""),
    assignee: c.req.query("assignee") || "",
    priority: c.req.query("priority") || ""
  });
  return {
    ok: true,
    tasks: tasks.map(taskToHermesCompat),
    source: "hanaagent-task-store"
  };
}

function taskToHermesCompat(task = {}) {
  const column = task.column === "running" ? "in_progress" : task.column;
  return {
    ...task,
    column,
    due_date: task.dueDate || null,
    created_by: task.createdBy || "",
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    session_id: task.sessionPath || null,
    source: "hanaagent-task-store"
  };
}

async function handleHermesTaskActionCompat(ctx, taskId, action, body = {}, options = {}) {
  const normalizedAction = cleanString(action) || "move";
  if (normalizedAction === "move") {
    const column = normalizeHermesTaskColumn(body.column || body.lane);
    if (!column) return { ok: false, error: "column is required" };
    const result = moveTask(ctx.dataDir, taskId, { column, position: body.position });
    return result.ok ? { ok: true, task: taskToHermesCompat(result.task) } : { ok: false, error: "Task not found" };
  }
  if (normalizedAction === "launch") {
    const task = getTask(ctx.dataDir, taskId);
    if (!task) return { ok: false, error: "Task not found" };
    const title = `Task: ${task.title}`;
    const create = await createSession(ctx, {
      agentId: body.agentId || task.assignee || "",
      title,
      missionId: task.missionId || "",
      assignmentId: task.assignmentId || "",
      cwd: body.cwd || ""
    });
    const sessionPath = create.session?.path || task.sessionPath || "";
    const briefing = buildHermesTaskLaunchBriefing(task, body);
    let send = null;
    if (sessionPath) send = await sendSessionMessage(ctx, { sessionPath, text: briefing });
    if (sessionPath) updateTask(ctx.dataDir, taskId, { sessionPath });
    const updated = getTask(ctx.dataDir, taskId) || task;
    return {
      ok: Boolean(create.ok || send?.ok || sessionPath),
      sessionId: sessionPath,
      sessionPath,
      briefing,
      task: taskToHermesCompat(updated),
      create,
      send,
      source: "openhanako-session"
    };
  }
  if ((normalizedAction === "delete" || normalizedAction === "remove") && options.allowDelete) {
    const result = deleteTask(ctx.dataDir, taskId);
    return result.ok ? { ok: true } : { ok: false, error: "Task not found" };
  }
  return { ok: false, error: `Unsupported action: ${normalizedAction}` };
}

function buildHermesTaskLaunchBriefing(task = {}, body = {}) {
  return [
    "You are picking up a task from the HanaAgent / Hermes-compatible task board.",
    "",
    `Task: ${task.title}`,
    `Status: ${task.column} | Priority: ${task.priority} | Assignee: ${task.assignee || "Unassigned"}`,
    `Tags: ${(task.tags || []).join(", ") || "none"} | Due: ${task.dueDate || "none"}`,
    "",
    "Description:",
    task.description || "(none)",
    "",
    cleanString(body.instructions || body.prompt),
    "",
    "Report progress using the checkpoint contract: STATE, FILES_CHANGED, COMMANDS_RUN, RESULT, BLOCKER, NEXT_ACTION."
  ].filter((line) => line !== "").join("\n");
}

function buildHermesTaskAssigneesCompat(overview = {}) {
  const agents = (overview.agents || []).map((agent) => ({
    id: agent.id,
    label: agent.name || agent.id,
    type: "agent",
    available: true
  }));
  const workers = (overview.workerCards || []).map((worker) => ({
    id: worker.workerId || worker.id,
    label: worker.name || worker.title || worker.workerId || worker.id,
    type: "worker",
    available: worker.health !== "blocked",
    sessionPath: worker.sessionPath || worker.ide?.identity?.sessionPath || ""
  }));
  const seen = new Set();
  return [...agents, ...workers].filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function normalizeHermesTaskColumn(value) {
  const column = cleanString(value);
  if (!column) return "";
  if (column === "todo") return "backlog";
  if (column === "in_progress") return "running";
  if (["backlog", "running", "review", "blocked", "done"].includes(column)) return column;
  return column;
}

function hermesJobInputCompat(body = {}) {
  return {
    id: cleanString(body.id || body.jobId),
    title: cleanString(body.title || body.name) || "HanaAgent 定时作业",
    description: cleanString(body.description || body.summary),
    type: cleanString(body.type) || "dispatch-prompt",
    schedule: body.schedule || body.cron || body.cronExpression || "manual",
    status: body.enabled === false ? "paused" : cleanString(body.status) || "enabled",
    agentId: cleanString(body.agentId),
    missionId: cleanString(body.missionId),
    mode: cleanString(body.mode) === "run" ? "run" : "preview",
    prompt: cleanString(body.prompt || body.message),
    payload: body.payload && typeof body.payload === "object" ? body.payload : {}
  };
}

function jobToHermesJobCompat(job = {}) {
  return {
    ...job,
    jobId: job.id,
    name: job.title,
    enabled: job.status === "enabled",
    cron: job.schedule?.expression || "manual",
    nextRun: job.nextRunAt || null,
    lastRun: job.lastRunAt || null,
    source: "hanaagent-job-store"
  };
}

function runToHermesJobOutputCompat(run = {}) {
  return {
    id: run.id,
    jobId: run.jobId,
    status: run.status,
    output: run.output || run.summary || "",
    error: run.error || "",
    createdAt: run.createdAt,
    result: run.result || {}
  };
}

export function registerMissionRoutes(app, ctx, deps = {}) {
  if (deps.buildOverview) buildOverview = deps.buildOverview
  if (deps.buildApprovalQueue) buildApprovalQueue = deps.buildApprovalQueue
  if (deps.resolveApprovalRecord) resolveApprovalRecord = deps.resolveApprovalRecord
  if (deps.assignmentStateToColumn) assignmentStateToColumn = deps.assignmentStateToColumn

  app.get("/api/missions", (c) => {
    return c.json({
      ok: true,
      missions: listMissions(ctx.dataDir, {
        state: c.req.query("state") || "",
        includeArchived: c.req.query("includeArchived") === "true"
      })
    });
  });

  app.get("/api/missions/:missionId", (c) => {
    const mission = getMission(ctx.dataDir, c.req.param("missionId"));
    return c.json(mission ? { ok: true, mission } : { ok: false, error: "mission_not_found" }, mission ? 200 : 404);
  });

  app.get("/api/missions/:missionId/report", (c) => {
    const mission = getMission(ctx.dataDir, c.req.param("missionId"));
    if (!mission) return c.json({ ok: false, error: "mission_not_found" }, 404);
    return c.json({ ok: true, missionId: mission.id, report: buildMissionReport(mission), export: buildMissionExport(mission) });
  });

  app.get("/api/missions/:missionId/briefs", (c) => {
    const mission = getMission(ctx.dataDir, c.req.param("missionId"));
    if (!mission) return c.json({ ok: false, error: "mission_not_found" }, 404);
    const briefs = buildMissionBriefs(mission, { checkpointContract: getBlueprint().checkpointContract }).filter(Boolean);
    return c.json({
      ok: true,
      missionId: mission.id,
      briefs,
      yaml: briefs.map((brief) => formatSwarmBrief(brief)).join("\n---\n")
    });
  });

  app.get("/api/missions/:missionId/assignments/:assignmentId/brief", (c) => {
    const mission = getMission(ctx.dataDir, c.req.param("missionId"));
    if (!mission) return c.json({ ok: false, error: "mission_not_found" }, 404);
    const assignment = mission.assignments.find((item) => item.id === c.req.param("assignmentId"));
    if (!assignment) return c.json({ ok: false, error: "assignment_not_found" }, 404);
    const brief = buildSwarmBrief({ mission, assignment, checkpointContract: getBlueprint().checkpointContract });
    return c.json({
      ok: true,
      missionId: mission.id,
      assignmentId: assignment.id,
      brief,
      yaml: formatSwarmBrief(brief)
    });
  });

  app.post("/api/missions/:missionId/assignments/:assignmentId/brief/artifact", async (c) => {
    const mission = getMission(ctx.dataDir, c.req.param("missionId"));
    if (!mission) return c.json({ ok: false, error: "mission_not_found" }, 404);
    const assignment = mission.assignments.find((item) => item.id === c.req.param("assignmentId"));
    if (!assignment) return c.json({ ok: false, error: "assignment_not_found" }, 404);
    const body = await readJson(c);
    const brief = buildSwarmBrief({ mission, assignment, checkpointContract: getBlueprint().checkpointContract });
    const yaml = formatSwarmBrief(brief);
    const result = createRunRecord(ctx.dataDir, {
      type: "artifact",
      title: cleanString(body.title) || `SwarmBrief: ${assignment.label || assignment.id}`,
      summary: cleanString(body.summary) || `Versioned SwarmBrief contract for ${mission.title || mission.id}`,
      content: yaml,
      language: "yaml",
      missionId: mission.id,
      assignmentId: assignment.id,
      taskId: assignment.taskId || "",
      sessionPath: assignment.sessionPath || mission.sessionPath || "",
      agentId: assignment.agentId || mission.agentId || "",
      tool: "hanaagent-swarmbrief",
      meta: {
        briefId: brief.brief_id,
        worker: brief.worker,
        source: "mission-assignment-brief"
      }
    });
    if (result.ok) {
      appendMissionEvent(ctx.dataDir, mission.id, {
        type: "swarmbrief_artifact",
        label: `已记录 SwarmBrief 产物：${assignment.label || assignment.id}`,
        meta: { recordId: result.record.id, assignmentId: assignment.id, briefId: brief.brief_id }
      });
    }
    return c.json({ ...result, brief, yaml }, result.ok ? 200 : 422);
  });

  app.get("/api/inbox", (c) => {
    return c.json(buildMissionInboxSnapshot(ctx, { missionId: c.req.query("missionId") || "" }));
  });

  app.get("/api/missions/:missionId/inbox", (c) => {
    const result = buildMissionInboxSnapshot(ctx, { missionId: c.req.param("missionId") });
    if (!result.ok) return c.json(result, result.error === "mission_not_found" ? 404 : 422);
    return c.json(result);
  });

  app.get("/api/missions/:missionId/review-gate", (c) => {
    const result = buildMissionReviewGate(ctx, c.req.param("missionId"));
    if (!result.ok) return c.json(result, result.error === "mission_not_found" ? 404 : 422);
    return c.json(result);
  });

  app.post("/api/missions/:missionId/review-gate", async (c) => {
    const body = await readJson(c);
    const result = buildMissionReviewGate(ctx, c.req.param("missionId"));
    if (!result.ok) return c.json(result, result.error === "mission_not_found" ? 404 : 422);
    appendMissionEvent(ctx.dataDir, c.req.param("missionId"), {
      type: "review_gate",
      label: `Review gate ${result.gate.status}: ${result.gate.summary}`,
      meta: {
        status: result.gate.status,
        findings: result.gate.findings.map((item) => ({
          id: item.id,
          severity: item.severity,
          title: item.title
        })),
        recordedBy: cleanString(body.recordedBy) || "hanaagent-review-gate"
      }
    });
    return c.json({
      ...result,
      mission: getMission(ctx.dataDir, c.req.param("missionId")) || result.mission
    });
  });

  app.get("/api/autopilot", (c) => {
    const runs = listAutopilotRuns(ctx.dataDir, {
      missionId: c.req.query("missionId") || "",
      mode: c.req.query("mode") || ""
    });
    return c.json({ ok: true, runs, latest: runs[0] || null, schedule: getAutopilotScheduleConfig(ctx), loop: getAutopilotLoopState(ctx.dataDir) });
  });

  app.get("/api/autopilot/loop", (c) => {
    return c.json({ ok: true, loop: getAutopilotLoopState(ctx.dataDir), scheduler: ctx._hanaagentAutopilot?.status?.() || null });
  });

  app.post("/api/autopilot/loop", async (c) => {
    const body = await readJson(c);
    const action = cleanString(body.action) || "start";
    let result;
    if (action === "pause") result = pauseAutopilotLoop(ctx.dataDir, body);
    else if (action === "resume") result = resumeAutopilotLoop(ctx.dataDir, body);
    else if (action === "stop") result = stopAutopilotLoop(ctx.dataDir, body);
    else if (action === "complete") result = completeAutopilotLoop(ctx.dataDir, body);
    else if (action === "escalate") result = escalateAutopilotLoop(ctx.dataDir, body);
    else result = startAutopilotLoop(ctx.dataDir, body);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/autopilot/schedule", (c) => {
    return c.json({ ok: true, schedule: getAutopilotScheduleConfig(ctx), status: ctx._hanaagentAutopilot?.status?.() || null, loop: getAutopilotLoopState(ctx.dataDir) });
  });

  app.get("/api/jobs", (c) => {
    const jobs = listJobs(ctx.dataDir, {
      status: c.req.query("status") || "",
      type: c.req.query("type") || ""
    });
    return c.json({ ok: true, jobs, total: jobs.length, scheduler: ctx._hanaagentJobs?.status?.() || null });
  });

  app.get("/api/claude-jobs", (c) => {
    const jobs = listJobs(ctx.dataDir, {
      status: c.req.query("status") || "",
      type: c.req.query("type") || ""
    }).map(jobToHermesJobCompat);
    return c.json({ ok: true, jobs, items: jobs, source: "hanaagent-job-store", scheduler: ctx._hanaagentJobs?.status?.() || null });
  });

  app.post("/api/jobs", async (c) => {
    const result = createJob(ctx.dataDir, await readJson(c));
    return c.json(result, result.ok ? 200 : 422);
  });

  app.post("/api/claude-jobs", async (c) => {
    const body = await readJson(c);
    const result = createJob(ctx.dataDir, hermesJobInputCompat(body));
    return c.json(result.ok ? { ok: true, job: jobToHermesJobCompat(result.job), jobId: result.job.id } : result, result.ok ? 200 : 422);
  });

  app.get("/api/jobs/:jobId", (c) => {
    const job = getJob(ctx.dataDir, c.req.param("jobId"));
    if (!job) return c.json({ ok: false, error: "job_not_found" }, 404);
    return c.json({ ok: true, job });
  });

  app.get("/api/claude-jobs/:jobId", (c) => {
    const job = getJob(ctx.dataDir, c.req.param("jobId"));
    if (!job) return c.json({ ok: false, error: "job_not_found" }, 404);
    const action = cleanString(c.req.query("action"));
    if (action === "output" || action === "runs") {
      return c.json(action === "runs"
        ? { ok: true, jobId: job.id, runs: job.runs || [] }
        : { ok: true, jobId: job.id, outputs: (job.runs || []).map(runToHermesJobOutputCompat), runs: job.runs || [] });
    }
    return c.json({ ok: true, job: jobToHermesJobCompat(job) });
  });

  app.patch("/api/jobs/:jobId", async (c) => {
    const result = updateJob(ctx.dataDir, c.req.param("jobId"), await readJson(c));
    return c.json(result, result.ok ? 200 : 404);
  });

  app.patch("/api/claude-jobs/:jobId", async (c) => {
    const result = updateJob(ctx.dataDir, c.req.param("jobId"), hermesJobInputCompat(await readJson(c)));
    return c.json(result.ok ? { ok: true, job: jobToHermesJobCompat(result.job) } : result, result.ok ? 200 : 404);
  });

  app.post("/api/claude-jobs/:jobId", async (c) => {
    const action = cleanString(c.req.query("action"));
    let result;
    if (action === "pause") result = setJobStatus(ctx.dataDir, c.req.param("jobId"), "paused");
    else if (action === "resume") result = setJobStatus(ctx.dataDir, c.req.param("jobId"), "enabled");
    else if (action === "delete" || action === "remove") result = deleteJob(ctx.dataDir, c.req.param("jobId"));
    else if (action === "run" || action === "run-if-due" || action === "trigger") result = await triggerJob(ctx, c.req.param("jobId"), await readJson(c));
    else result = updateJob(ctx.dataDir, c.req.param("jobId"), hermesJobInputCompat(await readJson(c)));
    return c.json(result.ok && result.job ? { ok: true, job: jobToHermesJobCompat(result.job), run: result.run } : result, result.ok ? 200 : action ? 422 : 404);
  });

  app.delete("/api/jobs/:jobId", (c) => {
    const result = deleteJob(ctx.dataDir, c.req.param("jobId"));
    return c.json(result, result.ok ? 200 : 404);
  });

  app.delete("/api/claude-jobs/:jobId", (c) => {
    const result = deleteJob(ctx.dataDir, c.req.param("jobId"));
    return c.json(result, result.ok ? 200 : 404);
  });

  app.post("/api/jobs/:jobId/pause", (c) => {
    const result = setJobStatus(ctx.dataDir, c.req.param("jobId"), "paused");
    return c.json(result, result.ok ? 200 : 404);
  });

  app.post("/api/jobs/:jobId/resume", (c) => {
    const result = setJobStatus(ctx.dataDir, c.req.param("jobId"), "enabled");
    return c.json(result, result.ok ? 200 : 404);
  });

  app.post("/api/jobs/:jobId/trigger", async (c) => {
    const body = await readJson(c);
    const result = await triggerJob(ctx, c.req.param("jobId"), body);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/jobs/:jobId/output", (c) => {
    const job = getJob(ctx.dataDir, c.req.param("jobId"));
    if (!job) return c.json({ ok: false, error: "job_not_found" }, 404);
    return c.json({ ok: true, jobId: job.id, runs: job.runs, latest: job.runs[0] || null });
  });

  app.post("/api/autopilot/schedule", async (c) => {
    const schedule = setAutopilotScheduleConfig(ctx, await readJson(c));
    const status = schedule.enabled ? ctx._hanaagentAutopilot?.start?.() : ctx._hanaagentAutopilot?.stop?.();
    return c.json({ ok: true, schedule, status: status || null });
  });

  app.post("/api/autopilot/tick", async (c) => {
    const body = await readJson(c);
    const result = await runAutopilotTick(ctx, {
      reason: body.reason || "manual",
      config: {
        ...getAutopilotScheduleConfig(ctx),
        ...(body.mode ? { mode: body.mode } : {}),
        ...(body.maxMissionsPerTick ? { maxMissionsPerTick: body.maxMissionsPerTick } : {})
      }
    });
    return c.json(result, result.ok ? 200 : 422);
  });

  app.post("/api/missions/:missionId/autopilot", async (c) => {
    const mission = getMission(ctx.dataDir, c.req.param("missionId"));
    if (!mission) return c.json({ ok: false, error: "mission_not_found" }, 404);
    const body = await readJson(c);
    const result = await runMissionAutopilot(ctx, mission, body);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/missions/:missionId/export", (c) => {
    const mission = getMission(ctx.dataDir, c.req.param("missionId"));
    if (!mission) return c.json({ ok: false, error: "mission_not_found" }, 404);
    const filename = `${mission.title || mission.id}`.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || mission.id;
    c.header("content-type", "text/markdown; charset=utf-8");
    c.header("content-disposition", `attachment; filename="${filename}.md"`);
    return c.body(buildMissionReport(mission));
  });

  app.post("/api/missions/:missionId/report-artifact", async (c) => {
    const mission = getMission(ctx.dataDir, c.req.param("missionId"));
    if (!mission) return c.json({ ok: false, error: "mission_not_found" }, 404);
    const body = await readJson(c);
    const assignment = mission.assignments.find((item) => item.id === body.assignmentId)
      || mission.assignments.find((item) => item.state === "done")
      || mission.assignments[0]
      || {};
    const report = body.report && typeof body.report === "string" ? body.report : buildMissionReport(mission);
    const recordResult = createRunRecord(ctx.dataDir, {
      type: "artifact",
      title: body.title || `Mission report: ${mission.title || mission.id}`,
      summary: cleanString(body.summary) || firstNonEmptyServerLine(report).slice(0, 180) || `Mission report for ${mission.title || mission.id}`,
      content: report,
      language: "markdown",
      missionId: mission.id,
      assignmentId: body.assignmentId || assignment.id || "",
      taskId: body.taskId || assignment.taskId || "",
      sessionPath: body.sessionPath || mission.sessionPath || assignment.sessionPath || "",
      agentId: body.agentId || mission.agentId || assignment.agentId || "",
      state: body.state || "captured",
      requester: body.requester || "Mission Report",
      meta: {
        ...(body.meta && typeof body.meta === "object" ? body.meta : {}),
        source: "mission-report",
        missionState: mission.state,
        missionPhase: mission.phase,
        generatedAt: new Date().toISOString()
      }
    });
    if (!recordResult.ok) return c.json(recordResult, 422);

    appendMissionEvent(ctx.dataDir, mission.id, {
      type: "run_artifact",
      label: recordResult.record.title,
      meta: {
        recordId: recordResult.record.id,
        assignmentId: recordResult.record.assignmentId,
        state: recordResult.record.state,
        source: "mission-report"
      }
    });

    const result = { ok: true, record: recordResult.record, report };
    if (body.materialize !== false) {
      result.file = materializeRunRecordFile(ctx.dataDir, recordResult.record.id, {
        sessionPath: recordResult.record.sessionPath,
        language: "markdown"
      });
      if (result.file.ok) {
        result.sessionFile = stageArtifactFile(ctx, {
          sessionPath: recordResult.record.sessionPath,
          filePath: result.file.file.filePath,
          label: result.file.file.filename
        });
        result.contentUrl = `/api/plugins/${ctx.pluginId}/api/run-records/${encodeURIComponent(recordResult.record.id)}/artifact-file/content`;
        appendMissionEvent(ctx.dataDir, mission.id, {
          type: "run_artifact_file",
          label: `Mission report materialized: ${result.file.file.filename}`,
          meta: {
            recordId: recordResult.record.id,
            assignmentId: recordResult.record.assignmentId,
            file: result.file.file,
            sessionFile: result.sessionFile,
            source: "mission-report"
          }
        });
        result.record = result.file.record || result.record;
      }
    }
    if (body.preview) {
      const artifact = readRunRecordArtifactFile(ctx.dataDir, recordResult.record.id);
      if (artifact.ok) {
        result.preview = await registerArtifactHtmlPreview(ctx, c, artifact, {
          title: recordResult.record.title,
          sessionPath: recordResult.record.sessionPath
        });
        if (result.preview.ok && result.preview.previewUrl) {
          const updated = updateRunRecord(ctx.dataDir, recordResult.record.id, {
            meta: {
              ...((result.record && result.record.meta) || recordResult.record.meta),
              previewId: result.preview.previewId || "",
              previewUrl: result.preview.previewUrl,
              previewSource: result.preview.source || "host-preview",
              previewStatus: "ready",
              previewRegisteredAt: new Date().toISOString()
            }
          });
          if (updated.ok) result.record = updated.record;
          appendMissionEvent(ctx.dataDir, mission.id, {
            type: "run_artifact_preview",
            label: `Mission report preview registered: ${recordResult.record.title}`,
            meta: {
              recordId: recordResult.record.id,
              assignmentId: recordResult.record.assignmentId,
              previewUrl: result.preview.previewUrl,
              source: result.preview.source,
              sourceKind: "mission-report"
            }
          });
        }
      } else {
        result.preview = artifact;
      }
    }
    return c.json(result);
  });

  app.post("/api/missions", async (c) => {
    const body = await readJson(c);
    const result = createMission(ctx.dataDir, body);
    if (!result.ok) return c.json(result, 422);

    const taskResults = createMissionTasks(ctx, result.mission, "hanaagent-conductor");

    const mission = getMission(ctx.dataDir, result.mission.id) || result.mission;
    return c.json({ ok: true, mission, tasks: taskResults.map((item) => item.task) });
  });

  app.post("/api/missions/:missionId/continue", async (c) => {
    const previous = getMission(ctx.dataDir, c.req.param("missionId"));
    if (!previous) return c.json({ ok: false, error: "mission_not_found" }, 404);
    const body = await readJson(c);
    const continuationPrompt = buildContinuationPrompt(previous, body.instructions || body.notes || "");
    if (body.create === false) return c.json({ ok: true, previousMission: previous, continuationPrompt });

    const result = createMission(ctx.dataDir, {
      goal: continuationPrompt,
      title: `Continue: ${previous.title}`,
      notes: body.instructions || body.notes || "",
      mode: body.mode || previous.mode,
      templateId: body.templateId || previous.templateId,
      templateLabel: previous.templateLabel,
      sessionPath: body.sessionPath || previous.sessionPath,
      agentId: body.agentId || previous.agentId,
      maxWorkers: body.maxWorkers || previous.assignments.length || 1,
      createdBy: "hanaagent-continuation"
    });
    if (!result.ok) return c.json(result, 422);
    const previousEvent = appendMissionEvent(ctx.dataDir, previous.id, {
      type: "mission_continued",
      label: `已创建续接任务：${result.mission.title}`,
      meta: { continuationMissionId: result.mission.id }
    });

    const taskResults = createMissionTasks(ctx, result.mission, "hanaagent-continuation");
    const plannedMission = getMission(ctx.dataDir, result.mission.id) || result.mission;
    const continuationDispatch = body.dispatch === false || body.start === false
      ? []
      : await startContinuationAssignments(ctx, plannedMission, body);

    const mission = getMission(ctx.dataDir, result.mission.id) || plannedMission;
    return c.json({
      ok: true,
      previousMission: previousEvent.mission || getMission(ctx.dataDir, previous.id) || previous,
      mission,
      tasks: taskResults.map((item) => item.task),
      continuationPrompt,
      dispatch: continuationDispatch,
      started: continuationDispatch.some((item) => item.ok)
    });
  });

  app.patch("/api/missions/:missionId", async (c) => {
    const result = updateMission(ctx.dataDir, c.req.param("missionId"), await readJson(c));
    return c.json(result, result.ok ? 200 : 404);
  });

  app.post("/api/missions/:missionId/events", async (c) => {
    const result = appendMissionEvent(ctx.dataDir, c.req.param("missionId"), await readJson(c));
    return c.json(result, result.ok ? 200 : 404);
  });

  app.get("/api/run-records", (c) => {
    const records = listRunRecords(ctx.dataDir, {
      type: c.req.query("type") || "",
      missionId: c.req.query("missionId") || "",
      assignmentId: c.req.query("assignmentId") || "",
      sessionPath: c.req.query("sessionPath") || "",
      state: c.req.query("state") || ""
    });
    return c.json({ ok: true, records, summary: summarizeRunRecords(records) });
  });

  app.get("/api/run-learnings", (c) => {
    return c.json(buildRunLearnings(ctx, {
      category: c.req.query("category") || "",
      missionId: c.req.query("missionId") || "",
      assignmentId: c.req.query("assignmentId") || "",
      sessionPath: c.req.query("sessionPath") || "",
      limit: c.req.query("limit") || ""
    }));
  });

  app.get("/api/run-compare", (c) => {
    const result = buildRunCompare(ctx, {
      runA: c.req.query("runA") || c.req.query("a") || "",
      runB: c.req.query("runB") || c.req.query("b") || "",
      missionA: c.req.query("missionA") || "",
      missionB: c.req.query("missionB") || "",
      assignmentA: c.req.query("assignmentA") || "",
      assignmentB: c.req.query("assignmentB") || ""
    });
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/approvals", (c) => {
    const approvals = buildApprovalQueue(ctx, {
      status: c.req.query("status") || "",
      missionId: c.req.query("missionId") || "",
      assignmentId: c.req.query("assignmentId") || "",
      sessionPath: c.req.query("sessionPath") || "",
      limit: c.req.query("limit") || ""
    });
    return c.json({ ok: true, ...approvals, mode: "openhanako-plugin", source: "hanaagent-approvals" });
  });

  app.get("/api/gateway/approvals", (c) => {
    const approvals = buildApprovalQueue(ctx, {
      status: c.req.query("status") || "",
      missionId: c.req.query("missionId") || "",
      assignmentId: c.req.query("assignmentId") || "",
      sessionPath: c.req.query("sessionPath") || "",
      limit: c.req.query("limit") || ""
    });
    return c.json({ ok: true, ...approvals, mode: "openhanako-plugin", source: "hanaagent-gateway-approvals" });
  });

  app.post("/api/approvals/:approvalId/:action", async (c) => {
    const result = resolveApprovalRecord(ctx, c.req.param("approvalId"), c.req.param("action"), await readJson(c));
    return c.json(result, result.ok ? 200 : result.error === "approval_not_found" ? 404 : 422);
  });

  app.post("/api/gateway/approvals/:approvalId/:action", async (c) => {
    const result = resolveApprovalRecord(ctx, c.req.param("approvalId"), c.req.param("action"), await readJson(c));
    return c.json(result, result.ok ? 200 : result.error === "approval_not_found" ? 404 : 422);
  });

  app.get("/api/artifacts", (c) => {
    const result = buildHermesArtifactsCompat(ctx, {
      sessionId: c.req.query("sessionId") || c.req.query("sessionPath") || "",
      limit: c.req.query("limit") || ""
    });
    return c.json(result);
  });

  app.get("/api/artifacts/:artifactId", (c) => {
    const result = buildHermesArtifactCompat(ctx, c.req.param("artifactId"));
    return c.json(result, result.ok ? 200 : 404);
  });

  app.post("/api/run-records", async (c) => {
    const result = createRunRecord(ctx.dataDir, await readJson(c));
    if (result.ok && result.record.missionId) {
      appendMissionEvent(ctx.dataDir, result.record.missionId, {
        type: `run_${result.record.type}`,
        label: result.record.title,
        meta: { recordId: result.record.id, assignmentId: result.record.assignmentId, state: result.record.state }
      });
    }
    return c.json(result, result.ok ? 200 : 422);
  });

  app.patch("/api/run-records/:recordId", async (c) => {
    const result = updateRunRecord(ctx.dataDir, c.req.param("recordId"), await readJson(c));
    if (result.ok && result.record.missionId) {
      appendMissionEvent(ctx.dataDir, result.record.missionId, {
        type: `run_${result.record.type}_updated`,
        label: `${result.record.title}: ${result.record.state}`,
        meta: { recordId: result.record.id, assignmentId: result.record.assignmentId, state: result.record.state }
      });
    }
    return c.json(result, result.ok ? 200 : 404);
  });

  app.post("/api/run-records/:recordId/artifact-file", async (c) => {
    const body = await readJson(c);
    const result = materializeRunRecordFile(ctx.dataDir, c.req.param("recordId"), body);
    if (result.ok) {
      result.sessionFile = stageArtifactFile(ctx, {
        sessionPath: body.sessionPath || result.record.sessionPath,
        filePath: result.file.filePath,
        label: result.file.filename
      });
      result.contentUrl = `/api/plugins/${ctx.pluginId}/api/run-records/${encodeURIComponent(result.record.id)}/artifact-file/content`;
      if (result.record.missionId) {
        appendMissionEvent(ctx.dataDir, result.record.missionId, {
          type: "run_artifact_file",
          label: `产物文件已生成：${result.file.filename}`,
          meta: {
            recordId: result.record.id,
            assignmentId: result.record.assignmentId,
            file: result.file,
            sessionFile: result.sessionFile
          }
        });
      }
    }
    return c.json(result, result.ok ? 200 : result.error === "record_not_found" ? 404 : 422);
  });

  app.get("/api/run-records/:recordId/artifact-file/content", (c) => {
    const result = readRunRecordArtifactFile(ctx.dataDir, c.req.param("recordId"));
    if (!result.ok) return c.json(result, result.error === "record_not_found" ? 404 : 422);
    c.header("content-type", result.file.mime);
    c.header("content-disposition", `inline; filename="${result.file.filename.replace(/"/g, "_")}"`);
    return c.body(result.content);
  });

  app.post("/api/run-records/:recordId/artifact-preview", async (c) => {
    const body = await readJson(c);
    let artifact = readRunRecordArtifactFile(ctx.dataDir, c.req.param("recordId"));
    if (!artifact.ok && artifact.error === "artifact_file_missing") {
      const materialized = materializeRunRecordFile(ctx.dataDir, c.req.param("recordId"), body);
      if (materialized.ok) artifact = readRunRecordArtifactFile(ctx.dataDir, c.req.param("recordId"));
    }
    if (!artifact.ok) return c.json(artifact, artifact.error === "record_not_found" ? 404 : 422);

    const result = await registerArtifactHtmlPreview(ctx, c, artifact, body);
    if (result.ok && result.previewUrl) {
      updateRunRecord(ctx.dataDir, artifact.record.id, {
        meta: {
          ...artifact.record.meta,
          previewId: result.previewId || artifact.record.meta?.previewId || "",
          previewUrl: result.previewUrl,
          previewSource: result.source || artifact.record.meta?.previewSource || "host-preview",
          previewStatus: "ready",
          previewRegisteredAt: new Date().toISOString()
        }
      });
    }
    if (result.ok && artifact.record.missionId) {
      appendMissionEvent(ctx.dataDir, artifact.record.missionId, {
        type: "run_artifact_preview",
        label: `产物预览已注册：${artifact.record.title}`,
        meta: {
          recordId: artifact.record.id,
          assignmentId: artifact.record.assignmentId,
          previewUrl: result.previewUrl,
          source: result.source
        }
      });
    }
    return c.json(result, result.ok ? 200 : result.error === "html_preview_too_large" ? 413 : 503);
  });

  app.delete("/api/run-records/:recordId", (c) => {
    const result = deleteRunRecord(ctx.dataDir, c.req.param("recordId"));
    return c.json(result, result.ok ? 200 : 404);
  });

  app.post("/api/missions/:missionId/stop", async (c) => {
    const body = await readJson(c);
    const mission = getMission(ctx.dataDir, c.req.param("missionId"));
    if (!mission) return c.json({ ok: false, error: "mission_not_found" }, 404);
    const aborts = [];
    const sessionPaths = [...new Set([
      body.sessionPath,
      mission.sessionPath,
      ...mission.assignments.map((assignment) => assignment.sessionPath)
    ].map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean))];
    if (body.abortSessions !== false) {
      for (const sessionPath of sessionPaths) {
        aborts.push(await abortSession(ctx, { sessionPath }));
      }
    }
    const result = stopMission(ctx.dataDir, c.req.param("missionId"), body);
    if (result.ok) {
      result.aborts = aborts;
      result.hostTaskUpdates = await syncMissionHostTasks(ctx, result.mission, "cancelled", {
        reason: cleanReason(body.reason) || "mission stopped"
      });
      appendMissionEvent(ctx.dataDir, result.mission.id, {
        type: "session_abort",
        label: `已请求中止 ${aborts.filter((item) => item.ok).length}/${aborts.length} 个会话`,
        meta: { sessionPaths, aborts }
      });
      result.mission = getMission(ctx.dataDir, result.mission.id) || result.mission;
    }
    return c.json(result, result.ok ? 200 : 404);
  });

  app.post("/api/missions/:missionId/complete", async (c) => {
    const body = await readJson(c);
    const gateResult = buildMissionReviewGate(ctx, c.req.param("missionId"));
    if (!gateResult.ok) return c.json(gateResult, gateResult.error === "mission_not_found" ? 404 : 422);
    if (gateResult.gate.status === "fail" && body.force !== true) {
      appendMissionEvent(ctx.dataDir, c.req.param("missionId"), {
        type: "review_gate_blocked",
        label: `完成操作已阻止：${gateResult.gate.summary}`,
        meta: {
          status: gateResult.gate.status,
          findings: gateResult.gate.findings.map((item) => ({ id: item.id, severity: item.severity, title: item.title }))
        }
      });
      return c.json({
        ok: false,
        error: "review_gate_failed",
        gate: gateResult.gate,
        report: gateResult.report
      }, 409);
    }
    const result = completeMission(ctx.dataDir, c.req.param("missionId"), body);
    if (result.ok) {
      result.gate = gateResult.gate;
      result.reviewGateReport = gateResult.report;
      result.hostTaskUpdates = await syncMissionHostTasks(ctx, result.mission, "done", {
        result: { ok: true, missionId: result.mission.id, state: result.mission.state }
      });
      appendMissionEvent(ctx.dataDir, result.mission.id, {
        type: "review_gate",
        label: `Review gate ${gateResult.gate.status}: ${gateResult.gate.summary}`,
        meta: {
          status: gateResult.gate.status,
          forced: body.force === true,
          findings: gateResult.gate.findings.map((item) => ({ id: item.id, severity: item.severity, title: item.title }))
        }
      });
      appendMissionEvent(ctx.dataDir, result.mission.id, {
        type: "host_task_sync",
        label: `已完成 ${result.hostTaskUpdates.filter((item) => item.ok).length}/${result.hostTaskUpdates.length} 个宿主任务`,
        meta: { hostTaskUpdates: result.hostTaskUpdates }
      });
      result.mission = getMission(ctx.dataDir, result.mission.id) || result.mission;
    }
    return c.json(result, result.ok ? 200 : 404);
  });

  app.patch("/api/missions/:missionId/assignments/:assignmentId", async (c) => {
    const body = await readJson(c);
    const result = updateMissionAssignment(ctx.dataDir, c.req.param("missionId"), c.req.param("assignmentId"), body);
    if (result.ok && result.assignment.taskId) {
      const column = assignmentStateToColumn(result.assignment.state);
      result.taskUpdate = moveTask(ctx.dataDir, result.assignment.taskId, column);
    }
    if (result.ok) {
      result.hostTaskUpdate = await syncAssignmentHostTask(ctx, result.mission, result.assignment, result.assignment.state, {
        result: body.result ? { result: body.result } : undefined,
        reason: body.blocker || body.reason || ""
      });
      appendMissionEvent(ctx.dataDir, result.mission.id, {
        type: "host_task_sync",
        label: `已同步 ${result.assignment.label} 的宿主任务：${result.assignment.state}`,
        meta: { assignmentId: result.assignment.id, hostTaskUpdate: result.hostTaskUpdate }
      });
      result.mission = getMission(ctx.dataDir, result.mission.id) || result.mission;
    }
    return c.json(result, result.ok ? 200 : 404);
  });

  app.post("/api/missions/:missionId/dispatch", async (c) => {
    const mission = getMission(ctx.dataDir, c.req.param("missionId"));
    if (!mission) return c.json({ ok: false, error: "mission_not_found" }, 404);

    const body = await readJson(c);
    const assignmentId = body.assignmentId || "";
    const assignments = assignmentId
      ? mission.assignments.filter((assignment) => assignment.id === assignmentId)
      : mission.assignments.filter((assignment) => assignment.state !== "done" && assignment.state !== "cancelled");
    if (!assignments.length) return c.json({ ok: false, error: "assignment_not_found" }, 404);

    const sent = [];
    for (const assignment of assignments) {
      sent.push(await dispatchAssignmentForMission(ctx, mission, assignment, {
        sessionPath: body.sessionPath || assignment.sessionPath || mission.sessionPath
      }));
    }
    appendMissionEvent(ctx.dataDir, mission.id, {
      type: "dispatch",
      label: `已投递 ${sent.filter((item) => item.ok).length}/${sent.length} 个任务分派`,
      meta: {
        assignmentIds: assignments.map((assignment) => assignment.id),
        hostTaskIds: sent.map((item) => item.hostTask?.taskId).filter(Boolean)
      }
    });
    appendMissionEvent(ctx.dataDir, mission.id, {
      type: "host_task_sync",
      label: `已注册 ${sent.filter((item) => item.hostTask?.ok).length}/${sent.length} 个宿主任务`,
      meta: { hostTasks: sent.map((item) => item.hostTask).filter(Boolean) }
    });
    return c.json({ ok: sent.some((item) => item.ok), sent }, sent.some((item) => item.ok) ? 200 : 503);
  });

  app.post("/api/missions/:missionId/broadcast", async (c) => {
    const mission = getMission(ctx.dataDir, c.req.param("missionId"));
    if (!mission) return c.json({ ok: false, error: "mission_not_found" }, 404);
    const body = await readJson(c);
    const message = cleanString(body.message || body.text || body.prompt || body.instructions);
    if (!message) return c.json({ ok: false, error: "message_required" }, 422);
    const includeNonBroadcast = body.includeNonBroadcast === true;
    const targetState = cleanString(body.state || body.targetState);
    let assignments = mission.assignments.filter((assignment) => assignment.state !== "done" && assignment.state !== "cancelled");
    if (targetState) assignments = assignments.filter((assignment) => assignment.state === targetState);
    if (Array.isArray(body.assignmentIds) && body.assignmentIds.length) {
      const ids = new Set(body.assignmentIds.map(cleanString).filter(Boolean));
      assignments = assignments.filter((assignment) => ids.has(assignment.id));
    }
    const sent = [];
    const skipped = [];
    for (const assignment of assignments) {
      const accepts = assignment.roster?.acceptsBroadcast === true || includeNonBroadcast;
      const sessionPath = cleanString(body.sessionPath) || assignment.sessionPath || mission.sessionPath || "";
      if (!accepts) {
        skipped.push({ assignmentId: assignment.id, label: assignment.label, reason: "acceptsBroadcast_false" });
        continue;
      }
      if (!sessionPath) {
        skipped.push({ assignmentId: assignment.id, label: assignment.label, reason: "sessionPath_required" });
        continue;
      }
      const prompt = buildMissionBroadcastPrompt({ mission, assignment, message });
      const result = await sendSessionMessage(ctx, { sessionPath, text: prompt });
      const brief = buildSwarmBrief({ mission, assignment, checkpointContract: getBlueprint().checkpointContract });
      sent.push({ ...result, assignmentId: assignment.id, label: assignment.label, acceptsBroadcast: assignment.roster?.acceptsBroadcast === true, brief });
    }
    appendMissionEvent(ctx.dataDir, mission.id, {
      type: "broadcast",
      label: `广播已发送给 ${sent.filter((item) => item.ok).length}/${sent.length} 个执行智能体`,
      meta: {
        message: clipForEvent(message, 1000),
        assignmentIds: sent.map((item) => item.assignmentId),
        skipped,
        includeNonBroadcast
      }
    });
    const latest = getMission(ctx.dataDir, mission.id) || mission;
    return c.json({
      ok: sent.some((item) => item.ok),
      mission: latest,
      sent,
      skipped
    }, sent.some((item) => item.ok) ? 200 : sent.length ? 503 : 422);
  });

  app.post("/api/missions/:missionId/swarm-launch", async (c) => {
    const mission = getMission(ctx.dataDir, c.req.param("missionId"));
    if (!mission) return c.json({ ok: false, error: "mission_not_found" }, 404);

    const body = await readJson(c);
    const assignmentId = body.assignmentId || "";
    const assignments = assignmentId
      ? mission.assignments.filter((assignment) => assignment.id === assignmentId)
      : mission.assignments.filter((assignment) => assignment.state !== "done" && assignment.state !== "cancelled");
    if (!assignments.length) return c.json({ ok: false, error: "assignment_not_found" }, 404);

    const launched = [];
    for (const assignment of assignments) {
      const launch = await launchAssignmentWorkerSession(ctx, mission, assignment, body);
      launched.push(launch);
    }
    appendMissionEvent(ctx.dataDir, mission.id, {
      type: "swarm_launch",
      label: `已启动 ${launched.filter((item) => item.ok).length}/${launched.length} 个专用执行智能体会话`,
      meta: {
        assignmentIds: assignments.map((assignment) => assignment.id),
        sessionPaths: launched.map((item) => item.sessionPath).filter(Boolean),
        hostTaskIds: launched.map((item) => item.hostTask?.taskId).filter(Boolean)
      }
    });
    const updatedMission = getMission(ctx.dataDir, mission.id) || mission;
    return c.json({
      ok: launched.some((item) => item.ok),
      mission: updatedMission,
      launched
    }, launched.some((item) => item.ok) ? 200 : 503);
  });

  app.get("/api/tasks", (c) => {
    const result = {
      ok: true,
      tasks: listTasks(ctx.dataDir, {
        includeDone: c.req.query("includeDone") === "true",
        column: c.req.query("column") || "",
        assignee: c.req.query("assignee") || "",
        priority: c.req.query("priority") || ""
      })
    };
    return c.json(result);
  });

  app.get("/api/claude-tasks", (c) => {
    return c.json(buildHermesTasksCompat(ctx, c));
  });

  app.get("/api/hermes-tasks", (c) => {
    return c.json(buildHermesTasksCompat(ctx, c));
  });

  app.post("/api/tasks", async (c) => {
    const result = createTask(ctx.dataDir, await readJson(c));
    return c.json(result, result.ok ? 200 : 422);
  });

  app.post("/api/claude-tasks", async (c) => {
    const result = createTask(ctx.dataDir, await readJson(c));
    return c.json(result.ok ? { ok: true, task: taskToHermesCompat(result.task) } : { ok: false, error: result.error || "invalid_request" }, result.ok ? 201 : 400);
  });

  app.post("/api/hermes-tasks", async (c) => {
    const result = createTask(ctx.dataDir, await readJson(c));
    return c.json(result.ok ? { ok: true, task: taskToHermesCompat(result.task) } : { ok: false, error: result.error || "invalid_request" }, result.ok ? 201 : 400);
  });

  app.post("/api/tasks/batch", async (c) => {
    const result = batchUpdateTasks(ctx.dataDir, await readJson(c));
    return c.json(result, result.ok ? 200 : result.error === "task_ids_required" || result.error === "unsupported_batch_action" ? 422 : 207);
  });

  app.patch("/api/tasks/:taskId", async (c) => {
    const result = updateTask(ctx.dataDir, c.req.param("taskId"), await readJson(c));
    return c.json(result, result.ok ? 200 : 404);
  });

  app.get("/api/claude-tasks/:taskId", (c) => {
    const task = getTask(ctx.dataDir, c.req.param("taskId"));
    return c.json(task ? { ok: true, task: taskToHermesCompat(task) } : { ok: false, error: "Task not found" }, task ? 200 : 404);
  });

  app.get("/api/hermes-tasks/:taskId", (c) => {
    const task = getTask(ctx.dataDir, c.req.param("taskId"));
    return c.json(task ? { ok: true, task: taskToHermesCompat(task) } : { ok: false, error: "Task not found" }, task ? 200 : 404);
  });

  app.patch("/api/claude-tasks/:taskId", async (c) => {
    const result = updateTask(ctx.dataDir, c.req.param("taskId"), await readJson(c));
    return c.json(result.ok ? { ok: true, task: taskToHermesCompat(result.task) } : { ok: false, error: "Task not found" }, result.ok ? 200 : 404);
  });

  app.patch("/api/hermes-tasks/:taskId", async (c) => {
    const result = updateTask(ctx.dataDir, c.req.param("taskId"), await readJson(c));
    return c.json(result.ok ? { ok: true, task: taskToHermesCompat(result.task) } : { ok: false, error: "Task not found" }, result.ok ? 200 : 404);
  });

  app.post("/api/tasks/:taskId/move", async (c) => {
    const body = await readJson(c);
    const result = moveTask(ctx.dataDir, c.req.param("taskId"), body);
    return c.json(result, result.ok ? 200 : 404);
  });

  app.post("/api/claude-tasks/:taskId", async (c) => {
    const result = await handleHermesTaskActionCompat(ctx, c.req.param("taskId"), c.req.query("action") || "move", await readJson(c), { allowDelete: false });
    return c.json(result, result.ok ? 200 : result.error === "Task not found" ? 404 : 400);
  });

  app.post("/api/hermes-tasks/:taskId", async (c) => {
    const result = await handleHermesTaskActionCompat(ctx, c.req.param("taskId"), c.req.query("action") || "move", await readJson(c), { allowDelete: true });
    return c.json(result, result.ok ? 200 : result.error === "Task not found" ? 404 : 400);
  });

  app.delete("/api/tasks/:taskId", (c) => {
    const result = deleteTask(ctx.dataDir, c.req.param("taskId"));
    return c.json(result, result.ok ? 200 : 404);
  });

  app.delete("/api/claude-tasks/:taskId", (c) => {
    return c.json({ ok: false, error: "Delete is not supported by the shared Agent Kanban backend" }, 405);
  });

  app.delete("/api/hermes-tasks/:taskId", (c) => {
    const result = deleteTask(ctx.dataDir, c.req.param("taskId"));
    return c.json(result.ok ? { ok: true } : { ok: false, error: "Task not found" }, result.ok ? 200 : 404);
  });

  app.get("/api/claude-tasks-assignees", async (c) => {
    const overview = await buildOverview(ctx);
    const assignees = buildHermesTaskAssigneesCompat(overview);
    return c.json({ ok: true, assignees });
  });

  app.post("/api/tasks/clear-done", (c) => {
    return c.json(clearDoneTasks(ctx.dataDir));
  });

  app.get("/api/checkpoints", (c) => {
    const filters = {
      taskId: c.req.query("taskId") || "",
      sessionPath: c.req.query("sessionPath") || "",
      state: c.req.query("state") || ""
    };
    return c.json({
      ok: true,
      checkpoints: listCheckpoints(ctx.dataDir, filters),
      conflicts: listCheckpointConflicts(ctx.dataDir, filters)
    });
  });

  app.get("/api/checkpoint-reminders", (c) => {
    const filters = {
      taskId: c.req.query("taskId") || "",
      sessionPath: c.req.query("sessionPath") || "",
      state: c.req.query("state") || "",
      includeSuperseded: c.req.query("includeSuperseded") === "true"
    };
    const dueOnly = c.req.query("due") === "true";
    if (dueOnly) filters.dueBefore = c.req.query("dueBefore") || new Date().toISOString();
    const reminders = listCheckpointReminders(ctx.dataDir, filters);
    return c.json({
      ok: true,
      reminders,
      summary: {
        total: reminders.length,
        due: reminders.filter((item) => item.due).length,
        blocked: reminders.filter((item) => item.state === "BLOCKED" || item.blocker).length
      }
    });
  });

  app.post("/api/checkpoints", async (c) => {
    const body = await readJson(c);
    const result = createCheckpoint(ctx.dataDir, body);
    if (result.ok) {
      result.handoff = materializeCheckpointHandoff(ctx, result.checkpoint, body);
    }
    if (result.ok && body.taskId && body.applyToTask !== false && !result.checkpoint.conflict) {
      result.taskUpdate = moveTask(ctx.dataDir, body.taskId, result.checkpoint.columnSuggestion);
      result.missionUpdate = updateMissionFromCheckpoint(ctx.dataDir, {
        taskId: body.taskId,
        state: result.checkpoint.state,
        result: result.checkpoint.result,
        blocker: result.checkpoint.blocker,
        nextAction: result.checkpoint.nextAction,
        rawText: result.checkpoint.rawText
      });
    }
    return c.json(result, result.ok ? 200 : 422);
  });

  app.post("/api/checkpoints/:checkpointId/resolve", async (c) => {
    const body = await readJson(c);
    const result = resolveCheckpointConflict(ctx.dataDir, {
      ...body,
      checkpointId: c.req.param("checkpointId")
    });
    if (result.ok && result.accepted?.taskId && body.applyToTask !== false) {
      result.taskUpdate = moveTask(ctx.dataDir, result.accepted.taskId, result.accepted.columnSuggestion);
      result.missionUpdate = updateMissionFromCheckpoint(ctx.dataDir, {
        taskId: result.accepted.taskId,
        state: result.accepted.state,
        result: result.accepted.result,
        blocker: result.accepted.blocker,
        nextAction: result.accepted.nextAction,
        rawText: result.accepted.rawText
      });
    }
    return c.json(result, result.ok ? 200 : 404);
  });

  app.post("/api/checkpoints/:checkpointId/reminder", async (c) => {
    const result = updateCheckpointReminder(ctx.dataDir, c.req.param("checkpointId"), await readJson(c));
    return c.json(result, result.ok ? 200 : result.error === "checkpoint_not_found" ? 404 : 422);
  });

  app.post("/api/checkpoints/sync-history", async (c) => {
    const body = await readJson(c);
    const result = await syncHistoryCheckpoints(ctx, body);
    return c.json(result, result.ok ? 200 : result.error === "sessionPath_required" ? 422 : 503);
  });

  app.delete("/api/checkpoints/:checkpointId", (c) => {
    const result = deleteCheckpoint(ctx.dataDir, c.req.param("checkpointId"));
    return c.json(result, result.ok ? 200 : 404);
  });

  app.post("/api/checkpoints/clear", async (c) => {
    return c.json(clearCheckpoints(ctx.dataDir, await readJson(c)));
  });

  app.post("/api/defaults", async (c) => {
    const body = await readJson(c);
    const values = {};
    if (typeof body.defaultAgentId === "string") values.defaultAgentId = body.defaultAgentId.trim();
    if (typeof body.defaultSessionPath === "string") values.defaultSessionPath = body.defaultSessionPath.trim();
    if (Array.isArray(body.workspaceRoots)) values.workspaceRoots = body.workspaceRoots.slice(0, 20);
    if (body.autopilotSchedule && typeof body.autopilotSchedule === "object") values.autopilotSchedule = body.autopilotSchedule;
    if (body.workerLifecyclePolicy && typeof body.workerLifecyclePolicy === "object") values.workerLifecyclePolicy = body.workerLifecyclePolicy;
    if (Array.isArray(body.savedMissions)) values.savedMissions = body.savedMissions.slice(0, 20);
    if (Array.isArray(body.pinnedSessions)) values.pinnedSessions = normalizePinnedSessions(body.pinnedSessions);
    if (Array.isArray(body.pinnedModels)) values.pinnedModels = normalizePinnedModels(body.pinnedModels);
    if (Array.isArray(body.modelMetadata)) values.modelMetadata = normalizeModelMetadataConfig(body.modelMetadata);
    if (Array.isArray(body.sessionAliases)) values.sessionAliases = normalizeSessionAliases(body.sessionAliases);
    if (Array.isArray(body.sessionTombstones)) values.sessionTombstones = normalizeSessionTombstones(body.sessionTombstones);
    if (Array.isArray(body.savedBoardViews)) values.savedBoardViews = normalizeSavedBoardViews(body.savedBoardViews);
    if (body.boardWipLimits && typeof body.boardWipLimits === "object") values.boardWipLimits = normalizeBoardWipLimits(body.boardWipLimits);
    if (Array.isArray(body.workbenchModes)) values.workbenchModes = normalizeWorkbenchModes(body.workbenchModes);
    if (typeof body.activeWorkbenchModeId === "string") values.activeWorkbenchModeId = body.activeWorkbenchModeId.trim().slice(0, 64);
    if (body.workbenchNotifications && typeof body.workbenchNotifications === "object") values.workbenchNotifications = normalizeWorkbenchNotifications(body.workbenchNotifications);
    if (body.workbenchSettings && typeof body.workbenchSettings === "object") values.workbenchSettings = normalizeWorkbenchSettings(body.workbenchSettings);
    if (body.workbenchOnboarding && typeof body.workbenchOnboarding === "object") values.workbenchOnboarding = normalizeWorkbenchOnboarding(body.workbenchOnboarding);
    ctx.config.setMany(values);
    return c.json({ ok: true, config: ctx.config.getAll() });
  });

}
