/**
 * llm/credentials.js — 凭据管理器
 *
 * 封装原文 §3 + §4 的 RPC 调用逻辑：
 *   - provider:models-by-type
 *   - provider:credentials
 *
 * 增加：
 *   - 凭据轻量缓存（同 provider 在 TTL 内不重复读取）
 *   - 惰性校验（不提前 fetch，调用时才读取）
 */

import { CredentialError } from "./errors.js";

const CREDENTIALS_CACHE_TTL = 60_000; // 1 分钟缓存

export class CredentialManager {
  /**
   * @param {object} bus - Hana ctx.bus
   * @param {object} [opts]
   * @param {number} [opts.cacheTtl] - 凭据缓存 TTL（毫秒）
   */
  constructor(bus, opts = {}) {
    this.bus = bus;
    this.cacheTtl = opts.cacheTtl ?? CREDENTIALS_CACHE_TTL;
    /** @type {Map<string, {creds: object, ts: number}>} */
    this._cache = new Map();
  }

  // ── 列举 Chat 模型 ──────────────────────────────

  /**
   * 获取所有可用的 chat 模型，按 provider 分组。
   * @returns {Promise<Array<{id:string, models:string[], modelCount:number}>>}
   */
  async listProviders() {
    const all = await this.bus.request("provider:models-by-type", { type: "chat" });
    const models = all?.models || [];

    const byProvider = {};
    for (const m of models) {
      if (!m.provider) continue;
      if (!byProvider[m.provider]) byProvider[m.provider] = [];
      byProvider[m.provider].push(m.id);
    }

    return Object.entries(byProvider).map(([id, models]) => ({
      id,
      models,
      modelCount: models.length,
    }));
  }

  // ── 读取凭据（带缓存） ──────────────────────────

  /**
   * 获取指定 provider 的临时凭据。
   * 相同 provider 在 cacheTtl 内复用缓存。
   *
   * @param {string} providerId
   * @returns {Promise<{apiKey:string, baseUrl:string, api:string, accountId?:string}>}
   */
  async getCredentials(providerId) {
    const cached = this._cache.get(providerId);
    if (cached && Date.now() - cached.ts < this.cacheTtl) {
      return cached.creds;
    }

    const creds = await this.bus.request("provider:credentials", { providerId });

    if (creds?.error) {
      throw new CredentialError(providerId, creds.error);
    }
    if (!creds?.apiKey) {
      throw new CredentialError(providerId, "missing apiKey");
    }

    const result = {
      apiKey: creds.apiKey,
      baseUrl: creds.baseUrl,
      api: creds.api,
      accountId: creds.accountId,
    };

    this._cache.set(providerId, { creds: result, ts: Date.now() });
    return result;
  }

  // ── 工具 ────────────────────────────────────────

  /** 清空凭据缓存（强制下次重新读取） */
  invalidateCache(providerId) {
    if (providerId) {
      this._cache.delete(providerId);
    } else {
      this._cache.clear();
    }
  }
}
