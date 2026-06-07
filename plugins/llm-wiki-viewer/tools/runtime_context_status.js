import { runtimeContextStatus, toToolResult } from "../lib/wiki-core.js?v=0.1.10";

export const name = "llm_wiki_runtime_context_status";
export const description = "Run read-only llm-wiki runtime context diagnostics for the configured skill and wiki root.";
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
  return toToolResult("runtime context status", await runtimeContextStatus(wikiRoot));
}
