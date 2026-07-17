// Generated from browser-bridge/tools/browser_type_text.js. Do not edit manually.
import { executeProxyTool, SIDE_EFFECT_PERMISSION } from "../lib/tool-proxy.js";

export const name = "browser_type_text";
export const description = "原生级输入文本（聚焦→清空→insertText→回读校验→逐键回退）";
export const parameters = {
  "targetId": {
    "type": "string",
    "description": "标签页 targetId"
  },
  "selector": {
    "type": "string",
    "description": "CSS selector（input/textarea/contentEditable）"
  },
  "value": {
    "type": "string",
    "description": "要输入的文本"
  },
  "clear": {
    "type": "boolean",
    "description": "输入前是否清空（默认 true）"
  },
  "clearModifier": {
    "type": "string",
    "description": "清空用的修饰键: 'meta'(默认) 或 'ctrl'"
  },
  "verify": {
    "type": "boolean",
    "description": "输入后回读校验（默认 true）"
  },
  "fallbackToPerKey": {
    "type": "boolean",
    "description": "校验不符时回退逐键（默认 true）"
  }
};
export const sessionPermission = SIDE_EFFECT_PERMISSION;
export async function execute(input, ctx) { return await executeProxyTool(name, input, ctx); }
