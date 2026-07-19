import { APIError } from "../errors.js";

/**
 * llm/protocols/openai.js — OpenAI-compatible 协议处理器
 *
 * 对应原文 §5（非流式）+ §7（流式）的 OpenAI 部分。
 *
 * 兼容：OpenAI / DeepSeek / OpenRouter / 任何实现
 *       POST /v1/chat/completions 的 OpenAI-compatible 端点。
 */

/**
 * 非流式对话补全
 *
 * @param {object} opts
 * @param {string}        opts.baseUrl
 * @param {string}        opts.apiKey
 * @param {string}        opts.model
 * @param {Array<object>} opts.messages
 * @param {object}        [opts.params]    额外参数（temperature, max_tokens, top_p 等）
 * @param {AbortSignal}   [opts.signal]
 * @returns {Promise<{content:string, usage:{input:number, output:number}}>}
 */
export async function chatCompletions(opts) {
  const { baseUrl, apiKey, model, messages, maxTokens, params, signal } = opts;
  const endpoint = `${normalizeBase(baseUrl)}/v1/chat/completions`;

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      ...(maxTokens == null ? {} : { max_tokens: maxTokens }),
      ...params,
    }),
    signal,
  });

  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new APIError("openai", r.status, body);
  }

  const json = await r.json();
  return {
    content: json.choices?.[0]?.message?.content || "",
    usage: {
      input: json.usage?.prompt_tokens || 0,
      output: json.usage?.completion_tokens || 0,
    },
  };
}

/**
 * 流式对话补全 — 返回 AsyncGenerator
 *
 * @param {object} opts
 * @param {string}        opts.baseUrl
 * @param {string}        opts.apiKey
 * @param {string}        opts.model
 * @param {Array<object>} opts.messages
 * @param {object}        [opts.params]
 * @param {AbortSignal}   [opts.signal]
 * @returns {AsyncGenerator<import("../stream.js").StreamChunk>}
 */
export async function* streamCompletions(opts) {
  const { baseUrl, apiKey, model, messages, maxTokens, params, signal } = opts;
  const endpoint = `${normalizeBase(baseUrl)}/v1/chat/completions`;

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(maxTokens == null ? {} : { max_tokens: maxTokens }),
      ...params,
    }),
    signal,
  });

  // 复用通用 SSE 解析器，parseSSE 会自动处理响应码
  const { parseSSE } = await import("../stream.js");
  yield* parseSSE(r, signal);
}

/** 协议标识 */
export const protocolId = "openai";
export const supportedModels = ["gpt", "deepseek", "qwen", "glm", "moonshot", "yi", "openrouter"];

function normalizeBase(url) {
  return (url || "https://api.openai.com").replace(/\/+$/, "");
}
