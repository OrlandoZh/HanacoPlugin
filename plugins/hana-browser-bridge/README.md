# Browser Bridge for HanaAgent

将 `browser-bridge` MCP 服务封装为 HanaAgent 原生插件。插件不是 Chrome Extension；它在 HanaAgent 的 full-access 插件进程中启动一个仅使用 stdio 的内部 MCP 客户端/服务端链路，并通过 CDP 控制专用 Chrome。

## 架构

```text
HanaAgent Agent
  -> Hana plugin static tools
  -> internal MCP client (stdio)
  -> bundled browser-bridge MCP server
  -> Chrome CDP 127.0.0.1:19282
  -> dedicated Chrome profile
```

## 提供能力

- 原样代理经过 P0 验收的 15 个 `workflow` 工具。
- `browser_bridge_status/start/restart/stop` 四个维护工具。
- Browser Bridge 状态面板。
- 首次调用时按配置懒启动专用 Chrome。
- 内部 MCP 固定 stdio；REST 和 HTTP MCP 均关闭。
- CDP host 仅允许 `127.0.0.1`、`localhost` 或 `::1`。
- 拒绝使用日常 Google Chrome/Chromium profile 目录。
- 非只读工具声明为 `external_side_effect`，HanaAgent Auto 模式应进入 reviewer。

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
npm run pack:plugin
```

输出：

```text
dist/hana-browser-bridge-0.1.0.zip
dist/hana-browser-bridge-0.1.0.zip.sha256
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
3. 执行 `npm run pack:plugin`。
4. 核对发布包 sha256 和 `vendor/browser-bridge/BUNDLED_VERSION.json`。
5. 在 HanaAgent 中安装新 zip；失败时使用上一版本 zip 回滚。

## 安全边界

- 不得把 `chromeProfileDir` 指向日常 Chrome profile。
- 不启用 REST/HTTP MCP。
- 不把 CDP 监听到 LAN 或公网地址。
- 不移除 browser-bridge 的点击安全护栏、危险 modal 取消逻辑或审计脱敏。
- 真实业务页上线前仍需单独完成只读准入和人工确认。
