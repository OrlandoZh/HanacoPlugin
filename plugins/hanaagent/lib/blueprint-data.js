export const TEMPLATE_LIBRARY = [
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

export const CHECKPOINT_CONTRACT = [
  "STATE: DONE | BLOCKED | NEEDS_INPUT | HANDOFF | IN_PROGRESS | NEEDS_REVIEW",
  "FILES_CHANGED: exact paths or none",
  "COMMANDS_RUN: exact commands or none",
  "RESULT: concrete result/proof",
  "BLOCKER: blocker or none",
  "NEXT_ACTION: exact recommended next action"
];

export const PARITY_STATUSES = [
  "plugin-implemented",
  "host-provided",
  "capability-gated",
  "out-of-scope-for-plugin",
  "missing"
];

export const HERMES_PARITY_MATRIX = [
  {
    id: "frontend-screens",
    label: "前端界面与工作台面板（Frontend screens and workbench surfaces）",
    items: [
      {
        id: "conductor-chat-agent-view",
        label: "聊天、Agent 视图（Agent View）、研究卡片（Research Card）、可分页/可折叠的检查器面板、滚动到底部、空状态、平滑流式输出、输入指示器、Markdown/代码/思考消息渲染、可展开的工具调用详情、会话列表过滤、会话 fork、别名、墓碑、实时事件、历史与工具踪迹",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/workbench researchCardPanel embedded display with buildResearchCard(), copyResearchCard(), saveResearchCardToMemory(), recordResearchCardArtifact(); smoothStreamTick(), streaming-indicator, streaming-cursor, and streaming-skeleton for live text_delta reveal; inspectorPanel with inspector-tabs, inspector-tab, inspectorCollapseBtn, and toggleInspectorCollapsed() for Activity/Context/Tools/Knowledge/Worker panes; workerOutputScrollBtn scroll-to-bottom control, chat-empty-state onboarding actions, message-preview renderer with safe Markdown/code blocks/copy/thinking/tool pills and expandable message-tool-detail panels for tool calls, tool results, commands, files, checkpoints, and errors; local session sidebar filter, /api/session-fork, /api/sessions with sessionAliases/sessionTombstones, /api/session-history plus key/sessionKey alias, /api/session-send, /api/session-events, buildToolTrace(); tool-artifact-store.js mirrors Hermes artifact-backed tool outputs by externalizing >4KB session:history tool results to stable toolout_* records with summary/preview/pointer"
      },
      {
        id: "dashboard-overview",
        label: "仪表盘概览与运行时聚合器（Dashboard overview and runtime aggregator）",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/overview sections for agents, sessions, missions, tasks, usage plus mission/assignment/session attribution, workers, incidents"
      },
      {
        id: "agenda-calendar",
        label: "用于关注事项、活跃任务（missions）、到期任务（tasks）、即将到来的作业（jobs）、审批与带日期工作的日程（Agenda）与日历（Calendar）视图",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/agenda aggregates Hermes AgendaView-style attention/active/tasks/upcoming/recent/agent sections from missions, tasks, jobs, approvals, failures, and host agents; /workbench renders Agenda attention/active/tasks/upcoming/completed/agents as collapsible sections with counts and Hide/Show state, and each row can open its mission, task editor, worker drilldown, approval queue item, Run Console record, job detail, or agenda detail; /api/calendar aggregates Hermes CalendarView-style day/week/month events from mission starts, task due dates, pending approvals, and recurring jobs expanded from daily/weekly/monthly/5-field cron schedules, including cron step/range/list syntax for minutes, hours, weekdays, and month days; Calendar supports local/UTC/IANA timezone selection via query or workbenchSettings.calendarTimezone and returns dayKey/localTime/timezone so recurring jobs expand on the selected wall-clock time; /workbench renders Calendar controls with day/week/month mode, previous/today/next navigation, timezone display, month/week grids, day hour axis, event open, copy summary, and type-aware drilldown into missions, tasks, approvals, and jobs"
      },
      {
        id: "files-editor-preview",
        label: "文件浏览器、项目元数据、上传、预览、下载、diff、补丁审查、写入、重命名、删除",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/paths and /api/files?action=list|read|download plus POST /api/files provide Hermes Files API aliases over workspaceRoots; /api/workspace-files, /api/workspace-file/upload, /api/workspace-file, /api/workspace-file/diff, /api/workspace-file/patch-review accept/reject, workspaceRoots sandbox; worker-ide files.project reads package.json scripts and .git/HEAD branch only inside authorized workspace roots"
      },
      {
        id: "terminal-surface",
        label: "Terminal 连接、读取、写入、关闭、状态与 xterm 风格 TUI 控制",
        status: "capability-gated",
        owner: "openhanako + hanaagent",
        evidence: "/api/terminals proxies terminal:list/start/read/write/close; /api/terminal-stream, /api/terminal-input, /api/terminal-resize, and /api/terminal-close provide Hermes terminal aliases over OpenHanako host-managed terminals; /workbench terminalFrame, terminal-screen ANSI renderer, command history, quick commands, clear, copy, auto-read status",
        notes: "插件负责渲染与控制界面；PTY 创建仍由宿主负责。"
      },
      {
        id: "memory-browser",
        label: "记忆（Memory）列表、读取、搜索/编辑回退",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/memory, /api/memory/:memoryId, local memory store fallback"
      },
      {
        id: "skills-browser",
        label: "技能（Skills）浏览器与技能清单",
        status: "capability-gated",
        owner: "openhanako + hanaagent",
        evidence: "/api/agent-skills, /api/agents/:agentId/skills, /api/integrations",
        notes: "安装/启用流程依赖宿主技能注册处理器。"
      },
      {
        id: "jobs-automation",
        label: "作业（Jobs）、调度、后台自动化与即将到来的调度可见性",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/jobs, job scheduler, autopilot schedule/tick, /api/agenda upcomingJobs, /api/calendar job events"
      },
      {
        id: "settings-provider-config",
        label: "Provider/设置配置、内联模型选择器、8 套主题系统与本地工作台偏好",
        status: "plugin-implemented",
        owner: "openhanako + hanaagent",
        evidence: "OpenHanako model/provider settings plus hanaagent capability/readiness panels and /workbench modelChooserBackdrop inline provider/model chooser; workbenchSettings via /api/defaults for themePreset covering Hermes/Claude Official/Classic/Slate/Mono light+dark variants, accent/editor/usage threshold/system metrics/mobile nav/calendar timezone"
      }
    ]
  },
  {
    id: "backend-apis",
    label: "后端 API 端点（Backend API endpoints）",
    items: [
      {
        id: "chat-sessions-api",
        label: "聊天、会话（Session）创建/列表/状态/发送/历史/中止",
        status: "capability-gated",
        owner: "openhanako + hanaagent",
        evidence: "session:* bus probes and /api/sessions, /api/dispatch, /api/session-* routes; /api/send, /api/send-stream, /api/history, /api/events, and /api/chat-events provide Hermes Chat/Messaging aliases over OpenHanako session:send/session:history/session-events; /api/session-send maps Hermes ControlSuite sessionKey/message into OpenHanako session:send"
      },
      {
        id: "mission-task-checkpoint-api",
        label: "任务（Missions）、分配、带过滤/可编辑/可重排/批量的任务看板，含保存视图、WIP 限制、快捷键、检查点（Checkpoints）、检查点提醒与复核门",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/missions, /api/tasks, board search/assignee/priority filters, savedBoardViews and boardWipLimits in /api/defaults, focused task keyboard shortcuts, drag/drop reorder via /api/tasks/:taskId/move, batch move/update/delete via /api/tasks/batch, full task editor via PATCH /api/tasks/:taskId, Hermes /api/claude-tasks and /api/hermes-tasks aliases with launch action, /api/checkpoints, /api/checkpoint-reminders, /api/checkpoints/:checkpointId/reminder, /api/review-gate, /api/inbox"
      },
      {
        id: "files-memory-skills-api",
        label: "文件、记忆（Memory）、技能（Skills）、集成",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/workspace-*, /api/memory*, /api/agent-skills, /api/integrations"
      },
      {
        id: "terminal-api",
        label: "Terminal 会话（Session）API",
        status: "capability-gated",
        owner: "openhanako + hanaagent",
        evidence: "/api/terminals routes proxy host terminal:* capabilities; Hermes /api/terminal-stream/input/resize/close aliases are provided without plugin-owned PTY spawning"
      },
      {
        id: "auth-security-api",
        label: "认证、授权与插件令牌强制",
        status: "host-provided",
        owner: "openhanako",
        evidence: "OpenHanako plugin route token/auth boundary; plugin path checks for file/memory operations"
      }
    ]
  },
  {
    id: "orchestration",
    label: "Conductor、Swarm 与 Worker IDE",
    items: [
      {
        id: "swarm-conductor",
        label: "Conductor 任务规划、SwarmBrief 合约、紧凑 Swarm Hub、调度、按花名册广播、停止、完成、继续",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "mission-store, /api/conductor-spawn, /api/conductor-stop, /api/missions/:id/briefs, /api/missions/:id/assignments/:assignmentId/brief, /api/missions/:id/dispatch|broadcast|stop|complete|continue; dispatch and broadcast prompts include Hermes-style SwarmBrief YAML plus checkpoint contract; /api/missions/:id/broadcast respects assignment.roster.acceptsBroadcast by default, records broadcast mission events, and sends checkpoint-bearing follow-up prompts through OpenHanako session:send; /api/missions/:id/continue creates continuation mission/tasks and by default reuses or creates a worker session before sending the continuation brief through OpenHanako session:send, with dispatch:false for plan-only continuation; /workbench officeView swarm-hub-card with main agent identity, swarm/active/room/blocker metrics, lane wires, and routing/autopilot/inbox/refresh controls"
      },
      {
        id: "hermes-swarm-api-compat",
        label: "Hermes Swarm API 兼容别名，覆盖花名册、调度、任务、检查点、运行时、健康、聊天、分解、看板（Kanban）、记忆、报告、项目、环境、生命周期、Terminal、直接聊天、编排循环与运行时重置",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/swarm-roster GET/POST maps Hermes roster workers into Operations profiles; /api/swarm-dispatch accepts workerIds+prompt or assignments[] and creates/dispatches HanaAgent missions with SwarmBrief output; /api/swarm-missions lists, reports, and cancels missions or assignments; /api/swarm-checkpoint accepts worker runtime checkpoint shape and writes checkpoint/mission/task/host-task state through existing OpenHanako-safe stores; /api/swarm-runtime, /api/swarm-health, and /api/swarm-chat expose worker observability from OpenHanako sessions, assignments, tasks, checkpoints, run records, and session history; /api/swarm-decompose returns deterministic fallback assignments plus Hermes JSON-only orchestratorPrompt/rosterText and can dispatch that prompt through OpenHanako session:send; /api/swarm-kanban, /api/swarm-memory, /api/swarm-reports, /api/swarm-project, /api/swarm-environment, /api/swarm-lifecycle, /api/swarm-tmux-start|stop|scroll, /api/swarm-direct-chat, /api/swarm-orchestrator-loop, and /api/swarm-runtime/reset provide OpenHanako-safe aliases for the remaining Hermes swarm-* surfaces without directly manipulating Hermes tmux/profile files"
      },
      {
        id: "worker-cards-ide",
        label: "Worker 卡片、分页多面板 Worker IDE、预览到修复的任务捕获、补丁审查交接、生命周期控制与持久交接记忆",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/workers, /api/workers/:workerId, /api/workers/:workerId/lifecycle, /api/workers/:workerId/handoff, /api/handoffs, /api/handoffs/:workerId, worker-ide.js, worker-lifecycle.js, handoff-store.js; /workbench worker-ide-shell with hub, lane map, Worker IDE panes for Overview/Chat/Queue/Terminal/Preview/Files/Evidence; Project Metadata and Dev Scripts cards show projectName/cwd/branch/package scripts from files.project; worker-visual-picker and createPreviewFixTask() create backlog tasks from preview URL, selector, issue, worker, session, mission, and assignment evidence; Files panel can turn diffs into approval records and accept/reject patch reviews; lifecycle state exposes healthy/watch/handoff_required/renew_required and can dispatch strict STATE: HANDOFF prompts; HANDOFF checkpoints materialize latest/archive markdown under memory/handoffs/swarm and appear in Memory plus Worker Evidence"
      },
      {
        id: "run-console-records",
        label: "产物、审批队列/历史、分类经验、运行对比与物化文件",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/run-records, /api/run-learnings, /api/run-compare, /api/approvals, /api/gateway/approvals, /api/approvals/:approvalId/:action, /api/gateway/approvals/:approvalId/:action, /api/artifacts, /api/artifacts/:artifactId, /api/missions/:id/report-artifact, /api/missions/:id/assignments/:assignmentId/brief/artifact, materializeRunRecordFile(), SessionFile staging; /api/artifacts merges Run Console artifacts with Hermes Tool Output Artifacts from dataDir/tool-artifacts, lists metadata/preview only, preserves terminal_log/file_read/diff/skill_doc/tool_output kinds, and lazy-loads full content through /api/artifacts/:artifactId; /workbench Run Console mirrors Hermes RunLearnings success/failure/optimization filters and RunCompare side-by-side status/duration/token/cost/agent/artifact/approval/learning metrics; Mission Report and SwarmBrief can be recorded as versioned Run artifacts with materialized files and preview; approvalsPanel mirrors Hermes Approvals Page/Bell queue with pending/history, risk labels, open, approve, deny, copy, and mission/worker drilldown"
      },
      {
        id: "autopilot-routing",
        label: "Autopilot 路由、陈旧扫描、复核请求、升级与调度器",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/autopilot, /api/autopilot/tick, /api/missions/:id/autopilot"
      },
      {
        id: "operations-profiles",
        label: "运维预设、就绪度、动态花名册泳道、配置任务与 Hermes swarm 花名册导入/导出",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/operations, /api/operations/presets, /api/operations/profiles, /api/operations/profiles/:profileId/swarm-roster, /api/operations/swarm-roster/import; operation-profiles.js preserves Hermes swarm.yaml worker metadata including specialty/model/mission/profile/modes/tools/skills/capabilities/preferredTaskTypes/greenlightRequiredFor/maxConcurrentTasks/acceptsBroadcast/plugins/pluginToolsets/mcpServers/wrapper/defaultCwd; mission-store.js builds dynamic assignments from imported roster lanes and keeps assignment.roster for worker tools/skills/greenlight evidence"
      }
    ]
  },
  {
    id: "architecture-integrations",
    label: "架构与集成（Architecture and integrations）",
    items: [
      {
        id: "gateway-capability-probes",
        label: "网关/能力探测与降级模式 UI",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "hasBusCapability(), computeHostGaps(), /api/state capabilities, Setup Doctor with structured repair actions, setup-repair buttons for Provider Setup/Model Chooser/session/files/terminal/context/operations, connectionBanner health banner, backend-unavailable/degraded/blocked states"
      },
      {
        id: "event-bus-runtime",
        label: "事件总线与实时会话（Session）流",
        status: "capability-gated",
        owner: "openhanako + hanaagent",
        evidence: "ctx.bus.request probes plus /api/session-events SSE"
      },
      {
        id: "run-store-persistence",
        label: "运行/任务/作业持久化（Run/task/mission/job persistence）",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "dataDir JSON stores for missions, tasks, checkpoints, jobs, profiles, run records"
      },
      {
        id: "mcp-provider-catalog",
        label: "MCP、Provider、插件与能力集成目录",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "integration-catalog.js, /api/integrations, /api/integrations/action, plus Hermes infra aliases /api/auth, /api/auth-check, /api/ping, /api/workspace, /api/plugins, /api/mcp, /api/skills, /api/local-providers, /api/provider-usage, /api/system-metrics, /api/connection-settings, /api/config-patch, /api/gateway-reprobe, /api/start-agent, /api/start-claude, /api/claude-update, /api/crew-status, /api/oauth/device-code, /api/oauth/poll-token, /api/media, /api/preview-file, /api/transcribe, /api/playground-admin, /api/playground-npc, /api/vt-capital, plus nested profiles/knowledge/mcp/sessions/skills/update/dashboard aliases; recursive Hermes API alias diff is zero for the plugin-safe compatibility scope"
      },
      {
        id: "workspace-agents-checkpoints",
        label: "工作区 Agent 与文件检查点（Checkpoint）",
        status: "capability-gated",
        owner: "openhanako + hanaagent",
        evidence: "agent:list, checkpoint:list, checkpoint:find-by-session-since proxies"
      }
    ]
  },
  {
    id: "ux-security-deployment",
    label: "UX、安全、移动端与部署",
    items: [
      {
        id: "command-center-search-export",
        label: "命令面板、搜索、斜杠命令、语音输入、文件附件、会话历史搜索、富消息预览、报告、Markdown/批量/zip 导出、会话 fork、上下文用量计、会话标题建议",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/search with session:history scanning, message-preview safe Markdown/code/thinking/tool-pill renderer, mission reports/export, /api/session-export and /api/session-export/batch with Markdown/JSON/Text/HTML/CSV/ZIP bundle formats, /api/session-fork, /api/context-usage, /api/session-title, Hermes-style Command Palette via ⌘K with executable workbench commands, command center UI, Mission slash command menu, browser Web Speech voice input, browser FileReader attachment context"
      },
      {
        id: "smart-model-suggestions",
        label: "智能模型建议、内联模型选择器、模型元数据、可拖拽的固定模型/会话管理、已保存工作台模式、toast 通知与引导教程",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/api/model-suggestions, modelChooserBackdrop aggregating smart suggestions/pinned/modelMetadata/current/session models with search/source filter/apply/pin/copy actions, modelMetadata context/price data, pinnedModels, pinnedSessions, workbenchModes + activeWorkbenchModeId + workbenchNotifications + workbenchOnboarding via /api/defaults, Pinned panel select/default/up-down reorder/drag-drop reorder/apply/remove actions, Modes panel save/apply/rename/delete/drift, in-app toastStack/error toast/model suggestion toast, Web Audio notification sounds, browser Notification option, navigator.vibrate haptics, onboarding tour modal with setup/mission/board/runtime/files/run-console steps, Setup Doctor repair actions that open Provider Setup/Model Chooser and other runtime panels, Agent Runtime suggestion panel"
      },
      {
        id: "path-security-validation",
        label: "路径穿越、符号链接边界、输入校验",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "workspace-files.js and memory-store.js path guards"
      },
      {
        id: "responsive-plugin-ui",
        label: "响应式 OpenHanako iframe 工作台 UI，含移动端头部、汉堡菜单、会话面板与标签栏",
        status: "plugin-implemented",
        owner: "hanaagent",
        evidence: "/workbench single-page responsive layout, mobilePageHeader, mobileSessionsDrawer/mobileSessionsPanel, mobile hamburger trigger, mobileTabBar bottom navigation, mobileChatNavMode dock/integrated/scroll-hide, section jump targets for control/conductor/board/runtime/files/terminal"
      },
      {
        id: "pwa-electron-docker",
        label: "Hermes 独立 PWA/Electron/Docker 部署",
        status: "out-of-scope-for-plugin",
        owner: "openhanako deployment",
        evidence: "HanaAgent ships as an OpenHanako plugin zip/manifest instead of a standalone app"
      },
      {
        id: "standalone-hermes-installer",
        label: "Hermes Agent 安装器与网关自动启动",
        status: "out-of-scope-for-plugin",
        owner: "openhanako deployment",
        evidence: "OpenHanako owns process/model lifecycle; HanaAgent probes capabilities after install"
      }
    ]
  }
];

export function cloneParityItem(item) {
  return { ...item };
}

export function summarizeParityMatrix(categories) {
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

export const WORKBENCH_BLUEPRINT = {
  reference: "reference/hermes-workspace-main",
  thesis: "HanaAgent 应从提示词分发器演进为面向 Agent 会话（Session）、任务、检查点（Checkpoint）与 Worker 卡片的能力门控控制平面。",
  currentCoverage: [
    { id: "agent-session-probe", label: "Agent/会话（Session）探测", status: "implemented" },
    { id: "mission-dispatch", label: "向已存在会话（Session）分发任务（Mission）", status: "implemented" },
    { id: "workflow-templates", label: "工作流（Workflow）提示词模板", status: "implemented" },
    { id: "persistent-task-board", label: "持久任务看板，含保存视图、WIP 限制、快捷键、搜索、指派人/优先级过滤、拖拽排序、批量操作与完整卡片编辑", status: "implemented" },
    { id: "capability-overview", label: "能力概览（Capability overview）", status: "implemented" },
    { id: "checkpoint-inbox", label: "检查点（Checkpoint）收件箱，含冲突解决与到期提醒", status: "implemented" },
    { id: "worker-cards", label: "来自会话/任务/检查点（Checkpoint）的 Worker 卡片", status: "implemented" },
    { id: "tool-call-rendering", label: "工具调用、工具结果、命令、文件、检查点（Checkpoint）、错误踪迹渲染、可展开详情、复制操作与安全的 Markdown/代码/思考消息预览", status: "implemented" },
    { id: "live-session-events", label: "实时会话（Session）事件流，含平滑文本揭示、输入指示器、Agent 视图谱料与检查器活动摘要", status: "implemented" },
    { id: "agent-runtime-profile", label: "Agent 配置/运行时档案", status: "implemented" },
    { id: "usage-ledger", label: "用量/成本台账，含任务（mission）与分配归属", status: "implemented" },
    { id: "host-task-runtime", label: "宿主任务/作业运行时", status: "implemented" },
    { id: "agenda-calendar", label: "用于活跃任务（missions）、到期任务（tasks）、周期作业（jobs）、审批与带日期工作的日程（Agenda）/日历（Calendar）聚合", status: "implemented" },
    { id: "run-console-records", label: "产物、惰性工具输出产物、审批、分类经验、运行对比、任务报告产物与 SwarmBrief 产物", status: "implemented" },
    { id: "artifact-files", label: "产物文件物化与 SessionFile 暂存", status: "implemented" },
    { id: "batch-session-export", label: "批量、固定、HTML、CSV 与 ZIP 会话导出包", status: "implemented" },
    { id: "autopilot-routing", label: "Autopilot 路由建议、调度、陈旧 Worker 扫描、升级与调度器", status: "implemented" },
    { id: "operations-profile-presets", label: "运维档案预设、就绪度仪表盘、动态花名册调度与 Hermes swarm 花名册导入/导出", status: "implemented" },
    { id: "integration-catalog", label: "MCP、技能、插件与能力集成目录", status: "implemented" },
    { id: "skills-memory-readonly", label: "宿主技能、宿主记忆（Memory）与本地可编辑记忆面板", status: "implemented" },
    { id: "worker-session-lifecycle", label: "专用 Worker 会话（Session）创建/状态", status: "implemented" },
    { id: "continuation-worker-dispatch", label: "延续任务（missions）创建任务并通过 OpenHanako 会话自动调度 Worker 简报", status: "implemented" },
    { id: "worker-context-lifecycle", label: "Swarm2 Worker 生命周期上下文策略、handoff_required/renew_required 状态、严格交接提示词调度与持久交接文件", status: "implemented" },
    { id: "session-alias-rename", label: "用于 Hermes 风格侧栏标题的会话（Session）别名重命名叠层", status: "implemented" },
    { id: "session-sidebar-filter", label: "会话侧栏本地过滤，按标题、别名、路径、Agent、cwd 与模型", status: "implemented" },
    { id: "session-tombstones", label: "用于工作台删除/隐藏清理的会话（Session）器碑", status: "implemented" },
    { id: "session-fork", label: "会话（Session）fork/复制工作流（Workflow），含延续提示词", status: "implemented" },
    { id: "session-history-search", label: "跨近期宿主历史的会话（Session）搜索", status: "implemented" },
    { id: "research-card", label: "由任务、备注、会话历史、工具踪迹、记忆（Memory）与 Worker 输出生成的嵌入式研究卡片（Research Card）", status: "implemented" },
    { id: "command-palette", label: "Hermes 风格命令面板，含可搜索的可执行工作台命令", status: "implemented" },
    { id: "context-usage-meter", label: "上下文用量计，含模型元数据上下文窗口与阈值告警", status: "implemented" },
    { id: "terminal-surface", label: "宿主管理 Terminal 连接、xterm 风格 TUI 屏幕、实时读/写/关闭、历史、快捷命令、复制与状态面板", status: "implemented" },
    { id: "files-editor-preview", label: "工作区文件上传、编辑器、预览、diff、补丁审查接受/拒绝与保存面板", status: "implemented" },
    { id: "auto-session-titles", label: "由历史自动生成的会话（Session）标题建议", status: "implemented" },
    { id: "pinned-management", label: "固定会话/模型选择、默认、拖拽重排、应用与移除操作", status: "implemented" },
    { id: "smart-model-suggestions", label: "智能模型建议与内联模型/Provider 选择器，源自任务档案、固定模型、当前会话与模型元数据", status: "implemented" },
    { id: "eight-theme-system", label: "Hermes 风格主题预设，覆盖 Claude Official、Classic、Slate、Mono 与浅色变体", status: "implemented" },
    { id: "toast-system", label: "Hermes 风格 toast、error-toast 与 model-suggestion-toast 堆栈", status: "implemented" },
    { id: "mobile-tabbar", label: "移动端页面头部、汉堡会话面板、移动端标签栏与用于工作台分区跳转的移动端聊天导航模式", status: "implemented" },
    { id: "connection-health-banner", label: "连接叠层、健康横幅与后端不可用状态", status: "implemented" },
    { id: "onboarding-tour", label: "Hermes 风格引导教程，含持久化完成/忽略状态与可执行 Setup Doctor 修复操作", status: "implemented" }
  ],
  phases: [
    {
      id: "phase-1",
      label: "稳定工作台骨架",
      summary: "暴露蓝图、能力、工作流（Workflow）模板、路由冒烟测试与可见差距。"
    },
    {
      id: "phase-2",
      label: "持久任务与 overview 聚合",
      summary: "将任务从 localStorage 迁移到 ctx.dataDir，并加入服务端 overview 聚合器。"
    },
    {
      id: "phase-3",
      label: "Mission / Checkpoint 闭环",
      summary: "注入检查点（Checkpoint）合约、解析 Worker 检查点、将状态路由进收件箱与看板泳道，并通知到期检查点提醒。"
    },
    {
      id: "phase-4",
      label: "Worker 卡片",
      summary: "展示真实 Agent/会话状态、当前任务、队列、近期消息、快捷操作与每个 Worker 的分页多面板 Worker IDE。"
    },
    {
      id: "phase-5",
      label: "IDE 面板",
      summary: "仅通过稳定的 Hana 宿主 API 门控并接入记忆、技能、文件、预览与 Terminal。"
    },
    {
      id: "phase-6",
      label: "Autopilot",
      summary: "加入可审计的路由建议、陈旧 Worker 检测、阻塞升级与复核门。"
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

