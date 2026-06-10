import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildModelSuggestions,
  buildSessionForkPrompt,
  buildSessionTitleSuggestion,
  buildMissionPrompt,
  abortSession,
  cancelHostTask,
  completeHostTask,
  createSession,
  dispatchMission,
  findSessionCheckpoints,
  forkSession,
  getAgentConfig,
  getBlueprint,
  getCheckpointContract,
  getContextUsage,
  getParityMatrix,
  getSessionHistory,
  getSessionStatus,
  getTemplates,
  getWorkbenchState,
  listAgentSkills,
  listAgentProfileOverrides,
  listHostCheckpoints,
  listDeferredTasks,
  listHostTasks,
  listMemoryEntries,
  listAgents,
  listSessions,
  listTerminals,
  listUsage,
  queryDeferredTask,
  readMemoryEntry,
  registerHostTask,
  readTerminal,
  revertSessionTurn,
  restoreHostCheckpoint,
  sendSessionMessage,
  startTerminal,
  updateAgentConfig,
  updateHostTask,
  writeTerminal,
  closeTerminal
} from "../lib/hanaagent-core.js";

function makeCtx({ agents = [], sessions = [], history = [], agentConfig = {}, agentSkills = {}, memoryEntries = [], usageEntries = [], hostCheckpoints = [], hostTasks = [], deferredTasks = [], sessionAliases = [], sessionTombstones = [], onSend, onAbort, dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-core-")), onUpdateAgentConfig } = {}) {
  return {
    pluginId: "hanaagent",
    dataDir,
    config: {
      getAll() {
        return {
          defaultAgentId: "primary",
          defaultSessionPath: "/sessions/primary.jsonl",
          savedMissions: [],
          sessionAliases,
          sessionTombstones
        };
      }
    },
    bus: {
      listCapabilities() {
        return [
          { type: "agent:list", available: true },
          { type: "session:list", available: true },
          { type: "session:send", available: true },
          { type: "session:create", available: true },
          { type: "session:status", available: true },
          { type: "session:history", available: true },
          { type: "session:abort", available: true },
          { type: "session:revert-turn", available: true },
          { type: "agent:config", available: true },
          { type: "agent:update-config", available: true },
          { type: "agent:skills", available: true },
          { type: "memory:list", available: true },
          { type: "memory:read", available: true },
          { type: "usage:list", available: true },
          { type: "checkpoint:list", available: true },
          { type: "checkpoint:find-by-session-since", available: true },
          { type: "checkpoint:restore", available: true },
          { type: "task:list", available: true },
          { type: "task:register", available: true },
          { type: "task:update", available: true },
          { type: "task:query", available: true },
          { type: "task:complete", available: true },
          { type: "task:remove", available: true },
          { type: "task:cancel", available: true },
          { type: "deferred:list-pending", available: true },
          { type: "deferred:query", available: true },
          { type: "terminal:list", available: true },
          { type: "terminal:start", available: true },
          { type: "terminal:read", available: true },
          { type: "terminal:write", available: true },
          { type: "terminal:close", available: true }
        ];
      },
      async request(type, payload) {
        if (type === "agent:list") return { agents };
        if (type === "session:list") {
          const filtered = payload?.agentId ? sessions.filter((session) => session.agentId === payload.agentId) : sessions;
          return { sessions: filtered };
        }
        if (type === "session:send") {
          if (onSend) return onSend(payload);
          return { accepted: true, sessionPath: payload.sessionPath };
        }
        if (type === "session:create") return { path: "/sessions/new-worker.jsonl", title: payload.title || "Worker", agentId: payload.agentId, cwd: payload.cwd };
        if (type === "session:status") return { state: "running", busy: true, lastSeen: "2026-01-01T00:00:00.000Z" };
        if (type === "session:history") return { messages: history };
        if (type === "session:abort") {
          if (onAbort) return onAbort(payload);
          return { accepted: true, sessionPath: payload.sessionPath };
        }
        if (type === "session:revert-turn") return { ok: true, sessionPath: payload.sessionPath, branchPath: payload.path || payload.sessionPath, restoredCheckpoints: 2 };
        if (type === "agent:config") return { config: agentConfig[payload.agentId] || { name: "Primary", models: { chat: "gpt-5-mini" }, memory: { enabled: true }, skills: { enabled: ["review"] } } };
        if (type === "agent:update-config") {
          if (onUpdateAgentConfig) return onUpdateAgentConfig(payload);
          return { ok: true, config: payload.partial };
        }
        if (type === "agent:skills") return { skills: agentSkills[payload.agentId] || [{ id: "review", name: "Review", description: "Check work" }] };
        if (type === "memory:list") return { entries: memoryEntries };
        if (type === "memory:read") return { entry: memoryEntries.find((entry) => entry.id === payload.memoryId || entry.memoryId === payload.memoryId) || { id: payload.memoryId, title: "Memory", content: "memory content" } };
        if (type === "usage:list") return { entries: usageEntries, nextCursor: null };
        if (type === "checkpoint:list") return { checkpoints: hostCheckpoints };
        if (type === "checkpoint:find-by-session-since") return { checkpoints: hostCheckpoints.filter((checkpoint) => checkpoint.sessionPath === payload.sessionPath) };
        if (type === "checkpoint:restore") return { ok: true, restoredTo: `/tmp/${payload.id || payload.checkpointId}.js` };
        if (type === "task:list") return hostTasks;
        if (type === "task:query") return hostTasks.find((task) => task.taskId === payload.taskId) || null;
        if (type === "task:register") return { ok: true, task: { taskId: payload.taskId, type: payload.type, status: "running", pluginId: payload.pluginId } };
        if (type === "task:update") return { ok: true, task: { taskId: payload.taskId, status: payload.status || "running", progress: payload.progress } };
        if (type === "task:complete") return { ok: true, task: { taskId: payload.taskId, status: "done", result: payload.result } };
        if (type === "task:cancel") return { ok: true, canceled: true, taskId: payload.taskId };
        if (type === "deferred:list-pending") return deferredTasks;
        if (type === "deferred:query") return deferredTasks.find((task) => task.taskId === payload.taskId) || null;
        if (type === "terminal:list") return { sessionPath: payload.sessionPath, terminals: [{ terminalId: "term_1", status: "running", seq: 0 }] };
        if (type === "terminal:start") return { terminalId: "term_1", sessionPath: payload.sessionPath, status: "running", seq: 0 };
        if (type === "terminal:read") return { terminalId: payload.terminalId, sessionPath: payload.sessionPath, seq: 1, output: "hello" };
        if (type === "terminal:write") return { terminalId: payload.terminalId, sessionPath: payload.sessionPath, seq: 2, output: payload.chars };
        if (type === "terminal:close") return { terminalId: payload.terminalId, sessionPath: payload.sessionPath, status: "killed" };
        throw new Error(`unknown request: ${type}`);
      }
    }
  };
}

test("templates expose workbench workflow prompts", () => {
  const templates = getTemplates();
  assert.equal(templates.length, 4);
  assert.deepEqual(templates.map((item) => item.id), ["orchestrate", "research", "build", "review"]);
  assert.match(templates[0].prompt, /Hanaco 智能体工作台/);
});

test("model suggestions rank pinned models by mission profile", () => {
  const coding = buildModelSuggestions({
    goal: "完整实现插件功能并补测试",
    templateId: "build",
    mode: "dispatch",
    pinnedModels: [
      { model: "gpt-5-mini", provider: "openai", agentId: "primary" },
      { model: "gpt-5", provider: "openai", agentId: "primary" }
    ]
  });
  assert.equal(coding.targetTier, "high-capability");
  assert.equal(coding.recommendations[0].model, "gpt-5");
  assert.match(coding.recommendations[0].reason, /complex|mission|coding|review/i);

  const quick = buildModelSuggestions({
    goal: "快速写一个简单草稿",
    mode: "plan",
    pinnedModels: [
      { model: "gpt-5-mini", provider: "openai" },
      { model: "gpt-5", provider: "openai" }
    ],
    modelMetadata: [
      { model: "gpt-5-mini", provider: "openai", contextWindow: 128000, inputCostPer1M: 0.25, outputCostPer1M: 2 },
      { model: "gpt-5", provider: "openai", contextWindow: 256000, inputCostPer1M: 1.25, outputCostPer1M: 10 }
    ]
  });
  assert.equal(quick.targetTier, "fast");
  assert.equal(quick.recommendations[0].model, "gpt-5-mini");
  assert.equal(quick.recommendations[0].contextWindow, 128000);
  assert.equal(quick.recommendations[0].inputCostPer1M, 0.25);
});

test("session title suggestions derive concise titles from history", () => {
  const result = buildSessionTitleSuggestion({
    sessionPath: "/sessions/primary.jsonl",
    currentTitle: "New Chat",
    messages: [
      { role: "system", content: "system prompt" },
      { role: "user", content: "目标：完整复刻 Hermes Workspace 为 OpenHanako 插件，并补齐烟测" },
      { role: "assistant", content: "STATE: DONE\nRESULT: 已实现工作台功能" }
    ]
  });
  assert.equal(result.ok, true);
  assert.match(result.title, /^完整复刻 Hermes Workspace/);
  assert.equal(result.title.length <= 38, true);
  assert.equal(result.source, "explicit-goal");
  assert.equal(result.candidates.some((item) => item.source === "checkpoint"), true);

  const fallback = buildSessionTitleSuggestion({ sessionPath: "/sessions/review-run.jsonl", messages: [] });
  assert.equal(fallback.title, "review-run");
  assert.equal(fallback.source, "session-path");
});

test("blueprint documents Hermes-to-Hanaco workbench phases", () => {
  const blueprint = getBlueprint();
  assert.equal(blueprint.reference, "reference/hermes-workspace-main");
  assert.ok(blueprint.currentCoverage.some((item) => item.id === "mission-dispatch" && item.status === "implemented"));
  assert.ok(blueprint.currentCoverage.some((item) => item.id === "tool-call-rendering" && item.status === "implemented"));
  assert.ok(blueprint.currentCoverage.some((item) => item.id === "autopilot-routing" && item.status === "implemented"));
  assert.ok(blueprint.currentCoverage.some((item) => item.id === "skills-memory-readonly" && item.status === "implemented"));
  assert.ok(blueprint.currentCoverage.some((item) => item.id === "terminal-surface" && item.status === "implemented"));
  assert.ok(blueprint.currentCoverage.some((item) => item.id === "files-editor-preview" && item.status === "implemented"));
  assert.ok(blueprint.currentCoverage.some((item) => item.id === "auto-session-titles" && item.status === "implemented"));
  assert.equal(blueprint.currentCoverage.every((item) => item.status === "implemented"), true);
  assert.deepEqual(blueprint.phases.map((item) => item.id), ["phase-1", "phase-2", "phase-3", "phase-4", "phase-5", "phase-6"]);
  assert.ok(blueprint.hostRequests.includes("session:history"));
  assert.equal(blueprint.parity.summary.completeForPluginScope, true);
  assert.equal(blueprint.parity.summary.missing, 0);
});

test("parity matrix audits Hermes inventory without plugin-scope missing items", () => {
  const parity = getParityMatrix();
  assert.equal(parity.reference, "reference/hermes-workspace-main");
  assert.ok(parity.categories.length >= 5);
  assert.equal(parity.summary.total > 20, true);
  assert.equal(parity.summary.completeForPluginScope, true);
  assert.equal(parity.summary.missing, 0);
  assert.ok(parity.summary.pluginImplemented > parity.summary.capabilityGated);
  const statuses = new Set(parity.statuses);
  for (const category of parity.categories) {
    assert.ok(category.items.length > 0, category.id);
    for (const item of category.items) {
      assert.ok(statuses.has(item.status), `${item.id} uses unknown status ${item.status}`);
      assert.ok(item.evidence, `${item.id} should include evidence`);
    }
  }
});

test("checkpoint contract is included in mission prompts", () => {
  const contract = getCheckpointContract();
  assert.ok(contract.includes("RESULT: concrete result/proof"));
  const prompt = buildMissionPrompt({
    mission: "整理工作台路线图",
    notes: "",
    template: getTemplates()[0],
    mode: "dispatch"
  });
  assert.match(prompt, /Checkpoint 合约/);
  assert.match(prompt, /STATE: DONE \| BLOCKED/);
  assert.match(prompt, /RESULT: concrete result\/proof/);
});

test("listAgents and listSessions normalize Hana bus payloads", async () => {
  const ctx = makeCtx({
    agents: [{ id: "primary", name: "Primary", isPrimary: true }],
    sessionAliases: [{ sessionPath: "/sessions/primary.jsonl", title: "Renamed Build Session", updatedAt: "2026-01-01T00:00:00.000Z" }],
    sessionTombstones: [{ sessionPath: "/sessions/hidden.jsonl", title: "Hidden" }],
    sessions: [
      { path: "/sessions/primary.jsonl", title: "Build plugin", agentId: "primary", agentName: "Primary", messageCount: "7" },
      { path: "/sessions/hidden.jsonl", title: "Hidden", agentId: "primary" },
      { path: "/sessions/other.jsonl", firstMessage: "Research", agentId: "research" }
    ]
  });

  assert.deepEqual(await listAgents(ctx), {
    ok: true,
    agents: [{ id: "primary", name: "Primary", isCurrent: false, isPrimary: true }]
  });

  const sessions = await listSessions(ctx, { agentId: "primary" });
  assert.equal(sessions.ok, true);
  assert.equal(sessions.sessions.length, 1);
  assert.equal(sessions.sessions[0].messageCount, 7);
  assert.equal(sessions.sessions[0].title, "Renamed Build Session");
  assert.equal(sessions.sessions[0].originalTitle, "Build plugin");
  assert.equal(sessions.sessions[0].alias.source, "hanaagent");
});

test("getWorkbenchState includes capabilities, templates, config, agents, and sessions", async () => {
  const ctx = makeCtx({
    agents: [{ id: "primary", name: "Primary" }],
    sessions: [{ path: "/sessions/primary.jsonl", title: "Current", agentId: "primary" }]
  });
  const state = await getWorkbenchState(ctx);
  assert.equal(state.ok, true);
  assert.equal(state.pluginId, "hanaagent");
  assert.equal(state.config.defaultAgentId, "primary");
  assert.equal(state.capabilities.sessionSend, true);
  assert.equal(state.capabilities.sessionCreate, true);
  assert.equal(state.capabilities.sessionStatus, true);
  assert.equal(state.capabilities.sessionHistory, true);
  assert.equal(state.capabilities.sessionAbort, true);
  assert.equal(state.capabilities.sessionRevertTurn, true);
  assert.equal(state.capabilities.agentConfig, true);
  assert.equal(state.capabilities.agentSkills, true);
  assert.equal(state.capabilities.memoryList, true);
  assert.equal(state.capabilities.memoryRead, true);
  assert.equal(state.capabilities.usageList, true);
  assert.equal(state.capabilities.checkpointList, true);
  assert.equal(state.capabilities.taskList, true);
  assert.equal(state.capabilities.deferredListPending, true);
  assert.equal(state.capabilities.terminalStart, true);
  assert.equal(state.capabilities.terminalWrite, true);
  assert.ok(state.busCapabilities.some((item) => item.type === "session:history"));
  assert.equal(state.templates.length, 4);
});

test("agent skills and memory helpers proxy readonly runtime surfaces", async () => {
  const ctx = makeCtx({
    agentSkills: {
      primary: [{ id: "review", name: "Review", description: "Review implementation", enabled: true }]
    },
    memoryEntries: [
      { id: "mem-1", title: "Project note", summary: "Use Hana plugin APIs", content: "memory body", agentId: "primary" }
    ]
  });

  const skills = await listAgentSkills(ctx, { agentId: "primary" });
  assert.equal(skills.ok, true);
  assert.equal(skills.skills[0].id, "review");

  const memory = await listMemoryEntries(ctx, { agentId: "primary", query: "Hana" });
  assert.equal(memory.ok, true);
  assert.equal(memory.entries[0].memoryId, "mem-1");

  const entry = await readMemoryEntry(ctx, { memoryId: "mem-1" });
  assert.equal(entry.ok, true);
  assert.equal(entry.entry.content, "memory body");
});

test("session lifecycle and host task helpers proxy worker runtime capabilities", async () => {
  const ctx = makeCtx({
    hostTasks: [{ taskId: "job-1", type: "hanaagent-mission", status: "running", pluginId: "hanaagent" }],
    deferredTasks: [{ taskId: "deferred-1", sessionPath: "/sessions/primary.jsonl", status: "pending" }]
  });

  const createdSession = await createSession(ctx, { agentId: "primary", cwd: "/tmp/project", title: "Worker" });
  assert.equal(createdSession.ok, true);
  assert.equal(createdSession.session.path, "/sessions/new-worker.jsonl");

  const status = await getSessionStatus(ctx, { sessionPath: "/sessions/primary.jsonl" });
  assert.equal(status.ok, true);
  assert.equal(status.status.state, "running");
  assert.equal(status.status.busy, true);

  const listed = await listHostTasks(ctx, { pluginId: "hanaagent" });
  assert.equal(listed.ok, true);
  assert.equal(listed.tasks[0].taskId, "job-1");

  const registered = await registerHostTask(ctx, { taskId: "job-2", type: "hanaagent-mission", sessionPath: "/sessions/primary.jsonl" });
  assert.equal(registered.ok, true);
  assert.equal(registered.taskId, "job-2");

  const updated = await updateHostTask(ctx, { taskId: "job-1", progress: { current: 1, total: 2 } });
  assert.equal(updated.ok, true);
  assert.deepEqual(updated.task.progress, { current: 1, total: 2 });

  const completed = await completeHostTask(ctx, { taskId: "job-1", result: { ok: true } });
  assert.equal(completed.ok, true);
  assert.equal(completed.task.status, "done");

  const cancelled = await cancelHostTask(ctx, { taskId: "job-1", reason: "test" });
  assert.equal(cancelled.ok, true);

  const reverted = await revertSessionTurn(ctx, { sessionPath: "/sessions/primary.jsonl" });
  assert.equal(reverted.ok, true);
  assert.equal(reverted.branchPath, "/sessions/primary.jsonl");
  assert.equal(reverted.restoredCheckpoints, 2);

  const deferred = await listDeferredTasks(ctx, { sessionPath: "/sessions/primary.jsonl" });
  assert.equal(deferred.ok, true);
  assert.equal(deferred.pending[0].taskId, "deferred-1");

  const deferredOne = await queryDeferredTask(ctx, { taskId: "deferred-1" });
  assert.equal(deferredOne.ok, true);
  assert.equal(deferredOne.task.taskId, "deferred-1");
});

test("agent config, usage, and host checkpoint helpers proxy Hana runtime surfaces", async () => {
  const ctx = makeCtx({
    usageEntries: [
      {
        requestId: "req-1",
        model: { provider: "openai", modelId: "gpt-5-mini" },
        usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
        usageContext: {
          attribution: { agentId: "primary", sessionPath: "/sessions/primary.jsonl" },
          source: { subsystem: "session", operation: "reply" }
        }
      }
    ],
    hostCheckpoints: [
      { checkpointId: "cp-1", sessionPath: "/sessions/primary.jsonl", reason: "before edit", fileCount: 2 }
    ]
  });

  const config = await getAgentConfig(ctx, { agentId: "primary" });
  assert.equal(config.ok, true);
  assert.equal(config.config.model, "gpt-5-mini");
  assert.deepEqual(config.config.skills.enabled, ["review"]);

  const usage = await listUsage(ctx, { sessionPath: "/sessions/primary.jsonl" });
  assert.equal(usage.ok, true);
  assert.equal(usage.summary.totalTokens, 13);
  assert.equal(usage.entries[0].agentId, "primary");

  const checkpoints = await listHostCheckpoints(ctx, { sessionPath: "/sessions/primary.jsonl" });
  assert.equal(checkpoints.ok, true);
  assert.equal(checkpoints.checkpoints[0].checkpointId, "cp-1");

  const found = await findSessionCheckpoints(ctx, { sessionPath: "/sessions/primary.jsonl" });
  assert.equal(found.ok, true);
  assert.equal(found.checkpoints.length, 1);

  const restored = await restoreHostCheckpoint(ctx, { checkpointId: "cp-1" });
  assert.equal(restored.ok, true);
  assert.equal(restored.restoredTo, "/tmp/cp-1.js");
});

test("agent profile overrides merge with host config and sync when supported", async () => {
  let updatePayload = null;
  const ctx = makeCtx({
    onUpdateAgentConfig(payload) {
      updatePayload = payload;
      return { ok: true, config: payload.partial };
    }
  });

  const updated = await updateAgentConfig(ctx, {
    agentId: "primary",
    partial: {
      name: "Builder Primary",
      model: "gpt-5",
      memory: { enabled: false, userProfileEnabled: false },
      agent: { maxTurns: 250, gatewayTimeout: 3, toolUseEnforcement: "required" },
      skills: { enabled: ["build", "review"] }
    }
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.host.ok, true);
  assert.equal(updatePayload.agentId, "primary");
  assert.equal(updatePayload.partial.model, "gpt-5");
  assert.equal(updatePayload.partial.agent.maxTurns, 100);
  assert.equal(updatePayload.partial.agent.gatewayTimeout, 10);
  assert.equal(updatePayload.partial.agent.toolUseEnforcement, "required");

  const config = await getAgentConfig(ctx, { agentId: "primary" });
  assert.equal(config.ok, true);
  assert.equal(config.config.name, "Builder Primary");
  assert.equal(config.config.model, "gpt-5");
  assert.equal(config.config.memory.enabled, false);
  assert.equal(config.config.memory.userProfileEnabled, false);
  assert.equal(config.config.agent.maxTurns, 100);
  assert.equal(config.config.agent.gatewayTimeout, 10);
  assert.equal(config.config.agent.toolUseEnforcement, "required");
  assert.deepEqual(config.config.skills.enabled, ["build", "review"]);
  assert.equal(config.profile.agentId, "primary");

  const profiles = listAgentProfileOverrides(ctx);
  assert.equal(profiles.ok, true);
  assert.equal(profiles.profiles[0].agentId, "primary");
});

test("terminal helpers call host-managed terminal bus capabilities", async () => {
  const ctx = makeCtx();
  const listed = await listTerminals(ctx, { sessionPath: "/sessions/primary.jsonl" });
  assert.equal(listed.ok, true);
  assert.equal(listed.terminals[0].terminalId, "term_1");

  const started = await startTerminal(ctx, { sessionPath: "/sessions/primary.jsonl", cwd: "/tmp/project" });
  assert.equal(started.ok, true);
  assert.equal(started.terminal.terminalId, "term_1");

  const read = await readTerminal(ctx, { sessionPath: "/sessions/primary.jsonl", terminalId: "term_1" });
  assert.equal(read.output, "hello");
  assert.equal(read.seq, 1);

  const written = await writeTerminal(ctx, { sessionPath: "/sessions/primary.jsonl", terminalId: "term_1", chars: "pwd\r" });
  assert.equal(written.output, "pwd\r");
  assert.equal(written.seq, 2);

  const closed = await closeTerminal(ctx, { sessionPath: "/sessions/primary.jsonl", terminalId: "term_1" });
  assert.equal(closed.ok, true);
  assert.equal(closed.terminal.status, "killed");
});

test("session history and abort helpers normalize Hana bus results", async () => {
  let aborted = null;
  const ctx = makeCtx({
    history: [
      {
        role: "assistant",
        content: [{ type: "text", text: "STATE: DONE\nCOMMANDS_RUN: npm test\nRESULT: ok\nNEXT_ACTION: none" }],
        tokenCount: "12",
        toolCalls: [{ name: "shell", arguments: { command: "npm test" } }]
      },
      {
        role: "assistant",
        content: [{ type: "tool_use", name: "workspace.write", input: { path: "README.md" } }],
        tokenCount: "5"
      }
    ],
    onAbort(payload) {
      aborted = payload.sessionPath;
      return { accepted: true };
    }
  });

  const history = await getSessionHistory(ctx, { sessionPath: "/sessions/primary.jsonl", limit: 10 });
  assert.equal(history.ok, true);
  assert.equal(history.messages.length, 2);
  assert.equal(history.messages[0].tokenCount, 12);
  assert.match(history.messages[0].text, /STATE: DONE/);
  assert.equal(history.messages[1].text, "");
  assert.equal(history.toolTrace.summary.tool, 2);
  assert.equal(history.toolTrace.summary.command, 1);
  assert.equal(history.toolTrace.summary.checkpoint, 1);
  assert.equal(history.toolTrace.items.some((item) => item.title === "workspace.write"), true);

  const abort = await abortSession(ctx, { sessionPath: "/sessions/primary.jsonl" });
  assert.equal(abort.ok, true);
  assert.equal(aborted, "/sessions/primary.jsonl");
});

test("session fork builds continuation prompt and can dispatch to a new session", async () => {
  const sent = [];
  const ctx = makeCtx({
    sessions: [{ path: "/sessions/primary.jsonl", title: "Primary Session", agentId: "primary", cwd: "/tmp/project" }],
    history: [
      { role: "user", content: "Build the HanaAgent plugin" },
      {
        role: "assistant",
        content: "STATE: DONE\nRESULT: tests passed\nNEXT_ACTION: continue Hermes parity"
      }
    ],
    onSend(payload) {
      sent.push(payload);
      return { accepted: true };
    }
  });

  const prompt = buildSessionForkPrompt({
    sourceSessionPath: "/sessions/primary.jsonl",
    sourceTitle: "Primary Session",
    instructions: "继续完善 fork",
    messages: [{ role: "user", text: "hello" }]
  });
  assert.equal(prompt.ok, true);
  assert.match(prompt.prompt, /fork session/);
  assert.match(prompt.prompt, /继续完善 fork/);

  const result = await forkSession(ctx, {
    sessionPath: "/sessions/primary.jsonl",
    agentId: "primary",
    instructions: "继续完善 fork",
    maxMessages: 8
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "created-and-dispatched");
  assert.equal(result.session.path, "/sessions/new-worker.jsonl");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].sessionPath, "/sessions/new-worker.jsonl");
  assert.match(sent[0].text, /原会话标题：Primary Session/);
  assert.match(sent[0].text, /Build the HanaAgent plugin/);
});

test("session fork returns prompt-only payload without creating a session", async () => {
  const ctx = makeCtx({
    history: [{ role: "user", content: "Need a manual fork" }]
  });
  const result = await forkSession(ctx, {
    sessionPath: "/sessions/primary.jsonl",
    create: false
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "prompt-only");
  assert.equal(result.session, null);
  assert.match(result.forkPrompt.prompt, /Need a manual fork/);
});

test("context usage estimates session context from history and usage ledger", async () => {
  const ctx = makeCtx({
    history: [
      { role: "user", content: "a".repeat(400) },
      { role: "assistant", content: "STATE: DONE", tokenCount: 120 }
    ],
    usageEntries: [
      { requestId: "req-1", sessionPath: "/sessions/primary.jsonl", promptTokens: 500, completionTokens: 50 }
    ]
  });
  const result = await getContextUsage(ctx, {
    sessionPath: "/sessions/primary.jsonl",
    modelId: "gpt-5-mini",
    modelMetadata: [{ model: "gpt-5-mini", contextWindow: 2000 }],
    historyLimit: 20
  });
  assert.equal(result.ok, true);
  assert.equal(result.context.usedTokens, 500);
  assert.equal(result.context.maxContextTokens, 2000);
  assert.equal(result.context.percent, 25);
  assert.equal(result.context.status, "ok");
  assert.equal(result.context.messageCount, 2);
  assert.equal(result.context.messagesWithTokenCount, 1);
  assert.equal(result.context.estimatedFromCharacters, 100);
});

test("dispatchMission sends a structured prompt to an existing session", async () => {
  let sentPayload = null;
  const ctx = makeCtx({
    onSend(payload) {
      sentPayload = payload;
      return { accepted: true };
    }
  });

  const result = await dispatchMission(ctx, {
    sessionPath: "/sessions/primary.jsonl",
    templateId: "build",
    mode: "plan",
    mission: "做一个 hanaagent 插件",
    notes: "参考 Hermes Workspace"
  });

  assert.equal(result.ok, true);
  assert.equal(result.accepted, true);
  assert.equal(sentPayload.sessionPath, "/sessions/primary.jsonl");
  assert.match(sentPayload.text, /Hanaco 构建智能体/);
  assert.match(sentPayload.text, /工作台模式：计划/);
  assert.match(sentPayload.text, /参考 Hermes Workspace/);
  assert.match(sentPayload.text, /Checkpoint 合约/);
});

test("sendSessionMessage sends direct live worker chat messages", async () => {
  let sent = null;
  const ctx = makeCtx({
    onSend(payload) {
      sent = payload;
      return { accepted: true, sessionPath: payload.sessionPath };
    }
  });
  const result = await sendSessionMessage(ctx, {
    sessionPath: "/sessions/primary.jsonl",
    text: "please continue this lane"
  });
  assert.equal(result.ok, true);
  assert.equal(result.sessionPath, "/sessions/primary.jsonl");
  assert.deepEqual(sent, { sessionPath: "/sessions/primary.jsonl", text: "please continue this lane" });
});

test("dispatchMission reports actionable validation errors", async () => {
  const ctx = makeCtx();
  assert.deepEqual(await dispatchMission(ctx, { mission: "x" }), {
    ok: false,
    error: "sessionPath_required",
    prompt: buildMissionPrompt({
      mission: "x",
      notes: "",
      template: getTemplates()[0],
      mode: "dispatch"
    })
  });

  const missingMission = await dispatchMission(ctx, { sessionPath: "/sessions/primary.jsonl" });
  assert.equal(missingMission.ok, false);
  assert.equal(missingMission.error, "mission_required");
});
