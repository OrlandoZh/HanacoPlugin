import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const VALID_COLUMNS = new Set(["backlog", "running", "review", "blocked", "done"]);
const VALID_PRIORITIES = new Set(["high", "medium", "low"]);

let writeChain = Promise.resolve();

function withWriteLock(work) {
  let result;
  let error;
  try {
    result = work();
  } catch (e) {
    error = e;
  }
  writeChain = writeChain.then(() => {}).catch(() => {});
  if (error) throw error;
  return result;
}

export function listTasks(dataDir, filters = {}) {
  let tasks = readTaskFile(dataDir).tasks.map(normalizeTask).filter(Boolean);
  if (!filters.includeDone) tasks = tasks.filter((task) => task.column !== "done");
  if (filters.column) tasks = tasks.filter((task) => task.column === filters.column);
  if (filters.assignee) tasks = tasks.filter((task) => task.assignee === filters.assignee);
  if (filters.priority) tasks = tasks.filter((task) => task.priority === filters.priority);
  return tasks.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
}

export function getTask(dataDir, taskId) {
  return readTaskFile(dataDir).tasks.map(normalizeTask).filter(Boolean).find((task) => task.id === taskId) || null;
}

export function createTask(dataDir, input = {}) {
  const title = clean(input.title);
  if (!title) return { ok: false, error: "title_required" };

  return withWriteLock(() => {
    const file = readTaskFile(dataDir);
    const now = new Date().toISOString();
    const task = normalizeTask({
      id: clean(input.id) || randomUUID(),
      title,
      description: clean(input.description || input.notes),
      column: normalizeColumn(input.column || input.lane),
      priority: normalizePriority(input.priority),
      assignee: clean(input.assignee) || null,
      tags: normalizeTags(input.tags),
      dueDate: clean(input.dueDate || input.due_date) || null,
      position: Number.isFinite(Number(input.position)) ? Number(input.position) : file.tasks.length,
      createdBy: clean(input.createdBy || input.created_by) || "user",
      createdAt: now,
      updatedAt: now,
      sessionPath: clean(input.sessionPath || input.session_id) || null,
      templateId: clean(input.templateId) || null,
      templateLabel: clean(input.templateLabel) || null,
      missionId: clean(input.missionId || input.mission_id) || null,
      assignmentId: clean(input.assignmentId || input.assignment_id) || null,
      mode: clean(input.mode) || "dispatch"
    });
    file.tasks.push(task);
    writeTaskFile(dataDir, { tasks: file.tasks.map(normalizeTask).filter(Boolean) });
    return { ok: true, task };
  });
}

export function updateTask(dataDir, taskId, updates = {}) {
  return withWriteLock(() => {
    const file = readTaskFile(dataDir);
    const index = file.tasks.findIndex((task) => normalizeTask(task)?.id === taskId);
    if (index === -1) return { ok: false, error: "task_not_found" };

  const current = normalizeTask(file.tasks[index]);
  const next = normalizeTask({
    ...current,
    ...(typeof updates.title === "string" ? { title: updates.title } : {}),
    ...(typeof updates.description === "string" || typeof updates.notes === "string" ? { description: updates.description || updates.notes } : {}),
    ...(updates.column || updates.lane ? { column: normalizeColumn(updates.column || updates.lane) } : {}),
    ...(updates.priority ? { priority: normalizePriority(updates.priority) } : {}),
    ...(typeof updates.assignee === "string" ? { assignee: clean(updates.assignee) || null } : {}),
    ...(Array.isArray(updates.tags) ? { tags: normalizeTags(updates.tags) } : {}),
    ...(typeof updates.dueDate === "string" || typeof updates.due_date === "string" ? { dueDate: clean(updates.dueDate || updates.due_date) || null } : {}),
    ...(Number.isFinite(Number(updates.position)) ? { position: Number(updates.position) } : {}),
    ...(typeof updates.sessionPath === "string" || typeof updates.session_id === "string" ? { sessionPath: clean(updates.sessionPath || updates.session_id) || null } : {}),
    ...(typeof updates.templateId === "string" ? { templateId: clean(updates.templateId) || null } : {}),
    ...(typeof updates.templateLabel === "string" ? { templateLabel: clean(updates.templateLabel) || null } : {}),
    ...(typeof updates.missionId === "string" || typeof updates.mission_id === "string" ? { missionId: clean(updates.missionId || updates.mission_id) || null } : {}),
    ...(typeof updates.assignmentId === "string" || typeof updates.assignment_id === "string" ? { assignmentId: clean(updates.assignmentId || updates.assignment_id) || null } : {}),
    ...(typeof updates.mode === "string" ? { mode: clean(updates.mode) || "dispatch" } : {}),
    updatedAt: new Date().toISOString()
  });
    file.tasks[index] = next;
    writeTaskFile(dataDir, { tasks: file.tasks.map(normalizeTask).filter(Boolean) });
    return { ok: true, task: next };
  });
}

export function moveTask(dataDir, taskId, column) {
  return reorderTask(dataDir, taskId, column && typeof column === "object" ? column : { column });
}

export function reorderTask(dataDir, taskId, input = {}) {
  const moveInput = typeof input === "string" ? { column: input } : input || {};
  return withWriteLock(() => {
    const file = readTaskFile(dataDir);
    const tasks = file.tasks.map(normalizeTask).filter(Boolean);
    const index = tasks.findIndex((task) => task.id === taskId);
    if (index === -1) return { ok: false, error: "task_not_found" };

  const task = {
    ...tasks[index],
    column: normalizeColumn(moveInput.column || moveInput.lane || tasks[index].column),
    updatedAt: new Date().toISOString()
  };
  task.lane = task.column;

  const remaining = tasks.filter((item) => item.id !== taskId);
  const sameColumn = remaining
    .filter((item) => item.column === task.column)
    .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  const requestedPosition = Number(moveInput.position ?? moveInput.index ?? moveInput.order);
  const insertAt = Number.isFinite(requestedPosition)
    ? Math.max(0, Math.min(sameColumn.length, Math.floor(requestedPosition)))
    : sameColumn.length;
  sameColumn.splice(insertAt, 0, task);

  const positionedById = new Map();
  const columns = [...VALID_COLUMNS];
  for (const columnId of columns) {
    const columnTasks = columnId === task.column
      ? sameColumn
      : remaining
        .filter((item) => item.column === columnId)
        .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
    columnTasks.forEach((item, position) => {
      const next = { ...item, column: columnId, lane: columnId, position };
      positionedById.set(next.id, next);
    });
  }

    const nextTasks = tasks.map((item) => positionedById.get(item.id)).filter(Boolean);
    writeTaskFile(dataDir, { tasks: nextTasks });
    return { ok: true, task: positionedById.get(taskId), tasks: nextTasks.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt)) };
  });
}

export function deleteTask(dataDir, taskId) {
  return withWriteLock(() => {
    const file = readTaskFile(dataDir);
    const tasks = file.tasks.map(normalizeTask).filter(Boolean);
    const nextTasks = tasks.filter((task) => task.id !== taskId);
    if (nextTasks.length === tasks.length) return { ok: false, error: "task_not_found" };
    writeTaskFile(dataDir, { tasks: nextTasks });
    return { ok: true, removed: 1 };
  });
}

export function batchUpdateTasks(dataDir, input = {}) {
  const taskIds = normalizeIds(input.taskIds || input.ids || input.tasks);
  if (!taskIds.length) return { ok: false, error: "task_ids_required", processed: [], failed: [] };
  const action = clean(input.action || input.operation || input.type) || "update";
  const processed = [];
  const failed = [];
  let removed = 0;

  for (const taskId of taskIds) {
    let result;
    if (action === "move") {
      result = moveTask(dataDir, taskId, { column: input.column || input.lane, position: input.position });
    } else if (action === "delete" || action === "remove") {
      result = deleteTask(dataDir, taskId);
      if (result.ok) removed += result.removed || 0;
    } else if (action === "update") {
      result = updateTask(dataDir, taskId, input.updates && typeof input.updates === "object" ? input.updates : input);
    } else {
      return { ok: false, error: "unsupported_batch_action", action, processed, failed };
    }
    if (result.ok) {
      processed.push({ taskId, task: result.task || null, removed: result.removed || 0 });
    } else {
      failed.push({ taskId, error: result.error || "task_update_failed" });
    }
  }

  return {
    ok: failed.length === 0,
    action,
    processed,
    failed,
    removed,
    tasks: listTasks(dataDir, { includeDone: true })
  };
}

export function clearDoneTasks(dataDir) {
  return withWriteLock(() => {
    const tasks = readTaskFile(dataDir).tasks.map(normalizeTask).filter(Boolean);
    const nextTasks = tasks.filter((task) => task.column !== "done");
    writeTaskFile(dataDir, { tasks: nextTasks });
    return { ok: true, removed: tasks.length - nextTasks.length };
  });
}

function readTaskFile(dataDir) {
  ensureTaskFile(dataDir);
  try {
    const raw = fs.readFileSync(taskFilePath(dataDir), "utf8").trim();
    if (!raw) return { tasks: [] };
    const parsed = JSON.parse(raw);
    return { tasks: Array.isArray(parsed?.tasks) ? parsed.tasks : [] };
  } catch {
    return { tasks: [] };
  }
}

function writeTaskFile(dataDir, data) {
  ensureTaskFile(dataDir);
  const file = taskFilePath(dataDir);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ tasks: data.tasks || [] }, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function ensureTaskFile(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = taskFilePath(dataDir);
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ tasks: [] }, null, 2) + "\n", "utf8");
}

function taskFilePath(dataDir) {
  return path.join(dataDir, "tasks.json");
}

function normalizeTask(task) {
  if (!task || typeof task !== "object") return null;
  const id = clean(task.id);
  const title = clean(task.title);
  if (!id || !title) return null;
  const createdAt = clean(task.createdAt || task.created_at) || new Date().toISOString();
  const updatedAt = clean(task.updatedAt || task.updated_at) || createdAt;
  const column = normalizeColumn(task.column || task.lane);
  return {
    id,
    title,
    description: clean(task.description || task.notes),
    column,
    lane: column,
    priority: normalizePriority(task.priority),
    assignee: clean(task.assignee) || null,
    tags: normalizeTags(task.tags),
    dueDate: clean(task.dueDate || task.due_date) || null,
    position: Number.isFinite(Number(task.position)) ? Number(task.position) : 0,
    createdBy: clean(task.createdBy || task.created_by) || "user",
    createdAt,
    updatedAt,
    sessionPath: clean(task.sessionPath || task.session_id) || null,
    templateId: clean(task.templateId) || null,
    templateLabel: clean(task.templateLabel) || null,
    missionId: clean(task.missionId || task.mission_id) || null,
    assignmentId: clean(task.assignmentId || task.assignment_id) || null,
    mode: clean(task.mode) || "dispatch"
  };
}

function normalizeColumn(value) {
  const column = clean(value);
  if (column === "todo" || column === "ready") return "backlog";
  if (column === "in_progress") return "running";
  return VALID_COLUMNS.has(column) ? column : "backlog";
}

function normalizePriority(value) {
  const priority = clean(value);
  return VALID_PRIORITIES.has(priority) ? priority : "medium";
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map((item) => clean(item)).filter(Boolean).slice(0, 12);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 12);
  return [];
}

function normalizeIds(value) {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(raw.map((item) => clean(typeof item === "object" ? item.id || item.taskId : item)).filter(Boolean))];
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
