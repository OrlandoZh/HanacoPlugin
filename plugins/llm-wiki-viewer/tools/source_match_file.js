import { sourceRegistryLookup, toToolResult } from "../lib/wiki-core.js?v=0.1.14";

export const name = "llm_wiki_source_match_file";
export const description = "Match a file path against the llm-wiki source registry and return the source definition to use.";
export const parameters = {
  type: "object",
  properties: {
    filePath: {
      type: "string",
      description: "File path or filename to classify against source-registry.sh match-file."
    }
  },
  required: ["filePath"],
  additionalProperties: false
};

export async function execute(input = {}) {
  const filePath = String(input.filePath || "").trim();
  if (!filePath) throw new Error("filePath is required.");
  return toToolResult("source file match", await sourceRegistryLookup("match-file", filePath));
}
