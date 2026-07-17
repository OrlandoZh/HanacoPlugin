// Generated from browser-bridge/tools/browser_detect_modals.js. Do not edit manually.
import { executeProxyTool, SIDE_EFFECT_PERMISSION } from "../lib/tool-proxy.js";

export const name = "browser_detect_modals";
export const description = "识别页面弹窗（.ant-modal/[role=dialog]），返回结构化列表；可选 autoCancel 取消危险类弹窗";
export const parameters = {
  "targetId": {
    "type": "string",
    "description": "标签页 targetId"
  },
  "autoCancel": {
    "type": "boolean",
    "description": "true 时自动取消（点击取消/关闭/×，绝不点确认删除）检测到的危险类弹窗"
  }
};
export const sessionPermission = SIDE_EFFECT_PERMISSION;
export async function execute(input, ctx) { return await executeProxyTool(name, input, ctx); }
