const PASSING_STATES = new Set(["done", "cancelled"]);
const REVIEW_LANES = new Set(["review", "qa"]);

export function buildReviewGate(input = {}) {
  const mission = normalizeMission(input.mission);
  if (!mission) return { ok: false, error: "mission_required" };

  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const checkpoints = Array.isArray(input.checkpoints) ? input.checkpoints : [];
  const runRecords = Array.isArray(input.runRecords) ? input.runRecords : [];
  const findings = [];
  const assignments = Array.isArray(mission.assignments) ? mission.assignments : [];
  const assignmentIds = new Set(assignments.map((assignment) => assignment.id).filter(Boolean));
  const missionTasks = tasks.filter((task) => belongsToMission(task, mission.id, assignmentIds));
  const missionCheckpoints = checkpoints.filter((checkpoint) => belongsToMissionCheckpoint(checkpoint, mission, assignments, missionTasks));
  const missionRunRecords = runRecords.filter((record) => belongsToMissionRunRecord(record, mission, assignments));

  if (!assignments.length) {
    findings.push(finding("no-assignments", "fail", "Mission 没有 worker assignments", "创建或同步 assignments 后再交付。"));
  }

  for (const assignment of assignments) {
    const label = assignment.label || assignment.roleId || assignment.id || "worker";
    const blocker = meaningfulText(assignment.blocker);
    if (assignment.state === "blocked" || blocker) {
      findings.push(finding(
        `blocked-${assignment.id}`,
        "fail",
        `${label} 仍有阻塞`,
        blocker || "Assignment state is blocked.",
        { assignmentId: assignment.id, taskId: assignment.taskId || null }
      ));
    }
    if (!PASSING_STATES.has(assignment.state)) {
      findings.push(finding(
        `incomplete-${assignment.id}`,
        "fail",
        `${label} 尚未完成`,
        `当前状态：${assignment.state || "unknown"}`,
        { assignmentId: assignment.id, taskId: assignment.taskId || null }
      ));
    }
    if (!evidenceForAssignment(assignment, missionCheckpoints, missionRunRecords)) {
      findings.push(finding(
        `missing-evidence-${assignment.id}`,
        "warn",
        `${label} 缺少可追踪证据`,
        "需要 assignment result、checkpoint result、产物或命令记录之一。",
        { assignmentId: assignment.id, taskId: assignment.taskId || null }
      ));
    }
  }

  for (const checkpoint of missionCheckpoints) {
    const state = String(checkpoint.state || "").toUpperCase();
    const blocker = meaningfulText(checkpoint.blocker);
    if (state === "BLOCKED" || state === "NEEDS_INPUT" || blocker) {
      findings.push(finding(
        `checkpoint-blocker-${checkpoint.id}`,
        "fail",
        "Checkpoint 显示阻塞或需要输入",
        blocker || checkpoint.result || checkpoint.nextAction || state,
        { checkpointId: checkpoint.id, taskId: checkpoint.taskId || null }
      ));
    }
    if (!checkpoint.complete) {
      findings.push(finding(
        `checkpoint-incomplete-${checkpoint.id}`,
        "warn",
        "Checkpoint 合约不完整",
        "缺少 STATE / RESULT / NEXT_ACTION 中的关键字段。",
        { checkpointId: checkpoint.id, taskId: checkpoint.taskId || null }
      ));
    }
  }

  const pendingApprovals = missionRunRecords.filter((record) => record.type === "approval" && record.state === "pending");
  for (const approval of pendingApprovals) {
    findings.push(finding(
      `pending-approval-${approval.id}`,
      "fail",
      `审批仍待处理：${approval.title}`,
      approval.summary || approval.requester || "Approval state is pending.",
      { recordId: approval.id, assignmentId: approval.assignmentId || null }
    ));
  }

  const deniedApprovals = missionRunRecords.filter((record) => record.type === "approval" && record.state === "denied");
  for (const approval of deniedApprovals) {
    findings.push(finding(
      `denied-approval-${approval.id}`,
      "fail",
      `审批已拒绝：${approval.title}`,
      approval.summary || "Approval state is denied.",
      { recordId: approval.id, assignmentId: approval.assignmentId || null }
    ));
  }

  const artifactRecords = missionRunRecords.filter((record) => record.type === "artifact");
  if (!artifactRecords.length) {
    findings.push(finding("missing-artifact", "warn", "缺少交付产物记录", "至少记录一个 artifact，或把报告/交付物文件化。"));
  } else if (!artifactRecords.some((record) => meaningfulText(record.path) || meaningfulText(record.content))) {
    findings.push(finding("missing-artifact-content", "warn", "产物没有文件或内容", "artifact 需要 content 或 materialized file path 才能复核。"));
  }

  if (!missionCheckpoints.length) {
    findings.push(finding("missing-checkpoints", "warn", "缺少 checkpoint 证据", "同步会话历史或手动提交 worker checkpoint。"));
  }

  const hasReviewEvidence = assignments.some((assignment) => {
    const lane = String(assignment.lane || assignment.roleId || "").toLowerCase();
    const label = String(assignment.label || "").toLowerCase();
    return REVIEW_LANES.has(lane) || REVIEW_LANES.has(label) || label.includes("复核") || label.includes("验证");
  }) && (
    missionCheckpoints.some((checkpoint) => checkpoint.state === "DONE" || checkpoint.state === "NEEDS_REVIEW" || checkpoint.columnSuggestion === "review") ||
    assignments.some((assignment) => REVIEW_LANES.has(String(assignment.lane || assignment.roleId || "").toLowerCase()) && meaningfulText(assignment.result || assignment.output))
  );
  if (!hasReviewEvidence) {
    findings.push(finding("missing-review-evidence", "warn", "缺少 reviewer / QA 证据", "需要 reviewer 或 QA assignment 的结果、checkpoint 或复核记录。"));
  }

  const status = findings.some((item) => item.severity === "fail")
    ? "fail"
    : findings.some((item) => item.severity === "warn")
      ? "warn"
      : "pass";

  return {
    ok: true,
    missionId: mission.id,
    status,
    generatedAt: new Date().toISOString(),
    summary: summarize(status, findings),
    findings,
    stats: {
      assignments: assignments.length,
      completedAssignments: assignments.filter((assignment) => PASSING_STATES.has(assignment.state)).length,
      checkpoints: missionCheckpoints.length,
      artifacts: artifactRecords.length,
      approvals: missionRunRecords.filter((record) => record.type === "approval").length,
      pendingApprovals: pendingApprovals.length,
      tasks: missionTasks.length
    },
    checks: {
      noBlockingWork: !findings.some((item) => item.id.startsWith("blocked-") || item.id.startsWith("checkpoint-blocker-")),
      allAssignmentsDone: assignments.length > 0 && assignments.every((assignment) => PASSING_STATES.has(assignment.state)),
      approvalsResolved: pendingApprovals.length === 0 && deniedApprovals.length === 0,
      hasArtifact: artifactRecords.length > 0,
      hasCheckpoints: missionCheckpoints.length > 0,
      hasReviewEvidence
    }
  };
}

export function formatReviewGateReport(gate) {
  if (!gate || !gate.ok) return "";
  const lines = [
    "# Review Gate",
    "",
    `Status: ${gate.status}`,
    `Summary: ${gate.summary}`,
    "",
    "## Stats",
    `- Assignments: ${gate.stats.completedAssignments}/${gate.stats.assignments}`,
    `- Checkpoints: ${gate.stats.checkpoints}`,
    `- Artifacts: ${gate.stats.artifacts}`,
    `- Pending approvals: ${gate.stats.pendingApprovals}`,
    "",
    "## Findings"
  ];
  if (!gate.findings.length) {
    lines.push("- No findings.");
  } else {
    for (const item of gate.findings) {
      lines.push(`- [${item.severity}] ${item.title}${item.detail ? ` — ${item.detail}` : ""}`);
    }
  }
  return lines.join("\n");
}

function belongsToMission(task, missionId, assignmentIds) {
  if (!task || typeof task !== "object") return false;
  if (task.missionId === missionId) return true;
  if (assignmentIds.has(task.assignmentId)) return true;
  return Array.isArray(task.tags) && task.tags.includes("mission") && String(task.description || "").includes(missionId);
}

function belongsToMissionCheckpoint(checkpoint, mission, assignments, missionTasks) {
  if (!checkpoint || typeof checkpoint !== "object") return false;
  if (checkpoint.missionId === mission.id) return true;
  const taskIds = new Set([
    ...assignments.map((assignment) => assignment.taskId).filter(Boolean),
    ...missionTasks.map((task) => task.id || task.taskId).filter(Boolean)
  ]);
  if (checkpoint.taskId && taskIds.has(checkpoint.taskId)) return true;
  const sessionPaths = new Set([mission.sessionPath, ...assignments.map((assignment) => assignment.sessionPath)].filter(Boolean));
  return Boolean(checkpoint.sessionPath && sessionPaths.has(checkpoint.sessionPath));
}

function belongsToMissionRunRecord(record, mission, assignments) {
  if (!record || typeof record !== "object") return false;
  if (record.missionId === mission.id) return true;
  const assignmentIds = new Set(assignments.map((assignment) => assignment.id).filter(Boolean));
  const taskIds = new Set(assignments.map((assignment) => assignment.taskId).filter(Boolean));
  if (record.assignmentId && assignmentIds.has(record.assignmentId)) return true;
  if (record.taskId && taskIds.has(record.taskId)) return true;
  return false;
}

function evidenceForAssignment(assignment, checkpoints, runRecords) {
  if (meaningfulText(assignment.result) || meaningfulText(assignment.output)) return true;
  if (checkpoints.some((checkpoint) => checkpoint.taskId && checkpoint.taskId === assignment.taskId && meaningfulText(checkpoint.result))) return true;
  return runRecords.some((record) => {
    if (record.assignmentId && record.assignmentId === assignment.id) return true;
    if (record.taskId && assignment.taskId && record.taskId === assignment.taskId) return true;
    return false;
  });
}

function finding(id, severity, title, detail, meta = {}) {
  return {
    id,
    severity,
    title,
    detail: meaningfulText(detail),
    meta
  };
}

function summarize(status, findings) {
  const fail = findings.filter((item) => item.severity === "fail").length;
  const warn = findings.filter((item) => item.severity === "warn").length;
  if (status === "pass") return "Review gate passed. Mission has delivery evidence and no blocking findings.";
  if (status === "fail") return `Review gate failed with ${fail} blocking finding${fail === 1 ? "" : "s"} and ${warn} warning${warn === 1 ? "" : "s"}.`;
  return `Review gate has ${warn} warning${warn === 1 ? "" : "s"}; force-complete is possible with operator judgment.`;
}

function normalizeMission(value) {
  if (!value || typeof value !== "object") return null;
  const id = meaningfulText(value.id);
  if (!id) return null;
  return {
    ...value,
    id,
    assignments: Array.isArray(value.assignments) ? value.assignments : []
  };
}

function meaningfulText(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || /^none$/i.test(text) || /^无$/i.test(text) || /^n\/a$/i.test(text)) return "";
  return text;
}
