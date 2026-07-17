// Generated from browser-bridge/tools/browser_attach_tab.js. Do not edit manually.
import { executeProxyTool, SIDE_EFFECT_PERMISSION } from "../lib/tool-proxy.js";

export const name = "browser_attach_tab";
export const description = "接管一个标签页（attach 已有/新建 tab）：direct page WS 主路径 + browser-level 兜底，幂等";
export const parameters = {
  "type": "object",
  "properties": {
    "targetId": {
      "type": "string",
      "description": "目标标签页 targetId（来自 browser_list_tabs）"
    }
  },
  "required": [
    "targetId"
  ],
  "additionalProperties": false
};
export const sessionPermission = SIDE_EFFECT_PERMISSION;
export async function execute(input, ctx) { return await executeProxyTool(name, input, ctx); }
