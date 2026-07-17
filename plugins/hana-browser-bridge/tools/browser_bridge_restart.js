import { restartBridgeRuntime } from "../lib/mcp-client.js";
export const name = "browser_bridge_restart";
export const description = "重启插件内部 browser-bridge MCP 连接；用于更新配置或升级后维护";
export const parameters = { type: "object", properties: {}, required: [], additionalProperties: false };
export const sessionPermission = { kind: "external_side_effect", auto: "review", description: "Restarts the local browser-bridge MCP subprocess." };
export async function execute(_input, ctx) {
  const result = await restartBridgeRuntime(ctx);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
}
