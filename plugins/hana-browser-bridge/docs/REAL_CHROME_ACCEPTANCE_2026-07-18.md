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

在 Browser Bridge `3.1.3`（commit `ed0a2028e2fde57f0d7b25335d80d6011cf35b57`）和 Hana 插件 `0.2.3` 上补充完成：

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
