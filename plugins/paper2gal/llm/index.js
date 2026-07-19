/**
 * llm/index.js — LLMClient 统一入口
 *
 * 整合凭据管理 + 协议注册器 + 流式解析，提供最简单的调用 API。
 *
 * ── 一句话用法 ──
 *
 *   const client = new LLMClient(ctx.bus);
 *
 *   // 列举可用模型
 *   const providers = await client.listProviders();
 *
 *   // 非流式对话
 *   const { content, usage } = await client.chat({
 *     providerId: "openai",
 *     model: "gpt-4o-mini",
 *     messages: [{ role: "user", content: "Hello" }],
 *   });
 *
 *   // 流式对话
 *   for await (const chunk of client.streamChat({ ... })) {
 *     if (chunk.type === "delta") process.stdout.write(chunk.content);
 *   }
 *
 * ── 零外部 NPM 依赖 ──
 * 仅依赖：ctx.bus（Hana RPC）、fetch（Node 18+/Web）、AbortController
 */

import { CredentialManager } from "./credentials.js";
import { resolveProtocol, listProtocols, registerProtocol } from "./protocols/index.js";
import { TimeoutError } from "./errors.js";

export { CredentialError, APIError, UnsupportedProtocolError, TimeoutError, StreamError } from "./errors.js";
export { registerProtocol, listProtocols } from "./protocols/index.js";
export { CredentialManager } from "./credentials.js";
export { parseSSE } from "./stream.js";

/** 默认超时：90 秒 */
const DEFAULT_TIMEOUT = 90_000;

export class LLMClient {
  /**
   * @param {object}  bus          - Hana ctx.bus
   * @param {object}  [opts]
   * @param {number}  [opts.timeout=DEFAULT_TIMEOUT] - 全局超时（毫秒）
   * @param {number}  [opts.cacheTtl]                 - 凭据缓存 TTL
   */
  constructor(bus, opts = {}) {
    this.creds = new CredentialManager(bus, { cacheTtl: opts.cacheTtl });
    this.timeout = opts.timeout ?? DEFAULT_TIMEOUT;
  }

  // ── 列举 ──────────────────────────────────────

  /** 获取所有可用的 chat provider 及模型 */
  async listProviders() {
    return this.creds.listProviders();
  }

  // ── 非流式 ────────────────────────────────────

  /**
   * 非流式 LLM 调用。
   *
   * @param {object}          opts
   * @param {string}          opts.providerId
   * @param {string}          opts.model
   * @param {Array<object>}   opts.messages
   * @param {string}          [opts.system]         Anthropic 专用
   * @param {number}          [opts.maxTokens]
   * @param {object}          [opts.params]         额外协议参数
   * @param {AbortSignal}     [opts.signal]
   * @returns {Promise<{content:string, usage:{input:number, output:number}}>}
   */
  async chat(opts) {
    const { providerId, model, messages, system, maxTokens, params, signal } = opts;

    // 1. 读凭据
    const creds = await this.creds.getCredentials(providerId);

    // 2. 匹配协议
    const handler = resolveProtocol(creds, model);

    // 3. 发起请求（含超时）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    // 合并外部 signal
    const combinedSignal = composeAbortSignals(signal, controller.signal);

    try {
      return await handler.chatCompletions({
        baseUrl: creds.baseUrl,
        apiKey: creds.apiKey,
        model,
        messages,
        system,
        maxTokens,
        params,
        signal: combinedSignal,
      });
    } catch (err) {
      if (err.name === "AbortError") {
        throw new TimeoutError(providerId, this.timeout);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ── 流式 ──────────────────────────────────────

  /**
   * 流式 LLM 调用 — 返回 AsyncGenerator。
   *
   * @param {object}        opts
   * @param {string}        opts.providerId
   * @param {string}        opts.model
   * @param {Array<object>} opts.messages
   * @param {string}        [opts.system]
   * @param {number}        [opts.maxTokens]
   * @param {object}        [opts.params]
   * @param {AbortSignal}   [opts.signal]
   * @yields {StreamChunk}
   */
  async *streamChat(opts) {
    const { providerId, model, messages, system, maxTokens, params, signal } = opts;

    const creds = await this.creds.getCredentials(providerId);
    const handler = resolveProtocol(creds, model);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    const combinedSignal = composeAbortSignals(signal, controller.signal);

    try {
      yield* handler.streamCompletions({
        baseUrl: creds.baseUrl,
        apiKey: creds.apiKey,
        model,
        messages,
        system,
        maxTokens,
        params,
        signal: combinedSignal,
      });
    } catch (err) {
      if (err.name === "AbortError") {
        throw new TimeoutError(providerId, this.timeout);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ── 工具 ──────────────────────────────────────

  /** 清空凭据缓存 */
  invalidateCache(providerId) {
    this.creds.invalidateCache(providerId);
  }
}

// ── 工具函数 ──────────────────────────────────

/**
 * 合并多个 AbortSignal。
 * 任一 signal 触发 abort 则整体 abort。
 */
function composeAbortSignals(...signals) {
  const valid = signals.filter(Boolean);
  if (valid.length === 0) return undefined;
  if (valid.length === 1) return valid[0];

  const controller = new AbortController();
  for (const sig of valid) {
    if (sig.aborted) {
      controller.abort(sig.reason);
      return controller.signal;
    }
    sig.addEventListener("abort", () => controller.abort(sig.reason), { once: true });
  }
  return controller.signal;
}
