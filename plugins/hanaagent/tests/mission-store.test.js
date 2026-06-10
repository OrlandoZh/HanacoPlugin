import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildContinuationPrompt,
  buildConductorPrompt,
  buildMissionBriefs,
  buildMissionExport,
  buildMissionReport,
  buildSwarmBrief,
  completeMission,
  formatSwarmBrief,
  createMission,
  getMission,
  linkMissionAssignmentTask,
  listMissions,
  stopMission,
  updateMissionAssignment,
  updateMissionFromCheckpoint
} from "../lib/mission-store.js";

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-missions-"));
}

test("mission store creates Conductor-style missions with assignments and events", () => {
  const dataDir = tempDataDir();
  const result = createMission(dataDir, {
    goal: "完整复刻 Hermes Conductor",
    notes: "OpenHanako plugin",
    maxWorkers: 3,
    sessionPath: "/sessions/main.jsonl",
    agentId: "primary"
  });

  assert.equal(result.ok, true);
  assert.equal(result.mission.state, "active");
  assert.equal(result.mission.assignments.length, 3);
  assert.equal(result.mission.phase, "preview");
  assert.equal(result.mission.totalTokens, 0);
  assert.equal(result.mission.assignments[0].state, "running");
  assert.equal(result.mission.assignments[1].state, "queued");
  assert.equal(result.mission.events.length, 2);
  assert.equal(listMissions(dataDir).length, 1);
  assert.equal(getMission(dataDir, result.mission.id).goal, "完整复刻 Hermes Conductor");
});

test("mission store applies profile lane topology to assignments", () => {
  const dataDir = tempDataDir();
  const result = createMission(dataDir, {
    goal: "Apply profile topology",
    roles: ["orchestrator", "builder"],
    maxWorkers: 2,
    lanes: [
      { roleId: "orchestrator", agentId: "lead", sessionPath: "/sessions/lead.jsonl", cwd: "/repo" },
      { roleId: "builder", agentId: "builder", sessionPath: "/sessions/builder.jsonl", cwd: "/repo/packages/app" }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.mission.assignments[0].agentId, "lead");
  assert.equal(result.mission.assignments[0].sessionPath, "/sessions/lead.jsonl");
  assert.equal(result.mission.assignments[1].agentId, "builder");
  assert.equal(result.mission.assignments[1].cwd, "/repo/packages/app");
});

test("mission store uses dynamic Hermes roster lanes as assignments", () => {
  const dataDir = tempDataDir();
  const result = createMission(dataDir, {
    goal: "Run imported swarm roster",
    roles: ["maintainer", "strategist", "inbox-triage"],
    maxWorkers: 3,
    lanes: [
      {
        id: "maintainer",
        roleId: "maintainer",
        label: "Maintainer",
        role: "Upstream Dependency / Patch Hygiene",
        specialty: "upstream tracking, dependency updates",
        model: "GPT-5.5",
        mission: "Keep local forks healthy without losing local patches.",
        tools: ["terminal", "file", "web"],
        skills: ["maintainer-core"],
        greenlightRequiredFor: ["merge", "push"],
        wrapper: "maintainer:check",
        agentId: "maintainer-agent",
        sessionPath: "/sessions/maintainer.jsonl",
        cwd: "/repo"
      },
      {
        id: "strategist",
        roleId: "strategist",
        label: "Strategist",
        specialty: "plans, bets, kill criteria",
        tools: ["web"],
        acceptsBroadcast: true
      },
      {
        id: "inbox-triage",
        roleId: "inbox-triage",
        label: "Inbox Triage",
        tools: ["gbrain", "todo"]
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.mission.assignments.length, 3);
  assert.equal(result.mission.assignments[0].roleId, "maintainer");
  assert.equal(result.mission.assignments[0].label, "Maintainer");
  assert.equal(result.mission.assignments[0].agentId, "maintainer-agent");
  assert.equal(result.mission.assignments[0].roster.model, "GPT-5.5");
  assert.deepEqual(result.mission.assignments[0].roster.greenlightRequiredFor, ["merge", "push"]);
  assert.match(result.mission.assignments[0].task, /建议模型：GPT-5.5/);
  assert.match(result.mission.assignments[0].task, /需要 Greenlight 的动作：merge, push/);
  assert.equal(result.mission.assignments[2].roleId, "inbox-triage");
});

test("mission store updates assignment output, completes, and stops missions", () => {
  const dataDir = tempDataDir();
  const mission = createMission(dataDir, { goal: "Run controls", maxWorkers: 2 }).mission;
  const first = mission.assignments[0];

  let result = updateMissionAssignment(dataDir, mission.id, first.id, {
    state: "done",
    result: "worker finished",
    output: "full worker output",
    tokenCount: 1234
  });
  assert.equal(result.ok, true);
  assert.equal(result.assignment.state, "done");
  assert.equal(result.assignment.tokenCount, 1234);
  assert.equal(result.mission.totalTokens, 1234);

  result = completeMission(dataDir, mission.id, { summary: "manual complete" });
  assert.equal(result.ok, true);
  assert.equal(result.mission.state, "complete");
  assert.equal(result.mission.phase, "complete");
  assert.equal(result.mission.summary, "manual complete");

  const stoppedMission = createMission(dataDir, { goal: "Stop controls", maxWorkers: 2 }).mission;
  result = stopMission(dataDir, stoppedMission.id, { reason: "operator stop" });
  assert.equal(result.ok, true);
  assert.equal(result.mission.state, "cancelled");
  assert.equal(result.mission.phase, "complete");
  assert.equal(result.mission.assignments.every((assignment) => ["done", "cancelled"].includes(assignment.state)), true);
});

test("mission store links tasks and updates assignment state from checkpoints", () => {
  const dataDir = tempDataDir();
  const mission = createMission(dataDir, { goal: "Ship", maxWorkers: 2 }).mission;
  const assignment = mission.assignments[0];

  const linked = linkMissionAssignmentTask(dataDir, mission.id, assignment.id, "task-1");
  assert.equal(linked.ok, true);
  assert.equal(linked.assignment.taskId, "task-1");

  const updated = updateMissionFromCheckpoint(dataDir, {
    taskId: "task-1",
    state: "DONE",
    result: "verified",
    nextAction: "review"
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.assignment.state, "done");
  assert.equal(updated.mission.events.at(-1).type, "checkpoint");
});

test("buildConductorPrompt includes mission, assignment, and checkpoint contract", () => {
  const mission = createMission(tempDataDir(), { goal: "Build workbench", maxWorkers: 1 }).mission;
  const prompt = buildConductorPrompt({
    mission,
    assignment: mission.assignments[0],
    checkpointContract: ["STATE: DONE | BLOCKED", "RESULT: proof"]
  });
  assert.match(prompt, /Mission ID:/);
  assert.match(prompt, /Assignment ID:/);
  assert.match(prompt, /SwarmBrief:/);
  assert.match(prompt, /brief_id:/);
  assert.match(prompt, /Checkpoint 合约/);
  assert.match(prompt, /RESULT: proof/);
});

test("mission store builds Hermes SwarmBrief contracts for assignments", () => {
  const mission = createMission(tempDataDir(), {
    goal: "Ship SwarmBrief parity",
    notes: "Triggered by Hermes parity audit",
    maxWorkers: 1,
    lanes: [
      {
        id: "builder",
        label: "Builder",
        specialty: "implementation",
        model: "GPT-5.5",
        tools: ["terminal", "files"],
        skills: ["swarm-worker-core"],
        capabilities: ["code-editing"],
        greenlightRequiredFor: ["push"],
        acceptsBroadcast: true,
        reviewRequired: true,
        defaultCwd: "/repo/hanaagent"
      }
    ]
  }).mission;
  const assignment = mission.assignments[0];
  const brief = buildSwarmBrief({
    mission,
    assignment,
    checkpointContract: ["STATE: DONE | BLOCKED", "RESULT: proof"]
  });
  assert.equal(brief.worker, "builder");
  assert.equal(brief.project, "hanaagent");
  assert.equal(brief.goal, "Ship SwarmBrief parity");
  assert.deepEqual(brief.checkpoint_contract.allowed_states, ["DONE", "BLOCKED"]);
  assert.equal(brief.worker_context.model, "GPT-5.5");
  assert.deepEqual(brief.worker_context.skills, ["swarm-worker-core"]);
  assert.match(formatSwarmBrief(brief), /checkpoint_contract:/);
  assert.match(formatSwarmBrief(brief), /greenlight/i);

  const briefs = buildMissionBriefs(mission);
  assert.equal(briefs.length, 1);
  assert.equal(briefs[0].brief_id, brief.brief_id);
});

test("mission store builds Hermes-style reports, exports, and continuation prompts", () => {
  const dataDir = tempDataDir();
  const mission = createMission(dataDir, { goal: "Ship report view", maxWorkers: 2 }).mission;
  updateMissionAssignment(dataDir, mission.id, mission.assignments[0].id, {
    state: "done",
    result: "report generated",
    output: "full worker details",
    nextAction: "export markdown",
    tokenCount: 321
  });
  const completed = completeMission(dataDir, mission.id, { summary: "report mission complete" }).mission;

  const report = buildMissionReport(completed);
  assert.match(report, /# Mission Report/);
  assert.match(report, /## Worker Summary/);
  assert.match(report, /report mission complete/);
  assert.match(report, /Tokens: 321/);

  const exported = buildMissionExport(completed);
  assert.equal(exported.id, completed.id);
  assert.equal(exported.tokenCount, 321);
  assert.match(exported.report, /Mission Report/);

  const continuation = buildContinuationPrompt(completed, "继续做 UI");
  assert.match(continuation, /CONTINUATION OF PREVIOUS MISSION/);
  assert.match(continuation, /Original goal: Ship report view/);
  assert.match(continuation, /继续做 UI/);
});
