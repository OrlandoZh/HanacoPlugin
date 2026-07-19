import { APIError } from "../errors.js";

/**
 * llm/protocols/anthropic.js — Anthropic 协议处理器
 *
 * 对应原文 §6（非流式）+ §7（流式）的 Anthropic 部分。
 *
 * API：POST /v1/messages
 * 认证：x-api-key header
 * 版本：anthropic-version: 2023-06-01
 */

/**
 * 非流式对话补全
 *
 * @param {object} opts
 * @param {string}        opts.baseUrl
 * @param {string}        opts.apiKey
 * @param {string}        opts.model
 * @param {string}        [opts.system]          system prompt（Anthropic 独立字段）
 * @param {Array<object>} opts.messages
 * @param {number}        [opts.maxTokens=1024]
 * @param {object}        [opts.params]          额外参数（temperature, top_p, stop_sequences 等）
 * @param {AbortSignal}   [opts.signal]
 * @returns {Promise<{content:string, usage:{input:number, output:number}}>}
 */
export async function chatCompletions(opts) {
  const { baseUrl, apiKey, model, system, messages, maxTokens = 1024, params, signal } = opts;
  const endpoint = `${normalizeBase(baseUrl)}/v1/messages`;
  const normalized = normalizeAnthropicMessages(messages, system);

  const body = {
    model,
    max_tokens: maxTokens,
    messages: normalized.messages,
    ...params,
  };
  if (normalized.system) body.system = normalized.system;

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new APIError("anthropic", r.status, text);
  }

  const json = await r.json();
  return {
    content: json.content?.map((b) => b.text).join("") || "",
    usage: {
      input: json.usage?.input_tokens || 0,
      output: json.usage?.output_tokens || 0,
    },
  };
}

/**
 * 流式对话补全 — 返回 AsyncGenerator
 *
 * Anthropic SSE 格式与 OpenAI 不同：
 *   - 使用 event: 行标记消息类型
 *   - content_block_delta 事件携带增量文本
 *   - message_stop 标记结束
 *
 * @param {object} opts
 * @param {string}        opts.baseUrl
 * @param {string}        opts.apiKey
 * @param {string}        opts.model
 * @param {string}        [opts.system]
 * @param {Array<object>} opts.messages
 * @param {number}        [opts.maxTokens=1024]
 * @param {object}        [opts.params]
 * @param {AbortSignal}   [opts.signal]
 * @returns {AsyncGenerator<import("../stream.js").StreamChunk>}
 */
export async function* streamCompletions(opts) {
  const { baseUrl, apiKey, model, system, messages, maxTokens = 1024, params, signal } = opts;
  const endpoint = `${normalizeBase(baseUrl)}/v1/messages`;
  const normalized = normalizeAnthropicMessages(messages, system);

  const body = {
    model,
    max_tokens: maxTokens,
    messages: normalized.messages,
    stream: true,
    ...params,
  };
  if (normalized.system) body.system = normalized.system;

  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal,
  });

  const { parseSSE } = await import("../stream.js");
  yield* parseSSE(r, signal);
}

export function normalizeAnthropicMessages(messages = [], explicitSystem = "") {
  const systemParts = explicitSystem ? [explicitSystem] : [];
  const chatMessages = [];

  for (const message of messages || []) {
    if (message?.role === "system") {
      if (typeof message.content === "string" && message.content.trim()) {
        systemParts.push(message.content.trim());
      }
      continue;
    }
    chatMessages.push(message);
  }

  return {
    system: systemParts.join("\n\n"),
    messages: chatMessages,
  };
}

/** 协议标识 */
export const protocolId = "anthropic";
export const supportedModels = ["claude"];

function normalizeBase(url) {
  return (url || "https://api.anthropic.com").replace(/\/+$/, "");
}
