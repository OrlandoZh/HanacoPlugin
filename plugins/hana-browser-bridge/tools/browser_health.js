// Generated from browser-bridge/tools/browser_health.js. Do not edit manually.
import { executeProxyTool, READ_ONLY_PERMISSION } from "../lib/tool-proxy.js";

export const name = "browser_health";
export const description = "检查 Chrome CDP 连接 + 列 tabs";
export const parameters = {
  "type": "object",
  "properties": {},
  "required": [],
  "additionalProperties": false
};
export const sessionPermission = READ_ONLY_PERMISSION;
export async function execute(input, ctx) { return await executeProxyTool(name, input, ctx); }
