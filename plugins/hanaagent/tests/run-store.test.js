import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createRunRecord,
  deleteRunRecord,
  listRunRecords,
  materializeRunRecordFile,
  readRunRecordArtifactFile,
  summarizeRunRecords,
  updateRunRecord
} from "../lib/run-store.js";

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-run-"));
}

test("run store persists artifacts, approvals, and learnings", () => {
  const dataDir = tempDataDir();
  const artifact = createRunRecord(dataDir, {
    type: "artifact",
    title: "Report markdown",
    content: "# Report",
    missionId: "mission-1",
    assignmentId: "worker-1"
  });
  const approval = createRunRecord(dataDir, {
    type: "approval",
    title: "Approve command",
    missionId: "mission-1"
  });
  const learning = createRunRecord(dataDir, {
    type: "learning",
    title: "Reuse host bus",
    summary: "Do not bypass OpenHanako APIs"
  });

  assert.equal(artifact.ok, true);
  assert.equal(approval.record.state, "pending");
  assert.equal(learning.record.state, "captured");

  const all = listRunRecords(dataDir);
  assert.equal(all.length, 3);
  assert.deepEqual(summarizeRunRecords(all), {
    artifacts: 1,
    approvals: 1,
    pendingApprovals: 1,
    learnings: 1
  });
  assert.equal(listRunRecords(dataDir, { type: "approval" }).length, 1);
  assert.equal(listRunRecords(dataDir, { missionId: "mission-1" }).length, 2);
});

test("run store updates approval resolution and deletes records", () => {
  const dataDir = tempDataDir();
  const created = createRunRecord(dataDir, { type: "approval", title: "Needs decision" }).record;
  const updated = updateRunRecord(dataDir, created.id, { state: "approved" });
  assert.equal(updated.ok, true);
  assert.equal(updated.record.state, "approved");
  assert.ok(updated.record.resolvedAt);

  assert.deepEqual(deleteRunRecord(dataDir, created.id), { ok: true, deleted: created.id });
  assert.equal(listRunRecords(dataDir).length, 0);
});

test("run store validates title", () => {
  const dataDir = tempDataDir();
  assert.deepEqual(createRunRecord(dataDir, { type: "artifact", title: "" }), { ok: false, error: "title_required" });
});

test("run store materializes artifact content inside plugin data dir", () => {
  const dataDir = tempDataDir();
  const created = createRunRecord(dataDir, {
    type: "artifact",
    title: "Mission Report",
    content: "# Report\n\nDone.",
    language: "markdown"
  }).record;

  const materialized = materializeRunRecordFile(dataDir, created.id);
  assert.equal(materialized.ok, true);
  assert.equal(materialized.file.filename.endsWith(".md"), true);
  assert.equal(materialized.file.filePath.startsWith(path.join(dataDir, "artifacts") + path.sep), true);
  assert.equal(fs.readFileSync(materialized.file.filePath, "utf8"), "# Report\n\nDone.");

  const read = readRunRecordArtifactFile(dataDir, created.id);
  assert.equal(read.ok, true);
  assert.equal(read.content, "# Report\n\nDone.");
  assert.equal(read.file.mime, "text/markdown; charset=utf-8");
});
