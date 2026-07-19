/**
 * llm/errors.js — 层次化错误体系
 *
 * 替代原文散落的 throw new Error("...")，
 * 让上游 route 可以根据 error.code 做差异化处理
 * （如 401 提示用户重新配置、429 触发退避重试）
 */

export class LLMError extends Error {
  /**
   * @param {string} code    机器可读错误码
   * @param {string} message 人类可读描述
   * @param {object} [meta]  额外上下文（status、providerId 等）
   */
  constructor(code, message, meta = {}) {
    super(message);
    this.name = "LLMError";
    this.code = code;
    this.meta = meta;
  }
}

/** Provider 未配置或凭据无效 */
export class CredentialError extends LLMError {
  constructor(providerId, detail) {
    super("CREDENTIAL_ERROR", `Provider "${providerId}" credential error: ${detail}`, {
      providerId,
      detail,
    });
    this.name = "CredentialError";
  }
}

/** LLM API 返回 HTTP 错误 */
export class APIError extends LLMError {
  constructor(providerId, status, body) {
    const code =
      status === 401 ? "AUTH_FAILED" :
      status === 429 ? "RATE_LIMITED" :
      status >= 500  ? "SERVER_ERROR" :
      "API_ERROR";

    super(code, `LLM API ${status}: ${(body || "").slice(0, 200)}`, {
      providerId,
      status,
      body,
    });
    this.name = "APIError";
    this.status = status;
  }
}

/** 不支持的协议类型 */
export class UnsupportedProtocolError extends LLMError {
  constructor(api) {
    super("UNSUPPORTED_PROTOCOL", `Unsupported API protocol: "${api}"`, { api });
    this.name = "UnsupportedProtocolError";
  }
}

/** 请求超时 */
export class TimeoutError extends LLMError {
  constructor(providerId, ms) {
    super("TIMEOUT", `LLM request timed out after ${ms}ms`, { providerId, timeoutMs: ms });
    this.name = "TimeoutError";
  }
}

/** 流式传输中断 */
export class StreamError extends LLMError {
  constructor(cause) {
    super("STREAM_ERROR", `Stream error: ${cause?.message || cause}`, { cause });
    this.name = "StreamError";
  }
}
