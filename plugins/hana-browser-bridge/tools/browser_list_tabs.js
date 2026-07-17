// Generated from browser-bridge/tools/browser_list_tabs.js. Do not edit manually.
import { executeProxyTool, READ_ONLY_PERMISSION } from "../lib/tool-proxy.js";

export const name = "browser_list_tabs";
export const description = "列出 Chrome 标签页（仅返回 type===\"page\"，过滤 iframe/background/扩展，V2 §7.2）";
export const parameters = {
  "type": "object",
  "properties": {},
  "required": [],
  "additionalProperties": false
};
export const sessionPermission = READ_ONLY_PERMISSION;
export async function execute(input, ctx) { return await executeProxyTool(name, input, ctx); }
