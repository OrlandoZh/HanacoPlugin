import { adapterStatus, toToolResult } from "../lib/wiki-core.js?v=0.1.14";

export const name = "llm_wiki_adapter_status";
export const description = "Report optional llm-wiki adapter status. With sourceId, checks one source; without sourceId, returns a human summary.";
export const parameters = {
  type: "object",
  properties: {
    sourceId: {
      type: "string",
      description: "Optional source id from the llm-wiki source registry, for example web_article or youtube_video."
    }
  },
  additionalProperties: false
};

export async function execute(input = {}) {
  return toToolResult("adapter status", await adapterStatus(input));
}
