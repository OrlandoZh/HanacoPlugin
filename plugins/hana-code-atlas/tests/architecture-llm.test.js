import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  callHanaChat,
  listChatModels,
  parseJsonObject,
  selectChatModel,
} from "../lib/llm-client.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function bus(models = []) {
  return {
    async request(type, payload) {
      if (type === "provider:models-by-type") {
        assert.deepEqual(payload, { type: "chat" });
        return { models };
      }
      if (type === "provider:credentials") {
        assert.deepEqual(payload, { providerId: "openai" });
        return { apiKey: "secret", baseUrl: "https://llm.example/v1", api: "openai-completions" };
      }
      throw new Error(`unexpected channel: ${type}`);
    },
  };
}

describe("Architecture Hana Provider client", () => {
  it("declares the host capabilities required for model discovery and credentials", () => {
    const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf-8"));
    assert.ok(manifest.capabilities.includes("provider.read"));
    assert.ok(manifest.capabilities.includes("provider.credentials.read"));
  });

  it("groups Hana chat models and validates explicit selection", async () => {
    const listed = await listChatModels({ bus: bus([
      { provider: "openai", id: "gpt-a", reasoning: false },
      { provider: "openai", id: "gpt-b", reasoning: true },
      { provider: "deepseek", id: "deepseek-chat" },
    ]) });
    assert.equal(listed.ok, true);
    assert.deepEqual(listed.providers[0], { id: "openai", models: ["gpt-a", "gpt-b"], modelMeta: { "gpt-a": { reasoning: false }, "gpt-b": { reasoning: true } } });
    assert.deepEqual(selectChatModel(listed.providers, "openai", "gpt-b"), {
      ok: true, providerId: "openai", model: "gpt-b", reasoning: true,
    });
    assert.equal(selectChatModel(listed.providers, "openai", "missing").error, undefined);
    assert.deepEqual(selectChatModel([], "manual-provider", "manual-model"), {
      ok: true, providerId: "manual-provider", model: "manual-model", reasoning: false,
    });
  });

  it("uses host credentials without returning or logging them", async () => {
    let captured;
    globalThis.fetch = async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"version":"1.0.0"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 4 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const result = await callHanaChat({ bus: bus() }, {
      providerId: "openai",
      model: "gpt-a",
      system: "system",
      user: "user",
      maxTokens: 128,
    });
    assert.equal(result.ok, true);
    assert.equal(result.content, '{"version":"1.0.0"}');
    assert.equal(captured.url, "https://llm.example/v1/chat/completions");
    assert.equal(captured.init.redirect, "error");
    assert.equal(captured.init.headers.authorization, "Bearer secret");
    assert.equal(JSON.stringify(result).includes("secret"), false);
    const payload = JSON.parse(captured.init.body);
    assert.equal(payload.temperature, 0.1);
    assert.equal(payload.max_tokens, 128);
  });

  it("rejects oversized responses before parsing", async () => {
    globalThis.fetch = async () => new Response("x".repeat(300 * 1024), { status: 200 });
    const result = await callHanaChat({ bus: bus() }, {
      providerId: "openai", model: "gpt-a", system: "s", user: "u",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "llm_response_too_large");
  });

  it("extracts a JSON object but rejects prose-only model output", () => {
    assert.deepEqual(parseJsonObject("```json\n{\"ok\":true}\n```"), { ok: true, value: { ok: true } });
    assert.equal(parseJsonObject("not json").error, "llm_output_not_json");
  });
});
