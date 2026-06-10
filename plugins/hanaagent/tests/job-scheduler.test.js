import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJob, getJob } from "../lib/job-store.js";
import {
  createJobScheduler,
  isDueJob
} from "../lib/job-scheduler.js";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-job-scheduler-"));
}

test("isDueJob only runs enabled scheduled jobs at or past nextRunAt", () => {
  const dataDir = tempDir();
  const created = createJob(dataDir, {
    title: "Due job",
    schedule: "*/15 * * * *",
    status: "enabled",
    lastRunAt: "2026-01-01T00:00:00.000Z"
  });
  assert.equal(created.ok, true);
  const job = getJob(dataDir, created.job.id);
  assert.equal(isDueJob(job, new Date("2026-01-01T00:14:59.000Z")), false);
  assert.equal(isDueJob(job, new Date("2026-01-01T00:15:00.000Z")), true);
  assert.equal(isDueJob({ ...job, status: "paused" }, new Date("2026-01-01T00:20:00.000Z")), false);
  assert.equal(isDueJob({ ...job, schedule: { type: "manual", expression: "manual" } }, new Date("2026-01-01T00:20:00.000Z")), false);
});

test("job scheduler triggers due jobs and records last result", async () => {
  const dataDir = tempDir();
  const due = createJob(dataDir, {
    title: "Due autopilot",
    schedule: "*/15 * * * *",
    status: "enabled",
    lastRunAt: "2026-01-01T00:00:00.000Z"
  }).job;
  createJob(dataDir, {
    title: "Paused autopilot",
    schedule: "*/15 * * * *",
    status: "paused",
    lastRunAt: "2026-01-01T00:00:00.000Z"
  });
  const calls = [];
  const scheduler = createJobScheduler(
    { dataDir },
    {
      intervalMs: 1000,
      runOnStartup: false,
      trigger: async (jobId, input) => {
        calls.push({ jobId, input });
        return { ok: true, run: { id: "run-1", summary: "ok" } };
      }
    }
  );
  const result = await scheduler.runDueJobs("test", { now: "2026-01-01T00:15:00.000Z" });
  assert.equal(result.ok, true);
  assert.equal(result.scanned, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].jobId, due.id);
  assert.equal(calls[0].input.scheduled, true);
  assert.equal(scheduler.status().lastResult.scanned, 1);
});

test("job scheduler skips overlapping runs", async () => {
  const dataDir = tempDir();
  createJob(dataDir, {
    title: "Slow job",
    schedule: "*/15 * * * *",
    status: "enabled",
    lastRunAt: "2026-01-01T00:00:00.000Z"
  });
  let release;
  const scheduler = createJobScheduler(
    { dataDir },
    {
      intervalMs: 1000,
      runOnStartup: false,
      trigger: () => new Promise((resolve) => {
        release = () => resolve({ ok: true, run: { id: "slow-run" } });
      })
    }
  );
  const first = scheduler.runDueJobs("first", { now: "2026-01-01T00:15:00.000Z" });
  const second = await scheduler.runDueJobs("second", { now: "2026-01-01T00:15:01.000Z" });
  assert.equal(second.skipped, true);
  assert.equal(second.reason, "already_running");
  release();
  assert.equal((await first).ok, true);
});
