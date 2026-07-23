import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMission, updateMissionAssignment } from "../lib/mission-store.js";
import { createSessionProjector } from "../lib/session-projector.js";

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-projector-"));
}

function makeBus() {
  const subscribers = [];
  return {
    subscribe(callback, filter = {}) {
      const entry = { callback, filter };
      subscribers.push(entry);
      return () => {
        const index = subscribers.indexOf(entry);
        if (index !== -1) subscribers.splice(index, 1);
      };
    },
    emit(event, sessionPath) {
      for (const entry of [...subscribers]) {
        if (entry.filter.sessionPath && entry.filter.sessionPath !== sessionPath) continue;
        if (Array.isArray(entry.filter.types) && !entry.filter.types.includes(event.type)) continue;
        entry.callback(event, sessionPath);
      }
    },
    subscriberCount() {
      return subscribers.length;
    }
  };
}

function wait(ms = 20) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("session projector projects terminal session events for dedicated assignments", async () => {
  const dataDir = tempDataDir();
  const bus = makeBus();
  const created = createMission(dataDir, { goal: "Project a dedicated worker", maxWorkers: 1, agentId: "primary" });
  const assignment = created.mission.assignments[0];
  updateMissionAssignment(dataDir, created.mission.id, assignment.id, {
    state: "running",
    sessionPath: "/sessions/dedicated.jsonl",
    sessionBindingKind: "dedicated",
    sessionBoundAt: "2026-07-20T00:00:00.000Z",
    sessionOriginAssignmentId: assignment.id
  });

  const calls = [];
  const projector = createSessionProjector({ dataDir, bus, log: { warn() {} } }, {
    debounceMs: 0,
    runRecoveryOnStart: false,
    sync: async (input) => {
      calls.push(input);
      return { ok: true, created: [] };
    }
  });

  assert.equal(projector.start().started, true);
  bus.emit({ type: "text_delta", delta: "still working" }, "/sessions/dedicated.jsonl");
  await wait();
  assert.equal(calls.length, 0);

  bus.emit({ type: "turn_end" }, "/sessions/dedicated.jsonl");
  await wait();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    sessionPath: "/sessions/dedicated.jsonl",
    missionId: created.mission.id,
    assignmentId: assignment.id,
    taskId: "",
    agentId: "primary",
    applyToTask: true,
    limit: 80,
    source: "session-projector",
    reason: "turn_end"
  });

  projector.stop();
  assert.equal(bus.subscriberCount(), 0);
});

test("session projector start runs dedicated startup recovery", async () => {
  const dataDir = tempDataDir();
  const bus = makeBus();
  const created = createMission(dataDir, { goal: "Recover a dedicated worker", maxWorkers: 1, agentId: "primary" });
  const assignment = created.mission.assignments[0];
  updateMissionAssignment(dataDir, created.mission.id, assignment.id, {
    state: "running",
    sessionPath: "/sessions/startup.jsonl",
    sessionBindingKind: "dedicated"
  });

  const calls = [];
  const projector = createSessionProjector({ dataDir, bus, log: { warn() {} } }, {
    recoveryDelayMs: 0,
    sync: async (input) => {
      calls.push(input);
      return { ok: true };
    }
  });
  assert.equal(projector.start().started, true);
  await wait(30);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].reason, "startup");
  projector.stop();
});

test("session projector startup recovery skips shared assignments", async () => {
  const dataDir = tempDataDir();
  const bus = makeBus();
  const created = createMission(dataDir, {
    goal: "Do not project a shared session automatically",
    maxWorkers: 1,
    sessionPath: "/sessions/shared.jsonl",
    agentId: "primary"
  });
  const assignment = created.mission.assignments[0];
  assert.equal(assignment.sessionBindingKind, "shared");

  const calls = [];
  const projector = createSessionProjector({ dataDir, bus, log: { warn() {} } }, {
    runRecoveryOnStart: false,
    sync: async (input) => {
      calls.push(input);
      return { ok: true };
    }
  });

  const result = await projector.recover("test-recovery");
  assert.equal(result.recoveredSessions, 0);
  assert.equal(result.skippedShared, 1);
  assert.equal(calls.length, 0);
});

test("session projector serializes assignments from the same mission", async () => {
  const dataDir = tempDataDir();
  const bus = makeBus();
  const created = createMission(dataDir, { goal: "Serialize mission projections", maxWorkers: 2 });
  for (const [index, assignment] of created.mission.assignments.slice(0, 2).entries()) {
    updateMissionAssignment(dataDir, created.mission.id, assignment.id, {
      state: "running",
      sessionPath: `/sessions/parallel-${index}.jsonl`,
      sessionBindingKind: "dedicated"
    });
  }

  let active = 0;
  let maxActive = 0;
  const calls = [];
  const projector = createSessionProjector({ dataDir, bus, log: { warn() {} } }, {
    debounceMs: 0,
    runRecoveryOnStart: false,
    sync: async (input) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls.push(input.assignmentId);
      await wait(15);
      active -= 1;
      return { ok: true };
    }
  });
  projector.start();

  bus.emit({ type: "turn_end" }, "/sessions/parallel-0.jsonl");
  bus.emit({ type: "turn_end" }, "/sessions/parallel-1.jsonl");
  await wait(60);
  assert.equal(maxActive, 1);
  assert.equal(calls.length, 2);
  projector.stop();
});

test("session projector coalesces events while a projection is running", async () => {
  const dataDir = tempDataDir();
  const bus = makeBus();
  const created = createMission(dataDir, { goal: "Coalesce projector events", maxWorkers: 1 });
  const assignment = created.mission.assignments[0];
  updateMissionAssignment(dataDir, created.mission.id, assignment.id, {
    state: "running",
    sessionPath: "/sessions/coalesce.jsonl",
    sessionBindingKind: "dedicated"
  });

  let release;
  const calls = [];
  const projector = createSessionProjector({ dataDir, bus, log: { warn() {} } }, {
    debounceMs: 0,
    runRecoveryOnStart: false,
    sync: async (input) => {
      calls.push(input.reason);
      await new Promise((resolve) => { release = resolve; });
      return { ok: true };
    }
  });
  projector.start();

  bus.emit({ type: "done" }, "/sessions/coalesce.jsonl");
  await wait();
  bus.emit({ type: "turn_end" }, "/sessions/coalesce.jsonl");
  release();
  await wait(30);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls, ["done", "coalesced-event"]);
  projector.stop();
});
