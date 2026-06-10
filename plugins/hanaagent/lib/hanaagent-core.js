import { buildToolTrace } from "./tool-trace.js";
import { externalizeLargeToolOutputs } from "./tool-artifact-store.js";
import {
  deleteAgentProfile,
  getAgentProfile,
  listAgentProfiles,
  mergeAgentProfileConfig,
  saveAgentProfile
} from "./agent-profile-store.js";

const TEMPLATE_LIBRARY = [
  {
    id: "orchestrate",
    label: "任务编排",
    summary: "拆解目标、分配角色、给出检查点和交付标准。",
    prompt: [
      "你是 Hanaco 智能体工作台的编排者。",
      "请把下面目标拆解成可执行任务，标注负责人角色、输入、输出、风险和检查点。",
      "输出格式：任务列表、执行顺序、需要用户确认的问题、下一步行动。"
    ].join("\n")
  },
  {
    id: "research",
    label: "资料研究",
    summary: "整理背景、检索线索、形成可追踪研究结论。",
    prompt: [
      "你是 Hanaco 研究智能体。",
      "请围绕目标建立研究计划，区分事实、推断和待验证问题。",
      "输出格式：研究问题、来源计划、阶段结论、下一步。"
    ].join("\n")
  },
  {
    id: "build",
    label: "构建实现",
    summary: "面向代码/文档交付，要求给出修改计划和验证步骤。",
    prompt: [
      "你是 Hanaco 构建智能体。",
      "请基于目标制定实现方案，优先沿用现有项目结构，并列出验证命令。",
      "输出格式：变更计划、文件边界、验证方式、风险。"
    ].join("\n")
  },
  {
    id: "review",
    label: "审查复核",
    summary: "检查结果质量、风险、遗漏和回归测试。",
    prompt: [
      "你是 Hanaco 审查智能体。",
      "请审查目标相关工作，优先指出缺陷、风险、遗漏测试和可操作修复建议。",
      "输出格式：严重问题、一般问题、开放问题、建议结论。"
    ].join("\n")
  }
];

const CHECKPOINT_CONTRACT = [
  "STATE: DONE | BLOCKED | NEEDS_INPUT | HANDOFF | IN_PROGRESS | NEEDS_REVIEW",
  "FILES_CHANGED: exact paths or none",
  "COMMANDS_RUN: exact commands or none",
  "RESULT: concrete result/proof",
  "BLOCKER: blocker or none",
  "NEXT_ACTION: exact recommended next action"
];

const PARITY_STATUSES = [
  "plugin-implemented",
  "host-provided",
  "capability-gated",
  "out-of-scope-for-plugin",
  "missing"
];

const HERMES_PARITY_MATRIX = [
  {
    id: "frontend-screens",
    label: "Frontend screens and workbench surfaces",
    items: [
      {
        id: "conductor-chat-agent-view",
        label: "Chat, Agent View, Research Card, tabbed/collapsible Inspector panel, scroll-to-bottom, empty state, smooth streaming, typing indicator, Markdown/code/thinking message rendering, expandable tool-call details, session list filtering, session fork, aliases, tombstones, live events, history, and tool traces",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/workbench researchCardPanel embedded display with buildResearchCard(), copyResearchCard(), saveResearchCardToMemory(), recordResearchCardArtifact(); smoothStreamTick(), streaming-indicator, streaming-cursor, and streaming-skeleton for live text_delta reveal; inspectorPanel with inspector-tabs, inspector-tab, inspectorCollapseBtn, and toggleInspectorCollapsed() for Activity/Context/Tools/Knowledge/Worker panes; workerOutputScrollBtn scroll-to-bottom control, chat-empty-state onboarding actions, message-preview renderer with safe Markdown/code blocks/copy/thinking/tool pills and expandable message-tool-detail panels for tool calls, tool results, commands, files, checkpoints, and errors; local session sidebar filter, /api/session-fork, /api/sessions with sessionAliases/sessionTombstones, /api/session-history plus key/sessionKey alias, /api/session-send, /api/session-events, buildToolTrace(); tool-artifact-store.js mirrors Hermes artifact-backed tool outputs by externalizing >4KB session:history tool results to stable toolout_* records with summary/preview/pointer"
      },
      {
        id: "dashboard-overview",
        label: "Dashboard overview and runtime aggregator",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/overview sections for agents, sessions, missions, tasks, usage plus mission/assignment/session attribution, workers, incidents"
      },
      {
        id: "agenda-calendar",
        label: "Agenda and Calendar views for attention, active missions, due tasks, upcoming jobs, approvals, and dated work",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/agenda aggregates Hermes AgendaView-style attention/active/tasks/upcoming/recent/agent sections from missions, tasks, jobs, approvals, failures, and host agents; /workbench renders Agenda attention/active/tasks/upcoming/completed/agents as collapsible sections with counts and Hide/Show state, and each row can open its mission, task editor, worker drilldown, approval queue item, Run Console record, job detail, or agenda detail; /api/calendar aggregates Hermes CalendarView-style day/week/month events from mission starts, task due dates, pending approvals, and recurring jobs expanded from daily/weekly/monthly/5-field cron schedules, including cron step/range/list syntax for minutes, hours, weekdays, and month days; Calendar supports local/UTC/IANA timezone selection via query or workbenchSettings.calendarTimezone and returns dayKey/localTime/timezone so recurring jobs expand on the selected wall-clock time; /workbench renders Calendar controls with day/week/month mode, previous/today/next navigation, timezone display, month/week grids, day hour axis, event open, copy summary, and type-aware drilldown into missions, tasks, approvals, and jobs"
      },
      {
        id: "files-editor-preview",
        label: "Files browser, project metadata, upload, preview, download, diff, patch review, write, rename, delete",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/paths and /api/files?action=list|read|download plus POST /api/files provide Hermes Files API aliases over workspaceRoots; /api/workspace-files, /api/workspace-file/upload, /api/workspace-file, /api/workspace-file/diff, /api/workspace-file/patch-review accept/reject, workspaceRoots sandbox; worker-ide files.project reads package.json scripts and .git/HEAD branch only inside authorized workspace roots"
      },
      {
        id: "terminal-surface",
        label: "Terminal attach, read, write, close, status, and xterm-style TUI controls",
        status: "capability-gated",
        owner: "openhanako + hanaagent",
        evidence: "/api/terminals proxies terminal:list/start/read/write/close; /api/terminal-stream, /api/terminal-input, /api/terminal-resize, and /api/terminal-close provide Hermes terminal aliases over OpenHanako host-managed terminals; /workbench terminalFrame, terminal-screen ANSI renderer, command history, quick commands, clear, copy, auto-read status",
        notes: "Plugin renders and controls the surface; PTY creation remains a host responsibility."
      },
      {
        id: "memory-browser",
        label: "Memory list, read, search/edit fallback",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/memory, /api/memory/:memoryId, local memory store fallback"
      },
      {
        id: "skills-browser",
        label: "Skills browser and skill inventory",
        status: "capability-gated",
        owner: "openhanako + hanaagent",
        evidence: "/api/agent-skills, /api/agents/:agentId/skills, /api/integrations",
        notes: "Install/enable flows depend on host skill registry handlers."
      },
      {
        id: "jobs-automation",
        label: "Jobs, schedules, background automation, and upcoming schedule visibility",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/jobs, job scheduler, autopilot schedule/tick, /api/agenda upcomingJobs, /api/calendar job events"
      },
      {
        id: "settings-provider-config",
        label: "Provider/settings configuration, inline model chooser, 8-theme system, and local workbench preferences",
        status: "plugin-implemented",
        owner: "openhanako + hanaagent",
        evidence: "OpenHanako model/provider settings plus hanaagent capability/readiness panels and /workbench modelChooserBackdrop inline provider/model chooser; workbenchSettings via /api/defaults for themePreset covering Hermes/Claude Official/Classic/Slate/Mono light+dark variants, accent/editor/usage threshold/system metrics/mobile nav/calendar timezone"
      }
    ]
  },
  {
    id: "backend-apis",
    label: "Backend API endpoints",
    items: [
      {
        id: "chat-sessions-api",
        label: "Chat, session create/list/status/send/history/abort",
        status: "capability-gated",
        owner: "openhanako + hanaagent",
        evidence: "session:* bus probes and /api/sessions, /api/dispatch, /api/session-* routes; /api/send, /api/send-stream, /api/history, /api/events, and /api/chat-events provide Hermes Chat/Messaging aliases over OpenHanako session:send/session:history/session-events; /api/session-send maps Hermes ControlSuite sessionKey/message into OpenHanako session:send"
      },
      {
        id: "mission-task-checkpoint-api",
        label: "Missions, assignments, filtered/editable/reorderable/batch task board with saved views, WIP limits, shortcuts, checkpoints, checkpoint reminders, review gate",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/missions, /api/tasks, board search/assignee/priority filters, savedBoardViews and boardWipLimits in /api/defaults, focused task keyboard shortcuts, drag/drop reorder via /api/tasks/:taskId/move, batch move/update/delete via /api/tasks/batch, full task editor via PATCH /api/tasks/:taskId, Hermes /api/claude-tasks and /api/hermes-tasks aliases with launch action, /api/checkpoints, /api/checkpoint-reminders, /api/checkpoints/:checkpointId/reminder, /api/review-gate, /api/inbox"
      },
      {
        id: "files-memory-skills-api",
        label: "Files, memory, skills, integrations",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/workspace-*, /api/memory*, /api/agent-skills, /api/integrations"
      },
      {
        id: "terminal-api",
        label: "Terminal session API",
        status: "capability-gated",
        owner: "openhanako + hanaagent",
        evidence: "/api/terminals routes proxy host terminal:* capabilities; Hermes /api/terminal-stream/input/resize/close aliases are provided without plugin-owned PTY spawning"
      },
      {
        id: "auth-security-api",
        label: "Authentication, authorization, plugin token enforcement",
        status: "host-provided",
        owner: "openhanako",
        evidence: "OpenHanako plugin route token/auth boundary; plugin path checks for file/memory operations"
      }
    ]
  },
  {
    id: "orchestration",
    label: "Conductor, Swarm, and worker IDE",
    items: [
      {
        id: "swarm-conductor",
        label: "Conductor mission planning, SwarmBrief contracts, compact Swarm Hub, dispatch, roster-aware broadcast, stop, complete, continue",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "mission-store, /api/conductor-spawn, /api/conductor-stop, /api/missions/:id/briefs, /api/missions/:id/assignments/:assignmentId/brief, /api/missions/:id/dispatch|broadcast|stop|complete|continue; dispatch and broadcast prompts include Hermes-style SwarmBrief YAML plus checkpoint contract; /api/missions/:id/broadcast respects assignment.roster.acceptsBroadcast by default, records broadcast mission events, and sends checkpoint-bearing follow-up prompts through OpenHanako session:send; /api/missions/:id/continue creates continuation mission/tasks and by default reuses or creates a worker session before sending the continuation brief through OpenHanako session:send, with dispatch:false for plan-only continuation; /workbench officeView swarm-hub-card with main agent identity, swarm/active/room/blocker metrics, lane wires, and routing/autopilot/inbox/refresh controls"
      },
      {
        id: "hermes-swarm-api-compat",
        label: "Hermes Swarm API compatibility aliases for roster, dispatch, missions, checkpoint, runtime, health, chat, decomposition, Kanban, memory, reports, project, environment, lifecycle, terminal, direct chat, orchestrator loop, and runtime reset",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/swarm-roster GET/POST maps Hermes roster workers into Operations profiles; /api/swarm-dispatch accepts workerIds+prompt or assignments[] and creates/dispatches HanaAgent missions with SwarmBrief output; /api/swarm-missions lists, reports, and cancels missions or assignments; /api/swarm-checkpoint accepts worker runtime checkpoint shape and writes checkpoint/mission/task/host-task state through existing OpenHanako-safe stores; /api/swarm-runtime, /api/swarm-health, and /api/swarm-chat expose worker observability from OpenHanako sessions, assignments, tasks, checkpoints, run records, and session history; /api/swarm-decompose returns deterministic fallback assignments plus Hermes JSON-only orchestratorPrompt/rosterText and can dispatch that prompt through OpenHanako session:send; /api/swarm-kanban, /api/swarm-memory, /api/swarm-reports, /api/swarm-project, /api/swarm-environment, /api/swarm-lifecycle, /api/swarm-tmux-start|stop|scroll, /api/swarm-direct-chat, /api/swarm-orchestrator-loop, and /api/swarm-runtime/reset provide OpenHanako-safe aliases for the remaining Hermes swarm-* surfaces without directly manipulating Hermes tmux/profile files"
      },
      {
        id: "worker-cards-ide",
        label: "Worker cards, tabbed multi-pane Worker IDE, preview-to-fix task capture, patch review handoff, lifecycle controls, and durable handoff memory",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/workers, /api/workers/:workerId, /api/workers/:workerId/lifecycle, /api/workers/:workerId/handoff, /api/handoffs, /api/handoffs/:workerId, worker-ide.js, worker-lifecycle.js, handoff-store.js; /workbench worker-ide-shell with hub, lane map, Worker IDE panes for Overview/Chat/Queue/Terminal/Preview/Files/Evidence; Project Metadata and Dev Scripts cards show projectName/cwd/branch/package scripts from files.project; worker-visual-picker and createPreviewFixTask() create backlog tasks from preview URL, selector, issue, worker, session, mission, and assignment evidence; Files panel can turn diffs into approval records and accept/reject patch reviews; lifecycle state exposes healthy/watch/handoff_required/renew_required and can dispatch strict STATE: HANDOFF prompts; HANDOFF checkpoints materialize latest/archive markdown under memory/handoffs/swarm and appear in Memory plus Worker Evidence"
      },
      {
        id: "run-console-records",
        label: "Artifacts, approvals queue/history, categorized learnings, run comparison, and materialized files",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/run-records, /api/run-learnings, /api/run-compare, /api/approvals, /api/gateway/approvals, /api/approvals/:approvalId/:action, /api/gateway/approvals/:approvalId/:action, /api/artifacts, /api/artifacts/:artifactId, /api/missions/:id/report-artifact, /api/missions/:id/assignments/:assignmentId/brief/artifact, materializeRunRecordFile(), SessionFile staging; /api/artifacts merges Run Console artifacts with Hermes Tool Output Artifacts from dataDir/tool-artifacts, lists metadata/preview only, preserves terminal_log/file_read/diff/skill_doc/tool_output kinds, and lazy-loads full content through /api/artifacts/:artifactId; /workbench Run Console mirrors Hermes RunLearnings success/failure/optimization filters and RunCompare side-by-side status/duration/token/cost/agent/artifact/approval/learning metrics; Mission Report and SwarmBrief can be recorded as versioned Run artifacts with materialized files and preview; approvalsPanel mirrors Hermes Approvals Page/Bell queue with pending/history, risk labels, open, approve, deny, copy, and mission/worker drilldown"
      },
      {
        id: "autopilot-routing",
        label: "Autopilot routing, stale scans, review requests, escalation, scheduler",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/autopilot, /api/autopilot/tick, /api/missions/:id/autopilot"
      },
      {
        id: "operations-profiles",
        label: "Operations presets, readiness, dynamic roster lanes, profile missions, and Hermes swarm roster import/export",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/operations, /api/operations/presets, /api/operations/profiles, /api/operations/profiles/:profileId/swarm-roster, /api/operations/swarm-roster/import; operation-profiles.js preserves Hermes swarm.yaml worker metadata including specialty/model/mission/profile/modes/tools/skills/capabilities/preferredTaskTypes/greenlightRequiredFor/maxConcurrentTasks/acceptsBroadcast/plugins/pluginToolsets/mcpServers/wrapper/defaultCwd; mission-store.js builds dynamic assignments from imported roster lanes and keeps assignment.roster for worker tools/skills/greenlight evidence"
      }
    ]
  },
  {
    id: "architecture-integrations",
    label: "Architecture and integrations",
    items: [
      {
        id: "gateway-capability-probes",
        label: "Gateway/capability probing and degraded-mode UI",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "hasBusCapability(), computeHostGaps(), /api/state capabilities, Setup Doctor with structured repair actions, setup-repair buttons for Provider Setup/Model Chooser/session/files/terminal/context/operations, connectionBanner health banner, backend-unavailable/degraded/blocked states"
      },
      {
        id: "event-bus-runtime",
        label: "Event bus and live session feed",
        status: "capability-gated",
        owner: "openhanako + hanaagent",
        evidence: "ctx.bus.request probes plus /api/session-events SSE"
      },
      {
        id: "run-store-persistence",
        label: "Run/task/mission/job persistence",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "dataDir JSON stores for missions, tasks, checkpoints, jobs, profiles, run records"
      },
      {
        id: "mcp-provider-catalog",
        label: "MCP, providers, plugins, capabilities integration catalog",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "integration-catalog.js, /api/integrations, /api/integrations/action, plus Hermes infra aliases /api/auth, /api/auth-check, /api/ping, /api/workspace, /api/plugins, /api/mcp, /api/skills, /api/local-providers, /api/provider-usage, /api/system-metrics, /api/connection-settings, /api/config-patch, /api/gateway-reprobe, /api/start-agent, /api/start-claude, /api/claude-update, /api/crew-status, /api/oauth/device-code, /api/oauth/poll-token, /api/media, /api/preview-file, /api/transcribe, /api/playground-admin, /api/playground-npc, /api/vt-capital, plus nested profiles/knowledge/mcp/sessions/skills/update/dashboard aliases; recursive Hermes API alias diff is zero for the plugin-safe compatibility scope"
      },
      {
        id: "workspace-agents-checkpoints",
        label: "Workspace agents and file checkpoints",
        status: "capability-gated",
        owner: "openhanako + hanaagent",
        evidence: "agent:list, checkpoint:list, checkpoint:find-by-session-since proxies"
      }
    ]
  },
  {
    id: "ux-security-deployment",
    label: "UX, security, mobile, and deployment",
    items: [
      {
        id: "command-center-search-export",
        label: "Command palette, search, slash commands, voice input, file attachments, session history search, rich message preview, reports, Markdown/batch/zip export, session fork, context usage meter, session title suggestions",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/search with session:history scanning, message-preview safe Markdown/code/thinking/tool-pill renderer, mission reports/export, /api/session-export and /api/session-export/batch with Markdown/JSON/Text/HTML/CSV/ZIP bundle formats, /api/session-fork, /api/context-usage, /api/session-title, Hermes-style Command Palette via ⌘K with executable workbench commands, command center UI, Mission slash command menu, browser Web Speech voice input, browser FileReader attachment context"
      },
      {
        id: "smart-model-suggestions",
        label: "Smart model suggestions, inline model chooser, model metadata, draggable pinned model/session management, saved workbench modes, toast notifications, and onboarding tour",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/model-suggestions, modelChooserBackdrop aggregating smart suggestions/pinned/modelMetadata/current/session models with search/source filter/apply/pin/copy actions, modelMetadata context/price data, pinnedModels, pinnedSessions, workbenchModes + activeWorkbenchModeId + workbenchNotifications + workbenchOnboarding via /api/defaults, Pinned panel select/default/up-down reorder/drag-drop reorder/apply/remove actions, Modes panel save/apply/rename/delete/drift, in-app toastStack/error toast/model suggestion toast, Web Audio notification sounds, browser Notification option, navigator.vibrate haptics, onboarding tour modal with setup/mission/board/runtime/files/run-console steps, Setup Doctor repair actions that open Provider Setup/Model Chooser and other runtime panels, Agent Runtime suggestion panel"
      },
      {
        id: "path-security-validation",
        label: "Path traversal, symlink boundary, input validation",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "workspace-files.js and memory-store.js path guards"
      },
      {
        id: "responsive-plugin-ui",
        label: "Responsive OpenHanako iframe workbench UI with mobile header, hamburger menu, sessions panel, and tab bar",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/workbench single-page responsive layout, mobilePageHeader, mobileSessionsDrawer/mobileSessionsPanel, mobile hamburger trigger, mobileTabBar bottom navigation, mobileChatNavMode dock/integrated/scroll-hide, section jump targets for control/conductor/board/runtime/files/terminal"
      },
      {
        id: "pwa-electron-docker",
        label: "Hermes standalone PWA/Electron/Docker deployment",
        status: "out-of-scope-for-plugin",
        owner: "openhanako deployment",
        evidence: "HanaAgent ships as an OpenHanako plugin zip/manifest instead of a standalone app"
      },
      {
        id: "standalone-hermes-installer",
        label: "Hermes Agent installer and gateway auto-start",
        status: "out-of-scope-for-plugin",
        owner: "openhanako deployment",
        evidence: "OpenHanako owns process/model lifecycle; HanaAgent probes capabilities after install"
      }
    ]
  }
];

function cloneParityItem(item) {
  return { ...item };
}

function summarizeParityMatrix(categories) {
  const summary = {
    total: 0,
    pluginImplemented: 0,
    hostProvided: 0,
    capabilityGated: 0,
    outOfScopeForPlugin: 0,
    missing: 0,
    inPluginScopeMissing: 0,
    completeForPluginScope: true
  };
  for (const category of categories) {
    for (const item of category.items || []) {
      summary.total += 1;
      if (item.status === "plugin-implemented") summary.pluginImplemented += 1;
      else if (item.status === "host-provided") summary.hostProvided += 1;
      else if (item.status === "capability-gated") summary.capabilityGated += 1;
      else if (item.status === "out-of-scope-for-plugin") summary.outOfScopeForPlugin += 1;
      else if (item.status === "missing") summary.missing += 1;
      if (item.status === "missing" && item.owner !== "openhanako deployment") summary.inPluginScopeMissing += 1;
    }
  }
  summary.completeForPluginScope = summary.inPluginScopeMissing === 0;
  return summary;
}

const WORKBENCH_BLUEPRINT = {
  reference: "reference/hermes-workspace-main",
  thesis: "HanaAgent should evolve from a prompt dispatcher into a capability-gated control plane for agent sessions, tasks, checkpoints, and worker cards.",
  currentCoverage: [
    { id: "agent-session-probe", label: "Agent/session probe", status: "implemented" },
    { id: "mission-dispatch", label: "Mission dispatch to existing session", status: "implemented" },
    { id: "workflow-templates", label: "Workflow prompt templates", status: "implemented" },
    { id: "persistent-task-board", label: "Persistent task board with saved views, WIP limits, keyboard shortcuts, search, assignee/priority filters, drag/drop ordering, batch actions, and full card editing", status: "implemented" },
    { id: "capability-overview", label: "Capability overview", status: "implemented" },
    { id: "checkpoint-inbox", label: "Checkpoint inbox with conflict resolution and due reminders", status: "implemented" },
    { id: "worker-cards", label: "Worker cards from sessions/tasks/checkpoints", status: "implemented" },
    { id: "tool-call-rendering", label: "Tool calls, tool results, commands, files, checkpoints, error trace rendering, expandable details, copy actions, and safe Markdown/code/thinking message preview", status: "implemented" },
    { id: "live-session-events", label: "Live session event stream with smooth text reveal, typing indicator, Agent View feed, and Inspector activity summary", status: "implemented" },
    { id: "agent-runtime-profile", label: "Agent config/runtime profile", status: "implemented" },
    { id: "usage-ledger", label: "Usage/cost ledger with mission and assignment attribution", status: "implemented" },
    { id: "host-task-runtime", label: "Host task/job runtime", status: "implemented" },
    { id: "agenda-calendar", label: "Agenda / Calendar aggregation for active missions, due tasks, recurring jobs, approvals, and dated work", status: "implemented" },
    { id: "run-console-records", label: "Artifacts, lazy tool-output artifacts, approvals, categorized learnings, run comparison, Mission Report artifacts, and SwarmBrief artifacts", status: "implemented" },
    { id: "artifact-files", label: "Artifact file materialization and SessionFile staging", status: "implemented" },
    { id: "batch-session-export", label: "Batch, pinned, HTML, CSV, and ZIP session export bundles", status: "implemented" },
    { id: "autopilot-routing", label: "Autopilot routing suggestions, dispatch, stale-worker scan, escalation, and scheduler", status: "implemented" },
    { id: "operations-profile-presets", label: "Operations profile presets, readiness dashboard, dynamic roster dispatch, and Hermes swarm roster import/export", status: "implemented" },
    { id: "integration-catalog", label: "MCP, skills, plugin, and capability integration catalog", status: "implemented" },
    { id: "skills-memory-readonly", label: "Host skills, host memory, and local editable memory surfaces", status: "implemented" },
    { id: "worker-session-lifecycle", label: "Dedicated worker session create/status", status: "implemented" },
    { id: "continuation-worker-dispatch", label: "Continuation missions create tasks and auto-dispatch worker briefs through OpenHanako sessions", status: "implemented" },
    { id: "worker-context-lifecycle", label: "Swarm2 worker lifecycle context policy, handoff_required/renew_required states, strict handoff prompt dispatch, and durable handoff files", status: "implemented" },
    { id: "session-alias-rename", label: "Session alias rename overlay for Hermes-style sidebar titles", status: "implemented" },
    { id: "session-sidebar-filter", label: "Session sidebar local filtering by title, alias, path, agent, cwd, and model", status: "implemented" },
    { id: "session-tombstones", label: "Session tombstones for workbench delete/hide cleanup", status: "implemented" },
    { id: "session-fork", label: "Session fork/duplicate workflow with continuation prompt", status: "implemented" },
    { id: "session-history-search", label: "Session search across recent host history", status: "implemented" },
    { id: "research-card", label: "Embedded Research Card generated from mission, notes, session history, tool trace, memory, and worker output", status: "implemented" },
    { id: "command-palette", label: "Hermes-style Command Palette with searchable executable workbench commands", status: "implemented" },
    { id: "context-usage-meter", label: "Context usage meter with model metadata context windows and threshold alerts", status: "implemented" },
    { id: "terminal-surface", label: "Host-managed terminal attach, xterm-style TUI screen, live read, write, close, history, quick commands, copy, and status surface", status: "implemented" },
    { id: "files-editor-preview", label: "Workspace files upload, editor, preview, diff, patch review accept/reject, and save surfaces", status: "implemented" },
    { id: "auto-session-titles", label: "Auto-generated session title suggestions from history", status: "implemented" },
    { id: "pinned-management", label: "Pinned session/model select, default, drag/drop reorder, apply, and remove actions", status: "implemented" },
    { id: "smart-model-suggestions", label: "Smart model suggestions and inline model/provider chooser from mission profile, pinned models, current session, and model metadata", status: "implemented" },
    { id: "eight-theme-system", label: "Hermes-style theme presets for Claude Official, Classic, Slate, Mono, and light variants", status: "implemented" },
    { id: "toast-system", label: "Hermes-style toast, error-toast, and model-suggestion-toast stack", status: "implemented" },
    { id: "mobile-tabbar", label: "Mobile page header, hamburger sessions panel, mobile tab bar, and mobile chat nav modes for workbench section jumps", status: "implemented" },
    { id: "connection-health-banner", label: "Connection overlay, health banner, and backend unavailable state", status: "implemented" },
    { id: "onboarding-tour", label: "Hermes-style onboarding tour with persisted completion/dismiss state and executable Setup Doctor repair actions", status: "implemented" }
  ],
  phases: [
    {
      id: "phase-1",
      label: "稳定工作台骨架",
      summary: "Expose blueprint, capabilities, workflow templates, route smoke tests, and visible gaps."
    },
    {
      id: "phase-2",
      label: "持久任务与 overview 聚合",
      summary: "Move tasks from localStorage to ctx.dataDir and add a server-side overview aggregator."
    },
    {
      id: "phase-3",
      label: "Mission / Checkpoint 闭环",
      summary: "Inject checkpoint contracts, parse worker checkpoints, route status into inbox and board lanes, and notify due checkpoint reminders."
    },
    {
      id: "phase-4",
      label: "Worker cards",
      summary: "Show real agent/session state, current task, queue, recent messages, quick actions, and a tabbed multi-pane Worker IDE per worker."
    },
    {
      id: "phase-5",
      label: "IDE surfaces",
      summary: "Gate and attach memory, skills, files, previews, and terminal only through stable Hana host APIs."
    },
    {
      id: "phase-6",
      label: "Autopilot",
      summary: "Add auditable routing suggestions, stale-worker detection, blocked escalation, and review gates."
    }
  ],
  hostRequests: [
    "session:create",
    "session:history",
    "session:status",
    "session:abort",
    "agent:config",
    "agent:skills",
    "usage:list",
    "checkpoint:list",
    "checkpoint:find-by-session-since",
    "deferred:register",
    "deferred:query",
    "deferred:list-pending",
    "deferred:resolve",
    "deferred:fail",
    "deferred:abort",
    "memory:list",
    "memory:read",
    "task:list",
    "task:register",
    "task:query",
    "task:update"
  ]
};

export function getTemplates() {
  return TEMPLATE_LIBRARY.map((item) => ({ ...item }));
}

export function getCheckpointContract() {
  return [...CHECKPOINT_CONTRACT];
}

export function getParityMatrix() {
  const categories = HERMES_PARITY_MATRIX.map((category) => ({
    ...category,
    items: (category.items || []).map(cloneParityItem)
  }));
  return {
    reference: WORKBENCH_BLUEPRINT.reference,
    statuses: [...PARITY_STATUSES],
    summary: summarizeParityMatrix(categories),
    categories
  };
}

export function buildModelSuggestions(input = {}) {
  const goal = clean(input.goal || input.mission || input.prompt);
  const notes = clean(input.notes);
  const mode = clean(input.mode) || "dispatch";
  const templateId = clean(input.templateId);
  const agentId = clean(input.agentId);
  const pinnedModels = Array.isArray(input.pinnedModels) ? input.pinnedModels : [];
  const modelMetadata = normalizeModelMetadata(input.modelMetadata);
  const agentConfig = input.agentConfig && typeof input.agentConfig === "object" ? input.agentConfig : {};
  const currentModel = clean(input.currentModel || agentConfig.model || agentConfig.models?.chat || agentConfig.chatModel);
  const text = `${goal}\n${notes}\n${mode}\n${templateId}`.toLowerCase();
  const signals = {
    coding: /code|coding|build|implement|refactor|test|debug|代码|实现|构建|测试|修复|插件|api|前端|后端/.test(text),
    review: /review|audit|risk|security|qa|verify|复核|审查|风险|安全|验证|测试/.test(text) || mode === "review" || templateId === "review",
    research: /research|source|compare|investigate|资料|研究|检索|来源|对比/.test(text) || templateId === "research",
    longContext: text.length > 700 || /large|complex|multi|系统|完整|复杂|多智能体/.test(text),
    fastDraft: /quick|fast|draft|simple|低成本|快速|草稿|简单/.test(text)
  };
  const targetTier = signals.coding || signals.review || signals.longContext
    ? "high-capability"
    : signals.fastDraft
      ? "fast"
      : signals.research
        ? "balanced"
        : "balanced";
  const candidates = normalizeSuggestionCandidates({ pinnedModels, currentModel, agentId, modelMetadata });
  const recommendations = candidates
    .map((candidate) => scoreModelCandidate(candidate, { signals, targetTier }))
    .sort((a, b) => b.score - a.score || a.model.localeCompare(b.model))
    .slice(0, 5);
  if (!recommendations.length) {
    recommendations.push({
      model: "",
      provider: "",
      tier: targetTier,
      source: "setup",
      score: 0,
      reason: "No configured or pinned model is available. Configure an OpenHanako model or pin a preferred model first.",
      action: "configure-model"
    });
  }
  return {
    ok: true,
    targetTier,
    signals,
    recommendations,
    toast: recommendations[0]?.model
      ? `Suggested ${recommendations[0].model} for ${targetTier} work.`
      : "Configure a model before running real workers."
  };
}

export function buildSessionTitleSuggestion(input = {}) {
  const sessionPath = clean(input.sessionPath);
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const currentTitle = clean(input.currentTitle || input.title);
  const candidates = [];

  const existing = sessionTitleFromCurrentTitle(currentTitle);
  if (existing) candidates.push(candidate(existing, "current-title", 55));

  for (const message of messages.slice(0, 12)) {
    const role = clean(message?.role || message?.author || message?.type).toLowerCase();
    const text = titleSourceText(message);
    if (!text) continue;
    const baseScore = role === "user" ? 100 : role === "assistant" ? 70 : 60;
    const fromExplicit = titleFromExplicitGoal(text);
    if (fromExplicit) candidates.push(candidate(fromExplicit, "explicit-goal", baseScore + 25));
    const fromCheckpoint = titleFromCheckpoint(text);
    if (fromCheckpoint) candidates.push(candidate(fromCheckpoint, "checkpoint", baseScore + 10));
    const fromSentence = titleFromSentence(text);
    if (fromSentence) candidates.push(candidate(fromSentence, role === "user" ? "first-user-message" : "message", baseScore));
  }

  const pathTitle = titleFromSessionPath(sessionPath);
  if (pathTitle) candidates.push(candidate(pathTitle, "session-path", 35));

  const ranked = dedupeTitleCandidates(candidates)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, 5);
  const title = ranked[0]?.title || "HanaAgent Session";
  return {
    ok: true,
    sessionPath,
    title,
    candidates: ranked,
    messageCount: messages.length,
    source: ranked[0]?.source || "fallback"
  };
}

export function getBlueprint() {
  const parity = getParityMatrix();
  return {
    ...WORKBENCH_BLUEPRINT,
    currentCoverage: WORKBENCH_BLUEPRINT.currentCoverage.map((item) => ({ ...item })),
    phases: WORKBENCH_BLUEPRINT.phases.map((item) => ({ ...item })),
    hostRequests: [...WORKBENCH_BLUEPRINT.hostRequests],
    checkpointContract: getCheckpointContract(),
    parity
  };
}

function normalizeSuggestionCandidates({ pinnedModels, currentModel, agentId, modelMetadata }) {
  const seen = new Set();
  const candidates = [];
  const metadata = Array.isArray(modelMetadata) ? modelMetadata : [];
  function add(input, source) {
    const model = clean(input?.model || input?.modelId || input);
    if (!model) return;
    const provider = clean(input?.provider);
    const key = `${provider}:${model}`;
    if (seen.has(key)) return;
    seen.add(key);
    const meta = findModelMetadata(metadata, { provider, model });
    candidates.push({
      model,
      provider,
      agentId: clean(input?.agentId) || clean(agentId),
      source,
      contextWindow: meta.contextWindow || numberFrom(input?.contextWindow),
      inputCostPer1M: meta.inputCostPer1M || numberFrom(input?.inputCostPer1M),
      outputCostPer1M: meta.outputCostPer1M || numberFrom(input?.outputCostPer1M),
      metadata: meta
    });
  }
  for (const pinned of pinnedModels) add(pinned, "pinned");
  add({ model: currentModel, agentId }, "current");
  return candidates;
}

function normalizeModelMetadata(items) {
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const model = clean(item?.model || item?.modelId || item?.id);
    if (!model) continue;
    const provider = clean(item?.provider);
    const key = `${provider}:${model}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      model,
      provider,
      contextWindow: clampInt(item?.contextWindow || item?.contextTokens || item?.maxContextTokens, 0, 1000000, 0),
      inputCostPer1M: numberFrom(item?.inputCostPer1M || item?.promptCostPer1M || item?.inputCost),
      outputCostPer1M: numberFrom(item?.outputCostPer1M || item?.completionCostPer1M || item?.outputCost),
      notes: clean(item?.notes || item?.description)
    });
    if (result.length >= 80) break;
  }
  return result;
}

function findModelMetadata(items, input = {}) {
  const model = clean(input.model || input.modelId).toLowerCase();
  const provider = clean(input.provider).toLowerCase();
  if (!model) return {};
  return (Array.isArray(items) ? items : []).find((item) => {
    const itemModel = clean(item.model || item.modelId).toLowerCase();
    const itemProvider = clean(item.provider).toLowerCase();
    return itemModel === model && (!provider || !itemProvider || itemProvider === provider);
  }) || {};
}

function scoreModelCandidate(candidate, context) {
  const model = candidate.model.toLowerCase();
  const isPremium = /gpt-5|gpt-4\.1|opus|sonnet|pro|max|o3|o4/.test(model);
  const isFast = /mini|haiku|flash|lite|small|fast|turbo/.test(model);
  const isReasoning = /gpt-5|o3|o4|reason|thinking|opus/.test(model);
  let score = candidate.source === "pinned" ? 20 : 10;
  if (context.targetTier === "high-capability") {
    if (isPremium) score += 45;
    if (isReasoning) score += 25;
    if (isFast) score -= 8;
  } else if (context.targetTier === "fast") {
    if (isFast) score += 35;
    if (isPremium) score += 8;
  } else {
    if (isPremium) score += 24;
    if (isFast) score += 18;
  }
  if (context.signals.coding && /gpt-5|sonnet|opus|coder|code/.test(model)) score += 18;
  if (context.signals.review && /gpt-5|opus|sonnet|o3|reason/.test(model)) score += 16;
  if (context.signals.research && /gpt-5|sonnet|pro|search|gemini/.test(model)) score += 12;
  if (context.signals.longContext && Number(candidate.contextWindow || 0) >= 128000) score += 14;
  if (context.signals.fastDraft && (Number(candidate.inputCostPer1M || 0) || Number(candidate.outputCostPer1M || 0))) score += 4;
  return {
    ...candidate,
    tier: isFast ? "fast" : isPremium || isReasoning ? "high-capability" : "balanced",
    score,
    reason: modelSuggestionReason(candidate, context, { isPremium, isFast, isReasoning }),
    action: "apply-model"
  };
}

function modelSuggestionReason(candidate, context, flags) {
  if (context.targetTier === "high-capability") {
    if (flags.isReasoning) return "Best fit for complex coding, review, or long-context mission work.";
    if (flags.isPremium) return "Strong fit for higher-stakes mission execution.";
    return "Usable fallback, but a stronger reasoning model may perform better.";
  }
  if (context.targetTier === "fast") {
    if (flags.isFast) return "Good fit for quick, low-cost drafts or small routing tasks.";
    return "Available model; consider a mini/flash model for lower-cost quick work.";
  }
  return candidate.source === "pinned"
    ? "Pinned model that matches the current balanced work profile."
    : "Current model from the selected agent profile.";
}

function titleSourceText(message = {}) {
  for (const value of [message.text, message.message, message.prompt]) {
    const text = clean(value);
    if (text) return text;
  }
  return historyContentToText(message.content);
}

function titleFromExplicitGoal(text) {
  const line = firstUsefulTitleLine(text);
  const match = line.match(/(?:目标|任务|mission|goal|title|标题)\s*[:：]\s*(.+)$/i);
  return sanitizeTitle(match?.[1] || "");
}

function titleFromCheckpoint(text) {
  const result = String(text || "").match(/(?:RESULT|NEXT_ACTION)\s*:\s*(.+)$/im);
  return sanitizeTitle(result?.[1] || "");
}

function titleFromSentence(text) {
  return sanitizeTitle(firstUsefulTitleLine(text));
}

function titleFromSessionPath(sessionPath) {
  const basename = clean(sessionPath).split(/[\\/]/).pop() || "";
  return sanitizeTitle(basename.replace(/\.(jsonl|json|md|txt)$/i, ""));
}

function sessionTitleFromCurrentTitle(title) {
  const value = sanitizeTitle(title);
  if (!value || /^(new chat|untitled|未命名|新会话|session)$/i.test(value)) return "";
  return value;
}

function firstUsefulTitleLine(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !/^(system|assistant|user|state|files_changed|commands_run|blocker)\s*[:：]/i.test(line))
    || "";
}

function sanitizeTitle(value) {
  let text = clean(value)
    .replace(/[`*_#[\]()>]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^(请|帮我|帮忙|please)\s*/i, "")
    .replace(/[。.!?？；;，,：:]+$/g, "")
    .trim();
  if (!text) return "";
  text = text.replace(/^(实现|完善|复刻|构建|审查|整理|研究)\s*[:：-]\s*/i, "$1 ");
  if (text.length > 36) text = text.slice(0, 35).trimEnd() + "...";
  return text;
}

function candidate(title, source, score) {
  return { title, source, score };
}

function dedupeTitleCandidates(candidates) {
  const seen = new Set();
  const result = [];
  for (const item of candidates) {
    const title = sanitizeTitle(item?.title);
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ title, source: item.source || "message", score: Number.isFinite(Number(item.score)) ? Number(item.score) : 0 });
  }
  return result;
}

export async function getWorkbenchState(ctx) {
  const [agents, sessions] = await Promise.all([
    listAgents(ctx),
    listSessions(ctx)
  ]);
  const config = safeConfig(ctx);
  const busCapabilities = listBusCapabilities(ctx);
  return {
    ok: agents.ok || sessions.ok,
    pluginId: ctx?.pluginId || "hanaagent",
    config,
    blueprint: getBlueprint(),
    templates: getTemplates(),
    agents: agents.agents,
    sessions: sessions.sessions,
    busCapabilities,
    capabilities: {
      agentList: agents.ok,
      sessionList: sessions.ok,
      sessionSend: hasBusCapability(ctx, "session:send"),
      sessionCreate: hasBusCapability(ctx, "session:create") || hasHostSessionCreateCapability(ctx),
      sessionStatus: hasBusCapability(ctx, "session:status"),
      sessionHistory: hasBusCapability(ctx, "session:history"),
      sessionAbort: hasBusCapability(ctx, "session:abort"),
      sessionRevertTurn: hasBusCapability(ctx, "session:revert-turn"),
      agentConfig: hasBusCapability(ctx, "agent:config"),
      agentUpdateConfig: hasBusCapability(ctx, "agent:update-config"),
      agentSkills: hasBusCapability(ctx, "agent:skills"),
      memoryList: hasBusCapability(ctx, "memory:list"),
      memoryRead: hasBusCapability(ctx, "memory:read"),
      usageList: hasBusCapability(ctx, "usage:list"),
      checkpointList: hasBusCapability(ctx, "checkpoint:list"),
      checkpointFindBySessionSince: hasBusCapability(ctx, "checkpoint:find-by-session-since"),
      checkpointRestore: hasBusCapability(ctx, "checkpoint:restore"),
      taskList: hasBusCapability(ctx, "task:list"),
      taskRegister: hasBusCapability(ctx, "task:register"),
      taskUpdate: hasBusCapability(ctx, "task:update"),
      taskQuery: hasBusCapability(ctx, "task:query"),
      taskComplete: hasBusCapability(ctx, "task:complete"),
      taskFail: hasBusCapability(ctx, "task:fail"),
      taskRemove: hasBusCapability(ctx, "task:remove"),
      taskAbort: hasBusCapability(ctx, "task:abort"),
      taskCancel: hasBusCapability(ctx, "task:cancel"),
      taskSchedule: hasBusCapability(ctx, "task:schedule"),
      taskListSchedules: hasBusCapability(ctx, "task:list-schedules"),
      deferredRegister: hasBusCapability(ctx, "deferred:register"),
      deferredQuery: hasBusCapability(ctx, "deferred:query"),
      deferredListPending: hasBusCapability(ctx, "deferred:list-pending"),
      deferredResolve: hasBusCapability(ctx, "deferred:resolve"),
      deferredFail: hasBusCapability(ctx, "deferred:fail"),
      deferredAbort: hasBusCapability(ctx, "deferred:abort"),
      terminalList: hasBusCapability(ctx, "terminal:list"),
      terminalStart: hasBusCapability(ctx, "terminal:start"),
      terminalRead: hasBusCapability(ctx, "terminal:read"),
      terminalWrite: hasBusCapability(ctx, "terminal:write"),
      terminalClose: hasBusCapability(ctx, "terminal:close"),
      errors: [agents.error, sessions.error].filter(Boolean)
    }
  };
}

export async function listAgents(ctx) {
  try {
    if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", agents: [] };
    const result = await ctx.bus.request("agent:list", {});
    return {
      ok: true,
      agents: normalizeAgents(result?.agents)
    };
  } catch (error) {
    return { ok: false, error: "agent_list_failed", stderr: error.message, agents: [] };
  }
}

export async function listSessions(ctx, input = {}) {
  try {
    if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", sessions: [] };
    const agentId = clean(input.agentId);
    const result = await ctx.bus.request("session:list", agentId ? { agentId } : {});
    const config = safeConfig(ctx);
    return {
      ok: true,
      agentId: agentId || undefined,
      sessions: applySessionAliases(applySessionTombstones(normalizeSessions(result?.sessions), config.sessionTombstones), config.sessionAliases)
    };
  } catch (error) {
    return { ok: false, error: "session_list_failed", stderr: error.message, sessions: [] };
  }
}

export async function dispatchMission(ctx, input = {}) {
  const sessionPath = clean(input.sessionPath);
  const mission = clean(input.mission);
  const templateId = clean(input.templateId) || "orchestrate";
  const notes = clean(input.notes);
  const mode = clean(input.mode) || "dispatch";
  const template = TEMPLATE_LIBRARY.find((item) => item.id === templateId) || TEMPLATE_LIBRARY[0];

  if (!sessionPath) {
    return { ok: false, error: "sessionPath_required", prompt: buildMissionPrompt({ mission, notes, template, mode }) };
  }
  if (!mission) {
    return { ok: false, error: "mission_required" };
  }
  if (!ctx?.bus?.request) {
    return { ok: false, error: "hana_bus_unavailable", prompt: buildMissionPrompt({ mission, notes, template, mode }) };
  }

  const prompt = buildMissionPrompt({ mission, notes, template, mode });
  try {
    const result = await ctx.bus.request("session:send", {
      sessionPath,
      text: prompt
    });
    return {
      ok: true,
      accepted: result?.accepted !== false,
      sessionPath,
      templateId: template.id,
      prompt,
      result
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || "mission_dispatch_failed",
      stderr: error.stack || error.message,
      sessionPath,
      templateId: template.id,
      prompt
    };
  }
}

export async function sendSessionMessage(ctx, input = {}) {
  const sessionPath = clean(input.sessionPath);
  const text = clean(input.text || input.message || input.prompt);
  if (!sessionPath) return { ok: false, error: "sessionPath_required" };
  if (!text) return { ok: false, error: "message_required", sessionPath };
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", sessionPath };
  try {
    const result = await ctx.bus.request("session:send", {
      sessionPath,
      text
    });
    return {
      ok: result?.accepted !== false && result?.ok !== false,
      accepted: result?.accepted !== false,
      sessionPath,
      text,
      result
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || "session_send_failed",
      stderr: error.stack || error.message,
      sessionPath,
      text
    };
  }
}

export async function createSession(ctx, input = {}) {
  const payload = {};
  for (const key of ["agentId", "cwd", "model", "title", "missionId", "assignmentId"]) {
    const value = clean(input[key]);
    if (value) payload[key] = value;
  }
  if (typeof input.memoryEnabled === "boolean") payload.memoryEnabled = input.memoryEnabled;

  let busError = null;
  try {
    if (ctx?.bus?.request && hasBusCapability(ctx, "session:create")) {
      const result = await ctx.bus.request("session:create", payload);
      if (result?.error) return { ok: false, error: result.error, session: null, result };
      return { ok: true, source: "bus", session: normalizeSession(result?.session || result), result };
    }
  } catch (error) {
    busError = error;
  }

  const hostResult = await createHostSession(ctx, payload);
  if (hostResult.ok) return hostResult;

  return {
    ok: false,
    error: busError?.message || hostResult.error || "session_create_unavailable",
    stderr: busError?.stack || busError?.message || hostResult.stderr || "",
    session: null,
    busError: busError ? { message: busError.message, stack: busError.stack } : null,
    hostError: hostResult.ok ? null : hostResult
  };
}

export async function getSessionStatus(ctx, input = {}) {
  const sessionPath = clean(input.sessionPath);
  if (!sessionPath) return { ok: false, error: "sessionPath_required", status: null };
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", sessionPath, status: null };
  try {
    const result = await ctx.bus.request("session:status", { sessionPath });
    if (result?.error) return { ok: false, error: result.error, sessionPath, status: null };
    return { ok: true, sessionPath, status: normalizeSessionStatus(result?.status || result), result };
  } catch (error) {
    return { ok: false, error: error.message || "session_status_failed", stderr: error.stack || error.message, sessionPath, status: null };
  }
}

export async function getAgentConfig(ctx, input = {}) {
  const agentId = clean(input.agentId);
  if (!agentId) return { ok: false, error: "agentId_required", config: null };
  const profile = getAgentProfile(ctx?.dataDir, agentId);
  if (!ctx?.bus?.request) {
    return {
      ok: Boolean(profile),
      error: profile ? "" : "hana_bus_unavailable",
      agentId,
      config: profile ? normalizeAgentConfig(mergeAgentProfileConfig({}, profile)) : null,
      profile,
      host: { ok: false, error: "hana_bus_unavailable" }
    };
  }
  try {
    const result = await ctx.bus.request("agent:config", { agentId });
    if (result?.error && !profile) return { ok: false, error: result.error, agentId, config: null, profile };
    const baseConfig = result?.error ? {} : normalizeAgentConfig(result?.config || result);
    const mergedConfig = normalizeAgentConfig(mergeAgentProfileConfig(baseConfig, profile));
    return {
      ok: true,
      agentId,
      config: mergedConfig,
      profile,
      host: result?.error ? { ok: false, error: result.error } : { ok: true, config: baseConfig }
    };
  } catch (error) {
    if (profile) {
      return {
        ok: true,
        warning: error.message || "agent_config_failed",
        stderr: error.stack || error.message,
        agentId,
        config: normalizeAgentConfig(mergeAgentProfileConfig({}, profile)),
        profile,
        host: { ok: false, error: error.message || "agent_config_failed" }
      };
    }
    return { ok: false, error: error.message || "agent_config_failed", stderr: error.stack || error.message, agentId, config: null, profile: null };
  }
}

export async function updateAgentConfig(ctx, input = {}) {
  const agentId = clean(input.agentId);
  if (!agentId) return { ok: false, error: "agentId_required", config: null };
  const profileResult = saveAgentProfile(ctx?.dataDir, {
    agentId,
    name: input.name,
    partial: input.partial || input.config || input,
    source: "hanaagent-workbench"
  });
  if (!profileResult.ok) return { ...profileResult, config: null };

  let host = { ok: false, skipped: true, reason: "agent:update-config_unavailable" };
  if (hasBusCapability(ctx, "agent:update-config")) {
    try {
      const result = await ctx.bus.request("agent:update-config", {
        agentId,
        partial: profileResult.profile.partial
      });
      host = result?.error ? { ok: false, error: result.error, result } : { ok: true, result };
    } catch (error) {
      host = { ok: false, error: error.message || "agent_update_config_failed", stderr: error.stack || error.message };
    }
  }

  const latest = await getAgentConfig(ctx, { agentId });
  return {
    ok: true,
    agentId,
    profile: profileResult.profile,
    config: latest.config,
    host
  };
}

export function listAgentProfileOverrides(ctx) {
  return { ok: true, profiles: listAgentProfiles(ctx?.dataDir) };
}

export function deleteAgentProfileOverride(ctx, input = {}) {
  return deleteAgentProfile(ctx?.dataDir, input.agentId);
}

export async function listAgentSkills(ctx, input = {}) {
  const agentId = clean(input.agentId);
  if (!agentId) return { ok: false, error: "agentId_required", agentId, skills: [] };
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", agentId, skills: [] };
  try {
    const result = await ctx.bus.request("agent:skills", { agentId });
    if (result?.error) return { ok: false, error: result.error, agentId, skills: [] };
    return {
      ok: true,
      agentId,
      skills: normalizeSkills(result?.skills || result?.items || result)
    };
  } catch (error) {
    return { ok: false, error: error.message || "agent_skills_failed", stderr: error.stack || error.message, agentId, skills: [] };
  }
}

export async function listMemoryEntries(ctx, input = {}) {
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", entries: [] };
  try {
    const payload = {};
    for (const key of ["agentId", "sessionPath", "query", "kind"]) {
      const value = clean(input[key]);
      if (value) payload[key] = value;
    }
    payload.limit = clampInt(input.limit, 1, 100, 40);
    const result = await ctx.bus.request("memory:list", payload);
    if (result?.error) return { ok: false, error: result.error, entries: [] };
    return {
      ok: true,
      entries: normalizeMemoryEntries(result?.entries || result?.items || result)
    };
  } catch (error) {
    return { ok: false, error: error.message || "memory_list_failed", stderr: error.stack || error.message, entries: [] };
  }
}

export async function readMemoryEntry(ctx, input = {}) {
  const memoryId = clean(input.memoryId || input.id || input.path);
  if (!memoryId) return { ok: false, error: "memoryId_required", entry: null };
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", memoryId, entry: null };
  try {
    const result = await ctx.bus.request("memory:read", {
      memoryId,
      agentId: clean(input.agentId),
      sessionPath: clean(input.sessionPath)
    });
    if (result?.error) return { ok: false, error: result.error, memoryId, entry: null };
    return { ok: true, memoryId, entry: normalizeMemoryEntry(result?.entry || result), result };
  } catch (error) {
    return { ok: false, error: error.message || "memory_read_failed", stderr: error.stack || error.message, memoryId, entry: null };
  }
}

export async function listHostTasks(ctx, input = {}) {
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", tasks: [] };
  try {
    const payload = {};
    for (const key of ["pluginId", "type", "status", "agentId", "parentSessionPath"]) {
      const value = clean(input[key]);
      if (value) payload[key] = value;
    }
    const result = await ctx.bus.request("task:list", payload);
    return { ok: true, tasks: normalizeHostTasks(result?.tasks || result?.items || result) };
  } catch (error) {
    return { ok: false, error: error.message || "task_list_failed", stderr: error.stack || error.message, tasks: [] };
  }
}

export async function queryHostTask(ctx, input = {}) {
  const taskId = clean(input.taskId);
  if (!taskId) return { ok: false, error: "taskId_required", task: null };
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", taskId, task: null };
  try {
    const result = await ctx.bus.request("task:query", { taskId });
    return { ok: true, taskId, task: normalizeHostTask(result?.task || result), result };
  } catch (error) {
    return { ok: false, error: error.message || "task_query_failed", stderr: error.stack || error.message, taskId, task: null };
  }
}

export async function registerHostTask(ctx, input = {}) {
  const taskId = clean(input.taskId) || `hanaagent-${Date.now()}`;
  const type = clean(input.type) || "hanaagent-mission";
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", taskId };
  try {
    const payload = {
      taskId,
      type,
      pluginId: clean(input.pluginId) || ctx?.pluginId || "hanaagent",
      parentSessionPath: clean(input.parentSessionPath || input.sessionPath),
      agentId: clean(input.agentId),
      persist: input.persist !== false,
      meta: input.meta && typeof input.meta === "object" ? input.meta : {}
    };
    const result = await ctx.bus.request("task:register", payload);
    return { ok: true, taskId, type, result };
  } catch (error) {
    return { ok: false, error: error.message || "task_register_failed", stderr: error.stack || error.message, taskId, type };
  }
}

export async function updateHostTask(ctx, input = {}) {
  return mutateHostTask(ctx, "task:update", input);
}

export async function completeHostTask(ctx, input = {}) {
  return mutateHostTask(ctx, "task:complete", input);
}

export async function failHostTask(ctx, input = {}) {
  return mutateHostTask(ctx, "task:fail", input);
}

export async function removeHostTask(ctx, input = {}) {
  return mutateHostTask(ctx, "task:remove", input);
}

export async function cancelHostTask(ctx, input = {}) {
  return mutateHostTask(ctx, "task:cancel", input);
}

export async function listDeferredTasks(ctx, input = {}) {
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", pending: [] };
  try {
    const sessionPath = clean(input.sessionPath);
    const result = await ctx.bus.request("deferred:list-pending", sessionPath ? { sessionPath } : {});
    return { ok: true, pending: normalizeDeferredTasks(result?.pending || result?.tasks || result) };
  } catch (error) {
    return { ok: false, error: error.message || "deferred_list_failed", stderr: error.stack || error.message, pending: [] };
  }
}

export async function queryDeferredTask(ctx, input = {}) {
  const taskId = clean(input.taskId);
  if (!taskId) return { ok: false, error: "taskId_required", task: null };
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", taskId, task: null };
  try {
    const result = await ctx.bus.request("deferred:query", { taskId });
    return { ok: true, taskId, task: normalizeDeferredTask(result), result };
  } catch (error) {
    return { ok: false, error: error.message || "deferred_query_failed", stderr: error.stack || error.message, taskId, task: null };
  }
}

export async function listUsage(ctx, input = {}) {
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", entries: [], summary: summarizeUsage([]) };
  try {
    const payload = {
      limit: clampInt(input.limit, 1, 500, 80)
    };
    for (const key of ["sessionPath", "agentId", "provider", "modelId", "subsystem", "operation", "status", "since", "until"]) {
      const value = clean(input[key]);
      if (value) payload[key] = value;
    }
    const result = await ctx.bus.request("usage:list", payload);
    const entries = normalizeUsageEntries(result?.entries || result?.usage || result);
    return {
      ok: true,
      entries,
      summary: summarizeUsage(entries),
      nextCursor: result?.nextCursor || null
    };
  } catch (error) {
    return { ok: false, error: error.message || "usage_list_failed", stderr: error.stack || error.message, entries: [], summary: summarizeUsage([]) };
  }
}

export async function getContextUsage(ctx, input = {}) {
  const sessionPath = clean(input.sessionPath);
  if (!sessionPath) return { ok: false, error: "sessionPath_required", context: null };
  const metadata = normalizeModelMetadata(input.modelMetadata || safeConfig(ctx).modelMetadata || []);
  const modelId = clean(input.modelId || input.model || input.currentModel);
  const provider = clean(input.provider);
  const modelMeta = findModelMetadata(metadata, { provider, model: modelId });
  const maxContextTokens = clampInt(input.maxContextTokens || input.contextWindow || input.limitTokens || modelMeta.contextWindow, 1000, 1000000, 128000);
  const historyLimit = clampInt(input.historyLimit || input.limit, 1, 200, 120);
  const [history, usage] = await Promise.all([
    getSessionHistory(ctx, { sessionPath, limit: historyLimit }),
    listUsage(ctx, { sessionPath, agentId: clean(input.agentId), limit: input.usageLimit || 120 })
  ]);
  if (!history.ok && !usage.ok) {
    return {
      ok: false,
      error: history.error || usage.error || "context_usage_unavailable",
      sessionPath,
      context: null,
      history,
      usage
    };
  }

  const messages = Array.isArray(history.messages) ? history.messages : [];
  const messageStats = summarizeHistoryContext(messages);
  const usageSummary = usage.summary || summarizeUsage([]);
  const usedTokens = Math.max(messageStats.estimatedTokens, numberFrom(usageSummary.promptTokens));
  const percent = maxContextTokens > 0 ? Math.min(100, Math.round((usedTokens / maxContextTokens) * 1000) / 10) : 0;
  const remainingTokens = Math.max(0, maxContextTokens - usedTokens);
  const status = percent >= 90 ? "critical" : percent >= 70 ? "warning" : "ok";
  return {
    ok: true,
    sessionPath,
    context: {
      status,
      usedTokens,
      maxContextTokens,
      remainingTokens,
      percent,
      messageCount: messages.length,
      messagesWithTokenCount: messageStats.messagesWithTokenCount,
      estimatedFromCharacters: messageStats.estimatedFromCharacters,
      historyTokenCount: messageStats.explicitTokens,
      usagePromptTokens: numberFrom(usageSummary.promptTokens),
      usageCompletionTokens: numberFrom(usageSummary.completionTokens),
      usageTotalTokens: numberFrom(usageSummary.totalTokens),
      modelId,
      provider,
      modelMetadata: modelMeta,
      source: history.ok ? "session-history" : usage.ok ? "usage-ledger" : "estimated"
    },
    history: {
      ok: history.ok,
      error: history.error || "",
      limit: history.limit || historyLimit,
      messageCount: messages.length,
      toolTrace: history.toolTrace || null
    },
    usage: {
      ok: usage.ok,
      error: usage.error || "",
      summary: usageSummary
    }
  };
}

function mutateHostTask(ctx, type, input = {}) {
  return (async () => {
    const taskId = clean(input.taskId);
    if (!taskId) return { ok: false, error: "taskId_required" };
    if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", taskId };
    try {
      const payload = { taskId };
      if (type === "task:update") {
        if (input.progress && typeof input.progress === "object") payload.progress = input.progress;
        if (input.meta && typeof input.meta === "object") payload.meta = input.meta;
        for (const key of ["status", "message", "label"]) {
          const value = clean(input[key]);
          if (value) payload[key] = value;
        }
      } else if (type === "task:complete") {
        payload.result = input.result ?? {};
      } else if (type === "task:fail") {
        payload.reason = clean(input.reason || input.error) || "failed";
      } else if (type === "task:cancel") {
        payload.reason = clean(input.reason) || "cancelled";
      }
      const result = await ctx.bus.request(type, payload);
      return { ok: result?.ok !== false, taskId, result, task: normalizeHostTask(result?.task) };
    } catch (error) {
      return { ok: false, error: error.message || `${type}_failed`, stderr: error.stack || error.message, taskId };
    }
  })();
}

export async function listHostCheckpoints(ctx, input = {}) {
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", checkpoints: [] };
  try {
    const result = await ctx.bus.request("checkpoint:list", {});
    const checkpoints = normalizeHostCheckpoints(result?.checkpoints || result?.items || result);
    return {
      ok: true,
      checkpoints: filterHostCheckpoints(checkpoints, input)
    };
  } catch (error) {
    return { ok: false, error: error.message || "checkpoint_list_failed", stderr: error.stack || error.message, checkpoints: [] };
  }
}

export async function findSessionCheckpoints(ctx, input = {}) {
  const sessionPath = clean(input.sessionPath);
  if (!sessionPath) return { ok: false, error: "sessionPath_required", checkpoints: [] };
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", sessionPath, checkpoints: [] };
  try {
    const payload = {
      sessionPath,
      sinceTs: clean(input.sinceTs) || clean(input.since) || undefined
    };
    const result = await ctx.bus.request("checkpoint:find-by-session-since", payload);
    return {
      ok: true,
      sessionPath,
      checkpoints: normalizeHostCheckpoints(result?.checkpoints || result?.items || result)
    };
  } catch (error) {
    return { ok: false, error: error.message || "checkpoint_find_failed", stderr: error.stack || error.message, sessionPath, checkpoints: [] };
  }
}

export async function restoreHostCheckpoint(ctx, input = {}) {
  const id = clean(input.id || input.checkpointId);
  if (!id) return { ok: false, error: "checkpointId_required" };
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", checkpointId: id };
  try {
    const result = await ctx.bus.request("checkpoint:restore", { id, checkpointId: id });
    return {
      ok: result?.ok !== false,
      checkpointId: id,
      result,
      restoredTo: clean(result?.restoredTo || result?.path || result?.filePath),
      restoredFiles: Number(result?.restoredFiles || result?.filesRestored || 0)
    };
  } catch (error) {
    return { ok: false, error: error.message || "checkpoint_restore_failed", stderr: error.stack || error.message, checkpointId: id };
  }
}

export async function revertSessionTurn(ctx, input = {}) {
  const sessionPath = clean(input.sessionPath || input.path);
  if (!sessionPath) return { ok: false, error: "sessionPath_required" };
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", sessionPath };
  try {
    const payload = {
      sessionPath,
      path: clean(input.path) || sessionPath,
      sinceTs: clean(input.sinceTs || input.since || input.timestamp) || undefined,
      clientMessageId: clean(input.clientMessageId || input.messageId) || undefined
    };
    const result = await ctx.bus.request("session:revert-turn", payload);
    return {
      ok: result?.ok !== false,
      sessionPath,
      result,
      branchPath: clean(result?.branchPath || result?.path || result?.sessionPath),
      restoredCheckpoints: Number(result?.restoredCheckpoints || result?.checkpointsRestored || result?.restoredFiles || 0)
    };
  } catch (error) {
    return { ok: false, error: error.message || "session_revert_turn_failed", stderr: error.stack || error.message, sessionPath };
  }
}

export async function getSessionHistory(ctx, input = {}) {
  const sessionPath = clean(input.sessionPath);
  const limit = clampInt(input.limit, 1, 200, 40);
  if (!sessionPath) return { ok: false, error: "sessionPath_required", messages: [] };
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", sessionPath, messages: [] };
  try {
    const result = await ctx.bus.request("session:history", { sessionPath, limit });
    const normalizedMessages = normalizeHistoryMessages(result?.messages || result?.history || result);
    const externalized = ctx.dataDir
      ? externalizeLargeToolOutputs(ctx.dataDir, { sessionPath, messages: normalizedMessages })
      : { messages: normalizedMessages, artifacts: [] };
    const messages = externalized.messages;
    return {
      ok: true,
      sessionPath,
      limit,
      messages,
      toolTrace: buildToolTrace({ messages }),
      artifacts: externalized.artifacts || []
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || "session_history_failed",
      stderr: error.stack || error.message,
      sessionPath,
      messages: []
    };
  }
}

export function buildSessionForkPrompt(input = {}) {
  const sourceSessionPath = clean(input.sourceSessionPath || input.sessionPath);
  const sourceTitle = clean(input.sourceTitle || input.title);
  const instructions = clean(input.instructions || input.notes || input.prompt);
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const maxMessages = clampInt(input.maxMessages, 1, 80, 24);
  const maxMessageChars = clampInt(input.maxMessageChars, 120, 4000, 1200);
  const maxPromptChars = clampInt(input.maxPromptChars, 2000, 64000, 18000);
  const selected = messages.slice(-maxMessages);
  const transcript = selected.map((message, index) => {
    const role = clean(message?.role) || "unknown";
    const createdAt = clean(message?.createdAt);
    const text = truncateForPrompt(clean(message?.text), maxMessageChars);
    const traceHint = message?.raw && historyHasTracePayload(message.raw) && !text
      ? "[tool/trace payload only]"
      : "";
    return [
      `## ${index + 1}. ${role}${createdAt ? ` @ ${createdAt}` : ""}`,
      text || traceHint || "(empty)"
    ].join("\n");
  }).join("\n\n");

  const prompt = [
    "你是 Hanaco 智能体工作台创建的 fork session。",
    "请基于下面原会话上下文继续工作，但不要假设你可以直接访问原会话隐藏状态；需要时重新验证事实、文件和命令。",
    sourceTitle ? `原会话标题：${sourceTitle}` : "",
    sourceSessionPath ? `原会话路径：${sourceSessionPath}` : "",
    instructions ? `用户对 fork 的要求：${instructions}` : "用户对 fork 的要求：延续原会话目标，整理当前状态并继续推进。",
    "",
    "请先输出：",
    "1. 你从原会话继承到的目标和当前状态。",
    "2. 你会重新验证的关键事实或文件。",
    "3. 下一步执行计划。",
    "",
    "# 原会话最近上下文",
    transcript || "(no readable messages)"
  ].filter((line) => line !== "").join("\n");

  return {
    ok: true,
    sourceSessionPath,
    sourceTitle,
    instructions,
    messageCount: messages.length,
    includedMessages: selected.length,
    truncated: prompt.length > maxPromptChars,
    prompt: truncateForPrompt(prompt, maxPromptChars)
  };
}

export async function forkSession(ctx, input = {}) {
  const sessionPath = clean(input.sessionPath || input.sourceSessionPath);
  if (!sessionPath) return { ok: false, error: "sessionPath_required" };

  const history = await getSessionHistory(ctx, {
    sessionPath,
    limit: input.limit || input.maxMessages || 80
  });
  if (!history.ok) return { ...history, forkPrompt: "" };

  const sessions = await listSessions(ctx, { agentId: clean(input.agentId) });
  const current = (sessions.sessions || []).find((session) => session.path === sessionPath) || {};
  const forkPrompt = buildSessionForkPrompt({
    sourceSessionPath: sessionPath,
    sourceTitle: input.sourceTitle || current.title || "",
    instructions: input.instructions || input.notes || "",
    messages: history.messages || [],
    maxMessages: input.maxMessages || input.limit || 24,
    maxMessageChars: input.maxMessageChars,
    maxPromptChars: input.maxPromptChars
  });
  const title = clean(input.title) || `Fork: ${forkPrompt.sourceTitle || current.title || sessionPath.split("/").pop() || "Session"}`;
  const agentId = clean(input.agentId) || current.agentId || "";
  const cwd = clean(input.cwd) || current.cwd || "";
  const model = clean(input.model || input.modelId) || current.modelId || "";
  const create = input.create !== false;
  const send = input.send !== false;

  if (!create) {
    return {
      ok: true,
      mode: "prompt-only",
      sourceSessionPath: sessionPath,
      sourceSession: current,
      forkPrompt,
      history,
      session: null,
      sendResult: null
    };
  }

  const created = await createSession(ctx, {
    agentId,
    cwd,
    model,
    title,
    memoryEnabled: input.memoryEnabled,
    missionId: clean(input.missionId),
    assignmentId: clean(input.assignmentId)
  });
  if (!created.ok) {
    return {
      ok: false,
      error: created.error || "session_create_unavailable",
      mode: "prompt-ready",
      sourceSessionPath: sessionPath,
      sourceSession: current,
      forkPrompt,
      history,
      createResult: created,
      session: null,
      sendResult: null
    };
  }

  const targetSessionPath = created.session?.path || created.session?.sessionPath || "";
  let sendResult = null;
  if (send && targetSessionPath) {
    sendResult = await sendSessionMessage(ctx, {
      sessionPath: targetSessionPath,
      text: forkPrompt.prompt
    });
  }

  return {
    ok: !sendResult || sendResult.ok,
    error: sendResult && !sendResult.ok ? sendResult.error : undefined,
    mode: send ? "created-and-dispatched" : "created",
    sourceSessionPath: sessionPath,
    sourceSession: current,
    forkPrompt,
    history,
    createResult: created,
    session: created.session,
    sendResult
  };
}

export async function abortSession(ctx, input = {}) {
  const sessionPath = clean(input.sessionPath);
  if (!sessionPath) return { ok: false, error: "sessionPath_required" };
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", sessionPath };
  try {
    const result = await ctx.bus.request("session:abort", { sessionPath });
    return {
      ok: true,
      sessionPath,
      result
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message || "session_abort_failed",
      stderr: error.stack || error.message,
      sessionPath
    };
  }
}

export async function listTerminals(ctx, input = {}) {
  const sessionPath = clean(input.sessionPath);
  if (!sessionPath) return { ok: false, error: "sessionPath_required", terminals: [] };
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", sessionPath, terminals: [] };
  try {
    const result = await ctx.bus.request("terminal:list", { sessionPath });
    return {
      ok: true,
      sessionPath,
      terminals: normalizeTerminals(result?.terminals)
    };
  } catch (error) {
    return { ok: false, error: error.message || "terminal_list_failed", stderr: error.stack || error.message, sessionPath, terminals: [] };
  }
}

export async function startTerminal(ctx, input = {}) {
  const sessionPath = clean(input.sessionPath);
  const cwd = clean(input.cwd);
  if (!sessionPath) return { ok: false, error: "sessionPath_required" };
  if (!cwd) return { ok: false, error: "cwd_required", sessionPath };
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", sessionPath };
  try {
    const result = await ctx.bus.request("terminal:start", {
      sessionPath,
      cwd,
      command: clean(input.command),
      label: clean(input.label) || "HanaAgent Terminal",
      cols: clampInt(input.cols, 40, 240, 120),
      rows: clampInt(input.rows, 10, 80, 28)
    });
    return { ok: true, sessionPath, terminal: normalizeTerminal(result), result };
  } catch (error) {
    return { ok: false, error: error.message || "terminal_start_failed", stderr: error.stack || error.message, sessionPath };
  }
}

export async function readTerminal(ctx, input = {}) {
  const sessionPath = clean(input.sessionPath);
  const terminalId = clean(input.terminalId);
  if (!sessionPath) return { ok: false, error: "sessionPath_required" };
  if (!terminalId) return { ok: false, error: "terminalId_required", sessionPath };
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", sessionPath, terminalId };
  try {
    const result = await ctx.bus.request("terminal:read", {
      sessionPath,
      terminalId,
      sinceSeq: Number.isFinite(Number(input.sinceSeq)) ? Math.max(0, Math.round(Number(input.sinceSeq))) : 0
    });
    return { ok: true, sessionPath, terminalId, ...normalizeTerminalRead(result) };
  } catch (error) {
    return { ok: false, error: error.message || "terminal_read_failed", stderr: error.stack || error.message, sessionPath, terminalId };
  }
}

export async function writeTerminal(ctx, input = {}) {
  const sessionPath = clean(input.sessionPath);
  const terminalId = clean(input.terminalId);
  const chars = typeof input.chars === "string" ? input.chars : "";
  if (!sessionPath) return { ok: false, error: "sessionPath_required" };
  if (!terminalId) return { ok: false, error: "terminalId_required", sessionPath };
  if (!chars) return { ok: false, error: "chars_required", sessionPath, terminalId };
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", sessionPath, terminalId };
  try {
    const result = await ctx.bus.request("terminal:write", { sessionPath, terminalId, chars });
    return { ok: true, sessionPath, terminalId, ...normalizeTerminalRead(result) };
  } catch (error) {
    return { ok: false, error: error.message || "terminal_write_failed", stderr: error.stack || error.message, sessionPath, terminalId };
  }
}

export async function closeTerminal(ctx, input = {}) {
  const sessionPath = clean(input.sessionPath);
  const terminalId = clean(input.terminalId);
  if (!sessionPath) return { ok: false, error: "sessionPath_required" };
  if (!terminalId) return { ok: false, error: "terminalId_required", sessionPath };
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", sessionPath, terminalId };
  try {
    const result = await ctx.bus.request("terminal:close", { sessionPath, terminalId });
    return { ok: true, sessionPath, terminalId, terminal: normalizeTerminal(result), result };
  } catch (error) {
    return { ok: false, error: error.message || "terminal_close_failed", stderr: error.stack || error.message, sessionPath, terminalId };
  }
}

export function buildMissionPrompt({ mission, notes, template, mode }) {
  const safeTemplate = template || TEMPLATE_LIBRARY[0];
  const lines = [
    safeTemplate.prompt,
    "",
    `工作台模式：${mode === "review" ? "复核" : mode === "plan" ? "计划" : "执行"}`,
    "",
    "目标：",
    mission || "(未填写)",
    ""
  ];
  if (notes) {
    lines.push("补充上下文：", notes, "");
  }
  lines.push(
    "Checkpoint 合约：",
    ...CHECKPOINT_CONTRACT,
    "",
    "请在回复最后给出：",
    "1. 当前状态",
    "2. 下一步动作",
    "3. 需要用户确认的事项"
  );
  return lines.join("\n");
}

function listBusCapabilities(ctx) {
  try {
    if (typeof ctx?.bus?.listCapabilities !== "function") return [];
    const capabilities = ctx.bus.listCapabilities();
    if (!Array.isArray(capabilities)) return [];
    return capabilities.map((capability) => ({
      type: clean(capability?.type),
      title: clean(capability?.title),
      permission: clean(capability?.permission),
      stable: capability?.stable !== false,
      available: capability?.available !== false && capability?.hasHandler !== false
    })).filter((capability) => capability.type);
  } catch {
    return [];
  }
}

export function hasBusCapability(ctx, type) {
  if (!ctx?.bus?.request) return false;
  const wanted = clean(type);
  if (typeof ctx.bus.hasHandler === "function") {
    try {
      return Boolean(ctx.bus.hasHandler(wanted));
    } catch {
      return false;
    }
  }
  const capabilities = listBusCapabilities(ctx);
  if (!capabilities.length) return true;
  const capability = capabilities.find((item) => item.type === wanted);
  return capability ? capability.available !== false : false;
}

function hasHostSessionCreateCapability(ctx) {
  const host = ctx?.host;
  return Boolean(
    host
    && (
      typeof host.createSessionForAgent === "function"
      || typeof host.createSession === "function"
      || typeof host.createDetachedSession === "function"
    )
  );
}

async function createHostSession(ctx, payload) {
  const host = ctx?.host;
  if (!host) return { ok: false, error: "host_api_unavailable", session: null };
  try {
    let result = null;
    const opts = {
      workspaceFolders: payload.cwd ? [payload.cwd] : [],
      visibleInSessionList: true,
      hanaagent: {
        missionId: payload.missionId || "",
        assignmentId: payload.assignmentId || ""
      }
    };
    if (payload.agentId && typeof host.createSessionForAgent === "function") {
      result = await host.createSessionForAgent(
        payload.agentId,
        payload.cwd || undefined,
        payload.memoryEnabled !== false,
        payload.model || undefined,
        opts
      );
    } else if (typeof host.createSession === "function") {
      result = await host.createSession(
        null,
        payload.cwd || undefined,
        payload.memoryEnabled !== false,
        payload.model || undefined,
        opts
      );
    } else if (typeof host.createDetachedSession === "function") {
      result = await host.createDetachedSession({
        agentId: payload.agentId || undefined,
        cwd: payload.cwd || undefined,
        memoryEnabled: payload.memoryEnabled !== false,
        model: payload.model || undefined,
        title: payload.title || undefined,
        ...opts
      });
    } else {
      return { ok: false, error: "host_session_create_unavailable", session: null };
    }
    if (result?.error) return { ok: false, error: result.error, session: null, result };
    return { ok: true, source: "host", session: normalizeSession(result?.session || result), result };
  } catch (error) {
    return { ok: false, error: error.message || "host_session_create_failed", stderr: error.stack || error.message, session: null };
  }
}

function normalizeHistoryMessages(value) {
  const messages = Array.isArray(value) ? value : [];
  return messages.map((message, index) => {
    const role = clean(message?.role || message?.type || message?.speaker) || "unknown";
    const text = historyContentToText(message?.content ?? message?.text ?? message?.message ?? message?.output);
    const raw = safeRawMessage(message);
    return {
      id: clean(message?.id) || `history-${index}`,
      role,
      text,
      createdAt: clean(message?.createdAt || message?.timestamp || message?.at) || null,
      tokenCount: Number.isFinite(Number(message?.tokenCount || message?.tokens))
        ? Math.max(0, Math.round(Number(message?.tokenCount || message?.tokens)))
        : 0,
      raw
    };
  }).filter((message) => message.text || historyHasTracePayload(message.raw));
}

function safeRawMessage(message) {
  try {
    return JSON.parse(JSON.stringify(message || {}));
  } catch {
    return {};
  }
}

function historyHasTracePayload(message) {
  if (!message || typeof message !== "object") return false;
  if (["toolCalls", "tool_calls", "tools", "toolResults", "tool_results"].some((key) => Array.isArray(message[key]) && message[key].length)) return true;
  if (!Array.isArray(message.content)) return false;
  return message.content.some((part) => {
    const type = clean(part?.type);
    return ["tool_use", "toolCall", "tool_call", "tool_result", "toolResult", "function_call"].includes(type)
      || Boolean(part?.tool_use_id || part?.tool_call_id);
  });
}

function normalizeAgentConfig(value) {
  if (!value || typeof value !== "object") return {};
  const skills = value.skills && typeof value.skills === "object" ? value.skills : {};
  const memory = value.memory && typeof value.memory === "object" ? value.memory : {};
  const models = value.models && typeof value.models === "object" ? value.models : {};
  const agent = value.agent && typeof value.agent === "object" ? value.agent : {};
  const maxTurns = boundedNumber(agent.maxTurns ?? agent.max_turns ?? value.maxTurns ?? value.max_turns, 1, 100);
  const gatewayTimeout = boundedNumber(agent.gatewayTimeout ?? agent.gateway_timeout ?? value.gatewayTimeout ?? value.gateway_timeout, 10, 600);
  const toolUseEnforcement = enumString(agent.toolUseEnforcement ?? agent.tool_use_enforcement ?? value.toolUseEnforcement ?? value.tool_use_enforcement, ["auto", "required", "none"]);
  return {
    name: clean(value.name),
    yuan: clean(value.yuan),
    description: clean(value.description || value.role || value.system),
    model: clean(value.model || models.chat || value.chatModel),
    models,
    memory: {
      enabled: memory.enabled !== false,
      userProfileEnabled: memory.userProfileEnabled !== false && memory.user_profile_enabled !== false,
      model: clean(memory.model || value.memoryModel),
      disabledSince: clean(memory.disabledSince),
      reenableAt: clean(memory.reenableAt)
    },
    agent: {
      ...(maxTurns !== null ? { maxTurns } : {}),
      ...(gatewayTimeout !== null ? { gatewayTimeout } : {}),
      toolUseEnforcement: toolUseEnforcement || "auto"
    },
    skills: {
      enabled: Array.isArray(skills.enabled) ? skills.enabled.map(clean).filter(Boolean) : []
    },
    raw: value
  };
}

function boundedNumber(value, min, max) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function enumString(value, allowed) {
  const text = clean(value);
  return allowed.includes(text) ? text : "";
}

function normalizeSession(value) {
  if (!value || typeof value !== "object") return null;
  const path = clean(value.path || value.sessionPath || value.file || value.sessionFile);
  return {
    path,
    sessionPath: path,
    title: clean(value.title || value.name) || (path ? path.split("/").pop() : "Session"),
    agentId: clean(value.agentId),
    cwd: clean(value.cwd),
    modelId: clean(value.modelId || value.model),
    status: clean(value.status) || "unknown",
    raw: value
  };
}

function normalizeSessionStatus(value) {
  if (!value || typeof value !== "object") return { state: "unknown" };
  return {
    state: clean(value.state || value.status) || "unknown",
    busy: Boolean(value.busy || value.running || value.active),
    needsInput: Boolean(value.needsInput || value.waitingForInput),
    lastSeen: clean(value.lastSeen || value.updatedAt || value.timestamp),
    message: clean(value.message || value.lastMessage),
    raw: value
  };
}

function normalizeHostTasks(value) {
  const tasks = Array.isArray(value) ? value : [];
  return tasks.map(normalizeHostTask).filter(Boolean);
}

function normalizeHostTask(value) {
  if (!value || typeof value !== "object") return null;
  const id = clean(value.taskId || value.id);
  if (!id) return null;
  return {
    id,
    taskId: id,
    type: clean(value.type),
    pluginId: clean(value.pluginId),
    agentId: clean(value.agentId),
    parentSessionPath: clean(value.parentSessionPath || value.sessionPath),
    status: clean(value.status) || "unknown",
    progress: value.progress && typeof value.progress === "object" ? value.progress : null,
    meta: value.meta && typeof value.meta === "object" ? value.meta : {},
    createdAt: clean(value.createdAt),
    updatedAt: clean(value.updatedAt),
    raw: value
  };
}

function normalizeDeferredTasks(value) {
  const tasks = Array.isArray(value) ? value : [];
  return tasks.map(normalizeDeferredTask).filter(Boolean);
}

function normalizeDeferredTask(value) {
  if (!value || typeof value !== "object") return null;
  const id = clean(value.taskId || value.id);
  if (!id) return null;
  return {
    id,
    taskId: id,
    sessionPath: clean(value.sessionPath),
    status: clean(value.status || value.state) || "pending",
    meta: value.meta && typeof value.meta === "object" ? value.meta : {},
    result: value.result || null,
    error: clean(value.error || value.reason),
    createdAt: clean(value.createdAt),
    updatedAt: clean(value.updatedAt),
    raw: value
  };
}

function normalizeUsageEntries(value) {
  const entries = Array.isArray(value) ? value : [];
  return entries.map((entry, index) => {
    const usage = entry?.usage && typeof entry.usage === "object" ? entry.usage : {};
    const model = entry?.model && typeof entry.model === "object" ? entry.model : {};
    const attribution = entry?.usageContext?.attribution || entry?.attribution || {};
    const promptTokens = numberFrom(usage.prompt_tokens ?? usage.promptTokens ?? entry?.promptTokens);
    const completionTokens = numberFrom(usage.completion_tokens ?? usage.completionTokens ?? entry?.completionTokens);
    const totalTokens = numberFrom(usage.total_tokens ?? usage.totalTokens ?? entry?.totalTokens) || promptTokens + completionTokens;
    const cost = numberFrom(entry?.costUsd ?? entry?.cost ?? usage.costUsd);
    return {
      id: clean(entry?.requestId || entry?.id) || `usage-${index}`,
      requestId: clean(entry?.requestId || entry?.id),
      provider: clean(model.provider || entry?.provider),
      modelId: clean(model.modelId || model.model || entry?.modelId || entry?.model),
      subsystem: clean(entry?.usageContext?.source?.subsystem || entry?.subsystem),
      operation: clean(entry?.usageContext?.source?.operation || entry?.operation),
      agentId: clean(attribution.agentId || entry?.agentId),
      sessionPath: clean(attribution.sessionPath || entry?.sessionPath),
      status: clean(entry?.status) || "ok",
      createdAt: clean(entry?.createdAt || entry?.timestamp || entry?.at),
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd: cost
    };
  }).filter((entry) => entry.requestId || entry.totalTokens || entry.modelId || entry.sessionPath);
}

function normalizeSkills(value) {
  const skills = Array.isArray(value) ? value : [];
  return skills.map((skill, index) => {
    if (typeof skill === "string") {
      return { id: skill, name: skill, description: "", enabled: true };
    }
    const id = clean(skill?.id || skill?.name || skill?.slug) || `skill-${index}`;
    return {
      id,
      name: clean(skill?.name || skill?.title) || id,
      description: clean(skill?.description || skill?.summary),
      category: clean(skill?.category),
      enabled: skill?.enabled !== false,
      raw: skill
    };
  }).filter((skill) => skill.id);
}

function normalizeMemoryEntries(value) {
  const entries = Array.isArray(value) ? value : [];
  return entries.map(normalizeMemoryEntry).filter(Boolean);
}

function normalizeMemoryEntry(value, index = 0) {
  if (!value || typeof value !== "object") return null;
  const id = clean(value.id || value.memoryId || value.path || value.key) || `memory-${index}`;
  return {
    id,
    memoryId: id,
    title: clean(value.title || value.label || value.name) || id,
    kind: clean(value.kind || value.type) || "memory",
    summary: clean(value.summary || value.description),
    content: typeof value.content === "string" ? value.content : clean(value.text || value.body),
    path: clean(value.path),
    agentId: clean(value.agentId),
    sessionPath: clean(value.sessionPath),
    updatedAt: clean(value.updatedAt || value.modifiedAt || value.timestamp),
    raw: value
  };
}

function summarizeUsage(entries) {
  const summary = { count: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 };
  for (const entry of Array.isArray(entries) ? entries : []) {
    summary.count += 1;
    summary.promptTokens += numberFrom(entry.promptTokens);
    summary.completionTokens += numberFrom(entry.completionTokens);
    summary.totalTokens += numberFrom(entry.totalTokens);
    summary.costUsd += numberFrom(entry.costUsd);
  }
  return summary;
}

function summarizeHistoryContext(messages) {
  const summary = {
    explicitTokens: 0,
    estimatedFromCharacters: 0,
    estimatedTokens: 0,
    messagesWithTokenCount: 0
  };
  for (const message of Array.isArray(messages) ? messages : []) {
    const tokenCount = numberFrom(message?.tokenCount);
    if (tokenCount > 0) {
      summary.explicitTokens += tokenCount;
      summary.messagesWithTokenCount += 1;
      continue;
    }
    const text = clean(message?.text);
    if (text) summary.estimatedFromCharacters += Math.ceil(text.length / 4);
  }
  summary.estimatedTokens = summary.explicitTokens + summary.estimatedFromCharacters;
  return summary;
}

function normalizeHostCheckpoints(value) {
  const checkpoints = Array.isArray(value) ? value : [];
  return checkpoints.map((checkpoint, index) => ({
    id: clean(checkpoint?.id || checkpoint?.checkpointId) || `host-checkpoint-${index}`,
    checkpointId: clean(checkpoint?.checkpointId || checkpoint?.id),
    sessionPath: clean(checkpoint?.sessionPath),
    label: clean(checkpoint?.label || checkpoint?.title || checkpoint?.reason) || "Checkpoint",
    reason: clean(checkpoint?.reason),
    createdAt: clean(checkpoint?.createdAt || checkpoint?.timestamp || checkpoint?.at),
    fileCount: numberFrom(checkpoint?.fileCount ?? checkpoint?.files?.length),
    raw: checkpoint
  })).filter((checkpoint) => checkpoint.id);
}

function filterHostCheckpoints(checkpoints, input = {}) {
  const sessionPath = clean(input.sessionPath);
  if (!sessionPath) return checkpoints;
  return checkpoints.filter((checkpoint) => !checkpoint.sessionPath || checkpoint.sessionPath === sessionPath);
}

function normalizeTerminals(terminals) {
  if (!Array.isArray(terminals)) return [];
  return terminals.map(normalizeTerminal).filter(Boolean);
}

function normalizeTerminal(value) {
  if (!value || typeof value !== "object") return null;
  const id = clean(value.terminalId || value.id);
  if (!id) return null;
  return {
    id,
    terminalId: id,
    sessionPath: clean(value.sessionPath),
    label: clean(value.label) || id,
    cwd: clean(value.cwd),
    command: clean(value.command),
    status: clean(value.status) || "unknown",
    seq: Number.isFinite(Number(value.seq)) ? Math.max(0, Math.round(Number(value.seq))) : 0
  };
}

function normalizeTerminalRead(value) {
  const chunks = Array.isArray(value?.chunks)
    ? value.chunks.map((chunk) => typeof chunk === "string" ? chunk : clean(chunk?.text || chunk?.output || chunk?.data)).filter(Boolean)
    : [];
  const output = typeof value?.output === "string" ? value.output : chunks.join("");
  return {
    seq: Number.isFinite(Number(value?.seq)) ? Math.max(0, Math.round(Number(value.seq))) : 0,
    output,
    chunks,
    terminal: normalizeTerminal(value)
  };
}

function historyContentToText(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.content === "string") return part.content;
      return "";
    }).filter(Boolean).join("\n").trim();
  }
  if (value && typeof value === "object") {
    if (typeof value.text === "string") return value.text.trim();
    if (typeof value.content === "string") return value.content.trim();
  }
  return "";
}

function truncateForPrompt(value, maxChars) {
  const text = clean(value);
  const limit = clampInt(maxChars, 80, 100000, 4000);
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 32)).trimEnd()}\n...[truncated ${text.length - limit} chars]`;
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function numberFrom(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function normalizeAgents(agents) {
  if (!Array.isArray(agents)) return [];
  return agents.map((agent) => ({
    id: clean(agent?.id),
    name: clean(agent?.name) || clean(agent?.id) || "Unnamed Agent",
    isCurrent: !!agent?.isCurrent,
    isPrimary: !!agent?.isPrimary
  })).filter((agent) => agent.id || agent.name);
}

function normalizeSessions(sessions) {
  if (!Array.isArray(sessions)) return [];
  return sessions.map((session) => ({
    ...normalizeSession(session),
    firstMessage: clean(session?.firstMessage),
    agentName: clean(session?.agentName),
    messageCount: Number.isFinite(Number(session?.messageCount)) ? Number(session.messageCount) : 0,
    modified: session?.modified || null
  })).filter((session) => session.path);
}

function applySessionTombstones(sessions, tombstones) {
  const hidden = new Set();
  for (const item of Array.isArray(tombstones) ? tombstones : []) {
    const sessionPath = clean(item?.sessionPath || item?.path);
    if (sessionPath) hidden.add(sessionPath);
  }
  if (!hidden.size) return sessions;
  return (Array.isArray(sessions) ? sessions : []).filter((session) => !hidden.has(session.path));
}

function applySessionAliases(sessions, aliases) {
  const map = new Map();
  for (const alias of Array.isArray(aliases) ? aliases : []) {
    const sessionPath = clean(alias?.sessionPath || alias?.path);
    const title = clean(alias?.title || alias?.name);
    if (!sessionPath || !title) continue;
    map.set(sessionPath, alias);
  }
  return (Array.isArray(sessions) ? sessions : []).map((session) => {
    const alias = map.get(session.path);
    if (!alias) return session;
    return {
      ...session,
      originalTitle: session.originalTitle || session.title,
      title: clean(alias.title || alias.name) || session.title,
      alias: {
        title: clean(alias.title || alias.name),
        updatedAt: clean(alias.updatedAt),
        source: clean(alias.source) || "hanaagent"
      }
    };
  });
}

function safeConfig(ctx) {
  try {
    const config = ctx?.config?.getAll?.() || {};
    return {
      defaultAgentId: clean(config.defaultAgentId),
      defaultSessionPath: clean(config.defaultSessionPath),
      workspaceRoots: Array.isArray(config.workspaceRoots) ? config.workspaceRoots : [],
      autopilotSchedule: config.autopilotSchedule && typeof config.autopilotSchedule === "object" ? config.autopilotSchedule : {},
      agentProfiles: listAgentProfiles(ctx?.dataDir),
      savedMissions: Array.isArray(config.savedMissions) ? config.savedMissions : [],
      pinnedSessions: Array.isArray(config.pinnedSessions) ? config.pinnedSessions : [],
      pinnedModels: Array.isArray(config.pinnedModels) ? config.pinnedModels : [],
      modelMetadata: Array.isArray(config.modelMetadata) ? normalizeModelMetadata(config.modelMetadata) : [],
      savedBoardViews: Array.isArray(config.savedBoardViews) ? config.savedBoardViews : [],
      boardWipLimits: config.boardWipLimits && typeof config.boardWipLimits === "object" ? config.boardWipLimits : {},
      sessionAliases: Array.isArray(config.sessionAliases) ? config.sessionAliases : [],
      sessionTombstones: Array.isArray(config.sessionTombstones) ? config.sessionTombstones : [],
      workbenchModes: Array.isArray(config.workbenchModes) ? config.workbenchModes : [],
      activeWorkbenchModeId: clean(config.activeWorkbenchModeId),
      workbenchNotifications: config.workbenchNotifications && typeof config.workbenchNotifications === "object" ? config.workbenchNotifications : {},
      workbenchSettings: config.workbenchSettings && typeof config.workbenchSettings === "object" ? config.workbenchSettings : {},
      workbenchOnboarding: config.workbenchOnboarding && typeof config.workbenchOnboarding === "object" ? config.workbenchOnboarding : {}
    };
  } catch {
    return { defaultAgentId: "", defaultSessionPath: "", workspaceRoots: [], autopilotSchedule: {}, agentProfiles: [], savedMissions: [], pinnedSessions: [], pinnedModels: [], modelMetadata: [], savedBoardViews: [], boardWipLimits: {}, sessionAliases: [], sessionTombstones: [], workbenchModes: [], activeWorkbenchModeId: "", workbenchNotifications: {}, workbenchSettings: {}, workbenchOnboarding: {} };
  }
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
