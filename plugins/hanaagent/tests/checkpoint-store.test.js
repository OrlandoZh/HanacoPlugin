import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  clearCheckpoints,
  createCheckpoint,
  deleteCheckpoint,
  listCheckpointConflicts,
  listCheckpointReminders,
  listCheckpoints,
  parseCheckpointText,
  resolveCheckpointConflict,
  stateToColumn,
  updateCheckpointReminder
} from "../lib/checkpoint-store.js";

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-checkpoints-"));
}

test("parseCheckpointText extracts contract fields and column suggestions", () => {
  const parsed = parseCheckpointText([
    "STATE: BLOCKED",
    "FILES_CHANGED: plugins/hanaagent/index.js, docs/hanaagent/IMPLEMENTATION_AUDIT.md",
    "COMMANDS_RUN: npm test",
    "RESULT: 路由已接入但缺少宿主 history",
    "BLOCKER: session:history unavailable",
    "NEXT_ACTION: 等宿主暴露 history bus"
  ].join("\n"));

  assert.equal(parsed.state, "BLOCKED");
  assert.equal(parsed.columnSuggestion, "blocked");
  assert.deepEqual(parsed.filesChanged, ["plugins/hanaagent/index.js", "docs/hanaagent/IMPLEMENTATION_AUDIT.md"]);
  assert.deepEqual(parsed.commandsRun, ["npm test"]);
  assert.equal(parsed.complete, true);
});

test("checkpoint store creates, filters, clears, and deletes checkpoints", () => {
  const dataDir = tempDataDir();
  const first = createCheckpoint(dataDir, {
    taskId: "task-1",
    sessionPath: "/sessions/primary.jsonl",
    text: "STATE: DONE\nRESULT: 完成\nNEXT_ACTION: 复核"
  });
  const second = createCheckpoint(dataDir, {
    taskId: "task-2",
    sessionPath: "/sessions/review.jsonl",
    text: "STATE: NEEDS_REVIEW\nRESULT: 待复核\nNEXT_ACTION: review"
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.checkpoint.columnSuggestion, "done");
  assert.equal(second.checkpoint.columnSuggestion, "review");
  assert.equal(listCheckpoints(dataDir).length, 2);
  assert.equal(listCheckpoints(dataDir, { taskId: "task-1" }).length, 1);
  assert.equal(listCheckpoints(dataDir, { state: "needs_review" }).length, 1);

  assert.deepEqual(clearCheckpoints(dataDir, { taskId: "task-1" }), { ok: true, removed: 1 });
  assert.equal(listCheckpoints(dataDir).length, 1);

  assert.deepEqual(deleteCheckpoint(dataDir, second.checkpoint.id), { ok: true, removed: 1 });
  assert.equal(listCheckpoints(dataDir).length, 0);
});

test("checkpoint parser validates state and stateToColumn handles state or lane values", () => {
  const dataDir = tempDataDir();
  assert.equal(createCheckpoint(dataDir, { text: "RESULT: missing state" }).ok, false);
  assert.equal(stateToColumn("IN_PROGRESS"), "running");
  assert.equal(stateToColumn("blocked"), "blocked");
  assert.equal(stateToColumn("unknown"), "backlog");
});

test("checkpoint conflicts can be detected and resolved by accepting one checkpoint", () => {
  const dataDir = tempDataDir();
  const first = createCheckpoint(dataDir, {
    taskId: "task-conflict",
    sessionPath: "/sessions/worker.jsonl",
    text: "STATE: IN_PROGRESS\nRESULT: still running\nNEXT_ACTION: continue"
  });
  const second = createCheckpoint(dataDir, {
    taskId: "task-conflict",
    sessionPath: "/sessions/worker.jsonl",
    text: "STATE: BLOCKED\nRESULT: stopped\nBLOCKER: missing input\nNEXT_ACTION: ask user"
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.checkpoint.conflict, true);

  const conflicts = listCheckpointConflicts(dataDir);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].states.sort(), ["BLOCKED", "IN_PROGRESS"]);

  const resolved = resolveCheckpointConflict(dataDir, {
    checkpointId: second.checkpoint.id,
    resolvedBy: "tester"
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.accepted.accepted, true);
  assert.equal(resolved.superseded.length, 1);
  assert.equal(listCheckpointConflicts(dataDir).length, 0);

  const checkpoints = listCheckpoints(dataDir);
  assert.equal(checkpoints.find((item) => item.id === second.checkpoint.id).accepted, true);
  assert.equal(checkpoints.find((item) => item.id === first.checkpoint.id).superseded, true);
});

test("checkpoint reminders can be set, queried as due, triggered, and cleared", () => {
  const dataDir = tempDataDir();
  const created = createCheckpoint(dataDir, {
    taskId: "task-reminder",
    sessionPath: "/sessions/worker.jsonl",
    text: "STATE: BLOCKED\nRESULT: stopped\nBLOCKER: missing input\nNEXT_ACTION: ask user"
  });
  assert.equal(created.ok, true);

  const reminder = updateCheckpointReminder(dataDir, created.checkpoint.id, {
    reminderAt: "2026-01-01T00:00:00.000Z",
    note: "Ask user for missing input"
  });
  assert.equal(reminder.ok, true);
  assert.equal(reminder.reminder.checkpointId, created.checkpoint.id);
  assert.equal(listCheckpointReminders(dataDir).length, 1);
  assert.equal(listCheckpointReminders(dataDir, { dueBefore: "2026-01-01T00:01:00.000Z" }).length, 1);
  assert.equal(listCheckpointReminders(dataDir, { dueBefore: "2025-12-31T23:59:00.000Z" }).length, 0);

  const triggered = updateCheckpointReminder(dataDir, created.checkpoint.id, { action: "trigger" });
  assert.equal(triggered.ok, true);
  assert.equal(Boolean(triggered.checkpoint.reminderTriggeredAt), true);

  const cleared = updateCheckpointReminder(dataDir, created.checkpoint.id, { action: "clear" });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.cleared, true);
  assert.equal(listCheckpointReminders(dataDir).length, 0);
});
