import { sourceImageDiagnostics, toToolResult } from "../lib/wiki-core.js?v=0.1.10";

export const name = "llm_wiki_source_image_diagnostics";
export const description = "Run read-only llm-wiki source image diagnostics for image_paths consistency and missing local assets.";
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
  return toToolResult("source image diagnostics", await sourceImageDiagnostics(wikiRoot));
}
