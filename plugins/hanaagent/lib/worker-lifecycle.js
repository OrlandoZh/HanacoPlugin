const DEFAULT_CONTEXT_POLICY = {
  softLimit: 250000,
  handoffLimit: 400000,
  hardLimit: 500000,
  staleMinutes: 90
};

export function buildWorkerLifecycle(input = {}) {
  const policy = normalizePolicy(input.policy);
  const worker = input.worker || {};
  const assignment = input.assignment || worker.activeAssignment || {};
  const usage = input.usage || {};
  const checkpoints = Array.isArray(input.checkpoints) ? input.checkpoints : [];
  const sessions = Array.isArray(input.sessions) ? input.sessions : [];
  const sessionPath = clean(input.sessionPath || assignment.sessionPath || worker.sessions?.[0]?.path || sessions[0]?.path);
  const contextTokens = contextTokenCount({ usage, sessions, checkpoints, assignment });
  const percent = policy.hardLimit > 0 ? Math.round((contextTokens / policy.hardLimit) * 1000) / 10 : 0;
  const latestCheckpoint = checkpoints[0] || null;
  const staleMinutes = latestCheckpoint ? ageMinutes(latestCheckpoint.createdAt || latestCheckpoint.updatedAt) : null;
  const repeatedBlockers = checkpoints.filter((checkpoint) => ["BLOCKED", "NEEDS_INPUT"].includes(clean(checkpoint.state).toUpperCase())).length;
  const assignmentBlocked = Boolean(clean(assignment.blocker)) || ["blocked", "needs-input"].includes(clean(assignment.state));
  const hasHandoff = checkpoints.some((checkpoint) => clean(checkpoint.state).toUpperCase() === "HANDOFF");

  let state = "healthy";
  let recommendedAction = "continue";
  const reasons = [];
  if (contextTokens >= policy.hardLimit) {
    state = "renew_required";
    recommendedAction = "renew-worker";
    reasons.push(`context tokens ${contextTokens} >= hard limit ${policy.hardLimit}`);
  } else if (contextTokens >= policy.handoffLimit) {
    state = "handoff_required";
    recommendedAction = "request-handoff";
    reasons.push(`context tokens ${contextTokens} >= handoff limit ${policy.handoffLimit}`);
  } else if (contextTokens >= policy.softLimit) {
    state = "watch";
    recommendedAction = "monitor-context";
    reasons.push(`context tokens ${contextTokens} >= soft limit ${policy.softLimit}`);
  }

  if (state !== "renew_required" && repeatedBlockers >= 2) {
    state = "handoff_required";
    recommendedAction = "request-handoff";
    reasons.push(`repeated blockers ${repeatedBlockers}`);
  }
  if (state === "healthy" && staleMinutes !== null && staleMinutes > policy.staleMinutes) {
    state = "watch";
    recommendedAction = "sync-history";
    reasons.push(`latest checkpoint stale for ${Math.round(staleMinutes)} minutes`);
  }
  if (assignmentBlocked && state === "healthy") {
    state = "blocked";
    recommendedAction = "review-blocker";
    reasons.push("assignment is blocked");
  }

  return {
    ok: true,
    state,
    lifecycleState: state,
    recommendedAction,
    contextTokens,
    contextPercentOfHardLimit: percent,
    sessionPath,
    policy,
    staleMinutes,
    repeatedBlockers,
    hasHandoff,
    lastHandoffAt: latestHandoffAt(checkpoints),
    latestCheckpointAt: latestCheckpoint?.createdAt || latestCheckpoint?.updatedAt || "",
    canRequestHandoff: Boolean(sessionPath && ["watch", "handoff_required", "renew_required", "blocked"].includes(state)),
    canRenew: state === "renew_required" && hasHandoff,
    reasons: reasons.length ? reasons : ["worker is within lifecycle policy"]
  };
}

export function buildHandoffPrompt(input = {}) {
  const worker = input.worker || {};
  const assignment = input.assignment || worker.activeAssignment || {};
  const lifecycle = input.lifecycle || buildWorkerLifecycle(input);
  return [
    "## HanaAgent Worker Lifecycle Handoff",
    "",
    `Worker: ${clean(worker.name || worker.id || assignment.label || assignment.id) || "worker"}`,
    `Lifecycle state: ${lifecycle.state || lifecycle.lifecycleState || "handoff_required"}`,
    `Context tokens: ${lifecycle.contextTokens || 0}`,
    assignment.missionTitle ? `Mission: ${assignment.missionTitle}` : "",
    assignment.task || assignment.title ? `Current task: ${assignment.task || assignment.title}` : "",
    assignment.result ? `Current result: ${assignment.result}` : "",
    assignment.blocker ? `Current blocker: ${assignment.blocker}` : "",
    "",
    "Write a durable handoff now. Use exactly this contract:",
    "",
    "STATE: HANDOFF",
    "FILES_CHANGED: <files changed or none>",
    "COMMANDS_RUN: <commands run or none>",
    "RESULT: <current state, what landed, and evidence>",
    "BLOCKER: <blocker or none>",
    "NEXT_ACTION: <exact next step after renewal>",
    "",
    "Keep it concise, factual, and sufficient for a clean worker renewal."
  ].filter((line) => line !== "").join("\n");
}

function contextTokenCount({ usage, sessions, checkpoints, assignment }) {
  const usageSummary = usage.summary || {};
  const candidates = [
    usageSummary.totalTokens,
    usageSummary.usageTotalTokens,
    assignment.tokenCount,
    ...sessions.map((session) => session.tokenCount || session.contextTokens || session.totalTokens),
    ...checkpoints.map((checkpoint) => checkpoint.tokenCount)
  ].map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0);
  return candidates.length ? Math.max(...candidates) : 0;
}

function normalizePolicy(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  return {
    softLimit: clampInt(source.softLimit || source.soft || source.warningLimit, 1000, 1000000, DEFAULT_CONTEXT_POLICY.softLimit),
    handoffLimit: clampInt(source.handoffLimit || source.handoff, 1000, 1000000, DEFAULT_CONTEXT_POLICY.handoffLimit),
    hardLimit: clampInt(source.hardLimit || source.hard, 1000, 1000000, DEFAULT_CONTEXT_POLICY.hardLimit),
    staleMinutes: clampInt(source.staleMinutes || source.stale, 5, 10080, DEFAULT_CONTEXT_POLICY.staleMinutes)
  };
}

function latestHandoffAt(checkpoints = []) {
  const handoff = checkpoints.find((checkpoint) => clean(checkpoint.state).toUpperCase() === "HANDOFF");
  return handoff?.createdAt || handoff?.updatedAt || "";
}

function ageMinutes(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, (Date.now() - time) / 60000);
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
