# Page Agent 能力吸收说明

**状态**：Phase PA-1 已实现并完成安全复审整改
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

- MCP 只得到随机 opaque ref；Bridge 内部保存 observation/node identity 与 isolated execution context；真实 DOM 节点 registry 位于 CDP `Page.createIsolatedWorld`，页面主世界不可读写，且不把 nodeId/contextId 暴露给模型；
- 每次新 observe 替换旧 ref；默认 120 秒过期；跨 target/connection generation 不可复用；节点被删除、文档导航或 registry 被替换后立即 stale；
- navigate/detach/close/disconnect 清理相关 ref；
- observe 不返回 input value、页面 URL、标题或完整正文；
-敏感字段识别覆盖 password、OTP/PIN、安全码、银行卡 autocomplete、关联 label/accessibility name；只返回 `[sensitive field]`，禁止 exact/contains 值比较，不回传敏感字段长度；
-标签最长 120 字符，默认最多 80 个元素，硬上限 200；TreeWalker 扫描另有 12000 节点、750ms、iframe/shadow 深度硬预算；
-跨域 iframe 不穿透；closed Shadow Root 不穿透；selector/ref click 在 isolated world 内绑定节点并计算 accessible name/hit-test；对每一层 Shadow Root/iframe 检查遮挡，原语异常/null 或任一中间层不命中均 fail-closed；native selector click 在 mouseMoved 后还会复核一次再按下。
-不提供自然语言 `execute_task`，不调用任何 LLM API。

## 代码位置

```text
vendor/browser-bridge/lib/page-agent/element-store.js
vendor/browser-bridge/lib/page-agent/runtime.js
vendor/browser-bridge/lib/page-agent/controller.js
vendor/browser-bridge/lib/page-agent/isolated-world.js
tools/browser_dom.js（生成的 Hana adapter）
tools/browser_action.js（生成的 Hana adapter）
```

## 验收

自动验收覆盖：

- opaque ref 与替换/跨 target 隔离；
- 标签和元素数量边界；
- textarea input / exact verify；
- contenteditable input / clear / empty verify；
-危险按钮 ref click 仍被 `DENY_POLICY_BLOCKED`，包括 `aria-labelledby`、关联 `<label>` 与 Shadow DOM accessible name；
-open Shadow DOM 输入与验证；
-同源 iframe 输入与验证；
-工具响应不回显输入明文；
-同类型兄弟节点删除/重排后旧 ref 不会漂移到其他节点；
-银行卡 autocomplete、纯数字关联 label、敏感 verify oracle/长度泄露被阻断；
-两层同源 iframe 中间遮挡会返回 `ELEMENT_OCCLUDED`；页面主世界篡改 registry/`elementFromPoint` 不能绕过；
-selector native/synthetic/ref 三条点击路径均覆盖 `aria-labelledby` 与关联 label deny；
-旧 selector 工作流和 1030 条仿真保持兼容。

## 上游参考

- https://github.com/alibaba/page-agent
- https://github.com/alibaba/page-agent/tree/main/packages/page-controller
- https://github.com/alibaba/page-agent/tree/main/packages/extension
- https://github.com/alibaba/page-agent/tree/main/packages/mcp

当前实现为针对 Browser Bridge 安全模型的独立重写，没有捆绑 Page Agent runtime、MCP、扩展或 LLM 依赖。
