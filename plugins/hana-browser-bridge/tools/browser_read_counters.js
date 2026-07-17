// Generated from browser-bridge/tools/browser_read_counters.js. Do not edit manually.
import { executeProxyTool, READ_ONLY_PERMISSION } from "../lib/tool-proxy.js";

export const name = "browser_read_counters";
export const description = "读取页面计数器 {total, success, fail}：优先 fixture 接口，否则解析可配置选择器文本";
export const parameters = {
  "type": "object",
  "properties": {
    "targetId": {
      "type": "string",
      "description": "标签页 targetId"
    },
    "selectors": {
      "type": "array",
      "description": "可选：自定义计数器选择器列表（覆盖 BB_COUNTER_SELECTORS）"
    }
  },
  "required": [
    "targetId"
  ],
  "additionalProperties": false
};
export const sessionPermission = READ_ONLY_PERMISSION;
export async function execute(input, ctx) { return await executeProxyTool(name, input, ctx); }
