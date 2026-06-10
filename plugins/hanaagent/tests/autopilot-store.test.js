import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildAutopilotPlan,
  getAutopilotLoopState,
  latestAutopilotRun,
  listAutopilotRuns,
  pauseAutopilotLoop,
  recordAutopilotLoopTick,
  recordAutopilotRun,
  resumeAutopilotLoop,
  startAutopilotLoop,
  stopAutopilotLoop
} from "../lib/autopilot-store.js";
import { createMission, updateMissionAssignment } from "../lib/mission-store.js";

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-autopilot-"));
}

test("autopilot plan suggests dispatch, sync-history, blocked escalation, and completion", () => {
  const dataDir = tempDataDir();
  const mission = createMission(dataDir, {
    goal: "Autopilot mission",
    maxWorkers: 3,
    sessionPath: "/sessions/main.jsonl"
  }).mission;
  const queued = mission.assignments[1];
  const blocked = mission.assignments[2];
  updateMissionAssignment(dataDir, mission.id, blocked.id, {
    state: "blocked",
    blocker: "needs user input",
    nextAction: "ask user"
  });
  const plan = buildAutopilotPlan({
    mission: {
      ...mission,
      assignments: [
        { ...mission.assignments[0], state: "running", updatedAt: "2020-01-01T00:00:00.000Z" },
        queued,
        { ...blocked, state: "blocked", blocker: "needs user input" }
      ]
    },
    tasks: [],
    checkpoints: [],
    sessionStatuses: {
      "/sessions/main.jsonl": { state: "stale", lastSeen: "2020-01-01T00:00:00.000Z" }
    }
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.suggestions.some((item) => item.action === "dispatch" && item.assignmentId === queued.id), true);
  assert.equal(plan.suggestions.some((item) => item.action === "sync-history"), true);
  assert.equal(plan.suggestions.some((item) => item.action === "mark-blocked"), true);
  assert.equal(plan.suggestions.some((item) => item.action === "escalate" && item.assignmentId === blocked.id), true);
  assert.match(plan.summary, /queued/);
});

test("autopilot runs are persisted and listed newest first", () => {
  const dataDir = tempDataDir();
  const first = recordAutopilotRun(dataDir, {
    missionId: "m1",
    mode: "preview",
    createdAt: "2026-01-01T00:00:00.000Z",
    summary: "first",
    suggestions: [{ action: "monitor", reason: "watch" }]
  });
  const second = recordAutopilotRun(dataDir, {
    missionId: "m1",
    mode: "run",
    createdAt: "2026-01-01T00:01:00.000Z",
    summary: "second"
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(listAutopilotRuns(dataDir, { missionId: "m1" })[0].summary, "second");
  assert.equal(latestAutopilotRun(dataDir, { missionId: "m1" }).mode, "run");
});

test("autopilot loop tracks pause resume iterations and escalation", () => {
  const dataDir = tempDataDir();
  assert.equal(getAutopilotLoopState(dataDir).state, "idle");

  let result = startAutopilotLoop(dataDir, {
    mode: "run",
    maxIterations: 3,
    maxMissionsPerTick: 2,
    escalationThreshold: 2,
    intervalMinutes: 5
  });
  assert.equal(result.ok, true);
  assert.equal(result.loop.state, "active");
  assert.equal(result.loop.mode, "run");

  result = recordAutopilotLoopTick(dataDir, {
    reason: "interval",
    result: {
      ok: true,
      mode: "run",
      scanned: 1,
      results: [{ runId: "run-1", suggestions: [{ action: "escalate", severity: "critical" }] }]
    },
    generatedAt: "2026-01-01T00:00:00.000Z"
  });
  assert.equal(result.loop.iteration, 1);
  assert.equal(result.loop.state, "active");
  assert.equal(result.loop.consecutiveCritical, 1);

  result = recordAutopilotLoopTick(dataDir, {
    reason: "interval",
    result: {
      ok: true,
      mode: "run",
      scanned: 1,
      results: [{ runId: "run-2", suggestions: [{ action: "escalate", severity: "critical" }] }]
    },
    generatedAt: "2026-01-01T00:01:00.000Z"
  });
  assert.equal(result.loop.state, "escalated");
  assert.equal(result.loop.reason, "critical_threshold_reached");
  assert.deepEqual(result.loop.lastTick.runIds, ["run-2"]);

  result = pauseAutopilotLoop(dataDir);
  assert.equal(result.loop.state, "paused");
  result = resumeAutopilotLoop(dataDir);
  assert.equal(result.loop.state, "active");
  result = stopAutopilotLoop(dataDir);
  assert.equal(result.loop.state, "stopped");
});
