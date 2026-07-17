// Generated from browser-bridge/tools/browser_action.js. Do not edit manually.
import { executeProxyTool, SIDE_EFFECT_PERMISSION } from "../lib/tool-proxy.js";

export const name = "browser_action";
export const description = "页面交互: click(原生级+全局护栏) / hover / fill / type";
export const parameters = {
  "type": "object",
  "properties": {
    "targetId": {
      "type": "string",
      "description": "标签页 targetId"
    },
    "action": {
      "type": "string",
      "description": "click / hover / fill / type"
    },
    "selector": {
      "type": "string",
      "description": "CSS selector"
    },
    "value": {
      "type": "string",
      "description": "fill / type 的文本"
    },
    "fallback": {
      "type": "string",
      "description": "click 兜底模式: 'synthetic' 强制 DOM 合成点击（默认原生 CDP 点击）"
    },
    "waitAfterMs": {
      "type": "number",
      "description": "点击后等待毫秒（可选）"
    }
  },
  "required": [
    "targetId",
    "action",
    "selector"
  ],
  "additionalProperties": false
};
export const sessionPermission = SIDE_EFFECT_PERMISSION;
export async function execute(input, ctx) { return await executeProxyTool(name, input, ctx); }
