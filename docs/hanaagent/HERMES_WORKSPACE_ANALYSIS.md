# Hanaco 智能体工作台完善分析

## 目标

依据 `reference/hermes-workspace-main`，系统性分析如何把当前 `plugins/hanaagent` 从一个轻量任务投递页，逐步完善成 Hanaco 智能体工作台。

本文不主张直接复制 Hermes Workspace。Hermes 是完整 React/Vite/Node/Electron 工作区，Hanaco 插件当前稳定承载面是 OpenHanako iframe page + EventBus + route。正确路径是抽取产品能力和数据契约，再按 Hana 宿主边界分阶段落地。

## 参考证据

- `reference/hermes-workspace-main/FEATURES-INVENTORY.md`
  - 列出 Chat、Dashboard、Files、Terminal、Memory、Skills、Jobs、Settings 等完整工作区能力。
- `reference/hermes-workspace-main/docs/swarm/ARCHITECTURE.md`
  - 定义 intent -> orchestrator -> workers -> checkpoint -> reports/inbox 的多智能体闭环。
- `reference/hermes-workspace-main/docs/swarm2-agent-ide-spec.md`
  - 明确 Swarm2 不是 dashboard，而是 sub-agent control plane and IDE。
- `reference/hermes-workspace-main/src/server/dashboard-aggregator.ts`
  - 展示 server-side aggregator 模式：并行探测、分区降级、返回统一 overview payload。
- `reference/hermes-workspace-main/src/server/gateway-capabilities.ts`
  - 展示 capability probe/gate 模式：先判断后渲染，不让 UI 在操作中途失败。
- `reference/hermes-workspace-main/src/server/tasks-store.ts`
  - 展示 file-backed task model：任务字段、列、优先级、assignee、session link。
- `reference/hermes-workspace-main/src/server/kanban-backend.ts`
  - 展示多 backend 适配：local / upstream / proxy，并做状态映射。
- `reference/hermes-workspace-main/src/server/terminal-sessions.ts`
  - 展示 PTY session 模型和 SSE terminal streaming。
- `reference/hermes-workspace-main/src/server/memory-browser.ts`
  - 展示 memory 文件枚举、读取、搜索和路径约束。

## 当前 HanaAgent 进度

当前插件位于：

```text
plugins/hanaagent/
```

已有能力：

- `manifest.json` 声明页面 `/workbench`、配置项、agent/session capability。
- `lib/hanaagent-core.js` 通过 Hana EventBus 调用：
  - `agent:list`
  - `agent:config`
  - `agent:skills`
  - `memory:list/read`
  - `session:list`
  - `session:create/status`
  - `session:send`
  - `session:history`
  - `session:abort`
  - `usage:list`
  - `checkpoint:*`
  - `task:*`
  - `deferred:*`
  - `terminal:*`
- `routes/workbench.js` 提供 iframe 单页工作台。
- 页面支持：
  - 智能体和会话选择
  - 任务编排/资料研究/构建实现/审查复核模板
  - 任务投递到已有 session
  - 读取 session 历史、显示最近消息、从历史自动同步 checkpoint
  - 中止目标 session
  - Conductor 指挥台、worker assignment、mission event timeline、办公室式 live view
  - `ctx.dataDir/tasks.json` 后端持久任务看板
  - Skills / Memory 只读面板
  - Run Console records：artifacts / approvals / learnings
  - 保存默认 agent/session
  - Hermes -> Hanaco blueprint 和完善路线展示
- 后端支持：
  - `/api/state` / `/api/overview` 聚合 agents、agentProfiles、agentSkills、memory、sessions、missions、tasks、checkpoints、runRecords、workerCards、blueprint、capabilities
  - `/api/tasks` CRUD
  - `/api/missions` Conductor mission API
  - `/api/missions/:id/report` / `/export` / `/continue`
  - `/api/checkpoints` checkpoint inbox API
  - `/api/session-history` / `/api/session-abort`
  - `/api/agent-skills` / `/api/memory`
  - `/api/run-records`
  - assignment dispatch -> `task:register/update/complete/cancel`
  - `/api/blueprint`

当前对应 Hermes 的最小工作闭环：

```text
选择 agent/session -> 新建 mission -> 自动生成 assignments/tasks -> session:send 投递 -> 自动注册 host runtime task -> session:history 同步 checkpoint -> 看板/mission/host task 状态联动 -> 生成 report/export -> continuation mission
```

## 核心差距

### 1. 统一能力探测已有底座，仍需覆盖更多 IDE 面

Hermes 的 `gateway-capabilities.ts` 把每个能力显式探测出来，再由 UI 决定显示完整功能、降级占位或提示配置。当前 HanaAgent 已经探测 `agent:list`、`agent:config`、`session:list/create/status/send/history/abort`、`usage:list`、`checkpoint:*`、`task:*`、`deferred:*`、`terminal:*`，并在 overview 里输出 `hostGaps`。

Hanaco 还需要等待宿主稳定：

- `agent:skills` / `memory:*` 的真实 handler
- files / preview / editor 能力可用性

### 2. server-side overview 聚合仍需增强

Hermes dashboard 的关键不是卡片，而是 `buildDashboardOverview()` 的聚合策略。当前 HanaAgent 已有 `/api/overview`，能聚合 agents、agentProfiles、agentSkills、memory、sessions、tasks、missions、checkpoints、hostCheckpoints、usage、runRecords、hostTasks、deferredTasks、workerCards、blueprint、capabilities 和 incidents。还可以继续增强的是每个 section 的实时性和精确归因。

Hanaco 需要增加：

- 并行聚合 agent、session、task、checkpoint、capability、config、usage
- 每个 section 独立失败，不影响整个工作台
- 返回 `null` 或 `unavailable`，而不是让页面崩掉

### 3. 任务系统已有后端底座，但还不是完整 Kanban

Hermes 的 `tasks-store.ts` 有明确任务模型：

- id
- title
- description
- column
- priority
- assignee
- tags
- due_date
- position
- created_by
- session_id / sessionPath

当前 HanaAgent 已经把任务迁移到插件后端 `ctx.dataDir/tasks.json`，并提供 `/api/tasks` CRUD。工作台页面已扩展为待办、进行中、阻塞、复核、完成五列，并能通过 checkpoint 状态自动移动关联任务。它仍缺少 Hermes Kanban 的多 backend 和完整 assignee/priority 过滤视图。

Hanaco 已完成：

- checkpoint -> task lane 自动映射
- blocked / review / done 视觉 lane
- 后端持久任务 API

Hanaco 还需要增加：

- 后续可升级为 EventBus task provider
- assignee / priority 的完整筛选 UI
- 多 backend 适配能力

### 4. checkpoint 合约已有插件闭环

Hermes swarm 强调 checkpoint，不鼓励 worker 随意自由聊天。它的关键合约是：

```text
STATE: DONE | BLOCKED | NEEDS_INPUT | HANDOFF | IN_PROGRESS | NEEDS_REVIEW
FILES_CHANGED:
COMMANDS_RUN:
RESULT:
BLOCKER:
NEXT_ACTION:
```

当前 HanaAgent 已经在 mission prompt 内嵌 checkpoint contract，并新增 `lib/checkpoint-store.js`、`/api/checkpoints` 和页面 Checkpoint 收件箱。用户可以粘贴 worker 回复末尾的合约块，工作台会解析 `STATE/RESULT/BLOCKER/NEXT_ACTION`，持久化到 `ctx.dataDir/checkpoints.json`，并把关联任务移动到 `running/blocked/review/done`。

Hanaco 已完成：

- mission prompt 内嵌 checkpoint contract
- checkpoint parser
- checkpoint inbox 页面区域
- status -> lane 映射
- `NEEDS_INPUT` / `BLOCKED` 的显著提醒

Hanaco 已继续完成：

- 通过 `session:history` 自动读取 worker 回复并采集 checkpoint
- 按 sessionPath/taskId/rawText 做基础去重
- 同一 task/session 出现互相矛盾状态时自动形成 conflict group
- 通过 `/api/checkpoints/:checkpointId/resolve` 和工作台“采纳”动作保留一条证据、supersede 其它证据，并回写 task/mission 状态

Hanaco 还需要增加：

- checkpoint 触发用户提醒或复核门禁

### 5. Worker card 已有聚合版，但还不是真实时 worker IDE

Hermes Swarm2 要求 worker card 包含真实会话、任务、runtime/log、cwd、terminal、preview/editor。当前 HanaAgent 已在 `/api/overview` 生成 `workerCards`，把 agent、session、当前任务和最近 checkpoint 聚合成运行卡片数据；页面右侧也能读取真实 session history、同步 checkpoint、abort / revert turn、agent config、usage ledger、session lifecycle、host jobs/deferred tasks，并通过宿主 `terminal:*` 操作 session terminal。受控 Files/editor/preview 已在插件内落地，session status/create/revert 则取决于宿主 handler。

Hanaco 需要分阶段增加：

- 页面 worker card 组件
- session status/create 快捷动作已做 capability-gated 代理，需宿主 handler
- cwd / model / modified time
- quick actions：chat、route、copy prompt、abort、revert turn、terminal、preview 已有基础版，可继续增强多 pane 体验
- artifact HTML preview 已接 OpenHanako `/api/preview/html`；如果 Hana 宿主未来暴露原生 file / approval gateway，再从插件本地受控记录升级为宿主统一能力

### 6. 缺少 Memory / Skills / Files 三个 IDE 面，Terminal 已有宿主代理版

Hermes 是完整 IDE：

- Memory Browser
- Skills Browser
- Files + Monaco
- Terminal + xterm.js

当前 OpenHanako 插件不应直接复制这些大型模块，但可以先做索引/跳转/摘要：

- Memory：读取 Hana/Agent 暴露的 memory list 或配置路径，先做只读检索。
- Skills：列出当前 Agent 可用 skill 和启用状态。
- Files：不要越权浏览全盘；优先接入 Hana 已有文件/SessionFile 能力。
- Terminal：已接 `terminal:list/start/read/write/close` 宿主管理 PTY；后续可替换成更接近 Hermes 的 xterm.js 体验。

## 能力分层

### A. 插件内可直接落地

- 工作流模板库
- capability blueprint
- server-side overview route
- file-backed task store
- mission prompt builder
- checkpoint contract injection
- checkpoint parser
- local inbox/report list
- mission report / markdown export / continuation prompt
- agent config / usage ledger / host checkpoint / terminal bus proxy
- 默认 agent/session 配置
- route smoke tests 和 core tests

### B. 需要 Hana 宿主 EventBus 支持

- 创建新 session
- 获取 session streaming/running 状态
- 获取当前 agent cwd/model/tools/skills
- 获取 memory/skill 列表
- 打开文件、stage 文件、session file 管理

建议宿主新增或稳定这些 bus：

```text
session:create
session:status
agent:config
agent:skills
usage:list
checkpoint:list
checkpoint:find-by-session-since
memory:list
memory:read
task:list
task:register
task:create
task:update
deferred:list-pending
deferred:query
```

### C. 暂不适合插件直接承载

- 自行启动 PTY terminal
- 全量文件编辑器
- 自行实现 provider credential 管理
- 绕过 Hana session 模型创建独立 agent runtime
- 长驻后台 autopilot loop

这些更适合作为 Hana 宿主能力或受控 full-access runtime 服务，再由插件 UI 调用。

## 目标架构

```text
HanaAgent Workbench
├── UI iframe page
│   ├── Hub summary
│   ├── Worker cards
│   ├── Mission composer
│   ├── Task board
│   ├── Checkpoint inbox
│   └── Capability/diagnostics panel
├── Plugin routes
│   ├── /api/overview
│   ├── /api/capabilities
│   ├── /api/tasks
│   ├── /api/dispatch
│   └── /api/checkpoints
├── Core library
│   ├── bus adapters
│   ├── prompt templates
│   ├── task store
│   ├── checkpoint parser
│   └── overview aggregator
└── Hana EventBus
    ├── agent:list / agent:describe
    ├── session:list / session:create / session:status / session:send / session:history
    ├── task:* / deferred:*
    └── memory:* / skills:* when available
```

## 分阶段路线图

### Phase 1 - 稳定工作台骨架

目标：让当前插件从 v0 demo 变成可持续迭代的控制台骨架。

交付：

- `blueprint` 能力模型
- `/api/blueprint`
- 文档化 Hermes -> Hanaco 能力映射
- 当前页面展示完善路线和能力缺口
- core tests 覆盖 blueprint

验收：

- `npm test` 通过
- route smoke 覆盖 `/workbench`、`/api/state`、`/api/blueprint`

### Phase 2 - 持久任务与 overview 聚合

目标：把浏览器本地看板升级为插件后端任务系统，并补上 Hermes 式 overview 聚合入口。

交付：

- `lib/task-store.js` - 已完成
- `/api/tasks` CRUD - 已完成
- `/api/overview` 轻量聚合 - 已完成底座：
  - capabilities
  - agents
  - sessions
  - tasks
  - blueprint
  - incidents
- UI 看板改用 route API - 已完成

验收：

- 任务在浏览器刷新和 Hana 重启后仍存在
- 多页面打开同一个工作台看到同一任务数据
- `/api/overview` 返回 section 化 payload

### Phase 3 - Mission / Checkpoint 闭环

目标：让工作台从“发送 prompt”变成“可审计任务闭环”。

交付：

- mission brief builder
- checkpoint contract 注入
- checkpoint parser
- checkpoint inbox
- 状态映射：DONE/BLOCKED/NEEDS_INPUT/NEEDS_REVIEW -> 看板 lane

验收：

- 投递任务时 prompt 包含明确 checkpoint contract
- 粘贴或读取 checkpoint 后能生成 inbox item
- blocked/input/review 状态可视化

### Phase 4 - Worker cards

目标：接近 Hermes Swarm2 的 worker IDE tile。

交付：

- 每个 agent/session 的 worker card
- session history 摘要和 checkpoint 同步
- 当前任务/队列/最近结果
- quick actions：send、copy prompt、abort、save default
- 接入 `session:status` 后显示真实 running/stale/stopped

验收：

- 用户能从一个卡片判断 worker 在做什么、下一步是什么、是否需要介入

### Phase 5 - Memory / Skills / Files / Runtime 接入

目标：按 Hana 宿主能力逐步扩展 IDE 面。

交付：

- memory 只读搜索
- skills 启用状态摘要
- session files / artifacts list
- terminal 走宿主管理 PTY；artifact preview 走宿主 `/api/preview/html`；editor 走插件受控 workspaceRoots，未来可接宿主原生 file / approval API

验收：

- 所有高级面板都有 capability gate
- 不可用时显示明确原因和下一步

### Phase 6 - Autopilot

目标：形成轻量自动编排，而不是让用户手动派每个任务。

交付：

- role routing rules
- stale task detection
- blocked escalation
- review gate
- periodic monitor 由 Hana automation/host 触发，不在 iframe 里长跑

验收：

- 工作台能建议下一步派发对象
- 对 BLOCKED/NEEDS_INPUT 不自动吞掉
- 自动动作全部可审计

## 当前插件优先级建议

下一步最值得做：

1. 接入或等待 `session:create`，让 Conductor 可以为每个 assignment 自动分配独立 worker session。
2. 接入或等待 `session:status`，让 worker card 区分 running/stale/stopped。
3. 补 Skills / Memory 只读面板，全部走 capability gate。
4. 增强 `/api/overview` 为更接近 Hermes dashboard aggregator 的分区降级模型。

这四项投入小、风险低，但会显著提升工作台的“可持续迭代性”。Terminal、文件编辑器、自动创建 agent runtime 等能力应该等 Hana 宿主边界明确后再做。
