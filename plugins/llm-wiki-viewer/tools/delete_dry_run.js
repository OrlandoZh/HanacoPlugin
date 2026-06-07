import { deleteDryRun, toToolResult } from "../lib/wiki-core.js?v=0.1.11";

export const name = "llm_wiki_delete_dry_run";
export const description = "Dry-run llm-wiki source deletion by listing wiki pages that reference a source file. It never deletes files.";
export const parameters = {
  type: "object",
  properties: {
    wikiRoot: {
      type: "string",
      description: "Absolute path to an initialized llm-wiki root containing .wiki-schema.md and wiki/."
    },
    sourceFile: {
      type: "string",
      description: "Source/raw filename or path fragment to scan for references."
    }
  },
  required: ["wikiRoot", "sourceFile"],
  additionalProperties: false
};

export async function execute(input = {}) {
  const wikiRoot = String(input.wikiRoot || "").trim();
  if (!wikiRoot) throw new Error("wikiRoot is required.");
  return toToolResult("delete dry-run", await deleteDryRun({ ...input, wikiRoot }));
}
