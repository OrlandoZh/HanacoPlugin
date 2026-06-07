import { lintFixPreview, toToolResult } from "../lib/wiki-core.js?v=0.1.11";

export const name = "llm_wiki_lint_fix_preview";
export const description = "Preview low-risk lint fixes with lint-fix.sh --dry-run. It does not modify wiki files.";
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
  return toToolResult("lint fix preview", await lintFixPreview(wikiRoot));
}
