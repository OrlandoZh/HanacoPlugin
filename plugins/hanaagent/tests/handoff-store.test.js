import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  listHandoffs,
  materializeHandoff,
  readHandoff
} from "../lib/handoff-store.js";

test("handoff store materializes latest and archived worker handoff markdown", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-handoff-"));
  const result = materializeHandoff(dataDir, {
    workerId: "builder-1",
    missionId: "mission-1",
    assignmentId: "assignment-1",
    checkpoint: {
      id: "checkpoint-1",
      state: "HANDOFF",
      taskId: "task-1",
      sessionPath: "/sessions/worker.jsonl",
      agentId: "primary",
      filesChanged: ["src/app.ts"],
      commandsRun: ["npm test"],
      result: "Feature landed with tests.",
      blocker: "none",
      nextAction: "Resume review.",
      rawText: "STATE: HANDOFF\nRESULT: Feature landed with tests.\nNEXT_ACTION: Resume review.",
      createdAt: "2026-01-01T00:00:00.000Z"
    }
  });

  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(result.handoff.latestPath), true);
  assert.equal(fs.existsSync(result.handoff.archivePath), true);
  assert.equal(result.handoff.memoryPath, "memory/handoffs/swarm/builder-1-latest.md");

  const listed = listHandoffs(dataDir);
  assert.equal(listed.handoffs.length, 1);
  assert.equal(listed.handoffs[0].workerId, "builder-1");
  assert.equal(listed.handoffs[0].assignmentId, "assignment-1");
  assert.match(listed.handoffs[0].content, /Feature landed with tests/);

  const read = readHandoff(dataDir, "builder-1");
  assert.equal(read.ok, true);
  assert.equal(read.handoff.sessionPath, "/sessions/worker.jsonl");
  assert.match(read.handoff.content, /## Raw Checkpoint/);
});

test("handoff store rejects non-handoff checkpoints", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-handoff-"));
  const result = materializeHandoff(dataDir, {
    workerId: "builder-1",
    checkpoint: { state: "DONE", result: "done" }
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "handoff_checkpoint_required");
});
