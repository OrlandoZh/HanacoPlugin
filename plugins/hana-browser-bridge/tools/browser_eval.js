// Generated from browser-bridge/tools/browser_eval.js. Do not edit manually.
import { executeProxyTool, SIDE_EFFECT_PERMISSION } from "../lib/tool-proxy.js";

export const name = "browser_eval";
export const description = "在指定标签页执行 JS 表达式";
export const parameters = {
  "type": "object",
  "properties": {
    "targetId": {
      "type": "string",
      "description": "标签页 targetId"
    },
    "expression": {
      "type": "string",
      "description": "JS 表达式"
    },
    "awaitPromise": {
      "type": "boolean",
      "description": "await Promise"
    }
  },
  "required": [
    "targetId",
    "expression"
  ],
  "additionalProperties": false
};
export const sessionPermission = SIDE_EFFECT_PERMISSION;
export async function execute(input, ctx) { return await executeProxyTool(name, input, ctx); }
