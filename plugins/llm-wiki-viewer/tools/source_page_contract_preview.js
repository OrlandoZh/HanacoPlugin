import { sourcePageContractPreview, toToolResult } from "../lib/wiki-core.js?v=0.1.13";

export const name = "llm_wiki_source_page_contract_preview";
export const description = "Preview create-source-page contract checks without writing source pages or updating cache.";
export const parameters = {
  type: "object",
  properties: {
    wikiRoot: {
      type: "string",
      description: "Absolute path to an initialized llm-wiki root containing .wiki-schema.md and wiki/."
    },
    rawFile: {
      type: "string",
      description: "Raw source file path. Relative paths are resolved under wikiRoot."
    },
    outputPath: {
      type: "string",
      description: "Source page output path relative to wikiRoot, for example wiki/sources/example.md."
    },
    contentFile: {
      type: "string",
      description: "Temporary content file that would be written by create-source-page.sh."
    }
  },
  required: ["wikiRoot", "rawFile", "outputPath", "contentFile"],
  additionalProperties: false
};

export async function execute(input = {}) {
  const wikiRoot = String(input.wikiRoot || "").trim();
  if (!wikiRoot) throw new Error("wikiRoot is required.");
  return toToolResult("source page contract preview", await sourcePageContractPreview({ ...input, wikiRoot }));
}
