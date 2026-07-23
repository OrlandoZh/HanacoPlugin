import { buildReviewGate } from "./review-gate.js";

const OPEN_STATES = new Set(["open", "pending", "new"]);

export function buildMissionInbox(input = {}) {
  const missions = Array.isArray(input.missions) ? input.missions : [];
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const checkpoints = Array.isArray(input.checkpoints) ? input.checkpoints : [];
  const runRecords = Array.isArray(input.runRecords) ? input.runRecords : [];
  const items = [];

  for (const mission of missions) {
    const assignments = Array.isArray(mission.assignments) ? mission.assignments : [];
    const missionTasks = tasks.filter((task) => task.missionId === mission.id || assignments.some((assignment) => assignment.id === task.assignmentId || assignment.taskId === task.id));
    const missionCheckpoints = checkpoints.filter((checkpoint) => checkpoint.missionId === mission.id || missionTasks.some((task) => task.id === checkpoint.taskId) || assignments.some((assignment) => assignment.taskId === checkpoint.taskId || assignment.sessionPath === checkpoint.sessionPath));
    const missionRunRecords = runRecords.filter((record) => record.missionId === mission.id || assignments.some((assignment) => assignment.id === record.assignmentId || assignment.taskId === record.taskId));

    for (const assignment of assignments) {
      if (assignment.state === "blocked" || meaningful(assignment.blocker)) {
        items.push(inboxItem({
          id: `assignment-blocked-${assignment.id}`,
          kind: "blocker",
          severity: "critical",
          title: `${assignment.label || assignment.id} 阻塞`,
          detail: assignment.blocker || assignment.nextAction || "任务分派已阻塞。",
          mission,
          assignment,
          action: "处理 blocker 或重新分派"
        }));
      }
      if (assignment.state === "review" || assignment.state === "checkpointed") {
        items.push(inboxItem({
          id: `assignment-review-${assignment.id}`,
          kind: "review",
          severity: "medium",
          title: `${assignment.label || assignment.id} 等待复核`,
          detail: assignment.result || assignment.nextAction || "执行智能体输出已可复核。",
          mission,
          assignment,
          action: "运行 reviewer/QA 或记录复核结论"
        }));
      }
    }

    for (const checkpoint of missionCheckpoints) {
      const state = String(checkpoint.state || "").toUpperCase();
      if (state === "BLOCKED" || state === "NEEDS_INPUT" || meaningful(checkpoint.blocker)) {
        items.push(inboxItem({
          id: `checkpoint-${checkpoint.id}`,
          kind: state === "NEEDS_INPUT" ? "needs-input" : "blocker",
          severity: state === "NEEDS_INPUT" ? "high" : "critical",
          title: state === "NEEDS_INPUT" ? "Checkpoint 需要输入" : "Checkpoint 阻塞",
          detail: checkpoint.blocker || checkpoint.nextAction || checkpoint.result || state,
          mission,
          taskId: checkpoint.taskId,
          checkpoint,
          action: state === "NEEDS_INPUT" ? "补充用户输入" : "解除 checkpoint blocker"
        }));
      }
      if (state === "NEEDS_REVIEW" || state === "HANDOFF") {
        items.push(inboxItem({
          id: `checkpoint-review-${checkpoint.id}`,
          kind: "review",
          severity: "medium",
          title: "Checkpoint 等待复核",
          detail: checkpoint.result || checkpoint.nextAction || state,
          mission,
          taskId: checkpoint.taskId,
          checkpoint,
          action: "复核 worker handoff"
        }));
      }
    }

    for (const record of missionRunRecords) {
      if (record.type === "approval" && record.state === "pending") {
        items.push(inboxItem({
          id: `approval-${record.id}`,
          kind: "approval",
          severity: "critical",
          title: `待审批：${record.title}`,
          detail: record.summary || record.requester || "审批仍待处理。",
          mission,
          assignmentId: record.assignmentId,
          record,
          action: "批准或拒绝审批请求"
        }));
      }
    }

    const gate = buildReviewGate({ mission, tasks, checkpoints, runRecords });
    if (gate.ok && gate.status !== "pass") {
      for (const finding of gate.findings.slice(0, 8)) {
        items.push(inboxItem({
          id: `review-gate-${mission.id}-${finding.id}`,
          kind: "review-gate",
          severity: finding.severity === "fail" ? "high" : "medium",
          title: finding.title,
          detail: finding.detail || gate.summary,
          mission,
          assignmentId: finding.meta?.assignmentId || null,
          taskId: finding.meta?.taskId || null,
          recordId: finding.meta?.recordId || null,
          action: finding.severity === "fail" ? "修复门禁阻塞项" : "补齐交付证据"
        }));
      }
    }
  }

  const deduped = dedupeItems(items);
  const openItems = deduped.filter((item) => OPEN_STATES.has(item.state));
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    items: openItems.sort(compareInboxItems),
    summary: summarizeInbox(openItems)
  };
}

function inboxItem(input = {}) {
  return {
    id: input.id,
    kind: input.kind || "note",
    severity: input.severity || "medium",
    state: input.state || "open",
    title: input.title || "收件箱事项",
    detail: input.detail || "",
    action: input.action || "",
    missionId: input.mission?.id || input.missionId || "",
    missionTitle: input.mission?.title || "",
    assignmentId: input.assignment?.id || input.assignmentId || "",
    assignmentLabel: input.assignment?.label || "",
    taskId: input.taskId || input.assignment?.taskId || "",
    checkpointId: input.checkpoint?.id || "",
    recordId: input.record?.id || input.recordId || "",
    sessionPath: input.assignment?.sessionPath || input.checkpoint?.sessionPath || input.record?.sessionPath || "",
    createdAt: input.checkpoint?.createdAt || input.record?.createdAt || input.mission?.updatedAt || new Date().toISOString()
  };
}

function dedupeItems(items) {
  const seen = new Set();
  const next = [];
  for (const item of items) {
    const key = item.id || `${item.kind}:${item.missionId}:${item.assignmentId}:${item.taskId}:${item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(item);
  }
  return next;
}

function summarizeInbox(items) {
  const summary = {
    total: items.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    blockers: 0,
    approvals: 0,
    needsInput: 0,
    review: 0,
    reviewGate: 0
  };
  for (const item of items) {
    summary[item.severity] = (summary[item.severity] || 0) + 1;
    if (item.kind === "blocker") summary.blockers += 1;
    if (item.kind === "approval") summary.approvals += 1;
    if (item.kind === "needs-input") summary.needsInput += 1;
    if (item.kind === "review") summary.review += 1;
    if (item.kind === "review-gate") summary.reviewGate += 1;
  }
  return summary;
}

function compareInboxItems(a, b) {
  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
  const rank = (severityRank[a.severity] ?? 2) - (severityRank[b.severity] ?? 2);
  if (rank !== 0) return rank;
  return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
}

function meaningful(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || /^none$/i.test(text) || /^无$/i.test(text) || /^n\/a$/i.test(text)) return "";
  return text;
}
