# Browser Bridge for HanaAgent

将 `browser-bridge` MCP 服务封装为 HanaAgent 原生插件。插件不是 Chrome Extension；它在 HanaAgent 的 full-access 插件进程中启动一个仅使用 stdio 的内部 MCP 客户端/服务端链路，并支持专用 Chrome 与用户已打开 Chrome 两种 CDP 连接模式。

## 架构

```text
HanaAgent Agent
  -> Hana plugin static tools
  -> internal MCP client (stdio)
  -> bundled browser-bridge MCP server
  -> connectionMode=dedicated
       -> Chrome CDP 127.0.0.1:19282
       -> dedicated Chrome profile
  -> connectionMode=existing-chrome
       -> DevToolsActivePort
       -> user-approved browser WebSocket
```

## 提供能力

- 原样代理经过 P0 验收的 15 个 `workflow` 工具。
- `browser_bridge_status/start/restart/stop` 四个维护工具。
- Browser Bridge 状态面板。
- `dedicated` 模式首次调用时可按配置懒启动专用 Chrome。
- `existing-chrome` 模式必须先通过 reviewed `browser_bridge_start` 显式连接，业务只读工具不能隐式触发用户 Chrome 授权。
- 一次 reviewed start 只放行一次初始 Browser WebSocket 尝试；Deny/连接失败后进入熔断，后续业务工具不会自动重连或重复触发 Chrome 授权框。
- `browser_emergency_detach` 可立即清空 MCP/CDP 会话和 target claim，且绝不关闭用户 Chrome。
- 内部 MCP 固定 stdio；REST 和 HTTP MCP 均关闭。
- CDP host 仅允许 `127.0.0.1`、`localhost` 或 `::1`。
- `dedicated` 模式拒绝使用日常 Google Chrome/Chromium profile 目录；`existing-chrome` 仅发现用户 Chrome，绝不负责启动或关闭它。
- 非只读工具声明为 `external_side_effect`，HanaAgent Auto 模式应进入 reviewer。


## 连接用户已打开的 Chrome

要求：

1. Chrome M144+；
2. 打开 `chrome://inspect/#remote-debugging` 并启用远程调试；
3. 在插件设置中选择 `connectionMode=existing-chrome`；
4. 根据需要选择 channel 或填写 User Data 目录；
5. 通过 Hana Reviewer 调用 `browser_bridge_start`；
6. 第一次业务工具真正建立 Browser WebSocket 时，在 Chrome 原生对话框中点击一次 Allow；
7. 使用 `browser_list_tabs -> browser_attach_tab` 后再执行工作流工具。

安全语义：

- `browser_bridge_status` 只检查本地 `DevToolsActivePort` 和端口状态，不建立 Browser WebSocket；
- existing 模式没有 reviewed start 时返回 `EXPLICIT_CONNECT_REQUIRED`；
- 若用户 Deny 或连接失败，同一授权轮次后续调用返回 `BROWSER_CONNECT_REVIEW_REQUIRED`，不会再次访问底层 `client.callTool`；用户准备好后重新 reviewed `browser_bridge_start`，才放行一次新尝试；
- 并发的初始业务调用使用单飞保护，只有一个调用可以触发 Chrome 授权框；
- stop/unload 只断开 MCP/CDP，不关闭用户 Chrome；
- 标签页列表不返回 `webSocketDebuggerUrl` 或 sessionId；
- 精确窗口/标签页授权将在后续 Hana 自有 Chrome 扩展中实现。

完整设计和事实核验见 `EXISTING_CHROME_REFACTOR_PLAN.md`。

## 开发

插件源码的维护位置固定为：

```text
HanacoPlugin/plugins/hana-browser-bridge
```

`browser-bridge` MCP 核心仍可保留在独立仓库。首次开发时通过以下任一方式指定其路径：

```bash
export BROWSER_BRIDGE_DIR=/absolute/path/to/browser-bridge
# 或
npm run prepare:dev -- --bridge-dir /absolute/path/to/browser-bridge
```

也可以创建不提交到 Git 的本地文件：

```json
// browser-bridge.source.json
{
  "bridgeDirectory": "/absolute/path/to/browser-bridge"
}
```

然后执行：

```bash
npm install
npm run prepare:dev
npm test
```

`prepare:dev` 做两件事：

1. 把当前 browser-bridge 运行时代码同步到 `vendor/browser-bridge`；
2. 从 browser-bridge 工具元数据重新生成 15 个 Hana tool adapter。

因此后续维护 MCP 时：

- MCP 核心修改仍在 `browser-bridge` 仓库的 `lib/`、`tools/` 和 `scripts/start-mcp-server-stdio.mjs`；
- Hana 插件包装、权限、面板、打包和发布代码只在本目录维护；
- 不要手工修改标记为 generated 的 15 个代理文件，运行 `npm run generate:tools` 重新生成；
- `vendor/browser-bridge` 是构建产物，不提交 Git。

## 打包

```bash
npm run pack:plugin -- --bridge-dir /absolute/path/to/browser-bridge
```

输出：

```text
dist/hana-browser-bridge-0.2.3.zip
dist/hana-browser-bridge-0.2.3.zip.sha256
```

发布包包含：

- Hana 插件 manifest、维护面板和工具代理；
- 固定提交的 browser-bridge MCP 运行时副本；
- 生产 Node dependencies；
- `BUNDLED_VERSION.json`，记录 browser-bridge 版本和 Git commit。

## 安装与迁移

1. HanaAgent 设置 -> 插件，开启“允许完全访问插件”。
2. 将发布 zip 拖入插件安装区，或选择该 zip。
3. 启用 `Browser Bridge for HanaAgent`。
4. 给目标助手启用插件工具。
5. 停用原来的 `browser-bridge-it` MCP connector，避免重复工具名。
6. 新建会话后调用 `browser_bridge_status`，再调用 `browser_bridge_start`。

插件安装成功后，不再需要单独维护 HanaAgent connector JSON。MCP 仍然保留在插件内部，便于协议测试、升级和回滚。

## 升级

1. 更新独立的 browser-bridge 主代码并完成原有单元/集成/Phase 7 验收。
2. 修改插件与 manifest 的版本号。
3. 执行 `npm run pack:plugin -- --bridge-dir /absolute/path/to/browser-bridge`。
4. 核对发布包 sha256 和 `vendor/browser-bridge/BUNDLED_VERSION.json`。
5. 在 HanaAgent 中安装新 zip；失败时使用上一版本 zip 回滚。

## 安全边界

- `dedicated` 模式不得把 `chromeProfileDir` 指向日常 Chrome profile。
- 不启用 REST/HTTP MCP。
- 不把 CDP 监听到 LAN 或公网地址。
- 不移除 browser-bridge 的点击安全护栏、危险 modal 取消逻辑或审计脱敏。
- existing Chrome 必须通过 reviewed explicit start，禁止只读业务工具隐式连接；授权探测和业务工具均禁止自动重试。
- 不记录 DevTools browser path、sessionId、Cookie、Authorization、输入明文或 CDP result。
- 真实业务页上线前仍需单独完成只读准入和人工确认。

## 当前交付边界（2026-07-18 审查更新）

### 已完成

| 项目 | 证据 |
|---|---|
| Hana 插件 `0.2.3` | `npm test` 27/27、`npm run test:integration` 2/2；已安装副本版本与发布包一致 |
| Browser Bridge 核心 `3.1.3` | `npm run check`、258/258 单元测试、8/8 集成 spec、Phase 7 1030/1030 全部通过 |
| 构建可追溯性 | 核心提交 `ed0a2028e2fde57f0d7b25335d80d6011cf35b57`，`BUNDLED_VERSION.json` 为 `dirty: false` |
| 最终版本单次 Allow | 已安装 `0.2.3` 副本完成一次 reviewed start + 一次只读 `browser_list_tabs`；只出现一次授权、零自动重试，清理后无孤立 bridge 进程且用户 Chrome 保持运行 |
| 最终版本 Deny/latch/recovery | 真实 Deny 后 `retryBlocked=true`、原因 `consent-denied`；第二次调用返回 `BROWSER_CONNECT_REVIEW_REQUIRED` 且无新提示；新的 reviewed start 后单次 Allow 恢复通过 |
| restart 后不隐式重连/latch | 已连接后正常重启 Chrome，endpoint generation 改变；旧运行时首次调用返回 `EXPLICIT_RECONNECT_REQUIRED`，第二次调用本地熔断，均未隐式重连，用户 Chrome 未被插件关闭 |
| 历史真实 Chrome 行为 | 已观察 restart generation、旧 claim `NO_SESSION`、两种 DevTools attach 顺序 `COEXIST`、后台原生点击、SPA、detach/reattach 和 emergency detach |

Chrome 150 正常退出后可能保留 stale `DevToolsActivePort` 文件；restart 的判定标准是旧 Chrome 主进程退出、旧 endpoint 不可达、新 endpoint fingerprint 改变，而不是要求该文件消失。

### 待完成的真实门禁

1. **restart 后 reviewed reconnect 恢复**：已证明旧运行时不会隐式重连，但尚未在同一 restart 场景中执行新的 reviewed start 并成功恢复，也未单独覆盖一般 socket close。
2. **HanaAgent 宿主级 E2E**：HanaAgent 全局配置已切换并持久化为 `existing-chrome`；宿主对话已确认 `mode=existing-chrome`、`ownsBrowser=false`、`toolCount=15`。先后进行了三轮人工发起、每轮最多一次的 `browser_list_tabs`，均未建立连接；最终安全状态为 `tabCount=null`、`retryBlocked=true`、`browserConnected=false`、`browserStopped=false`。没有自动 retry loop；失败原因尚未确定。
3. **Multi Profile**：仍需在同一持久 runtime、一次授权、零自动重试条件下，仅用本地验收页记录 Chrome 实际可见范围；不得根据 `browserContextId` 猜测 Profile 名称。
4. **真实业务页准入**：需先做小批量只读/可撤销验收和人工确认，不能用 1030 条隔离仿真替代。

剩余门禁均不得使用定时重连或 retry loop。本轮已执行 Deny/recovery、restart 防隐式重连和 HanaAgent 宿主尝试；宿主连续失败后已经停止，不再反复触发授权框。Multi Profile 与真实业务页本轮未执行。

### 明确延后

- 精确窗口/Profile/tab 授权：Hana 自有 MV3 Extension + Native Host（Phase 2）。
- 上传、下载及更高层文件语义（Phase 3）。
- Windows/Linux 的安装、发现和真机兼容验证。

### 不属于插件交付完成项

“下载 **2026-06-01 至 2026-07-18** 的最新追溯码并导入生产系统”是独立业务任务，尚未执行。它需要业务数据获取、真实页面准入和生产提交三次独立确认；任何最终提交都必须再次人工审批。`1030/1030` 只证明隔离 fixture 上的分批、续跑、弹窗取消和提交护栏，不代表生产导入完成。
