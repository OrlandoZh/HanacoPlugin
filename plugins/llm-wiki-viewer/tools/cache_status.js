import { cacheStatus, toToolResult } from "../lib/wiki-core.js?v=0.1.14";

export const name = "llm_wiki_cache_status";
export const description = "Check llm-wiki cache state for one file using cache.sh check. It does not update or invalidate cache entries.";
export const parameters = {
  type: "object",
  properties: {
    wikiRoot: {
      type: "string",
      description: "Absolute path to an initialized llm-wiki root containing .wiki-schema.md and wiki/."
    },
    filePath: {
      type: "string",
      description: "Raw or wiki file path to check. Relative paths are resolved under wikiRoot."
    }
  },
  required: ["wikiRoot", "filePath"],
  additionalProperties: false
};

export async function execute(input = {}) {
  const wikiRoot = String(input.wikiRoot || "").trim();
  if (!wikiRoot) throw new Error("wikiRoot is required.");
  return toToolResult("cache status", await cacheStatus({ ...input, wikiRoot }));
}
