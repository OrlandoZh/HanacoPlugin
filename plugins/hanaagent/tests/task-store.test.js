import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  batchUpdateTasks,
  clearDoneTasks,
  createTask,
  deleteTask,
  listTasks,
  moveTask,
  reorderTask,
  updateTask
} from "../lib/task-store.js";

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-tasks-"));
}

test("task store creates and persists Hermes-style task records", () => {
  const dataDir = tempDataDir();
  const created = createTask(dataDir, {
    title: "完善 Hanaco 工作台",
    description: "迁移任务看板到后端 store",
    column: "running",
    priority: "high",
    assignee: "primary",
    tags: ["hanaagent", "phase-2"],
    sessionPath: "/sessions/primary.jsonl",
    templateId: "build",
    templateLabel: "构建实现"
  });

  assert.equal(created.ok, true);
  assert.equal(created.task.column, "running");
  assert.equal(created.task.lane, "running");
  assert.equal(created.task.priority, "high");
  assert.equal(created.task.sessionPath, "/sessions/primary.jsonl");

  const tasks = listTasks(dataDir, { includeDone: true });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, "完善 Hanaco 工作台");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "tasks.json"), "utf8")).tasks.length, 1);
});

test("task store moves, updates, filters, clears done, and deletes tasks", () => {
  const dataDir = tempDataDir();
  const first = createTask(dataDir, { title: "A", column: "backlog", priority: "low" }).task;
  const second = createTask(dataDir, { title: "B", column: "review", priority: "medium" }).task;

  assert.equal(moveTask(dataDir, first.id, "done").task.column, "done");
  assert.equal(updateTask(dataDir, second.id, { title: "B2", tags: "review,gate" }).task.title, "B2");

  assert.equal(listTasks(dataDir).length, 1);
  assert.equal(listTasks(dataDir, { includeDone: true }).length, 2);
  assert.equal(listTasks(dataDir, { priority: "medium", includeDone: true }).length, 1);

  assert.deepEqual(clearDoneTasks(dataDir), { ok: true, removed: 1 });
  assert.equal(listTasks(dataDir, { includeDone: true }).length, 1);

  assert.deepEqual(deleteTask(dataDir, second.id), { ok: true, removed: 1 });
  assert.equal(listTasks(dataDir, { includeDone: true }).length, 0);
});

test("task store reorders tasks within a Hermes Kanban lane", () => {
  const dataDir = tempDataDir();
  const first = createTask(dataDir, { title: "First", column: "backlog" }).task;
  const second = createTask(dataDir, { title: "Second", column: "backlog" }).task;
  const third = createTask(dataDir, { title: "Third", column: "backlog" }).task;

  const moved = reorderTask(dataDir, third.id, { column: "backlog", position: 1 });
  assert.equal(moved.ok, true);
  assert.equal(moved.task.position, 1);
  assert.deepEqual(
    listTasks(dataDir, { includeDone: true, column: "backlog" }).map((task) => task.id),
    [first.id, third.id, second.id]
  );

  assert.equal(moveTask(dataDir, first.id, { column: "review", position: 0 }).task.column, "review");
  assert.deepEqual(
    listTasks(dataDir, { includeDone: true, column: "review" }).map((task) => task.id),
    [first.id]
  );
});

test("task store applies batch move, update, and delete operations", () => {
  const dataDir = tempDataDir();
  const first = createTask(dataDir, { title: "First", column: "backlog", priority: "low" }).task;
  const second = createTask(dataDir, { title: "Second", column: "backlog", priority: "low" }).task;
  const third = createTask(dataDir, { title: "Third", column: "running", priority: "medium" }).task;

  let result = batchUpdateTasks(dataDir, { action: "move", taskIds: [first.id, second.id], column: "review" });
  assert.equal(result.ok, true);
  assert.equal(result.processed.length, 2);
  assert.deepEqual(listTasks(dataDir, { includeDone: true, column: "review" }).map((task) => task.title), ["First", "Second"]);

  result = batchUpdateTasks(dataDir, { action: "update", taskIds: [first.id, "missing"], updates: { priority: "high", assignee: "qa" } });
  assert.equal(result.ok, false);
  assert.equal(result.processed.length, 1);
  assert.equal(result.failed[0].taskId, "missing");
  assert.equal(listTasks(dataDir, { includeDone: true }).find((task) => task.id === first.id).priority, "high");

  result = batchUpdateTasks(dataDir, { action: "delete", taskIds: [second.id, third.id] });
  assert.equal(result.ok, true);
  assert.equal(result.removed, 2);
  assert.deepEqual(listTasks(dataDir, { includeDone: true }).map((task) => task.id), [first.id]);
});

test("task store validates title and normalizes unknown columns", () => {
  const dataDir = tempDataDir();
  assert.deepEqual(createTask(dataDir, { title: "" }), { ok: false, error: "title_required" });
  const created = createTask(dataDir, { title: "Unknown lane", column: "in_progress" });
  assert.equal(created.ok, true);
  assert.equal(created.task.column, "running");
});
