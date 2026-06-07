import { getStatus, toToolResult } from "../lib/wiki-core.js?v=0.1.12";

export const name = "llm_wiki_status";
export const description = "Check whether a path is an initialized llm-wiki root and report graph/lint readiness.";
export const parameters = {
  type: "object",
  properties: {
    wikiRoot: {
      type: "string",
      description: "Absolute path to an llm-wiki root."
    }
  },
  required: ["wikiRoot"],
  additionalProperties: false
};

export async function execute(input = {}) {
  const wikiRoot = String(input.wikiRoot || "").trim();
  if (!wikiRoot) throw new Error("wikiRoot is required.");
  const status = await getStatus(wikiRoot);
  return toToolResult("status check", {
    ok: status.ok,
    wikiRoot: status.wikiRoot,
    skillRoot: status.skillRoot,
    status,
  });
}
