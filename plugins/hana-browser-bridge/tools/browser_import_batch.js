// Generated from browser-bridge/tools/browser_import_batch.js. Do not edit manually.
import { executeProxyTool, SIDE_EFFECT_PERMISSION } from "../lib/tool-proxy.js";

export const name = "browser_import_batch";
export const description = "批量导入追溯码：分批「清空→输入→Enter」，以页面计数优先续跑、超时返回准确进度、危险弹窗自动取消";
export const parameters = {
  "targetId": {
    "type": "string",
    "description": "标签页 targetId"
  },
  "selector": {
    "type": "string",
    "description": "追溯码输入框 CSS selector"
  },
  "codes": {
    "type": "array",
    "description": "要导入的追溯码数组"
  },
  "batchSize": {
    "type": "number",
    "description": "每批条数（默认 40，硬上限 100）"
  },
  "batchDelayMs": {
    "type": "number",
    "description": "批间延迟毫秒（默认 0）"
  },
  "resumeFrom": {
    "type": "number",
    "description": "续跑起始索引（上次返回的 resumeFrom）"
  },
  "counterBefore": {
    "type": "number",
    "description": "整次导入任务开始前的页面 total（启用\"以页面计数优先\"续跑）"
  },
  "timeoutMs": {
    "type": "number",
    "description": "整体超时毫秒（0=不限，默认 0）"
  }
};
export const sessionPermission = SIDE_EFFECT_PERMISSION;
export async function execute(input, ctx) { return await executeProxyTool(name, input, ctx); }
