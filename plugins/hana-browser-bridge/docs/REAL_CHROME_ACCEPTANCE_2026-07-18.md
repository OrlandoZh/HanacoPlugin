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

多 Profile 门禁仍未完成。后续只能复用同一持久 runtime，禁止定时断开重连；若第一次提示没有及时处理，任务必须停止，等待用户再次明确准备后才能发起下一轮。

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

1. **restart 后 reviewed reconnect 恢复**：当前只证明旧运行时不隐式重连和第二次调用 latch；尚未在 restart 后重新 reviewed start 并成功恢复，也未单独覆盖一般 socket close。
2. **HanaAgent UI/Reviewer E2E**：全局配置已通过 HanaAgent 配置接口持久化为 `existing-chrome`，宿主对话确认 `mode=existing-chrome`、`ownsBrowser=false`、`toolCount=15`。先后进行了三轮人工发起、每轮最多一次的 `browser_list_tabs`，均未连接；最终安全结果为 `tabCount=null`、`retryBlocked=true`、`browserConnected=false`、`browserStopped=false`。不存在自动 retry loop，失败原因尚未确定。
3. **Multi Profile**：只在本地验收页上记录实际可见范围；同一持久 runtime、一次授权、零自动重试，不根据 `browserContextId` 推断 Profile 名称。
4. **真实业务页准入**：小批量、只读或可撤销、用户在场；在准入通过前不进行生产写入。

本轮已执行 Deny/recovery、restart 防隐式重连和 HanaAgent 宿主尝试；宿主连续失败后已经停止。Multi Profile 与真实业务页本轮未执行。

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

结论：endpoint generation 改变后，旧运行时没有隐式建立新 Browser WebSocket；第一次调用返回显式重连要求，第二次调用被本地 review latch 拦截。用户 Chrome 正常重开且未被插件关闭。此结果不证明 restart 后新的 reviewed start 已成功恢复，也不覆盖一般 socket close。

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

各轮均没有自动 retry loop。最后一轮 stop 后 `browserStopped=false`；随后独立复查实际 Browser Bridge 子进程数为 0，用户 Chrome 仍存活。失败原因尚未确定。**因此 HanaAgent UI/Reviewer 完整 E2E 仍未通过，不能与模块级真实 Chrome 门禁合并宣称完成。**
