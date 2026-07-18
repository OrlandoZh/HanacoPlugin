export const PUBLIC_WORKFLOW_TOOL_NAMES = Object.freeze([
  "browser_action",
  "browser_attach_tab",
  "browser_detach_tab",
  "browser_detect_modals",
  "browser_dom",
  "browser_eval",
  "browser_health",
  "browser_import_batch",
  "browser_list_tabs",
  "browser_navigate",
  "browser_new_tab",
  "browser_press_key",
  "browser_read_counters",
  "browser_type_sequence",
  "browser_type_text",
]);

// browser_connect is registered only inside the private stdio child. HanaAgent never
// receives an adapter for it; browser_bridge_start uses it to make the reviewed action
// itself consume the single Chrome consent attempt without reading tab metadata.
export const INTERNAL_MCP_TOOL_NAMES = Object.freeze(["browser_connect"]);

export const EXISTING_CHROME_CONNECT_TIMEOUT_MS = 30000;

export const MCP_ALLOWLIST_TOOL_NAMES = Object.freeze([
  ...PUBLIC_WORKFLOW_TOOL_NAMES,
  ...INTERNAL_MCP_TOOL_NAMES,
]);

const PUBLIC_WORKFLOW_TOOL_SET = new Set(PUBLIC_WORKFLOW_TOOL_NAMES);

export function publicWorkflowTools(toolNames = []) {
  return toolNames.filter((name) => PUBLIC_WORKFLOW_TOOL_SET.has(name)).sort();
}
