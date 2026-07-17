// Generated from browser-bridge/tools/browser_dom.js. Do not edit manually.
import { executeProxyTool, SIDE_EFFECT_PERMISSION } from "../lib/tool-proxy.js";

export const name = "browser_dom";
export const description = "Document object model operations: querySelector, querySelectorAll";
export const parameters = {
  "targetId": {
    "type": "string",
    "description": "标签页 targetId"
  },
  "expression": {
    "type": "string",
    "description": "document.querySelector(...).textContent 等"
  }
};
export const sessionPermission = SIDE_EFFECT_PERMISSION;
export async function execute(input, ctx) { return await executeProxyTool(name, input, ctx); }
