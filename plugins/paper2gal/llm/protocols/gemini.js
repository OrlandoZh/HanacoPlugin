/**
 * llm/protocols/gemini.js — Google Gemini 协议处理器（扩展预留）
 *
 * Gemini 使用不同的 API 结构：
 *   - POST /v1/models/{model}:generateContent
 *   - API Key 通过 x-goog-api-key header 传递
 *   - 流式使用 SSE（与 OpenAI 类似但字段不同）
 *
 * 本文件为扩展模板，需接入时按实际 API 补全即可。
 */

export const protocolId = "gemini";
export const supportedModels = ["gemini"];

/**
 * 非流式对话补全
 */
export async function chatCompletions(/* opts */) {
  const { UnsupportedProtocolError } = await import("../errors.js");
  throw new UnsupportedProtocolError("gemini");
}

/**
 * 流式对话补全
 */
export async function* streamCompletions(/* opts */) {
  const { UnsupportedProtocolError } = await import("../errors.js");
  throw new UnsupportedProtocolError("gemini");
}
