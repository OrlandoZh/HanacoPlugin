import { sourceRegistryLookup, toToolResult } from "../lib/wiki-core.js?v=0.1.12";

export const name = "llm_wiki_source_match_url";
export const description = "Match a URL against the llm-wiki source registry and return the source definition to use.";
export const parameters = {
  type: "object",
  properties: {
    url: {
      type: "string",
      description: "URL to classify against source-registry.sh match-url."
    }
  },
  required: ["url"],
  additionalProperties: false
};

export async function execute(input = {}) {
  const url = String(input.url || "").trim();
  if (!url) throw new Error("url is required.");
  return toToolResult("source URL match", await sourceRegistryLookup("match-url", url));
}
