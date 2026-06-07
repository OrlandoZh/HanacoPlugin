import { linkDiagnostics, toToolResult } from "../lib/wiki-core.js?v=0.1.13";

export const name = "llm_wiki_link_diagnostics";
export const description = "Run read-only llm-wiki Markdown link diagnostics for broken links, orphan pages, and duplicate page titles.";
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
  return toToolResult("link diagnostics", await linkDiagnostics(wikiRoot));
}
