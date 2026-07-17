// Generated from browser-bridge/tools/browser_new_tab.js. Do not edit manually.
import { executeProxyTool, SIDE_EFFECT_PERMISSION } from "../lib/tool-proxy.js";

export const name = "browser_new_tab";
export const description = "创建新标签页";
export const parameters = {
  "type": "object",
  "properties": {
    "url": {
      "type": "string"
    }
  },
  "required": [],
  "additionalProperties": false
};
export const sessionPermission = SIDE_EFFECT_PERMISSION;
export async function execute(input, ctx) { return await executeProxyTool(name, input, ctx); }
