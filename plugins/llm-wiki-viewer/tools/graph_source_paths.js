import { graphSourcePaths, toToolResult } from "../lib/wiki-core.js?v=0.1.10";

export const name = "llm_wiki_graph_source_paths";
export const description = "Check graph-data.json node source_path coverage and whether source Markdown files can be opened through the viewer.";
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
  return toToolResult("graph source path diagnostics", await graphSourcePaths(wikiRoot));
}
