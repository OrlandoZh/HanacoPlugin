# Hana Browser Bridge：现有 Chrome 与人机协作改造方案

- 状态：P0-A 至 P1-C 已完成；P1-D 部分完成。最终 `0.2.3` 单次 Allow、Deny/latch/recovery、restart 后防隐式重连/latch 与自动回归已通过；`0.2.4` 已修复 HanaAgent reviewed start/list 授权时序，宿主复验证明语义生效但暴露 5 秒人机窗口不足；`0.2.5` + 核心 `3.1.4` 增加单次 30 秒窗口并完成 existing Chrome 门禁；`0.2.6` + 核心 `3.1.5` 修复 Gemini/Quill 类 contenteditable 空字符串清空，自动回归通过；真实业务页仍待门禁
- 日期：2026-07-18
- Hana 插件：当前已安装并通过 Gemini 公开网站复验 `0.2.6`；上一稳定版 `0.2.5`；历史基线 `0.2.3`；失败过渡版 `0.2.4`
- Browser Bridge 核心：`browser-bridge 3.1.5`
- 当前目标平台：HanaAgent / macOS
- 后续平台：Windows、Linux

## 1. 决策摘要

目标是在不破坏现有专用 Chrome 安全模式的前提下，让 HanaAgent 在用户明确授权后操作用户已经打开的 Chrome 标签页，并复用登录态、Cookie、SPA 状态和已安装扩展。

采用三种连接模式：

```text
dedicated        插件专用 Chrome，继续作为默认模式
existing-chrome  Chrome M144+ Auto Connect，连接用户当前 Chrome
extension        Hana 自有 MV3 扩展 + 自有 Native Host，精确窗口/标签页授权
```

关键决策：

1. 不依赖 Codex Desktop 私有桥接协议。
2. 不覆盖、代理或接管 `com.openai.codexextension`。
3. 不把原始 unrestricted CDP 暴露给 HanaAgent。
4. 保留当前 15 个 workflow 工具、Reviewer、点击硬门禁和审计。
5. `existing-chrome` 必须先通过 reviewed 管理操作显式连接；只读业务工具不得隐式触发用户 Chrome 授权；Deny/连接失败后必须熔断，禁止自动重试。
6. `browser_attach_tab` 在 Phase 1 同时承担 claim + attach；未 attach 的 target 不能执行写操作。
7. endpoint、transport 和 target session 实现在独立 `browser-bridge` 核心仓库，Hana 插件只负责配置、生命周期和 MCP 子进程编排。
8. 正式的精确授权能力最终采用 Hana 自有扩展，不复用官方 Codex 扩展。

## 2. 独立审查结论

本方案经过两个只读子 Agent 独立检查：

- 架构审查：对照 Hana 插件和 Browser Bridge 源码，检查连接层、session、事件、重连、安全与测试范围。
- 事实核验：只使用项目官方仓库、官方 README、固定提交源码和 Chrome 官方资料。

审查发现并已纳入本文：

1. 原方案将完整 `ConnectionRouter` 放在 Hana 插件进程，层级错误；真正的 CDP provider 必须位于 Browser Bridge MCP 子进程。
2. reviewed connect 和 target claim 必须进入 Auto Connect 首个可发布阶段，不能延后到 UI/扩展阶段。
3. flattened CDP session 必须按 `sessionId/targetId/generation` 隔离事件和 pending request。
4. 当前 CDP transport 调试日志可能输出 endpoint、sessionId 或页面结果，必须先脱敏。
5. Auto Connect 能看到的是连接的浏览器进程 target 范围，不能把 `browserContextId` 当作 Chrome Profile 名称。
6. `Target.getTargets` 和 `Target.attachToTarget(flatten=true)` 是 Hana 的实现选择，不是 Chrome DevTools MCP 对外保证的固定内部流程。
7. 测试基线必须区分 Hana 插件与独立 Browser Bridge 核心。

### 2.1 实施后收口审查

第二轮只读子 Agent 审查结论为 **P0 阻断 0 项**，并识别 3 项 P1。当前均已修复并补测试：

1. existing Chrome 每条新 Browser WebSocket 显式调用 `Target.setDiscoverTargets({discover:true})`，确保 target 生命周期事件可靠。
2. scoped listener 按 `targetId/sessionId/generation` 路由、去重并在 detach、target destroy、browser close 时清理；`browser_console_log` 和 `browser_fetch` 已改为 target-scoped listener。
3. 同 target 命令队列绑定 generation；旧连接中排队的命令不得在重连后的新浏览器连接上执行。
4. CDP 错误脱敏扩展到 Authorization、Proxy-Authorization、Cookie、Set-Cookie、Bearer、Basic、URL credentials/query/hash；页面 exception 输出也经过脱敏。

审查还确认 dedicated 默认模式、`/json/version`、`/json/list`、direct page WebSocket 和既有返回结构保持兼容。

## 3. 当前代码与基线

### 3.1 当前链路

```text
Hana workflow tool
  -> plugin/lib/mcp-client.js
  -> MCP stdio child process
  -> browser-bridge/tools/*
  -> browser-bridge/lib/cdp/*
  -> Chrome CDP
```

当前默认连接：

```text
127.0.0.1:19282
~/.hanako/browser-bridge/chrome-profile
```

当前 CDP endpoint 发现：

```text
/json/version -> browser WebSocket
/json/list    -> page targets
```

### 3.2 源码边界

Hana 插件源码：

```text
/Users/orlandozh/Documents/OH-WorkSpace/coding/projects/GitHub/HanacoPlugin/plugins/hana-browser-bridge
```

Browser Bridge 核心源码：

```text
/Users/orlandozh/Downloads/work/browser-bridge-dev/browser-bridge
```

插件中的：

```text
vendor/browser-bridge
```

是 `npm run sync:bridge` 生成的忽略构建产物，不能作为核心源码维护位置。

### 3.3 2026-07-17 改造前基线

Hana 插件：

```text
npm test                 9/9 PASS
npm run test:integration 1/1 PASS
HEAD                     aaf7d8f
```

Browser Bridge 核心：

```text
npm test                 223/223 PASS
HEAD                     c6a0509
```

1030 条业务仿真不属于两个仓库的 `npm test`；它位于 Browser Bridge 的 `npm run test:integration` 中，仍需单独记录 fixture、Chrome 版本、运行耗时和验收结果。

### 3.4 改造后验证结果与 2026-07-18 复核

Hana 插件 `0.2.3`：

```text
npm test                  27/27 PASS
npm run test:integration  2/2 PASS
git diff --check          PASS
```

Browser Bridge 核心 `3.1.5`：

```text
npm run check             PASS
npm test                  258/258 PASS
npm run test:integration  8/8 spec files PASS
Phase 7                   1030/1030 PASS
```

2026-07-18 复核再次运行以上自动测试并全部通过。Phase 7 本次复核的单个 spec 耗时约 8.9 秒、业务执行耗时约 8.1 秒；固定验收记录仍以 `docs/PHASE1D_1030_ACCEPTANCE_2026-07-17.md` 中保存的首次正式结果为准。

Auto Connect 隔离集成测试使用临时 User Data 目录和 `--remote-debugging-port=0` 启动临时 Headless Chrome，不读取、不连接、不操作用户真实 Chrome。已验证：

- `DevToolsActivePort` 发现和 Browser WebSocket 连接；
- `Target.setDiscoverTargets({discover:true})`；
- `Target.getTargets`、`Target.createTarget`、flattened attach；
- reviewed explicit start 门禁；
- existing 模式输出不含 `webSocketDebuggerUrl`、browser path、sessionId；
- MCP stop/unload 不关闭非插件拥有的 Chrome；
- dedicated 全量回归和 1030 条业务仿真保持通过。

核心当前提交为 `edee8632853b`，同步元数据为 `browser-bridge 3.1.5`、`dirty: false`。发布脚本继续默认拒绝打包 dirty 核心。

### 3.5 当前交付边界

| 分类 | 状态 | 说明 |
|---|---|---|
| P0-A 至 P1-C 代码与自动回归 | 完成 | 日志最小化、连接分层、ownership、explicit start、claim、emergency detach 均已落地并回归 |
| 最终 `0.2.3` 单次 Allow | 完成 | 已安装副本一次 reviewed start + 一次只读工具，零自动重试，用户 Chrome 未关闭 |
| 最终 `0.2.3` Deny/latch/recovery | 完成 | Deny 后进入 `consent-denied`；第二次调用本地返回 `BROWSER_CONNECT_REVIEW_REQUIRED` 且无新提示；新的 reviewed start 后单次 Allow 恢复 |
| restart 后防隐式重连/latch | 完成 | 正常重启 Chrome 后 endpoint 改变；旧运行时返回 `EXPLICIT_RECONNECT_REQUIRED`，第二次调用进入 review-required，绝不隐式握手 |
| restart 后 reviewed reconnect 恢复 | 完成 | Chrome 正常退出并重开，endpoint generation 改变；用户单次 Allow 后新的 reviewed start 成功，单次 list 成功，stopChrome=false |
| 一般 Browser WebSocket close/latch | 完成 | 不重启 Chrome，只关闭当前 Browser WebSocket；首次调用检测断开并设置 `connection-failed`，第二次调用本地返回 `BROWSER_CONNECT_REVIEW_REQUIRED`；零自动重试 |
| restart、DevTools 等其他真实行为 | 历史门禁完成 | 已在真实 Chrome 观察 generation、旧 claim、两种 DevTools 顺序、多 tab、后台点击、SPA 和 detach/reattach |
| Multi Profile | 完成 | 两个 Profile 各打开一个本地随机 marker 页；同一持久 runtime、一次 Allow、零自动重试。Auto Connect 只看到其中一个验收 target，另一 Profile target 完全不可见；不按 `browserContextId` 推断 Profile |
| HanaAgent UI/Reviewer 完整链路 | 完成 | `0.2.5` 单次 reviewed start 返回真实 connected 状态；一次 Chrome Allow；单次 list 成功；stopChrome=false；无重复提示，用户 Chrome 未关闭 |
| 真实业务页 | 未完成 | 只允许先做小批量只读/可撤销准入；不得用 fixture 结果替代 |
| 生产追溯码下载与导入 | 不属于本轮插件交付 | 2026-06-01 至 2026-07-18 的生产业务任务尚未执行，最终提交需独立人工审批 |
| Phase 2 / Phase 3 | 延后 | Hana MV3 Extension + Native Host、上传/下载及更高层文件语义 |

本轮已经执行 Deny/recovery、restart 防隐式重连、HanaAgent `0.2.5` 宿主最小 E2E、restart 后 reviewed reconnect 恢复、一般 Browser WebSocket close/latch，以及 Multi Profile 实际可见范围；上述链路均已完成。剩余门禁必须按 `docs/REAL_CHROME_MANUAL_GATES_RUNBOOK.md` 逐项、单次执行，禁止 retry loop。

## 4. 外部事实核验

核验固定版本：

| 项目 | 提交/版本 | 结论 |
|---|---|---|
| `ChromeDevTools/chrome-devtools-mcp` | `76fd242` / `1.6.0` | Auto Connect 参考 |
| `DeliciousBuding/codex-browser-bridge` | `b939ce3` / `1.10.1` | Windows 私有桥参考 |
| `iola1999/codex-control-chrome-mcp` | `c701215` / `1.4.1` | Codex Host 代理参考，不采用 |
| `iFurySt/open-browser-use` | `07a8014` / `0.1.41` | 独立扩展/Host 参考 |
| `koltyakov/browser-bridge` | `3f6d752` / `1.7.6` | 窗口授权模型参考 |

### 4.1 Chrome DevTools MCP Auto Connect

准确事实：

- `--autoConnect` 从 `chrome-devtools-mcp v0.12.0` 开始提供。
- 最低浏览器要求是 Chrome M144。
- 用户需在 `chrome://inspect/#remote-debugging` 启用远程调试。
- 连接时 Chrome 显示原生 Allow/Deny 授权对话框。
- 默认 channel 是 stable。
- 显式提供 `userDataDir` 时，源码读取 `DevToolsActivePort`：
  - 第一行端口；
  - 第二行 browser WebSocket path；
  - 构造 `ws://127.0.0.1:{port}{path}`；
  - 调用 `puppeteer.connect()`。
- 仅提供 channel 时，endpoint 发现委托给 Puppeteer。
- 多个活动 Profile 时，由 Chrome 选择默认 Profile；连接方可见该 Profile 的全部打开窗口。

Hana 自己选择：

```text
Target.getTargets
Target.attachToTarget({ flatten: true })
```

作为 browser-level WebSocket 下的 target discovery/attach 策略。它是 Hana Provider 的实现，不应描述成 Chrome DevTools MCP 的公开保证。

`CONSENT_REQUIRED` 是 Hana 内部错误码，不是 Chrome/CDP 标准错误。

证据：

- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/76fd2424984827802867672fcc8d0e0036f4a3af/README.md
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/76fd2424984827802867672fcc8d0e0036f4a3af/src/browser.ts
- https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/76fd2424984827802867672fcc8d0e0036f4a3af/CHANGELOG.md

### 4.2 `DeliciousBuding/codex-browser-bridge`

准确事实：

- 主实现为 Rust。
- 原生运行程序是单个 Windows 可执行文件；npm 包还包含 launcher、安装脚本、示例和 skill。
- 当前注册 52 个 MCP 工具。
- profile 数量：basic 34、network 51、full 52。
- 运行时通过 Windows named pipe `\\.\pipe\codex-browser-use-*` 连接 Codex browser-use backend。
- pipe 协议为 4-byte little-endian length + JSON-RPC。
- 非 Windows library 可编译并运行 mock 测试，但真实 discovery/dial 返回 Windows-only 错误。
- 对 Codex Desktop 私有行为有强耦合。

借鉴：重连、pending 清理、事件分发、工具 profile、doctor。

不采用：Windows pipe discovery、Codex 私有运行时依赖、52 工具面。

### 4.3 `iola1999/codex-control-chrome-mcp`

准确事实：

- Node.js 20+，当前精确注册 16 个 MCP 工具。
- 复用 Codex Chrome Extension ID `hehggadaopoacecdllhhajmbjkdcmajg`。
- 固定 Host 名称 `com.openai.codexextension`。
- macOS 为主要测试平台，Linux experimental，Windows unsupported。
- 安装器会备份并替换现有同名 manifest。
- 默认 proxy 模式在发现原官方 Host 时将其作为子进程代理；官方 Host 不存在时也可直接服务扩展。
- 同一个 Native Host 名称不能真正由两个 manifest 并存。

当前机器本地事实：

```text
Codex Chrome Extension version: 1.1.5
Installed profiles: Default, Profile 1
Official com.openai.codexextension manifest: present
```

借鉴：framing、Unix socket、request multiplexing、attach verify/retry、安装恢复检查。

禁止：覆盖或代理官方 Codex Host、依赖官方扩展 ID、依赖私有 RPC。

### 4.4 `iFurySt/open-browser-use`

准确事实：

- 规范仓库名是 `iFurySt/open-browser-use`；旧 slug 会重定向。
- 独立 MV3 扩展 + Go Native Host/CLI/MCP + JS/Python/Go SDK。
- 自有 Host `com.ifuryst.open_browser_use.extension`。
- 支持 macOS、Linux、Windows。
- 包含 user tab claim、attach/detach、raw CDP、session tab group、download、file chooser、clipboard 和 CDP event。
- session 保存在 `chrome.storage.local`，可在 MV3 service worker 重启后恢复。
- CLI/MCP 支持 `--browser`、`--profile`，通过 socket 目录扫描和 `getInfo` 匹配 route。
- `active.json` 只是最近活动 socket 的 fast-path，不是按 Profile 键控的 registry。
- socket 与 active 文件使用当前用户权限，当前没有 client token/peer authentication。
- SDK 明确不内置 Codex 风格站点策略、allowlist 或用户审批流。

借鉴：自有扩展/Host、多浏览器/Profile socket discovery、claim/session、文件和下载流程。

不照搬：`<all_urls>` 宽权限、unrestricted raw CDP、缺少上层审批。

### 4.5 `koltyakov/browser-bridge` / BBX

准确事实：

- 用户必须显式启用一个 Chrome 窗口。
- 同一扩展实例一次只有一个 `enabledWindow`。
- 默认目标是已启用窗口的 active tab，也可显式指定同一窗口其他 tab。
- 其他窗口 target 会 access denied。
- session 绑定 tab 和 origin，跨 origin 不自动延续。
- 正式 manifest 使用 action + side panel，没有配置 `default_popup`。
- manifest 本身仍包含 `<all_urls>`、`debugger` 等高权限；“最小化”指运行时窗口/tab/origin scope，而非 manifest 权限最小。

借鉴：单窗口显式授权、badge/action/side panel、tab/origin scope、重连和紧急中止。

### 4.6 不纳入关键路径

以下名称缺少唯一 owner/repo、固定提交或能力证据：

```text
ClaudeX / Claudex
agent-webbridge
BrowserClaw
Glance / browserops
mcp-browser-server “34 tools”
open-claude-in-chrome
```

后续只有在具备：

```text
owner/repo
commit SHA 或 release tag
证据文件路径
工具数统计方法
```

后才纳入设计。

## 5. 目标架构

### 5.1 进程与职责

```text
HanaAgent tools
  -> Hana plugin orchestration
     - config
     - reviewed explicit start
     - Chrome ownership
     - MCP child lifecycle
  -> browser-bridge MCP child
     - EndpointProvider
     - CdpTransport
     - TargetSessionManager
     - workflow tools
     - security guards/audit
  -> Chrome
```

插件进程不能向 MCP 子进程传 JavaScript provider 对象。

### 5.2 Browser Bridge 核心分层

```ts
interface EndpointProvider {
  readonly mode: 'dedicated' | 'existing-chrome';
  readonly ownsBrowser: boolean;
  discover(): Promise<EndpointDescriptor>;
}

interface EndpointDescriptor {
  generationKey: string;
  browserWSEndpoint?: string;
  browserURL?: string;
}

interface TargetSummary {
  targetId: string;
  type: string;
  subtype?: string;
  title: string;
  url: string;
  attached: boolean;
  browserContextId?: string;
}
```

分层：

```text
EndpointProvider
  - HTTP endpoint provider
  - DevToolsActivePort provider

CdpTransport
  - browser WebSocket
  - command IDs
  - pending requests
  - event routing
  - connection generation

TargetSessionManager
  - Target.getTargets normalization
  - targetId -> session
  - sessionId -> targetId
  - attach/detach/drop
  - claim lifecycle
```

`browserWSEndpoint`、direct page WebSocket 和 sessionId 不进入工具输出。

### 5.3 连接状态机

```text
DISCONNECTED
DISCOVERING
CONSENT_PENDING
CONNECTED
DENIED
STALE_ENDPOINT
BROWSER_CLOSED
EXPLICITLY_STOPPED
```

规则：

- `DENIED` 和 `EXPLICITLY_STOPPED` 不自动重连。
- endpoint 变化时递增 generation，清空 session、pending 和 claim。
- 重连必须重新读取 `DevToolsActivePort`。
- Browser 崩溃采用 single-flight + 有界退避。
- 文件不存在、格式错误、端口失效和用户 Deny 必须是不同错误。
- `disconnect` 与 `closeBrowser` 分离。
- 只有 `ownsBrowser=true` 的 dedicated 模式可以关闭 Chrome。

### 5.4 flattened session 隔离

必须维护：

```text
targetId -> { sessionId, generation }
sessionId -> targetId
pending request -> { id, sessionId, targetId, generation }
listener -> { method, sessionId?, targetId?, generation }
```

必须处理：

```text
Target.attachedToTarget
Target.detachedFromTarget
Target.targetDestroyed
Target.targetInfoChanged
browser WebSocket close/error
```

stale session：

```text
dropSession(targetId)
  -> reject only matching pending requests
  -> Target.attachToTarget(flatten=true)
  -> retry once
```

## 6. 三种连接模式

### 6.1 `dedicated`

保留现有：

- 固定/配置 host 和 port。
- 专用 Profile 安全校验。
- 首个 workflow 工具可以隐式启动和连接。
- 插件拥有自己启动的 Chrome。
- stop/unload 可关闭插件拥有的 Chrome。

### 6.2 `existing-chrome`

流程：

```text
reviewed browser_bridge_start
  -> resolve Chrome channel/user-data-dir
  -> read DevToolsActivePort
  -> validate loopback port/path
  -> connect browser-level WebSocket
  -> user Allow/Deny
  -> Target.getTargets
  -> browser_list_tabs
  -> reviewed browser_attach_tab (claim + attach)
  -> workflow operations
```

安全规则：

- 只读业务工具不得隐式建立 existing Chrome 连接。
- 在显式 `browser_bridge_start` 前，workflow 工具返回 `EXPLICIT_CONNECT_REQUIRED`。
- `browser_list_tabs` 不输出 `webSocketDebuggerUrl` 或 sessionId。
- target 列表仅返回必要 title、URL、targetId；后续 extension 模式再做窗口级隐藏。
- `browser_attach_tab` 是 reviewed side-effect，作为 Phase 1 claim。
- claim 绑定 connection generation + targetId；browser 断开后全部失效。
- `browser_new_tab` 创建后原子 attach/claim。
- stop/unload 只能 disconnect，绝不关闭用户 Chrome。
- Auto Connect 不能保证 Default/Profile 1 精确隔离；需要精确范围时使用 extension 模式。

### 6.3 `extension`

后续实现：

```text
Hana plugin/MCP
  -> 0600 Unix socket + capability token
  -> com.hanaco.hana_browser_bridge
  -> Hana MV3 extension
  -> chrome.debugger
```

用户入口：

```text
[启用当前窗口]
[仅启用当前标签页]
[停止并断开]
```

安装扩展不等于授权。默认：

```text
enabled window = none
claimed tabs = empty
attached tabs = empty
```

## 7. 配置

```json
{
  "connectionMode": "dedicated",
  "existingChromeChannel": "stable",
  "existingChromeUserDataDir": "",
  "existingChromeRequireExplicitStart": true,
  "chromeProfileDir": "~/.hanako/browser-bridge/chrome-profile",
  "autoStartChrome": true
}
```

规则：

- `connectionMode`：`dedicated | existing-chrome`，extension 在后续版本加入。
- `dedicated` 才使用 `chromeProfileDir` 和 `autoStartChrome`。
- `existing-chrome` 不允许启动、关闭或 kill Chrome。
- 日常 Profile 只允许被 existing/extension 发现，不允许被 dedicated 启动。
- runtime key 必须包含 mode、channel、user-data-dir、host/port 和 tool profile。
- 子进程只接收 mode、channel/user-data-dir 或 host/port，不把 browser WebSocket path放进环境变量或日志。

## 8. 实施阶段

### Phase 0-A：日志安全

Browser Bridge 核心：

- 删除逐请求 SEND/recv body 日志。
- 不输出完整 WebSocket URL、sessionId、params、result 或页面正文。
- 错误只包含 `{mode, generation, method, resultCode, duration}`。
- 新增泄漏测试：`/devtools/browser/`、Cookie、Authorization、evaluate result 不得出现在 stderr。

### Phase 0-B：核心连接分层，dedicated 行为不变

核心源码：

```text
lib/cdp/endpoint.js                  new
lib/cdp/connection.js
lib/cdp/transport.js
lib/cdp/target.js
lib/cdp/send.js
```

先保持 HTTP `/json/version`、`/json/list`，完成 Endpoint/Transport/Session 分层并跑完 dedicated 回归。

### Phase 0-C：Hana 插件 mode 和 ownership

插件源码：

```text
manifest.json
lib/config.js
lib/mcp-client.js
lib/chrome-manager.js
lib/tool-proxy.js
index.js
routes/panel.js
tools/browser_bridge_*.js
test/*.js
```

目标：

- 新增 `connectionMode` 等配置。
- runtime key mode-aware。
- existing 模式只允许 reviewed explicit start。
- stop/unload ownership-aware。
- 文案不再固定写“专用 Chrome”。

### Phase 1-A：DevToolsActivePort Provider

核心新增：

```text
lib/cdp/devtools-active-port.js
```

测试：

- 文件不存在；
- 缺行；
- 非法端口；
- 非 `/devtools/browser/` path；
- 非 loopback endpoint；
- stale file/port；
- endpoint 不进入错误和日志。

### Phase 1-B：browser-level target/session

核心改造：

- 连接 direct browser WebSocket。
- `Target.getTargets` normalization。
- `Target.attachToTarget(flatten=true)`。
- 双向 session 映射。
- session-aware pending 和 listener。
- target/browser 生命周期事件。
- generation invalidation。
- stale 强制 drop + reattach。

### Phase 1-C：显式连接与 claim 门禁

- existing 模式 workflow 工具调用前检查 explicit start。
- `browser_list_tabs` 删除 transport endpoint 字段。
- `browser_attach_tab` 作为 claim + attach。
- `browser_new_tab` 创建后自动 claim。
- stop、restart、browser close 清空 claim。
- 增加 emergency disconnect 管理能力。

### Phase 1-D：真机与业务回归

覆盖：

- Chrome Allow/Deny。
- Chrome 未运行、remote debugging 未开启。
- 多 tab 并发事件隔离。
- tab close、SPA 导航、Chrome restart。
- DevTools/其他调试器冲突。
- stop/unload 不关闭用户 Chrome。
- 原生输入、modal、deny guard。
- 1030 条业务仿真。

### Phase 2：Hana 独立扩展与 Native Host

新增：

```text
extension/manifest.json
extension/background/*
extension/sidepanel/*
native-host/launcher.mjs
native-host/daemon.mjs
native-host/protocol.mjs
native-host/install.mjs
```

要求：

- MV3。
- 自有 stable extension id/key。
- Host：`com.hanaco.hana_browser_bridge`。
- `allowed_origins` 只包含 Hana 扩展。
- socket `0600`。
- capability token `0600`，不进日志、CLI 参数或 MCP 输出。
- 不开放 TCP/HTTP listener。
- 运行时窗口/tab/origin scope。

### Phase 3：文件上传/下载

扩展模式实现：

```text
Page.setInterceptFileChooserDialog
Page.fileChooserOpened
DOM.setFileInputFiles
chrome.downloads events
```

上传只允许 Workspace 或用户明确选择文件；下载只允许批准目录。

## 9. 工具面

保持 15 个 workflow 工具，不复制 52 工具或 unrestricted CDP：

```text
browser_action
browser_attach_tab
browser_detach_tab
browser_detect_modals
browser_dom
browser_eval
browser_health
browser_import_batch
browser_list_tabs
browser_navigate
browser_new_tab
browser_press_key
browser_read_counters
browser_type_sequence
browser_type_text
```

管理工具：

```text
browser_bridge_status
browser_bridge_start
browser_bridge_stop
browser_bridge_restart
browser_emergency_detach   implemented
```

`browser_eval` 继续受表达式策略和输出大小限制，不能演变成通用远程代码执行入口。

## 10. 审计与脱敏

允许记录：

```text
timestamp
connectionMode
connection generation
targetId hash
origin
tool name
action class
review result
result code
duration
```

禁止记录：

```text
DevToolsActivePort WebSocket path
webSocketDebuggerUrl
sessionId
Cookie
Authorization
Token
密码/验证码
输入明文
CDP params/result
完整页面正文
capability token
```

## 11. 测试与验收

### 11.1 自动测试

Hana 插件：

```text
npm test
npm run test:integration
```

Browser Bridge 核心：

```text
npm test
npm run test:integration
```

必须保证：

- dedicated 全回归；
- existing 模式未 explicit start 时不连接；
- mode/ownership/status 正确；
- endpoint 和页面数据不进日志；
- target/session/generation 隔离；
- stop/unload 不关闭用户 Chrome。

### 11.2 真机 Auto Connect

1. Chrome M144+。
2. `chrome://inspect/#remote-debugging` 开启。
3. Allow 和 Deny 分支。
4. 多活动 Profile 时记录实际由 Chrome 选择的结果，不假定可指定 Profile。
5. tab close、Chrome restart、endpoint 变化。
6. 多 tab 同名 CDP event 不串线。
7. 业务工具只有 attach target 后可写。

剩余真机门禁按以下手册执行：

```text
docs/REAL_CHROME_MANUAL_GATES_RUNBOOK.md
scripts/real-chrome-manual-gates.mjs
```

辅助脚本只输出 endpoint fingerprint 和健康状态，不输出端口、browser path、sessionId 或用户标签页内容，也不会自动重启 Chrome。

### 11.3 业务验收

1030 条仿真必须单独记录：

```text
fixture path
run command
Chrome version
connection mode
start/end time
completed/success/fail
resume point
log redaction result
report path
```

## 12. 发布阻断条件

以下任一成立不得发布：

- 需要覆盖 `com.openai.codexextension`。
- 修改或重打包 Codex 官方扩展。
- existing 模式由只读业务工具隐式连接，或 reviewed start 只授予令牌却不完成实际 Browser WebSocket 连接。
- 未 reviewed start 即可访问用户 Chrome。
- 未 attach/claim target 即可执行写操作。
- 输出 `webSocketDebuggerUrl`、browser path 或 sessionId。
- 暴露 unrestricted raw CDP MCP tool。
- existing/extension 模式关闭用户 Chrome。
- flattened event/pending request 跨 target 串线。
- endpoint 变化后旧 session/claim 仍有效。
- 日志包含 Cookie、Token、输入明文或 CDP result。
- debugger detach 后仍可操作页面。

## 13. 实施顺序

```text
P0-A 先修复日志泄漏
P0-B 核心 Endpoint/Transport/Session 分层，保持 dedicated
P0-C 插件 connectionMode + ownership + explicit start
P1-A DevToolsActivePort 解析与状态机
P1-B browser WebSocket + flattened session 隔离
P1-C claim + emergency disconnect + 输出最小化
P1-D Auto Connect 真机与 1030 条业务回归
P2   Hana 独立扩展 + Native Host
P3   上传、下载与更高层语义
```

当前结果：

- **P0-A 至 P1-C：完成。** 代码、自动测试、工具最小化、ownership、claim、emergency detach 和日志脱敏均已收口。
- **P1-D：部分完成，不能写成“全部完成”。** 临时 Chrome Auto Connect、dedicated 全回归、1030/1030 仿真，以及最终 `0.2.3` 的单次 Allow、Deny/latch/reviewed recovery、restart 后防隐式重连/latch 均已完成；真实 Chrome 历史门禁还覆盖旧 claim、DevTools 共存、多 tab、后台点击、SPA 和 detach/reattach。
- **P1-D 剩余门禁：** 真实业务页小批量只读/可撤销准入。restart 后新的 reviewed start、一般 Browser WebSocket close/latch 与 Multi Profile 实际可见范围均已完成。2026-07-18 对宿主 JSONL 的事实复盘已定位：`0.2.3` 的 reviewed start 仅启动 MCP，真正的 Chrome 连接延迟到 list，且 start 输出未提供真实 `browserConnected/retryBlocked`。`0.2.4` 已在 reviewed start 内使用不对 Hana 暴露的 `browser_connect` 完成单次连接，并保持公共工具数 15；宿主复验确认状态语义正确，但 5 秒固定 open timeout 先失败、提示后残留。`0.2.5` + 核心 `3.1.4` 通过 `BB_BROWSER_CONNECT_TIMEOUT_MS=30000` 给唯一一次 reviewed attempt 提供人机窗口，不增加重试；最终安装后的宿主复验已完成：单次 start 成功连接、单次 list 成功、stopChrome=false 清理成功。
- **P2、P3：延后。** 精确窗口/Profile/tab 授权、上传/下载和文件语义不属于当前 P0 交付。
- **生产任务：未执行。** 下载并导入 2026-06-01 至 2026-07-18 的追溯码不是插件自动验收的一部分，必须作为独立业务任务并在最终提交前再次获得人工审批。

真实 Chrome 记录见 `docs/REAL_CHROME_ACCEPTANCE_2026-07-18.md`，剩余门禁见 `docs/REAL_CHROME_MANUAL_GATES_RUNBOOK.md`。任何后续门禁都不得使用 retry loop，也不得由插件关闭用户 Chrome。
