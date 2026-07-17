import { callBridgeTool } from "./mcp-client.js";

function contentText(result) {
  const texts = (result?.content || [])
    .filter((item) => item?.type === "text")
    .map((item) => String(item.text || ""));
  return texts.join("\n");
}

export async function executeProxyTool(toolName, input, ctx) {
  const result = await callBridgeTool(toolName, input, ctx);
  const text = contentText(result) || JSON.stringify({ ok: !result?.isError, tool: toolName });
  return {
    content: [{ type: "text", text }],
    isError: result?.isError === true,
    details: {
      bridge: {
        transport: "internal-mcp-stdio",
        tool: toolName,
      },
      structuredContent: result?.structuredContent,
    },
  };
}

export const READ_ONLY_PERMISSION = Object.freeze({ readOnly: true, kind: "read_only" });
export const SIDE_EFFECT_PERMISSION = Object.freeze({
  readOnly: false,
  kind: "external_side_effect",
  auto: "review",
  description: "Controls a dedicated Chrome browser through the bundled browser-bridge MCP service.",
});
