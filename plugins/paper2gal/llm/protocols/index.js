/**
 * llm/protocols/index.js — 协议注册器
 *
 * 核心职责：
 *   1. 自动加载 protocols/ 下所有已注册的协议处理器
 *   2. 根据 creds.api / model 名称自动路由到对应 handler
 *   3. 支持运行时动态注册新协议
 *
 * 替代原文 §6 的 if-else 硬编码分叉：
 *   if (settings.api.startsWith("anthropic")) { ... } else { ... }
 */

// ── 协议注册表 ──────────────────────────────────
const registry = new Map();

/**
 * 注册一个协议处理器。
 *
 * @param {object} handler
 * @param {string}   handler.protocolId       协议标识（如 "openai"）
 * @param {string[]} handler.supportedModels  该协议能处理的模型关键词前缀
 * @param {Function} handler.chatCompletions   非流式调用函数
 * @param {Function} handler.streamCompletions 流式调用生成器
 */
export function registerProtocol(handler) {
  if (!handler || !handler.protocolId) {
    throw new Error("Protocol handler must have a protocolId");
  }
  registry.set(handler.protocolId, handler);
}

/**
 * 根据 creds.api 字段自动匹配协议。
 *
 * 匹配逻辑：
 *   1. creds.api 以某 protocolId 开头 → 匹配
 *   2. model 名称包含某 supportedModels 关键词 → 候选
 *   3. 都匹配不上 → 抛 UnsupportedProtocolError
 *
 * @param {object} creds   来自 CredentialManager.getCredentials()
 * @param {string} model   目标模型名
 * @returns {object} 协议 handler
 */
export function resolveProtocol(creds, model) {
  // 策略 1：通过 creds.api 前缀匹配
  if (creds.api) {
    for (const [, handler] of registry) {
      if (creds.api.startsWith(handler.protocolId)) {
        return handler;
      }
    }
  }

  // 策略 2：通过模型名称关键词匹配
  if (model) {
    const modelLower = model.toLowerCase();
    for (const [, handler] of registry) {
      const match = handler.supportedModels?.some((kw) => modelLower.includes(kw));
      if (match) return handler;
    }
  }

  // 静态导入 errors（避免在非 async 函数中使用 await import）
  // errors.js 在模块底部统一导入
  throw new _UnsupportedProtocolError(creds?.api || "unknown");
}

/**
 * 获取所有已注册的协议列表（用于调试 / 信息展示）。
 * @returns {Array<{protocolId:string, supportedModels:string[]}>}
 */
export function listProtocols() {
  return Array.from(registry.values()).map((h) => ({
    protocolId: h.protocolId,
    supportedModels: h.supportedModels || [],
  }));
}

// ── 自动注册内置协议 ────────────────────────────

import { protocolId as oaiId, chatCompletions as oaiChat, streamCompletions as oaiStream, supportedModels as oaiModels } from "./openai.js";
import { protocolId as antId, chatCompletions as antChat, streamCompletions as antStream, supportedModels as antModels } from "./anthropic.js";
import { protocolId as gemId, chatCompletions as gemChat, streamCompletions as gemStream, supportedModels as gemModels } from "./gemini.js";
import { UnsupportedProtocolError as _UnsupportedProtocolError } from "../errors.js";

registerProtocol({ protocolId: oaiId, chatCompletions: oaiChat, streamCompletions: oaiStream, supportedModels: oaiModels });
registerProtocol({ protocolId: antId, chatCompletions: antChat, streamCompletions: antStream, supportedModels: antModels });
registerProtocol({ protocolId: gemId, chatCompletions: gemChat, streamCompletions: gemStream, supportedModels: gemModels });
