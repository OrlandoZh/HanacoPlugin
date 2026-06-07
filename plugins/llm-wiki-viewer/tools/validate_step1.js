import { validateStep1, toToolResult } from "../lib/wiki-core.js?v=0.1.11";

export const name = "llm_wiki_validate_step1";
export const description = "Validate an ingest Step 1 JSON file using validate-step1.sh before the agent continues the llm-wiki workflow.";
export const parameters = {
  type: "object",
  properties: {
    jsonFile: {
      type: "string",
      description: "Absolute path to the Step 1 JSON file to validate."
    }
  },
  required: ["jsonFile"],
  additionalProperties: false
};

export async function execute(input = {}) {
  const jsonFile = String(input.jsonFile || "").trim();
  if (!jsonFile) throw new Error("jsonFile is required.");
  return toToolResult("Step 1 validation", await validateStep1({ jsonFile }));
}
