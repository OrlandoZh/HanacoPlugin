# Phase 1-D：1030 条追溯码隔离仿真验收记录

- 验收日期：2026-07-17
- 开始时间（UTC）：2026-07-17T20:58:02Z
- 结束时间（UTC）：2026-07-17T20:58:12Z
- Chrome：Google Chrome 150.0.7871.127
- connection mode：`dedicated`
- Profile：测试 harness 创建的临时 `bb-it-*` 隔离目录
- fixture path：`test/integration/fixtures/trace-page.html`（由 integration harness 提供）
- spec path：`test/integration/phase7-trace-1030.spec.js`
- run command：`node --test test/integration/phase7-trace-1030.spec.js`
- report path：`plugins/hana-browser-bridge/docs/PHASE1D_1030_ACCEPTANCE_2026-07-17.md`

## 结果

| 项 | 结果 |
|---|---:|
| completed | 1030 |
| success | 1030 |
| fail | 0 |
| Node test | 1/1 PASS |
| 总测试耗时 | 9377.96 ms |
| 业务端到端耗时 | 8434 ms |
| 注入超时窗口 | 1312 ms |

## 续跑证据

- 在前 800 条的大批导入阶段，fixture 在接收 400 条后丢弃后续输入并触发客户端 timeout。
- 第一次返回的 `resumeFrom` 被故意设计为大于页面实际计数。
- 第二次运行同时传入任务基线 `counterBefore=0` 和偏大的 `resumeFrom`；实现以页面实际计数 400 为准，从第 401 条继续。
- 最终顺序严格等于原始 1030 条数组，无重复、无遗漏。

## 安全回归

- 重复码 modal 自动选择取消，不点击“确认删除”。
- 普通危险提交按钮和含零宽字符的变体均被全局 deny guard 拦截。
- `submittedCount` 保持 0。
- teardown 后 modal 关闭，未残留 `bb-it-*` Chrome 进程。
- 测试输出未包含 Browser WebSocket path、sessionId、Cookie、Authorization、输入码明文或 CDP params/result。

## 边界

本记录只证明隔离临时 Chrome 的自动验收。在本记录生成时，真实用户 Chrome 的 Allow/Deny、多 Profile、DevTools 冲突、Chrome restart 和真实业务页只读准入仍需用户在场的人工验收，不得由自动测试替代；其中除真实业务页准入外，后续门禁结果已记录在 `REAL_CHROME_ACCEPTANCE_2026-07-18.md`。
