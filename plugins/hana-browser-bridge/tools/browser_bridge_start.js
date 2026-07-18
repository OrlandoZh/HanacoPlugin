import { startBridgeRuntime } from "../lib/mcp-client.js";
export const name = "browser_bridge_start";
export const description = "按配置建立 browser-bridge MCP 与 Chrome 连接；existing-chrome 的 Reviewer 审批后会立即发起唯一一次 Chrome 授权连接";
export const parameters = { type: "object", properties: {}, required: [], additionalProperties: false };
export const sessionPermission = { kind: "external_side_effect", auto: "review", description: "Starts the configured local browser connection and MCP subprocess. Existing Chrome access requires explicit review." };
export async function execute(_input, ctx) {
  const result = await startBridgeRuntime(ctx);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: result.ok !== true, details: result };
}
