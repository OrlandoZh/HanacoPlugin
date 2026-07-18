# Page Agent 能力吸收说明

**状态**：Phase PA-1 已实现
**日期**：2026-07-18
**参考项目**：Alibaba Page Agent `v1.12.2`（事实检查提交 `da1db959558dcd49a6c489e76a23accfbda7b156`）

## 决策

Browser Bridge 只吸收 Page Agent 的确定性页面控制思想：

- 文本化、压缩的交互元素观察；
- 临时 element ref；
- accessible name / role / 状态提取；
- open Shadow DOM 与同源 iframe 遍历；
- Observe → Act → Verify；
- 富文本/contenteditable 输入与清空。

明确不吸收：

- `@page-agent/llms`；
- PageAgentCore 自主 LLM 循环；
- `@page-agent/mcp` 的 `execute_task` 黑盒；
- Page Agent Side Panel、Launcher/Hub、localhost HTTP/WS；
- `<all_urls>` 与页面 localStorage token 授权方案；
- 第二套浏览器 Agent。

HanaAgent 仍是唯一规划者。Browser Bridge 只执行单步、可审计的确定性动作。

## 公开接口

为保持 workflow profile 固定为 15 个工具，本阶段不新增 MCP 工具名，而扩展现有工具：

### `browser_dom`

- `mode=expression`：保持原行为；
- `mode=observe`：返回有界交互元素列表与临时 opaque `ref`；
- `mode=verify`：使用 `ref` 执行结构化断言。

### `browser_action`

- 保持 CSS `selector` 路径兼容；
- 新增 `ref` 路径；
- ref 动作支持 `click / hover / focus / input / clear`；
- click 继续经过全局 deny guard；
- input/verify 不在结果中回显输入明文。

## 安全边界

- ref 只在 Browser Bridge 进程内映射到 locator；MCP 只得到随机 opaque ref；
- 每次新 observe 替换旧 ref；默认 120 秒过期；跨 target 不可复用；
- navigate/detach/close/disconnect 清理相关 ref；
- observe 不返回 input value、页面 URL、标题或完整正文；
-敏感字段只返回 `[sensitive field]`，禁止 exact/contains 回读；
-标签最长 120 字符，默认最多 80 个元素，硬上限 200；
-跨域 iframe 不穿透；closed Shadow Root 不穿透；
-不提供自然语言 `execute_task`，不调用任何 LLM API。

## 代码位置

```text
vendor/browser-bridge/lib/page-agent/element-store.js
vendor/browser-bridge/lib/page-agent/runtime.js
vendor/browser-bridge/lib/page-agent/controller.js
tools/browser_dom.js（生成的 Hana adapter）
tools/browser_action.js（生成的 Hana adapter）
```

## 验收

自动验收覆盖：

- opaque ref 与替换/跨 target 隔离；
- 标签和元素数量边界；
- textarea input / exact verify；
- contenteditable input / clear / empty verify；
-危险按钮 ref click 仍被 `DENY_POLICY_BLOCKED`；
-open Shadow DOM 输入与验证；
-同源 iframe 输入与验证；
-工具响应不回显输入明文；
-旧 selector 工作流和 1030 条仿真保持兼容。

## 上游参考

- https://github.com/alibaba/page-agent
- https://github.com/alibaba/page-agent/tree/main/packages/page-controller
- https://github.com/alibaba/page-agent/tree/main/packages/extension
- https://github.com/alibaba/page-agent/tree/main/packages/mcp

当前实现为针对 Browser Bridge 安全模型的独立重写，没有捆绑 Page Agent runtime、MCP、扩展或 LLM 依赖。
