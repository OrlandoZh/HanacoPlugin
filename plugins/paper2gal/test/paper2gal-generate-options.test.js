import assert from "node:assert/strict";
import test from "node:test";

import {
  completeProviderSelection,
  execute,
  resolveGenerationPreferences,
} from "../tools/paper2gal_generate.js";

test("generation parameters override plugin defaults", () => {
  assert.deepEqual(
    resolveGenerationPreferences(
      {
        character: "蜡笔小新",
        providerId: "openai",
        model: "model-a",
        temperature: 0,
      },
      {
        defaultCharacter: "奈奈",
        defaultProviderId: "deepseek",
        defaultModel: "model-b",
        llmTemperature: 0.9,
      },
    ),
    {
      characterName: "蜡笔小新",
      providerId: "openai",
      model: "model-a",
      temperature: 0,
    },
  );
});

test("generation preferences use manifest configuration", () => {
  assert.deepEqual(
    resolveGenerationPreferences(
      {},
      {
        defaultCharacter: "玲娜贝儿",
        defaultProviderId: "deepseek",
        defaultModel: "deepseek-chat",
        llmTemperature: 0.4,
      },
    ),
    {
      characterName: "玲娜贝儿",
      providerId: "deepseek",
      model: "deepseek-chat",
      temperature: 0.4,
    },
  );
});

test("generation temperature is clamped to the supported provider range", () => {
  assert.equal(resolveGenerationPreferences({ temperature: -1 }).temperature, 0);
  assert.equal(resolveGenerationPreferences({ temperature: 3 }).temperature, 2);
  assert.equal(resolveGenerationPreferences({ temperature: "invalid" }).temperature, 0.7);
});

test("provider completion respects an explicit provider and fills its first model", () => {
  assert.deepEqual(
    completeProviderSelection(
      [
        { id: "openai", models: ["gpt-a"] },
        { id: "deepseek", models: ["deepseek-chat"] },
      ],
      "openai",
      undefined,
    ),
    { providerId: "openai", model: "gpt-a" },
  );
});

test("provider completion finds the owner of an explicit model", () => {
  assert.deepEqual(
    completeProviderSelection(
      [
        { id: "openai", models: ["gpt-a"] },
        { id: "deepseek", models: ["deepseek-chat"] },
      ],
      undefined,
      "gpt-a",
    ),
    { providerId: "openai", model: "gpt-a" },
  );
});

test("automatic provider selection prefers deepseek then openai", () => {
  assert.deepEqual(
    completeProviderSelection(
      [
        { id: "other", models: ["other-chat"] },
        { id: "openai", models: ["gpt-a"] },
        { id: "deepseek", models: ["deepseek-chat"] },
      ],
      undefined,
      undefined,
    ),
    { providerId: "deepseek", model: "deepseek-chat" },
  );
});

test("generate uses configured provider defaults through the complete local LLM path", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify([{
              type: "dialogue",
              speaker: "玲娜贝儿",
              text: "这段论文在讲一个可验证的结论。",
              emotion: "char_happy",
            }]),
          },
        }],
        usage: { prompt_tokens: 12, completion_tokens: 8 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  const bus = {
    async request(channel, payload) {
      if (channel === "provider:models-by-type") {
        assert.deepEqual(payload, { type: "chat" });
        return { models: [{ provider: "openai", id: "gpt-test" }] };
      }
      if (channel === "provider:credentials") {
        assert.deepEqual(payload, { providerId: "openai" });
        return {
          apiKey: "secret",
          baseUrl: "https://api.example.test",
          api: "openai",
        };
      }
      throw new Error(`Unexpected bus channel: ${channel}`);
    },
  };

  try {
    const response = await execute(
      {
        chunks: [{ index: 0, sectionTitle: "Abstract", text: "Paper content" }],
      },
      {
        bus,
        config: {
          defaultCharacter: "玲娜贝儿",
          defaultProviderId: "openai",
          defaultModel: "",
          llmTemperature: 0.25,
        },
      },
    );
    const result = JSON.parse(response.content[0].text);

    assert.equal(result.provider, "openai");
    assert.equal(result.model, "gpt-test");
    assert.equal(result.character, "玲娜贝儿");
    assert.equal(result.processedChunks, 1);
    assert.equal(result.scripts[0].items[0].speaker, "玲娜贝儿");
    assert.equal(requestBody.model, "gpt-test");
    assert.equal(requestBody.temperature, 0.25);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
