import { getBridgeStatus } from "../lib/mcp-client.js";

export const name = "browser_bridge_status";
export const description = "查看 Browser Bridge 插件、内部 MCP 服务、专用 Chrome 和安全配置状态";
export const parameters = { type: "object", properties: {}, required: [], additionalProperties: false };
export const sessionPermission = { readOnly: true, kind: "read_only" };
export async function execute(_input, ctx) {
  const status = await getBridgeStatus(ctx);
  return { content: [{ type: "text", text: `Browser Bridge\n${JSON.stringify(status, null, 2)}` }], details: status };
}
