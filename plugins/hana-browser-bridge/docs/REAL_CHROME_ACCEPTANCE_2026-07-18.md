# Hana Browser Bridge：真实用户 Chrome 验收记录（2026-07-18）

## 1. 验收范围与安全约束

本轮只连接用户已经打开的 Google Chrome，并且只对脚本临时创建的 `127.0.0.1` 验收页执行写操作。

始终遵守：

- 不修改、不代理 `com.openai.codexextension`；
- 不修改或重打包 Codex Chrome 扩展；
- 不输出 `DevToolsActivePort` 的 browser WebSocket path；
- 不输出 CDP `sessionId`；
- 不读取或记录用户标签页标题、URL、正文、Cookie、Authorization 或输入内容；
- 用户已有 target 仅用于验证“未 claim 不可读”，不执行 attach 或页面读取；
- `existing-chrome` 的 stop、unload、emergency detach 不得关闭用户 Chrome；
- 测试创建的本地验收标签页在结束前主动关闭。

## 2. 环境

| 项 | 值 |
|---|---|
| 日期 | 2026-07-18 |
| 平台 | macOS |
| Chrome | `150.0.7871.127` |
| Hana 插件（修复前） | `0.2.0` |
| Browser Bridge（修复前） | `3.1.0` / `9ba1d9bfbe587b8a05969a951eff691bdb3a9a8f` |
| Hana 插件（修复后） | `0.2.1` |
| Browser Bridge（修复后） | `3.1.1` / `85ee4961b378e30c79f1a588c5d2e189ce0c1291` |
| 连接模式 | `existing-chrome` |
| 工具 profile | `workflow`（15 个工具） |

连接前的非侵入检查确认：Chrome 正在运行、`DevToolsActivePort` 存在、loopback endpoint 可达。报告没有记录端口和 browser path。

## 3. Stage 1：Allow 与显式启动门禁

首次连接时 Chrome 显示原生远程调试授权对话框，用户选择 Allow。验收结果：

```json
{"phase":"prestart","explicitGate":true}
{"phase":"start","ok":true,"mode":"existing-chrome","ownsBrowser":false,"toolCount":15}
{"phase":"list","ok":true,"count":5,"safeShape":true,"secretsAbsent":true}
{"phase":"status","mode":"existing-chrome","explicitStartGranted":true,"ownsBrowser":false,"connected":true}
{"phase":"cleanup","emergency":true,"browserStopped":false}
```

结论：

- 未 reviewed explicit start 时，业务工具不能隐式连接用户 Chrome；
- Allow 后可以建立 `existing-chrome` MCP 会话；
- 插件不拥有用户 Chrome；
- 只暴露 15 个 workflow 工具；
- tab 列表不包含 endpoint、browser path 或 session secret；状态接口只返回 `auto-connect:available/unavailable` 和 `configured/channel-default`，不暴露端口或 User Data 绝对路径；
- emergency detach 不关闭用户 Chrome。

## 4. Stage 2 初次运行：发现真实后台标签点击缺口

Stage 2 创建两个本地验收标签页，并先向两个 tab 分别输入 `alpha` 和 `beta`。多 target 路由正确，但在第二个 tab 成为前台后，对第一个后台 tab 执行原生点击时出现：

```text
Input.dispatchMouseEvent timeout 5000ms
```

隔离集成测试此前没有覆盖“真实有界面 Chrome + 两个 tab + 对后台 tab 派发 native mouse”的组合，因此未提前发现。

根因：`existing-chrome` 使用 browser-level flattened session；Chrome 对后台 target 的 `Input.dispatchMouseEvent` 可能等待到超时。DOM 读取和文本输入仍可成功，不代表原生鼠标事件同样可靠。

## 5. 修复

Browser Bridge `3.1.1` 在原生点击的安全护栏和元素定位通过后、发送鼠标事件前：

```text
Target.activateTarget({ targetId })
Input.dispatchMouseEvent(mouseMoved)
Input.dispatchMouseEvent(mousePressed)
Input.dispatchMouseEvent(mouseReleased)
```

限制：

- 只在 `existing-chrome` 模式激活 target；
- dedicated 模式保持原行为；
- 未 claim target 在前置 `sendPageCommand` 或 claimed browser command 阶段以 `NO_SESSION` 拒绝，不会被激活；
- browser-level activation 与 target claim、connection generation 绑定，endpoint 重连后旧 claim 不会激活新连接中的同名 target；
- `Target.activateTarget` 是内部浏览器级命令，不新增 raw CDP MCP 工具；
- 点击硬门禁仍先于 target 激活和鼠标事件执行，危险按钮不会因为修复而获得绕过路径。

新增单元测试验证 claim 门禁、generation 绑定和命令顺序；插件 Auto Connect 集成测试新增“双 tab 后点击第一个后台 tab”的回归场景。

## 6. Stage 2 修复后复测

```json
{"phase":"start","ok":true,"mode":"existing-chrome","ownsBrowser":false,"toolCount":15}
{"phase":"claim-gate","unclaimedReadBlocked":true,"tabCount":5,"secretsAbsent":true}
{"phase":"multi-tab","isolated":true,"tabA":"alpha","tabB":"beta"}
{"phase":"spa","nativeClick":true,"backgroundTargetActivated":true,"statePreserved":true}
{"phase":"detach-reattach","detachedBlocked":true,"reattach":true,"secretsAbsent":true}
{"phase":"close-created","closed":2}
{"phase":"emergency-detach","emergency":true,"browserStopped":false,"chromeAlive":true}
```

已证明：

1. 未 claim 的用户 target 不可读取；
2. `browser_new_tab` 自动 claim 新建 target，响应不泄漏 `sessionId`；
3. 两个 target 的输入和 DOM 读取不串线；
4. 后台 target 在原生点击前被激活，SPA `history.pushState` 和页面状态保持；
5. detach 后访问被拒，reattach 后恢复，attach 响应无 `sessionId`；
6. 两个本地验收标签页均关闭；
7. emergency detach 不关闭用户 Chrome，Chrome 进程仍存活。

## 7. 自动测试回归

Browser Bridge `3.1.1`：

```text
npm run check            PASS
npm test                 246/246 PASS
npm run test:integration 8/8 spec files PASS
```

其中最新 1030 条仿真：

```text
completed: 1030
success:   1030
fail:      0
business duration: 7294 ms
```

Hana 插件 `0.2.1`：

```text
npm test                 17/17 PASS
npm run test:integration 2/2 PASS
```

发布包：

```text
dist/hana-browser-bridge-0.2.1.zip
dist/hana-browser-bridge-0.2.1.zip.sha256
bundled core: 3.1.1 / 85ee4961b378e30c79f1a588c5d2e189ce0c1291 / dirty=false
```

安装到 `~/.hanako/plugins/hana-browser-bridge` 并重启 HanaAgent 后，再次用已安装副本执行同一 Stage 2，全部 phase 通过，两个验收 tab 关闭，用户 Chrome 仍存活。

## 8. 阶段性状态（0.2.1，当时尚未完成）

在 `0.2.1` 阶段，同一 Chrome 进程复用了已经授予的授权状态，WebSocket 直接打开，没有再次显示 Allow/Deny 对话框；因此当时不能把 Deny 分支记为通过。后续结果见第 10 节。

Deny、Chrome restart/endpoint 变化、DevTools/其他 debugger 冲突通常需要新的授权周期或重启 Chrome。该阶段为避免破坏用户未保存工作，没有擅自重启或改变用户 Chrome 状态。

`0.2.1` 阶段仍待单独人工验收：

- 新授权周期下选择 Deny，并确认插件返回可区分的拒绝结果；
- 多个活动 Chrome Profile 时，记录 Chrome 实际选择的 Profile/窗口范围；
- 打开 DevTools 或其他 debugger 时的 attach 冲突与恢复；
- Chrome restart 后 endpoint generation 变化，旧 session/claim 全部失效；
- 用户真实业务页小批量只读/可撤销操作；生产数据导入仍须单独审批。

## 9. 阶段性结论（0.2.1）

`0.2.1` 已通过 Allow、显式启动、claim、multi-tab 隔离、后台 target 原生交互、SPA、detach/reattach、秘密最小化和非所有权关闭边界；当时 Deny、多 Profile、debugger conflict、Chrome restart 和真实业务页仍未完成。后续门禁收口见第 10 节。


## 10. 后续真实 Chrome 门禁收口

在演进到 Browser Bridge `3.1.3` / Hana 插件 `0.2.3` 的过程中补充了以下真实 Chrome 历史门禁。它们证明底层行为曾被观察，但除第 12 节的单次 Allow 外，不应视为最终发布 zip 的逐项版本级复验：

- Deny 原始证据：`expected=deny`、`observed=deny`、`passed=true`、`responseClass=HTTP_403`；
- Allow 恢复通过，Stage 2 全部 phase 通过；
- Chrome 正常退出并重开后，旧 endpoint 不可达，新 endpoint fingerprint 改变；restart 前旧 claim 在新 generation 返回 `NO_SESSION`，没有隐式 reattach；
- Chrome 150 可能在正常退出后保留 stale `DevToolsActivePort` 文件，因此不再把“文件必须消失”作为 restart 硬门槛；
- DevTools-first 与 Hana-first 两种顺序均表现为 `COEXIST`，关闭 DevTools 后可恢复，detach 后不可访问，未出现跨 target 访问；
- emergency detach 始终 `browserStopped=false`，用户 Chrome 保持运行。

自动回归：

```text
Browser Bridge 3.1.3
npm run check             PASS
npm test                  258/258 PASS
npm run test:integration  8/8 spec files PASS
Phase 7                   1030/1030 PASS

Hana plugin 0.2.3
npm test                  27/27 PASS
npm run test:integration  2/2 PASS
```

## 11. 重复授权提示事故与修复

多 Profile 临时验收脚本曾每约 1.5 秒重新建立 Browser WebSocket。每次新握手都会触发 Chrome 的原生“允许远程调试”确认，因此用户连续看到十余次提示。根因是测试脚本的自动重试策略，不是 Chrome 要求同一连接连续确认十余次。脚本已停止，孤立 bridge 进程和验收页已清理，Chrome 未被强制关闭。

Hana 插件 `0.2.3` 增加以下硬门禁：

1. Browser Bridge `3.1.3` 在 `BB_DEFER_INITIAL_CONNECT=1` 时只启动 MCP，不预连接用户 Chrome；一次 reviewed `browser_bridge_start` 只放行一次后续初始 Browser WebSocket 尝试；
2. 第一次 Deny 或连接失败仍把原始结果返回给调用者，但立即设置安全 latch；
3. 同一轮后续业务工具直接返回 `BROWSER_CONNECT_REVIEW_REQUIRED`，不再调用底层 `client.callTool`；
4. 用户准备好处理提示后，重新 reviewed `browser_bridge_start` 才清除 latch，并只放行一次新尝试；
5. 并发初始调用使用单飞保护，不能同时产生多个授权提示；
6. shutdown 和 emergency detach 清除 latch；dedicated 模式不受影响；
7. 状态只暴露 `retryBlocked` 与 `retryBlockReason=consent-denied|connection-failed`，不保存或输出 endpoint、端口、session、Cookie 或原始 CDP 内容。

该阶段多 Profile 门禁仍未完成。后续最终补验改为复用同一持久 runtime，禁止定时断开重连；最终结果见第 21 节。

## 12. `0.2.3` 最终单次真实授权验证

2026-07-18 使用已安装副本的插件模块执行最终门禁。该调用直接进入插件模块，不是从 HanaAgent 对话 UI/Reviewer 发起。测试严格限制为：一次 reviewed start、一次只读 `browser_list_tabs`、零自动重试，响应仅记录安全计数，不输出标签页标题、URL、正文或 endpoint 信息。

```json
{"phase":"reviewed-start","ok":true,"mode":"existing-chrome","ownsBrowser":false,"toolCount":15}
{"phase":"before-tool","browserConnected":false,"retryBlocked":false}
{"phase":"single-tool","observed":"allow","ok":true,"tabCount":1,"browserConnected":true,"retryBlocked":false,"retryBlockReason":null}
{"phase":"cleanup","mcpStopped":true,"browserStopped":false}
```

结束后等待 5 秒复查：

```json
{"orphanBridgeProcesses":0,"chromeAlive":true,"tempScriptRemoved":true}
```

结论：MCP 启动阶段没有提前消费 Chrome 授权；唯一一次业务调用触发并完成 Allow；连接成功后 latch 未误触发；测试没有重试循环，清理后无孤立 bridge 进程，用户 Chrome 保持运行。**“单次 Allow 不重复弹框”这一最终真实 Chrome 门禁通过；该结论不自动覆盖 Deny、断线重连、Multi Profile 或 HanaAgent UI/Reviewer 宿主链路。**

## 13. 审查后的交付边界

### 13.1 已有充分证据

| 项目 | 证据级别 | 结论 |
|---|---|---|
| `0.2.3` 单次 Allow | 最终安装副本 + 真实 Chrome | 通过；一次 reviewed start、一次只读工具、零重试 |
| `0.2.3` Deny/latch/recovery | 最终安装副本 + 真实 Chrome | 通过；Deny 后 latch 生效，第二次调用不触发新提示，新的 reviewed start 后 Allow 恢复 |
| restart 后防隐式重连/latch | 最终安装副本 + 真实 Chrome restart | 通过；旧运行时只返回显式重连要求并在第二次调用本地熔断，不隐式重连 |
| 自动回归 | 最终源码/发布基线 | Hana 27/27 + 2/2；核心 258/258 + 8/8；Phase 7 1030/1030 |
| Deny/Allow、restart、DevTools、claim、多 tab 等 | 真实 Chrome 历史门禁 | 行为已观察，但部分证据早于最终 `0.2.3` 熔断/reconnect 改造 |
| 发布包 | 构建产物 | `hana-browser-bridge-0.2.3.zip` SHA256 为 `434dad05291a1db9809b292104a01e95fb5a560f6a95454b1026569bab8a8f9e`，内置核心 `3.1.3` / `ed0a2028e2fde57f0d7b25335d80d6011cf35b57` / `dirty=false` |

### 13.2 仍需补验

1. **真实业务页准入**：小批量、只读或可撤销、用户在场；在准入通过前不进行生产写入。

HanaAgent UI/Reviewer E2E、restart 后 reviewed reconnect、一般 Browser WebSocket close/latch 与 Multi Profile 实际可见范围已分别在第 18、19、20、21 节完成。真实业务页本轮未执行。

### 13.3 明确不在本验收范围

- Hana 自有 MV3 Extension + Native Host 的精确窗口/Profile/tab 授权；
- 上传、下载和更高层文件语义；
- Windows/Linux 真机兼容；
- 下载并导入 **2026-06-01 至 2026-07-18** 的真实追溯码。该生产任务尚未执行，且最终提交必须再次人工审批。

`1030/1030` 是隔离 fixture 的自动验收证据，不是生产追溯码下载或导入完成证明。


## 14. `0.2.3` 最终 Deny/recovery/reconnect 补验

### 14.1 Deny 与 latch

使用已安装 `0.2.3` 副本执行一次 reviewed start 和一次 `browser_list_tabs`，用户在唯一一次 Chrome 提示中选择 Deny：

```json
{"phase":"first-tool","observed":"deny","retryBlocked":true,"retryBlockReason":"consent-denied","browserConnected":false,"errorCode":null}
{"phase":"second-tool","blockedWithoutRetry":true,"errorCode":"BROWSER_CONNECT_REVIEW_REQUIRED","retryBlocked":true,"retryBlockReason":"consent-denied","browserConnected":false}
{"phase":"deny-latch-result","passed":true}
{"phase":"cleanup","mcpStopped":true,"browserStopped":false}
```

结论：首次 Deny 正确设置 latch；第二次业务调用没有到达底层连接，也没有产生第二个 Chrome 授权提示；清理没有关闭用户 Chrome。

### 14.2 reviewed Allow recovery

在用户明确准备后重新 reviewed start，并只调用一次 `browser_list_tabs`：

```json
{"phase":"allow-recovery","observed":"allow","passed":true,"tabCount":1,"browserConnected":true,"retryBlocked":false,"retryBlockReason":null,"errorCode":null}
{"phase":"cleanup","mcpStopped":true,"browserStopped":false}
```

结论：Deny 后的新 reviewed start 可以单次恢复；恢复成功后 latch 清除，用户 Chrome 仍不归插件所有。

### 14.3 Chrome restart 后不隐式重连与 latch

先建立成功连接，再由脚本通过正常退出流程重启 Chrome，不使用强制结束：

```json
{"phase":"connected","ok":true,"browserConnected":true,"ownsBrowser":false}
{"phase":"restart","chromeExitedNormally":true,"chromeReopened":true,"endpointChanged":true}
{"phase":"post-restart-first-tool","resultClass":"explicit-reconnect-required","retryBlocked":true,"retryBlockReason":"connection-failed","browserConnected":false}
{"phase":"post-restart-second-tool","resultClass":"review-required","retryBlocked":true,"retryBlockReason":"connection-failed","browserConnected":false}
{"phase":"reconnect-gate-result","passed":true}
{"phase":"cleanup","mcpStopped":true,"browserStopped":false}
```

结论：endpoint generation 改变后，旧运行时没有隐式建立新 Browser WebSocket；第一次调用返回显式重连要求，第二次调用被本地 review latch 拦截。用户 Chrome 正常重开且未被插件关闭。此阶段结果本身不证明 restart 后新的 reviewed start 已成功恢复，也不覆盖一般 socket close；后续恢复补验见第 19 节。

### 14.4 HanaAgent 宿主 E2E 尝试

HanaAgent 插件配置已持久化为：

```json
{"connectionMode":"existing-chrome","existingChromeChannel":"stable","existingChromeRequireExplicitStart":true,"toolProfile":"workflow"}
```

宿主对话能够读取并报告以下安全字段：

```text
mode=existing-chrome
ownsBrowser=false
toolCount=15
```

先后进行了三轮人工发起、每轮最多一次的 `browser_list_tabs`。三轮均未连接；最后一轮记录：

```text
tabCount=null
retryBlocked=true
browserConnected=false
browserStopped=false
```

各轮均没有自动 retry loop。最后一轮 stop 后 `browserStopped=false`；随后独立复查实际 Browser Bridge 子进程数为 0，用户 Chrome 仍存活。第 16 节已定位根因。**因此 `0.2.3` HanaAgent UI/Reviewer 完整 E2E 未通过；`0.2.4` 复验也未通过。**

## 16. HanaAgent 宿主失败根因与 `0.2.4` 修复

2026-07-18 对 HanaAgent 原始会话 JSONL 进行脱敏复盘。existing-chrome 的三轮失败均为：

```text
reviewed browser_bridge_start -> 约 0.2 秒返回 ok/connected
browser_list_tabs            -> 约 5 秒后返回 WebSocket connection failure
browser_bridge_stop          -> stopChrome=false
```

关键事实：

1. `browser_list_tabs` 已到达底层 MCP 并返回 Chrome WebSocket 错误；如果 HanaAgent 在每次工具调用间丢失模块级 runtime/latch，它会在本地提前返回 `BROWSER_CONNECT_REVIEW_REQUIRED`。因此“每个工具调用使用不同插件实例”不是本次根因。
2. `0.2.3` 的 `browser_bridge_start` 只完成 MCP stdio 启动，并设置下一次连接许可；它没有建立 Browser WebSocket，却返回含糊的 `connected=true`，宿主 Agent 因此错误报告 `browserConnected=true`。
3. 真正会触发 Chrome 原生授权的动作是随后执行的 `browser_list_tabs`。该只读工具没有 Reviewer 停顿，宿主会在 start 后立即调用；人工点击旧提示或在调用窗口外点击 Allow 不能保证当前 WebSocket 尝试成功。
4. 三轮内部均无自动 retry；失败后的 latch 与 `stopChrome=false` 正常工作。

`0.2.4` 开发候选修复：

- 内部 MCP stdio allowlist 增加 `browser_connect`，但不生成 HanaAgent adapter，不进入公共 15 工具列表；
- reviewed `browser_bridge_start` 在 MCP 启动后立即使用 guard 调用一次 connect-only 工具；Chrome 授权提示因此与 Reviewer action 对齐；
- start 直接返回真实 `mcpConnected`、`browserConnected`、`retryBlocked`、`retryBlockReason` 和安全 `errorCode`；失败结果标记为 tool error；
- `browser_list_tabs` 只复用已建立连接，不再承担初始授权；
- Deny/连接失败仍只消费一次尝试并设置 latch，没有 retry loop；stop/unload 仍不关闭用户 Chrome；
- 自动验证：`npm test` 28/28，`npm run test:integration` 2/2；临时 headless Chrome Auto Connect 替身证明 `start -> list -> stop` 复用同一连接，且公共工具输出保持 15 个、不包含 `browser_connect`。
- 发布候选：`hana-browser-bridge-0.2.4.zip`；SHA256 以同目录 `.sha256` 文件和最终交付记录为准。内置核心仍为 `3.1.3` / `ed0a2028e2fde57f0d7b25335d80d6011cf35b57` / `dirty=false`。

当前边界：`0.2.4` 已安装并完成一次失败复验；失败原因与后续 `0.2.5` 修复见第 17 节，宿主 E2E 仍未通过。

## 17. `0.2.4` 宿主复验与 `0.2.5` 人机窗口修复

安装 `0.2.4` 并重启 HanaAgent 后，仅发起一次 `browser_bridge_start`，没有调用 list、attach 或 stop，也没有自动重试。安全结果：

```text
connectionMode=existing-chrome
ownsBrowser=false
toolCount=15
mcpConnected=true
browserConnected=false
retryBlocked=true
retryBlockReason=connection-failed
errorCode=BROWSER_CONNECTION_FAILED
```

这次复验证明第 16 节的主修复已进入宿主：start 不再虚报浏览器已连接，且确实在 reviewed action 内发起 Chrome 连接。新的阻断来自核心 `_openWs` 固定 5 秒超时：start 失败后 Chrome 原生授权提示仍停留在屏幕，说明提示到达人机界面时，唯一一次 socket open 已结束。该过期提示已手工点击取消；没有点击 Allow、没有发起第二次 start，也没有 retry loop。

后续修复：

- Browser Bridge `3.1.4` 新增 `BB_BROWSER_CONNECT_TIMEOUT_MS`，仅控制单次 Browser WebSocket open 的等待时间，接受 1–120 秒，默认行为仍为 5 秒；
- Hana 插件 `0.2.5` 在 existing-chrome 子进程中固定传入 30000ms；仍然只有一个 reviewed start、一个 `browser_connect`、一个 WebSocket open；
- dedicated 模式不使用该扩展窗口；Deny/连接失败仍设置 latch，业务工具不能自动重连；
- 核心验证：259/259 单元测试、8/8 集成 spec、Phase 7 1030/1030；
- 插件验证：28/28 测试、2/2 集成测试；临时 headless Chrome 替身完成 `reviewed start -> list -> stop`，公共工具仍为 15 个且不包含内部 `browser_connect`。

当前边界：`0.2.5` 的真实 Chrome + HanaAgent 宿主复验已完成，结果见第 18 节。

## 18. `0.2.5` 最终 HanaAgent 宿主 E2E

2026-07-18 安装 `hana-browser-bridge 0.2.5`（内置 `browser-bridge 3.1.4`）并重启 HanaAgent。测试分两步人工发起，整个流程没有自动重试：

### 18.1 reviewed start

仅调用一次 `browser_bridge_start`。Chrome 原生提示出现后只点击一次 Allow。工具约 3.7 秒返回：

```text
connectionMode=existing-chrome
ownsBrowser=false
toolCount=15
mcpConnected=true
browserConnected=true
retryBlocked=false
retryBlockReason=null
errorCode=null
```

内部 `browser_connect` 未出现在 HanaAgent 公共工具列表或 start 输出中。没有调用业务工具，没有重复 Chrome 提示。

### 18.2 单次 list 与安全 stop

在同一 HanaAgent 进程和已建立 runtime 上，仅调用一次 `browser_list_tabs`；结果 `ok=true`、`tabCount=1`，未 attach，也未在验收报告中输出标题、URL 或正文。随后调用：

```text
browser_bridge_stop(stopChrome=false)
```

安全结果：

```text
retryBlocked=false
browserConnected=true   # stop 前的已连接事实
mcpStopped=true
browserStopped=false
```

独立复查：Browser Bridge 子进程数为 0；用户 Chrome 主进程仍存活；屏幕上没有残留远程调试授权提示。

结论：**HanaAgent UI/Reviewer 宿主链路已通过 `0.2.5` 的最小 E2E：一次 reviewed start、一次 Chrome Allow、一次 list、一次安全 stop，零自动重试、零重复提示、用户 Chrome 未关闭。**第 19 节另行证明 restart 后 reviewed recovery；当前仍不覆盖真实业务页准入；一般 Browser WebSocket close/latch 与 Multi Profile 结果见第 20、21 节。


## 19. Chrome restart 后 reviewed reconnect 恢复

2026-07-18 在已安装 `hana-browser-bridge 0.2.5` 上补验 restart 后的新 reviewed start。整个过程没有强制结束 Chrome，也没有定时重连或自动 retry loop。

### 19.1 正常 restart 与 generation 变化

先采集脱敏基线，然后通过 Chrome 正常退出流程关闭并重新打开 stable channel。结果：

```text
chromeExitedNormally=true
chromeReopened=true
beforeReachable=true
currentReachable=true
endpointChanged=true
```

只记录 generation fingerprint 是否改变，不记录原始端口或 Browser WebSocket endpoint。

### 19.2 reviewed recovery

第一次 reviewed reconnect 等待窗口结束后返回 `connection-failed`；Chrome 提示随后由用户点击一次 Allow。该失败尝试已经结束并完成清理，没有内部重试。收到用户明确的“已允许”确认后，人工发起一个新的 reviewed start；新尝试在无需第二次用户操作的情况下成功：

```text
connectionMode=existing-chrome
ownsBrowser=false
toolCount=15
mcpConnected=true
browserConnected=true
retryBlocked=false
retryBlockReason=null
errorCode=null
```

随后只调用一次 `browser_list_tabs`，结果 `ok=true`、`tabCount=1`；没有记录标题、URL 或正文。最后执行 `stopChrome=false` 清理：

```text
mcpStopped=true
browserStopped=false
```

结论：**Chrome 正常重启并产生新的 endpoint generation 后，用户授权与新的 reviewed start 可以恢复连接；后续单次只读调用成功，插件清理不关闭用户 Chrome。**两次 reviewed start 是两个彼此独立、由人工状态变化分隔的尝试，不是 retry loop；Chrome 授权只需要一次用户点击。一般 Browser WebSocket close/latch 的独立补验见第 20 节。


## 20. 一般 Browser WebSocket close/latch

2026-07-18 在真实 Chrome 与已安装 `hana-browser-bridge 0.2.5` 上补验非 restart 场景下的一般 Browser WebSocket 关闭。测试使用临时启动包装器，仅在验收进程收到单次本地信号时终止当前 Browser WebSocket；没有修改安装副本或生产源码，没有关闭远程调试监听，也没有重启或关闭用户 Chrome。

### 20.1 初始 reviewed start

用户对本轮唯一一次 Chrome 提示点击 Allow，连接成功：

```text
connectionMode=existing-chrome
ownsBrowser=false
toolCount=15
mcpConnected=true
browserConnected=true
retryBlocked=false
retryBlockReason=null
errorCode=null
```

### 20.2 单次 socket close 与首次检测

在同一持久 MCP runtime 内，只终止当前 Browser WebSocket。Chrome 主进程和远程调试 endpoint 均未重启。随后只调用一次 `browser_list_tabs`：

```text
detectedWithoutReconnect=true
resultIsError=true
browserConnected=false
retryBlocked=true
retryBlockReason=connection-failed
errorCode=BROWSER_CONNECTION_FAILED
```

该调用检测到 socket 已关闭，没有隐式建立新的 Browser WebSocket。

### 20.3 second-call latch 与清理

再次调用同一只读工具时，请求在插件本地被拦截：

```text
blockedWithoutReconnect=true
errorCode=BROWSER_CONNECT_REVIEW_REQUIRED
retryBlocked=true
retryBlockReason=connection-failed
automaticRetries=0
```

最后使用 `stopChrome=false` 清理：

```text
mcpStopped=true
browserStopped=false
```

独立复查：Browser Bridge 子进程数为 0，用户 Chrome 主进程仍存活。

结论：**非 restart 的 Browser WebSocket 异常关闭会在首次后续调用中被识别为 connection failure，并设置 review latch；第二次调用不会到达底层连接，也不会自动重连。**本轮只有一次初始 Allow、零自动重试，用户 Chrome 未重启或关闭。


## 21. Multi Profile 实际可见范围

2026-07-18 在真实 Chrome 的两个现有 Profile 中执行最终 Multi Profile 门禁。两个 Profile 分别打开一个由临时 `127.0.0.1` 服务提供的验收页；页面使用不同的随机 marker，不包含用户信息。测试不输出其他标签页的标题、URL 或正文，也不使用 `browserContextId` 推断 Profile 名称。

### 21.1 约束

- Hana 插件：`0.2.5`；Browser Bridge：`3.1.4`；
- 一个持久 MCP runtime；
- 一次 reviewed start；
- 用户只处理一次 Chrome Allow；
- 零定时重连、零自动 retry；
- 只 attach 已知的本地验收 target；
- 不重启或关闭用户 Chrome。

开始前通过 Chrome 本地窗口检查确认两个验收页都已打开。

### 21.2 实际观察

reviewed start 成功：

```text
connectionMode=existing-chrome
ownsBrowser=false
toolCount=15
mcpConnected=true
browserConnected=true
retryBlocked=false
retryBlockReason=null
errorCode=null
```

同一 runtime 中只执行一次 list，然后仅筛选已知 `127.0.0.1` fixture：

```text
listOk=true
fixtureTargetCount=1
accessibleFixtureCount=1
inaccessibleFixtureCount=0
markerASeen=true
markerBSeen=false
bothProfilesVisible=false
browserContextUsedForInference=false
automaticRetries=0
```

两个页面在连接前都存在，但 Auto Connect 只列出并访问了其中一个 marker；另一 Profile 的验收 target 没有以 access-denied 错误出现，而是完全不在可见 target 集合中。该结论只描述本次 Chrome 实际授权范围，不把 marker 或 target 映射推断成可泛化的 Profile 名称选择规则。

### 21.3 清理与结论

```text
mcpStopped=true
browserStopped=false
bridgeProcessesPresent=false
userChromeAlive=true
automaticRetries=0
```

临时 fixture 服务已停止，可见的 fixture 标签页已清理；复查未发现残留本地验收页。

结论：**现有 Chrome Auto Connect 在本次 Multi Profile 环境中只暴露一个授权 Profile 范围，不会自动汇总两个 Profile 的所有 target。**这满足“记录实际可见范围”的门禁，但不提供精确 Profile 选择能力。若业务必须明确选择 Profile、窗口或标签页，应进入 Hana 自有 MV3 Extension + Native Host 阶段，而不是扩大 Auto Connect 或 raw CDP 权限。


## 22. Gemini 公开网站 contenteditable 输入测试与 `0.2.6` 修复

2026-07-18 使用真实 Chrome 登录态打开 Gemini Web 页面，对公开网站富文本输入框执行可撤销输入测试。测试文本为非敏感的固定说明文字；没有按 Enter、没有点击发送，也没有创建对话。

### 22.1 `0.2.5` 首次实测

一次 reviewed start 成功后创建并 attach Gemini 测试标签页。插件定位到可见 contenteditable 输入框，使用 `browser_type_text` 输入固定文本，回读结果：

```text
pageOpened=true
inputFound=true
typeToolOk=true
exactMatch=true
characterCount=29
enterPressed=false
sendClicked=false
```

这证明真实公开网站上的 contenteditable 原生输入路径可用。但随后以 `value=''` 调用同一工具清空时：

```text
clearToolOk=false
inputEmpty=false
submitted=false
```

测试标签页随后被关闭；独立复查 Gemini 标签页数为 0，Browser Bridge 子进程数为 0，用户 Chrome 仍存活，因此没有留下草稿或提交内容。

### 22.2 根因

`clearField` 只对 input/textarea 使用 `select()` 或 `setSelectionRange()`；contenteditable 没有建立覆盖全部内容的 DOM Range。原生 Backspace 因此只作用于当前光标，兜底逻辑也只检查 `el.value`，没有清理 `textContent`。此外，对空字符串继续调用 `Input.insertText` 在 Chrome 中是 no-op，不应作为清空动作的一部分。

### 22.3 Core `3.1.5` / Hana `0.2.6` 修复

Core 提交 `edee8632853b21c08f15db23a0844721a593949e`：

- contenteditable 清空前使用 DOM Range 选中全部内容；
- 原生 Backspace 后增加 contenteditable `textContent` 与 input 事件兜底；
- `value=''` 改为 clear-only，不再调用空 payload 的 `Input.insertText`；
- fixture 新增 Gemini/Quill 类 contenteditable；
- 集成测试新增“输入非空文本后以空字符串清空”的回归用例。

自动验证：

```text
Core npm run check       PASS
Core unit                259/259 PASS
Core integration         8/8 spec files PASS
Phase 7                  1030/1030 PASS
Hana plugin unit         28/28 PASS
Hana plugin integration  2/2 PASS
```

发布候选为 `hana-browser-bridge 0.2.6`，内置 `browser-bridge 3.1.5`。随后已完成安装与真实 Gemini 复验，结果见 22.4。

### 22.4 `0.2.6` 安装后真实 Gemini 复验

将最终 `0.2.6` 发布包原子安装到 HanaAgent 插件目录，并保留 `0.2.5` 回滚副本。用户对新的 reviewed start 点击一次 Allow；随后在新建 Gemini 测试标签页中执行同一固定文本的输入与清空：

```text
pluginVersion=0.2.6
coreVersion=3.1.5
browserConnected=true
retryBlocked=false
inputTypeToolOk=true
inputExactMatch=true
inputCharacterCount=29
enterPressed=false
sendClicked=false
clearToolOk=true
inputEmpty=true
clearedCharacterCount=0
submitted=false
passed=true
```

最后关闭测试标签页并以 `stopChrome=false` 清理。独立复查：Gemini 标签页数为 0，Browser Bridge 临时进程数为 0，用户 Chrome 仍存活。

结论：**`hana-browser-bridge 0.2.6` + `browser-bridge 3.1.5` 已在真实 Gemini contenteditable 上完成“输入精确回读 → 不发送 → 空字符串清空 → 回读为空”的完整可撤销验收。**
