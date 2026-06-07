import { diagnostics, toToolResult } from "../lib/wiki-core.js?v=0.1.13";

export const name = "llm_wiki_diagnostics";
export const description = "Run a read-only llm-wiki diagnostic summary with status, wiki counts, source coverage, and adapter state.";
export const parameters = {
  type: "object",
  properties: {
    wikiRoot: {
      type: "string",
      description: "Absolute path to an initialized llm-wiki root containing .wiki-schema.md and wiki/."
    }
  },
  required: ["wikiRoot"],
  additionalProperties: false
};

export async function execute(input = {}) {
  const wikiRoot = String(input.wikiRoot || "").trim();
  if (!wikiRoot) throw new Error("wikiRoot is required.");
  return toToolResult("diagnostics", await diagnostics(wikiRoot));
}
