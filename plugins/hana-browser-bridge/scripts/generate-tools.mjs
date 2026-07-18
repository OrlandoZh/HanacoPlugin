import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveBridgeSource } from "./resolve-bridge-source.mjs";

import { PUBLIC_WORKFLOW_TOOL_NAMES } from "../lib/tool-profile.js";

const WORKFLOW_TOOLS = PUBLIC_WORKFLOW_TOOL_NAMES;
const READ_ONLY = new Set(["browser_health", "browser_list_tabs", "browser_read_counters"]);
const REQUIRED_PARAMETERS = new Map([
  ["browser_action", ["targetId", "action", "selector"]],
  ["browser_attach_tab", ["targetId"]],
  ["browser_detach_tab", ["targetId"]],
  ["browser_detect_modals", ["targetId"]],
  ["browser_dom", ["targetId", "expression"]],
  ["browser_eval", ["targetId", "expression"]],
  ["browser_import_batch", ["targetId", "selector", "codes"]],
  ["browser_navigate", ["targetId", "url"]],
  ["browser_press_key", ["targetId", "key"]],
  ["browser_read_counters", ["targetId"]],
  ["browser_type_sequence", ["targetId", "selector", "texts"]],
  ["browser_type_text", ["targetId", "selector", "value"]],
]);
const here = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(here, "..");
const bridgeDir = resolveBridgeSource(pluginDir);
const toolsDir = path.join(pluginDir, "tools");

for (const toolName of WORKFLOW_TOOLS) {
  const sourcePath = path.join(bridgeDir, "tools", `${toolName}.js`);
  const mod = await import(`${pathToFileURL(sourcePath).href}?generate=${Date.now()}`);
  if (mod.name !== toolName || typeof mod.execute !== "function" || !mod.parameters) {
    throw new Error(`Invalid source tool: ${toolName}`);
  }
  // browser-bridge core tools expose a shorthand map of property definitions.
  // HanaAgent expects a complete JSON Schema object; passing the shorthand made
  // parameterized tools appear to the model with no usable properties, so calls
  // were emitted as `{}`. Keep the source contract unchanged and adapt it here.
  const parameters = {
    type: "object",
    properties: mod.parameters,
    required: REQUIRED_PARAMETERS.get(toolName) || [],
    additionalProperties: false,
  };
  const permission = READ_ONLY.has(toolName) ? "READ_ONLY_PERMISSION" : "SIDE_EFFECT_PERMISSION";
  const source = `// Generated from browser-bridge/tools/${toolName}.js. Do not edit manually.\n` +
`import { executeProxyTool, ${permission} } from "../lib/tool-proxy.js";\n\n` +
`export const name = ${JSON.stringify(mod.name)};\n` +
`export const description = ${JSON.stringify(mod.description)};\n` +
`export const parameters = ${JSON.stringify(parameters, null, 2)};\n` +
`export const sessionPermission = ${permission};\n` +
`export async function execute(input, ctx) { return await executeProxyTool(name, input, ctx); }\n`;
  fs.writeFileSync(path.join(toolsDir, `${toolName}.js`), source);
}
console.log(`Generated ${WORKFLOW_TOOLS.length} Hana tool adapters from ${bridgeDir}`);
