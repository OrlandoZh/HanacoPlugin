import { sourceRegistry, toToolResult } from "../lib/wiki-core.js?v=0.1.13";

export const name = "llm_wiki_source_registry";
export const description = "List llm-wiki source registry definitions as structured data.";
export const parameters = {
  type: "object",
  properties: {},
  additionalProperties: false
};

export async function execute() {
  return toToolResult("source registry", await sourceRegistry());
}
