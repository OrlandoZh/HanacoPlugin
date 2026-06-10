import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createJob,
  deleteJob,
  getJob,
  listJobs,
  recordJobRun,
  setJobStatus,
  updateJob
} from "../lib/job-store.js";

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-jobs-"));
}

test("job store creates, updates, pauses, resumes, and deletes scheduled jobs", () => {
  const dataDir = tempDataDir();
  const created = createJob(dataDir, {
    title: "Morning autopilot",
    type: "autopilot-tick",
    schedule: "*/15 * * * *",
    mode: "run",
    agentId: "primary"
  });

  assert.equal(created.ok, true);
  assert.equal(created.job.schedule.expression, "*/15 * * * *");
  assert.equal(created.job.mode, "run");
  assert.equal(listJobs(dataDir).length, 1);

  const updated = updateJob(dataDir, created.job.id, { title: "Updated job", schedule: "hourly" });
  assert.equal(updated.ok, true);
  assert.equal(updated.job.title, "Updated job");
  assert.equal(updated.job.schedule.expression, "hourly");

  assert.equal(setJobStatus(dataDir, created.job.id, "paused").job.status, "paused");
  assert.equal(setJobStatus(dataDir, created.job.id, "enabled").job.status, "enabled");
  assert.equal(getJob(dataDir, created.job.id).title, "Updated job");

  const deleted = deleteJob(dataDir, created.job.id);
  assert.equal(deleted.ok, true);
  assert.equal(listJobs(dataDir).length, 0);
});

test("job store records output runs and estimates next run for simple cron expressions", () => {
  const dataDir = tempDataDir();
  const created = createJob(dataDir, {
    title: "Mission scan",
    type: "mission-autopilot",
    missionId: "mission-1",
    schedule: "*/30 * * * *"
  });
  const recorded = recordJobRun(dataDir, created.job.id, {
    status: "success",
    summary: "Scanned one mission",
    output: "ok",
    result: { scanned: 1 },
    createdAt: "2026-01-01T00:00:00.000Z"
  });

  assert.equal(recorded.ok, true);
  assert.equal(recorded.run.summary, "Scanned one mission");
  assert.equal(recorded.job.runs.length, 1);
  assert.equal(recorded.job.nextRunAt, "2026-01-01T00:30:00.000Z");
  assert.equal(listJobs(dataDir)[0].runs[0].output, "ok");
});
