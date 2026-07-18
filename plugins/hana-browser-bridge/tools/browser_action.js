// Generated from browser-bridge/tools/browser_action.js. Do not edit manually.
import { executeProxyTool, SIDE_EFFECT_PERMISSION } from "../lib/tool-proxy.js";

export const name = "browser_action";
export const description = "页面交互：CSS selector，或 browser_dom(mode=observe) 返回的临时 ref；点击始终经过全局护栏";
export const parameters = {
  "type": "object",
  "properties": {
    "targetId": {
      "type": "string",
      "description": "标签页 targetId"
    },
    "action": {
      "type": "string",
      "enum": [
        "click",
        "hover",
        "fill",
        "type",
        "focus",
        "input",
        "clear"
      ],
      "description": "selector 支持 click/hover/fill/type；ref 支持 click/hover/focus/input/clear（fill/type 会映射为 input）"
    },
    "selector": {
      "type": "string",
      "description": "CSS selector；与 ref 二选一"
    },
    "ref": {
      "type": "string",
      "description": "browser_dom(mode=observe) 返回的临时元素 ref；与 selector 二选一"
    },
    "value": {
      "type": "string",
      "description": "fill / type 的文本"
    },
    "fallback": {
      "type": "string",
      "enum": [
        "synthetic"
      ],
      "description": "selector click 兜底模式: 'synthetic' 强制 DOM 合成点击（默认原生 CDP 点击）"
    },
    "waitAfterMs": {
      "type": "number",
      "description": "点击后等待毫秒（可选）"
    },
    "clear": {
      "type": "boolean",
      "description": "ref input 前是否清空，默认 true"
    },
    "verify": {
      "type": "boolean",
      "description": "ref input 后是否精确回读校验，默认 true"
    },
    "fallbackToPerKey": {
      "type": "boolean",
      "description": "ref input 校验失败时是否逐键回退"
    }
  },
  "required": [
    "targetId",
    "action"
  ],
  "additionalProperties": false,
  "oneOf": [
    {
      "required": [
        "selector"
      ],
      "not": {
        "required": [
          "ref"
        ]
      }
    },
    {
      "required": [
        "ref"
      ],
      "not": {
        "required": [
          "selector"
        ]
      }
    }
  ]
};
export const sessionPermission = SIDE_EFFECT_PERMISSION;
export async function execute(input, ctx) { return await executeProxyTool(name, input, ctx); }
