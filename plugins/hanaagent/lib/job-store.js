import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const VALID_TYPES = new Set(["autopilot-tick", "mission-autopilot", "dispatch-prompt"]);
const VALID_STATUS = new Set(["enabled", "paused", "disabled"]);
const VALID_RUN_STATUS = new Set(["success", "failed", "skipped"]);

export function listJobs(dataDir, filters = {}) {
  let jobs = readJobsFile(dataDir).jobs.map(normalizeJob).filter(Boolean);
  if (filters.status) jobs = jobs.filter((job) => job.status === clean(filters.status));
  if (filters.type) jobs = jobs.filter((job) => job.type === clean(filters.type));
  return jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getJob(dataDir, jobId) {
  const id = clean(jobId);
  return listJobs(dataDir).find((job) => job.id === id) || null;
}

export function createJob(dataDir, input = {}) {
  const now = new Date().toISOString();
  const job = normalizeJob({
    id: clean(input.id) || randomUUID(),
    title: clean(input.title) || "HanaAgent Job",
    description: clean(input.description),
    type: clean(input.type) || "autopilot-tick",
    schedule: normalizeSchedule(input.schedule || input.cron || "manual"),
    status: clean(input.status) || "enabled",
    agentId: clean(input.agentId),
    missionId: clean(input.missionId),
    mode: clean(input.mode) === "run" ? "run" : "preview",
    prompt: clean(input.prompt),
    payload: input.payload && typeof input.payload === "object" ? input.payload : {},
    createdAt: clean(input.createdAt) || now,
    updatedAt: clean(input.updatedAt) || now,
    lastRunAt: clean(input.lastRunAt),
    nextRunAt: clean(input.nextRunAt),
    runs: []
  });
  if (!job.title) return { ok: false, error: "title_required" };
  const file = readJobsFile(dataDir);
  file.jobs.push(job);
  writeJobsFile(dataDir, file);
  return { ok: true, job };
}

export function updateJob(dataDir, jobId, updates = {}) {
  const id = clean(jobId);
  const file = readJobsFile(dataDir);
  const index = file.jobs.findIndex((job) => clean(job.id) === id);
  if (index === -1) return { ok: false, error: "job_not_found" };
  const current = normalizeJob(file.jobs[index]);
  const next = normalizeJob({
    ...current,
    ...updates,
    id: current.id,
    schedule: updates.schedule !== undefined || updates.cron !== undefined
      ? normalizeSchedule(updates.schedule || updates.cron)
      : current.schedule,
    payload: updates.payload && typeof updates.payload === "object" ? updates.payload : current.payload,
    runs: current.runs,
    updatedAt: new Date().toISOString()
  });
  file.jobs[index] = next;
  writeJobsFile(dataDir, file);
  return { ok: true, job: next };
}

export function setJobStatus(dataDir, jobId, status) {
  const normalized = VALID_STATUS.has(clean(status)) ? clean(status) : "enabled";
  return updateJob(dataDir, jobId, { status: normalized });
}

export function deleteJob(dataDir, jobId) {
  const id = clean(jobId);
  const file = readJobsFile(dataDir);
  const before = file.jobs.length;
  file.jobs = file.jobs.filter((job) => clean(job.id) !== id);
  if (file.jobs.length === before) return { ok: false, error: "job_not_found" };
  writeJobsFile(dataDir, file);
  return { ok: true, deleted: true, jobId: id };
}

export function recordJobRun(dataDir, jobId, input = {}) {
  const id = clean(jobId);
  const file = readJobsFile(dataDir);
  const index = file.jobs.findIndex((job) => clean(job.id) === id);
  if (index === -1) return { ok: false, error: "job_not_found" };
  const current = normalizeJob(file.jobs[index]);
  const now = clean(input.createdAt) || new Date().toISOString();
  const run = normalizeRun({
    id: clean(input.id) || randomUUID(),
    jobId: id,
    status: clean(input.status) || "success",
    summary: clean(input.summary),
    output: clean(input.output),
    result: input.result && typeof input.result === "object" ? input.result : {},
    error: clean(input.error),
    createdAt: now
  });
  const next = {
    ...current,
    lastRunAt: now,
    nextRunAt: estimateNextRunAt(current.schedule, now),
    updatedAt: now,
    runs: [run, ...current.runs].slice(0, 30)
  };
  file.jobs[index] = next;
  writeJobsFile(dataDir, file);
  return { ok: true, job: next, run };
}

function normalizeJob(value) {
  if (!value || typeof value !== "object") return null;
  const id = clean(value.id);
  if (!id) return null;
  const type = VALID_TYPES.has(clean(value.type)) ? clean(value.type) : "autopilot-tick";
  const status = VALID_STATUS.has(clean(value.status)) ? clean(value.status) : "enabled";
  const createdAt = clean(value.createdAt) || new Date().toISOString();
  const updatedAt = clean(value.updatedAt) || createdAt;
  return {
    id,
    title: clean(value.title) || "HanaAgent Job",
    description: clean(value.description),
    type,
    schedule: normalizeSchedule(value.schedule || value.cron || "manual"),
    status,
    agentId: clean(value.agentId),
    missionId: clean(value.missionId),
    mode: clean(value.mode) === "run" ? "run" : "preview",
    prompt: clean(value.prompt),
    payload: value.payload && typeof value.payload === "object" ? value.payload : {},
    createdAt,
    updatedAt,
    lastRunAt: clean(value.lastRunAt),
    nextRunAt: clean(value.nextRunAt) || estimateNextRunAt(normalizeSchedule(value.schedule || value.cron || "manual"), value.lastRunAt || updatedAt),
    runs: Array.isArray(value.runs) ? value.runs.map(normalizeRun).filter(Boolean) : []
  };
}

function normalizeRun(value) {
  if (!value || typeof value !== "object") return null;
  const id = clean(value.id);
  if (!id) return null;
  const status = VALID_RUN_STATUS.has(clean(value.status)) ? clean(value.status) : "success";
  return {
    id,
    jobId: clean(value.jobId),
    status,
    summary: clean(value.summary),
    output: clean(value.output),
    result: value.result && typeof value.result === "object" ? value.result : {},
    error: clean(value.error),
    createdAt: clean(value.createdAt) || new Date().toISOString()
  };
}

function normalizeSchedule(value) {
  if (value && typeof value === "object") {
    return {
      type: clean(value.type) || "cron",
      expression: clean(value.expression || value.cron) || "manual",
      timezone: clean(value.timezone) || "local"
    };
  }
  const expression = clean(value) || "manual";
  return {
    type: expression === "manual" ? "manual" : "cron",
    expression,
    timezone: "local"
  };
}

function estimateNextRunAt(schedule, baseTime) {
  if (!schedule || schedule.type === "manual" || schedule.expression === "manual") return "";
  const everyMinutes = parseEveryMinutes(schedule.expression);
  if (!everyMinutes) return "";
  const base = Date.parse(baseTime || new Date().toISOString());
  const time = Number.isFinite(base) ? base : Date.now();
  return new Date(time + everyMinutes * 60 * 1000).toISOString();
}

function parseEveryMinutes(expression) {
  const value = clean(expression);
  const every = value.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (every) return Math.max(1, Math.min(1440, Number(every[1]) || 0));
  if (value === "hourly" || value === "0 * * * *") return 60;
  if (value === "daily" || value === "0 0 * * *") return 1440;
  return 0;
}

function readJobsFile(dataDir) {
  ensureJobsFile(dataDir);
  try {
    const raw = fs.readFileSync(jobsFilePath(dataDir), "utf8").trim();
    if (!raw) return { jobs: [] };
    const parsed = JSON.parse(raw);
    return { jobs: Array.isArray(parsed?.jobs) ? parsed.jobs : [] };
  } catch {
    return { jobs: [] };
  }
}

function writeJobsFile(dataDir, data) {
  ensureJobsFile(dataDir);
  const file = jobsFilePath(dataDir);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ jobs: data.jobs || [] }, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function ensureJobsFile(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = jobsFilePath(dataDir);
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ jobs: [] }, null, 2) + "\n", "utf8");
}

function jobsFilePath(dataDir) {
  return path.join(dataDir, "jobs.json");
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
