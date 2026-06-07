import { sourceCoverage, toToolResult } from "../lib/wiki-core.js?v=0.1.11";

export const name = "llm_wiki_source_coverage";
export const description = "Run llm-wiki source signal coverage diagnostics for an initialized wiki root.";
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
  return toToolResult("source coverage", await sourceCoverage(wikiRoot));
}
