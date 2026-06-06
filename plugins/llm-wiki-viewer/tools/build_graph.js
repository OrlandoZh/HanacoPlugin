import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const HOME = process.env.HOME || process.env.USERPROFILE || "";
const SKILL_ROOT = process.env.LLM_WIKI_SKILL_ROOT
  || path.join(HOME, ".hanako", "skills", "obsidian-wiki-manager", "references", "llm-wiki");

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
  const dataScript = path.join(SKILL_ROOT, "scripts", "build-graph-data.sh");
  const htmlScript = path.join(SKILL_ROOT, "scripts", "build-graph-html.sh");
  const data = await run("bash", [dataScript, wikiRoot], { timeout: 60000 });
  const html = await run("bash", [htmlScript, wikiRoot], { timeout: 60000 });
  const graphPath = path.join(wikiRoot, "wiki", "knowledge-graph.html");
  return {
    content: [{ type: "text", text: `LLM Wiki graph built: ${graphPath}` }],
    details: {
      ok: true,
      wikiRoot,
      graphPath,
      stdout: [data.stdout, html.stdout].filter(Boolean).join("\n"),
      stderr: [data.stderr, html.stderr].filter(Boolean).join("\n")
    }
  };
}
