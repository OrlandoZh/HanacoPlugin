import assert from "node:assert/strict";
import test from "node:test";
import { buildMissionInbox } from "../lib/mission-inbox.js";

function mission(overrides = {}) {
  return {
    id: "mission-1",
    title: "Hermes parity",
    goal: "Replicate Hermes Workspace",
    updatedAt: "2026-01-01T00:00:00.000Z",
    assignments: [
      {
        id: "a-build",
        label: "构建",
        state: "blocked",
        taskId: "task-build",
        blocker: "Need host API"
      },
      {
        id: "a-review",
        label: "复核",
        state: "review",
        taskId: "task-review",
        result: "Ready for review"
      }
    ],
    ...overrides
  };
}

test("mission inbox aggregates blockers, review work, approvals, and review gate findings", () => {
  const inbox = buildMissionInbox({
    missions: [mission()],
    tasks: [
      { id: "task-build", missionId: "mission-1", assignmentId: "a-build" },
      { id: "task-review", missionId: "mission-1", assignmentId: "a-review" }
    ],
    checkpoints: [
      {
        id: "cp-input",
        taskId: "task-build",
        state: "NEEDS_INPUT",
        blocker: "Need user decision",
        createdAt: "2026-01-01T00:01:00.000Z"
      }
    ],
    runRecords: [
      {
        id: "approval-1",
        type: "approval",
        title: "Approve shell command",
        state: "pending",
        missionId: "mission-1",
        assignmentId: "a-build",
        createdAt: "2026-01-01T00:02:00.000Z"
      }
    ]
  });

  assert.equal(inbox.ok, true);
  assert.equal(inbox.summary.blockers >= 1, true);
  assert.equal(inbox.summary.approvals, 1);
  assert.equal(inbox.summary.needsInput, 1);
  assert.equal(inbox.summary.review >= 1, true);
  assert.equal(inbox.summary.reviewGate >= 1, true);
  assert.equal(inbox.items[0].severity, "critical");
  assert.equal(inbox.items.some((item) => item.id === "approval-approval-1"), true);
});

test("mission inbox filters closed or duplicate item ids", () => {
  const inbox = buildMissionInbox({
    missions: [mission({
      assignments: [
        { id: "a-done", label: "完成", state: "done", taskId: "task-done", result: "done" }
      ]
    })],
    tasks: [{ id: "task-done", missionId: "mission-1", assignmentId: "a-done" }],
    checkpoints: [
      { id: "cp-1", taskId: "task-done", state: "DONE", result: "done" },
      { id: "cp-1", taskId: "task-done", state: "DONE", result: "done duplicate" }
    ],
    runRecords: [
      { id: "approval-closed", type: "approval", state: "approved", missionId: "mission-1", title: "Approved" }
    ]
  });

  assert.equal(inbox.summary.approvals, 0);
  assert.equal(inbox.items.some((item) => item.kind === "approval"), false);
  assert.equal(new Set(inbox.items.map((item) => item.id)).size, inbox.items.length);
});
