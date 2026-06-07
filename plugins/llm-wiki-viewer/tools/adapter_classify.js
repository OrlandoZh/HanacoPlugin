import { adapterClassify, toToolResult } from "../lib/wiki-core.js?v=0.1.10";

export const name = "llm_wiki_adapter_classify";
export const description = "Classify an optional adapter extraction result using adapter-state.sh classify-run without installing or repairing anything.";
export const parameters = {
  type: "object",
  properties: {
    sourceId: {
      type: "string",
      description: "Source id from the llm-wiki source registry."
    },
    exitCode: {
      type: "integer",
      description: "Exit code returned by the adapter run."
    },
    outputPath: {
      type: "string",
      description: "Path to the adapter output text file to inspect."
    }
  },
  required: ["sourceId", "exitCode", "outputPath"],
  additionalProperties: false
};

export async function execute(input = {}) {
  return toToolResult("adapter classify", await adapterClassify(input));
}
