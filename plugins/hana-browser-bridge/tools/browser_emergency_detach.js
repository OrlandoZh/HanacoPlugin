import { emergencyDetachRuntime } from "../lib/mcp-client.js";

export const name = "browser_emergency_detach";
export const description = "立即断开 Browser Bridge 的 MCP/CDP 会话并清空所有 target claim；绝不关闭用户 Chrome";
export const parameters = { type: "object", properties: {}, required: [], additionalProperties: false };
export const sessionPermission = {
  kind: "external_side_effect",
  auto: "review",
  description: "Emergency-disconnects all browser bridge sessions without closing the user's Chrome browser.",
};

export async function execute(_input, _ctx) {
  const result = await emergencyDetachRuntime();
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: result };
}
