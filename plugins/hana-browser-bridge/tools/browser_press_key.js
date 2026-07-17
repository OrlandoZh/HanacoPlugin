// Generated from browser-bridge/tools/browser_press_key.js. Do not edit manually.
import { executeProxyTool, SIDE_EFFECT_PERMISSION } from "../lib/tool-proxy.js";

export const name = "browser_press_key";
export const description = "按单个键（原生级；Enter 发完整 keyDown/char/keyUp 序列以触发 submit 与 onKeyDown）";
export const parameters = {
  "type": "object",
  "properties": {
    "targetId": {
      "type": "string",
      "description": "标签页 targetId"
    },
    "key": {
      "type": "string",
      "description": "Enter/Tab/Escape/Backspace/ArrowUp/... 或单字符"
    },
    "modifier": {
      "type": "string",
      "description": "ctrl/alt/shift/meta（逗号分隔，可选）"
    }
  },
  "required": [
    "targetId",
    "key"
  ],
  "additionalProperties": false
};
export const sessionPermission = SIDE_EFFECT_PERMISSION;
export async function execute(input, ctx) { return await executeProxyTool(name, input, ctx); }
