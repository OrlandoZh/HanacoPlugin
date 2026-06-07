import { maintenanceDiagnostics, toToolResult } from "../lib/wiki-core.js?v=0.1.10";

export const name = "llm_wiki_maintenance_diagnostics";
export const description = "Run read-only llm-wiki maintenance diagnostics for orphan sources, source_path/raw file issues, duplicate titles, and purpose.md hints.";
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
  return toToolResult("maintenance diagnostics", await maintenanceDiagnostics(wikiRoot));
}
