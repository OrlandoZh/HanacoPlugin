import { initWiki, toToolResult } from "../lib/wiki-core.js?v=0.1.10";

export const name = "llm_wiki_init";
export const description = "Initialize a new llm-wiki root with Chinese or English seed files.";
export const parameters = {
  type: "object",
  properties: {
    wikiRoot: {
      type: "string",
      description: "Absolute path where the llm-wiki root should be created."
    },
    topic: {
      type: "string",
      description: "Wiki topic or research theme. Defaults to 我的知识库."
    },
    language: {
      type: "string",
      enum: ["zh", "en"],
      description: "Seed language. Defaults to zh."
    }
  },
  required: ["wikiRoot"],
  additionalProperties: false
};

export async function execute(input = {}) {
  const wikiRoot = String(input.wikiRoot || "").trim();
  if (!wikiRoot) throw new Error("wikiRoot is required.");
  return toToolResult("init", await initWiki({ ...input, wikiRoot }));
}
