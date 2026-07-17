import { shutdownMcpRuntime } from "../lib/mcp-client.js";
export const name = "browser_bridge_stop";
export const description = "停止插件内部 MCP 服务及由插件启动的专用 Chrome；不会关闭非插件启动的 Chrome";
export const parameters = {
  type: "object",
  properties: {
    stopChrome: { type: "boolean", description: "是否同时停止插件拥有的专用 Chrome（默认 true）" },
  },
  required: [],
  additionalProperties: false,
};
export const sessionPermission = { kind: "external_side_effect", auto: "review", description: "Stops the local MCP subprocess and optionally the plugin-owned Chrome process." };
export async function execute(input, _ctx) {
  const result = await shutdownMcpRuntime({ stopChrome: input?.stopChrome !== false });
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
}
