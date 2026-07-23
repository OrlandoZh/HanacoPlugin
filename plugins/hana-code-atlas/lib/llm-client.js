const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function appendApiPath(baseUrl, suffix) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return suffix;
  if (base.endsWith(suffix)) return base;
  if (suffix === "/v1/messages" && base.endsWith("/v1")) return `${base}/messages`;
  if (suffix === "/chat/completions" && base.endsWith("/v1")) return `${base}/chat/completions`;
  return `${base}${suffix}`;
}

function extractText(data, api) {
  if (api === "anthropic-messages") {
    return Array.isArray(data?.content)
      ? data.content.filter((item) => item?.type === "text").map((item) => item.text || "").join("").trim()
      : "";
  }
  if (api === "openai-responses") {
    if (typeof data?.output_text === "string") return data.output_text.trim();
    return (data?.output || [])
      .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
      .filter((item) => item?.type === "output_text" || item?.type === "text")
      .map((item) => item.text || "")
      .join("\n")
      .trim();
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.filter((item) => item?.type === "text").map((item) => item.text || "").join("").trim();
  return "";
}

function normalizeApi(api) {
  const value = String(api || "openai-completions").toLowerCase();
  if (value.startsWith("anthropic")) return "anthropic-messages";
  if (value === "openai-responses") return value;
  if (value.includes("codex")) return "unsupported";
  return "openai-completions";
}

export async function listChatModels(ctx) {
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable", providers: [] };
  try {
    const result = await ctx.bus.request("provider:models-by-type", { type: "chat" });
    const models = Array.isArray(result?.models) ? result.models : [];
    const providers = new Map();
    for (const model of models) {
      const providerId = String(model?.provider || "").trim();
      const modelId = String(model?.id || "").trim();
      if (!providerId || !modelId) continue;
      if (!providers.has(providerId)) providers.set(providerId, { models: [], meta: {} });
      const entry = providers.get(providerId);
      if (!entry.models.includes(modelId)) entry.models.push(modelId);
      entry.meta[modelId] = { reasoning: !!model?.reasoning };
    }
    return {
      ok: true,
      providers: [...providers.entries()].map(([id, { models, meta }]) => ({ id, models, modelMeta: meta })),
    };
  } catch (error) {
    return { ok: false, error: "provider_list_failed", detail: error.message, providers: [] };
  }
}

export function selectChatModel(providers, requestedProviderId, requestedModel) {
  const available = Array.isArray(providers) ? providers : [];
  const explicitProvider = String(requestedProviderId || "").trim();
  const explicitModel = String(requestedModel || "").trim();
  if (explicitProvider && explicitModel) {
    const provider = available.find((item) => item.id === explicitProvider);
    const reasoning = !!provider?.modelMeta?.[explicitModel]?.reasoning;
    return { ok: true, providerId: explicitProvider, model: explicitModel, reasoning };
  }
  let provider = explicitProvider ? available.find((item) => item.id === explicitProvider) : null;
  if (!provider && explicitModel) provider = available.find((item) => item.models?.includes(explicitModel));
  if (explicitProvider && !provider) return { ok: false, error: "llm_model_required_for_manual_provider" };
  if (!provider) provider = available.find((item) => item.id === "deepseek") || available.find((item) => item.id === "openai") || available[0];
  if (!provider) return { ok: false, error: "llm_provider_not_configured" };
  const model = explicitModel || provider.models?.[0];
  if (!model || !provider.models?.includes(model)) return { ok: false, error: "llm_model_not_available" };
  const reasoning = !!provider.modelMeta?.[model]?.reasoning;
  return { ok: true, providerId: provider.id, model, reasoning };
}

async function readBoundedText(response) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error("llm_response_too_large");
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error("llm_response_too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf-8");
}

export async function callHanaChat(ctx, options) {
  if (!ctx?.bus?.request) return { ok: false, error: "hana_bus_unavailable" };
  const providerId = String(options.providerId || "").trim();
  const model = String(options.model || "").trim();
  if (!providerId || !model) return { ok: false, error: "provider_and_model_required" };

  let credentials;
  try {
    credentials = await ctx.bus.request("provider:credentials", { providerId });
  } catch (error) {
    return { ok: false, error: "provider_credentials_failed", detail: error.message };
  }
  if (credentials?.error || !credentials?.apiKey || !credentials?.baseUrl) {
    return { ok: false, error: credentials?.error || "provider_credentials_missing" };
  }
  const api = normalizeApi(credentials.api);
  if (api === "unsupported") return { ok: false, error: "provider_protocol_unsupported" };

  const controller = new AbortController();
  const timeoutMs = Math.min(300_000, Math.max(10_000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS));
  const timeout = setTimeout(() => controller.abort(new Error("llm_timeout")), timeoutMs);
  const combinedSignal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let endpoint;
  let headers;
  let body;
  if (api === "anthropic-messages") {
    endpoint = appendApiPath(credentials.baseUrl, "/v1/messages");
    headers = { "content-type": "application/json", "x-api-key": credentials.apiKey, "anthropic-version": "2023-06-01" };
    body = {
      model,
      max_tokens: options.maxTokens || 8192,
      temperature: 0.1,
      system: options.system,
      messages: [{ role: "user", content: options.user }],
    };
  } else if (api === "openai-responses") {
    endpoint = appendApiPath(credentials.baseUrl, "/responses");
    headers = { "content-type": "application/json", authorization: `Bearer ${credentials.apiKey}` };
    body = {
      model,
      max_output_tokens: options.maxTokens || 8192,
      temperature: 0.1,
      instructions: options.system,
      input: [{ role: "user", content: options.user }],
    };
  } else {
    endpoint = appendApiPath(credentials.baseUrl, "/chat/completions");
    headers = { "content-type": "application/json", authorization: `Bearer ${credentials.apiKey}` };
    body = {
      model,
      max_tokens: options.maxTokens || 8192,
      temperature: 0.1,
      messages: [
        { role: "system", content: options.system },
        { role: "user", content: options.user },
      ],
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: combinedSignal,
      redirect: "error",
    });
    const rawText = await readBoundedText(response);
    let data;
    try { data = JSON.parse(rawText); } catch { return { ok: false, error: "llm_invalid_response" }; }
    if (!response.ok) {
      const error = response.status === 401 || response.status === 403
        ? "llm_auth_failed"
        : response.status === 429 ? "llm_rate_limited" : "llm_request_failed";
      return { ok: false, error, status: response.status };
    }
    const content = extractText(data, api);
    if (!content) return { ok: false, error: "llm_empty_response" };
    return {
      ok: true,
      content,
      providerId,
      model,
      usage: data?.usage || null,
    };
  } catch (error) {
    if (combinedSignal.aborted) return { ok: false, error: options.signal?.aborted ? "llm_cancelled" : "llm_timeout" };
    return { ok: false, error: error.message === "llm_response_too_large" ? error.message : "llm_network_error", detail: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

export function parseJsonObject(text) {
  const source = String(text || "").trim();
  const candidates = [source];
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1].trim());
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(source.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return { ok: true, value };
    } catch { /* next candidate */ }
  }
  return { ok: false, error: "llm_output_not_json" };
}
