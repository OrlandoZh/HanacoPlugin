# Hana Browser Bridge：真实 Chrome 人工门禁操作手册与状态

- 日期：2026-07-18
- 当前平台：macOS
- Hana 插件：`hana-browser-bridge 0.2.3`
- Browser Bridge：`browser-bridge 3.1.3`
- 适用范围：`existing-chrome` 的 Deny、Chrome restart/reconnect、HanaAgent UI/Reviewer、Multi Profile、debugger conflict

## 1. 安全规则

执行本手册时必须满足：

1. 用户先保存 Chrome 中的表单、编辑器、下载任务和其他未完成工作。
2. 只对脚本创建的 `127.0.0.1` 验收页执行写操作。
3. 不 attach、不读取、不截图用户现有标签页。
4. 输出中不得出现：
   - `DevToolsActivePort` 第二行 browser path；
   - 原始调试端口；
   - `webSocketDebuggerUrl`；
   - `sessionId`；
   - Cookie、Authorization、输入正文；
   - 用户标签页标题、URL 或页面正文。
5. restart 前必须执行 `browser_emergency_detach`。
6. existing Chrome 永远不由插件 kill/close；Chrome restart 必须由用户或明确的人工步骤执行。
7. 任一阶段失败即停止，不自动重试授权探测或业务操作；不得使用定时器循环重建 Browser WebSocket。
8. 一次 reviewed `browser_bridge_start` 只对应一次初始 Browser WebSocket 尝试；若未及时处理 Chrome 提示或用户选择 Deny，等待用户明确准备好后再进行下一次 reviewed start。

## 2. 辅助脚本

脚本位置：

```text
scripts/real-chrome-manual-gates.mjs
```

该脚本只提供：

- endpoint 脱敏快照；
- restart 前后 generation fingerprint 比较；
- Allow/Deny 授权探测。

它不会：

- 重启或关闭 Chrome；
- 枚举用户标签页；
- attach target；
- 输出 endpoint、端口或 session secret。

### 2.1 采集 restart 前基线

```bash
node scripts/real-chrome-manual-gates.mjs snapshot \
  --output /tmp/hana-existing-chrome-before-restart.json
```

预期：

```json
{
  "activePortPresent": true,
  "endpointValid": true,
  "endpointReachable": true,
  "endpointFingerprint": "<16 hex chars>"
}
```

快照文件权限应为 `0600`。fingerprint 是 endpoint 的单向截断 SHA-256，只用于判断 generation 是否变化。

## 3. Chrome restart / endpoint generation 门禁

> 状态：历史真实 Chrome generation/旧 claim 门禁已通过；最终 `0.2.3` 的“断线后不隐式重连、重新 reviewed start 才恢复”仍需按本节补验。整轮只能建立一次新连接，不得自动重试。

### 3.1 restart 前

1. 保存 Chrome 中全部工作。
2. HanaAgent 调用 reviewed `browser_emergency_detach`。
3. 保存任一已 claim 的测试 targetId，仅保留在内存；不得写入长期日志。
4. 执行第 2.1 节的基线命令。

### 3.2 restart

由用户正常退出 Chrome，再重新打开同一 Chrome channel。不要使用插件的 stop/restart 去关闭用户 Chrome。

重新打开后，在：

```text
chrome://inspect/#remote-debugging
```

确认远程调试开关状态，但不要把 browser endpoint 复制到日志。

### 3.3 generation 比较

```bash
node scripts/real-chrome-manual-gates.mjs compare \
  --before /tmp/hana-existing-chrome-before-restart.json
```

通过条件：

```json
{
  "beforeReachable": true,
  "currentReachable": true,
  "endpointChanged": true
}
```

若 `endpointChanged=false`，不得宣称 restart generation 门禁通过；检查是否实际上复用了旧 Chrome 进程。

### 3.4 旧 claim 失效

1. 不执行新的 `browser_attach_tab`。
2. 使用 restart 前保存的测试 targetId 调用只读 `browser_dom`。
3. 必须返回 `NO_SESSION`、`STALE_SESSION` 或 target not found。
4. 不得自动 reattach。

通过条件：旧 connection generation 的 session、pending request、listener 和 claim 均不可继续使用。

## 4. Deny 门禁

> 状态：真实 Chrome 曾观察到 Deny/HTTP 403，但最终 `0.2.3` 发布包的 latch、第二次调用不弹框和 reviewed recovery 尚未做版本级真机闭环。本节仍是待执行门禁。

Deny 必须在一个会显示新授权对话框的授权周期内执行。

```bash
node scripts/real-chrome-manual-gates.mjs probe --expect deny
```

Chrome 显示远程调试授权对话框时，用户选择“取消”或 Deny。命令只能执行一次；不得因未及时点击而由脚本自动重跑。

通过条件：

```json
{
  "expected": "deny",
  "observed": "deny",
  "passed": true
}
```

以下不能算 Deny 通过：

- 连接直接打开，说明 Chrome 复用了已有 Allow；
- authorization timeout；
- endpoint missing；
- 普通 TCP/网络故障。

插件层还应确认错误类别可与 endpoint missing、endpoint invalid、connection failure 区分，且错误文本不包含 endpoint secret。

## 5. Allow 恢复门禁

> 状态：最终 `0.2.3` 的单次 Allow 已通过；Deny 后的 reviewed recovery 仍需与第 4 节同轮闭环。

Deny 完成后，确认用户已准备处理下一次提示，再手工重新发起一次：

```bash
node scripts/real-chrome-manual-gates.mjs probe --expect allow
```

用户选择 Allow。

通过条件：

```json
{
  "expected": "allow",
  "observed": "allow",
  "passed": true
}
```

随后在 HanaAgent 中：

1. reviewed `browser_bridge_start`；
2. 确认 mode=`existing-chrome`；
3. 确认 ownsBrowser=`false`；
4. 确认工具数为 15；
5. 确认状态只显示 `auto-connect:available` 和 `configured/channel-default`。

## 6. DevTools / 其他 debugger 冲突

> 状态：真实 Chrome 的 DevTools-first 与 Hana-first 均已观察到 `COEXIST`。除非底层 attach/session 实现变化，否则不要求每个补丁版本重复执行。

只使用本地验收页：

1. 启动临时 `127.0.0.1` fixture。
2. 用 `browser_new_tab` 创建验收 tab，并自动 claim。
3. 在该 tab 上打开 DevTools；不得在用户业务 tab 上测试。
4. 分别测试：
   - DevTools 已打开时 attach；
   - Hana 已 attach 时再打开 DevTools；
   - 关闭 DevTools 后恢复；
   - detach 后 Hana 不再可操作。
5. 记录 Chrome 返回的错误类别，不记录完整 CDP params/result。

通过条件：

- 冲突有明确、脱敏、可恢复的错误；
- 不会误操作其他 target；
- 不会出现跨 session event/pending 串线；
- 关闭 DevTools 或重新 reviewed attach 后可恢复；
- 最终关闭验收 tab，用户 Chrome 保持运行。

## 7. 多 Profile 门禁

> 状态：未完成。旧临时脚本因定时重建连接导致重复授权提示，其结果无效且脚本已停用。只能使用同一持久 runtime、一次授权、零自动重试。

Auto Connect 不承诺按 Profile 名精确选择，因此只记录 Chrome 的实际行为：

1. 用户分别在两个 Chrome Profile 中打开同一个本地验收页。
2. 启动一个持久 Hana/browser-bridge runtime；整个门禁期间不得按固定间隔断开重连。
3. 两个页面使用不同的随机 marker，但不包含用户信息。
4. 仅执行一次 reviewed start 和一次初始工具调用；若授权失败立即停止。
5. 建立 Auto Connect 后，只列出 target 数量，不输出用户标签页标题或 URL。
6. 仅 attach 已知本地验收页 target。
7. 记录：
   - 能看到一个还是两个 Profile 的验收 target；
   - Chrome 实际选择的窗口/Profile 范围；
   - 未选中范围是否 access denied 或完全不可见。

不得根据 `browserContextId` 猜测 Chrome Profile 名称。

若业务需要精确 Profile/窗口授权，应进入计划中的 Hana 自有 MV3 extension + Native Host 阶段，而不是扩大 Auto Connect 权限。

## 8. 结果记录模板

```text
Chrome version:
Hana plugin version:
Browser Bridge version/commit:
Test start/end:

Restart:
- before reachable:
- after reachable:
- endpoint changed:
- old claim blocked:

Deny:
- dialog shown:
- observed:
- error class:
- secrets absent:

Allow recovery:
- reviewed start:
- tool count:
- ownsBrowser=false:
- status minimized:

Debugger conflict:
- conflict direction:
- error class:
- recovery:
- cross-target isolation:

Multi Profile:
- active profile count:
- visible acceptance target count:
- actual selected scope:

Cleanup:
- acceptance tabs closed:
- emergency detach:
- user Chrome alive:
```

## 9. 当前基线

2026-07-18 已完成一次非破坏性 restart 前基线采集：

```text
/tmp/hana-existing-chrome-before-restart.json
activePortPresent=true
endpointValid=true
endpointReachable=true
file mode=0600
```

fingerprint 仅保存在临时文件中，不写入仓库。

截至 2026-07-18，真实 Chrome 历史门禁已覆盖 restart generation、旧 claim、Deny/Allow 和 DevTools 共存；最终 `0.2.3` 已完成一次单次 Allow，不得将这些合并表述为“最终版本所有真实门禁完成”。Chrome 150 正常退出后可能保留 stale `DevToolsActivePort` 文件；restart 仍以旧主进程退出、旧 endpoint 不可达、新 fingerprint 改变为准。多 Profile 旧 retry-loop 结果无效，脚本已停止并清理，不得再次使用。

## 10. 审查后剩余门禁清单

按优先级执行；任何一项开始前都要先确认用户已准备处理**最多一次** Chrome 授权提示。

| 优先级 | 门禁 | 完成标准 |
|---|---|---|
| P0 | 最终 `0.2.3` Deny/latch/recovery | 一次 Deny；状态进入 `consent-denied`；第二次业务调用不触发提示；新的 reviewed start 后一次 Allow 恢复 |
| P0 | 最终 `0.2.3` 断线/reconnect | 已连接后 Chrome restart/socket close；业务工具不得隐式重连；重新 reviewed start 后才允许一次新握手；用户 Chrome 不由插件关闭 |
| P0 | HanaAgent UI/Reviewer E2E | HanaAgent 对话 -> Reviewer -> `browser_bridge_start` -> 一次只读工具 -> 一次 Allow；只记录安全状态，不记录 tab 内容 |
| P1 | Multi Profile | 两个本地验收页、同一 runtime、一次授权、零自动重试；记录 Chrome 实际可见范围，不推断 Profile 名称 |
| P1 | 真实业务页准入 | 小批量、只读/可撤销、用户在场；先证明定位和计数正确，不点击生产提交 |

### 10.1 HanaAgent UI/Reviewer E2E 最小步骤

1. 确认安装版本为 `0.2.3`，连接模式为 `existing-chrome`。
2. 从 HanaAgent 对话发起 `browser_bridge_start`，在 Reviewer 中人工批准。
3. 只发起一次 `browser_list_tabs`；Chrome 出现提示时只处理一次。
4. 仅记录 `mode=existing-chrome`、`ownsBrowser=false`、工具数、tab 数和安全 latch 状态，不记录标题、URL、正文或 endpoint。
5. 调用 stop/emergency detach，确认 `browserStopped=false`，用户 Chrome 保持运行。

### 10.2 生产业务边界

本手册不授权生产导入。下载并导入 **2026-06-01 至 2026-07-18** 的追溯码仍是独立业务任务：真实业务页准入通过后，下载、导入预览、最终提交必须分别确认；最终提交必须由用户再次人工审批。1030 条 fixture 验收不能替代该审批。

### 10.3 明确延后

- Hana 自有 MV3 Extension + Native Host 的精确窗口/Profile/tab 授权；
- 上传、下载和更高层文件语义；
- Windows/Linux 真机门禁。
