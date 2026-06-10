import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildProfileMissionInput,
  buildOperationsOverview,
  buildPresetMissionInput,
  deleteOperationProfile,
  exportOperationProfile,
  exportSwarmRoster,
  getOperationPreset,
  importOperationProfile,
  importSwarmRoster,
  listOperationProfiles,
  profileToSwarmRoster,
  saveOperationProfile,
  swarmRosterToProfile,
  seedOperationProfileFromPreset,
  listOperationPresets
} from "../lib/operations-profile.js";

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-operations-"));
}

test("operation presets expose Hermes-style profile lanes", () => {
  const presets = listOperationPresets();
  assert.equal(presets.some((preset) => preset.id === "builder"), true);
  assert.equal(getOperationPreset("reviewer").roles.includes("reviewer"), true);
  presets[0].roles.push("mutated");
  assert.equal(listOperationPresets()[0].roles.includes("mutated"), false);
});

test("operations overview computes readiness and setup gaps", () => {
  const overview = buildOperationsOverview({
    capabilities: {
      sessionSend: true,
      sessionHistory: true,
      taskList: true,
      checkpointList: true
    },
    agents: [{ id: "primary" }],
    sessions: [{ path: "/sessions/primary.jsonl" }],
    workerCards: [{ id: "primary", status: "running" }],
    hostTasks: [{ taskId: "task_1", status: "running" }],
    inbox: { summary: { blockers: 1, approvals: 0 } },
    autopilotSchedule: { enabled: true }
  });

  assert.equal(overview.ok, true);
  assert.equal(overview.recommendedPresetId, "ops");
  assert.equal(overview.metrics.activeWorkers, 1);
  assert.equal(overview.metrics.autopilotEnabled, true);
  assert.equal(overview.checks.some((check) => check.id === "session:create" && check.available === false), true);
});

test("preset mission input maps profile to mission creation payload", () => {
  const input = buildPresetMissionInput({
    presetId: "builder",
    goal: "Ship HanaAgent operations",
    sessionPath: "/sessions/primary.jsonl",
    agentId: "primary"
  });

  assert.equal(input.goal, "Ship HanaAgent operations");
  assert.equal(input.createdBy, "hanaagent-operations");
  assert.equal(input.templateLabel, "Operations: Builder");
  assert.equal(input.roles.includes("builder"), true);
  assert.equal(input.sessionPath, "/sessions/primary.jsonl");
});

test("operation profiles persist custom topology and can build mission input", () => {
  const dataDir = tempDataDir();
  let result = seedOperationProfileFromPreset(dataDir, "builder", {
    id: "team-builder",
    label: "Team Builder",
    defaultAgentId: "primary",
    defaultSessionPath: "/sessions/primary.jsonl",
    lanes: [
      { id: "orchestrator", roleId: "orchestrator", agentId: "primary", sessionPath: "/sessions/primary.jsonl" },
      { id: "builder", roleId: "builder", agentId: "builder-agent", sessionPath: "/sessions/builder.jsonl", cwd: "/repo" }
    ]
  });
  assert.equal(result.ok, true);

  const profiles = listOperationProfiles(dataDir);
  const profile = profiles.find((item) => item.id === "team-builder");
  assert.equal(profile.label, "Team Builder");
  assert.equal(profile.lanes[1].agentId, "builder-agent");

  const input = buildProfileMissionInput({ profile, goal: "Ship topology" });
  assert.equal(input.profileId, "team-builder");
  assert.equal(input.roles.includes("builder"), true);
  assert.equal(input.agentId, "");

  result = saveOperationProfile(dataDir, { id: "review-team", label: "Review Team", roles: ["reviewer"], lanes: [{ roleId: "reviewer", agentId: "qa" }] });
  assert.equal(result.profile.lanes[0].agentId, "qa");
  assert.equal(deleteOperationProfile(dataDir, "review-team").ok, true);
  assert.equal(listOperationProfiles(dataDir).some((item) => item.id === "review-team"), false);
});

test("operation profiles preserve Hermes swarm roster metadata", () => {
  const dataDir = tempDataDir();
  const saved = saveOperationProfile(dataDir, {
    id: "hermes-team",
    label: "Hermes Team",
    roles: ["orchestrator", "builder"],
    lanes: [
      {
        id: "orchestrator",
        roleId: "orchestrator",
        label: "Orchestrator",
        specialty: "mission routing",
        model: "GPT-5.5",
        mission: "Route work safely.",
        profile: "orchestrator",
        modes: ["plan"],
        tools: ["todo", "terminal"],
        skills: ["orchestrator-core"],
        capabilities: ["orchestration"],
        preferredTaskTypes: ["routing"],
        greenlightRequiredFor: ["merge", "destructive"],
        maxConcurrentTasks: 1,
        acceptsBroadcast: true,
        plugins: [],
        pluginToolsets: [],
        mcpServers: ["gbrain"],
        wrapper: "orchestrator:plan"
      },
      { id: "builder", roleId: "builder", label: "Builder", model: "GPT-5.5", tools: ["file"], acceptsBroadcast: true }
    ]
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.profile.lanes[0].model, "GPT-5.5");
  assert.deepEqual(saved.profile.lanes[0].greenlightRequiredFor, ["merge", "destructive"]);
  assert.equal(saved.profile.lanes[0].acceptsBroadcast, true);

  const roster = profileToSwarmRoster(saved.profile, { exportedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(roster.workers.length, 2);
  assert.equal(roster.workers[0].wrapper, "orchestrator:plan");
  assert.deepEqual(roster.workers[0].mcpServers, ["gbrain"]);

  const converted = swarmRosterToProfile(roster, { id: "roundtrip", label: "Roundtrip" });
  assert.equal(converted.ok, true);
  assert.equal(converted.profile.lanes[0].specialty, "mission routing");
  assert.equal(converted.profile.lanes[0].maxConcurrentTasks, 1);
});

test("swarm roster import and export supports Hermes-style YAML", () => {
  const dataDir = tempDataDir();
  const yaml = [
    "version: 1",
    "workers:",
    "- id: orchestrator",
    "  name: Orchestrator",
    "  role: Swarm Orchestrator / Greenlight Gate",
    "  specialty: mission routing, handoffs",
    "  model: GPT-5.5",
    "  mission: Decompose missions into safe work.",
    "  profile: orchestrator",
    "  modes:",
    "  - plan",
    "  tools:",
    "  - todo",
    "  - terminal",
    "  skills:",
    "  - orchestrator-core",
    "  capabilities:",
    "  - orchestration",
    "  preferredTaskTypes:",
    "  - routing",
    "  greenlightRequiredFor:",
    "  - merge",
    "  maxConcurrentTasks: 1",
    "  acceptsBroadcast: true",
    "  plugins: []",
    "  pluginToolsets: []",
    "  mcpServers:",
    "  - gbrain",
    "  wrapper: orchestrator:plan",
    "- id: builder",
    "  name: Builder",
    "  role: Scoped Implementation Agent",
    "  model: GPT-5.5",
    "  tools:",
    "  - file",
    "  acceptsBroadcast: true",
    ""
  ].join("\n");

  const imported = importSwarmRoster(dataDir, { text: yaml, id: "imported-swarm", label: "Imported Swarm" });
  assert.equal(imported.ok, true);
  assert.equal(imported.profile.id, "imported-swarm");
  assert.equal(imported.profile.lanes.length, 2);
  assert.equal(imported.profile.lanes[0].wrapper, "orchestrator:plan");
  assert.deepEqual(imported.profile.lanes[0].tools, ["todo", "terminal"]);

  const exportedJson = exportSwarmRoster(dataDir, "imported-swarm", { format: "json", exportedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(exportedJson.ok, true);
  assert.equal(exportedJson.roster.workers[0].greenlightRequiredFor[0], "merge");
  assert.match(exportedJson.body, /"workers"/);

  const exportedYaml = exportSwarmRoster(dataDir, "imported-swarm", { format: "yaml", exportedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(exportedYaml.ok, true);
  assert.match(exportedYaml.body, /workers:/);
  assert.match(exportedYaml.body, /wrapper: "orchestrator:plan"/);
});

test("operation profiles export and import portable sharing bundles", () => {
  const dataDir = tempDataDir();
  const saved = saveOperationProfile(dataDir, {
    id: "share-team",
    label: "Share Team",
    role: "Implementation",
    visibility: "team",
    permissions: { dispatch: true, edit: false, share: true, terminal: true },
    sharedWith: [{ type: "team", id: "builders", role: "operator" }],
    roles: ["builder"],
    lanes: [{ roleId: "builder", agentId: "builder-agent", cwd: "/repo" }]
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.profile.visibility, "team");
  assert.equal(saved.profile.permissions.edit, false);
  assert.equal(saved.profile.permissions.share, true);
  assert.equal(saved.profile.sharedWith[0].id, "builders");

  const exported = exportOperationProfile(dataDir, "share-team", { exportedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(exported.ok, true);
  assert.equal(exported.bundle.schema, "hanaagent.operationProfile");
  assert.equal(exported.bundle.profile.permissions.terminal, true);
  assert.match(exported.filename, /share-team/);

  assert.equal(deleteOperationProfile(dataDir, "share-team").ok, true);
  const imported = importOperationProfile(dataDir, {
    bundle: exported.bundle,
    idPrefix: "imported",
    importedAt: "2026-01-02T00:00:00.000Z"
  });
  assert.equal(imported.ok, true);
  assert.equal(imported.profile.id, "imported-share-team");
  assert.equal(imported.profile.importedFrom, "hanaagent");
  assert.equal(imported.profile.visibility, "team");
  assert.equal(imported.profile.permissions.share, true);
  assert.equal(imported.profile.sharedWith[0].role, "operator");

  const duplicate = importOperationProfile(dataDir, { bundle: exported.bundle, id: "imported-share-team" });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error, "profile_exists");

  const overwrite = importOperationProfile(dataDir, { bundle: exported.bundle, id: "imported-share-team", overwrite: true });
  assert.equal(overwrite.ok, true);
  assert.equal(overwrite.overwritten, true);
});
