import { buildGraph, toToolResult } from "../lib/wiki-core.js?v=0.1.12";

export const name = "llm_wiki_build_graph";
export const description = "Build graph-data.json and knowledge-graph.html for an initialized llm-wiki root so it can be viewed in the LLM Wiki Viewer page.";
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
  return toToolResult("graph build", await buildGraph(wikiRoot));
}
