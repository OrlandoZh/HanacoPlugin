import { lifecycleDiagnostics, toToolResult } from "../lib/wiki-core.js?v=0.1.17";

export const name = "llm_wiki_lifecycle_diagnostics";
export const description = "Run read-only llm-wiki lifecycle diagnostics: scan confidence scores, staleness, supersession chains, retention class distribution, and evidence coverage gaps.";
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
  return toToolResult("lifecycle diagnostics", await lifecycleDiagnostics(wikiRoot));
}
