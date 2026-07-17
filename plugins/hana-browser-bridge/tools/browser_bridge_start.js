import { startBridgeRuntime } from "../lib/mcp-client.js";
export const name = "browser_bridge_start";
export const description = "启动专用 Chrome（如有需要）并建立插件内部 browser-bridge MCP stdio 连接";
export const parameters = {};
export const sessionPermission = { kind: "external_side_effect", auto: "review", description: "Starts a dedicated Chrome and local MCP subprocess." };
export async function execute(_input, ctx) {
  const result = await startBridgeRuntime(ctx);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
}
