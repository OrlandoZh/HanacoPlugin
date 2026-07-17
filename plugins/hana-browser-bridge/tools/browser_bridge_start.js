import { startBridgeRuntime } from "../lib/mcp-client.js";
export const name = "browser_bridge_start";
export const description = "按配置建立 browser-bridge MCP 连接；连接用户现有 Chrome 时会触发 Chrome 授权并要求 Reviewer 审批";
export const parameters = { type: "object", properties: {}, required: [], additionalProperties: false };
export const sessionPermission = { kind: "external_side_effect", auto: "review", description: "Starts the configured local browser connection and MCP subprocess. Existing Chrome access requires explicit review." };
export async function execute(_input, ctx) {
  const result = await startBridgeRuntime(ctx);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
}
