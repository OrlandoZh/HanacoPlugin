import { sourceContractDiagnostics, toToolResult } from "../lib/wiki-core.js?v=0.1.14";

export const name = "llm_wiki_source_contract_diagnostics";
export const description = "Run read-only llm-wiki source/cache contract diagnostics for source_path, raw files, and cache entries.";
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
  return toToolResult("source contract diagnostics", await sourceContractDiagnostics(wikiRoot));
}
