# Hermes Workspace 原项目分析报告

## 摘要

`reference/hermes-workspace-main` 不是单一聊天界面，而是一个面向多智能体协作的独立工作台。它把 Chat、Conductor、Swarm、Task Kanban、Files、Terminal、Memory、Skills、MCP、Jobs、Operations、Provider Settings 和 Inspector 组合成一个控制面，并用后端 API 层把会话、worker、任务、artifact、checkpoint 和运行状态聚合成统一视图。

对 HanaAgent 的价值不在于逐文件复制 Hermes，而在于复刻它的产品结构和运行契约：用 OpenHanako 的插件页面、EventBus、宿主管理 session/terminal/task/memory、插件 dataDir 和鉴权边界，承载 Hermes 的核心工作流。

## 原项目定位

Hermes Workspace 的核心定位可以概括为：

- 智能体工作台：不仅发送消息，还管理 agent、session、任务、运行证据和复盘。
- 多 worker 控制面：通过 Conductor / Swarm / Swarm2 把一个任务拆给多个 worker，并持续收集 checkpoint。
- Agent IDE：为 worker 提供 chat、queue、terminal、preview、files、artifacts、evidence 等 IDE 式上下文。
- 运维与复盘面：通过 Run Console、Approvals、Learnings、Run Compare、Jobs、Operations profile 管理长期运行质量。
- 上下文治理层：通过 artifact-backed tool outputs 把大工具输出从聊天上下文中拆出，避免上下文膨胀。

## 关键功能发现

### 1. Dashboard 不是静态首页，而是聚合器

Hermes 的 Dashboard 关键在 server-side aggregator。它把 agent、session、任务、运行状态、事件、成本、错误和建议操作合并成 overview payload。UI 只是这个聚合模型的呈现层。

对 HanaAgent 的启发：

- `/api/overview` 应作为核心工作台状态源。
- 每个 section 要能独立降级，避免某个宿主 capability 缺失导致整个页面不可用。
- 需要明确区分 `implemented`、`host-provided`、`capability-gated` 和 `out-of-scope-for-plugin`。

### 2. Conductor / Swarm 的核心是 checkpoint 合约

Hermes 多智能体不是让 worker 自由聊天，而是要求 worker 按固定 checkpoint 汇报：

```text
STATE: DONE | BLOCKED | NEEDS_INPUT | HANDOFF | IN_PROGRESS | NEEDS_REVIEW
FILES_CHANGED:
COMMANDS_RUN:
RESULT:
BLOCKER:
NEXT_ACTION:
```

这个合约让工作台能够自动更新任务状态、识别阻塞、生成 handoff、触发复核和完成门禁。

对 HanaAgent 的启发：

- Mission prompt、SwarmBrief、broadcast、handoff prompt 都应该内嵌同一份 checkpoint contract。
- session history sync 必须能从 worker 回复中抽取 checkpoint，并回写 mission / task / assignment。
- `STATE: HANDOFF` 应写入持久 memory，作为 worker lifecycle 的压缩交接点。

### 3. Swarm2 是 Worker IDE，不只是 worker 卡片

Hermes Swarm2 的重点是把 worker 作为可观察、可接管、可续接的运行单元。Worker card 只是入口，真正的价值在 drilldown：

- worker identity / health
- task queue
- chat/session hints
- terminal attach
- preview URL
- files / changed files
- artifacts / approvals
- usage / context pressure
- lifecycle / handoff

对 HanaAgent 的启发：

- HanaAgent 应把 worker detail 设计成多 pane IDE。
- 真实 session、terminal、files、preview 都应走 OpenHanako 宿主能力或授权 workspace roots。
- 不应直接操作 Hermes 的 tmux/profile/state.db，而应映射为 OpenHanako session / terminal / task / plugin data。

### 4. Run Console 是运行证据系统

Hermes Run Console 把 artifacts、approvals、learnings、run compare、mission report 串成闭环。它不是简单日志列表，而是把产物、审批和经验复盘作为 agent 运行质量管理的一部分。

对 HanaAgent 的启发：

- artifacts 应支持文件化、预览和 SessionFile staging。
- approvals 应有 pending/history、risk label 和 approve/deny。
- learnings 应能按 success/failure/optimization 分类。
- run compare 应比较 status、duration、tokens、cost、agents、artifacts、approvals、learnings。

### 5. Tool Output Artifacts 是上下文治理关键

Hermes 明确指出工具输出和模型上下文是两种不同数据：

- Conversation/model context：模型推理所需的用户意图、助手结论和少量摘要。
- Execution trace/artifacts：完整工具输出、日志、文件内容、diff、skill docs、浏览器快照。

Hermes 的策略是：

- 小于 `4KB` 的工具输出保留内联。
- 超过 `4KB` 的工具输出存为 artifact。
- 聊天历史只保留 summary、preview、artifact id。
- 完整内容通过 artifacts API 懒加载。

对 HanaAgent 的启发：

- `session:history` 返回时应防御性压缩大工具结果。
- `/api/artifacts` 列表不应返回完整大内容。
- `/api/artifacts/:artifactId` 才懒加载 full content。
- artifact kind 应能区分 `terminal_log`、`file_read`、`diff`、`skill_doc`、`tool_output`。

### 6. Files / Terminal / Memory / Skills 是 IDE 能力，不应越权复制

Hermes 是独立应用，可以直接实现文件浏览、PTY、技能目录、memory 文件枚举。OpenHanako 插件则必须遵守宿主边界。

对 HanaAgent 的启发：

- Files 只能访问授权 `workspaceRoots` 或插件 dataDir。
- Terminal 必须通过宿主 `terminal:*` capability。
- Memory 优先走宿主 `memory:*`，再用插件本地 memory fallback。
- Skills 优先走宿主 `agent:skills` / agent config，不在插件内绕过宿主安装策略。

## 适合 HanaAgent 复刻的能力

以下能力适合在 OpenHanako 插件内实现或已实现：

- Conductor mission lifecycle
- SwarmBrief / assignment dispatch
- checkpoint parser / inbox / conflict resolution
- task Kanban / WIP / saved views / batch operations
- worker drilldown / Worker IDE 快照
- session history sync / session export / session fork
- Run Console artifacts / approvals / learnings
- artifact-backed large tool output
- Agenda / Calendar / Jobs
- Operations profile / swarm roster import-export
- Integration Catalog
- Setup Doctor / capability gate / health banner
- Provider Setup / Model Chooser 的安全引导层
- Hermes API alias 兼容层

## 不应直接复刻的能力

以下能力属于 Hermes standalone 应用边界，HanaAgent 插件不应照搬：

- Hermes Electron/PWA/Docker/installer 部署结构。
- Hermes gateway 进程启动、升级、认证 cookie 管理。
- 直接读写 Hermes tmux、profile、state.db。
- 绕过 OpenHanako 的 provider token / OAuth / API key 存储。
- 越权访问任意本地文件或终端。
- 在插件内实现独立模型调用链，绕过 OpenHanako session runtime。

这些能力在 HanaAgent 中应映射为：

- OpenHanako 插件页面和路由。
- OpenHanako EventBus capability。
- OpenHanako session / task / terminal / memory / checkpoint handler。
- 插件 dataDir 的本地持久化。
- 宿主插件 token 和 full-access 开关。

## HanaAgent 当前映射结论

HanaAgent 已按 OpenHanako 插件边界完成 Hermes 主要工作流复刻：

- 工作台入口：`/api/plugins/hanaagent/workbench`
- 兼容 API：`/api/plugins/hanaagent/api/*`
- 数据存储：`plugin-data/hanaagent` 与插件 `dataDir`
- 大工具输出：`tool-artifacts` 本地缓存
- 任务/mission/checkpoint/run record/job/profile/memory/handoff：插件 store + 宿主 capability
- 运行时能力：通过 EventBus 调用 `session:*`、`terminal:*`、`task:*`、`memory:*`、`agent:*`、`checkpoint:*`

当前实现策略是正确的：功能上尽量靠近 Hermes，运行边界上保持 OpenHanako-safe。

## 风险与注意事项

- Full-access 插件需要用户在 OpenHanako 中允许 full-access，否则不会加载。
- 宿主缺少某些 handler 时，相关功能必须显示 capability-gated，而不是报错。
- API alias 只能保证形态兼容，不代表所有 Hermes standalone 行为都能在插件内原样执行。
- 大工具输出 artifact cache 是 Workspace 侧防御性治理；如果宿主 session runtime 未来也能在写入历史前外置工具输出，应以宿主实现为准。
- 真实 app 热重载可能保留 ESM module cache；替换社区插件后，冷重启 app 最稳。

## 建议后续路线

1. 把 HanaAgent 的 parity matrix 作为长期验收门禁，新增 Hermes 功能时先归类到 `plugin-implemented`、`host-provided`、`capability-gated` 或 `out-of-scope-for-plugin`。
2. 把 tool artifacts 从插件本地缓存逐步升级为 OpenHanako 宿主级 artifact registry，让所有插件和 session runtime 共享。
3. 继续增强 Worker IDE 的可视化和真实 preview/DOM 证据采集，但保持 workspace root 授权边界。
4. 将 approvals 与 OpenHanako 原生 approval gateway 合并，保留当前插件本地队列作为 fallback。
5. 为 `/api/artifacts`、`/api/session-history`、`/api/swarm-*` 保留回归测试，防止 Hermes 兼容面退化。

