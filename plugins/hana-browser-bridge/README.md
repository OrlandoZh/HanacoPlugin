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
6. 在 Chrome 原生对话框中点击 Allow；
7. 使用 `browser_list_tabs -> browser_attach_tab` 后再执行工作流工具。

安全语义：

- `browser_bridge_status` 只检查本地 `DevToolsActivePort` 和端口状态，不建立 Browser WebSocket；
- existing 模式没有 reviewed start 时返回 `EXPLICIT_CONNECT_REQUIRED`；
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
dist/hana-browser-bridge-0.2.1.zip
dist/hana-browser-bridge-0.2.1.zip.sha256
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
- existing Chrome 必须通过 reviewed explicit start，禁止只读业务工具隐式连接。
- 不记录 DevTools browser path、sessionId、Cookie、Authorization、输入明文或 CDP result。
- 真实业务页上线前仍需单独完成只读准入和人工确认。

## 当前改造验证状态（2026-07-18）

- Hana 插件 `0.2.1`：`npm test` 17/17，existing/dedicated 集成 2/2。
- Browser Bridge 核心 `3.1.1`：单元测试 246/246，集成 8/8 spec 文件，Phase 7 1030 条仿真通过。
- Auto Connect 隔离集成使用临时 Headless Chrome；真实 Chrome 已通过 Allow、显式启动、claim、多 tab、后台原生点击、SPA、detach/reattach 和 emergency detach 验收。
- 核心提交为 `85ee4961b378e30c79f1a588c5d2e189ce0c1291`，`BUNDLED_VERSION.json` 为 `dirty: false`；发布脚本继续拒绝 dirty 核心。
- Deny、多 Profile、debugger conflict、Chrome restart/endpoint 变化和真实业务页仍需单独人工验收，详见 `docs/REAL_CHROME_ACCEPTANCE_2026-07-18.md`。
