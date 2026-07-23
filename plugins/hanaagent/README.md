# HanaAgent Workbench

Hanaco 智能体工作台插件，参考 `reference/hermes-workspace-main` 的多智能体控制台思路，并吸收 `reference/open-agent-builder-main` 的 MIT-licensed workflow builder 模型和可视化交互方式，做成适合 OpenHanako 插件系统的轻量单页工作台。

系统性分析和后续路线图见：

```text
docs/hanaagent/HERMES_WORKSPACE_ANALYSIS.md
docs/hanaagent/IMPLEMENTATION_AUDIT.md
```

## 能力

- 在页面内探测 Hana `agent:list`、`agent:config`、`agent:skills`、`memory:*`、`session:list/create/status/send/history/abort`、`usage:list`、`checkpoint:*`、`task:*`、`deferred:*`、`terminal:*` 能力。
- 选择已有智能体和会话，把任务投递到目标 session。
- 支持 Open Agent Builder 风格 Workflow Builder：工作台内置左侧节点库、中间可拖拽 SVG/HTML 画布、右侧属性/连接/校验面板和 Preview 面板；支持 Start、Agent、MCP、Transform、If/Else、While、User Approval、Set State、End、Note 节点。
- 支持 Workflow 模板库和本地持久化：Simple Agent Workflow、Research With Approval、Mission Dispatch Pipeline 等模板保存在插件逻辑中，用户创建的 workflow 保存在插件 `dataDir/workflows.json`。
- 支持 Workflow CRUD / Preview / Execute / Mission 编译 API：`/api/workflow-templates`、`/api/workflows`、`/api/workflows/:workflowId`、`/api/workflows/:workflowId/preview`、`/api/workflows/:workflowId/execute`、`/api/workflows/:workflowId/execute-stream` 和 `/api/workflows/:workflowId/mission`；Preview 会给出安全执行路径和节点结果，Execute 默认走安全 Preview，`mode:"mission"` 会把 Agent 节点映射为 HanaAgent 原生 assignments/tasks，stream 版返回 SSE 节点状态事件。
- 支持 `/workflows` 和 `/workflows/:workflowId` 页面入口兼容层：打开后跳到 HanaAgent 原生 workflow canvas，而不是加载参考项目的 Next/React Flow 应用。
- Conductor 指挥台：输入 Mission 后自动生成 mission、worker assignments、事件流和办公室式 live view。
- 支持 Hermes SwarmBrief 风格任务契约：`/api/missions/:missionId/briefs` 和 `/api/missions/:missionId/assignments/:assignmentId/brief` 会为每个 assignment 生成 `brief_id / worker / project / goal / why_now / scope / deliverables / test_or_proof / constraints / checkpoint_contract / escalation / budget`，dispatch 与 broadcast prompt 会携带同一份 YAML brief；工作台 assignment 卡可直接查看并复制 Brief。
- 支持 Hermes Swarm API 兼容路由：`/api/swarm-roster`、`/api/swarm-dispatch`、`/api/swarm-missions`、`/api/swarm-checkpoint`、`/api/swarm-runtime`、`/api/swarm-health`、`/api/swarm-chat`、`/api/swarm-decompose`、`/api/swarm-kanban`、`/api/swarm-memory`、`/api/swarm-reports`、`/api/swarm-project`、`/api/swarm-environment`、`/api/swarm-lifecycle`、`/api/swarm-tmux-start|stop|scroll`、`/api/swarm-direct-chat`、`/api/swarm-orchestrator-loop`、`/api/swarm-runtime/reset` 映射到 OpenHanako 插件内 Operations profile、mission、dispatch、checkpoint、task board、memory/handoff、reports、worker observability、worker lifecycle、host-managed terminal/session 和 session history 能力，方便迁移 Hermes 风格脚本/调用。
- Conductor 支持 Hermes Swarm broadcast 风格补充指令：`/api/missions/:missionId/broadcast` 会默认只发送给 `assignment.roster.acceptsBroadcast=true` 的 worker，通过 OpenHanako `session:send` 分发 checkpoint-bearing follow-up prompt，并把 sent/skipped 记录进 mission event。
- Mission store 保存在插件 `dataDir/missions.json`，通过 `/api/missions` 创建、查询、更新和投递。
- Mission report / export / continue 通过 `/api/missions/:id/report`、`/api/missions/:id/export`、`/api/missions/:id/continue` 提供；continue 会基于上一轮 mission 生成续接 prompt、创建 continuation mission/task，并默认复用或创建 worker session 后自动投递续接 Brief，传 `dispatch:false` 时只生成计划。
- Mission Inbox / Reports 通过 `/api/inbox` 与 `/api/missions/:id/inbox` 汇总 blocker、待审批、需要输入、handoff、待复核和 Review Gate 风险。
- Mission 创建时自动拆成编排/构建/复核/验证/记录等 worker assignment，并同步生成看板任务。
- 支持 Hermes Kanban TaskBoard 风格筛选、保存视图、WIP 限制、快捷键、完整卡片编辑、拖拽排序和批量操作：看板可按任务标题/描述/标签/session 搜索，并按 assignee、priority 过滤；常用筛选可保存为 Board View；每个 lane 可设置 WIP limit 并在接近/超过时提示；聚焦任务后可用键盘编辑、选择、推进、删除；任务卡片可在工作台 modal editor 中编辑标题、描述、列、优先级、负责人、截止时间、标签、session、mission 和 assignment 关联，也可直接拖到目标列/位置；多选后可批量移动、改优先级、删除，列计数会随筛选更新。
- 支持 Hermes Keyboard Shortcuts Modal 风格快捷键帮助：顶部“快捷键”按钮、`⌘/` 和 `?` 都可打开帮助层，集中展示全局搜索、看板、Mission composer、终端和 modal 的快捷操作。
- 支持 Hermes Command Palette 风格 `⌘K` 面板：可搜索并执行刷新工作台、聚焦全局搜索、打开引导/快捷键、创建/派发 mission、生成报告、同步 checkpoint、刷新 integrations、建议模型、启动 terminal、导出 pinned sessions、运行 Autopilot tick、保存默认值等工作台动作。
- 支持 Hermes Sound Notification / Haptic Feedback 风格本地反馈：工作台可配置声音开关、音量、浏览器通知和移动端触觉反馈；使用 Web Audio API 合成 spawned/complete/failed/chat/alert 等提示音，不依赖音频文件。
- 支持 Hermes Toast / Error Toast / Model Suggestion Toast 风格页面内提示：右上角 `toastStack` 会显示普通日志、失败、提醒、完成、模型建议等短消息，可手动关闭并自动过期。
- 支持 Hermes Settings / Theme / Editor 偏好：工作台可配置 Hermes/星图观测站（Starmap）/Claude Official/Claude Official Light/Claude Classic/Classic Light/Slate/Slate Light/Mono/Mono Light 主题预设、system/light/dark、accent color、编辑器字号、换行、minimap、context usage 阈值、系统指标页脚、移动端导航模式和 Calendar timezone；主题预设、强调色、编辑器字号/换行、usage threshold 和日历时区会即时影响页面。
- 知识区域吸收星图的“候选卡片 → 人工确认 → 记忆/来源产物”工作流：现有 Research Card 入口以“知识候选卡片”呈现，确认后保存到 HanaAgent Memory，仍保留原始 Session、Mission 和 Artifact 作为来源，不建立第二套知识事实源。
- 支持 Hermes Mobile Header / Hamburger / Sessions Panel / Tab Bar 风格移动端导航：小屏显示顶部 `mobilePageHeader`、汉堡按钮和 `mobileSessionsDrawer` 会话抽屉，可搜索、选择、Pin 前的目标会话；底部 `mobileTabBar` 可快速跳到控制台、Conductor、看板、运行、文件和终端，并响应 `dock / integrated / scroll-hide` 三种移动导航模式。
- 支持 Hermes Onboarding Tour / Setup Doctor 风格首次引导：顶部“引导”按钮和 Setup Doctor 均可打开步骤式工作台引导，覆盖 setup、mission、board、runtime、files、run console、modes/notifications 等关键区域，并把 completed/dismissed/lastStep 状态保存到插件配置；Setup Doctor 每个检查项带结构化 repair action，页面 `setup-repair` 按钮可打开 Provider Setup / Model Chooser、刷新 sessions/state、创建 worker session、同步 checkpoint、跳转 Files/Terminal/Memory/Operations，缺模型时直接给出 Provider Setup + Model Chooser 路径。
- 支持 Hermes 式 mission phase：`home / preview / active / complete`，并显示任务进度、活动 worker、估算 token 成本。
- 支持 worker assignment 单独查看、单独投递、标记完成、标记阻塞，并在右侧查看 worker output / checkpoint 结果。
- 支持 Swarm2 Worker IDE 快照：worker drilldown 会聚合身份、health、task queue、chat/session hints、terminal attach hints、files/artifacts、approvals、usage 和 quick actions。
- 支持停止当前 mission、手动完成 mission、生成完成摘要。
- 支持生成 Hermes 式 Mission Report、复制报告、Markdown 导出、一键记录为 Run Console artifact，并基于已完成/停止 mission 创建 continuation mission；续接 mission 默认会复用/创建 OpenHanako worker session 并自动投递 continuation Brief，也可用 `dispatch:false` 只生成续接计划。
- 支持读取目标 session 历史、显示最近消息，并从 worker 回复中自动同步 checkpoint。
- 支持 Hermes Export 风格会话导出：`/api/session-export` 可把 session history 导出为 Markdown、JSON、Plain Text、HTML、CSV 或 ZIP bundle，并包含 Tool Trace 摘要；`/api/session-export/batch` 支持 selected/pinned sessions 批量导出和 ZIP portable bundle，ZIP 内包含 MD/HTML/CSV/JSON/TXT 与 Tool Trace。
- 支持 Hermes Session Fork/Duplicate 风格续接：`/api/session-fork` 从原 session history 生成 continuation prompt，优先通过 `session:create` 创建新会话并自动发送上下文；宿主未开放创建能力时返回可复制 prompt。
- 支持 Hermes Context Meter 风格上下文用量：`/api/context-usage` 基于 session history、tokenCount、usage ledger 和 `modelMetadata.contextWindow` 估算上下文占用百分比、剩余 token 和阈值状态。
- 支持 Hermes Auto-Generated Session Titles 风格标题建议：`/api/session-title` 可根据 session history 生成短标题，并一键用于 pinned session。
- 支持 Hermes Chat Sidebar rename 风格会话别名：`/api/session-aliases` 在插件配置中保存本地 session title overlay，工作台列表、详情、Pin 入口都会显示别名。
- 支持 Hermes Session Tombstones 风格隐藏/恢复：`/api/session-tombstones` 可从工作台隐藏 session、清理对应 pin/alias/default target，并可恢复；不会删除 OpenHanako 真实会话文件。
- 支持 Hermes Session Search 风格全局检索：`/api/search` 会把 session 标题、路径、首条消息和最近 `session:history` 命中纳入结果，并排除 tombstoned session。
- 支持 Hermes Chat Sidebar 本地会话过滤：左侧 session list 可按标题、别名、路径、agent、cwd、model 快速筛选，并继续显示 alias 与 tombstone 清理后的结果。
- 支持 Hermes Chat Composer slash command 风格快捷菜单：Mission 输入框输入 `/` 可选择 `/new`、`/plan`、`/review`、`/dispatch`、`/model`、`/skills`、`/save`、`/help`，用于本地切换模式、打开模型/技能面板或保存草稿。
- 支持 Hermes Chat Composer voice input 风格语音输入：Mission 输入框的 `Mic` 按钮使用浏览器 Web Speech API 将识别文本追加到 mission；浏览器不支持时清晰降级为 `voice unsupported`。
- 支持 Hermes Chat Composer file attachment 风格附件上下文：Mission 输入框可选择本地文件，文本文件会读取前 32KB 合并进 mission notes，图片/二进制文件会以文件名、类型和大小作为上下文摘要，可预览、移除或清空。
- 支持 Hermes Pinned Sessions & Models 风格偏好：可把常用 session 和模型 pin 到工作台，持久保存在插件配置中，并作为快捷选择入口；Pinned 面板支持选择、设为默认、上移/下移排序、同组拖拽排序、应用模型和移除。
- 支持 Hermes Modes System 风格工作台预设：Modes 面板可保存当前 agent/session、Mission mode、worker 数、preferred model、budget/premium model、Board View 和 Operations Profile；支持应用、重命名、删除，并显示当前 UI 与已应用 Mode 的 drift。
- 支持 Hermes Provider Setup / Provider Selection / Smart Model Suggestions 风格模型工作流：`/api/provider-setup` 聚合 provider catalog、`/api/models`、`/api/local-providers`、`/api/provider-usage` 和 connection status；工作台 `Provider Setup` 面板显示 configured/discovered/local provider、模型、用量、安全配置片段、Docs、重新探测和 Pin 首个模型；`/settings/providers` 会深链到该面板。`Model Chooser` 会聚合 smart suggestions、pinned models、`modelMetadata`、当前 agent runtime 和 session metadata，支持搜索、来源筛选、应用、Pin 和复制模型 ID；模型建议会显示 context window 和每 1M token 价格。provider API key / OAuth token 仍由 OpenHanako 宿主管理，插件不保存密钥。
- 支持 Hermes smooth streaming / typing indicator 风格实时输出：通过 `/api/session-events` 订阅 OpenHanako EventBus，`text_delta` 进入 `smoothStreamTick()` 平滑 reveal 到 Worker Output，`streaming-indicator`、`streaming-cursor` 和 `streaming-skeleton` 显示 thinking/typing 状态，`turn_end`、error 或断开连接会 flush/停止。
- 支持 Hermes Inspector Panel 风格聚合侧栏：`inspectorPanel` 汇总当前 session activity、最近消息、live event、tool trace、context usage、memory entries、agent skills 和 active assignment/checkpoint，并提供 Activity / Context / Tools / Knowledge / Worker tabs 与折叠按钮，全部复用宿主 capability-gated 数据。
- 支持 Hermes Research Card 风格嵌入研究展示：`researchCardPanel` 可从 Mission、Notes、session history、tool trace、memory 和 Worker Output 生成研究问题、来源/证据、发现、不确定性和下一步，并支持复制、保存到 Memory、记录为 Run artifact。
- 支持 Hermes Chat/Agent View 风格 Tool Trace：从 session history 和 live events 中归一化 tool calls、tool results、命令、文件变更、checkpoint、turn_end 和错误信号，并可打开/复制每条 trace 详情；超过 4KB 的 tool output 会按 Hermes Tool Artifacts 方案外置到插件本地 `tool-artifacts` cache，history 中只保留 artifact pointer、大小和 preview，避免巨大工具输出挤占工作台上下文。
- 支持 Hermes Prompt Kit 风格消息预览：Worker Output / session history / live stream / tool trace 点击会用 `message-preview` 安全渲染 Markdown 标题、列表、引用、行内代码、代码块、thinking/reasoning 块、checkpoint/tool pills、可展开 tool-call details，并提供消息、代码块和工具详情复制按钮。
- 支持 Hermes Chat Empty State / Scroll Button 风格输出体验：Worker Output 空状态会显示读取历史、连接实时和定位 Mission 的快捷入口；长输出离开底部时显示 `workerOutputScrollBtn`，点击回到最新内容，平滑流式输出会尊重用户是否停留在底部。
- 支持中止目标 session；停止 mission 时会对绑定的 session 请求 `session:abort`，也可通过宿主 `session:revert-turn` 回退最近一轮 assistant turn。
- 支持读取当前 agent 配置摘要：model、memory 开关、enabled skills。
- 支持只读 Skills / Memory 面板：通过 `agent:skills`、`memory:list`、`memory:read` 读取宿主暴露的技能和记忆，不直接扫描本机文件。
- 支持 Hermes MCP / Skills marketplace 风格 Integration Catalog：汇总 MCP connectors、agent skills、已安装插件 manifest、host capabilities 和内置集成源，显示分类、状态、风险和健康度；MCP 设置动作通过宿主 `mcp:settings-action` 安全代理。
- 支持 Hermes 基础设施 API 兼容层：`/api/auth`、`/api/auth-check`、`/api/ping`、`/api/workspace`、`/api/plugins`、`/api/mcp`、`/api/skills`、`/api/local-providers`、`/api/provider-usage`、`/api/provider-setup`、`/api/system-metrics`、`/api/media`、`/api/preview-file`、`/api/oauth/device-code`、`/api/oauth/poll-token`、`/api/transcribe`、`/api/playground-admin`、`/api/playground-npc`、`/api/vt-capital` 返回 OpenHanako-safe 状态、目录、provider setup、runtime 指标、文件预览和能力门控响应；OAuth/STT/token 交换仍由 OpenHanako 宿主管理。
- 支持 Hermes 递归 API 兼容层：`profiles/*`、`knowledge/*`、`memory/list|read|write`、`mcp/*`、`skills/*`、`sessions/*`、`model/info`、`dashboard/overview`、`update/*`、`claude-proxy/$`、`hermesworld/reservations*`、`swarm-memory/search` 均有 OpenHanako-safe alias；当前递归 API diff 结果为 `NO_MISSING_HERMES_RECURSIVE_API_ALIASES`。
- 支持 Hermes 页面入口兼容层：`/`、`/index`、`/dashboard`、`/chat`、`/chat/:sessionKey`、`/conductor`、`/swarm`、`/swarm2`、`/tasks`、`/files`、`/terminal`、`/memory`、`/skills`、`/mcp`、`/operations`、`/profiles`、`/jobs`、`/settings`、`/settings/providers`、`/vt-capital`、`/reserve`、`/reserve/confirm`、`/early-access`、`/hermes-world`、`/world`、`/agora`、`/playground` 和非 API SPA fallback 都会渲染同一个 OpenHanako-safe HanaAgent 工作台，并注入 `hermesPageAlias` 元信息和可见兼容提示；页面加载后会按 alias 自动跳到对应区块，`/chat/:sessionKey` 会尝试按 path/title/alias/id 预选 OpenHanako session 并读取 history/context；未知 `/api/*` 仍保持 404/JSON API 语义，不被页面 fallback 吞掉。
- 支持 Hermes 连接和启动控制 API 兼容层：`/api/connection-settings`、`/api/config-patch`、`/api/gateway-reprobe`、`/api/start-agent`、`/api/start-claude`、`/api/claude-update`、`/api/crew-status` 映射到插件配置、capability probe、host-managed runtime 和 swarm worker runtime。
- 支持 Hermes Chat API 兼容层：`/api/send`、`/api/send-stream`、`/api/history`、`/api/events`、`/api/chat-events` 映射到 OpenHanako `session:*` 能力或 capability-safe SSE heartbeat。
- 支持 Hermes Run Console 风格记录：artifacts、approvals、learnings 保存在插件 `dataDir/run-records.json`，可按 mission/assignment/session 归档；Mission Report 和 SwarmBrief 均可直接版本化为 artifact。
- 支持 Hermes RunLearnings / RunCompare 风格复盘：`/api/run-learnings` 按 success/failure/optimization 分类聚合经验；`/api/run-compare` 可按 mission、assignment 或 run record 对比 status、duration、tokens、cost、agents、artifacts、pending approvals 和 learnings，工作台 Run Console 内置过滤、分类新增、对比和复制摘要。
- 支持 Hermes AgendaView / CalendarView 风格工作日程：`/api/agenda` 从 mission、task、job、approval、失败记录和 agent 状态聚合 attention、active missions、due tasks、upcoming jobs、recent completions、agent statuses，工作台以可折叠 section 展示 attention/active/tasks/upcoming/completed/agents，并可从 Agenda 行直接打开 mission、task editor、worker/agent drilldown、approval、Run Console record、job/agenda detail；`/api/calendar` 按 day/week/month 范围聚合 mission start、task due date、pending approval，并按 Hermes CalendarView 的 daily/weekly/monthly/5-field cron parser 展开 recurring job 事件，支持分钟、小时、星期、月日字段的 step/range/list 语法；Calendar 支持 `timezone` 查询参数和 `workbenchSettings.calendarTimezone`，返回 `dayKey/localTime/timezone`，daily/weekly/monthly/cron job 会按 local/UTC/IANA 时区的墙上时间展开；工作台运行视图提供 day/week/month mode、上一段/Today/下一段导航、month/week 网格、day 小时轴、按事件类型打开 mission/task/approval/job 和复制日程摘要。
- 支持 Hermes Artifacts API 兼容层：`/api/artifacts` 和 `/api/artifacts/:artifactId` 同时暴露 Run Console artifact records 与 session history 大工具输出生成的 lazy tool artifacts；列表只给 metadata/preview，详情接口懒加载完整内容。
- 支持 artifact 文件化和原生 HTML preview：把 Run Console artifact 安全写入插件 `dataDir/artifacts/`，并在宿主提供 `stageFile` 时登记为 OpenHanako SessionFile；`/api/run-records/:recordId/artifact-preview` 会把 artifact 包装成 HTML 并注册到 OpenHanako `/api/preview/html` 短期预览，`/api/missions/:missionId/report-artifact` 可把 Mission Report 一键创建为 artifact 并自动文件化/预览，工作台内 Run Console 会直接嵌入 iframe 预览，同时保留外部打开入口。
- 支持 approval 记录的 pending/approved/denied 状态流转，并写入 mission event timeline。
- 支持 Autopilot 巡检：基于 mission、checkpoint 和 session status 生成 dispatch、sync-history、mark-blocked、request-review、complete、monitor、escalate 等可审计建议。
- 支持 Autopilot 后台调度和多轮 loop：通过 `autopilotSchedule` 配置周期性 tick，可选择 preview/run 模式、启动时运行、每次扫描 mission 数量，并在页面手动触发后台 Tick；`/api/autopilot/loop` 支持 start/pause/resume/stop/complete/escalate，记录 iteration、critical streak、lastTick、runIds 和升级原因。
- 支持 Review Gate：完成 mission 前检查 blocker、pending approvals、checkpoint 证据、review/QA 证据和 artifact 交付物；失败时阻止普通完成，允许显式 force complete。
- 支持 Hermes Files 风格受控文件工作区：通过 `workspaceRoots` 显式授权目录，浏览目录树、上传附件、读取文本/图片、编辑保存文本文件，并阻止路径穿越和 symlink 越界；同时提供 Hermes `/api/files?action=list|read|download` 和 `POST /api/files` 兼容入口，内部仍映射到 OpenHanako-safe workspaceRoots。
- 支持 Hermes Operations 风格 profile presets 和持久队伍拓扑：内置 Sage / Builder / Reviewer / Researcher / Ops 队伍预设，显示 readiness、setup gap、队伍健康指标；可保存自定义 profile 到 `dataDir/operation-profiles.json`，绑定 roles、lanes、agent/session/cwd、visibility、permissions、sharedWith，并一键创建 Profile Mission；也支持导出/导入 portable profile JSON bundle，便于团队共享和迁移。
- 支持 Hermes `swarm.yaml` 风格 roster 导入/导出和动态派发：Operations profile 的 lanes 会保留 worker 的 `specialty/model/mission/profile/modes/tools/skills/capabilities/preferredTaskTypes/greenlightRequiredFor/maxConcurrentTasks/acceptsBroadcast/plugins/pluginToolsets/mcpServers/wrapper/defaultCwd` 等元数据；`/api/operations/profiles/:profileId/swarm-roster` 可导出 JSON/YAML roster，`/api/operations/swarm-roster/import` 可直接导入 Hermes 风格 JSON/YAML roster；创建 Profile Mission 时会按导入 roster 动态生成 worker assignments，并把工具/技能/greenlight 等元信息写入 `assignment.roster`。
- 支持 Hermes onboarding / connection probe 风格 Setup Doctor：检查 agent、模型/provider、session dispatch、默认 session、history、workspaceRoots、terminal、memory/skills、Operations readiness 和 runtime incidents，缺模型时明确标记为 blocking setup。
- 支持 Hermes Connection Overlay / Health Banner / Backend Unavailable State 风格全局连接横幅：顶部 `connectionBanner` 会显示 ready/degraded/blocked/offline 状态、readiness、blocking/warn 数和下一步动作，并提供重试和跳转 Setup Doctor。
- 支持读取 OpenHanako `usage:list`，在运行视图显示 token/cost 用量摘要，并按 session、mission、assignment 做归因汇总。
- 支持读取和恢复 OpenHanako 宿主文件 checkpoint：`checkpoint:list`、`checkpoint:find-by-session-since`、`checkpoint:restore`。
- 支持 Session Lifecycle 面板：通过 `session:create` 创建 worker session，通过 `session:status` 读取运行状态，并通过 `session:revert-turn` 请求宿主恢复最近一轮 turn checkpoint；宿主未开放时清晰降级。
- 支持 Host Jobs 面板：通过 `task:list/register/update/complete/fail/remove/cancel` 管理宿主后台任务，通过 `deferred:list-pending/query` 查看异步结果占位。
- 支持 assignment 与 Host Jobs 自动联动：投递 worker assignment 时自动注册 `hanaagent-assignment` runtime task；assignment 完成、阻塞、复核、mission 停止/完成时同步更新宿主任务状态。
- 支持宿主管理的 terminal：`terminal:list/start/read/write/close`，不在插件内直接启动本地 shell。
- 内置任务编排、资料研究、构建实现、审查复核四类工作流 Prompt。
- 本地任务看板用于跟踪待办、进行中、阻塞、复核和完成状态。
- 后端持久任务 store 保存在插件 `dataDir/tasks.json`，看板通过 `/api/tasks` 读写；`/api/tasks/:taskId/move` 支持列移动和 `position` 排序，`/api/tasks/batch` 支持 selected cards 批量 move/update/delete；`/api/defaults` 持久化 `boardWipLimits`，用于每列 WIP 限制。
- 支持 Hermes/Claude task board API 兼容层：`/api/claude-tasks`、`/api/claude-tasks/:taskId`、`/api/claude-tasks-assignees`、`/api/hermes-tasks`、`/api/hermes-tasks/:taskId` 映射到 HanaAgent Kanban；Hermes task `launch` 会创建/绑定 OpenHanako session 并发送任务 briefing。
- Checkpoint 收件箱保存在插件 `dataDir/checkpoints.json`，通过 `/api/checkpoints` 解析并记录 worker 状态；同一 task/session 出现互相矛盾的状态时会标记 conflict，工作台可采纳其中一条并把其它 checkpoint 标记为 superseded；checkpoint 可在收件箱内设置/清除 15 分钟提醒，到期后复用工作台 toast、浏览器通知和 haptic 反馈，并把触发状态回写到插件 store，避免刷新后重复提醒。
- 保存默认智能体和默认会话到插件配置。
- 保存 pinned sessions / pinned models 到插件配置，便于快速回到常用 worker 上下文。
- 保存 workbench modes / activeWorkbenchModeId 到插件配置，提供 Hermes custom modes 和 drift detection 的插件版体验。
- 保存 workbenchNotifications 到插件配置，提供 Hermes notification volume、enable/disable、browser notification 和 haptic 开关。
- 保存 workbenchSettings 到插件配置，提供 Hermes 8-theme preset、theme/accent/editor/usage/mobile/system metrics/calendar timezone 偏好。
- 保存 workbenchOnboarding 到插件配置，提供 Hermes onboarding tour 的完成、稍后提醒和步骤续看状态。
- 在 bus 不可用或投递失败时保留可复制 Prompt 作为兜底。
- 暴露 Hermes -> Hanaco 工作台完善 blueprint，并在页面内显示当前覆盖与后续阶段。
- 投递 Prompt 内置 checkpoint 合约，粘贴 worker 回复后可自动移动关联任务到阻塞/复核/完成等列。
- Checkpoint 会同步回写关联 assignment 与 mission 事件流。
- `/api/overview` 聚合 agents、agentProfiles、agentSkills、memory、workspaceFiles、sessions、missions、tasks、checkpoints、missionInbox、hostCheckpoints、usage、usageAttribution、runRecords、autopilot、hostTasks、deferredTasks、workerCards、setupDoctor 和 hostGaps。
- `/api/session-history`、`/api/session-abort` 和 `/api/checkpoints/sync-history` 接入 OpenHanako 稳定 EventBus 能力；`/api/session-history` 与 `/api/session-status` 也支持 Hermes `key/sessionKey` 参数形态；`/api/session-send` 兼容 Hermes ControlSuite `{ sessionKey, message }` 并映射到 OpenHanako `session:send`；`/api/checkpoints/:checkpointId/resolve` 提供 checkpoint 冲突采纳和 task/mission 状态回写。
- `/api/checkpoint-reminders` 和 `/api/checkpoints/:checkpointId/reminder` 提供 checkpoint reminder 查询、设置、触发回写和清除；工作台收件箱提供“15 分钟提醒 / 清除提醒”操作。
- `/api/send`、`/api/send-stream`、`/api/history`、`/api/events`、`/api/chat-events` 提供 Hermes Chat/Messaging 兼容入口；send/send-stream 映射到 OpenHanako `session:send`，history 映射到 `session:history`，全局 events 在无 session 时返回插件 heartbeat SSE。
- `/api/session-export` 提供会话 Markdown / JSON / Plain Text / HTML / CSV / ZIP 导出，`/api/session-export/batch` 提供 selected/pinned sessions 批量导出和 ZIP bundle。
- `/api/session-fork` 提供会话 fork/duplicate continuation 创建和 prompt-ready 降级。
- `/api/context-usage` 提供 session context meter、剩余 token 和 warning/critical 阈值提醒，并可使用 `modelMetadata` 的 context window。
- `/api/session-title` 基于会话历史生成短标题建议，可用于 pinned session 快捷入口。
- `/api/session-aliases` 提供插件本地会话重命名 overlay，可保存/清除 session title alias。
- `/api/session-tombstones` 提供插件本地隐藏/恢复 session 的 tombstone 管理。
- `/api/session-events` 提供 SSE 实时事件流，页面可连接/断开目标 session 的 live feed。
- `/api/session-history` 返回 `toolTrace`，页面 Tool Trace 面板可复制运行轨迹。
- `/api/agents/:agentId/config`、`/api/agents/:agentId/skills`、`/api/memory`、`/api/usage`、`/api/host-checkpoints` 和 `/api/host-checkpoints/:checkpointId/restore` 接入 OpenHanako 运行审计、宿主 checkpoint 恢复和只读知识能力。
- `/api/paths` 提供 Hermes 路径探测兼容响应，返回插件 dataDir、memory 目录、OpenHanako skill 占位和已授权 workspaceRoots。
- `/api/files?action=list|read|download` 与 `POST /api/files` 提供 Hermes Files API 兼容入口，支持 list/read/download/write/mkdir/rename/delete，并全部复用 `workspaceRoots` 沙盒、路径穿越防护和 symlink 防护。
- `/api/workspace-roots`、`/api/workspace-files`、`/api/workspace-file`、`/api/workspace-file/upload` 提供受控 workspace 文件浏览、附件上传、读取、图片预览和文本写入。
- `/api/operations`、`/api/operations/presets`、`/api/operations/profiles`、`/api/operations/presets/:presetId/mission`、`/api/operations/profiles/:profileId/mission` 提供 Operations 队伍预设、持久 profile 拓扑、健康度和预设/Profile Mission 创建。
- `/api/operations/profiles/:profileId/swarm-roster` 和 `/api/operations/swarm-roster/import` 提供 Hermes `swarm.yaml` 风格 roster JSON/YAML 导出/导入。
- `/api/missions/:missionId/broadcast` 提供 roster-aware broadcast，默认遵守 `acceptsBroadcast`，并记录 skipped worker 原因。
- `/api/missions/:missionId/briefs` 和 `/api/missions/:missionId/assignments/:assignmentId/brief` 提供 Hermes-style SwarmBrief JSON/YAML 任务契约，并被 dispatch/broadcast prompt 复用。
- `/api/missions/:missionId/report-artifact` 和 `/api/missions/:missionId/assignments/:assignmentId/brief/artifact` 可把 Mission Report / SwarmBrief 固化为 Run Console artifact。
- `/api/swarm-roster`、`/api/swarm-dispatch`、`/api/swarm-missions`、`/api/swarm-checkpoint`、`/api/swarm-runtime`、`/api/swarm-health`、`/api/swarm-chat` 提供 Hermes Swarm 兼容 API alias：roster upsert/list、legacy `workerIds + prompt` 或 `assignments[]` dispatch、mission list/report/cancel、worker runtime checkpoint 写入、worker runtime/health/chat observability。
- `/api/swarm-decompose`、`/api/swarm-kanban`、`/api/swarm-memory`、`/api/swarm-reports`、`/api/swarm-project`、`/api/swarm-environment`、`/api/swarm-lifecycle`、`/api/swarm-tmux-start`、`/api/swarm-tmux-stop`、`/api/swarm-tmux-scroll`、`/api/swarm-direct-chat`、`/api/swarm-orchestrator-loop`、`/api/swarm-runtime/reset` 补齐 Hermes Swarm2 同名 API 的 OpenHanako-safe alias：任务拆解会返回确定性 roster fallback，同时暴露 Hermes JSON-only `orchestratorPrompt`、`rosterText`，并可用 `dispatchToSession=true` 交给 OpenHanako session 生成模型驱动拆解；看板映射到 HanaAgent task store，memory 映射到本地/宿主 memory 与 handoff store，project/environment/lifecycle 来自 Worker IDE 和 overview，tmux/direct-chat/orchestrator/reset 走宿主管理 session、terminal 和 mission 状态，不直接操作 Hermes tmux/profile 文件。
- `/api/operations/profiles/:profileId/export` 和 `/api/operations/profiles/import` 提供 Operations profile 的 portable JSON bundle 导出/导入，并保留 visibility、permissions、sharedWith 等共享治理元数据。
- `/api/workflow-templates`、`/api/workflows`、`/api/workflows/:workflowId/preview`、`/api/workflows/:workflowId/execute`、`/api/workflows/:workflowId/execute-stream`、`/api/workflows/:workflowId/mission` 提供 Open Agent Builder 风格工作流模板、CRUD、安全预览、SSE 节点事件和 HanaAgent mission 编译能力。
- `/api/setup-doctor` 提供安装后 readiness 诊断，帮助确认 OpenHanako 模型、会话、文件根目录和 runtime capability 是否足以执行真实 worker。
- `/api/model-suggestions` 提供基于任务画像、pinned models 和 `modelMetadata` 的模型建议。
- `/api/defaults` 持久化 `workbenchOnboarding`，用于工作台首次引导、完成/稍后状态和上次步骤恢复。
- `/api/integrations` 和 `/api/integrations/action` 提供 MCP / Skills / Plugin / Capability 统一目录和 MCP settings action 代理。
- `/api/auth`、`/api/auth-check`、`/api/ping`、`/api/workspace`、`/api/plugins`、`/api/mcp`、`/api/skills`、`/api/local-providers`、`/api/provider-usage`、`/api/provider-setup`、`/api/system-metrics`、`/api/media`、`/api/preview-file`、`/api/oauth/device-code`、`/api/oauth/poll-token`、`/api/transcribe`、`/api/playground-admin`、`/api/playground-npc`、`/api/vt-capital` 提供 Hermes infra/provider/catalog/media/demo/domain 兼容响应，全部基于 OpenHanako 插件 auth、workspaceRoots、run artifact sandbox、integration catalog、agent skills、model metadata 和 usage ledger；OAuth、STT 与 Playground worker admin 属于 host/capability-gated 面。
- `/api/dashboard/overview`、`/api/model/info`、`/api/profiles/*`、`/api/knowledge/*`、`/api/memory/list|read|write`、`/api/mcp/*`、`/api/skills/*`、`/api/sessions/*`、`/api/update/*`、`/api/claude-proxy/$`、`/api/hermesworld/reservations*`、`/api/swarm-memory/search` 提供 Hermes nested API 兼容入口，映射到 HanaAgent overview、agent profile overrides、memory/knowledge、本地/宿主管理 MCP 与 skills、session runtime 和 host-managed update/proxy/domain gate。
- `/api/connection-settings`、`/api/config-patch` 和 `/api/gateway-reprobe` 提供 Hermes connection/config 兼容响应；配置写入插件 manifest 声明的 key，reprobe 映射到 OpenHanako capability/status 聚合。
- `/api/start-agent`、`/api/start-claude` 和 `/api/claude-update` 提供 host-managed / manual-confirm 响应，不在插件内拉起或更新外部 Hermes 进程。
- `/api/crew-status` 从 HanaAgent swarm runtime 生成 Hermes crew profile/status 兼容列表。
- `/api/run-records` 提供 artifacts / approvals / learnings 的 CRUD。
- `/api/run-learnings` 和 `/api/run-compare` 提供 Hermes RunLearnings / RunCompare 兼容复盘能力。
- `/api/artifacts` 和 `/api/artifacts/:artifactId` 把 Run Console artifact records 与外置的大工具输出暴露为 Hermes tool artifact 兼容形态。
- `/api/run-records/:recordId/artifact-file`、`/content` 和 `/artifact-preview` 提供 artifact 文件化、SessionFile staging、内容预览和 OpenHanako 原生 HTML preview 注册。
- `/api/claude-tasks`、`/api/claude-tasks/:taskId`、`/api/claude-tasks-assignees`、`/api/hermes-tasks`、`/api/hermes-tasks/:taskId` 提供 Hermes/Claude task board 兼容入口，映射到 HanaAgent Kanban；Hermes task `launch` 会创建/绑定 OpenHanako session 并发送任务 briefing。
- `/api/sessions`、`/api/session-status`、`/api/session-revert-turn`、`/api/host-tasks`、`/api/deferred-tasks` 接入 OpenHanako worker runtime / jobs 能力。
- `/api/terminal-stream`、`/api/terminal-input`、`/api/terminal-resize`、`/api/terminal-close` 提供 Hermes terminal API 兼容入口，映射到 OpenHanako host-managed terminal start/read/write/close；`terminal-stream` 返回短 SSE bootstrap，真实 PTY 生命周期仍由宿主负责。
- `/api/autopilot/schedule`、`/api/autopilot/tick` 和 `/api/autopilot/loop` 提供后台 Autopilot 配置、状态、手动 tick、可暂停/恢复的多轮自治 loop 和升级阈值记录。
- `/api/workers/:workerId` 返回 worker drilldown 和 `ide` 快照，供 Swarm2 Worker IDE 面板使用。

## Open Agent Builder 吸收范围

`reference/open-agent-builder-main` 在 README 中声明 MIT License。HanaAgent 当前吸收的是对插件价值最高、且适合 OpenHanako 插件沙盒的部分：

- 已吸收：workflow/node/edge/execution result 数据形状、8 个核心节点类型、模板思路、节点校验、自动布局思路、左侧节点库 + 中间画布 + 右侧执行/配置面板的交互形态。
- 已本地化：Convex 持久化改为插件 `dataDir/workflows.json`；React Flow 画布改为无依赖 HTML/SVG；LangGraph 实时执行改为安全 Preview、SSE Preview 事件和 HanaAgent Mission 编译；MCP 节点先保留工具/参数配置和预览，不在插件内直接调用外部工具。
- 安全边界：Transform 节点不执行任意 JavaScript，只记录映射/脚本意图并在 Preview 中展示；真实 agent 执行通过 OpenHanako `session:*` / HanaAgent mission dispatch 体系完成。
- 未直接搬入：Next.js、React、Tailwind、React Flow、Convex、Clerk、LangGraph、Firecrawl/E2B 运行时和项目级部署链路。后续如需要真实逐节点 streaming executor，可以在当前 workflow store 和 mission 编译层上继续接。

## 文件结构

```text
plugins/hanaagent/
├── manifest.json
├── index.js
├── lib/agent-profile-store.js
├── lib/autopilot-scheduler.js
├── lib/autopilot-store.js
├── lib/blueprint-data.js
├── lib/checkpoint-store.js
├── lib/hanaagent-core.js
├── lib/handoff-store.js
├── lib/integration-catalog.js
├── lib/job-scheduler.js
├── lib/job-store.js
├── lib/memory-store.js
├── lib/mission-inbox.js
├── lib/mission-store.js
├── lib/operations-profile.js
├── lib/review-gate.js
├── lib/run-store.js
├── lib/session-projector.js
├── lib/task-store.js
├── lib/tool-artifact-store.js
├── lib/tool-trace.js
├── lib/worker-ide.js
├── lib/worker-lifecycle.js
├── lib/workflow-store.js
├── lib/workspace-files.js
├── routes/
│   ├── workbench.js
│   ├── workbench-render.js
│   ├── workbench-overview.js
│   ├── workbench-utils.js
│   ├── workbench-routes-core.js
│   ├── workbench-routes-missions.js
│   ├── workbench-routes-sessions.js
│   └── workbench-routes-swarm.js
└── tests/
    ├── autopilot-scheduler.test.js
    ├── autopilot-store.test.js
    ├── checkpoint-store.test.js
    ├── hanaagent-core.test.js
    ├── handoff-store.test.js
    ├── index.test.js
    ├── integration-catalog.test.js
    ├── job-scheduler.test.js
    ├── job-store.test.js
    ├── memory-store.test.js
    ├── mission-inbox.test.js
    ├── mission-store.test.js
    ├── operations-profile.test.js
    ├── review-gate.test.js
    ├── run-store.test.js
    ├── session-projector.test.js
    ├── task-store.test.js
    ├── tool-trace.test.js
    ├── worker-ide.test.js
    ├── worker-lifecycle.test.js
    ├── workflow-store.test.js
    ├── workbench-routes.test.js
    └── workspace-files.test.js
```

## 使用

在 OpenHanako 设置 -> 插件中安装，方式与 `llm-wiki-viewer` 相同：

- 直接拖入 `plugins/hanaagent` 文件夹。
- 或先运行 `npm run pack:plugin`，再拖入生成的 `dist/plugins/hanaagent-0.1.0.zip`。

安装后在插件页签打开：

```text
/api/plugins/hanaagent/workbench
```

页面会自动加载当前 Hana 智能体和已有会话。`session:send`、`session:history`、`session:abort`、`session:revert-turn` 都需要目标会话路径；在宿主提供 `session:create` 时，工作台可以创建 worker session、fork session 和 continuation worker，未提供时会复用已绑定 session 或返回可复制 Prompt 作为兜底。

Files 面板默认只暴露插件 `dataDir`。如需编辑项目目录，在插件配置里加入：

```json
[
  { "id": "repo", "label": "Repo", "path": "/absolute/project/path", "writable": true }
]
```

Autopilot 后台调度默认关闭。如需启用，在插件配置里加入：

```json
{
  "enabled": true,
  "mode": "preview",
  "intervalMinutes": 15,
  "runOnStartup": false,
  "maxMissionsPerTick": 5
}
```

运行时闭环说明：

- `session:send` 返回 `accepted` 只表示宿主已接受投递，不代表 Agent 回合已经完成。
- 插件启动时会注册后台 Session Projector，在专用 Worker Session 收到 `turn_end`、`done` 或 `error` 后回读 `session:history`，解析 Checkpoint Contract，并归并 Assignment、Task 与 Mission 状态。
- 通过 `session:create` 创建的 Worker 标记为 `dedicated`，可自动投影；复用已有会话或 `session:create` 不可用时标记为 `shared`，为避免跨任务历史污染，需要在工作台中手动同步历史检查点。
- Autopilot 仍是恢复扫描和遗漏事件补偿机制，不是 `session:send` 的完成确认机制。
- `session_busy` 会标记为可重试并保留为排队状态；插件不会在后台自动重复投递，需在会话空闲后由用户或明确的 Autopilot 操作重新派发。
- 真实宿主验收至少要检查 Agent/Session 创建、投递、实时事件、历史回读、Checkpoint 回写、Review Gate、报告和 Continue/Fork。

## 验证

```bash
cd plugins/hanaagent
npm test
npm run pack:plugin
```
