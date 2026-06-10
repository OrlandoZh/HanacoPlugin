# HanaAgent Hermes 模仿完成度盘点

## 结论

当前 HanaAgent 已把 Hermes Workspace 的核心能力复刻为 OpenHanako 插件版智能体工作台，并把 Hermes `src/routes/api` 递归 API 同名面补成 OpenHanako-safe 兼容层；当前自动 diff 结果为 `NO_MISSING_HERMES_RECURSIVE_API_ALIASES`。同时已补齐 Hermes 非 API 页面入口 alias：`/`、`/dashboard`、`/chat`、`/conductor`、`/swarm`、`/tasks`、`/files`、`/terminal`、`/memory`、`/skills`、`/mcp`、`/operations`、`/profiles`、`/jobs`、`/settings`、`/settings/providers`、HermesWorld/Playground/Reserve 等页面都会进入同一个 OpenHanako-safe 工作台并带有 `hermesPageAlias` 元信息。插件职责范围内已覆盖：Conductor / Swarm 主闭环、Mission 指挥台、任务拆解、worker assignment、mission phase、办公室式 live view、进度/成本、事件流、Agenda / Calendar 工作日程聚合、Recent Swarm Activity 聚合、Full Outputs 聚合审阅、任务看板、Kanban 筛选/保存视图/WIP 限制/快捷键/快捷键帮助面板/Command Palette/完整卡片编辑/拖拽排序/批量操作、Settings/Theme 8-theme presets/Editor/usage threshold 偏好、Mobile Header / Hamburger / Sessions Panel / Tab Bar / mobile nav modes、Toast/Error Toast/Model Suggestion Toast、Connection Overlay / Health Banner / Backend Unavailable State、Web Audio 通知音/浏览器通知/移动端 haptic、Onboarding Tour 步骤式首次引导、checkpoint 收件箱、session history 同步、session export / batch export / ZIP bundle、session fork/duplicate continuation、context usage meter、auto-generated session title suggestions、session alias rename overlay、session tombstones、session metadata + history search、Chat Sidebar local filtering、Chat Composer slash commands / voice input / file attachments、Prompt Kit 风格 Markdown/code/thinking/tool pill 消息预览、Chat Empty State / Scroll Button、Research Card 嵌入研究展示、Inspector Panel 活动/记忆/技能聚合、pinned sessions/models、Provider Setup / Provider Selection / Model Chooser、Modes System 保存/应用/重命名/删除/drift detection、smart model suggestions、live session events、session abort / revert turn、worker output、Mission Report / Markdown export / Continue Mission、worker card 聚合、Swarm2 Worker IDE 快照、Worker Lifecycle / Context Handoff、Run Console records（artifacts / approvals / learnings）、artifact 文件化/SessionFile staging/原生 HTML preview 注册/工作台内嵌预览、受控 workspace Files 上传/编辑/Preview/Diff/Patch Review/Save、Operations profile presets / readiness dashboard / 持久 team topology、Setup Doctor / connection probe、Integration Catalog（MCP/skills/plugins/capabilities）、Jobs CRUD / scheduler、Autopilot 路由建议/真实 dispatch/陈旧 worker 巡检/后台 schedule tick，以及 OpenHanako 运行审计/运行时面板（agent config、agent skills、memory + local fallback、usage ledger、host checkpoint、session lifecycle、host jobs、deferred tasks、host-managed terminal）。

“完整复刻”在这里按 OpenHanako 插件边界理解：同名 API 和用户工作流尽量兼容 Hermes，但不直接照搬 Hermes 的独立 PWA、Docker、installer、tmux/profile 文件写入和 gateway 进程控制。涉及 tmux、profile、state.db 的 Hermes 原生行为在 HanaAgent 中映射为 OpenHanako 宿主管理 session、terminal、task、memory 和 plugin data store。

Hermes 是完整独立工作区，HanaAgent 是 OpenHanako 插件。正确目标不是照搬全部代码，而是分层模仿并显式审计：

- `plugin-implemented`：插件内已经实现的 Hermes 等价功能。
- `host-provided`：OpenHanako 宿主已经负责的功能，例如模型/provider 设置、认证、插件 token 边界。
- `capability-gated`：插件 UI/API 已实现，但真实运行取决于宿主是否提供 `session:*`、`terminal:*`、`agent:skills`、`memory:*`、`checkpoint:*` 等 handler。
- `out-of-scope-for-plugin`：Hermes standalone PWA/Electron/Docker/installer 这类独立应用部署能力，OpenHanako 插件不应重复实现。

当前代码把该审计固化在 `getParityMatrix()`，并通过 `/api/parity`、`/api/blueprint` 和工作台“完善路线”展示；测试要求插件范围内 `missing = 0`。

## 功能盘点

| Hermes Workspace 功能 | Hanaco 当前状态 | 证据 | 下一步 |
| --- | --- | --- | --- |
| Dashboard overview / aggregator | 已完成插件版 | `/api/state` 和 `/api/overview` 聚合 agents/agentProfiles/agentSkills/memory/sessions/tasks/checkpoints/hostCheckpoints/usage/runRecords/hostTasks/deferredTasks/workerCards/blueprint/incidents | 等宿主暴露更多运行时状态后增强实时性 |
| Gateway capability gate | 已完成插件版 | `capabilities.agentList/agentConfig/agentSkills/memory*/session*/usageList/checkpoint*/task*/deferred*/terminal*` + `hostGaps` | 继续等待 files |
| Onboarding / connection probe | 已完成插件版 | `/api/setup-doctor` 和 overview `setupDoctor` 检查 agent、模型/provider、session dispatch、默认 session、history、workspaceRoots、terminal、memory/skills、Operations readiness、runtime incidents；每个 check 返回结构化 `repair` action，工作台 `setup-repair` 按钮可直接打开 Provider Setup / Model Chooser、刷新 sessions/state、创建 worker session、同步 checkpoint、跳转 Files/Terminal/Memory/Operations；顶部“引导”和 Setup Doctor 可打开 onboarding tour，`workbenchOnboarding` 持久化 completed/dismissed/lastStep；无模型时返回 blocking setup 并给出 `open-provider-setup` + `open-model-chooser` fallback | 后续可接宿主级全局设置深链 |
| Connection overlay / health banner | 已完成插件版 | `connectionBanner` 在页面顶部显示 checking/ready/degraded/blocked/offline；复用 `setupDoctor.readiness`、blocking/warn 和 nextAction；加载失败时显示 backend unavailable；提供重试和跳转 Setup Doctor | 后续可接宿主级全局连接状态 |
| Chat session send | 已完成 | `dispatchMission()` -> `session:send` | 可通过 `session:create` 代理创建新 worker session，取决于宿主 handler |
| Multi-session list / rename / tombstone | 已完成插件版 | `/api/sessions` -> `session:list`，`/api/session-aliases` 提供插件本地 title overlay，`/api/session-tombstones` 提供隐藏/恢复和 pin/alias/default target cleanup；工作台列表、详情、Pin 入口显示 alias 并排除 tombstoned session；左侧列表支持标题/别名/路径/agent/cwd/model 本地过滤 | 后续等宿主开放插件 rename/delete handler 后升级为真实 session title 写入或归档 |
| Workflow templates | 已完成 | `getTemplates()` 四类模板 | 模板可配置化 |
| Conductor mission control | 已完成插件版 | `lib/mission-store.js` + `/api/missions` + 页面 Conductor stage/office/timeline；`officeView` 顶部新增 `swarm-hub-card`，展示主控 agent 身份、swarm/active/rooms/blockers 指标、Route/Monitor/Collaborate/Topology wires，以及 Route Mission / Broadcast / Autopilot / Inbox / Refresh 控制；`/api/missions/:missionId/broadcast` 默认遵守 `assignment.roster.acceptsBroadcast`，通过 OpenHanako `session:send` 向可广播 worker 发送 checkpoint-bearing follow-up prompt，并记录 sent/skipped mission event | 等宿主支持更完整 session runtime 后提升实时多 session orchestration |
| SwarmBrief task contract | 已完成插件版 | `buildSwarmBrief()` / `formatSwarmBrief()` / `buildMissionBriefs()` 生成 Hermes 风格 `brief_id/worker/project/goal/why_now/scope/deliverables/test_or_proof/constraints/checkpoint_contract/escalation/budget`；`GET /api/missions/:missionId/briefs` 和 `GET /api/missions/:missionId/assignments/:assignmentId/brief` 暴露 JSON/YAML；dispatch 与 broadcast prompt 均嵌入同一份 `SwarmBrief` YAML；工作台 assignment 卡支持 Brief 查看/复制；`POST /api/missions/:missionId/assignments/:assignmentId/brief/artifact` 可把 Brief 版本化为 Run Console artifact | 后续可把 Brief artifact 与宿主级长期 artifact registry 合并 |
| Hermes Swarm API compatibility | 已完成插件版 | `GET/POST /api/swarm-roster` 对齐 Hermes roster list/upsert 概念并映射到 Operations profile；`POST /api/swarm-dispatch` 支持 legacy `workerIds + prompt` 和 `assignments[]`，自动创建/复用 mission、生成 SwarmBrief、走 OpenHanako `session:send`；`GET/POST /api/swarm-missions` 支持 mission list/report 和 cancel；`POST /api/swarm-checkpoint` 接收 worker runtime checkpoint shape 并回写 checkpoint/assignment/task/host task；`GET /api/swarm-runtime`、`/api/swarm-health`、`/api/swarm-chat` 从 workerCards、missions、tasks、checkpoints、runRecords、session history 生成 Hermes-like runtime/health/chat observability；`POST /api/swarm-decompose` 返回确定性 fallback、Hermes JSON-only `orchestratorPrompt`、`rosterText`，并可用 `dispatchToSession=true` 交给 OpenHanako session 做模型驱动拆解；`GET/POST/PATCH /api/swarm-kanban`、`GET/POST /api/swarm-memory`、`GET /api/swarm-reports`、`GET /api/swarm-project`、`GET /api/swarm-environment`、`GET/POST /api/swarm-lifecycle`、`POST /api/swarm-tmux-start|stop|scroll`、`POST /api/swarm-direct-chat`、`POST /api/swarm-orchestrator-loop`、`POST /api/swarm-runtime/reset` 覆盖本轮发现的剩余 Hermes `swarm-*` 同名接口 | 这是 OpenHanako-safe alias，不直接操作 Hermes tmux/profile/state.db 文件；tmux/direct-chat/orchestrator/runtime reset 均映射到宿主管理 session、terminal、mission/task 状态 |
| Hermes recursive API alias coverage | 已完成插件版 | 自动 diff `reference/hermes-workspace-main/src/routes/api/**/*.ts` 与 `plugins/hanaagent/routes/workbench.js` 结果为 `NO_MISSING_HERMES_RECURSIVE_API_ALIASES`；除顶层 alias 外，已补齐 `profiles/*`、`knowledge/*`、`memory/list|read|write`、`mcp/*`、`skills/*`、`sessions/*`、`model/info`、`dashboard/overview`、`update/*`、`claude-proxy/$`、`hermesworld/reservations*`、`swarm-memory/search` | OAuth、STT、Playground admin、Claude proxy、HermesWorld reservation 采用 host/capability-gated 或 standalone-service-unavailable 响应；media/preview-file 只服务 workspaceRoots 与 run artifact sandbox，不读取任意本机路径 |
| Hermes page route alias coverage | 已完成插件版 | `HERMES_PAGE_ALIASES` 覆盖 `reference/hermes-workspace-main/src/routes` 的非 API 页面入口：`/`、`/index`、`/dashboard`、`/chat`、`/chat/:sessionKey`、`/conductor`、`/swarm`、`/swarm2`、`/tasks`、`/files`、`/terminal`、`/memory`、`/skills`、`/mcp`、`/operations`、`/profiles`、`/jobs`、`/settings`、`/settings/providers`、`/vt-capital`、`/reserve`、`/reserve/confirm`、`/early-access`、`/hermes-world`、`/world`、`/agora`、`/playground`，并提供非 API SPA fallback；HTML 注入 `data-hermes-route`、`window.HANAAGENT.hermesPageAlias` 和可见兼容 banner；`applyHermesPageAlias()` 在工作台状态加载后按 alias 自动定位到 Conductor/Tasks/Files/Terminal/Memory/Integrations/Operations/Settings/Provider Setup 等对应区块，`/settings/providers` 会深链到 `providerSetupPanel`，`/chat/:sessionKey` 会按 path/title/alias/id 预选 OpenHanako session 并触发 history/context 加载；测试逐路由验证 200 + 工作台 + alias metadata，并验证未知 `/api/*` 不被 fallback 吞掉 | Standalone/demo 页面不伪造外部服务，统一映射到 HanaAgent 工作台和明确兼容说明 |
| Mission assignments | 已完成插件版 | 创建 mission 时生成编排/构建/复核/验证/记录 assignment，并同步生成看板任务 | 增加可配置角色和手动重排 |
| Mission event timeline | 已完成插件版 | mission events 记录 create/plan/dispatch/checkpoint/history_sync/session_abort，页面显示 Mission Events | 接入 `session:status` 后进一步提升实时性 |
| Agenda / Calendar | 已完成插件版 | `GET /api/agenda` 从 missions、tasks、jobs、Run Console approvals/failures 和 host agents 聚合 Hermes `AgendaView` 风格 `attention/activeMissions/tasksDueToday/upcomingJobs/recentCompletions/agentStatuses`；运行视图以可折叠 section 展示 attention/active/tasks/upcoming/completed/agents，保留 count 与 Hide/Show 状态；Agenda 行已变成可点击工作台入口，可打开对应 mission、assignment worker drilldown、task editor、agent drilldown、approval queue item、Run Console record、job/agenda detail；`GET /api/calendar` 按 `day/week/month` 范围聚合 mission start、task due date、pending approval，并按 Hermes `CalendarView` 的 daily/weekly/monthly/5-field cron parser 展开 recurring job 多日事件，已支持分钟、小时、星期、月日字段的 step/range/list 语法；Calendar 支持 `timezone` 查询参数和 `workbenchSettings.calendarTimezone`，可用 `local`、`UTC` 或 IANA 时区展开 daily/weekly/monthly/cron job，并返回 `dayKey/localTime/timezone` 供 week/month/day 视图按目标时区分组；Calendar 支持 day/week/month mode、上一段/Today/下一段导航、month/week 网格、day 小时轴、打开事件、复制摘要，并按事件类型钻取 mission、task、approval、job；无 explicit due/deadline 的 pending approval 会落在当前查询范围起点，避免未决审批因创建时间跨日而从当天日历消失 | 继续等待宿主级提醒/日历同步能力 |
| Swarm2 Recent Activity Feed | 已完成插件版 | `GET /api/swarm-activity` 从 mission events、assignments、checkpoints、Run Console records、workerCards、task board 和 jobs 聚合最近活动，支持 `missionId/workerId/limit` 过滤；overview 暴露 `swarmActivity`；运行视图新增 Recent Swarm Activity 面板、刷新/复制按钮，点击活动可回到对应 mission/assignment 并打开 worker drilldown | 后续可接更细的 live TUI log tail 和 tool-call 级别 activity |
| Operations Full Outputs View | 已完成插件版 | `GET /api/agent-outputs` 返回 Hermes `AgentOutput` 风格输出队列，从 Jobs runs、Run Console records、checkpoints 和 worker assignment output 聚合 `all/ok/error/running` 过滤、summary、fullOutput、jobId、sessionKey、mission/assignment 元数据；overview 暴露 `agentOutputs`；运行视图新增 Full Outputs 面板，支持过滤、刷新、复制、打开链接、失败 job retry 和点击回到 Worker Output / worker drilldown | 后续可接宿主级长期 activity feed 和更细 tool-call retry |
| Approvals Queue / Gateway approvals | 已完成插件版 | `GET /api/approvals`、`GET /api/gateway/approvals` 从 Run Console approval records 和 Patch Review 记录生成 Hermes `ApprovalRequest` / gateway pending queue 兼容 payload，支持 `status/missionId/assignmentId/sessionPath/limit`；`POST /api/approvals/:approvalId/:action` 和 `POST /api/gateway/approvals/:approvalId/:action` 支持 approve/deny 并回写 run record、mission event、pending/history summary；overview 暴露 `approvals`；运行视图新增 Approvals 面板，支持 pending/history、risk 标签、打开相关 mission/worker、批准、拒绝、复制 | 后续如果 OpenHanako 暴露宿主级 approval gateway，可把该兼容队列与宿主真实审批流合并 |
| Mission phases / progress / cost | 已完成插件版 | mission 支持 `home/preview/active/complete`，页面显示完成度、active worker、token 成本估算，并可读取 `usage:list`；`/api/overview` 会按 sessionPath/agentId/task/assignment 关联把 usage 归因到 mission 和 assignment | 后续可接宿主原生 missionId/assignmentId usage 字段以提升精度 |
| Complete/history report | 已完成插件版 | `/api/missions/:id/report` 生成 Markdown report，`/export` 下载，页面可生成/复制/导出；`POST /api/missions/:id/report-artifact` 和工作台“记录报告产物”按钮可把 mission report 一键发布为 Run Console artifact，并可自动文件化、SessionFile staging、注册原生 HTML preview | 后续可把 report artifact 同步到宿主级长期 artifact registry |
| Run Console artifacts / approvals / learnings | 已完成插件版 | `lib/run-store.js` + `/api/run-records`，页面可记录 artifact、approval、learning，并把 approval 状态写入 mission event；approval 进入独立 Approvals Queue；artifact 可写入 `dataDir/artifacts`、通过 `stageFile` 登记 SessionFile，并通过 `POST /api/run-records/:recordId/artifact-preview` 注册 OpenHanako `/api/preview/html` 短期预览；Mission Report 与 SwarmBrief 均可直接固化为 artifact；Run Console 内置 `artifactPreviewPanel` iframe，可直接在工作台内预览并保留外部打开；同时新增 Hermes `Tool Output Artifacts / Context Bloat` 方案的插件版复刻：`lib/tool-artifact-store.js` 会把超过 4KB 的 `session:history` tool output 外置到 `dataDir/tool-artifacts`，生成稳定 `toolout_*` ID、`terminal_log/file_read/diff/skill_doc/tool_output` kind、summary、preview 和 artifact pointer，`/api/artifacts` 只列 metadata/preview，`/api/artifacts/:artifactId` 懒加载完整内容 | OpenHanako approval gateway 目前未公开插件入口，审批保持插件本地记录 + Review Gate + Gateway approvals 兼容 API |
| RunLearnings / RunCompare | 已完成插件版 | `GET /api/run-learnings` 按 success/failure/optimization 聚合 Run Console learning records，支持 `missionId/assignmentId/sessionPath/category/limit` 过滤；`GET /api/run-compare` 可按 mission、assignment 或 run record 对比 status、duration、tokens、cost、agent count、artifacts、pending approvals、learnings，并返回 Hermes `Compare Runs` 风格 metrics/recommendation；Run Console 面板新增 learnings 分类过滤/新增、Run A/B 选择、Compare Runs 和复制摘要 | token/cost 在缺少宿主精确 usage 时采用 assignment tokenCount 或文本估算，后续可接宿主原生 run metrics |
| Continue mission | 已完成插件版 | `/api/missions/:id/continue` 基于旧 mission summary/worker notes 生成 continuation prompt，创建 continuation mission/task，并默认复用已绑定 session 或通过 `session:create` 创建 worker session 后自动投递续接 Brief；支持 `dispatch:false` 只生成计划，所有投递继续走 OpenHanako `session:send` | 后续可接团队级 continuation template/policy |
| Stop / complete controls | 已完成插件版 | `/api/missions/:id/stop` 会请求绑定 session 的 `session:abort`，`/api/missions/:id/complete` 标记完成，并有 `/api/session-status` | 等宿主 `session:status` handler 后区分 running/stale/stopped |
| Worker output panel / smooth streaming | 已完成插件版 | assignment 存储 output/result/blocker/nextAction/tokenCount，页面可点击 worker/assignment 查看，也可读取 session history；`/api/session-events` 可订阅 EventBus live feed，`startSmoothLiveStream()` / `smoothStreamTick()` 将 `text_delta` 平滑 reveal 到 Worker Output；`streaming-indicator`、`streaming-cursor`、`streaming-skeleton` 提供 typing/thinking 状态，`turn_end` / error / disconnect 会 flush 或停止；Worker Output 与 Tool Trace 共享 Hermes 风格 tool-call pill + expandable details，可展开工具调用、工具结果、命令、文件、checkpoint、error 并复制详情；读取历史时会按 Hermes artifact-backed tool output 策略压缩超大 tool result，主消息流只显示 summary、preview、`toolout_*` pointer 和 `/api/artifacts/:artifactId` 入口，完整日志留在懒加载 artifact | 后续可接宿主更细粒度 tool-call phase/timing |
| Inspector panel / activity store | 已完成插件版 | `inspectorPanel` 汇总当前 session activity、最近消息、live event、tool trace、context usage、memory entries、agent skills 和 active assignment/checkpoint；`inspector-tabs` 提供 Activity / Context / Tools / Knowledge / Worker 五个 tab，`inspectorCollapseBtn` / `toggleInspectorCollapsed()` 支持折叠；全部来自已有 capability-gated API 和页面状态，不绕过宿主边界 | 后续可接宿主级 inspector layout 偏好同步 |
| Research Card embedded display | 已完成插件版 | `researchCardPanel` / `buildResearchCard()` 从 Mission、Notes、session history、tool trace、memory entries 和 Worker Output 生成研究问题、来源/证据、发现、不确定性和下一步；支持 `copyResearchCard()`、`saveResearchCardToMemory()`、`recordResearchCardArtifact()` | 插件侧本地抽取，不绕过宿主检索/联网边界 |
| Prompt Kit message / markdown / code / thinking rendering | 已完成插件版 | `message-preview` 安全渲染 Worker Output、session history、live stream、tool trace、memory 和 mission report；支持 Markdown 标题/列表/引用/行内代码、代码块复制、消息复制、thinking/reasoning 块、checkpoint/tool pills、可展开 tool-call details 与复制详情按钮 | 不是直接引入 React/Shiki，插件侧采用无构建依赖的安全轻量 renderer |
| Chat empty state / scroll-to-bottom button | 已完成插件版 | Worker Output 空状态使用 `chat-empty-state`，提供读取历史、连接实时和定位 Mission 的快捷入口；长输出离开底部时显示 `workerOutputScrollBtn`，点击回到最新输出，流式输出通过 `workerOutputPinnedToBottom` 避免抢滚动；typing/shimmer/smooth reveal 已由 streaming indicator 覆盖 | 后续可继续细化 token-level 动画 |
| Conversation export | 已完成插件版 | `/api/session-export` 基于 `session:history` 导出 Markdown / JSON / Plain Text / HTML / CSV / ZIP bundle，并在 Markdown/HTML 中包含 Tool Trace 摘要；ZIP 包含 `manifest.json`、`session.md/html/csv/json/txt` 和 `tool-trace.json`；`/api/session-export/batch` 支持 selected/pinned sessions 批量导出 Markdown / JSON / Plain Text / HTML / CSV 和 ZIP portable bundle，工作台 Main Session 与 Pinned 面板有快捷入口 | 可继续接宿主级长期 archive/分享权限 |
| Session fork / duplicate | 已完成插件版 | `/api/session-fork` 基于 `session:history` 生成 continuation prompt，通过 `session:create` 创建新 session 并可自动发送上下文；无创建能力时返回 prompt-ready 降级结果 | 当前不复制 OpenHanako session 文件，避免绕过宿主安全边界 |
| Context meter / context usage | 已完成插件版 | `/api/context-usage` 基于 `session:history` tokenCount、文本估算和 `usage:list` prompt token 生成 used/remaining/percent/status；可从插件配置 `modelMetadata.contextWindow` 自动选择模型上下文窗口；工作台 Main Session 面板显示上下文占用和 70%/90% 阈值提醒 | 后续可接宿主原生模型元数据 registry |
| Auto-generated session titles | 已完成插件版 | `/api/session-title` 基于 `session:history`、当前标题和 session path 生成短标题建议；工作台可复制标题或一键用于 pinned session | 后续可在宿主开放 rename handler 后接真实会话重命名 |
| Session alias rename overlay | 已完成插件版 | `/api/session-aliases` 持久化 session title alias；`listSessions()` 应用 alias 并保留 `originalTitle`；页面提供重命名和清除别名按钮 | 当前不直接写 OpenHanako session 文件，避免绕过宿主安全边界 |
| Session tombstones / search | 已完成插件版 | `/api/session-tombstones` 持久化隐藏 session tombstone，隐藏时清理 pinned/default/alias；`/api/search` 把 session 标题、路径、首条消息和最近 `session:history` 命中纳入结果并排除 tombstoned session | 当前不删除 OpenHanako session 文件，避免绕过宿主安全边界 |
| Pinned sessions / models | 已完成插件版 | `/api/defaults` 持久化并保序 `pinnedSessions` / `pinnedModels`，工作台提供 Pin 会话、Pin 模型和 Pinned 快捷面板；Pinned session 支持选择、设默认、上移/下移排序、同组拖拽排序、移除，Pinned model 支持上移/下移排序、同组拖拽排序、应用到 Agent Runtime、移除；拖拽仍复用 `/api/defaults` 安全持久化，不新增外部依赖 | 后续可接团队级 pinned preset 同步 |
| Modes System | 已完成插件版 | `/api/defaults` 持久化 `workbenchModes` 和 `activeWorkbenchModeId`；Modes 面板可保存当前 agent/session、mission mode、worker count、preferred/budget/premium models、Board View、Operations Profile，支持应用、重命名、删除，并通过 `workbenchModeDrift()` 显示当前 UI 与应用 mode 的漂移 | 后续可接宿主级全局 command palette 或团队同步 |
| Provider Setup / Provider Selection / Smart model suggestions | 已完成插件版 | `/api/provider-setup` 聚合 provider catalog、`/api/models`、`/api/local-providers`、`/api/provider-usage` 和 connection status，工作台 `providerSetupPanel` 显示 configured/discovered/local provider、模型、用量、安全配置片段、Docs、重新探测和 Pin 首个模型；`/settings/providers` 深链到该面板。`/api/model-suggestions` 基于 mission、notes、mode、template、当前 agent config、pinned models 和 `modelMetadata` 输出高能力/快速/均衡推荐；`modelChooserBackdrop` 聚合 smart suggestions、pinned models、`modelMetadata`、当前 runtime 和 session metadata，支持搜索、来源筛选、应用、Pin 和复制模型 ID。provider API key / OAuth token 仍由 OpenHanako 宿主管理，插件不保存密钥 | 后续可接宿主原生模型元数据 registry |
| Checkpoint contract | 已完成插件版 | `buildMissionPrompt()` 注入合约，`lib/checkpoint-store.js` 解析并持久化 checkpoint，`/api/checkpoints/sync-history` 从 session history 自动采集并去重；同一 task/session 的不同状态会形成 conflict group，`/api/checkpoints/:checkpointId/resolve` 可采纳一条并把其它标记 superseded，再回写 task/mission 状态；`/api/checkpoint-reminders` 与 `/api/checkpoints/:checkpointId/reminder` 支持 reminder 查询、设置、trigger 回写和清除，工作台 checkpoint 收件箱提供“15 分钟提醒 / 清除提醒”，到期复用 `notifyWorkbench()` 的 toast、浏览器通知和 haptic 反馈 | 后续可接宿主级提醒/日历 |
| Task store / Kanban | 已完成插件版 | `lib/task-store.js` + `/api/tasks` CRUD + 五列看板 + checkpoint 自动映射；看板支持标题/描述/标签/session 搜索和 assignee/priority 筛选；`savedBoardViews` 通过 `/api/defaults` 持久化常用筛选；`boardWipLimits` 通过 `/api/defaults` 持久化每列 WIP 限制并在 lane header 显示 count/limit、接近/超过提示；聚焦任务支持键盘编辑/选择/推进/删除；任务卡片可用 modal editor 编辑标题、描述、列、优先级、负责人、截止时间、标签、session、mission、assignment；支持拖拽换列、列内 position 排序和 selected cards 批量 move/update/delete | 后续可加多视图布局 |
| Keyboard shortcuts / help modal | 已完成插件版 | 顶部 `shortcutHelpBtn`、`⌘/`、`?` 打开 `shortcutHelpBackdrop`，集中展示全局搜索、看板、Mission composer、终端和 modal 快捷键；Escape 可关闭帮助、搜索和 artifact 预览 | 后续可接宿主级 command palette |
| Command Palette | 已完成插件版 | `⌘K` 打开 `commandPaletteBackdrop`，可搜索并执行刷新、全局搜索、引导/快捷键、创建/派发 mission、生成报告、同步 checkpoint、Integration Catalog、模型建议、terminal、pinned export、Autopilot tick、保存默认值等动作 | 后续可接宿主级全局 command registry |
| Settings / Theme / Editor preferences | 已完成插件版 | `workbenchSettings` 通过 `/api/defaults` 持久化；Settings 面板支持 Hermes/Claude Official/Classic/Slate/Mono light+dark 主题预设、theme、accentColor、editorFontSize、editorWordWrap、editorMinimap、usageThreshold、showSystemMetricsFooter、mobileChatNavMode、calendarTimezone；`applyWorkbenchSettings()` 实时设置 body themePreset/theme/accent、workspace editor 字号/换行、系统 metrics footer，Context Meter 使用可配置 usage threshold，Calendar 使用可配置时区刷新并展示 local/UTC/IANA 墙上时间 | Provider/API key 设置仍由 OpenHanako 宿主负责 |
| Mobile header / hamburger / sessions panel / tab bar / nav modes | 已完成插件版 | 小屏 `mobilePageHeader` 显示当前 session/missions 摘要；`mobileSessionsDrawer` 通过汉堡按钮打开，支持搜索、选择目标 session 并同步桌面 session select；`mobileTabBar` 提供控制台、Conductor、看板、运行、文件、终端六个跳转；`mobileChatNavMode` 支持 dock/integrated/scroll-hide，scroll-hide 会根据滚动方向隐藏/显示底部导航 | 后续可继续做移动端 worker drilldown 专用布局 |
| Notifications / haptics | 已完成插件版 | `workbenchNotifications` 通过 `/api/defaults` 持久化；Notifications 面板可配置 enabled、volume、browser、haptics；`notifyWorkbench()` 使用 Web Audio API 合成 spawned/complete/failed/chat/alert/thinking 等提示音，可请求浏览器 Notification，并在移动端调用 `navigator.vibrate` | 浏览器权限由用户决定，插件不绕过宿主/浏览器安全边界 |
| Toast / error toast / model suggestion toast | 已完成插件版 | `toastStack`、`pushToast()`、`renderToasts()` 提供右上角页面内 toast；`log()`、`notifyWorkbench()`、模型建议成功/失败会生成 info/complete/failed/alert/model toast，支持手动关闭和自动过期 | 后续可接宿主级 toast API |
| Worker cards / Worker IDE | 已完成插件版 | `/api/overview` 生成 `workerCards`；`/api/workers/:workerId` 返回 `ide` 快照，聚合 identity、health、task queue、chat/session hints、terminal attach hints、files/artifacts、approvals、usage、quick actions；右侧运行视图提供 `worker-ide-shell`、hub card、lane map，以及 Overview / Chat / Queue / Terminal / Preview / Files / Evidence 多 pane Worker IDE，可读取 history、发真实 session 消息、打开 terminal、preview、workspace files 和 evidence；`files.project` 会在授权 workspace root 内读取 `package.json` scripts、package manager 和 `.git/HEAD` branch，Preview/Files pane 显示 Project Metadata / Dev Scripts；Preview pane 新增 `worker-visual-picker`，可基于 preview URL、selector/元素标签、问题描述、worker/session/mission/assignment 证据创建 `preview-fix` 看板任务；Files 面板可把 diff 转成 approval record，并支持采纳写盘或拒绝留痕；`worker-lifecycle.js` 和 `/api/workers/:workerId/lifecycle` 显示 healthy/watch/handoff_required/renew_required，`/handoff` 可向真实 worker session 发送严格 `STATE: HANDOFF` 合约；`handoff-store.js` 会把 HANDOFF checkpoint 写成 `memory/handoffs/swarm/<workerId>-latest.md` 和归档文件，并在 Memory / Worker Evidence / `/api/handoffs` 中展示 | 后续可接更深的浏览器 DOM 点击选区和自动 renewal |
| Operations/profile presets / swarm roster | 已完成插件版 | `lib/operations-profile.js`、`lib/mission-store.js`、`/api/operations`、`/api/operations/presets`、`/api/operations/profiles`、`/api/operations/profiles/:profileId/export`、`/api/operations/profiles/import`、`/api/operations/profiles/:profileId/swarm-roster`、`/api/operations/swarm-roster/import`、`/api/operations/presets/:presetId/mission`、`/api/operations/profiles/:profileId/mission` 提供 Sage/Builder/Reviewer/Researcher/Ops 预设、readiness、setup gap、`operation-profiles.json` 持久队伍拓扑、visibility/permissions/sharedWith 治理元数据、portable profile JSON bundle 导入导出、一键预设/Profile Mission，以及 Hermes `swarm.yaml` 风格 roster JSON/YAML 导入导出；lanes 会保留 `specialty/model/mission/profile/modes/tools/skills/capabilities/preferredTaskTypes/greenlightRequiredFor/maxConcurrentTasks/acceptsBroadcast/plugins/pluginToolsets/mcpServers/wrapper/defaultCwd` 等 worker 元信息；Profile Mission 会按导入 roster 动态生成 assignments，并把工具/技能/greenlight 等元信息写入 `assignment.roster` | 后续接宿主偏好同步或团队目录同步 |
| MCP / Skills marketplace | 已完成目录/代理版 | `lib/integration-catalog.js`、`/api/integrations`、`/api/integrations/action` 汇总 MCP connectors、agent skills、已安装插件 manifest、host capabilities 和内置集成源；页面显示分类、状态、风险和健康度；MCP settings action 通过宿主 `mcp:settings-action` 代理 | 安装/启用/OAuth 属于宿主 marketplace handler，插件按 capability-gated 展示 |
| Agent runtime profile | 已完成插件版 | `/api/agents/:agentId/config` -> `agent:config`，页面显示 model、memory、enabled skills 摘要 | 持续补充更多宿主字段 |
| Skills browser | 已完成代理版 | `/api/agents/:agentId/skills` / `/api/agent-skills` -> `agent:skills`，页面显示 skill 列表，并在 Integration Catalog 汇总 | 真实宿主 skill registry 缺失时按 capability-gated 降级 |
| Memory browser | 已完成代理 + 本地 fallback | `/api/memory` -> `memory:list`，`/api/memory/:memoryId` -> `memory:read`，本地 memory store 支持列表/读取/编辑 fallback | 真实宿主 memory handler 缺失时仍有本地可编辑记忆面 |
| Usage / cost ledger | 已完成插件版 | `/api/usage` -> `usage:list`，overview 返回 usage summary 和 `usage.attribution`，包含 session、mission、assignment token/cost 桶；Usage 面板显示 top attribution | 后续接宿主价格/模型上下文元数据 |
| Host file checkpoints | 已完成插件版 | `/api/host-checkpoints` -> `checkpoint:list` / `checkpoint:find-by-session-since`，`POST /api/host-checkpoints/:checkpointId/restore` -> `checkpoint:restore` | 后续如宿主开放 revert/diff handler 再接入 |
| Session lifecycle | 已完成代理版 | `POST /api/sessions` -> `session:create`，`GET /api/session-status` -> `session:status`，`POST /api/session-revert-turn` -> `session:revert-turn`，页面有 Session Lifecycle 面板；`/api/session-history` 与 `/api/session-status` 支持 Hermes `key/sessionKey` 参数，`POST /api/session-send` 兼容 Hermes `{ sessionKey, message }` 并映射到 OpenHanako `session:send` | 需要宿主实际提供 handler |
| Jobs / runtime tasks | 已完成插件版 | `/api/host-tasks` -> `task:list/register/update/complete/fail/remove/cancel`，`/api/deferred-tasks` -> `deferred:list-pending/query`；`/api/missions/:id/dispatch` 会自动注册 `hanaagent-assignment` host task，assignment/mission 状态变化会同步 `task:update/complete/cancel` | 后续接计划任务和 autopilot monitor |
| Files/editor/upload | 已完成受控插件版 | `workspaceRoots` 显式授权，`/api/paths` 提供 Hermes path probe 兼容响应；`/api/files?action=list|read|download` 和 `POST /api/files` 提供 Hermes Files API 兼容入口，支持 list/read/download/write/mkdir/rename/delete；`/api/workspace-roots`、`/api/workspace-files`、`/api/workspace-file`、`/api/workspace-file/upload`、`/api/workspace-file/diff`、`/api/workspace-file/patch-review` 提供目录浏览、附件上传、文本/图片读取、文本保存、diff、Patch Review 采纳/拒绝、路径穿越和 symlink 越界防护；Worker IDE 仅在授权 root 内读取项目 metadata（package scripts / git branch）；artifact 文件化和 SessionFile staging 已完成 | 后续接 OpenHanako 原生 preview / checkpoint restore |
| Terminal/TUI | 已完成宿主管理版 | `/api/terminals` 代理 `terminal:list/start/read/write/close`；`/api/terminal-stream`、`/api/terminal-input`、`/api/terminal-resize`、`/api/terminal-close` 提供 Hermes terminal API 兼容入口，其中 stream 返回 OpenHanako-managed terminal 的短 SSE bootstrap；页面提供启动/读取/自动读取/状态/发送/关闭；`terminalFrame` / `terminal-screen` 提供类 xterm/TUI 屏幕、基础 ANSI 颜色渲染、命令历史、pwd/ls/git status 快捷命令、清屏和复制输出 | PTY 自启由宿主决定，不算插件范围 missing |
| Jobs/automation | 已完成插件版 | 已接 host task/deferred task runtime；插件自带 Jobs CRUD、run history、scheduler；`autopilotSchedule` 支持插件启动后的后台 tick | 可继续接更多 OpenHanako 原生 scheduled job/runtime task 字段 |
| Autopilot / orchestrator | 已完成插件版 | `/api/missions/:id/autopilot` 可生成/记录路由建议，`run` 模式可同步历史、真实 dispatch、标记 stale blocked、请求 review、完成全 done mission、escalation approval，并写入 mission event；`/api/autopilot/schedule`、`/api/autopilot/tick` 支持后台调度配置和手动 tick；`/api/autopilot/loop` 提供 start/pause/resume/stop/complete/escalate，多轮 iteration、critical streak、lastTick、runIds 和升级阈值状态持久化到 `autopilot-state.json` | 后续可继续优化策略和接宿主 scheduled job |

## Hermes parity matrix

新增结构化审计矩阵：

- `GET /api/parity`：返回 Hermes inventory 分类矩阵、状态白名单、summary。
- `GET /api/blueprint`：内嵌 `blueprint.parity`，供 OpenHanako 页面加载时显示。
- `/api/overview.sections.blueprint.parity`：在总览聚合中给出同一份审计证据。
- 工作台“完善路线”：显示 `plugin-implemented / capability-gated / host-provided / out-of-scope-for-plugin / missing` 数量，以及各 Hermes inventory 分类摘要。
- `GET /api/setup-doctor`：返回安装后 readiness 诊断；当前测试覆盖“无模型配置”会被标记为 blocking setup。
- Connection overlay / health banner：补齐 Hermes backend unavailable / health banner 体验，页面顶部直接暴露 readiness、degraded/blocked/offline 和下一步动作。
- `GET /api/session-export`：补齐 Hermes UX 7.7 Export，支持 Markdown、JSON、Plain Text、HTML、CSV 和 ZIP bundle 六种会话导出格式。
- `GET /api/session-export/batch`：补齐批量和 pinned session 快捷导出，支持 Markdown、JSON、Plain Text、HTML、CSV 聚合包和 ZIP portable bundle。
- `POST /api/session-fork`：补齐 Hermes Session Fork/Duplicate，读取原会话历史生成 continuation prompt，优先创建新 OpenHanako session 并自动投递，缺少 `session:create` 时保留 prompt-ready 降级。
- `GET /api/context-usage`：补齐 Hermes Chat Composer context meter，结合 session history、usage ledger 和 `modelMetadata.contextWindow` 输出上下文占用百分比、剩余 token 和阈值状态。
- `POST /api/session-title`：补齐 Hermes UX 7.8 Auto-Generated Session Titles，基于历史消息生成短标题并可用于 pinned session。
- `POST/DELETE /api/session-aliases`：补齐 Hermes Chat Sidebar rename 体验，在插件配置内保存/清除 session title overlay。
- `POST/DELETE /api/session-tombstones`：补齐 Hermes Session Tombstones 删除清理体验，在插件配置内隐藏/恢复 session 并清理相关 pin/alias/default target。
- `GET /api/search`：补齐 Hermes Session Search 体验，把 session 元数据和最近 history 命中纳入全局检索。
- 左侧 Chat Sidebar session filter：补齐 Hermes 会话侧栏快速过滤体验，按标题、别名、路径、agent、cwd、model 本地筛选当前 session list。
- Mission 输入框 slash command menu：补齐 Hermes Chat Composer 快捷命令体验，支持 `/new`、`/plan`、`/review`、`/dispatch`、`/model`、`/skills`、`/save`、`/help` 本地 helper。
- Mission 输入框 voice input：补齐 Hermes Chat Composer 语音输入体验，使用浏览器 Web Speech API，支持时将转写追加到 Mission，不支持时显示 `voice unsupported`。
- Mission 输入框 file attachments：补齐 Hermes Chat Composer 附件上下文体验，本地读取文本附件前 32KB 合并进 mission notes，图片/二进制附件保留文件名、类型、大小摘要，可预览、移除和清空。
- Keyboard shortcuts modal：补齐 Hermes 可发现快捷键体验，顶部按钮、`⌘/` 和 `?` 都可打开帮助层，覆盖 global search、Kanban、Mission composer、terminal 和 modal 快捷键。
- Command Palette：补齐 Hermes `⌘K` command palette 体验，工作台内置可搜索命令列表和键盘导航，Enter 可直接执行常用 workbench actions。
- Settings / Theme / Editor preferences：补齐 Hermes Configuration 4.1/4.2，本地持久化 Hermes 8-theme preset、theme/accent/editor/usage/system metrics/mobile nav，并让主题预设、强调色、编辑器字号/换行、context threshold 真实生效。
- Mobile header / hamburger / sessions panel / tab bar / mobile nav modes：补齐 Hermes Mobile-specific components 9.2/9.3，小屏顶部 header 暴露当前 session 摘要，汉堡按钮打开可搜索/选择的会话抽屉，底部导航可快速跳转工作台核心区域，并支持 dock/integrated/scroll-hide 模式。
- Sound notifications / haptics：补齐 Hermes UX 7.1/7.4，本地 Web Audio 合成提示音、volume/enable 配置、browser Notification 开关和 `navigator.vibrate` 触觉反馈。
- Toast / error-toast / model-suggestion-toast：补齐 Hermes UI Components 3.1/3.3，工作台内置可见 toast stack，日志、错误、提醒、完成和模型建议都会生成短提示。
- Onboarding tour：补齐 Hermes UX 7.6 首次引导体验，工作台提供步骤式 tour、目标区域定位、完成/稍后/重置状态和 `workbenchOnboarding` 持久化。
- `POST /api/defaults`：补齐 Hermes UX 7.9 Pinned Sessions & Models，支持持久化常用 session 和模型偏好，并在 Pinned 面板提供选择、设默认、应用模型、移除等管理动作。
- `POST /api/defaults`：补齐 Hermes 4.4 Modes System，支持持久化 `workbenchModes`、`activeWorkbenchModeId`，工作台 Modes 面板提供 save/apply/rename/delete 和 drift detection。
- `POST /api/defaults`：支持持久化 `workbenchNotifications`，用于本地 sound/browser/haptic 反馈设置。
- `POST /api/defaults`：支持持久化 `workbenchSettings`，用于本地 theme/accent/editor/usage/system metrics/mobile nav/calendar timezone 偏好。
- `POST /api/defaults`：支持持久化 `workbenchOnboarding`，用于本地 onboarding tour 完成/稍后/lastStep 状态。
- `GET /api/provider-setup` + `providerSetupPanel`：补齐 Hermes `/settings/providers` Provider Setup Wizard 体验，聚合 provider catalog、模型、local discovery、usage 和 connection status，提供 OpenHanako-safe 配置片段复制、Docs、reprobe、Model Chooser 和 Pin 模型动作；不保存 provider API key 或 OAuth token。
- `POST /api/model-suggestions` + `modelChooserBackdrop`：补齐 Hermes UX 7.10 Smart Model Suggestions / Provider Selection，基于任务画像、pinned/current/session model 和 `modelMetadata` 推荐、搜索、应用、Pin 模型。

当前矩阵结论：插件职责范围内 `completeForPluginScope = true`，`missing = 0`。`capability-gated` 不是未实现，而是 OpenHanako 插件架构下需要宿主 handler 的运行时能力。

## 本轮新增完成项

- 新增 Hermes 递归 API 兼容审计，并补齐所有嵌套 route alias；自动 diff 现在覆盖 `reference/hermes-workspace-main/src/routes/api/**/*.ts`，结果为 `NO_MISSING_HERMES_RECURSIVE_API_ALIASES`：
  - `GET /api/dashboard/overview`、`GET /api/model/info`、`GET /api/update/status`、`POST /api/update/agent`、`POST /api/update/workspace`：映射到 HanaAgent overview、model metadata 和 host-managed update 状态。
  - `GET/POST /api/profiles/*`：把 Hermes profile browser 映射到 HanaAgent agent profile overrides 和 OpenHanako default agent config。
  - `GET/POST /api/knowledge/*` 与 `GET/POST /api/memory/list|read|write`：把 Hermes knowledge/memory browser 映射到 OpenHanako memory、本地 memory store 和 handoff archive。
  - `GET/POST/PUT /api/mcp/*` 与 `GET/POST /api/skills/*`：把 Hermes MCP/Skills marketplace 子路由映射到 Integration Catalog、host MCP settings action 和 host-managed install/uninstall gate。
  - `POST /api/sessions/send`、`GET /api/sessions/:sessionKey/status`、`GET /api/sessions/:sessionKey/active-run`：映射到 OpenHanako `session:send/status`、HanaAgent task/run records。
  - `GET /api/claude-proxy/$`、`GET/POST /api/hermesworld/reservations*`、`GET /api/swarm-memory/search`：提供明确的 plugin-safe compatibility 响应或 HanaAgent swarm memory search。
- 新增最后一批 Hermes 顶层 API 兼容入口，并通过自动 diff 证明 `reference/hermes-workspace-main/src/routes/api/*.ts` 顶层同名面已无缺口：
  - `POST /api/auth`：返回 OpenHanako 插件 auth 边界内的 authenticated 响应；Hermes password cookie 由宿主 token/auth 机制替代。
  - `GET /api/media` 与 `GET /api/preview-file`：复用 `workspaceRoots` 文件沙盒和 Run Console artifact sandbox 服务媒体/预览文件，保留 MIME、大小、路径穿越和 symlink 防护，不服务任意绝对路径。
  - `POST /api/oauth/device-code`、`POST /api/oauth/poll-token` 以及 dot alias `/api/oauth.device-code`、`/api/oauth.poll-token`：返回 host-managed / capability-gated OAuth 状态，不在插件内交换或保存 provider token。
  - `POST /api/transcribe`：校验音频上传形态后返回 STT capability-gated 状态，不从插件 route 私自上传音频到外部 provider。
  - `GET /api/playground-admin`、`POST /api/playground-npc`：把 Hermes Playground 专属 demo surface 映射为 HanaAgent runtime stats / fallback NPC payload。
  - `GET /api/vt-capital`：提供 observe-only 兼容 payload，从 HanaAgent worker/run/checkpoint 数据生成非交易 dashboard 响应。
- 新增 Hermes session / terminal 基础 API 兼容入口：
  - `POST /api/send`：兼容 Hermes legacy non-stream chat send，映射到 OpenHanako `session:send`。
  - `POST /api/send-stream`：兼容 Hermes streaming chat endpoint，返回 SSE `open/message/done` 事件并通过 OpenHanako `session:send` 投递。
  - `GET /api/history`：兼容 Hermes chat history retrieval，映射到 `session:history`，支持 `sessionPath/key/sessionKey`。
  - `GET /api/events` 与 `GET /api/chat-events`：兼容 Hermes SSE event bus；有 session 时代理 `/api/session-events`，无 session 时返回插件 heartbeat。
  - `POST /api/session-send`：兼容 Hermes ControlSuite `{ sessionKey, message }`，映射到 OpenHanako `session:send`。
  - `GET /api/session-history?key=...` 与 `GET /api/session-status?sessionKey=...`：保留 HanaAgent 原响应，同时补 Hermes 参数和 payload 形态。
  - `POST /api/terminal-stream`：兼容 Hermes SSE terminal bootstrap，内部通过 OpenHanako `terminal:start/read` 返回 `session/data/close` 事件。
  - `POST /api/terminal-input`、`POST /api/terminal-resize`、`POST /api/terminal-close`：兼容 Hermes terminal 控制入口，写入/关闭映射到 OpenHanako `terminal:write/close`，resize 返回 capability-safe acknowledgement。
- 新增 Hermes 基础工作台 API 兼容入口：
  - `GET /api/auth-check` 与 `GET /api/ping`：返回 OpenHanako 插件 auth/health 兼容响应，auth 由宿主 plugin route token 边界负责。
  - `GET /api/workspace`：把 Hermes workspace auto-detection 映射到 HanaAgent `workspaceRoots`。
  - `GET /api/plugins`：从 Integration Catalog 暴露已安装插件目录，并标记当前 `hanaagent` 插件。
  - `GET/POST /api/mcp`：GET 暴露 OpenHanako MCP connectors，POST 代理允许的 `mcp:settings-action`。
  - `GET/POST /api/skills`：GET 暴露 Hermes skills list 兼容形态，POST 通过 `skill.toggle` 代理宿主 agent config。
  - `GET /api/local-providers`、`GET /api/provider-usage`、`GET /api/provider-setup`、`GET /api/system-metrics`：分别把 provider discovery、usage ledger、Provider Setup Wizard 聚合面和 workbench runtime metrics 映射为 Hermes 兼容响应；插件不直接读取宿主 OS metrics，也不保存 provider 密钥。
  - `GET/PUT /api/connection-settings`、`POST /api/config-patch`、`POST /api/gateway-reprobe`：把 Hermes connection/config/probe 映射到 OpenHanako 插件配置和 capability/status 聚合。
  - `POST /api/start-agent`、`POST /api/start-claude`、`GET /api/claude-update`：提供 host-managed / manual-confirm 兼容响应，不在插件内拉起或更新外部 Hermes 进程。
  - `GET /api/crew-status`：从 HanaAgent swarm runtime 生成 Hermes crew profile/status 兼容列表。
  - `GET /api/paths`：返回 OpenHanako 插件边界内的 `hanaHome/hermesHome/claudeHome`、`memoriesDir`、`skillsDir`、默认 `workspaceRoot` 和已授权 `workspaceRoots`。
  - `GET /api/files?action=list|read|download`：映射到 HanaAgent `workspaceRoots` 文件沙盒，返回 Hermes 风格 `root/base/entries`、文本/图片读取和下载响应。
  - `POST /api/files`：兼容 Hermes `write/mkdir/rename/delete` 动作，复用 HanaAgent 文件写入、目录创建、重命名和删除安全检查。
- 新增 Hermes Conductor / task / artifact 兼容 API alias：
  - `POST /api/conductor-spawn`：把 Hermes Conductor mission spawn 映射到 HanaAgent Mission、task 创建和 OpenHanako-safe assignment dispatch，返回 `mode: native-swarm`。
  - `POST /api/conductor-stop`：映射到 HanaAgent mission stop、host task cancel 和 session abort。
  - `GET /api/artifacts`、`GET /api/artifacts/:artifactId`：把 Run Console artifact records 和 `session:history` 大工具输出外置 artifact 暴露为 Hermes tool artifact 兼容形态；列表保持 metadata/preview，详情懒加载完整 content。
  - `GET/POST /api/claude-tasks`、`GET/PATCH/POST/DELETE /api/claude-tasks/:taskId`、`GET /api/claude-tasks-assignees`：映射到 HanaAgent Kanban，保留 Hermes shared Agent Kanban 的 delete 限制。
  - `GET/POST /api/hermes-tasks`、`GET/PATCH/POST/DELETE /api/hermes-tasks/:taskId`：映射到 HanaAgent Kanban，并支持 Hermes `launch` 动作创建/绑定 OpenHanako session、发送 task briefing。
- 新增 Hermes Swarm2 扩展兼容 API alias：
  - `POST /api/swarm-decompose`：基于 worker roster 做确定性任务拆解，保留 Hermes `assignments/unassigned` 返回形态；同时返回 Hermes JSON-only `orchestratorPrompt`、可读 `rosterText`，并支持 `dispatchToSession=true` 通过 OpenHanako `session:send` 把拆解提示发送给主控 session。
  - `GET/POST/PATCH /api/swarm-kanban`：映射到 HanaAgent task store，兼容 Hermes card create/update/list。
  - `GET/POST /api/swarm-memory`：映射到宿主 memory、本地 memory 和 durable handoff store，支持 scaffold、episodic note、handoff 写入。
  - `GET /api/swarm-reports`：从 Mission Report / Export 生成 Hermes reports 列表。
  - `GET /api/swarm-project`：从 Worker IDE project metadata 和 preview hints 暴露 cwd、projectName、branch、changedFiles、previewUrls、packageScripts。
  - `GET /api/swarm-environment`：暴露 OpenHanako plugin mode、capabilities、workspaceRoots、operation profiles、worker runtime 摘要。
  - `GET/POST /api/swarm-lifecycle`：映射到 Worker Lifecycle / handoff / renewal 能力。
  - `POST /api/swarm-tmux-start`、`POST /api/swarm-tmux-stop`、`POST /api/swarm-tmux-scroll`：以 OpenHanako-managed session/terminal 方式兼容 Hermes tmux 控制入口，不直接操作 tmux。
  - `POST /api/swarm-direct-chat`：映射到 `session:send` 和 `session:history`，兼容 Hermes direct worker chat。
  - `POST /api/swarm-orchestrator-loop`：从 checkpoint、assignment、runtime 状态生成 Hermes loop summary，并可对 stale worker 触发 follow-up dispatch。
  - `POST /api/swarm-runtime/reset`：把 runtime reset 映射为 assignment/task 状态重置。
- 新增 mission store：`plugins/hanaagent/lib/mission-store.js`
- 新增 Conductor API：
  - `GET /api/missions`
  - `GET /api/missions/:missionId`
  - `POST /api/missions`
  - `PATCH /api/missions/:missionId`
  - `POST /api/missions/:missionId/events`
  - `POST /api/missions/:missionId/dispatch`
  - `POST /api/missions/:missionId/stop`
  - `POST /api/missions/:missionId/complete`
  - `GET /api/missions/:missionId/report`
  - `GET /api/missions/:missionId/export`
  - `POST /api/missions/:missionId/continue`
  - `PATCH /api/missions/:missionId/assignments/:assignmentId`
  - `GET /api/mission-roles`
- 工作台首屏改为 Conductor 指挥台：包含 Mission 创建、启动、停止、完成、办公室式 worker live view、assignment 控制、worker output、mission history 和事件时间线。
- 工作台新增 Mission Report 操作：生成报告、复制报告、Markdown 导出、基于旧 mission 创建 continuation mission，并默认复用/创建 worker session 自动投递续接 Brief；`dispatch:false` 可只生成续接计划。
- Mission 创建会生成 worker assignments，并同步生成看板任务；checkpoint 写入后会回写 assignment/mission 状态。
- Mission assignment 与 Host Jobs 自动联动：投递 assignment 时自动注册稳定 ID 的 `hanaagent-assignment` runtime task；assignment 手动完成/阻塞/复核、mission 完成/停止会同步 `task:update/complete/cancel`，并写入 `host_task_sync` mission event。
- 新增 roster-aware Mission Broadcast：`POST /api/missions/:missionId/broadcast` 会按 `assignment.roster.acceptsBroadcast` 过滤目标 worker，向目标 session 发送包含 Mission/Assignment/工具/技能/Greenlight/Checkpoint 合约的 follow-up prompt，并把 sent/skipped 写入 mission event；工作台 Conductor 顶部新增 Broadcast 按钮。
- 新增 Autopilot 路由建议和巡检记录：`/api/missions/:id/autopilot` 支持 preview/run，`/api/autopilot` 查看历史；可根据 queued/running/blocked/review/done/stale 状态生成 dispatch/sync-history/mark-blocked/request-review/complete/escalate 建议，并把执行结果持久化到 `autopilot-runs.json`。
- 新增 Autopilot Scheduler：`lib/autopilot-scheduler.js`、`autopilotSchedule` 配置、`/api/autopilot/schedule`、`/api/autopilot/tick`，插件启动后可按配置周期性执行 preview/run tick，并在 overview 暴露 schedule/status。
- 新增 Operations profile presets + persistence：`lib/operations-profile.js`、`/api/operations`、`/api/operations/presets`、`/api/operations/profiles`、`/api/operations/presets/:presetId/mission`、`/api/operations/profiles/:profileId/mission`，页面显示队伍 readiness、setup gap、关键指标，可保存自定义 profile 到 `operation-profiles.json`，并把 profile lanes 映射到 mission assignments 的 agent/session/cwd。
- 新增 Hermes `swarm.yaml` roster 导入/导出和动态派发：Operations profile lanes 现在可保留完整 worker 元信息，`GET /api/operations/profiles/:profileId/swarm-roster` 支持 JSON/YAML 下载，`POST /api/operations/swarm-roster/import` 支持粘贴 Hermes 风格 JSON/YAML roster 并转成持久 Operations profile；工作台 Operations 面板增加导出 Roster JSON/YAML、导入 Roster 控件；`mission-store.js` 会按导入 roster lanes 动态创建 worker assignments，并把工具、技能、模型、greenlight gate、wrapper 等元信息保存在 `assignment.roster`。
- 新增 Swarm2 Worker IDE 快照：`lib/worker-ide.js` 和 `/api/workers/:workerId` 的 `ide` payload，把 worker identity、health、task queue、chat/session hints、terminal attach hints、files/artifacts、approvals、usage 和 quick actions 聚合成稳定视图模型。
- 新增 Swarm2 Worker Lifecycle / Compaction Stage 1-2：
  - `lib/worker-lifecycle.js`
  - `lib/handoff-store.js`
  - `GET /api/workers/:workerId/lifecycle`
  - `POST /api/workers/:workerId/handoff`
  - `GET /api/handoffs`
  - `GET /api/handoffs/:workerId`
  - `workerLifecyclePolicy` 插件配置（softLimit / handoffLimit / hardLimit / staleMinutes）
  - Worker IDE Overview 显示 lifecycle state、recommended action、context tokens、last handoff 和原因；Quick Actions 新增 Request Handoff，向真实 worker session 发送严格 `STATE: HANDOFF` 合约，并记录 mission event 和 Run Console approval。
  - 手动 checkpoint 和 session history sync 遇到 `STATE: HANDOFF` 会自动 materialize durable handoff，写入 `memory/handoffs/swarm/<workerId>-latest.md` 与 timestamp archive，并作为 Memory 条目和 Worker Evidence 暴露。
- 新增 Integration Catalog：`lib/integration-catalog.js`、`/api/integrations`、`/api/integrations/action`，把 MCP connectors、agent skills、已安装插件 manifest、host capabilities 和内置集成源统一成 Hermes marketplace/catalog 风格目录，并显示 health/category/kind/risk。
- 新增后端持久任务 store：`plugins/hanaagent/lib/task-store.js`
- 新增 checkpoint store：`plugins/hanaagent/lib/checkpoint-store.js`
- 新增任务 API：
  - `GET /api/tasks`
  - `POST /api/tasks`
  - `PATCH /api/tasks/:taskId`
  - `POST /api/tasks/:taskId/move`
  - `DELETE /api/tasks/:taskId`
  - `POST /api/tasks/clear-done`
- 新增 checkpoint API：
  - `GET /api/checkpoints`
  - `POST /api/checkpoints`
  - `POST /api/checkpoints/sync-history`
  - `DELETE /api/checkpoints/:checkpointId`
  - `POST /api/checkpoints/clear`
- 新增 session API：
  - `POST /api/sessions`
  - `GET /api/session-status`
  - `GET /api/session-history`
  - `GET /api/session-events`
  - `POST /api/session-abort`
  - `POST /api/session-revert-turn`
- 新增 runtime/IDE surface API：
  - `GET /api/agents/:agentId/config`
  - `GET /api/agents/:agentId/skills`
  - `GET /api/agent-skills`
  - `GET /api/memory`
  - `GET /api/memory/:memoryId`
  - `GET /api/usage`
  - `GET /api/host-checkpoints`
  - `POST /api/host-checkpoints/:checkpointId/restore`
  - `GET /api/terminals`
  - `POST /api/terminals`
  - `GET /api/terminals/:terminalId/read`
  - `POST /api/terminals/:terminalId/write`
  - `POST /api/terminals/:terminalId/close`
  - `GET /api/host-tasks`
  - `POST /api/host-tasks`
  - `GET /api/host-tasks/:taskId`
  - `POST /api/host-tasks/:taskId/update`
  - `POST /api/host-tasks/:taskId/complete`
  - `POST /api/host-tasks/:taskId/fail`
  - `POST /api/host-tasks/:taskId/cancel`
  - `DELETE /api/host-tasks/:taskId`
  - `GET /api/deferred-tasks`
  - `GET /api/deferred-tasks/:taskId`
- 新增 Run Console records API：
  - `GET /api/run-records`
  - `POST /api/run-records`
  - `PATCH /api/run-records/:recordId`
  - `DELETE /api/run-records/:recordId`
- 新增 artifact 文件化 API：
  - `POST /api/run-records/:recordId/artifact-file`
  - `GET /api/run-records/:recordId/artifact-file/content`
  - `POST /api/run-records/:recordId/artifact-preview`
- 新增 Workspace Patch Review Gate：
  - `POST /api/workspace-file/patch-review`
  - `POST /api/workspace-file/patch-review/:recordId/accept`
  - `POST /api/workspace-file/patch-review/:recordId/reject`
  - Files 面板新增 Patch Review / 采纳补丁 / 拒绝补丁按钮，diff 可转为 Run Console approval，采纳后才写入受控 workspace 文件，拒绝会保留 denied 审计记录。
- `/api/state` / `/api/overview` 返回 `missions`、`activeMission`、`tasks`、`checkpoints`、`hostCheckpoints`、`usage`、`agentProfiles`、`agentSkills`、`memoryEntries`、`runRecords`、`hostTasks`、`deferredTasks`、`workerCards`、`hostGaps`、section overview 和能力门控。
- 工作台看板从浏览器 `localStorage` 迁移到插件后端任务 API，并扩展为待办/进行中/阻塞/复核/完成五列。
- 页面新增 Checkpoint 收件箱：粘贴 worker 回复里的合约块后，自动解析 `STATE/RESULT/BLOCKER/NEXT_ACTION` 并移动关联任务。
- 页面新增 Main Session 控制：读取 session history、从历史自动同步 checkpoint、请求中止当前 session。
- 页面新增 Agent Runtime 控制：读取 agent config、usage ledger、host checkpoint。
- 页面新增 Skills / Memory 只读控制：读取 agent skills、memory list/read。
- 页面新增 Run Console 控制：记录 artifact、approval、learning，可批准/拒绝 pending approval，并可将 artifact 注册为 OpenHanako 原生 HTML preview。
- 页面新增 Session Lifecycle 控制：创建 worker session、读取 session status、请求回退最近一轮 assistant turn。
- 页面新增 Host Jobs 控制：读取/注册/完成/取消 host runtime task，读取 deferred tasks。
- 页面新增 Session Terminal 控制：通过宿主 `terminal:*` 启动、读取、写入和关闭 session terminal。
- 新增 mission store、任务 store、checkpoint store、路由聚合和 HTML 脚本解析单元测试。

## 下一轮最应该补

1. 等 OpenHanako 暴露插件可调用的 approval gateway 后，把 Run Console approval records 升级为宿主级审批流。
2. 使用 `session:status` 做 stale worker 检测和自动升级 blocked/review。
3. 接宿主 scheduled job / team directory 后，把 Autopilot loop 与团队级运行策略同步。
