// Generated from browser-bridge/tools/browser_detach_tab.js. Do not edit manually.
import { executeProxyTool, SIDE_EFFECT_PERMISSION } from "../lib/tool-proxy.js";

export const name = "browser_detach_tab";
export const description = "断开一个已接管标签页的会话（detach + 关闭 page WS）";
export const parameters = {
  "type": "object",
  "properties": {
    "targetId": {
      "type": "string",
      "description": "目标标签页 targetId"
    }
  },
  "required": [
    "targetId"
  ],
  "additionalProperties": false
};
export const sessionPermission = SIDE_EFFECT_PERMISSION;
export async function execute(input, ctx) { return await executeProxyTool(name, input, ctx); }
