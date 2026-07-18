// Generated from browser-bridge/tools/browser_dom.js. Do not edit manually.
import { executeProxyTool, SIDE_EFFECT_PERMISSION } from "../lib/tool-proxy.js";

export const name = "browser_dom";
export const description = "DOM 操作：受控表达式，或 Page-Agent-inspired 结构化 observe/verify（不嵌入第二个 LLM）";
export const parameters = {
  "type": "object",
  "properties": {
    "targetId": {
      "type": "string",
      "description": "标签页 targetId"
    },
    "expression": {
      "type": "string",
      "description": "mode=expression 时的受控 DOM 表达式"
    },
    "mode": {
      "type": "string",
      "enum": [
        "expression",
        "observe",
        "verify"
      ],
      "description": "expression(默认) / observe / verify"
    },
    "maxElements": {
      "type": "integer",
      "minimum": 1,
      "maximum": 200,
      "description": "observe 最多返回元素数，默认 80，最大 200"
    },
    "includeDisabled": {
      "type": "boolean",
      "description": "observe 是否包含 disabled 元素"
    },
    "includeOffscreen": {
      "type": "boolean",
      "description": "observe 是否包含视口外或不可见元素"
    },
    "ref": {
      "type": "string",
      "description": "verify 使用的临时元素 ref（由 observe 返回）"
    },
    "assertion": {
      "type": "string",
      "enum": [
        "exact",
        "contains",
        "empty",
        "visible",
        "enabled",
        "checked",
        "selected"
      ],
      "description": "verify 断言；敏感字段禁止 exact/contains"
    },
    "expected": {
      "description": "verify 的期望值；实际输入内容不会回显"
    }
  },
  "required": [
    "targetId"
  ],
  "additionalProperties": false,
  "allOf": [
    {
      "if": {
        "properties": {
          "mode": {
            "const": "verify"
          }
        },
        "required": [
          "mode"
        ]
      },
      "then": {
        "required": [
          "ref",
          "assertion"
        ]
      }
    },
    {
      "if": {
        "anyOf": [
          {
            "properties": {
              "mode": {
                "const": "expression"
              }
            },
            "required": [
              "mode"
            ]
          },
          {
            "not": {
              "required": [
                "mode"
              ]
            }
          }
        ]
      },
      "then": {
        "required": [
          "expression"
        ]
      }
    }
  ]
};
export const sessionPermission = SIDE_EFFECT_PERMISSION;
export async function execute(input, ctx) { return await executeProxyTool(name, input, ctx); }
