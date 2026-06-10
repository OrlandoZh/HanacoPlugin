import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Hono } from "../../../reference/openhanako-main/node_modules/hono/dist/index.js";
import registerHanaAgentRoutes from "../routes/workbench.js";

function makeApp(options = {}) {
  const app = new Hono();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-routes-"));
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-workspace-"));
  fs.writeFileSync(path.join(workspaceRoot, "hello.md"), "# Hello workspace\n\nCommand search fixture\n", "utf8");
  const disabledBusTypes = new Set(options.disabledBusTypes || []);
  const ctx = {
    pluginId: "hanaagent",
    dataDir,
    config: {
      values: {
        workspaceRoots: [{ id: "test-workspace", label: "Test Workspace", path: workspaceRoot, writable: true }]
      },
      getAll() {
        return this.values;
      },
      setMany(next) {
        Object.assign(this.values, next);
      }
    },
    bus: {
      aborts: [],
      sends: [],
      taskRequests: [],
      registeredTasks: [],
      subscribers: [],
      hasHandler(type) {
        return !disabledBusTypes.has(type);
      },
      subscribe(callback, filter = {}) {
        const entry = { callback, filter };
        this.subscribers.push(entry);
        return () => {
          const index = this.subscribers.indexOf(entry);
          if (index !== -1) this.subscribers.splice(index, 1);
        };
      },
      emit(event, sessionPath) {
        for (const entry of this.subscribers) {
          if (entry.filter?.sessionPath && entry.filter.sessionPath !== sessionPath) continue;
          if (entry.filter?.types && !entry.filter.types.includes(event.type)) continue;
          entry.callback(event, sessionPath);
        }
      },
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
          { type: "terminal:close", available: true },
          { type: "mcp:settings-action", available: true }
        ].map((capability) => disabledBusTypes.has(capability.type) ? { ...capability, available: false } : capability);
      },
      async request(type, payload) {
        if (disabledBusTypes.has(type)) throw new Error(`No handler registered for "${type}"`);
        if (type === "agent:list") return { agents: [{ id: "primary", name: "Primary", isPrimary: true }] };
        if (type === "session:list") return { sessions: [{ path: "/sessions/primary.jsonl", title: "Primary Session", agentId: payload?.agentId || "primary" }] };
        if (type === "session:create") {
          const suffix = payload?.assignmentId ? payload.assignmentId.replace(/[^a-z0-9]+/gi, "-").slice(-18) : "new-worker";
          return { path: `/sessions/${suffix}.jsonl`, title: payload.title || "Worker", agentId: payload.agentId, cwd: payload.cwd };
        }
        if (type === "session:status") return { state: "running", busy: true, lastSeen: "2026-01-01T00:00:00.000Z" };
        if (type === "session:send") {
          this.sends.push(payload);
          return { accepted: true, sessionPath: payload.sessionPath };
        }
        if (type === "session:history") {
          if (Array.isArray(options.sessionHistoryMessages)) return { messages: options.sessionHistoryMessages };
          return {
            messages: [
              { role: "user", content: "please work", createdAt: "2026-01-01T00:00:00.000Z" },
              {
                id: "assistant-tool-message",
                role: "assistant",
                content: [
                  "STATE: DONE",
                  "FILES_CHANGED: plugins/hanaagent/routes/workbench.js",
                  "COMMANDS_RUN: npm test",
                  "RESULT: session history synced",
                  "BLOCKER: none",
                  "NEXT_ACTION: review"
                ].join("\n"),
                createdAt: "2026-01-01T00:01:00.000Z",
                tokenCount: 88,
                toolCalls: [{ name: "shell", arguments: { command: "npm test" }, status: "ok" }]
              }
            ]
          };
        }
        if (type === "session:abort") {
          this.aborts.push(payload.sessionPath);
          return { accepted: true, sessionPath: payload.sessionPath };
        }
        if (type === "session:revert-turn") return { ok: true, sessionPath: payload.sessionPath, branchPath: payload.path || payload.sessionPath, restoredCheckpoints: 2 };
        if (type === "agent:config") {
          return { config: options.agentConfig?.[payload.agentId] || { name: "Primary", models: { chat: "gpt-5-mini" }, memory: { enabled: true }, skills: { enabled: ["review"] } } };
        }
        if (type === "agent:update-config") return { ok: true, config: payload.partial };
        if (type === "agent:skills") return { skills: [{ id: "review", name: "Review", description: "Check work" }] };
        if (type === "mcp:settings-action") return { settingsUpdate: { status: "applied", action: payload.action } };
        if (type === "memory:list") return { entries: [{ id: "mem-1", title: "Project note", summary: "Use plugin APIs", content: "memory body", agentId: payload?.agentId || "primary" }] };
        if (type === "memory:read") return { entry: { id: payload.memoryId, title: "Project note", content: "memory body" } };
        if (type === "usage:list") {
          const entries = Array.isArray(options.usageEntries)
            ? options.usageEntries
            : [
                {
                  requestId: "req-1",
                  model: { provider: "openai", modelId: "gpt-5-mini" },
                  usage: { prompt_tokens: 10, completion_tokens: 5 },
                  usageContext: {
                    attribution: { agentId: "primary", sessionPath: "/sessions/primary.jsonl" },
                    source: { subsystem: "session", operation: "reply" }
                  }
                }
              ];
          return {
            entries,
            nextCursor: null
          };
        }
        if (type === "checkpoint:list") return { checkpoints: [{ checkpointId: "cp-1", label: "Before edit", sessionPath: "/sessions/primary.jsonl", fileCount: 2 }] };
        if (type === "checkpoint:find-by-session-since") return { checkpoints: [{ checkpointId: "cp-1", label: "Before edit", sessionPath: payload.sessionPath, fileCount: 2 }] };
        if (type === "checkpoint:restore") return { ok: true, restoredTo: `/tmp/${payload.id || payload.checkpointId}.js` };
        if (type === "task:list") return [{ taskId: "job-1", type: "hanaagent-mission", status: "running", pluginId: "hanaagent" }, ...this.registeredTasks];
        if (type === "task:query") return { taskId: payload.taskId, type: "hanaagent-mission", status: "running", pluginId: "hanaagent" };
        if (type === "task:register") {
          this.taskRequests.push({ type, payload });
          const task = { taskId: payload.taskId, type: payload.type, status: "running", pluginId: payload.pluginId, parentSessionPath: payload.parentSessionPath, agentId: payload.agentId, meta: payload.meta || {} };
          this.registeredTasks.push(task);
          return { ok: true, task };
        }
        if (type === "task:update") {
          this.taskRequests.push({ type, payload });
          return { ok: true, task: { taskId: payload.taskId, status: payload.status || "running", progress: payload.progress } };
        }
        if (type === "task:complete") {
          this.taskRequests.push({ type, payload });
          return { ok: true, task: { taskId: payload.taskId, status: "done", result: payload.result } };
        }
        if (type === "task:cancel") {
          this.taskRequests.push({ type, payload });
          return { ok: true, canceled: true, taskId: payload.taskId };
        }
        if (type === "task:remove") return { ok: true };
        if (type === "deferred:list-pending") return [{ taskId: "deferred-1", sessionPath: payload?.sessionPath || "/sessions/primary.jsonl", status: "pending" }];
        if (type === "deferred:query") return { taskId: payload.taskId, sessionPath: "/sessions/primary.jsonl", status: "pending" };
        if (type === "terminal:list") return { sessionPath: payload.sessionPath, terminals: [{ terminalId: "term_1", status: "running", seq: 0 }] };
        if (type === "terminal:start") return { terminalId: "term_1", sessionPath: payload.sessionPath, status: "running", seq: 0 };
        if (type === "terminal:read") return { terminalId: payload.terminalId, sessionPath: payload.sessionPath, seq: 1, output: "terminal output" };
        if (type === "terminal:write") return { terminalId: payload.terminalId, sessionPath: payload.sessionPath, seq: 2, output: payload.chars };
        if (type === "terminal:close") return { terminalId: payload.terminalId, sessionPath: payload.sessionPath, status: "killed" };
        throw new Error(`unexpected bus request: ${type}`);
      }
    },
    _mcpRuntime: {
      getState() {
        return {
          enabled: true,
          connectors: [{ id: "local-files", name: "Local Files", status: "running", transport: "stdio", tools: [{ name: "read_file" }], authStatus: "none" }],
          agentConfig: {}
        };
      }
    },
    stageFile({ sessionPath, filePath, label }) {
      return {
        file: {
          id: "sf_" + path.basename(filePath).replace(/[^a-z0-9]+/gi, "_"),
          sessionPath,
          filePath,
          label,
          mime: "text/markdown; charset=utf-8",
          status: "available"
        },
        mediaItem: {
          type: "session_file",
          fileId: "sf_" + path.basename(filePath).replace(/[^a-z0-9]+/gi, "_"),
          sessionPath,
          filePath,
          label
        }
      };
    },
    async registerHtmlPreview(payload) {
      return {
        id: "pv_artifact",
        previewUrl: `http://127.0.0.1:60626/preview/html/pv_artifact?previewToken=test&title=${encodeURIComponent(payload.title || "")}`,
        expiresAt: 123456
      };
    }
  };
  registerHanaAgentRoutes(app, ctx);
  return { app, dataDir, workspaceRoot, ctx };
}

test("workbench route exposes overview sections and rendered roadmap", async () => {
  const { app } = makeApp();

  const page = await app.request("/workbench");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Hanaco 智能体工作台/);
  assert.match(html, /Conductor 指挥台/);
  assert.match(html, /officeView/);
  assert.match(html, /swarm-hub-card/);
  assert.match(html, /swarm-hub-main/);
  assert.match(html, /swarm-hub-avatar/);
  assert.match(html, /swarm-hub-metrics/);
  assert.match(html, /swarm-hub-wires/);
  assert.match(html, /swarmHubRouteBtn/);
  assert.match(html, /swarmHubAutopilotBtn/);
  assert.match(html, /swarmHubInboxBtn/);
  assert.match(html, /renderSwarmHubCard/);
  assert.match(html, /bindSwarmHubActions/);
  assert.match(html, /Recent Swarm Activity/);
  assert.match(html, /swarmActivityPanel/);
  assert.match(html, /loadSwarmActivity/);
  assert.match(html, /copySwarmActivitySummary/);
  assert.match(html, /swarmActivity/);
  assert.match(html, /api\/swarm-activity/);
  assert.match(html, /Worker Artifacts/);
  assert.match(html, /workerArtifactsPanel/);
  assert.match(html, /loadWorkerArtifacts/);
  assert.match(html, /copyWorkerArtifactsSummary/);
  assert.match(html, /api\/worker-artifacts/);
  assert.match(html, /Approvals/);
  assert.match(html, /approvalsPanel/);
  assert.match(html, /loadApprovals/);
  assert.match(html, /copyApprovalsSummary/);
  assert.match(html, /api\/approvals/);
  assert.match(html, /roadmapList/);
  assert.match(html, /swarmLaunchBtn/);
  assert.match(html, /continueMissionBtn/);
  assert.match(html, /loadReportBtn/);
  assert.match(html, /recordReportArtifactBtn/);
  assert.match(html, /recordMissionReportArtifact/);
  assert.match(html, /report-artifact/);
  assert.match(html, /terminalStartBtn/);
  assert.match(html, /terminalAutoBtn/);
  assert.match(html, /terminalStatus/);
  assert.match(html, /terminalFrame/);
  assert.match(html, /terminal-screen/);
  assert.match(html, /terminalTitle/);
  assert.match(html, /terminalSeqBadge/);
  assert.match(html, /terminalPwdBtn/);
  assert.match(html, /terminalGitStatusBtn/);
  assert.match(html, /terminalClearBtn/);
  assert.match(html, /terminalCopyBtn/);
  assert.match(html, /terminalOutput/);
  assert.match(html, /renderAnsiTerminalOutput/);
  assert.match(html, /rememberTerminalCommand/);
  assert.match(html, /recallTerminalCommand/);
  assert.match(html, /queueTerminalCommand/);
  assert.match(html, /revertSessionTurnBtn/);
  assert.match(html, /connectEventsBtn/);
  assert.match(html, /liveEventList/);
  assert.match(html, /EventSource/);
  assert.match(html, /toolTracePanel/);
  assert.match(html, /copyToolTraceBtn/);
  assert.match(html, /loadAgentConfigBtn/);
  assert.match(html, /agentProfileUserProfileSelect/);
  assert.match(html, /agentProfileMaxTurnsInput/);
  assert.match(html, /agentProfileGatewayTimeoutInput/);
  assert.match(html, /agentProfileToolUseSelect/);
  assert.match(html, /clampInteger/);
  assert.match(html, /loadAgentSkillsBtn/);
  assert.match(html, /loadIntegrationsBtn/);
  assert.match(html, /integrationSearchInput/);
  assert.match(html, /integrationKindSelect/);
  assert.match(html, /runIntegrationAction/);
  assert.match(html, /integration-action/);
  assert.match(html, /integrationCatalogPanel/);
  assert.match(html, /globalSearchInput/);
  assert.match(html, /globalSearchPanel/);
  assert.match(html, /runGlobalSearch/);
  assert.match(html, /openSearchResult/);
  assert.match(html, /commandPaletteBackdrop/);
  assert.match(html, /commandPaletteInput/);
  assert.match(html, /commandPaletteCommands/);
  assert.match(html, /openCommandPalette/);
  assert.match(html, /executeCommandPaletteCommand/);
  assert.match(html, /Run Autopilot Tick/);
  assert.match(html, /workbenchThemePresetSelect/);
  assert.match(html, /workbenchThemePresets/);
  assert.match(html, /claude-official-light/);
  assert.match(html, /applyThemePresetSelection/);
  assert.match(html, /toastStack/);
  assert.match(html, /pushToast/);
  assert.match(html, /renderToasts/);
  assert.match(html, /model.*模型建议已生成/);
  assert.match(html, /modelChooserBackdrop/);
  assert.match(html, /modelChooserSearchInput/);
  assert.match(html, /openModelChooser/);
  assert.match(html, /setup-repair/);
  assert.match(html, /runSetupDoctorRepair/);
  assert.match(html, /buildModelChooserCandidates/);
  assert.match(html, /applyModelChoice/);
  assert.match(html, /pinModelChoice/);
  assert.match(html, /message-preview/);
  assert.match(html, /chat-empty-state/);
  assert.match(html, /workerOutputScrollBtn/);
  assert.match(html, /scrollWorkerOutputToBottom/);
  assert.match(html, /updateWorkerOutputScrollButton/);
  assert.match(html, /streaming-indicator/);
  assert.match(html, /streaming-cursor/);
  assert.match(html, /streaming-skeleton/);
  assert.match(html, /smoothStreamTick/);
  assert.match(html, /appendSmoothStreamDelta/);
  assert.match(html, /flushSmoothLiveStream/);
  assert.match(html, /renderSafeMarkdown/);
  assert.match(html, /renderCodeBlock/);
  assert.match(html, /message-thinking/);
  assert.match(html, /message-pill/);
  assert.match(html, /message-tool-detail/);
  assert.match(html, /renderMessageToolDetails/);
  assert.match(html, /formatTraceDetail/);
  assert.match(html, /checkpointReminders/);
  assert.match(html, /setCheckpointReminder/);
  assert.match(html, /notifyDueCheckpointReminders/);
  assert.match(html, /setWorkerOutputMessage/);
  assert.match(html, /researchCardPanel/);
  assert.match(html, /buildResearchCard/);
  assert.match(html, /researchCardMarkdown/);
  assert.match(html, /saveResearchCardToMemory/);
  assert.match(html, /recordResearchCardArtifact/);
  assert.match(html, /inspectorPanel/);
  assert.match(html, /renderInspectorPanel/);
  assert.match(html, /inspector-summary/);
  assert.match(html, /inspector-tabs/);
  assert.match(html, /inspector-tab/);
  assert.match(html, /inspectorCollapseBtn/);
  assert.match(html, /toggleInspectorCollapsed/);
  assert.match(html, /Session Activity/);
  assert.match(html, /Context Usage/);
  assert.match(html, /Recent Tool Trace/);
  assert.match(html, /Memory \/ Skills/);
  assert.match(html, /Worker \/ Assignment/);
  assert.match(html, /mobilePageHeader/);
  assert.match(html, /mobileSessionsDrawer/);
  assert.match(html, /mobile-sessions-panel/);
  assert.match(html, /mobileSessionsBtn/);
  assert.match(html, /renderMobileSessionsPanel/);
  assert.match(html, /openMobileSessionsPanel/);
  assert.match(html, /selectMobileSession/);
  assert.match(html, /mobileTabBar/);
  assert.match(html, /mobileSectionConductor/);
  assert.match(html, /jumpToMobileSection/);
  assert.match(html, /handleMobileNavScroll/);
  assert.match(html, /applyHermesPageAlias/);
  assert.match(html, /resolveHermesAliasSessionPath/);
  assert.match(html, /loadSessionHistory\(\)\.catch/);
  assert.match(html, /connectionBanner/);
  assert.match(html, /renderConnectionBanner/);
  assert.match(html, /Runtime degraded mode/);
  assert.match(html, /shortcutHelpBtn/);
  assert.match(html, /shortcutHelpBackdrop/);
  assert.match(html, /keyboardShortcuts/);
  assert.match(html, /openShortcutHelp/);
  assert.match(html, /onboardingTourBtn/);
  assert.match(html, /onboardingBackdrop/);
  assert.match(html, /onboardingSteps/);
  assert.match(html, /openOnboardingTour/);
  assert.match(html, /completeOnboardingTour/);
  assert.match(html, /maybeOpenOnboardingTour/);
  assert.match(html, /⌘\/ 或 \?/);
  assert.match(html, /sessionSearchInput/);
  assert.match(html, /filterSessionsForSidebar/);
  assert.match(html, /Session Search/);
  assert.match(html, /slashCommandPanel/);
  assert.match(html, /slashCommands/);
  assert.match(html, /handleSlashCommandKeydown/);
  assert.match(html, /executeSlashCommand/);
  assert.equal(html.includes("/model"), true);
  assert.equal(html.includes("/skills"), true);
  assert.match(html, /voiceInputBtn/);
  assert.match(html, /voiceInputStatus/);
  assert.match(html, /toggleVoiceInput/);
  assert.match(html, /SpeechRecognition/);
  assert.match(html, /attachMissionFilesBtn/);
  assert.match(html, /missionAttachmentInput/);
  assert.match(html, /missionAttachmentList/);
  assert.match(html, /readMissionAttachmentsFromInput/);
  assert.match(html, /missionAttachmentContext/);
  assert.match(html, /workerDrilldownPanel/);
  assert.match(html, /Worker IDE/);
  assert.match(html, /worker-ide-shell/);
  assert.match(html, /worker-ide-hub/);
  assert.match(html, /worker-ide-tabs/);
  assert.match(html, /worker-ide-tab/);
  assert.match(html, /worker-ide-pane/);
  assert.match(html, /worker-lane-map/);
  assert.match(html, /worker-chat-feed/);
  assert.match(html, /worker-queue-list/);
  assert.match(html, /worker-evidence-grid/);
  assert.match(html, /worker-visual-picker/);
  assert.match(html, /worker-preview-selector/);
  assert.match(html, /worker-preview-issue/);
  assert.match(html, /worker-preview-fix-task/);
  assert.match(html, /createPreviewFixTask/);
  assert.match(html, /Project Metadata/);
  assert.match(html, /Dev Scripts/);
  assert.match(html, /renderWorkerIdePane/);
  assert.match(html, /renderWorkerChatPane/);
  assert.match(html, /renderWorkerEvidencePane/);
  assert.match(html, /worker-ide-grid/);
  assert.match(html, /quick-actions/);
  assert.match(html, /loadWorkerDrilldown/);
  assert.match(html, /runWorkerQuickAction/);
  assert.match(html, /openPreviewUrl/);
  assert.match(html, /missionInboxPanel/);
  assert.match(html, /loadMissionInboxBtn/);
  assert.match(html, /copyMissionInboxBtn/);
  assert.match(html, /taskSearchInput/);
  assert.match(html, /taskAssigneeFilter/);
  assert.match(html, /taskPriorityFilter/);
  assert.match(html, /filterBoardTasks/);
  assert.match(html, /updateTaskFilters/);
  assert.match(html, /handleTaskDrop/);
  assert.match(html, /bulkMoveLaneSelect/);
  assert.match(html, /applyTaskBatch/);
  assert.match(html, /boardViewSelect/);
  assert.match(html, /saveBoardView/);
  assert.match(html, /editWipLimitsBtn/);
  assert.match(html, /boardWipLimits/);
  assert.match(html, /laneWipState/);
  assert.match(html, /handleBoardKeyboard/);
  assert.match(html, /focusedTaskId/);
  assert.match(html, /taskEditorBackdrop/);
  assert.match(html, /openTaskEditor/);
  assert.match(html, /saveTaskEditor/);
  assert.match(html, /workspaceRootSelect/);
  assert.match(html, /workspaceFileList/);
  assert.match(html, /workspaceEditor/);
  assert.match(html, /uploadWorkspaceFileBtn/);
  assert.match(html, /workspaceUploadInput/);
  assert.match(html, /uploadWorkspaceFileFromInput/);
  assert.match(html, /newWorkspaceFileBtn/);
  assert.match(html, /mkdirWorkspaceBtn/);
  assert.match(html, /renameWorkspaceBtn/);
  assert.match(html, /deleteWorkspaceBtn/);
  assert.match(html, /diffWorkspaceFileBtn/);
  assert.match(html, /diffWorkspaceFile/);
  assert.match(html, /downloadWorkspaceFileBtn/);
  assert.match(html, /downloadWorkspaceFile/);
  assert.match(html, /exportSessionMarkdownBtn/);
  assert.match(html, /exportSessionJsonBtn/);
  assert.match(html, /exportSessionTextBtn/);
  assert.match(html, /exportSessionHtmlBtn/);
  assert.match(html, /exportSessionCsvBtn/);
  assert.match(html, /exportSession/);
  assert.match(html, /suggestSessionTitleBtn/);
  assert.match(html, /sessionTitlePanel/);
  assert.match(html, /suggestSessionTitle/);
  assert.match(html, /renameSessionAliasBtn/);
  assert.match(html, /clearSessionAliasBtn/);
  assert.match(html, /renameCurrentSessionAlias/);
  assert.match(html, /forkSessionBtn/);
  assert.match(html, /forkCurrentSession/);
  assert.match(html, /hideSessionBtn/);
  assert.match(html, /sessionTombstonePanel/);
  assert.match(html, /hideCurrentSession/);
  assert.match(html, /restoreSessionTombstone/);
  assert.match(html, /pinSessionBtn/);
  assert.match(html, /pinModelBtn/);
  assert.match(html, /exportPinnedSessionsBtn/);
  assert.match(html, /exportPinnedSessions/);
  assert.match(html, /exportSessionZipBtn/);
  assert.match(html, /pinnedPanel/);
  assert.match(html, /selectPinnedSession/);
  assert.match(html, /setPinnedSessionDefault/);
  assert.match(html, /removePinnedSession/);
  assert.match(html, /movePinnedSession/);
  assert.match(html, /applyPinnedModel/);
  assert.match(html, /removePinnedModel/);
  assert.match(html, /movePinnedModel/);
  assert.match(html, /movePinnedItem/);
  assert.match(html, /pinned-draggable/);
  assert.match(html, /handlePinnedDrop/);
  assert.match(html, /reorderPinnedItems/);
  assert.match(html, /workbenchModeSelect/);
  assert.match(html, /workbenchModePanel/);
  assert.match(html, /saveCurrentWorkbenchMode/);
  assert.match(html, /applySelectedWorkbenchMode/);
  assert.match(html, /workbenchModeDrift/);
  assert.match(html, /notificationPanel/);
  assert.match(html, /workbenchNotifications/);
  assert.match(html, /notifyWorkbench/);
  assert.match(html, /playWorkbenchSound/);
  assert.match(html, /navigator\.vibrate/);
  assert.match(html, /workbenchSettingsPanel/);
  assert.match(html, /workbenchSettings/);
  assert.match(html, /applyWorkbenchSettings/);
  assert.match(html, /saveWorkbenchSettings/);
  assert.match(html, /usageThresholdInput/);
  assert.match(html, /systemMetricsFooter/);
  assert.match(html, /providerSetupPanel/);
  assert.match(html, /refreshProviderSetupBtn/);
  assert.match(html, /openProviderModelChooserBtn/);
  assert.match(html, /copyProviderSetupBtn/);
  assert.match(html, /reprobeProviderSetupBtn/);
  assert.match(html, /renderProviderSetupPanel/);
  assert.match(html, /loadProviderSetup/);
  assert.match(html, /Provider Setup/);
  assert.match(html, /suggestModelBtn/);
  assert.match(html, /modelSuggestionPanel/);
  assert.match(html, /renderUsageAttributionRows/);
  assert.match(html, /saveWorkspaceFileBtn/);
  assert.match(html, /loadMemoryBtn/);
  assert.match(html, /saveMemoryBtn/);
  assert.match(html, /deleteMemoryBtn/);
  assert.match(html, /memoryEditor/);
  assert.match(html, /memoryTabMemoryBtn/);
  assert.match(html, /memoryTabKnowledgeBtn/);
  assert.match(html, /knowledgeBrowserPane/);
  assert.match(html, /knowledgePanel/);
  assert.match(html, /knowledgeGraphPanel/);
  assert.match(html, /loadKnowledgeBtn/);
  assert.match(html, /graphKnowledgeBtn/);
  assert.match(html, /loadKnowledgePages/);
  assert.match(html, /searchKnowledgePages/);
  assert.match(html, /readKnowledgePage/);
  assert.match(html, /loadKnowledgeGraph/);
  assert.match(html, /Knowledge Browser/);
  assert.match(html, /addArtifactBtn/);
  assert.match(html, /addApprovalBtn/);
  assert.match(html, /addLearningBtn/);
  assert.match(html, /loadRunRecordsBtn/);
  assert.match(html, /brief-artifact/);
  assert.match(html, /recordAssignmentBriefArtifact/);
  assert.match(html, /materializeRunArtifact/);
  assert.match(html, /previewRunArtifact/);
  assert.match(html, /artifact-preview/);
  assert.match(html, /artifactPreviewPanel/);
  assert.match(html, /artifact-preview-frame/);
  assert.match(html, /closeArtifactPreview/);
  assert.match(html, /autopilotPreviewBtn/);
  assert.match(html, /autopilotRunBtn/);
  assert.match(html, /autopilotTickBtn/);
  assert.match(html, /enableAutopilotScheduleBtn/);
  assert.match(html, /autopilotPanel/);
  assert.match(html, /createJobBtn/);
  assert.match(html, /loadJobsBtn/);
  assert.match(html, /jobPanel/);
  assert.match(html, /jobOutputPanel/);
  assert.match(html, /Full Outputs/);
  assert.match(html, /agentOutputsPanel/);
  assert.match(html, /renderAgentOutputsPanel/);
  assert.match(html, /bindAgentOutputFilters/);
  assert.match(html, /api\/agent-outputs/);
  assert.match(html, /Scheduler/);
  assert.match(html, /operationPresetSelect/);
  assert.match(html, /operationProfileSelect/);
  assert.match(html, /saveOperationProfileBtn/);
  assert.match(html, /applyOperationPresetBtn/);
  assert.match(html, /applyOperationProfileBtn/);
  assert.match(html, /operationsPanel/);
  assert.match(html, /setupDoctorPanel/);
  assert.match(html, /reviewGateBtn/);
  assert.match(html, /reviewGatePanel/);
  assert.match(html, /forceCompleteMissionBtn/);
  assert.match(html, /loadUsageBtn/);
  assert.match(html, /loadContextUsageBtn/);
  assert.match(html, /contextUsagePanel/);
  assert.match(html, /loadContextUsage/);
  assert.match(html, /loadHostCheckpointsBtn/);
  assert.match(html, /createSessionBtn/);
  assert.match(html, /loadSessionStatusBtn/);
  assert.match(html, /loadHostTasksBtn/);
  assert.match(html, /registerHostTaskBtn/);
  assert.match(html, /loadDeferredTasksBtn/);

  const overview = await app.request("/api/overview");
  assert.equal(overview.status, 200);
  const data = await overview.json();
  assert.equal(data.capabilities.overview, true);
  assert.equal(data.capabilities.taskStore, true);
  assert.equal(data.capabilities.checkpointInbox, true);
  assert.equal(data.capabilities.workerCards, true);
  assert.equal(data.capabilities.workerDrilldown, true);
  assert.equal(data.capabilities.workerIde, true);
  assert.equal(data.capabilities.missionInbox, true);
  assert.equal(data.capabilities.workspaceFiles, true);
  assert.equal(data.capabilities.conductor, true);
  assert.equal(data.capabilities.missionControls, true);
  assert.equal(data.capabilities.missionPhases, true);
  assert.equal(data.capabilities.sessionHistory, true);
  assert.equal(data.capabilities.liveSessionEvents, true);
  assert.equal(data.capabilities.toolTrace, true);
  assert.equal(data.capabilities.sessionAbort, true);
  assert.equal(data.capabilities.terminal, true);
  assert.equal(data.capabilities.agentProfile, true);
  assert.equal(data.capabilities.agentSkills, true);
  assert.equal(data.capabilities.memoryReadonly, true);
  assert.equal(data.capabilities.memoryEditable, true);
  assert.equal(data.capabilities.integrationCatalog, true);
  assert.equal(data.capabilities.globalSearch, true);
  assert.equal(data.capabilities.runRecords, true);
  assert.equal(data.capabilities.autopilot, true);
  assert.equal(data.capabilities.autopilotScheduler, true);
  assert.equal(data.capabilities.jobs, true);
  assert.equal(data.capabilities.operationsProfiles, true);
  assert.equal(data.capabilities.reviewGate, true);
  assert.equal(data.capabilities.usageLedger, true);
  assert.equal(data.capabilities.hostCheckpoints, true);
  assert.equal(data.capabilities.hostTaskRuntime, true);
  assert.equal(data.capabilities.deferredTaskRuntime, true);
  assert.equal(data.overview.sections.agents.total, 1);
  assert.equal(data.overview.sections.sessions.total, 1);
  assert.equal(data.overview.sections.tasks.total, 0);
  assert.equal(data.overview.sections.checkpoints.total, 0);
  assert.equal(data.overview.sections.missions.total, 0);
  assert.equal(data.overview.sections.workers.total, 1);
  assert.equal(data.overview.sections.usage.summary.totalTokens, 15);
  assert.equal(data.overview.sections.hostCheckpoints.total, 1);
  assert.equal(data.overview.sections.agentProfiles.total, 1);
  assert.equal(data.overview.sections.agentSkills.total, 1);
  assert.equal(data.overview.sections.memory.total, 1);
  assert.equal(data.overview.sections.integrations.ok, true);
  assert.equal(data.overview.sections.integrations.items.some((item) => item.id === "mcp:local-files"), true);
  assert.equal(data.overview.sections.runRecords.total, 0);
  assert.equal(data.overview.sections.workspaceFiles.roots, 2);
  assert.equal(data.overview.sections.inbox.summary.total, 0);
  assert.equal(data.overview.sections.autopilot.total, 0);
  assert.equal(data.overview.sections.autopilot.schedule.enabled, false);
  assert.equal(data.overview.sections.jobs.total, 0);
  assert.equal(data.overview.sections.operations.ok, true);
  assert.equal(data.overview.sections.operations.presets.some((preset) => preset.id === "builder"), true);
  assert.equal(data.overview.sections.setupDoctor.status, "ready");
  assert.equal(data.overview.sections.setupDoctor.summary.blocking, 0);
  assert.equal(data.overview.sections.setupDoctor.checks.some((check) => check.id === "model" && check.status === "pass"), true);
  assert.equal(data.overview.sections.operationProfiles.total >= 5, true);
  assert.equal(data.overview.sections.hostTasks.total, 1);
  assert.equal(data.overview.sections.deferredTasks.total, 1);
  assert.ok(Array.isArray(data.overview.sections.hostGaps));
  assert.equal(data.overview.sections.blueprint.phases.length, 6);
  assert.equal(data.overview.sections.blueprint.parity.summary.completeForPluginScope, true);
  assert.equal(data.overview.sections.blueprint.parity.summary.missing, 0);
});

test("Hermes page route aliases render the OpenHanako workbench", async () => {
  const { app } = makeApp();
  const routes = [
    ["/", "Dashboard"],
    ["/index", "Index"],
    ["/dashboard", "Dashboard"],
    ["/chat", "Chat"],
    ["/chat/primary-session", "Chat Session"],
    ["/conductor", "Conductor"],
    ["/swarm", "Swarm"],
    ["/swarm2", "Swarm2"],
    ["/tasks", "Tasks"],
    ["/files", "Files"],
    ["/terminal", "Terminal"],
    ["/memory", "Memory"],
    ["/skills", "Skills"],
    ["/mcp", "MCP"],
    ["/operations", "Operations"],
    ["/profiles", "Profiles"],
    ["/jobs", "Jobs"],
    ["/settings", "Settings"],
    ["/settings/providers", "Provider Settings"],
    ["/vt-capital", "VT Capital"],
    ["/reserve", "Reserve"],
    ["/reserve/confirm", "Reserve Confirm"],
    ["/early-access", "Early Access"],
    ["/hermes-world", "Hermes World"],
    ["/world", "World"],
    ["/agora", "Agora"],
    ["/playground", "Playground"],
    ["/some-hermes-spa-path", "SPA Fallback"]
  ];

  for (const [route, label] of routes) {
    const res = await app.request(route);
    assert.equal(res.status, 200, route);
    const html = await res.text();
    assert.match(html, /Hanaco 智能体工作台/, route);
    assert.match(html, /Hermes 页面兼容入口/, route);
    assert.match(html, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), route);
    assert.match(html, /data-hermes-route=/, route);
    assert.match(html, /window\.HANAAGENT/, route);
    assert.match(html, /hermesPageAlias/, route);
    if (route === "/settings/providers") {
      assert.match(html, /data-hermes-target="providerSetupPanel"/, route);
      assert.match(html, /Provider Setup/, route);
    }
  }

  const api = await app.request("/api/state");
  assert.equal(api.status, 200);
  assert.match(api.headers.get("content-type") || "", /application\/json/);

  const missingApi = await app.request("/api/does-not-exist");
  assert.equal(missingApi.status, 404);
});

test("setup doctor reports missing model as blocking setup work", async () => {
  const { app } = makeApp({
    agentConfig: {
      primary: { name: "Primary", models: {}, memory: { enabled: false }, skills: { enabled: [] } }
    }
  });
  const res = await app.request("/api/setup-doctor");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.setupDoctor.status, "blocked");
  assert.equal(data.setupDoctor.ok, false);
  const modelCheck = data.setupDoctor.checks.find((check) => check.id === "model");
  assert.equal(modelCheck.status, "fail");
  assert.equal(modelCheck.repair.type, "open-provider-setup");
  assert.equal(modelCheck.repair.fallback.type, "open-model-chooser");
  assert.match(data.setupDoctor.nextAction, /Configure a chat model/);
});

test("defaults route persists pinned sessions and pinned models", async () => {
  const { app } = makeApp();
  let res = await app.request("/api/defaults", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pinnedSessions: [
        { sessionPath: "/sessions/primary.jsonl", title: "Primary", agentId: "primary" },
        { sessionPath: "/sessions/primary.jsonl", title: "Duplicate" },
        { sessionPath: "", title: "ignored" }
      ],
      pinnedModels: [
        { model: "gpt-5-mini", provider: "openai", agentId: "primary" },
        { model: "gpt-5-mini", provider: "openai", agentId: "primary" },
        { model: "", provider: "ignored" }
      ],
      modelMetadata: [
        { model: "gpt-5-mini", provider: "openai", contextWindow: 128000, inputCostPer1M: 0.25, outputCostPer1M: 2 },
        { model: "gpt-5-mini", provider: "openai", contextWindow: 999 },
        { model: "", provider: "ignored" }
      ],
      sessionAliases: [
        { sessionPath: "/sessions/primary.jsonl", title: "Alias Primary" },
        { sessionPath: "/sessions/primary.jsonl", title: "Duplicate Alias" },
        { sessionPath: "", title: "ignored" }
      ],
      sessionTombstones: [
        { sessionPath: "/sessions/hidden.jsonl", title: "Hidden" },
        { sessionPath: "/sessions/hidden.jsonl", title: "Duplicate Hidden" },
        { sessionPath: "", title: "ignored" }
      ],
      savedBoardViews: [
        { id: "mine", title: "Mine", filters: { query: "api", assignee: "primary", priority: "high" } },
        { id: "mine", title: "Duplicate", filters: { query: "ignored" } },
        { id: "", title: "" }
      ],
      workbenchModes: [
        {
          id: "review focus",
          title: "Review Focus",
          description: "Review lane",
          settings: {
            defaultAgentId: "primary",
            defaultSessionPath: "/sessions/primary.jsonl",
            mode: "review",
            workerCount: 2,
            preferredModel: "gpt-5-review",
            preferredBudgetModel: "gpt-5-mini",
            preferredPremiumModel: "gpt-5-pro",
            smartSuggestionsEnabled: true,
            onlySuggestCheaper: true,
            boardViewId: "mine",
            operationProfileId: "reviewer"
          }
        },
        { id: "review focus", title: "Duplicate", settings: { mode: "plan" } },
        { id: "", title: "" }
      ],
      activeWorkbenchModeId: "review-focus",
      workbenchNotifications: {
        enabled: true,
        volume: 1.8,
        browser: true,
        haptics: false
      },
      workbenchSettings: {
        theme: "dark",
        themePreset: "slate",
        accentColor: "purple",
        editorFontSize: 99,
        editorWordWrap: false,
        editorMinimap: true,
        usageThreshold: 120,
        showSystemMetricsFooter: true,
        mobileChatNavMode: "integrated",
        calendarTimezone: "Asia/Shanghai"
      },
      workbenchOnboarding: {
        completed: true,
        dismissed: false,
        lastStep: 99,
        completedAt: "2026-06-09T00:00:00.000Z"
      },
      boardWipLimits: {
        backlog: 0,
        running: 3.8,
        blocked: "2",
        review: 120,
        done: -1,
        extra: 4
      }
    })
  });
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.config.pinnedSessions.length, 1);
  assert.equal(data.config.pinnedSessions[0].sessionPath, "/sessions/primary.jsonl");
  assert.equal(data.config.pinnedModels.length, 1);
  assert.equal(data.config.pinnedModels[0].model, "gpt-5-mini");
  assert.equal(data.config.modelMetadata.length, 1);
  assert.equal(data.config.modelMetadata[0].contextWindow, 128000);
  assert.equal(data.config.modelMetadata[0].inputCostPer1M, 0.25);
  assert.equal(data.config.sessionAliases.length, 1);
  assert.equal(data.config.sessionAliases[0].title, "Alias Primary");
  assert.equal(data.config.sessionTombstones.length, 1);
  assert.equal(data.config.sessionTombstones[0].sessionPath, "/sessions/hidden.jsonl");
  assert.equal(data.config.savedBoardViews.length, 1);
  assert.equal(data.config.savedBoardViews[0].filters.priority, "high");
  assert.equal(data.config.workbenchModes.length, 1);
  assert.equal(data.config.workbenchModes[0].id, "review-focus");
  assert.equal(data.config.workbenchModes[0].settings.mode, "review");
  assert.equal(data.config.workbenchModes[0].settings.workerCount, 2);
  assert.equal(data.config.workbenchModes[0].settings.preferredPremiumModel, "gpt-5-pro");
  assert.equal(data.config.activeWorkbenchModeId, "review-focus");
  assert.deepEqual(data.config.workbenchNotifications, {
    enabled: true,
    volume: 1,
    browser: true,
    haptics: false
  });
  assert.equal(data.config.workbenchSettings.theme, "dark");
  assert.equal(data.config.workbenchSettings.themePreset, "slate");
  assert.equal(data.config.workbenchSettings.accentColor, "purple");
  assert.equal(data.config.workbenchSettings.editorFontSize, 22);
  assert.equal(data.config.workbenchSettings.themePreset, "slate");
  assert.equal(data.config.workbenchSettings.editorWordWrap, false);
  assert.equal(data.config.workbenchSettings.editorMinimap, true);
  assert.equal(data.config.workbenchSettings.usageThreshold, 95);
  assert.equal(data.config.workbenchSettings.showSystemMetricsFooter, true);
  assert.equal(data.config.workbenchSettings.mobileChatNavMode, "integrated");
  assert.equal(data.config.workbenchSettings.calendarTimezone, "Asia/Shanghai");
  assert.equal(data.config.workbenchOnboarding.completed, true);
  assert.equal(data.config.workbenchOnboarding.dismissed, false);
  assert.equal(data.config.workbenchOnboarding.lastStep, 7);
  assert.deepEqual(data.config.boardWipLimits, { running: 3, blocked: 2, review: 99 });

  res = await app.request("/api/state");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.config.pinnedSessions[0].title, "Primary");
  assert.equal(data.config.pinnedModels[0].agentId, "primary");
  assert.equal(data.config.modelMetadata[0].model, "gpt-5-mini");
  assert.equal(data.config.savedBoardViews[0].title, "Mine");
  assert.equal(data.config.workbenchModes[0].title, "Review Focus");
  assert.equal(data.config.activeWorkbenchModeId, "review-focus");
  assert.equal(data.config.workbenchNotifications.volume, 1);
  assert.equal(data.config.workbenchSettings.editorFontSize, 22);
  assert.equal(data.config.workbenchSettings.calendarTimezone, "Asia/Shanghai");
  assert.equal(data.config.workbenchOnboarding.completed, true);
  assert.deepEqual(data.config.boardWipLimits, { running: 3, blocked: 2, review: 99 });
  assert.equal(data.sessions[0].title, "Alias Primary");
  assert.equal(data.sessions[0].originalTitle, "Primary Session");

  res = await app.request("/api/defaults", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workbenchSettings: { calendarTimezone: "Mars/Base" } })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.config.workbenchSettings.calendarTimezone, "local");
});

test("defaults route preserves pinned session and model ordering for quick launcher", async () => {
  const { app } = makeApp();
  let res = await app.request("/api/defaults", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pinnedSessions: [
        { sessionPath: "/sessions/a.jsonl", title: "A", agentId: "primary" },
        { sessionPath: "/sessions/b.jsonl", title: "B", agentId: "primary" },
        { sessionPath: "/sessions/c.jsonl", title: "C", agentId: "primary" }
      ],
      pinnedModels: [
        { model: "fast-model", provider: "local", agentId: "primary" },
        { model: "review-model", provider: "openai", agentId: "reviewer" },
        { model: "research-model", provider: "openrouter", agentId: "" }
      ]
    })
  });
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.deepEqual(data.config.pinnedSessions.map((item) => item.title), ["A", "B", "C"]);
  assert.deepEqual(data.config.pinnedModels.map((item) => item.model), ["fast-model", "review-model", "research-model"]);

  res = await app.request("/api/defaults", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pinnedSessions: [
        data.config.pinnedSessions[1],
        data.config.pinnedSessions[0],
        data.config.pinnedSessions[2]
      ],
      pinnedModels: [
        data.config.pinnedModels[2],
        data.config.pinnedModels[0],
        data.config.pinnedModels[1]
      ]
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.deepEqual(data.config.pinnedSessions.map((item) => item.title), ["B", "A", "C"]);
  assert.deepEqual(data.config.pinnedModels.map((item) => item.model), ["research-model", "fast-model", "review-model"]);

  res = await app.request("/api/state");
  data = await res.json();
  assert.deepEqual(data.config.pinnedSessions.map((item) => item.title), ["B", "A", "C"]);
  assert.deepEqual(data.config.pinnedModels.map((item) => item.model), ["research-model", "fast-model", "review-model"]);
});

test("session tombstone routes hide and restore sessions without deleting host history", async () => {
  const { app } = makeApp();
  let res = await app.request("/api/defaults", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      defaultSessionPath: "/sessions/primary.jsonl",
      pinnedSessions: [{ sessionPath: "/sessions/primary.jsonl", title: "Primary", agentId: "primary" }],
      sessionAliases: [{ sessionPath: "/sessions/primary.jsonl", title: "Alias Primary" }]
    })
  });
  assert.equal(res.status, 200);

  res = await app.request("/api/session-tombstones", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionPath: "/sessions/primary.jsonl",
      title: "Primary"
    })
  });
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.tombstone.sessionPath, "/sessions/primary.jsonl");
  assert.equal(data.config.defaultSessionPath, "");
  assert.equal(data.config.pinnedSessions.length, 0);
  assert.equal(data.config.sessionAliases.length, 0);

  res = await app.request("/api/sessions");
  data = await res.json();
  assert.equal(data.sessions.length, 0);

  res = await app.request("/api/session-tombstones", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionPath: "/sessions/primary.jsonl" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.sessionTombstones.length, 0);

  res = await app.request("/api/sessions");
  data = await res.json();
  assert.equal(data.sessions[0].path, "/sessions/primary.jsonl");
});

test("session alias routes provide Hermes-style local session rename overlay", async () => {
  const { app } = makeApp();
  let res = await app.request("/api/session-aliases", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionPath: "/sessions/primary.jsonl",
      title: "Renamed Primary"
    })
  });
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.alias.title, "Renamed Primary");

  res = await app.request("/api/sessions");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.sessions[0].title, "Renamed Primary");
  assert.equal(data.sessions[0].originalTitle, "Primary Session");

  res = await app.request("/api/session-aliases", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionPath: "/sessions/primary.jsonl" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.sessionAliases.length, 0);

  res = await app.request("/api/sessions");
  data = await res.json();
  assert.equal(data.sessions[0].title, "Primary Session");
});

test("model suggestions route uses pinned models and mission profile", async () => {
  const { app } = makeApp();
  let res = await app.request("/api/defaults", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pinnedModels: [
        { model: "gpt-5-mini", provider: "openai", agentId: "primary" },
        { model: "gpt-5", provider: "openai", agentId: "primary" }
      ],
      modelMetadata: [
        { model: "gpt-5-mini", provider: "openai", contextWindow: 128000, inputCostPer1M: 0.25, outputCostPer1M: 2 },
        { model: "gpt-5", provider: "openai", contextWindow: 256000, inputCostPer1M: 1.25, outputCostPer1M: 10 }
      ]
    })
  });
  assert.equal(res.status, 200);

  res = await app.request("/api/model-suggestions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "完整实现插件功能并补测试",
      templateId: "build",
      mode: "dispatch",
      agentId: "primary"
    })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.targetTier, "high-capability");
  assert.equal(data.recommendations[0].model, "gpt-5");
  assert.equal(data.recommendations[0].contextWindow, 256000);
  assert.equal(data.recommendations[0].inputCostPer1M, 1.25);
  assert.match(data.toast, /gpt-5/);

  res = await app.request("/api/models?agentId=primary");
  assert.equal(res.status, 200);
  const models = await res.json();
  assert.equal(models.ok, true);
  assert.equal(models.object, "list");
  assert.equal(models.models.some((model) => model.id === "gpt-5" && model.provider === "openai"), true);
  assert.equal(models.configuredProviders.includes("openai"), true);

  res = await app.request("/api/claude-config");
  assert.equal(res.status, 200);
  const hermesConfig = await res.json();
  assert.equal(hermesConfig.ok, true);
  assert.equal(hermesConfig.mode, "openhanako-plugin");
  assert.equal(hermesConfig.config.modelMetadata.length, 2);

  res = await app.request("/api/claude-config", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config: { pinnedModels: [{ model: "gpt-5.1", provider: "openai" }] } })
  });
  assert.equal(res.status, 200);
  const patchedConfig = await res.json();
  assert.equal(patchedConfig.ok, true);
  assert.equal(patchedConfig.config.pinnedModels[0].model, "gpt-5.1");

  res = await app.request("/api/connection-status");
  assert.equal(res.status, 200);
  const connection = await res.json();
  assert.equal(["connected", "enhanced", "partial", "disconnected"].includes(connection.status), true);
  assert.equal(connection.capabilities.models, true);
  assert.equal(connection.claudeUrl, "openhanako://host");

  res = await app.request("/api/gateway-status");
  assert.equal(res.status, 200);
  const gateway = await res.json();
  assert.equal(gateway.ok, true);
  assert.equal(gateway.mode, "openhanako-plugin");
  assert.equal(gateway.capabilities.config, true);
  assert.equal(gateway.gateway.available, true);
});

test("Hermes infrastructure aliases expose OpenHanako-safe compatibility payloads", async () => {
  const { app, ctx, workspaceRoot } = makeApp();
  ctx.config.setMany({
    modelMetadata: [
      { model: "gpt-5-mini", provider: "openai", contextWindow: 128000 }
    ]
  });

  let res = await app.request("/api/auth-check");
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.authenticated, true);
  assert.equal(data.source, "openhanako-plugin-auth");

  res = await app.request("/api/ping");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.platform, "hanaagent");
  assert.equal(data.mode, "openhanako-plugin");

  res = await app.request("/api/workspace");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.path, fs.realpathSync(workspaceRoot));
  assert.equal(data.workspaces.some((item) => item.id === "test-workspace"), true);

  res = await app.request("/api/plugins");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.plugins.some((plugin) => plugin.id === "hanaagent"), true);

  res = await app.request("/api/mcp?agentId=primary");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.servers.some((server) => server.id === "local-files"), true);

  res = await app.request("/api/skills?agentId=primary");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(Array.isArray(data.skills), true);
  assert.equal(data.categories.includes("Skills"), true);

  res = await app.request("/api/local-providers");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.providers.some((provider) => provider.id === "openai"), true);

  res = await app.request("/api/provider-usage?provider=openai");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.providers[0].provider, "openai");
  assert.equal(data.providers[0].totalTokens, 15);

  res = await app.request("/api/provider-setup?agent=primary");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.mode, "openhanako-plugin");
  assert.equal(data.summary.configured >= 1, true);
  assert.equal(data.summary.models >= 1, true);
  assert.equal(data.providers.some((provider) => provider.id === "openai" && provider.configured && provider.models.includes("gpt-5-mini")), true);
  assert.equal(data.providers.some((provider) => provider.id === "ollama" && provider.local), true);
  assert.match(data.recommendedSnippet, /host-managed|set-in-openhanako-host-settings/);
  assert.equal(data.safeActions.includes("copy-config-snippet"), true);
  assert.equal(data.connection.claudeUrl, "openhanako://host");

  res = await app.request("/api/provider-setup?agent=missing-agent");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.providers.some((provider) => provider.id === "openai"), true);

  res = await app.request("/api/system-metrics");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.hermes.mode, "openhanako-plugin");
  assert.equal(data.hanaagent.tasks >= 0, true);

  res = await app.request("/api/connection-settings");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.gateway, "openhanako://host");

  res = await app.request("/api/connection-settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ gateway: "http://127.0.0.1:8642", dashboard: "http://127.0.0.1:3099" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.gateway, "http://127.0.0.1:8642");

  res = await app.request("/api/config-patch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pinnedModels: [{ model: "gpt-5", provider: "openai" }] })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.config.pinnedModels[0].model, "gpt-5");

  res = await app.request("/api/gateway-reprobe", { method: "POST" });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.mode, "openhanako-plugin");

  res = await app.request("/api/start-agent", { method: "POST" });
  assert.equal(res.status, 202);
  data = await res.json();
  assert.equal(data.status, "host-managed");

  res = await app.request("/api/claude-update");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.app.name, "HanaAgent Workbench");

  res = await app.request("/api/crew-status");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(Array.isArray(data.crews), true);
});

test("remaining Hermes aliases expose safe OpenHanako plugin compatibility", async () => {
  const { app, workspaceRoot } = makeApp();
  fs.writeFileSync(path.join(workspaceRoot, "preview.html"), "<!doctype html><h1>Preview</h1>", "utf8");
  fs.writeFileSync(path.join(workspaceRoot, "pixel.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1 1\"></svg>", "utf8");

  let res = await app.request("/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "ignored-by-host" })
  });
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.authenticated, true);
  assert.equal(data.source, "openhanako-plugin-auth");

  res = await app.request("/api/oauth/device-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "nous" })
  });
  assert.equal(res.status, 501);
  data = await res.json();
  assert.equal(data.error, "oauth_device_flow_host_managed");

  res = await app.request("/api/oauth.device-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "nous" })
  });
  assert.equal(res.status, 501);

  res = await app.request("/api/oauth/poll-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "nous", deviceCode: "device-1" })
  });
  assert.equal(res.status, 501);
  data = await res.json();
  assert.equal(data.status, "error");

  res = await app.request("/api/oauth.poll-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "nous", deviceCode: "device-1" })
  });
  assert.equal(res.status, 501);

  res = await app.request("/api/preview-file?rootId=test-workspace&path=preview.html");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  assert.match(await res.text(), /Preview/);

  res = await app.request("/api/media?rootId=test-workspace&path=pixel.svg");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /image\/svg/);

  res = await app.request("/api/media?rootId=test-workspace&path=hello.md");
  assert.equal(res.status, 415);
  data = await res.json();
  assert.equal(data.error, "unsupported_media_type");

  res = await app.request("/api/transcribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 501);
  data = await res.json();
  assert.equal(data.status, "capability-gated");

  res = await app.request("/api/playground-admin");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.playground.enabled, false);
  assert.equal(data.mode, "openhanako-plugin");

  res = await app.request("/api/playground-npc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ npcId: "athena", playerMessage: "status?" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.fallback, true);

  res = await app.request("/api/vt-capital");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.plugin.executionEnabled, false);
  assert.equal(data.guardian.executionMode, "observe_only");
});

test("recursive Hermes API aliases cover profiles, knowledge, mcp, skills, sessions, and updates", async () => {
  const { app } = makeApp();

  let res = await app.request("/api/dashboard/overview");
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.mode, "openhanako-plugin");

  res = await app.request("/api/model/info?model=gpt-5-mini");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(Array.isArray(data.models), true);

  res = await app.request("/api/profiles/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "builder", model: "gpt-5-mini" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.profile.name, "builder");

  res = await app.request("/api/profiles/list");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.profiles.some((profile) => profile.name === "builder"), true);

  res = await app.request("/api/profiles/read?name=builder");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.profile.name, "builder");

  res = await app.request("/api/profiles/update", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "builder", patch: { description: "Build lane" } })
  });
  assert.equal(res.status, 200);

  res = await app.request("/api/profiles/activate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "builder" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.activeProfile, "builder");

  res = await app.request("/api/profiles/rename", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ from: "builder", to: "builder-renamed" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.renamedTo, "builder-renamed");

  res = await app.request("/api/profiles/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "builder-renamed" })
  });
  assert.equal(res.status, 200);

  res = await app.request("/api/memory/write", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ memoryId: "kb-note", title: "KB Note", content: "Recursive knowledge search fixture" })
  });
  assert.equal(res.status, 200);

  res = await app.request("/api/memory/list?query=knowledge");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.entries.some((entry) => entry.memoryId === "kb-note"), true);

  res = await app.request("/api/memory/read?memoryId=kb-note");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.entry.memoryId, "kb-note");

  res = await app.request("/api/knowledge/config");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.config.source, "hanaagent-memory");

  res = await app.request("/api/knowledge/list");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.pages.some((page) => page.id === "kb-note"), true);

  res = await app.request("/api/knowledge/search?q=fixture");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.results.some((page) => page.id === "kb-note"), true);

  res = await app.request("/api/knowledge/read?path=memory/kb-note.md");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.page.id, "kb-note");
  assert.match(data.content, /Recursive knowledge/);

  res = await app.request("/api/knowledge/graph");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.nodes.some((node) => node.id === "memory/kb-note.md"), true);

  res = await app.request("/api/knowledge/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.synced, true);

  res = await app.request("/api/mcp/presets");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.presets.length > 0, true);

  res = await app.request("/api/mcp/hub-sources");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.sources.some((source) => source.id === "openhanako"), true);

  res = await app.request("/api/mcp/hub-sources/openhanako");
  assert.equal(res.status, 200);

  res = await app.request("/api/mcp/hub-search?q=local");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(Array.isArray(data.results), true);

  res = await app.request("/api/mcp/discover", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "local-files" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.status, "ok");

  res = await app.request("/api/mcp/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "local-files" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);

  res = await app.request("/api/mcp/configure", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "local-files", enabled: true })
  });
  assert.equal([200, 422].includes(res.status), true);

  res = await app.request("/api/mcp/local-files");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);

  res = await app.request("/api/mcp/local-files/logs");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(Array.isArray(data.logs), true);

  res = await app.request("/api/skills/hub-search?q=review");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(Array.isArray(data.results), true);

  res = await app.request("/api/skills/toggle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: "primary", skillId: "review", enabled: true })
  });
  assert.equal(res.status, 200);

  res = await app.request("/api/skills/install", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ skillId: "review" })
  });
  assert.equal(res.status, 501);

  res = await app.request("/api/skills/uninstall", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ skillId: "review" })
  });
  assert.equal(res.status, 501);

  res = await app.request("/api/sessions/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionKey: "/sessions/primary.jsonl", message: "nested send" })
  });
  assert.equal(res.status, 200);

  res = await app.request(`/api/sessions/${encodeURIComponent("/sessions/primary.jsonl")}/status`);
  assert.equal(res.status, 200);

  res = await app.request(`/api/sessions/${encodeURIComponent("/sessions/primary.jsonl")}/active-run`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.sessionPath, "/sessions/primary.jsonl");

  res = await app.request("/api/update/status");
  assert.equal(res.status, 200);

  res = await app.request("/api/update/agent", { method: "POST" });
  assert.equal(res.status, 202);

  res = await app.request("/api/update/workspace", { method: "POST" });
  assert.equal(res.status, 202);

  res = await app.request("/api/hermesworld/reservations");
  assert.equal(res.status, 200);

  res = await app.request("/api/hermesworld/reservations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ desiredName: "hana" })
  });
  assert.equal(res.status, 501);

  res = await app.request("/api/hermesworld/reservations/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "missing" })
  });
  assert.equal(res.status, 404);

  res = await app.request("/api/claude-proxy/$");
  assert.equal(res.status, 501);
});

test("Hermes chat aliases map send, history, and SSE to host session APIs", async () => {
  const { app, ctx } = makeApp();

  let res = await app.request("/api/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionKey: "/sessions/primary.jsonl", message: "hello via compat" })
  });
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(ctx.bus.sends.at(-1).text, "hello via compat");

  res = await app.request("/api/send-stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionPath: "/sessions/primary.jsonl", text: "hello stream" })
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type").includes("text/event-stream"), true);
  const streamText = await res.text();
  assert.match(streamText, /event: done/);
  assert.match(streamText, /hello stream/);

  res = await app.request("/api/history?sessionKey=/sessions/primary.jsonl");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.messages.length, 2);

  res = await app.request("/api/events");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type").includes("text/event-stream"), true);
  assert.match(await res.text(), /heartbeat/);
});

test("session title route suggests titles from host session history", async () => {
  const { app } = makeApp();
  const res = await app.request("/api/session-title", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionPath: "/sessions/primary.jsonl",
      agentId: "primary",
      currentTitle: "New Chat"
    })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.sessionPath, "/sessions/primary.jsonl");
  assert.equal(data.title, "work");
  assert.equal(data.source, "first-user-message");
  assert.equal(data.candidates.some((item) => item.source === "checkpoint"), true);
});

test("session fork route creates a new session and dispatches continuation context", async () => {
  const { app, ctx } = makeApp();
  const res = await app.request("/api/session-fork", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionPath: "/sessions/primary.jsonl",
      agentId: "primary",
      instructions: "继续做 Hermes fork parity",
      maxMessages: 10
    })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.mode, "created-and-dispatched");
  assert.equal(data.sourceSessionPath, "/sessions/primary.jsonl");
  assert.equal(data.session.path, "/sessions/new-worker.jsonl");
  assert.match(data.forkPrompt.prompt, /继续做 Hermes fork parity/);
  assert.match(data.forkPrompt.prompt, /please work/);
  assert.equal(ctx.bus.sends.length, 1);
  assert.equal(ctx.bus.sends[0].sessionPath, "/sessions/new-worker.jsonl");
  assert.equal(ctx.bus.sends[0].text.includes("原会话路径：/sessions/primary.jsonl"), true);
});

test("context usage route exposes Hermes-style context meter", async () => {
  const { app } = makeApp();
  let res = await app.request("/api/defaults", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      modelMetadata: [{ model: "gpt-5-mini", provider: "openai", contextWindow: 2000, inputCostPer1M: 0.25, outputCostPer1M: 2 }]
    })
  });
  assert.equal(res.status, 200);

  res = await app.request(`/api/context-usage?sessionPath=${encodeURIComponent("/sessions/primary.jsonl")}&modelId=gpt-5-mini&historyLimit=10`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.sessionPath, "/sessions/primary.jsonl");
  assert.equal(data.context.maxContextTokens, 2000);
  assert.equal(data.context.modelMetadata.contextWindow, 2000);
  assert.equal(data.context.messageCount, 2);
  assert.equal(data.context.usedTokens >= 88, true);
  assert.equal(["ok", "warning", "critical"].includes(data.context.status), true);
  assert.equal(data.usage.summary.totalTokens, 15);
});

test("overview attributes usage to matching missions and assignments", async () => {
  const { app } = makeApp();
  let res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Attribute usage",
      maxWorkers: 1,
      sessionPath: "/sessions/primary.jsonl",
      agentId: "primary"
    })
  });
  assert.equal(res.status, 200);
  const mission = (await res.json()).mission;

  res = await app.request("/api/state");
  assert.equal(res.status, 200);
  const data = await res.json();
  const attribution = data.overview.sections.usage.attribution;
  assert.equal(attribution.summary.attributedMissionTokens, 15);
  assert.equal(attribution.summary.attributedAssignmentTokens, 15);
  assert.equal(attribution.summary.attributedSessionTokens, 15);
  assert.equal(attribution.missions[0].missionId, mission.id);
  assert.equal(attribution.assignments[0].assignmentId, mission.assignments[0].id);
  assert.equal(data.usageAttribution.missions[0].summary.totalTokens, 15);
});

test("parity route exposes Hermes inventory audit", async () => {
  const { app } = makeApp();
  const res = await app.request("/api/parity");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.parity.summary.completeForPluginScope, true);
  assert.equal(data.parity.summary.missing, 0);
  assert.ok(data.parity.categories.some((category) => category.id === "orchestration"));
});

test("runtime surface routes proxy agent config, usage, and host checkpoints", async () => {
  const { app } = makeApp();

  let res = await app.request("/api/agents/primary/config");
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.config.model, "gpt-5-mini");

  res = await app.request("/api/agents/primary/config", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      partial: {
        name: "Primary Builder",
        model: "gpt-5",
        memory: { enabled: false, userProfileEnabled: false },
        agent: { maxTurns: 80, gatewayTimeout: 180, toolUseEnforcement: "required" },
        skills: { enabled: ["build", "review"] }
      }
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.config.name, "Primary Builder");
  assert.equal(data.config.model, "gpt-5");
  assert.equal(data.config.memory.enabled, false);
  assert.equal(data.config.memory.userProfileEnabled, false);
  assert.equal(data.config.agent.maxTurns, 80);
  assert.equal(data.config.agent.gatewayTimeout, 180);
  assert.equal(data.config.agent.toolUseEnforcement, "required");
  assert.deepEqual(data.config.skills.enabled, ["build", "review"]);

  res = await app.request(`/api/usage?sessionPath=${encodeURIComponent("/sessions/primary.jsonl")}&limit=10`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.summary.totalTokens, 15);

  res = await app.request(`/api/host-checkpoints?sessionPath=${encodeURIComponent("/sessions/primary.jsonl")}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.checkpoints[0].checkpointId, "cp-1");

  res = await app.request("/api/host-checkpoints/cp-1/restore", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.restoredTo, "/tmp/cp-1.js");

  res = await app.request("/api/integrations?agentId=primary");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.items.some((item) => item.id === "skill:review"), true);
  assert.equal(data.items.some((item) => item.id === "mcp:local-files"), true);

  res = await app.request("/api/integrations/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "mcp.global.enabled", payload: { enabled: true }, agentId: "primary" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
});

test("global search aggregates missions, tasks, memory, files, and integrations", async () => {
  const { app } = makeApp();

  let res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Build unified command search for the Hanaco workbench",
      title: "Command Search Mission",
      maxWorkers: 1,
      sessionPath: "/sessions/primary.jsonl",
      agentId: "primary"
    })
  });
  assert.equal(res.status, 200);
  const mission = (await res.json()).mission;

  res = await app.request("/api/memory", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Searchable Workbench Note",
      summary: "global search memory",
      content: "Command search should find local memory content"
    })
  });
  assert.equal(res.status, 200);

  res = await app.request("/api/search?query=command&agentId=primary&limit=40");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.results.some((item) => item.kind === "mission" && item.target.missionId === mission.id), true);
  assert.equal(data.results.some((item) => item.kind === "task" && item.target.missionId === mission.id), true);
  assert.equal(data.results.some((item) => item.kind === "memory" && item.target.memoryId), true);
  assert.equal(data.results.some((item) => item.kind === "file" && item.target.path === "hello.md"), true);
  assert.equal(data.groups.mission >= 1, true);

  res = await app.request("/api/search?query=primary&agentId=primary&limit=20");
  assert.equal(res.status, 200);
  const sessionData = await res.json();
  assert.equal(sessionData.results.some((item) => item.kind === "session" && item.target.sessionPath === "/sessions/primary.jsonl"), true);

  res = await app.request("/api/search?query=session%20history%20synced&agentId=primary&limit=20");
  assert.equal(res.status, 200);
  const historyData = await res.json();
  assert.equal(historyData.results.some((item) => item.kind === "session-message" && item.target.sessionPath === "/sessions/primary.jsonl"), true);
  assert.equal(historyData.groups["session-message"] >= 1, true);

  res = await app.request("/api/search?query=review&agentId=primary&limit=20");
  assert.equal(res.status, 200);
  const integrationData = await res.json();
  assert.equal(integrationData.results.some((item) => item.id === "integration:skill:review"), true);
});

test("workspace file routes provide controlled list, read, preview, and write", async () => {
  const { app, workspaceRoot } = makeApp();

  let res = await app.request("/api/workspace-roots");
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.roots.some((root) => root.id === "test-workspace"), true);

  res = await app.request("/api/paths");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.mode, "openhanako-plugin");
  assert.equal(data.workspaceRoot, fs.realpathSync(workspaceRoot));
  assert.equal(data.workspaceRoots.some((root) => root.id === "test-workspace"), true);

  res = await app.request("/api/files?action=list&rootId=test-workspace&path=.&maxDepth=1");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.base, fs.realpathSync(workspaceRoot));
  assert.equal(data.entries.some((entry) => entry.path === "hello.md" && entry.type === "file"), true);

  res = await app.request("/api/files?action=read&rootId=test-workspace&path=hello.md");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.type, "text");
  assert.equal(data.path, "hello.md");
  assert.equal(data.content, "# Hello workspace\n\nCommand search fixture\n");

  res = await app.request("/api/files?action=download&rootId=test-workspace&path=hello.md");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /attachment; filename="hello.md"/);
  assert.equal(await res.text(), "# Hello workspace\n\nCommand search fixture\n");

  res = await app.request("/api/files", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "write", rootId: "test-workspace", path: "compat/saved.md", content: "Saved through Hermes files alias\n" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.path, "compat/saved.md");
  assert.equal(fs.readFileSync(path.join(workspaceRoot, "compat", "saved.md"), "utf8"), "Saved through Hermes files alias\n");

  res = await app.request("/api/files", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "mkdir", rootId: "test-workspace", path: "compat/new-dir" })
  });
  assert.equal(res.status, 200);
  assert.equal(fs.statSync(path.join(workspaceRoot, "compat", "new-dir")).isDirectory(), true);

  res = await app.request("/api/files", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "rename", rootId: "test-workspace", from: "compat/saved.md", to: "compat/renamed.md" })
  });
  assert.equal(res.status, 200);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "compat", "renamed.md")), true);

  res = await app.request("/api/files", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "delete", rootId: "test-workspace", path: "compat/renamed.md" })
  });
  assert.equal(res.status, 200);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "compat", "renamed.md")), false);

  res = await app.request("/api/workspace-files?rootId=test-workspace&path=.&depth=1");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.entries.some((entry) => entry.relativePath === "hello.md"), true);

  res = await app.request("/api/workspace-file?rootId=test-workspace&path=hello.md");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.kind, "text");
  assert.equal(data.content, "# Hello workspace\n\nCommand search fixture\n");

  res = await app.request("/api/workspace-file/download?rootId=test-workspace&path=hello.md");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /attachment; filename="hello.md"/);
  assert.match(res.headers.get("content-type"), /text\/plain/);
  assert.equal(await res.text(), "# Hello workspace\n\nCommand search fixture\n");

  res = await app.request("/api/workspace-file/diff", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rootId: "test-workspace", path: "hello.md", content: "# Hello workspace\n\nCommand search fixture\nAdded from diff\n" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.changed, true);
  assert.match(data.diff, /\+Added from diff/);
  assert.equal(fs.readFileSync(path.join(workspaceRoot, "hello.md"), "utf8"), "# Hello workspace\n\nCommand search fixture\n");

  res = await app.request("/api/workspace-file/patch-review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rootId: "test-workspace",
      path: "hello.md",
      content: "# Hello workspace\n\nCommand search fixture\nPatch accepted\n",
      sessionPath: "/sessions/primary.jsonl",
      agentId: "primary"
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.changed, true);
  assert.equal(data.review.type, "approval");
  assert.equal(data.review.state, "pending");
  assert.equal(data.review.meta.kind, "workspace-patch");
  assert.match(data.review.content, /\+Patch accepted/);
  assert.equal(fs.readFileSync(path.join(workspaceRoot, "hello.md"), "utf8"), "# Hello workspace\n\nCommand search fixture\n");

  const reviewId = data.review.id;
  res = await app.request(`/api/workspace-file/patch-review/${encodeURIComponent(reviewId)}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.review.state, "approved");
  assert.equal(data.file.content, "# Hello workspace\n\nCommand search fixture\nPatch accepted\n");
  assert.equal(fs.readFileSync(path.join(workspaceRoot, "hello.md"), "utf8"), "# Hello workspace\n\nCommand search fixture\nPatch accepted\n");

  res = await app.request(`/api/workspace-file/patch-review/${encodeURIComponent(reviewId)}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 422);
  data = await res.json();
  assert.equal(data.error, "patch_review_already_resolved");

  res = await app.request("/api/workspace-file/patch-review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rootId: "test-workspace",
      path: "hello.md",
      content: "# Hello workspace\n\nCommand search fixture\nRejected patch\n"
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  const rejectedReviewId = data.review.id;
  res = await app.request(`/api/workspace-file/patch-review/${encodeURIComponent(rejectedReviewId)}/reject`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "Needs a better checkpoint" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.review.state, "denied");
  assert.equal(data.review.meta.rejectReason, "Needs a better checkpoint");
  assert.equal(fs.readFileSync(path.join(workspaceRoot, "hello.md"), "utf8"), "# Hello workspace\n\nCommand search fixture\nPatch accepted\n");

  res = await app.request("/api/workspace-file", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rootId: "test-workspace", path: "saved.md", content: "Saved from route\n" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(fs.readFileSync(path.join(workspaceRoot, "saved.md"), "utf8"), "Saved from route\n");

  res = await app.request("/api/workspace-file/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rootId: "test-workspace",
      path: "uploads/attached.txt",
      filename: "attached.txt",
      encoding: "base64",
      content: Buffer.from("Attached from route\n", "utf8").toString("base64")
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.uploaded, true);
  assert.equal(data.content, "Attached from route\n");
  assert.equal(fs.readFileSync(path.join(workspaceRoot, "uploads", "attached.txt"), "utf8"), "Attached from route\n");

  res = await app.request("/api/workspace-file/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "mkdir", rootId: "test-workspace", path: "drafts" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "drafts")), true);

  res = await app.request("/api/workspace-file/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "rename", rootId: "test-workspace", path: "saved.md", to: "drafts/renamed.md" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "drafts", "renamed.md")), true);

  res = await app.request("/api/workspace-file/action", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "delete", rootId: "test-workspace", path: "drafts/renamed.md" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(fs.existsSync(path.join(workspaceRoot, "drafts", "renamed.md")), false);

  res = await app.request("/api/workspace-file", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rootId: "test-workspace", path: "../escape.md", content: "nope" })
  });
  assert.equal(res.status, 422);
  data = await res.json();
  assert.equal(data.error, "path_not_allowed");
});

test("skills, memory, and run record routes cover Hermes Run Console surfaces", async () => {
  const { app } = makeApp();

  let res = await app.request("/api/agent-skills?agentId=primary");
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.skills[0].id, "review");

  res = await app.request("/api/memory?agentId=primary&query=plugin");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.entries[0].memoryId, "mem-1");

  res = await app.request("/api/memory/mem-1");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.entry.content, "memory body");

  res = await app.request("/api/memory", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Local note", summary: "Editable", content: "Editable memory body" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  const localMemoryId = data.entry.memoryId;

  res = await app.request(`/api/memory/${encodeURIComponent(localMemoryId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Local note", content: "Updated editable memory" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.entry.content, "Updated editable memory");

  res = await app.request("/api/memory?query=updated");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.entries.some((entry) => entry.memoryId === localMemoryId), true);

  res = await app.request(`/api/memory/${encodeURIComponent(localMemoryId)}`, { method: "DELETE" });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.deleted, localMemoryId);

  const fallback = makeApp({ disabledBusTypes: ["agent:skills", "memory:list", "memory:read"] });
  res = await fallback.app.request("/api/agent-skills?agentId=primary");
  assert.equal(res.status, 503);
  data = await res.json();
  assert.equal(data.ok, false);

  res = await fallback.app.request("/api/memory", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Fallback local note", summary: "Local only", content: "Host memory disabled but local memory works" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  const fallbackMemoryId = data.entry.memoryId;

  res = await fallback.app.request("/api/memory?query=host");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.host.ok, false);
  assert.equal(data.entries.some((entry) => entry.memoryId === fallbackMemoryId && entry.source === "hanaagent:memory"), true);

  res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "Capture run console records", maxWorkers: 1, sessionPath: "/sessions/primary.jsonl" })
  });
  assert.equal(res.status, 200);
  const mission = (await res.json()).mission;

  res = await app.request("/api/run-records", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "artifact",
      title: "Mission report artifact",
      content: "# Artifact\n\nReady",
      language: "markdown",
      missionId: mission.id,
      assignmentId: mission.assignments[0].id,
      sessionPath: "/sessions/primary.jsonl"
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  const artifactId = data.record.id;

  res = await app.request(`/api/run-records/${encodeURIComponent(artifactId)}/artifact-file`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionPath: "/sessions/primary.jsonl" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.sessionFile.ok, true);
  assert.equal(data.file.filename.endsWith(".md"), true);

  res = await app.request(`/api/run-records/${encodeURIComponent(artifactId)}/artifact-file/content`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/markdown/);
  assert.equal(await res.text(), "# Artifact\n\nReady");

  res = await app.request(`/api/run-records/${encodeURIComponent(artifactId)}/artifact-preview`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionPath: "/sessions/primary.jsonl" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.source, "host-api");
  assert.equal(data.previewUrl.includes("/preview/html/pv_artifact"), true);

  res = await app.request(`/api/worker-artifacts?missionId=${encodeURIComponent(mission.id)}&limit=20`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.summary.artifacts >= 1, true);
  assert.equal(data.summary.previews >= 1, true);
  assert.equal(data.items.some((bucket) => bucket.assignmentId === mission.assignments[0].id), true);
  const artifactBucket = data.items.find((bucket) => bucket.assignmentId === mission.assignments[0].id);
  assert.equal(artifactBucket.artifacts.some((artifact) => artifact.id === artifactId && artifact.kind === "report"), true);
  assert.equal(artifactBucket.previews.some((preview) => preview.url.includes("/preview/html/pv_artifact")), true);

  res = await app.request(`/api/workers/${encodeURIComponent(mission.assignments[0].id)}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.summary.artifacts >= 1, true);
  assert.equal(data.workerArtifacts.items.some((bucket) => bucket.assignmentId === mission.assignments[0].id), true);

  res = await app.request("/api/artifacts?sessionId=/sessions/primary.jsonl");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.artifacts.some((artifact) => artifact.artifactId === artifactId), true);

  res = await app.request(`/api/artifacts/${encodeURIComponent(artifactId)}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.artifact.title, "Mission report artifact");

  res = await app.request("/api/run-records", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "approval",
      title: "Approve shell command",
      summary: "Needs user decision",
      missionId: mission.id,
      assignmentId: mission.assignments[0].id,
      sessionPath: "/sessions/primary.jsonl"
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.record.type, "approval");
  assert.equal(data.record.state, "pending");
  const recordId = data.record.id;

  res = await app.request("/api/run-records?type=approval");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.summary.pendingApprovals, 1);

  res = await app.request(`/api/approvals?missionId=${encodeURIComponent(mission.id)}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.summary.pending, 1);
  assert.equal(data.pending[0].id, recordId);
  assert.equal(data.pending[0].status, "pending");
  assert.equal(data.pending[0].missionId, mission.id);
  assert.equal(data.pending[0].assignmentId, mission.assignments[0].id);

  res = await app.request(`/api/gateway/approvals?missionId=${encodeURIComponent(mission.id)}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.pending.some((approval) => approval.id === recordId), true);

  res = await app.request("/api/run-records", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "approval",
      title: "Unrelated approval",
      summary: "Should stay outside the scoped resolve response",
      missionId: "external-mission",
      assignmentId: "external-worker",
      sessionPath: "/sessions/external.jsonl"
    })
  });
  assert.equal(res.status, 200);

  res = await app.request(`/api/approvals/${encodeURIComponent(recordId)}/approve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "Looks safe" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.record.state, "approved");
  assert.equal(data.summary.pending, 0);
  assert.equal(data.summary.total, 1);
  assert.equal(data.globalSummary.total, 2);
  assert.equal(data.globalSummary.pending, 1);
  assert.equal(data.history.some((approval) => approval.id === recordId && approval.status === "approved"), true);

  res = await app.request(`/api/run-records/${encodeURIComponent(recordId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: "pending" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.record.state, "pending");

  res = await app.request(`/api/gateway/approvals/${encodeURIComponent(recordId)}/deny`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "Needs a smaller command" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.record.state, "denied");
  assert.ok(data.record.resolvedAt);

  res = await app.request(`/api/run-records/${encodeURIComponent(recordId)}`, { method: "DELETE" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).deleted, recordId);
});

test("run learnings and run compare routes expose Hermes-style run analysis", async () => {
  const { app } = makeApp();

  let res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Compare two implementation runs",
      title: "Run A Mission",
      maxWorkers: 1,
      sessionPath: "/sessions/run-a.jsonl",
      agentId: "primary"
    })
  });
  assert.equal(res.status, 200);
  let data = await res.json();
  const missionA = data.mission;

  res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Compare optimized implementation run",
      title: "Run B Mission",
      maxWorkers: 1,
      sessionPath: "/sessions/run-b.jsonl",
      agentId: "primary"
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  const missionB = data.mission;

  await app.request(`/api/missions/${encodeURIComponent(missionA.id)}/assignments/${encodeURIComponent(missionA.assignments[0].id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: "done", tokenCount: 2000, output: "Run A completed with extra work" })
  });
  await app.request(`/api/missions/${encodeURIComponent(missionB.id)}/assignments/${encodeURIComponent(missionB.assignments[0].id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: "done", tokenCount: 900, output: "Run B completed with fewer tokens" })
  });

  res = await app.request("/api/run-records", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "learning",
      title: "Optimization: reuse generated prompt",
      summary: "Reuse generated prompt to cut tokens",
      content: "Reuse generated prompt to cut tokens.",
      missionId: missionB.id,
      assignmentId: missionB.assignments[0].id,
      sessionPath: "/sessions/run-b.jsonl",
      meta: { category: "optimization" }
    })
  });
  assert.equal(res.status, 200);

  res = await app.request(`/api/run-learnings?missionId=${encodeURIComponent(missionB.id)}&category=optimization`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.summary.total, 1);
  assert.equal(data.summary.byCategory.optimization, 1);
  assert.equal(data.learnings[0].category, "optimization");
  assert.equal(data.learnings[0].missionId, missionB.id);

  res = await app.request(`/api/run-compare?missionA=${encodeURIComponent(missionA.id)}&missionB=${encodeURIComponent(missionB.id)}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.runA.kind, "mission");
  assert.equal(data.runB.kind, "mission");
  const tokenMetric = data.metrics.find((metric) => metric.id === "tokens");
  assert.equal(tokenMetric.tone, "better");
  assert.equal(tokenMetric.right < tokenMetric.left, true);
  assert.match(data.recommendation, /Run B/);
});

test("mission inbox routes surface blockers, approvals, and review gate work", async () => {
  const { app } = makeApp();

  let res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Surface mission inbox items",
      maxWorkers: 2,
      sessionPath: "/sessions/primary.jsonl",
      agentId: "primary"
    })
  });
  assert.equal(res.status, 200);
  const mission = (await res.json()).mission;
  const blockedAssignment = mission.assignments[0];

  res = await app.request(`/api/missions/${encodeURIComponent(mission.id)}/assignments/${encodeURIComponent(blockedAssignment.id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: "blocked", blocker: "Need operator decision" })
  });
  assert.equal(res.status, 200);

  res = await app.request("/api/run-records", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "approval",
      title: "Approve risky command",
      summary: "Needs user decision",
      missionId: mission.id,
      assignmentId: blockedAssignment.id,
      sessionPath: "/sessions/primary.jsonl"
    })
  });
  assert.equal(res.status, 200);

  res = await app.request(`/api/inbox?missionId=${encodeURIComponent(mission.id)}`);
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.summary.blockers >= 1, true);
  assert.equal(data.summary.approvals, 1);
  assert.equal(data.summary.reviewGate >= 1, true);
  assert.equal(data.items.some((item) => item.kind === "approval" && item.title.includes("Approve risky command")), true);

  res = await app.request(`/api/missions/${encodeURIComponent(mission.id)}/inbox`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.summary.total >= 2, true);

  res = await app.request("/api/overview");
  data = await res.json();
  assert.equal(data.inbox.summary.approvals, 1);
  assert.equal(data.overview.sections.inbox.summary.blockers >= 1, true);
});

test("operations routes expose profile presets and create preset missions", async () => {
  const { app, ctx } = makeApp();

  let res = await app.request("/api/operations");
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.operations.presets.some((preset) => preset.id === "builder"), true);
  assert.equal(data.operations.metrics.agents, 1);

  res = await app.request("/api/operations/presets");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.presets.some((preset) => preset.id === "ops"), true);

  res = await app.request("/api/operations/presets/builder/mission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Ship operations presets",
      sessionPath: "/sessions/primary.jsonl",
      agentId: "primary"
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.mission.templateLabel, "Operations: Builder");
  assert.equal(data.mission.assignments.some((assignment) => assignment.roleId === "builder"), true);
  assert.equal(data.tasks.length, data.mission.assignments.length);

  res = await app.request("/api/operations/profiles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "custom-builder",
      label: "Custom Builder",
      mission: "Custom profile mission",
      roles: ["orchestrator", "builder"],
      maxWorkers: 2,
      visibility: "team",
      permissions: { dispatch: true, edit: false, share: true, terminal: true },
      sharedWith: [{ type: "team", id: "builders", role: "operator" }],
      defaultAgentId: "primary",
      defaultSessionPath: "/sessions/primary.jsonl",
      lanes: [
        { roleId: "orchestrator", agentId: "primary", sessionPath: "/sessions/primary.jsonl" },
        { roleId: "builder", agentId: "builder-agent", sessionPath: "/sessions/builder.jsonl" }
      ]
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.profile.id, "custom-builder");
  assert.equal(data.profile.visibility, "team");
  assert.equal(data.profile.permissions.edit, false);
  assert.equal(data.profile.permissions.share, true);
  assert.equal(data.profile.sharedWith[0].id, "builders");

  res = await app.request("/api/operations/profiles");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.profiles.some((profile) => profile.id === "custom-builder"), true);

  res = await app.request("/api/operations/profiles/custom-builder/export");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /custom-builder/);
  const bundle = await res.json();
  assert.equal(bundle.schema, "hanaagent.operationProfile");
  assert.equal(bundle.profile.permissions.terminal, true);

  res = await app.request("/api/operations/profiles/custom-builder/swarm-roster");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.roster.workers.some((worker) => worker.id === "builder"), true);

  res = await app.request("/api/operations/profiles/custom-builder/swarm-roster?format=yaml&download=1");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /swarm-roster/);
  const rosterYaml = await res.text();
  assert.match(rosterYaml, /workers:/);

  res = await app.request("/api/operations/profiles/custom-builder/mission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "Run custom topology" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.mission.templateLabel, "Profile: Custom Builder");
  assert.equal(data.mission.assignments[1].agentId, "builder-agent");
  assert.equal(data.tasks.length, 2);

  res = await app.request("/api/operations/profiles/custom-builder", { method: "DELETE" });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.deleted, "custom-builder");

  res = await app.request("/api/operations/profiles/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bundle, idPrefix: "imported" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.profile.id, "imported-custom-builder");
  assert.equal(data.profile.visibility, "team");
  assert.equal(data.profile.sharedWith[0].role, "operator");

  res = await app.request("/api/operations/swarm-roster/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "yaml-roster",
      label: "YAML Roster",
      text: [
        "version: 1",
        "workers:",
        "- id: orchestrator",
        "  name: Orchestrator",
        "  role: Swarm Orchestrator / Greenlight Gate",
        "  model: GPT-5.5",
        "  tools:",
        "  - todo",
        "  greenlightRequiredFor:",
        "  - merge",
        "  acceptsBroadcast: true",
        "- id: qa",
        "  name: QA",
        "  role: Browser Smoke Verification",
        "  tools:",
        "  - browser"
      ].join("\n")
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.profile.id, "yaml-roster");
  assert.equal(data.profile.lanes[0].model, "GPT-5.5");
  assert.deepEqual(data.profile.lanes[0].greenlightRequiredFor, ["merge"]);

  res = await app.request("/api/operations/profiles/yaml-roster/mission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "Run imported YAML roster", maxWorkers: 2, sessionPath: "/sessions/primary.jsonl" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.mission.assignments.length, 2);
  assert.equal(data.mission.assignments[0].roleId, "orchestrator");
  assert.equal(data.mission.assignments[0].label, "Orchestrator");
  assert.equal(data.mission.assignments[0].roster.model, "GPT-5.5");
  assert.deepEqual(data.mission.assignments[0].roster.greenlightRequiredFor, ["merge"]);
  assert.equal(data.mission.assignments[1].label, "QA");

  res = await app.request(`/api/missions/${encodeURIComponent(data.mission.id)}/broadcast`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "Broadcast a roster-aware follow-up." })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.sent.length, 1);
  assert.equal(data.sent[0].label, "Orchestrator");
  assert.equal(data.sent[0].brief.worker, "orchestrator");
  assert.equal(data.skipped.some((item) => item.label === "QA" && item.reason === "acceptsBroadcast_false"), true);
  assert.match(ctx.bus.sends.at(-1).text, /HANACO SWARM BROADCAST/);
  assert.match(ctx.bus.sends.at(-1).text, /SwarmBrief:/);
  assert.match(ctx.bus.sends.at(-1).text, /brief_id:/);
  assert.match(ctx.bus.sends.at(-1).text, /Greenlight required for: merge/);
});

test("session lifecycle and host job routes proxy runtime capabilities", async () => {
  const { app } = makeApp();

  let res = await app.request("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: "primary", cwd: "/tmp/project", title: "Worker" })
  });
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.session.path, "/sessions/new-worker.jsonl");

  res = await app.request(`/api/session-status?sessionPath=${encodeURIComponent("/sessions/primary.jsonl")}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.status.state, "running");

  res = await app.request(`/api/session-status?sessionKey=${encodeURIComponent("/sessions/primary.jsonl")}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.payload.sessionKey, "/sessions/primary.jsonl");
  assert.equal(data.payload.status, "running");

  res = await app.request(`/api/session-history?key=${encodeURIComponent("/sessions/primary.jsonl")}&limit=5`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.sessionKey, "/sessions/primary.jsonl");
  assert.equal(data.messages.some((message) => message.role === "assistant"), true);

  res = await app.request("/api/session-send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionKey: "/sessions/primary.jsonl", message: "ControlSuite hello" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.queued, true);

  res = await app.request("/api/session-revert-turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionPath: "/sessions/primary.jsonl" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.branchPath, "/sessions/primary.jsonl");

  res = await app.request("/api/host-tasks");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.tasks[0].taskId, "job-1");

  res = await app.request("/api/host-tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId: "job-2", type: "hanaagent-mission", sessionPath: "/sessions/primary.jsonl" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.taskId, "job-2");

  res = await app.request("/api/host-tasks/job-2/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ result: { ok: true } })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.task.status, "done");

  res = await app.request("/api/deferred-tasks");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.pending[0].taskId, "deferred-1");
});

test("session event stream proxies live EventBus updates for Agent View", async () => {
  const { app, ctx } = makeApp();
  const res = await app.request(`/api/session-events?sessionPath=${encodeURIComponent("/sessions/primary.jsonl")}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/event-stream/);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let chunk = decoder.decode((await reader.read()).value);
  assert.match(chunk, /"type":"connected"/);

  ctx.bus.emit({ type: "text_delta", delta: "live hello" }, "/sessions/primary.jsonl");
  chunk = decoder.decode((await reader.read()).value);
  assert.match(chunk, /session-event/);
  assert.match(chunk, /text_delta/);
  assert.match(chunk, /live hello/);
  await reader.cancel();
});

test("autopilot routes preview and apply auditable conductor suggestions", async () => {
  const { app, ctx } = makeApp();

  let res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Autopilot conductor routing",
      maxWorkers: 2,
      sessionPath: "/sessions/primary.jsonl",
      agentId: "primary"
    })
  });
  assert.equal(res.status, 200);
  const created = await res.json();
  const missionId = created.mission.id;

  res = await app.request(`/api/missions/${encodeURIComponent(missionId)}/autopilot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "preview" })
  });
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.run.mode, "preview");
  assert.equal(data.run.suggestions.some((item) => item.action === "dispatch"), true);
  assert.equal(data.run.suggestions.some((item) => item.action === "sync-history"), true);

  res = await app.request(`/api/missions/${encodeURIComponent(missionId)}/autopilot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "run" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.run.mode, "run");
  assert.equal(data.run.applied.some((item) => item.action === "dispatch"), true);
  assert.equal(data.run.applied.some((item) => item.action === "sync-history"), true);
  assert.equal(ctx.bus.sends.some((item) => /Assignment ID:/.test(item.text)), true);

  res = await app.request(`/api/autopilot?missionId=${encodeURIComponent(missionId)}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.runs.length, 2);
  assert.equal(data.latest.mode, "run");
  assert.equal(data.schedule.enabled, false);

  res = await app.request("/api/autopilot/schedule", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, mode: "preview", intervalMinutes: 5, maxMissionsPerTick: 2 })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.schedule.enabled, true);
  assert.equal(data.schedule.intervalMinutes, 5);

  res = await app.request("/api/autopilot/tick", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "route-test", mode: "preview", maxMissionsPerTick: 2 })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.scanned >= 1, true);
  assert.equal(data.results.some((item) => item.missionId === missionId), true);

  res = await app.request("/api/autopilot/loop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "start", mode: "preview", maxIterations: 2, escalationThreshold: 2, maxMissionsPerTick: 2 })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.loop.state, "active");
  assert.equal(data.loop.maxIterations, 2);

  res = await app.request("/api/autopilot/tick", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "interval" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.loop.iteration, 1);
  assert.equal(data.loopTick.iteration, 1);

  res = await app.request("/api/autopilot/loop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "pause" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.loop.state, "paused");

  res = await app.request("/api/autopilot/tick", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "interval" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.skipped, true);
  assert.equal(data.reason, "loop_paused");

  res = await app.request("/api/autopilot/loop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "resume" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.loop.state, "active");

  res = await app.request("/api/autopilot/loop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "stop" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.loop.state, "stopped");

  res = await app.request(`/api/missions/${encodeURIComponent(missionId)}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.mission.assignments.some((assignment) => assignment.state === "running"), true);
  assert.equal(data.mission.events.some((event) => event.type === "autopilot_run"), true);

  res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Autopilot blocked escalation",
      maxWorkers: 1,
      sessionPath: "/sessions/primary.jsonl",
      agentId: "primary"
    })
  });
  assert.equal(res.status, 200);
  const blockedMission = (await res.json()).mission;
  const blockedAssignment = blockedMission.assignments[0];
  res = await app.request(`/api/missions/${encodeURIComponent(blockedMission.id)}/assignments/${encodeURIComponent(blockedAssignment.id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: "blocked", blocker: "Needs human routing" })
  });
  assert.equal(res.status, 200);
  res = await app.request(`/api/missions/${encodeURIComponent(blockedMission.id)}/autopilot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mode: "run" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.run.applied.some((item) => item.action === "escalate"), true);
  res = await app.request(`/api/run-records?type=approval&missionId=${encodeURIComponent(blockedMission.id)}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.records.some((record) => record.requester === "hanaagent-autopilot" && record.state === "pending"), true);

  res = await app.request("/api/overview");
  data = await res.json();
  assert.equal(data.overview.sections.autopilot.total >= 3, true);
  assert.equal(data.overview.sections.autopilot.schedule.enabled, true);
  assert.equal(data.overview.sections.autopilot.loop.state, "stopped");
  assert.equal(data.overview.sections.autopilot.items.some((item) => item.mode === "run"), true);
});

test("jobs routes create, pause, resume, trigger, output, and delete scheduled automation", async () => {
  const { app } = makeApp();

  let res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Scheduled job mission",
      maxWorkers: 1,
      sessionPath: "/sessions/primary.jsonl",
      agentId: "primary"
    })
  });
  assert.equal(res.status, 200);
  const mission = (await res.json()).mission;

  res = await app.request("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Scheduled mission scan",
      type: "mission-autopilot",
      missionId: mission.id,
      schedule: "*/10 * * * *",
      mode: "preview"
    })
  });
  assert.equal(res.status, 200);
  let data = await res.json();
  const jobId = data.job.id;
  assert.equal(data.job.title, "Scheduled mission scan");

  res = await app.request(`/api/jobs/${encodeURIComponent(jobId)}/pause`, { method: "POST" });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.job.status, "paused");

  res = await app.request(`/api/jobs/${encodeURIComponent(jobId)}/resume`, { method: "POST" });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.job.status, "enabled");

  res = await app.request(`/api/jobs/${encodeURIComponent(jobId)}/trigger`, { method: "POST" });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.run.status, "success");
  assert.match(data.run.summary, /queued|active|review|blocked|done/);

  res = await app.request(`/api/jobs/${encodeURIComponent(jobId)}/output`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.latest.status, "success");

  res = await app.request("/api/agent-outputs?filter=ok&limit=20");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.mode, "openhanako-plugin");
  assert.equal(data.outputs.some((output) => output.source === "job" && output.jobId === jobId && output.status === "ok"), true);
  assert.equal(data.availableFilters.some((filter) => filter.id === "ok" && filter.count >= 1), true);

  res = await app.request("/api/overview");
  data = await res.json();
  assert.equal(data.overview.sections.jobs.total, 1);
  assert.equal(data.overview.sections.jobs.scheduler, null);
  assert.equal(data.overview.sections.agentOutputs.total >= 1, true);
  assert.equal(data.capabilities.agentOutputs, true);
  assert.equal(data.capabilities.jobs, true);

  res = await app.request("/api/claude-jobs");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.jobs.some((job) => job.jobId === jobId && job.name === "Scheduled mission scan"), true);

  res = await app.request(`/api/claude-jobs/${encodeURIComponent(jobId)}?action=output`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.outputs[0].status, "success");

  res = await app.request(`/api/claude-jobs/${encodeURIComponent(jobId)}?action=pause`, { method: "POST" });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.job.enabled, false);

  res = await app.request(`/api/claude-jobs/${encodeURIComponent(jobId)}?action=resume`, { method: "POST" });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.job.enabled, true);

  res = await app.request(`/api/claude-jobs/${encodeURIComponent(jobId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Renamed schedule" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.job.name, "Renamed schedule");

  res = await app.request(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
});

test("agenda and calendar routes aggregate Hermes-style mission, task, job, and approval events", async () => {
  const { app } = makeApp();

  let res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Agenda mission",
      title: "Agenda Mission",
      maxWorkers: 1,
      sessionPath: "/sessions/agenda.jsonl",
      agentId: "primary"
    })
  });
  assert.equal(res.status, 200);
  let data = await res.json();
  const mission = data.mission;

  res = await app.request("/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Due today task",
      description: "Agenda should show this task",
      column: "running",
      priority: "high",
      assignee: "primary",
      dueDate: "2026-06-10",
      missionId: mission.id,
      assignmentId: mission.assignments[0].id,
      sessionPath: "/sessions/agenda.jsonl"
    })
  });
  assert.equal(res.status, 200);

  res = await app.request("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Agenda scheduled job",
      type: "mission-autopilot",
      missionId: mission.id,
      schedule: "daily 09:00",
      nextRunAt: "2026-06-10T09:00:00.000Z",
      mode: "preview"
    })
  });
  assert.equal(res.status, 200);

  res = await app.request("/api/run-records", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "approval",
      title: "Agenda approval",
      summary: "Operator decision required",
      missionId: mission.id,
      assignmentId: mission.assignments[0].id,
      sessionPath: "/sessions/agenda.jsonl",
      state: "pending"
    })
  });
  assert.equal(res.status, 200);

  res = await app.request("/api/agenda?now=2026-06-10T08:00:00.000Z&horizonHours=24");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.sections.tasksDueToday.some((task) => task.title === "Due today task"), true);
  assert.equal(data.sections.upcomingJobs.some((job) => job.name === "Agenda scheduled job"), true);
  assert.equal(data.sections.attention.some((item) => item.type === "approval" && item.title === "Agenda approval"), true);
  assert.equal(data.summary.attention >= 1, true);

  res = await app.request("/api/calendar?start=2026-06-10T00:00:00.000Z&end=2026-06-11T00:00:00.000Z&mode=day");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.events.some((event) => event.type === "task" && event.title === "Due today task"), true);
  assert.equal(data.events.some((event) => event.type === "job" && event.title === "Agenda scheduled job"), true);
  assert.equal(data.events.some((event) => event.type === "approval" && event.title === "Agenda approval"), true);
  assert.equal(data.summary.tasks, 1);
  assert.equal(data.summary.jobs, 1);
  assert.equal(data.summary.approvals, 1);
});

test("calendar route expands Hermes-style recurring job schedules across the selected range", async () => {
  const { app } = makeApp();

  for (const job of [
    {
      title: "Daily standup scan",
      type: "autopilot-tick",
      schedule: "daily 09:30",
      nextRunAt: "2026-06-08T09:30:00.000Z"
    },
    {
      title: "Weekly review scan",
      type: "mission-autopilot",
      schedule: "0 14 * * 3",
      nextRunAt: "2026-06-10T14:00:00.000Z"
    },
    {
      title: "Monthly launch scan",
      type: "dispatch-prompt",
      schedule: "monthly 15 10:15",
      nextRunAt: "2026-06-15T10:15:00.000Z"
    }
  ]) {
    const res = await app.request("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(job)
    });
    assert.equal(res.status, 200);
  }

  const res = await app.request("/api/calendar?start=2026-06-08T00:00:00.000Z&end=2026-06-16T00:00:00.000Z&mode=week");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);

  const dailyEvents = data.events.filter((event) => event.type === "job" && event.title === "Daily standup scan");
  assert.equal(dailyEvents.length, 8);
  assert.deepEqual(dailyEvents.map((event) => event.date.slice(0, 10)), [
    "2026-06-08",
    "2026-06-09",
    "2026-06-10",
    "2026-06-11",
    "2026-06-12",
    "2026-06-13",
    "2026-06-14",
    "2026-06-15"
  ]);
  assert.equal(data.events.some((event) => event.type === "job" && event.title === "Weekly review scan" && event.date.slice(0, 10) === "2026-06-10"), true);
  assert.equal(data.events.some((event) => event.type === "job" && event.title === "Monthly launch scan" && event.date.slice(0, 10) === "2026-06-15"), true);
  assert.equal(data.summary.jobs, 10);
});

test("calendar route expands recurring jobs in the selected timezone", async () => {
  const { app } = makeApp();

  let res = await app.request("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Shanghai local standup",
      type: "autopilot-tick",
      schedule: "daily 09:00",
      nextRunAt: "2026-06-10T01:00:00.000Z"
    })
  });
  assert.equal(res.status, 200);

  res = await app.request("/api/calendar?start=2026-06-10T00:00:00.000Z&end=2026-06-11T00:00:00.000Z&mode=day&timezone=Asia/Shanghai");
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.timezone, "Asia/Shanghai");
  let event = data.events.find((item) => item.type === "job" && item.title === "Shanghai local standup");
  assert.ok(event);
  assert.equal(event.date, "2026-06-10T01:00:00.000Z");
  assert.equal(event.dayKey, "2026-06-10");
  assert.equal(event.localTime, "2026-06-10 09:00");
  assert.equal(data.eventsByDay["2026-06-10"].some((item) => item.key === event.key), true);

  res = await app.request("/api/calendar?start=2026-06-10T00:00:00.000Z&end=2026-06-11T00:00:00.000Z&mode=day&timezone=UTC");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.timezone, "UTC");
  event = data.events.find((item) => item.type === "job" && item.title === "Shanghai local standup");
  assert.ok(event);
  assert.equal(event.date, "2026-06-10T09:00:00.000Z");
  assert.equal(event.localTime, "2026-06-10 09:00");
});

test("calendar route expands advanced cron step range and list schedules", async () => {
  const { app } = makeApp();

  for (const job of [
    {
      title: "Business hours scan",
      type: "dispatch-prompt",
      schedule: "*/30 9-10 * * 1-5",
      nextRunAt: "2026-06-10T09:00:00.000Z"
    },
    {
      title: "Month day list scan",
      type: "mission-autopilot",
      schedule: "15 8 10,11 * *",
      nextRunAt: "2026-06-10T08:15:00.000Z"
    },
    {
      title: "Weekday range scan",
      type: "autopilot-tick",
      schedule: "0 17 * * mon-fri",
      nextRunAt: "2026-06-10T17:00:00.000Z"
    }
  ]) {
    const res = await app.request("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(job)
    });
    assert.equal(res.status, 200);
  }

  const res = await app.request("/api/calendar?start=2026-06-10T00:00:00.000Z&end=2026-06-12T00:00:00.000Z&mode=day");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);

  const businessEvents = data.events.filter((event) => event.type === "job" && event.title === "Business hours scan");
  assert.equal(businessEvents.length, 8);
  assert.equal(businessEvents.every((event) => ["2026-06-10", "2026-06-11"].includes(event.date.slice(0, 10))), true);

  const monthListEvents = data.events.filter((event) => event.type === "job" && event.title === "Month day list scan");
  assert.deepEqual(monthListEvents.map((event) => event.date.slice(0, 10)), ["2026-06-10", "2026-06-11"]);

  const weekdayEvents = data.events.filter((event) => event.type === "job" && event.title === "Weekday range scan");
  assert.equal(weekdayEvents.length, 2);
  assert.equal(data.summary.jobs, 12);
});

test("rendered workbench inline scripts are parseable browser JavaScript", async () => {
  const { app } = makeApp();
  const page = await app.request("/workbench");
  const html = await page.text();
  assert.match(html, /id="taskEditorBackdrop"/);
  assert.match(html, /function openTaskEditor/);
  assert.match(html, /taskEditorDuplicateBtn/);
  assert.match(html, /calendarModeSelect/);
  assert.match(html, /calendarTimezoneInput/);
  assert.match(html, /calendarPrevBtn/);
  assert.match(html, /calendar-grid/);
  assert.match(html, /calendar-hour-events/);
  assert.match(html, /agenda-section/);
  assert.match(html, /data-agenda-section/);
  assert.match(html, /data-agenda-kind/);
  assert.match(html, /function toggleAgendaSection/);
  assert.match(html, /function openAgendaItem/);
  assert.match(html, /function findAgendaItem/);
  assert.match(html, /function formatAgendaDetail/);
  assert.match(html, /function focusMissionReference/);
  assert.match(html, /function openTaskFromReference/);
  assert.match(html, /function openRunRecord/);
  assert.match(html, /function openJobDetail/);
  assert.match(html, /function renderCalendarGrouped/);
  assert.match(html, /function renderCalendarDays/);
  assert.match(html, /function openCalendarEvent/);
  assert.match(html, /function calendarUrl/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length >= 2);
  for (const script of scripts) {
    assert.doesNotThrow(() => new Function(script));
  }
});

test("mission routes create Conductor assignments, tasks, dispatch prompts, and checkpoint updates", async () => {
  const { app, ctx } = makeApp();

  let res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "完整复刻 Hermes Conductor",
      notes: "route test",
      maxWorkers: 2,
      sessionPath: "/sessions/primary.jsonl",
      agentId: "primary"
    })
  });
  assert.equal(res.status, 200);
  const created = await res.json();
  assert.equal(created.ok, true);
  assert.equal(created.mission.assignments.length, 2);
  assert.equal(created.tasks.length, 2);
  assert.equal(created.tasks[0].missionId, created.mission.id);

  res = await app.request(`/api/missions/${encodeURIComponent(created.mission.id)}/dispatch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionPath: "/sessions/primary.jsonl" })
  });
  assert.equal(res.status, 200);
  const dispatched = await res.json();
  assert.equal(dispatched.ok, true);
  assert.match(dispatched.sent[0].prompt, /Assignment ID:/);
  assert.match(dispatched.sent[0].prompt, /SwarmBrief:/);
  assert.match(dispatched.sent[0].prompt, /brief_id:/);
  assert.equal(dispatched.sent[0].brief.goal, "完整复刻 Hermes Conductor");
  assert.match(ctx.bus.sends.at(-1).text, /SwarmBrief:/);
  assert.equal(dispatched.sent[0].hostTask.ok, true);
  assert.equal(dispatched.sent[0].hostTask.taskId.startsWith(`hanaagent-${created.mission.id}-`), true);
  assert.equal(ctx.bus.taskRequests.some((item) => item.type === "task:register" && item.payload.meta.missionId === created.mission.id), true);
  assert.equal(ctx.bus.taskRequests.some((item) => item.type === "task:update" && item.payload.status === "running"), true);

  res = await app.request(`/api/missions/${encodeURIComponent(created.mission.id)}/briefs`);
  assert.equal(res.status, 200);
  const briefs = await res.json();
  assert.equal(briefs.briefs.length, 2);
  assert.match(briefs.yaml, /checkpoint_contract:/);

  res = await app.request(`/api/missions/${encodeURIComponent(created.mission.id)}/assignments/${encodeURIComponent(created.mission.assignments[0].id)}/brief`);
  assert.equal(res.status, 200);
  const brief = await res.json();
  assert.equal(brief.assignmentId, created.mission.assignments[0].id);
  assert.match(brief.yaml, /brief_id:/);

  res = await app.request(`/api/missions/${encodeURIComponent(created.mission.id)}/assignments/${encodeURIComponent(created.mission.assignments[0].id)}/brief/artifact`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 200);
  const briefArtifact = await res.json();
  assert.equal(briefArtifact.ok, true);
  assert.equal(briefArtifact.record.type, "artifact");
  assert.equal(briefArtifact.record.language, "yaml");
  assert.equal(briefArtifact.record.tool, "hanaagent-swarmbrief");
  assert.equal(briefArtifact.record.missionId, created.mission.id);
  assert.equal(briefArtifact.record.assignmentId, created.mission.assignments[0].id);
  assert.match(briefArtifact.record.content, /brief_id:/);
  assert.equal(briefArtifact.record.meta.briefId, briefArtifact.brief.brief_id);

  res = await app.request(`/api/run-records?type=artifact&missionId=${encodeURIComponent(created.mission.id)}`);
  assert.equal(res.status, 200);
  const briefArtifacts = await res.json();
  assert.equal(briefArtifacts.records.some((record) => record.id === briefArtifact.record.id), true);

  res = await app.request(`/api/missions/${encodeURIComponent(created.mission.id)}`);
  assert.equal(res.status, 200);
  const withBriefEvent = await res.json();
  assert.equal(withBriefEvent.mission.events.some((event) => event.type === "swarmbrief_artifact" && event.meta.recordId === briefArtifact.record.id), true);

  res = await app.request(`/api/swarm-activity?missionId=${encodeURIComponent(created.mission.id)}&limit=20`);
  assert.equal(res.status, 200);
  let activity = await res.json();
  assert.equal(activity.ok, true);
  assert.equal(activity.mode, "openhanako-plugin");
  assert.equal(activity.items.some((item) => item.kind === "artifact" && item.assignmentId === created.mission.assignments[0].id), true);
  assert.equal(activity.items.some((item) => item.source === "run-console" && item.id === `run:${briefArtifact.record.id}`), true);
  assert.equal(activity.summary.byKind.artifact >= 1, true);

  res = await app.request(`/api/agent-outputs?missionId=${encodeURIComponent(created.mission.id)}&limit=20`);
  assert.equal(res.status, 200);
  let outputs = await res.json();
  assert.equal(outputs.ok, true);
  assert.equal(outputs.outputs.some((output) => output.source === "run-record" && output.id === `run-record:${briefArtifact.record.id}` && output.status === "ok"), true);
  assert.equal(outputs.availableFilters.some((filter) => filter.id === "all" && filter.count >= 1), true);

  res = await app.request("/api/checkpoints", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      taskId: created.tasks[0].id,
      text: [
        "STATE: DONE",
        "FILES_CHANGED: none",
        "COMMANDS_RUN: npm test",
        "RESULT: verified",
        "BLOCKER: none",
        "NEXT_ACTION: review"
      ].join("\n")
    })
  });
  assert.equal(res.status, 200);
  const checkpoint = await res.json();
  assert.equal(checkpoint.missionUpdate.ok, true);
  assert.equal(checkpoint.missionUpdate.assignment.state, "done");

  res = await app.request(`/api/swarm-activity?workerId=${encodeURIComponent(created.mission.assignments[0].id)}&limit=20`);
  assert.equal(res.status, 200);
  activity = await res.json();
  assert.equal(activity.items.some((item) => item.kind === "checkpoint" && /verified|STATE: DONE/.test(item.text)), true);
  assert.equal(activity.items.every((item) => item.workerId === created.mission.assignments[0].id || item.assignmentId === created.mission.assignments[0].id), true);

  res = await app.request(`/api/agent-outputs?filter=ok&missionId=${encodeURIComponent(created.mission.id)}&limit=20`);
  assert.equal(res.status, 200);
  outputs = await res.json();
  assert.equal(outputs.outputs.some((output) => output.source === "checkpoint" && /verified|STATE: DONE/.test(output.fullOutput)), true);
  assert.equal(outputs.summary.byStatus.ok >= 1, true);

  res = await app.request(`/api/missions/${encodeURIComponent(created.mission.id)}/assignments/${encodeURIComponent(created.mission.assignments[1].id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: "done", result: "second worker done", tokenCount: 42 })
  });
  assert.equal(res.status, 200);
  const patched = await res.json();
  assert.equal(patched.assignment.state, "done");
  assert.equal(patched.taskUpdate.task.column, "done");
  assert.equal(patched.hostTaskUpdate.ok, true);
  assert.equal(ctx.bus.taskRequests.some((item) => item.type === "task:complete" && item.payload.taskId.includes(created.mission.assignments[1].id)), true);

  res = await app.request(`/api/missions/${encodeURIComponent(created.mission.id)}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ summary: "route complete" })
  });
  assert.equal(res.status, 200);
  const completed = await res.json();
  assert.equal(completed.mission.state, "complete");
  assert.equal(completed.mission.phase, "complete");
  assert.equal(completed.hostTaskUpdates.length, 2);

  res = await app.request(`/api/missions/${encodeURIComponent(created.mission.id)}/report`);
  assert.equal(res.status, 200);
  const report = await res.json();
  assert.equal(report.ok, true);
  assert.match(report.report, /# Mission Report/);
  assert.match(report.report, /route complete/);
  assert.equal(report.export.tokenCount, 42);

  res = await app.request(`/api/missions/${encodeURIComponent(created.mission.id)}/report-artifact`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionPath: "/sessions/primary.jsonl",
      assignmentId: created.mission.assignments[1].id,
      materialize: true,
      preview: true
    })
  });
  assert.equal(res.status, 200);
  const reportArtifact = await res.json();
  assert.equal(reportArtifact.ok, true);
  assert.equal(reportArtifact.record.type, "artifact");
  assert.equal(reportArtifact.record.missionId, created.mission.id);
  assert.equal(reportArtifact.record.assignmentId, created.mission.assignments[1].id);
  assert.equal(reportArtifact.record.meta.source, "mission-report");
  assert.match(reportArtifact.record.content, /# Mission Report/);
  assert.equal(reportArtifact.file.ok, true);
  assert.equal(reportArtifact.sessionFile.ok, true);
  assert.match(reportArtifact.contentUrl, /artifact-file\/content/);
  assert.equal(reportArtifact.preview.ok, true);
  assert.match(reportArtifact.preview.previewUrl, /preview\/html\/pv_artifact/);

  res = await app.request(`/api/artifacts?sessionPath=${encodeURIComponent("/sessions/primary.jsonl")}`);
  assert.equal(res.status, 200);
  const artifacts = await res.json();
  assert.equal(artifacts.ok, true);
  assert.equal(artifacts.artifacts.some((artifact) => artifact.id === reportArtifact.record.id && /Mission report/.test(artifact.title)), true);

  res = await app.request(`/api/missions/${encodeURIComponent(created.mission.id)}/export`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/markdown/);
  assert.match(await res.text(), /## Worker Summary/);

  res = await app.request(`/api/missions/${encodeURIComponent(created.mission.id)}/continue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instructions: "继续做 history detail", maxWorkers: 1, sessionPath: "/sessions/primary.jsonl" })
  });
  assert.equal(res.status, 200);
  const continued = await res.json();
  assert.equal(continued.ok, true);
  assert.match(continued.continuationPrompt, /CONTINUATION OF PREVIOUS MISSION/);
  assert.equal(continued.mission.assignments.length, 1);
  assert.equal(continued.tasks.length, 1);
  assert.equal(continued.tasks[0].tags.includes("continuation"), true);
  assert.equal(continued.started, true);
  assert.equal(continued.dispatch.length, 1);
  assert.equal(continued.dispatch[0].ok, true);
  assert.equal(continued.dispatch[0].sessionPath, "/sessions/primary.jsonl");
  assert.match(ctx.bus.sends.at(-1).text, /CONTINUATION OF PREVIOUS MISSION/);
  assert.equal(continued.mission.events.some((event) => event.type === "continuation_dispatch"), true);

  res = await app.request(`/api/missions/${encodeURIComponent(created.mission.id)}/continue`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instructions: "只生成续接计划", maxWorkers: 1, sessionPath: "/sessions/primary.jsonl", dispatch: false })
  });
  assert.equal(res.status, 200);
  const plannedOnly = await res.json();
  assert.equal(plannedOnly.ok, true);
  assert.equal(plannedOnly.started, false);
  assert.deepEqual(plannedOnly.dispatch, []);

  res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "Stop route mission", maxWorkers: 2, sessionPath: "/sessions/primary.jsonl" })
  });
  const stoppable = await res.json();
  res = await app.request(`/api/missions/${encodeURIComponent(stoppable.mission.id)}/stop`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "route stop" })
  });
  assert.equal(res.status, 200);
  const stopped = await res.json();
  assert.equal(stopped.mission.state, "cancelled");
  assert.equal(stopped.mission.phase, "complete");
  assert.equal(stopped.aborts.length, 1);
  assert.equal(stopped.aborts[0].ok, true);
  assert.equal(stopped.hostTaskUpdates.length, 2);
  assert.equal(ctx.bus.taskRequests.some((item) => item.type === "task:cancel" && item.payload.reason === "route stop"), true);
});

test("Hermes conductor aliases create and stop native HanaAgent missions", async () => {
  const { app, ctx } = makeApp();

  let res = await app.request("/api/conductor-spawn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Ship conductor alias parity",
      maxParallel: 2,
      sessionKey: "/sessions/primary.jsonl"
    })
  });
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.mode, "native-swarm");
  assert.equal(data.mission.assignments.length, 2);
  assert.equal(data.tasks.length, 2);
  assert.equal(Array.isArray(data.dispatch), true);
  assert.equal(ctx.bus.sends.some((send) => send.text.includes("Ship conductor alias parity")), true);

  res = await app.request("/api/conductor-stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      missionIds: [data.missionId],
      sessionKeys: ["/sessions/primary.jsonl"],
      reason: "stop conductor alias"
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.stoppedMissions, 1);
  assert.equal(data.cancelledNativeMissions, 1);
  assert.equal(data.deleted, 1);
});

test("Hermes swarm compatibility routes expose roster, dispatch, missions, and checkpoint contracts", async () => {
  const { app, ctx } = makeApp();

  let res = await app.request("/api/swarm-roster", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "swarm5",
      name: "Swarm5",
      role: "Builder",
      mission: "Ship compatibility slices",
      model: "GPT-5.5",
      tools: ["terminal", "files"],
      skills: ["swarm-worker-core"],
      acceptsBroadcast: true,
      reviewRequired: true,
      defaultCwd: "/repo/hanaagent"
    })
  });
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.roster.workers.some((worker) => worker.id === "swarm5"), true);

  res = await app.request("/api/swarm-roster");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(Array.isArray(data.roster.workers), true);

  res = await app.request("/api/swarm-roster", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      profileId: "swarm-roster",
      workers: [
        { id: "swarm6", role: "Reviewer", skills: ["review"], acceptsBroadcast: true },
        { id: "swarm7", role: "Researcher", capabilities: ["research"], model: "GPT-5.5-mini" }
      ]
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.workerCount, 2);
  assert.equal(data.merged, true);
  assert.equal(data.roster.workers.some((worker) => worker.id === "swarm5"), true);
  assert.equal(data.roster.workers.some((worker) => worker.id === "swarm6"), true);
  assert.equal(data.roster.workers.some((worker) => worker.id === "swarm7"), true);

  res = await app.request("/api/swarm-roster", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      profileId: "swarm-roster",
      replace: true,
      roster: {
        metadata: { profileLabel: "Replacement Roster" },
        workers: [
          { id: "swarm8", role: "Ops", mission: "Operate runtime", tools: ["terminal"] }
        ]
      }
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.merged, false);
  assert.deepEqual(data.roster.workers.map((worker) => worker.id), ["swarm8"]);

  res = await app.request("/api/swarm-dispatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workerIds: ["swarm5"],
      prompt: "Implement the compatibility API with proof.",
      missionTitle: "Compatibility dispatch",
      sessionPath: "/sessions/primary.jsonl"
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.created, true);
  assert.equal(data.results.length, 1);
  assert.equal(data.results[0].workerId, "swarm5");
  assert.equal(Boolean(data.results[0].brief.brief_id), true);
  assert.match(data.results[0].output, /SwarmBrief:/);
  assert.match(ctx.bus.sends.at(-1).text, /SwarmBrief:/);
  const missionId = data.missionId;
  const assignmentId = data.mission.assignments[0].id;

  res = await app.request(`/api/swarm-missions?id=${encodeURIComponent(missionId)}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.mission.id, missionId);
  assert.equal(data.reports.length, 1);

  res = await app.request("/api/swarm-checkpoint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workerId: "swarm5",
      missionId,
      assignmentId,
      checkpointStatus: "done",
      lastResult: "compatibility API verified",
      nextAction: "document route",
      commandsRun: ["npm test"],
      filesChanged: ["plugins/hanaagent/routes/workbench.js"]
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.missionUpdate.assignment.state, "done");
  assert.equal(data.checkpoint.state, "DONE");

  res = await app.request("/api/swarm-missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "cancel", missionId, assignmentId, reason: "compat route cancel" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.result.assignment.state, "cancelled");
});

test("Hermes swarm runtime, health, and chat compatibility routes expose worker observability", async () => {
  const { app } = makeApp();

  let res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Observe worker runtime",
      maxWorkers: 1,
      sessionPath: "/sessions/primary.jsonl",
      agentId: "primary"
    })
  });
  assert.equal(res.status, 200);
  const mission = (await res.json()).mission;
  const assignment = mission.assignments[0];

  res = await app.request("/api/swarm-runtime");
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.mode.mode, "openhanako-plugin");
  assert.equal(data.tmuxAvailable, false);
  assert.equal(data.entries.some((entry) => entry.workerId === assignment.id && entry.dispatch.dispatchable === true), true);
  assert.deepEqual(data.workers, data.entries);
  assert.deepEqual(data.runtime.entries, data.entries);
  assert.deepEqual(data.runtime.workers, data.entries);
  assert.equal(data.runtime.mode.mode, "openhanako-plugin");

  res = await app.request(`/api/swarm-runtime?workerId=${encodeURIComponent(assignment.id)}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.entries.length, 1);
  assert.equal(data.entries[0].session.sessionPath, "/sessions/primary.jsonl");

  res = await app.request("/api/swarm-health");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(typeof data.checkedAt, "number");
  assert.equal(data.workspaceModel, "openhanako");
  assert.equal(data.agentApiUrl, "openhanako://plugin-capabilities");
  assert.equal(data.summary.totalWorkers >= 1, true);
  assert.equal(data.workers.some((worker) => worker.workerId === assignment.id), true);
  assert.deepEqual(data.summary.distinctProviders, ["openhanako"]);

  res = await app.request(`/api/swarm-chat?workerId=${encodeURIComponent(assignment.id)}&limit=2`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.workerId, assignment.id);
  assert.equal(data.source, "session:history");
  assert.equal(data.messages.length, 2);
  assert.equal(data.sessionId, "/sessions/primary.jsonl");
});

test("Hermes swarm extended compatibility routes expose decompose, kanban, memory, reports, project, lifecycle, and terminal aliases", async () => {
  const { app, ctx } = makeApp();

  let res = await app.request("/api/swarm-roster", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      profileId: "extended",
      worker: {
        id: "swarm5",
        role: "builder",
        mission: "Implement API slices",
        skills: ["swarm-worker-core"],
        capabilities: ["ui", "backend"],
        sessionPath: "/sessions/primary.jsonl"
      }
    })
  });
  assert.equal(res.status, 200);

  res = await app.request("/api/swarm-decompose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "Implement and test the Kanban compatibility API",
      workers: [
        { id: "swarm5", role: "builder", skills: ["swarm-worker-core"] },
        { id: "swarm6", role: "reviewer", skills: ["review"] }
      ]
    })
  });
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.fallback, true);
  assert.equal(data.assignments.some((assignment) => assignment.workerId === "swarm5"), true);
  assert.match(data.rosterText, /swarm5/);
  assert.match(data.orchestratorPrompt, /Output ONLY valid minified JSON/);
  assert.match(data.orchestratorPrompt, /Available swarm workers/);

  res = await app.request("/api/swarm-decompose", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      prompt: "Review and verify the compatibility API",
      dispatchToSession: true,
      sessionPath: "/sessions/primary.jsonl",
      workers: [
        { id: "swarm5", role: "builder", skills: ["swarm-worker-core"] },
        { id: "swarm6", role: "reviewer", skills: ["review"] }
      ]
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.orchestratorDispatch.ok, true);
  assert.match(ctx.bus.sends.at(-1).text, /Return the JSON now/);

  res = await app.request("/api/swarm-kanban", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Compat card",
      spec: "Mirror Hermes swarm-kanban",
      acceptanceCriteria: ["route returns card"],
      assignedWorker: "swarm5",
      status: "ready",
      missionId: "mission-compat"
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.card.status, "backlog");
  assert.equal(data.card.assignedWorker, "swarm5");
  const cardId = data.card.id;

  res = await app.request("/api/swarm-kanban", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: cardId, status: "running", assignedWorker: "swarm6" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.card.status, "running");
  assert.equal(data.card.assignedWorker, "swarm6");

  res = await app.request("/api/swarm-memory", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workerId: "swarm5",
      kind: "episodic",
      eventType: "note",
      missionId: "mission-compat",
      summary: "Compatibility memory",
      content: "Remember this compatibility checkpoint."
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.workerId, "swarm5");

  res = await app.request("/api/swarm-memory?workerId=swarm5&kind=episodic&missionId=mission-compat");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.events.some((event) => /Compatibility memory/.test(event.summary)), true);

  res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Extended compat mission",
      maxWorkers: 1,
      sessionPath: "/sessions/primary.jsonl",
      agentId: "primary",
      roles: ["swarm5"],
      lanes: [{ id: "swarm5", label: "swarm5", roleId: "swarm5", cwd: ctx.config.values.workspaceRoots[0].path }]
    })
  });
  assert.equal(res.status, 200);
  const mission = (await res.json()).mission;
  const assignment = mission.assignments[0];

  res = await app.request(`/api/swarm-reports?missionId=${encodeURIComponent(mission.id)}&workerId=${encodeURIComponent(assignment.id)}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.reports.length, 1);
  assert.match(data.reports[0].report, /Extended compat mission/);

  res = await app.request(`/api/swarm-project?workerId=${encodeURIComponent(assignment.id)}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.workerId, assignment.id);
  assert.equal(data.cwd, ctx.config.values.workspaceRoots[0].path);

  res = await app.request("/api/swarm-environment");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.mode, "openhanako-plugin");
  assert.equal(data.plugin.id, "hanaagent");

  res = await app.request(`/api/swarm-lifecycle?workerId=${encodeURIComponent(assignment.id)}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.workers.length, 1);
  assert.equal(data.workers[0].workerId, assignment.id);

  res = await app.request("/api/swarm-lifecycle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "request-handoff", workerId: assignment.id })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.match(data.prompt, /STATE: HANDOFF/);
  assert.match(ctx.bus.sends.at(-1).text, /STATE: HANDOFF/);

  res = await app.request("/api/swarm-direct-chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workerId: assignment.id, prompt: "Direct compat ping", limit: 2 })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.delivered, true);
  assert.equal(ctx.bus.sends.at(-1).text, "Direct compat ping");

  res = await app.request("/api/swarm-tmux-start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workerId: assignment.id })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.mode, "openhanako-managed-session");

  res = await app.request("/api/swarm-tmux-scroll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workerId: assignment.id, direction: "up", lines: 4 })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.direction, "up");

  res = await app.request("/api/swarm-orchestrator-loop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workerIds: [assignment.id], dryRun: true, staleMinutes: 1 })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.summary.unavailable, 0);
  assert.equal(data.results.length, 1);

  res = await app.request("/api/swarm-runtime/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workerIds: [assignment.id], reason: "test reset", actor: "test" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.resetCount, 1);

  res = await app.request("/api/swarm-tmux-stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workerId: assignment.id, reason: "test stop" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.mode, "openhanako-managed-session");
});

test("session history routes expose messages and sync checkpoints into mission assignments", async () => {
  const { app } = makeApp();

  let res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Sync history",
      maxWorkers: 1,
      sessionPath: "/sessions/primary.jsonl",
      agentId: "primary"
    })
  });
  assert.equal(res.status, 200);
  const created = await res.json();

  res = await app.request(`/api/session-history?sessionPath=${encodeURIComponent("/sessions/primary.jsonl")}&limit=10`);
  assert.equal(res.status, 200);
  const history = await res.json();
  assert.equal(history.ok, true);
  assert.equal(history.messages.length, 2);
  assert.match(history.messages[1].text, /STATE: DONE/);
  assert.equal(history.toolTrace.summary.tool, 1);
  assert.equal(history.toolTrace.summary.command, 1);
  assert.equal(history.toolTrace.summary.file, 1);
  assert.equal(history.toolTrace.summary.checkpoint, 1);

  res = await app.request("/api/checkpoints/sync-history", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionPath: "/sessions/primary.jsonl",
      taskId: created.tasks[0].id,
      missionId: created.mission.id,
      assignmentId: created.mission.assignments[0].id,
      agentId: "primary"
    })
  });
  assert.equal(res.status, 200);
  const synced = await res.json();
  assert.equal(synced.ok, true);
  assert.equal(synced.scanned, 2);
  assert.equal(synced.matched, 1);
  assert.equal(synced.created.length, 1);
  assert.equal(synced.created[0].checkpoint.source, "session-history");
  assert.equal(synced.created[0].missionUpdate.assignment.state, "done");
  assert.equal(synced.created[0].missionUpdate.assignment.tokenCount, 88);

  res = await app.request("/api/checkpoints/sync-history", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionPath: "/sessions/primary.jsonl",
      taskId: created.tasks[0].id,
      missionId: created.mission.id,
      assignmentId: created.mission.assignments[0].id
    })
  });
  assert.equal((await res.json()).created.length, 0);
});

test("session history externalizes large tool outputs into lazy artifacts", async () => {
  const largeOutput = `terminal log\n${"line with detailed output\n".repeat(260)}`;
  const { app } = makeApp({
    sessionHistoryMessages: [
      { id: "user-large-tool", role: "user", content: "run a long command", createdAt: "2026-01-01T00:00:00.000Z" },
      {
        id: "tool-large-output",
        role: "tool",
        toolName: "terminal",
        content: largeOutput,
        createdAt: "2026-01-01T00:01:00.000Z"
      }
    ]
  });

  let res = await app.request(`/api/session-history?sessionPath=${encodeURIComponent("/sessions/primary.jsonl")}&limit=10`);
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.messages.length, 2);
  assert.match(data.messages[1].text, /Full output stored as artifact/);
  assert.equal(data.messages[1].artifactPointer.fullContentAvailable, true);
  assert.equal(data.artifacts.length, 1);
  const artifactId = data.artifacts[0].artifactId;
  assert.match(artifactId, /^toolout_/);

  res = await app.request(`/api/artifacts?sessionId=${encodeURIComponent("/sessions/primary.jsonl")}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.summary.toolOutputs, 1);
  const artifact = data.artifacts.find((item) => item.artifactId === artifactId);
  assert.ok(artifact);
  assert.equal(artifact.kind, "terminal_log");
  assert.equal(artifact.content, "");
  assert.equal(artifact.contentSize > 4000, true);
  assert.match(artifact.summary, /Full output stored as artifact/);
  assert.equal(artifact.metadata.lazyLoaded, true);

  res = await app.request(`/api/artifacts/${encodeURIComponent(artifactId)}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.artifact.kind, "terminal_log");
  assert.equal(data.artifact.content, largeOutput.trimEnd());
});

test("tool artifacts infer Hermes artifact kinds and keep stable IDs", async () => {
  const largeFileRead = `diff --git a/app.js b/app.js\n${"read file line\n".repeat(360)}`;
  const { app } = makeApp({
    sessionHistoryMessages: [
      {
        id: "read-large-output",
        role: "tool",
        toolName: "read_file",
        toolCallId: "toolu-read-1",
        content: largeFileRead,
        createdAt: "2026-01-01T00:01:00.000Z"
      },
      {
        id: "skill-large-output",
        role: "tool",
        toolName: "skill_view",
        content: `# Skill\n${"skill docs\n".repeat(500)}`,
        createdAt: "2026-01-01T00:02:00.000Z"
      }
    ]
  });

  let res = await app.request(`/api/session-history?sessionPath=${encodeURIComponent("/sessions/primary.jsonl")}&limit=10`);
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.artifacts.length, 2);
  const firstIds = data.artifacts.map((artifact) => artifact.artifactId).sort();

  res = await app.request(`/api/session-history?sessionPath=${encodeURIComponent("/sessions/primary.jsonl")}&limit=10`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.deepEqual(data.artifacts.map((artifact) => artifact.artifactId).sort(), firstIds);

  res = await app.request(`/api/artifacts?sessionId=${encodeURIComponent("/sessions/primary.jsonl")}`);
  data = await res.json();
  assert.equal(
    data.artifacts.filter((artifact) => firstIds.includes(artifact.artifactId)).length,
    2,
    JSON.stringify({ firstIds, artifacts: data.artifacts.map((artifact) => ({ id: artifact.artifactId, kind: artifact.kind, toolCallId: artifact.toolCallId })) })
  );
  assert.equal(data.artifacts.some((artifact) => firstIds.includes(artifact.artifactId) && artifact.kind === "file_read" && artifact.toolCallId === "toolu-read-1"), true);
  assert.equal(data.artifacts.some((artifact) => firstIds.includes(artifact.artifactId) && artifact.kind === "skill_doc"), true);
  assert.equal(data.artifacts.every((artifact) => artifact.content === ""), true);
});

test("session export route downloads history as markdown, json, text, html, csv, and zip", async () => {
  const { app } = makeApp();
  const sessionPath = encodeURIComponent("/sessions/primary.jsonl");

  let res = await app.request(`/api/session-export?sessionPath=${sessionPath}&format=markdown`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/markdown/);
  assert.match(res.headers.get("content-disposition"), /primary\.md/);
  let body = await res.text();
  assert.match(body, /# HanaAgent Session Export/);
  assert.match(body, /STATE: DONE/);
  assert.match(body, /Tool Trace/);

  res = await app.request(`/api/session-export?sessionPath=${sessionPath}&format=json`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/json/);
  const json = JSON.parse(await res.text());
  assert.equal(json.ok, true);
  assert.equal(json.messageCount, 2);
  assert.equal(json.toolTrace.summary.tool, 1);

  res = await app.request(`/api/session-export?sessionPath=${sessionPath}&format=text`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/plain/);
  assert.match(await res.text(), /HanaAgent Session Export/);

  res = await app.request(`/api/session-export?sessionPath=${sessionPath}&format=html`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  body = await res.text();
  assert.match(body, /<!doctype html>/);
  assert.match(body, /STATE: DONE/);

  res = await app.request(`/api/session-export?sessionPath=${sessionPath}&format=csv`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/csv/);
  body = await res.text();
  assert.match(body, /index,role,createdAt,id,text/);
  assert.match(body, /assistant-tool-message/);

  res = await app.request(`/api/session-export?sessionPath=${sessionPath}&format=zip`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/zip/);
  assert.match(res.headers.get("content-disposition"), /primary\.zip/);
  const zip = Buffer.from(await res.arrayBuffer());
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.includes(Buffer.from("manifest.json")), true);
  assert.equal(zip.includes(Buffer.from("session.md")), true);
  assert.equal(zip.includes(Buffer.from("session.html")), true);
  assert.equal(zip.includes(Buffer.from("session.csv")), true);
  assert.equal(zip.includes(Buffer.from("tool-trace.json")), true);
});

test("session batch export route downloads selected and pinned histories", async () => {
  const { app } = makeApp();
  const sessionPath = encodeURIComponent("/sessions/primary.jsonl");

  let res = await app.request(`/api/session-export/batch?sessionPaths=${sessionPath}&format=json`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/json/);
  let json = JSON.parse(await res.text());
  assert.equal(json.ok, true);
  assert.equal(json.sessionCount, 1);
  assert.equal(json.sessions[0].sessionPath, "/sessions/primary.jsonl");
  assert.equal(json.sessions[0].messageCount, 2);

  res = await app.request(`/api/session-export/batch?sessionPaths=${sessionPath}&format=csv`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/csv/);
  const csv = await res.text();
  assert.match(csv, /sessionIndex,sessionPath,title,pinned,messageIndex,role,createdAt,id,text/);
  assert.match(csv, /assistant-tool-message/);

  res = await app.request(`/api/session-export/batch?sessionPaths=${sessionPath}&format=html`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  assert.match(await res.text(), /HanaAgent Session Batch Export/);

  res = await app.request("/api/defaults", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pinnedSessions: [{ sessionPath: "/sessions/primary.jsonl", title: "Primary Pin", agentId: "primary" }]
    })
  });
  assert.equal(res.status, 200);

  res = await app.request("/api/session-export/batch?mode=pinned&format=markdown");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition"), /hanaagent-session-batch-pinned\.md/);
  const markdown = await res.text();
  assert.match(markdown, /HanaAgent Session Batch Export/);
  assert.match(markdown, /Primary Pin/);
  assert.match(markdown, /STATE: DONE/);

  res = await app.request("/api/session-export/batch?mode=pinned&format=zip");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/zip/);
  assert.match(res.headers.get("content-disposition"), /hanaagent-session-batch-pinned\.zip/);
  const zip = Buffer.from(await res.arrayBuffer());
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.includes(Buffer.from("batch.md")), true);
  assert.equal(zip.includes(Buffer.from("batch.html")), true);
  assert.equal(zip.includes(Buffer.from("batch.csv")), true);
  assert.equal(zip.includes(Buffer.from("session.html")), true);
  assert.equal(zip.includes(Buffer.from("session.csv")), true);
  assert.equal(zip.includes(Buffer.from("session.json")), true);
});

test("terminal routes proxy host-managed terminal capabilities", async () => {
  const { app } = makeApp();

  let res = await app.request(`/api/terminals?sessionPath=${encodeURIComponent("/sessions/primary.jsonl")}`);
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.terminals[0].terminalId, "term_1");

  res = await app.request("/api/terminals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionPath: "/sessions/primary.jsonl", cwd: "/tmp/project" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.terminal.terminalId, "term_1");

  res = await app.request(`/api/terminals/term_1/read?sessionPath=${encodeURIComponent("/sessions/primary.jsonl")}&sinceSeq=0`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.output, "terminal output");

  res = await app.request("/api/terminals/term_1/write", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionPath: "/sessions/primary.jsonl", chars: "pwd\r" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.output, "pwd\r");

  res = await app.request("/api/terminals/term_1/close", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionPath: "/sessions/primary.jsonl" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.terminal.status, "killed");

  res = await app.request("/api/terminal-stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionPath: "/sessions/primary.jsonl", cwd: "/tmp/project", cols: 100, rows: 30 })
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/event-stream/);
  const streamText = await res.text();
  assert.match(streamText, /event: session/);
  assert.match(streamText, /\"terminalId\":\"term_1\"/);
  assert.match(streamText, /terminal output/);

  res = await app.request("/api/terminal-input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionPath: "/sessions/primary.jsonl", sessionId: "term_1", data: "ls\r" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.result.output, "ls\r");

  res = await app.request("/api/terminal-resize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "term_1", cols: 120, rows: 40 })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.cols, 120);

  res = await app.request("/api/terminal-close", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionPath: "/sessions/primary.jsonl", sessionId: "term_1" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.result.terminal.status, "killed");
});

test("task routes create, move, list, clear, and delete persisted tasks", async () => {
  const { app, dataDir } = makeApp();

  let res = await app.request("/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Route task",
      description: "created by route test",
      column: "backlog",
      priority: "high",
      sessionPath: "/sessions/primary.jsonl"
    })
  });
  assert.equal(res.status, 200);
  const created = await res.json();
  assert.equal(created.ok, true);
  assert.equal(created.task.column, "backlog");

  res = await app.request(`/api/tasks/${encodeURIComponent(created.task.id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Route task edited",
      description: "edited in modal route test",
      column: "running",
      priority: "medium",
      assignee: "qa",
      dueDate: "2026-06-10",
      tags: ["modal", "editor"],
      sessionPath: "/sessions/secondary.jsonl",
      missionId: "mission-modal",
      assignmentId: "assignment-modal"
    })
  });
  assert.equal(res.status, 200);
  let patched = await res.json();
  assert.equal(patched.task.title, "Route task edited");
  assert.equal(patched.task.column, "running");
  assert.equal(patched.task.assignee, "qa");
  assert.equal(patched.task.dueDate, "2026-06-10");
  assert.deepEqual(patched.task.tags, ["modal", "editor"]);
  assert.equal(patched.task.missionId, "mission-modal");

  res = await app.request(`/api/tasks/${encodeURIComponent(created.task.id)}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ column: "done" })
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).task.column, "done");

  res = await app.request("/api/tasks?includeDone=true");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).tasks.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "tasks.json"), "utf8")).tasks.length, 1);

  res = await app.request("/api/tasks/clear-done", { method: "POST" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, removed: 1 });

  res = await app.request("/api/tasks?includeDone=true");
  assert.equal((await res.json()).tasks.length, 0);
});

test("Hermes task aliases map Claude/Hermes task APIs to HanaAgent Kanban", async () => {
  const { app, ctx } = makeApp();

  let res = await app.request("/api/claude-tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Compat task", description: "alias route", column: "todo", priority: "high", assignee: "primary" })
  });
  assert.equal(res.status, 201);
  let data = await res.json();
  const taskId = data.task.id;
  assert.equal(data.task.column, "backlog");

  res = await app.request("/api/claude-tasks?include_done=true");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.tasks.some((task) => task.id === taskId), true);

  res = await app.request(`/api/claude-tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ column: "in_progress", due_date: "2026-06-10" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.task.column, "in_progress");
  assert.equal(data.task.due_date, "2026-06-10");

  res = await app.request(`/api/claude-tasks/${encodeURIComponent(taskId)}?action=move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ column: "review" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.task.column, "review");

  res = await app.request(`/api/hermes-tasks/${encodeURIComponent(taskId)}?action=launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: "primary", instructions: "Launch smoke" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.match(data.briefing, /Compat task/);
  assert.equal(ctx.bus.sends.at(-1).text.includes("Compat task"), true);

  res = await app.request("/api/claude-tasks-assignees");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.assignees.some((item) => item.id === "primary"), true);

  res = await app.request(`/api/hermes-tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
});

test("task move route reorders cards for drag and drop Kanban interactions", async () => {
  const { app } = makeApp();
  const created = [];
  for (const title of ["First", "Second", "Third"]) {
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, column: "backlog" })
    });
    assert.equal(res.status, 200);
    created.push((await res.json()).task);
  }

  let res = await app.request(`/api/tasks/${encodeURIComponent(created[2].id)}/move`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ column: "backlog", position: 1 })
  });
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.task.position, 1);

  res = await app.request("/api/tasks?includeDone=true&column=backlog");
  data = await res.json();
  assert.deepEqual(data.tasks.map((task) => task.title), ["First", "Third", "Second"]);
});

test("task batch route moves, updates, and deletes selected cards", async () => {
  const { app } = makeApp();
  const created = [];
  for (const title of ["Batch A", "Batch B", "Batch C"]) {
    const res = await app.request("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, column: "backlog", priority: "low" })
    });
    assert.equal(res.status, 200);
    created.push((await res.json()).task);
  }

  let res = await app.request("/api/tasks/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "move", taskIds: [created[0].id, created[1].id], column: "review" })
  });
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.processed.length, 2);

  res = await app.request("/api/tasks/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "update", taskIds: [created[0].id, "missing"], updates: { priority: "high" } })
  });
  assert.equal(res.status, 207);
  data = await res.json();
  assert.equal(data.processed.length, 1);
  assert.equal(data.failed[0].taskId, "missing");

  res = await app.request("/api/tasks/batch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "delete", taskIds: [created[1].id, created[2].id] })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.removed, 2);

  res = await app.request("/api/tasks?includeDone=true");
  data = await res.json();
  assert.deepEqual(data.tasks.map((task) => task.title), ["Batch A"]);
  assert.equal(data.tasks[0].priority, "high");
});

test("dispatch route includes checkpoint contract and can be tracked as a running task", async () => {
  const { app } = makeApp();

  const dispatch = await app.request("/api/dispatch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionPath: "/sessions/primary.jsonl",
      templateId: "build",
      mission: "ship the workbench",
      notes: "route smoke"
    })
  });
  assert.equal(dispatch.status, 200);
  const payload = await dispatch.json();
  assert.equal(payload.ok, true);
  assert.match(payload.prompt, /Checkpoint 合约/);

  const task = await app.request("/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "ship the workbench",
      column: "running",
      sessionPath: payload.sessionPath,
      templateId: payload.templateId
    })
  });
  assert.equal(task.status, 200);
  assert.equal((await task.json()).task.column, "running");
});

test("checkpoint routes parse worker status and move linked task lanes", async () => {
  const { app, dataDir } = makeApp();

  let res = await app.request("/api/tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: "Investigate blocker",
      column: "running",
      assignee: "primary",
      sessionPath: "/sessions/primary.jsonl"
    })
  });
  assert.equal(res.status, 200);
  const task = (await res.json()).task;

  res = await app.request("/api/checkpoints", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      taskId: task.id,
      sessionPath: "/sessions/primary.jsonl",
      agentId: "primary",
      text: [
        "STATE: BLOCKED",
        "FILES_CHANGED: none",
        "COMMANDS_RUN: npm test",
        "RESULT: blocked by host capability",
        "BLOCKER: session:history unavailable",
        "NEXT_ACTION: request host API"
      ].join("\n")
    })
  });
  assert.equal(res.status, 200);
  const checkpoint = await res.json();
  assert.equal(checkpoint.ok, true);
  assert.equal(checkpoint.checkpoint.state, "BLOCKED");
  assert.equal(checkpoint.checkpoint.columnSuggestion, "blocked");
  assert.equal(checkpoint.taskUpdate.task.column, "blocked");

  res = await app.request("/api/checkpoints", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      taskId: task.id,
      sessionPath: "/sessions/primary.jsonl",
      agentId: "primary",
      text: [
        "STATE: DONE",
        "RESULT: finished after retry",
        "NEXT_ACTION: verify"
      ].join("\n")
    })
  });
  assert.equal(res.status, 200);
  const conflicting = await res.json();
  assert.equal(conflicting.checkpoint.conflict, true);
  assert.equal(conflicting.taskUpdate, undefined);

  res = await app.request("/api/checkpoints");
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.conflicts.length, 1);
  assert.equal(data.conflicts[0].states.includes("BLOCKED"), true);
  assert.equal(data.conflicts[0].states.includes("DONE"), true);

  res = await app.request(`/api/checkpoints/${encodeURIComponent(conflicting.checkpoint.id)}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ resolvedBy: "route-test" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.accepted.state, "DONE");
  assert.equal(data.taskUpdate.task.column, "done");

  res = await app.request(`/api/checkpoints/${encodeURIComponent(data.accepted.id)}/reminder`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      reminderAt: "2026-01-01T00:00:00.000Z",
      note: "Verify accepted checkpoint"
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.reminder.checkpointId, data.checkpoint.id);
  assert.equal(data.reminder.reminderNote, "Verify accepted checkpoint");

  res = await app.request("/api/checkpoint-reminders?due=true&dueBefore=2026-01-01T00:01:00.000Z");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.summary.due, 1);
  assert.equal(data.reminders[0].reminderNote, "Verify accepted checkpoint");

  res = await app.request(`/api/checkpoints/${encodeURIComponent(data.reminders[0].checkpointId)}/reminder`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "trigger" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.triggered, true);
  assert.equal(Boolean(data.checkpoint.reminderTriggeredAt), true);

  res = await app.request(`/api/checkpoints/${encodeURIComponent(data.checkpoint.id)}/reminder`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "clear" })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.cleared, true);

  res = await app.request("/api/checkpoint-reminders?due=true&dueBefore=2026-01-01T00:01:00.000Z");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.summary.due, 0);

  res = await app.request("/api/overview");
  assert.equal(res.status, 200);
  const overview = await res.json();
  assert.equal(overview.overview.sections.checkpoints.total, 2);
  assert.equal(overview.overview.sections.checkpoints.conflicts.length, 0);
  assert.equal(overview.overview.sections.tasks.byColumn.done, 1);
  assert.equal(overview.workerCards[0].latestCheckpoint.state, "DONE");
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, "checkpoints.json"), "utf8")).checkpoints.length, 2);
});

test("review gate route blocks unsafe completion and allows explicit force completion", async () => {
  const { app } = makeApp();

  let res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "Gate mission completion", maxWorkers: 2, sessionPath: "/sessions/primary.jsonl" })
  });
  assert.equal(res.status, 200);
  let data = await res.json();
  const mission = data.mission;

  res = await app.request(`/api/missions/${encodeURIComponent(mission.id)}/review-gate`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.gate.status, "fail");
  assert.match(data.report, /Review Gate/);

  res = await app.request(`/api/missions/${encodeURIComponent(mission.id)}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 409);
  data = await res.json();
  assert.equal(data.error, "review_gate_failed");
  assert.equal(data.gate.status, "fail");

  res = await app.request(`/api/missions/${encodeURIComponent(mission.id)}/complete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ force: true })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.mission.state, "complete");
  assert.equal(data.gate.status, "fail");
  assert.equal(data.mission.events.some((event) => event.type === "review_gate"), true);
});

test("swarm launch creates dedicated worker sessions and dispatches each assignment", async () => {
  const { app, ctx } = makeApp();

  let res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "Launch dedicated workers", maxWorkers: 3, sessionPath: "/sessions/primary.jsonl", agentId: "primary" })
  });
  assert.equal(res.status, 200);
  const mission = (await res.json()).mission;

  res = await app.request(`/api/missions/${encodeURIComponent(mission.id)}/swarm-launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: "primary", cwd: "/tmp/workspace" })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.launched.length, 3);
  assert.equal(data.launched.every((item) => item.ok && item.sessionPath), true);
  assert.equal(new Set(data.launched.map((item) => item.sessionPath)).size, 3);
  assert.equal(data.mission.assignments.every((assignment) => assignment.state === "running" && assignment.sessionPath), true);
  assert.equal(ctx.bus.taskRequests.filter((item) => item.type === "task:register").length >= 3, true);
  assert.equal(data.mission.events.some((event) => event.type === "swarm_launch"), true);
});

test("worker drilldown aggregates session, task, checkpoint, run records, host jobs, and live chat send", async () => {
  const { app, ctx, workspaceRoot } = makeApp();
  fs.writeFileSync(path.join(workspaceRoot, "package.json"), JSON.stringify({
    name: "hanaagent-preview-app",
    packageManager: "npm@11.0.0",
    scripts: { dev: "vite", test: "node --test", build: "vite build" }
  }, null, 2));
  fs.mkdirSync(path.join(workspaceRoot, ".git"), { recursive: true });
  fs.writeFileSync(path.join(workspaceRoot, ".git", "HEAD"), "ref: refs/heads/feature/preview-metadata\n");

  let res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "Inspect worker drilldown", maxWorkers: 1, sessionPath: "/sessions/primary.jsonl", agentId: "primary" })
  });
  assert.equal(res.status, 200);
  const mission = (await res.json()).mission;
  const assignment = mission.assignments[0];

  res = await app.request(`/api/missions/${encodeURIComponent(mission.id)}/assignments/${encodeURIComponent(assignment.id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd: workspaceRoot })
  });
  assert.equal(res.status, 200);

  res = await app.request("/api/checkpoints", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      taskId: assignment.taskId,
      sessionPath: "/sessions/primary.jsonl",
      agentId: "primary",
      text: "STATE: DONE\nRESULT: drilldown evidence at http://localhost:5173/preview\nNEXT_ACTION: record artifact"
    })
  });
  assert.equal(res.status, 200);

  res = await app.request("/api/run-records", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "artifact",
      title: "Worker artifact",
      missionId: mission.id,
      assignmentId: assignment.id,
      taskId: assignment.taskId,
      sessionPath: "/sessions/primary.jsonl",
      content: "artifact body",
      summary: "Preview https://example.com/artifact"
    })
  });
  assert.equal(res.status, 200);

  res = await app.request("/api/host-tasks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      taskId: "host-drilldown-1",
      type: "hanaagent-assignment",
      sessionPath: "/sessions/primary.jsonl",
      agentId: "primary",
      meta: {
        missionId: mission.id,
        assignmentId: assignment.id,
        taskId: assignment.taskId
      }
    })
  });
  assert.equal(res.status, 200);

  res = await app.request(`/api/workers/${encodeURIComponent(assignment.id)}`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.assignment.id, assignment.id);
  assert.equal(data.ide.ok, true);
  assert.equal(data.ide.identity.sessionPath, "/sessions/primary.jsonl");
  assert.equal(data.ide.taskQueue.current.id, assignment.taskId);
  assert.equal(data.ide.artifacts.length, 1);
  assert.equal(data.ide.files.project.projectName, "hanaagent-preview-app");
  assert.equal(data.ide.files.project.branch, "feature/preview-metadata");
  assert.deepEqual(data.ide.files.project.packageScripts.slice(0, 3), ["dev", "test", "build"]);
  assert.equal(data.ide.previews.some((preview) => preview.url === "http://localhost:5173/preview"), true);
  assert.equal(data.ide.quickActions.some((action) => action.id === "open-preview" && action.enabled), true);
  assert.equal(data.ide.quickActions.some((action) => action.id === "sync-history" && action.enabled), true);
  assert.equal(data.sessions[0].path, "/sessions/primary.jsonl");
  assert.equal(data.tasks.length, 1);
  assert.equal(data.checkpoints.length, 1);
  assert.equal(data.runRecords.length, 1);
  assert.equal(data.hostTasks.length >= 1, true);
  assert.equal(data.usage.summary.totalTokens, 15);

  res = await app.request(`/api/workers/${encodeURIComponent(assignment.id)}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: "primary", cwd: "/tmp/workspace", title: "Drilldown Worker" })
  });
  assert.equal(res.status, 200);
  const ensured = await res.json();
  assert.equal(ensured.ok, true);
  assert.match(ensured.sessionPath, /^\/sessions\//);
  assert.equal(ensured.worker.ide.identity.sessionPath, ensured.sessionPath);

  res = await app.request(`/api/workers/${encodeURIComponent(assignment.id)}/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "continue this worker lane" })
  });
  assert.equal(res.status, 200);
  const sent = await res.json();
  assert.equal(sent.ok, true);
  assert.equal(sent.sessionPath, ensured.sessionPath);
  assert.deepEqual(ctx.bus.sends.at(-1), { sessionPath: ensured.sessionPath, text: "continue this worker lane" });

  res = await app.request("/api/workers/primary");
  assert.equal(res.status, 200);
  const agentData = await res.json();
  assert.equal(agentData.agent.id, "primary");
  assert.equal(agentData.summary.sessions >= 1, true);
});

test("worker lifecycle routes expose context pressure and request strict handoff prompts", async () => {
  const { app, ctx } = makeApp({
    usageEntries: [
      {
        requestId: "req-lifecycle",
        model: { provider: "openai", modelId: "gpt-5.5" },
        usage: { prompt_tokens: 410000, completion_tokens: 1500 },
        usageContext: {
          attribution: { agentId: "primary", sessionPath: "/sessions/primary.jsonl" },
          source: { subsystem: "session", operation: "reply" }
        }
      }
    ]
  });

  let res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "Lifecycle handoff", maxWorkers: 1, sessionPath: "/sessions/primary.jsonl", agentId: "primary" })
  });
  assert.equal(res.status, 200);
  const mission = (await res.json()).mission;
  const assignment = mission.assignments[0];

  res = await app.request(`/api/workers/${encodeURIComponent(assignment.id)}/lifecycle`);
  assert.equal(res.status, 200);
  let data = await res.json();
  assert.equal(data.lifecycle.state, "handoff_required");
  assert.equal(data.lifecycle.recommendedAction, "request-handoff");
  assert.equal(data.lifecycle.contextTokens, 411500);
  assert.equal(data.lifecycle.canRequestHandoff, true);

  res = await app.request(`/api/workers/${encodeURIComponent(assignment.id)}/handoff`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.ok, true);
  assert.match(data.prompt, /STATE: HANDOFF/);
  assert.match(data.prompt, /COMMANDS_RUN:/);
  assert.match(ctx.bus.sends.at(-1).text, /Worker Lifecycle Handoff/);
  assert.equal(ctx.bus.sends.at(-1).sessionPath, "/sessions/primary.jsonl");

  res = await app.request(`/api/missions/${encodeURIComponent(mission.id)}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.mission.events.some((event) => event.type === "worker_handoff_requested"), true);

  res = await app.request("/api/run-records?type=approval");
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.records.some((record) => record.meta?.kind === "worker-handoff" && record.state === "pending"), true);

  res = await app.request("/api/checkpoints", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      taskId: assignment.taskId,
      sessionPath: "/sessions/primary.jsonl",
      agentId: "primary",
      missionId: mission.id,
      assignmentId: assignment.id,
      text: [
        "STATE: HANDOFF",
        "FILES_CHANGED: plugins/hanaagent/lib/worker-lifecycle.js",
        "COMMANDS_RUN: npm test",
        "RESULT: durable handoff captured",
        "BLOCKER: none",
        "NEXT_ACTION: resume from handoff"
      ].join("\n")
    })
  });
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.handoff.ok, true);
  assert.equal(data.handoff.handoff.workerId, assignment.id.toLowerCase());
  assert.match(data.handoff.handoff.memoryPath, /memory\/handoffs\/swarm\/.+-latest\.md/);

  res = await app.request(`/api/handoffs/${encodeURIComponent(assignment.id)}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.handoff.assignmentId, assignment.id);
  assert.match(data.handoff.content, /durable handoff captured/);

  res = await app.request(`/api/memory/${encodeURIComponent(`handoff-${assignment.id.toLowerCase()}`)}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.entry.kind, "worker-handoff");

  res = await app.request(`/api/workers/${encodeURIComponent(assignment.id)}`);
  assert.equal(res.status, 200);
  data = await res.json();
  assert.equal(data.handoffs.length >= 1, true);
  assert.equal(data.ide.evidence.handoffs.length >= 1, true);
});

test("worker session ensure binds existing session when host create is unavailable", async () => {
  const { app, ctx } = makeApp({ disabledBusTypes: ["session:create"] });

  let res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "Bind existing worker session", maxWorkers: 1, sessionPath: "/sessions/primary.jsonl", agentId: "primary" })
  });
  assert.equal(res.status, 200);
  const mission = (await res.json()).mission;
  const assignment = mission.assignments[0];

  res = await app.request(`/api/workers/${encodeURIComponent(assignment.id)}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: "primary", cwd: "/tmp/workspace", title: "Fallback Worker" })
  });
  assert.equal(res.status, 200);
  const ensured = await res.json();
  assert.equal(ensured.ok, true);
  assert.equal(ensured.degraded, true);
  assert.equal(ensured.dedicated, false);
  assert.equal(ensured.sessionPath, "/sessions/primary.jsonl");
  assert.equal(ensured.worker.ide.identity.sessionPath, "/sessions/primary.jsonl");

  res = await app.request(`/api/workers/${encodeURIComponent(assignment.id)}/message`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "continue on bound session" })
  });
  assert.equal(res.status, 200);
  const sent = await res.json();
  assert.equal(sent.ok, true);
  assert.equal(sent.sessionPath, "/sessions/primary.jsonl");
  assert.deepEqual(ctx.bus.sends.at(-1), { sessionPath: "/sessions/primary.jsonl", text: "continue on bound session" });
});

test("worker session ensure rejects unknown fallback session paths", async () => {
  const { app } = makeApp({ disabledBusTypes: ["session:create"] });

  let res = await app.request("/api/missions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ goal: "Reject unknown worker session", maxWorkers: 1, sessionPath: "/sessions/not-real.jsonl", agentId: "primary" })
  });
  assert.equal(res.status, 200);
  const mission = (await res.json()).mission;
  const assignment = mission.assignments[0];

  res = await app.request(`/api/workers/${encodeURIComponent(assignment.id)}/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ agentId: "primary", cwd: "/tmp/workspace", title: "Fallback Worker" })
  });
  assert.equal(res.status, 503);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.equal(data.error, "existing_session_required");
  assert.equal(data.fallbackSessionPath, "/sessions/not-real.jsonl");
});
