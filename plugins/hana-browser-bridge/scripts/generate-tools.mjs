import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveBridgeSource } from "./resolve-bridge-source.mjs";

const WORKFLOW_TOOLS = [
  "browser_action", "browser_attach_tab", "browser_detach_tab", "browser_detect_modals",
  "browser_dom", "browser_eval", "browser_health", "browser_import_batch", "browser_list_tabs",
  "browser_navigate", "browser_new_tab", "browser_press_key", "browser_read_counters",
  "browser_type_sequence", "browser_type_text",
];
const READ_ONLY = new Set(["browser_health", "browser_list_tabs", "browser_read_counters"]);
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
  const permission = READ_ONLY.has(toolName) ? "READ_ONLY_PERMISSION" : "SIDE_EFFECT_PERMISSION";
  const source = `// Generated from browser-bridge/tools/${toolName}.js. Do not edit manually.\n` +
`import { executeProxyTool, ${permission} } from "../lib/tool-proxy.js";\n\n` +
`export const name = ${JSON.stringify(mod.name)};\n` +
`export const description = ${JSON.stringify(mod.description)};\n` +
`export const parameters = ${JSON.stringify(mod.parameters, null, 2)};\n` +
`export const sessionPermission = ${permission};\n` +
`export async function execute(input, ctx) { return await executeProxyTool(name, input, ctx); }\n`;
  fs.writeFileSync(path.join(toolsDir, `${toolName}.js`), source);
}
console.log(`Generated ${WORKFLOW_TOOLS.length} Hana tool adapters from ${bridgeDir}`);
