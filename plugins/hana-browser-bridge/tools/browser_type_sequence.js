// Generated from browser-bridge/tools/browser_type_sequence.js. Do not edit manually.
import { executeProxyTool, SIDE_EFFECT_PERMISSION } from "../lib/tool-proxy.js";

export const name = "browser_type_sequence";
export const description = "批量顺序输入多条文本，每条「清空→输入→Enter」";
export const parameters = {
  "type": "object",
  "properties": {
    "targetId": {
      "type": "string",
      "description": "标签页 targetId"
    },
    "selector": {
      "type": "string",
      "description": "输入目标元素 CSS selector"
    },
    "texts": {
      "type": "array",
      "description": "要顺序输入的文本数组"
    },
    "batchSize": {
      "type": "number",
      "description": "每批条数（默认 40）"
    },
    "interItemDelayMs": {
      "type": "number",
      "description": "条目间延迟毫秒（默认 0）"
    },
    "timeoutMs": {
      "type": "number",
      "description": "整体超时毫秒（0=不限，默认 0）"
    },
    "verifyExpression": {
      "type": "string",
      "description": "每批结束执行的验证表达式（可选）"
    },
    "stopOnStall": {
      "type": "boolean",
      "description": "页面计数未增加时停止（默认 false）"
    }
  },
  "required": [
    "targetId",
    "selector",
    "texts"
  ],
  "additionalProperties": false
};
export const sessionPermission = SIDE_EFFECT_PERMISSION;
export async function execute(input, ctx) { return await executeProxyTool(name, input, ctx); }
