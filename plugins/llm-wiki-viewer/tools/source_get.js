import { sourceRegistryLookup, toToolResult } from "../lib/wiki-core.js?v=0.1.10";

export const name = "llm_wiki_source_get";
export const description = "Get one llm-wiki source registry definition by sourceId.";
export const parameters = {
  type: "object",
  properties: {
    sourceId: {
      type: "string",
      description: "Source id from the llm-wiki source registry, for example plain_text or web_article."
    }
  },
  required: ["sourceId"],
  additionalProperties: false
};

export async function execute(input = {}) {
  const sourceId = String(input.sourceId || "").trim();
  if (!sourceId) throw new Error("sourceId is required.");
  return toToolResult("source get", await sourceRegistryLookup("get", sourceId));
}
