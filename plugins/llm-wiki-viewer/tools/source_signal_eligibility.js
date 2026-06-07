import { sourceSignalEligibility, toToolResult } from "../lib/wiki-core.js?v=0.1.10";

export const name = "llm_wiki_source_signal_eligibility";
export const description = "Run read-only llm-wiki source signal eligibility diagnostics for wiki pages.";
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
  return toToolResult("source signal eligibility", await sourceSignalEligibility(wikiRoot));
}
