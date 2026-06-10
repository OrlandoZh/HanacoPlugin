import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReviewGate,
  formatReviewGateReport
} from "../lib/review-gate.js";

function mission(overrides = {}) {
  return {
    id: "mission-1",
    title: "Ship workbench",
    goal: "Complete Hermes parity",
    assignments: [
      {
        id: "a-build",
        label: "构建",
        lane: "build",
        state: "done",
        taskId: "task-build",
        result: "implemented"
      },
      {
        id: "a-review",
        label: "复核",
        lane: "review",
        state: "done",
        taskId: "task-review",
        result: "reviewed"
      }
    ],
    ...overrides
  };
}

test("review gate passes when assignments, checkpoints, approvals, and artifacts are complete", () => {
  const gate = buildReviewGate({
    mission: mission(),
    tasks: [
      { id: "task-build", missionId: "mission-1", assignmentId: "a-build" },
      { id: "task-review", missionId: "mission-1", assignmentId: "a-review" }
    ],
    checkpoints: [
      { id: "cp-1", taskId: "task-build", state: "DONE", result: "tests passed", nextAction: "review", complete: true },
      { id: "cp-2", taskId: "task-review", state: "DONE", result: "approved", nextAction: "ship", complete: true }
    ],
    runRecords: [
      { id: "artifact-1", type: "artifact", title: "Report", missionId: "mission-1", content: "# Done", state: "available" },
      { id: "approval-1", type: "approval", title: "Ship", missionId: "mission-1", state: "approved" }
    ]
  });

  assert.equal(gate.ok, true);
  assert.equal(gate.status, "pass");
  assert.equal(gate.findings.length, 0);
  assert.match(formatReviewGateReport(gate), /Status: pass/);
});

test("review gate fails on blockers, incomplete work, and pending approvals", () => {
  const gate = buildReviewGate({
    mission: mission({
      assignments: [
        { id: "a-build", label: "构建", lane: "build", state: "blocked", taskId: "task-build", blocker: "Need API" },
        { id: "a-review", label: "复核", lane: "review", state: "queued", taskId: "task-review" }
      ]
    }),
    tasks: [{ id: "task-build", missionId: "mission-1", assignmentId: "a-build" }],
    checkpoints: [{ id: "cp-1", taskId: "task-build", state: "BLOCKED", result: "blocked", nextAction: "wait", blocker: "Need API", complete: true }],
    runRecords: [{ id: "approval-1", type: "approval", title: "Run command", missionId: "mission-1", state: "pending" }]
  });

  assert.equal(gate.status, "fail");
  assert.equal(gate.findings.some((item) => item.id === "blocked-a-build"), true);
  assert.equal(gate.findings.some((item) => item.id === "pending-approval-approval-1"), true);
});

test("review gate warns when evidence is thin but no blocking work remains", () => {
  const gate = buildReviewGate({
    mission: mission({
      assignments: [
        { id: "a-build", label: "构建", lane: "build", state: "done", taskId: "task-build" },
        { id: "a-review", label: "复核", lane: "review", state: "done", taskId: "task-review" }
      ]
    }),
    tasks: [],
    checkpoints: [],
    runRecords: []
  });

  assert.equal(gate.status, "warn");
  assert.equal(gate.findings.some((item) => item.id === "missing-artifact"), true);
  assert.equal(gate.findings.some((item) => item.id === "missing-checkpoints"), true);
});
