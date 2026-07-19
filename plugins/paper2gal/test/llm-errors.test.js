import assert from "node:assert/strict";
import test from "node:test";

import { CredentialManager } from "../llm/credentials.js";
import { CredentialError, APIError, StreamError } from "../llm/errors.js";
import { chatCompletions as anthropicChat } from "../llm/protocols/anthropic.js";
import { chatCompletions as openAiChat } from "../llm/protocols/openai.js";
import { parseSSE } from "../llm/stream.js";

test("missing provider credentials raise the structured credential error", async () => {
  const manager = new CredentialManager({
    request: async () => ({ baseUrl: "https://api.example.test", api: "openai" }),
  });

  await assert.rejects(
    manager.getCredentials("example"),
    (error) => error instanceof CredentialError
      && error.code === "CREDENTIAL_ERROR"
      && error.meta.providerId === "example",
  );
});

test("OpenAI-compatible HTTP failures raise APIError and preserve the token cap", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response("denied", { status: 401 });
  };
  try {
    await assert.rejects(
      openAiChat({
        baseUrl: "https://api.example.test",
        apiKey: "secret",
        model: "model-a",
        messages: [],
        maxTokens: 4096,
      }),
      (error) => error instanceof APIError
        && error.code === "AUTH_FAILED"
        && error.status === 401,
    );
    assert.equal(requestBody.max_tokens, 4096);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Anthropic HTTP failures raise APIError and lift system messages out of chat", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return new Response("unavailable", { status: 503 });
  };
  try {
    await assert.rejects(
      anthropicChat({
        baseUrl: "https://api.example.test",
        apiKey: "secret",
        model: "model-a",
        messages: [
          { role: "system", content: "System instructions" },
          { role: "user", content: "Paper section" },
        ],
      }),
      (error) => error instanceof APIError
        && error.code === "SERVER_ERROR"
        && error.status === 503,
    );
    assert.equal(requestBody.system, "System instructions");
    assert.deepEqual(requestBody.messages, [{ role: "user", content: "Paper section" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SSE HTTP failures raise StreamError", async () => {
  await assert.rejects(
    async () => {
      for await (const chunk of parseSSE(new Response("bad gateway", { status: 502 }))) {
        void chunk;
      }
    },
    (error) => error instanceof StreamError && error.code === "STREAM_ERROR",
  );
});
