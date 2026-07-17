// Generated from browser-bridge/tools/browser_navigate.js. Do not edit manually.
import { executeProxyTool, SIDE_EFFECT_PERMISSION } from "../lib/tool-proxy.js";

export const name = "browser_navigate";
export const description = "在指定标签页导航到 URL";
export const parameters = {
  "type": "object",
  "properties": {
    "targetId": {
      "type": "string",
      "description": "标签页 targetId"
    },
    "url": {
      "type": "string",
      "description": "目标 URL"
    }
  },
  "required": [
    "targetId",
    "url"
  ],
  "additionalProperties": false
};
export const sessionPermission = SIDE_EFFECT_PERMISSION;
export async function execute(input, ctx) { return await executeProxyTool(name, input, ctx); }
