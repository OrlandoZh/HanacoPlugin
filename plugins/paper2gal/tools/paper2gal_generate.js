/**
 * paper2gal_generate — LLM-powered visual novel script generation tool.
 *
 * Takes chapter text chunks (from paper2gal_parse) and generates
 * visual novel script items (dialogue/quiz/choice/sub_head/show_image)
 * using the LLM integration module.
 *
 * The Agent calls this tool with chunks + provider/model info,
 * and gets back a ready-to-render JSON script array.
 * No need for the Agent to spend its own context on script generation.
 */

import { LLMClient } from "../llm/index.js";
import {
  buildMessages,
  normalizeScript,
  fallbackScript,
  CHARACTER_CONFIGS,
  AVAILABLE_CHARACTERS,
} from "../lib/prompt-builder.js";

export const name = "paper2gal_generate";
export const description = [
  "Generate visual novel script items (dialogue/quiz/choice) from paper chapter chunks using LLM.",
  "Returns a JSON array of script items ready for show_card rendering.",
  "Uses the HanaAgent LLM integration module — supports OpenAI/DeepSeek/Anthropic providers.",
  "Call paper2gal_parse first to get chunks, then pass them here.",
].join(" ");

export const sessionPermission = {
  kind: "external_side_effect",
  auto: "review",
  description: "Calls a configured LLM provider to generate visual novel dialogue.",
};

export const parameters = {
  type: "object",
  properties: {
    chunks: {
      type: "array",
      description: "Chapter text chunks from paper2gal_parse. Each chunk: { text, sectionTitle, sectionKey, index }.",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          sectionTitle: { type: "string" },
          index: { type: "number" },
        },
      },
    },
    providerId: {
      type: "string",
      description: "LLM Provider ID (e.g. 'deepseek', 'openai', 'anthropic'). If omitted, auto-detects first available chat provider.",
    },
    model: {
      type: "string",
      description: "Model name (e.g. 'deepseek-chat', 'gpt-4o-mini'). If omitted, uses provider's default.",
    },
    character: {
      type: "string",
      enum: AVAILABLE_CHARACTERS,
      description: "Character name for the script. Default: 奈奈.",
    },
    figureLabels: {
      type: "array",
      items: { type: "string" },
      description: "Figure/table labels from paper2gal_parse results. Pass these so the LLM can reference them.",
    },
    temperature: {
      type: "number",
      minimum: 0,
      maximum: 2,
      description: "LLM temperature (0-2). Default 0.7.",
    },
  },
  required: ["chunks"],
  additionalProperties: false,
};

export function resolveGenerationPreferences(input = {}, config = {}) {
  const requestedTemperature = Number(input.temperature ?? config.llmTemperature ?? 0.7);
  return {
    characterName: input.character || config.defaultCharacter || "奈奈",
    providerId: input.providerId || config.defaultProviderId || undefined,
    model: input.model || config.defaultModel || undefined,
    temperature: Number.isFinite(requestedTemperature)
      ? Math.min(2, Math.max(0, requestedTemperature))
      : 0.7,
  };
}

export function completeProviderSelection(providers, providerId, model) {
  const available = Array.isArray(providers) ? providers : [];
  const selected = providerId
    ? available.find((provider) => provider.id === providerId)
    : available.find((provider) => model && provider.models?.includes(model))
      || available.find((provider) => provider.id === "deepseek")
      || available.find((provider) => provider.id === "openai")
      || available[0];

  return {
    providerId: providerId || selected?.id,
    model: model || selected?.models?.[0],
  };
}

/**
 * @param {Object} input
 * @param {Object} ctx - Plugin context (contains bus, config, etc.)
 */
export async function execute(input = {}, ctx = {}) {
  const chunks = input.chunks;
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return {
      content: [{ type: "text", text: "❌ chunks is required and must be a non-empty array." }],
    };
  }

  const {
    characterName,
    providerId: configuredProviderId,
    model: configuredModel,
    temperature,
  } = resolveGenerationPreferences(input, ctx.config || {});
  const figureLabels = input.figureLabels || [];

  // Initialize LLM client
  if (!ctx.bus) {
    return {
      content: [{ type: "text", text: "❌ LLM integration requires ctx.bus (HanaAgent runtime). Cannot run standalone." }],
    };
  }

  const llm = new LLMClient(ctx.bus, { timeout: 120_000 });

  // Resolve provider
  let providerId = configuredProviderId;
  let model = configuredModel;

  if (!providerId || !model) {
    try {
      const providers = await llm.listProviders();
      if (providers.length === 0) {
        return {
          content: [{ type: "text", text: "❌ No LLM providers configured. Please configure a chat provider in HanaAgent settings." }],
        };
      }
      ({ providerId, model } = completeProviderSelection(providers, providerId, model));
      if (!providerId || !model) {
        const providerLabel = providerId ? ` for provider \"${providerId}\"` : "";
        return {
          content: [{ type: "text", text: `❌ No chat model configured${providerLabel}.` }],
        };
      }
    } catch (e) {
      return {
        content: [{ type: "text", text: `❌ Failed to list LLM providers: ${e.message}` }],
      };
    }
  }

  // Generate scripts for all chunks
  const allScripts = [];
  const errors = [];

  for (let position = 0; position < chunks.length; position += 1) {
    const chunk = chunks[position] || {};
    const chunkIndex = chunk.index ?? position;
    const chunkText = chunk.text || "";
    const sectionTitle = chunk.sectionTitle || "";

    if (!chunkText.trim()) {
      errors.push(`Chunk ${chunkIndex} (${sectionTitle || "untitled"}): empty_text`);
      continue;
    }

    // Build messages
    const { system, user } = buildMessages({
      chunkText,
      chunkIndex,
      sectionTitle,
      figureLabels,
      characterName,
    });

    try {
      const result = await llm.chat({
        providerId,
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        params: { temperature },
        maxTokens: 4096,
      });

      // Normalize the LLM output
      const scriptItems = normalizeScript(result.content, characterName);

      if (scriptItems.length > 0) {
        allScripts.push({
          chunkIndex,
          sectionTitle,
          character: characterName,
          items: scriptItems,
        });
      } else {
        // Fallback: LLM output couldn't be parsed
        const fb = fallbackScript(
          "唔……这段作者写得太绕了，我一时没把剧本整理成标准格式。我们先用简化版继续读下去喵！",
          chunkIndex,
          characterName,
          chunkText.slice(0, 260)
        );
        allScripts.push({
          chunkIndex,
          sectionTitle,
          character: characterName,
          items: fb,
        });
      }
    } catch (error) {
      const errMsg = `Chunk ${chunkIndex} (${sectionTitle || "untitled"}): ${error.message || error.name}`;
      errors.push(errMsg);

      // Add fallback script for this chunk
      const fb = fallbackScript(
        `这段出了一点小问题（${error.code || error.name}），不过不要紧，我们先跳过看下一段喵！`,
        chunkIndex,
        characterName
      );
      allScripts.push({
        chunkIndex,
        sectionTitle,
        character: characterName,
        items: fb,
        error: errMsg,
      });
    }
  }

  // Build result
  const result = {
    provider: providerId,
    model,
    character: characterName,
    totalChunks: chunks.length,
    processedChunks: allScripts.length,
    errors: errors.length > 0 ? errors : undefined,
    scripts: allScripts,
  };

  return {
    content: [{
      type: "text",
      text: JSON.stringify(result, null, 2),
    }],
  };
}
