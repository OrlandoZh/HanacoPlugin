import fs from "node:fs";
import path from "node:path";

const BUILTIN_INTEGRATIONS = [
  {
    id: "mcp-connectors",
    name: "MCP 连接器（MCP Connectors）",
    kind: "mcp",
    category: "工具（Tools）",
    description: "OpenHanako MCP 连接器运行时与按智能体（Agent）启用工具。",
    source: "openhanako-plugin:mcp",
    risk: "medium",
    actions: [
      {
        id: "mcp.global.enabled",
        label: "启用 MCP（Enable MCP）",
        payload: { enabled: true },
        risk: "medium"
      }
    ]
  },
  {
    id: "agent-skills",
    name: "智能体技能（Agent Skills）",
    kind: "skill",
    category: "技能（Skills）",
    description: "由所选 OpenHanako 智能体（Agent）暴露的技能。",
    source: "hana-bus:agent:skills",
    risk: "low"
  },
  {
    id: "skill-bundles",
    name: "技能包（Skill Bundles）",
    kind: "skill-bundle",
    category: "技能（Skills）",
    description: "OpenHanako 技能包的导入/导出与智能体（Agent）技能包启用。",
    source: "openhanako:skill-bundles",
    risk: "medium"
  },
  {
    id: "runtime-tasks",
    name: "运行时任务（Runtime Tasks）",
    kind: "runtime",
    category: "自动化（Automation）",
    description: "HanaAgent 任务与自动巡航（Autopilot）使用的主机任务/延迟任务运行时。",
    source: "hana-bus:task/deferred",
    risk: "medium"
  },
  {
    id: "workspace-files",
    name: "工作区文件（Workspace Files）",
    kind: "workspace",
    category: "IDE",
    description: "面向文件编辑器和产物预览面的受控工作区根目录。",
    source: "hanaagent:workspaceRoots",
    risk: "medium"
  }
];

export async function buildIntegrationCatalog(ctx, input = {}) {
  const agentId = clean(input.agentId);
  const [mcp, skills] = await Promise.all([
    readMcpState(ctx, { agentId }),
    readAgentSkills(ctx, { agentId }),
  ]);
  const plugins = readPluginManifests(ctx);
  const busCapabilities = listBusCapabilities(ctx);
  const items = [
    ...BUILTIN_INTEGRATIONS.map((item) => normalizeItem(item)),
    ...mcp.connectors.map(connectorToItem),
    ...skills.skills.map(skillToItem),
    ...plugins.map(pluginToItem),
    ...busCapabilities.map(capabilityToItem)
  ].filter(Boolean);
  const deduped = dedupeItems(items);
  const categories = summarizeBy(deduped, "category");
  const kinds = summarizeBy(deduped, "kind");
  const health = summarizeHealth(deduped, { mcp, skills });
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    items: deduped,
    categories,
    kinds,
    health,
    sources: {
      mcp: mcp.ok,
      skills: skills.ok,
      plugins: plugins.length,
      busCapabilities: busCapabilities.length
    },
    errors: [mcp.error, skills.error].filter(Boolean)
  };
}

export async function applyIntegrationAction(ctx, input = {}) {
  const action = clean(input.action);
  if (!action) return { ok: false, error: "action_required" };
  if (typeof ctx?.bus?.request !== "function") return { ok: false, error: "hana_bus_unavailable" };
  if (action === "skill.toggle") return applySkillToggle(ctx, input);
  if (!isAllowedMcpAction(action)) return { ok: false, error: "unsupported_action" };
  try {
    const result = await ctx.bus.request("mcp:settings-action", {
      action,
      payload: input.payload && typeof input.payload === "object" ? input.payload : {},
      agentId: clean(input.agentId) || null
    });
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error?.message || "integration_action_failed" };
  }
}

async function applySkillToggle(ctx, input = {}) {
  const agentId = clean(input.agentId);
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const skillId = clean(payload.skillId || payload.id || input.skillId);
  if (!agentId) return { ok: false, error: "agentId_required" };
  if (!skillId) return { ok: false, error: "skillId_required" };
  if (!hasCapability(ctx, "agent:update-config")) return { ok: false, error: "agent_update_config_unavailable" };
  try {
    const config = await readAgentConfig(ctx, agentId);
    const current = normalizeEnabledSkills(config);
    const enabled = payload.enabled !== false;
    const nextSet = new Set(current);
    if (enabled) nextSet.add(skillId);
    else nextSet.delete(skillId);
    const next = [...nextSet].sort();
    const result = await ctx.bus.request("agent:update-config", {
      agentId,
      partial: { skills: { ...(config?.skills && typeof config.skills === "object" ? config.skills : {}), enabled: next } }
    });
    if (result?.error) return { ok: false, error: result.error };
    return {
      ok: true,
      result,
      settingsUpdate: {
        status: "applied",
        action: "skill.toggle",
        key: `agent.${agentId}.skills.${skillId}`,
        title: enabled ? "技能已启用" : "技能已禁用",
        summary: `${skillId} 已对智能体（Agent）${agentId}${enabled ? "启用" : "禁用"}。`,
        changes: [{ key: skillId, label: skillId, before: current.includes(skillId) ? "enabled" : "disabled", after: enabled ? "enabled" : "disabled" }]
      }
    };
  } catch (error) {
    return { ok: false, error: error?.message || "skill_toggle_failed" };
  }
}

async function readMcpState(ctx, input = {}) {
  if (ctx?._mcpRuntime && typeof ctx._mcpRuntime.getState === "function") {
    try {
      const agentConfig = input.agentId ? await readAgentConfig(ctx, input.agentId) : null;
      const state = ctx._mcpRuntime.getState(agentConfig);
      return { ok: true, connectors: normalizeMcpConnectors(state.connectors || state.servers), state };
    } catch (error) {
      return { ok: false, error: `mcp_state_failed:${error?.message || error}`, connectors: [] };
    }
  }
  try {
    const config = typeof ctx?.config?.get === "function" ? ctx.config.get("mcp") : null;
    const connectors = Array.isArray(config?.connectors) ? config.connectors : [];
    return { ok: true, connectors: normalizeMcpConnectors(connectors), state: { enabled: config?.enabled === true, connectors } };
  } catch (error) {
    return { ok: false, error: `mcp_config_failed:${error?.message || error}`, connectors: [] };
  }
}

async function readAgentConfig(ctx, agentId) {
  if (!agentId || typeof ctx?.bus?.request !== "function") return null;
  const result = await ctx.bus.request("agent:config", { agentId });
  return result?.config || null;
}

async function readAgentSkills(ctx, input = {}) {
  if (typeof ctx?.bus?.request !== "function") return { ok: false, error: "hana_bus_unavailable", skills: [] };
  try {
    const result = await ctx.bus.request("agent:skills", input.agentId ? { agentId: input.agentId } : {});
    return { ok: true, skills: normalizeSkills(result?.skills) };
  } catch (error) {
    return { ok: false, error: `agent_skills_failed:${error?.message || error}`, skills: [] };
  }
}

function readPluginManifests(ctx) {
  const dirs = [
    path.resolve(ctx?.dataDir || "", "..", "..", "plugins"),
    path.resolve(ctx?.dataDir || "", "..", "..", "..", "plugins")
  ];
  const manifests = [];
  const seen = new Set();
  for (const dir of dirs) {
    if (!dir || seen.has(dir) || !fs.existsSync(dir)) continue;
    seen.add(dir);
    for (const entry of safeReadDir(dir)) {
      const manifestPath = path.join(dir, entry, "manifest.json");
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        manifests.push({ ...manifest, manifestPath });
      } catch {
        // Ignore malformed external plugin manifests.
      }
    }
  }
  return manifests;
}

function normalizeMcpConnectors(connectors) {
  return (Array.isArray(connectors) ? connectors : []).map((connector) => ({
    id: clean(connector.id || connector.name),
    name: clean(connector.name || connector.id),
    kind: "mcp",
    status: clean(connector.status) || (connector.autoStart ? "auto-start" : "configured"),
    transport: clean(connector.transport || connector.type),
    enabled: connector.enabled !== false,
    toolCount: Array.isArray(connector.tools) ? connector.tools.length : Object.keys(connector.tools || {}).length,
    authStatus: clean(connector.authStatus || connector.authType),
    description: clean(connector.description),
    source: connector.url ? "remote" : connector.command ? "stdio" : "mcp"
  })).filter((connector) => connector.id);
}

function normalizeSkills(skills) {
  return (Array.isArray(skills) ? skills : []).map((skill) => ({
    id: clean(skill.id || skill.name),
    name: clean(skill.name || skill.id),
    description: clean(skill.description || skill.summary),
    enabled: skill.enabled !== false,
    category: clean(skill.category) || "技能（Skills）",
    source: clean(skill.source || skill.path || skill.baseDir)
  })).filter((skill) => skill.id);
}

function connectorToItem(connector) {
  return normalizeItem({
    id: `mcp:${connector.id}`,
    name: connector.name,
    kind: "mcp",
    category: "MCP",
    description: connector.description || `${connector.transport || "mcp"} 连接器`,
    source: connector.source,
    status: connector.status,
    enabled: connector.enabled,
    risk: connector.authStatus === "missing" ? "high" : "medium",
    meta: { toolCount: connector.toolCount, authStatus: connector.authStatus, transport: connector.transport },
    actions: buildMcpActions(connector)
  });
}

function skillToItem(skill) {
  return normalizeItem({
    id: `skill:${skill.id}`,
    name: skill.name,
    kind: "skill",
    category: skill.category || "技能（Skills）",
    description: skill.description,
    source: skill.source || "agent:skills",
    status: skill.enabled ? "enabled" : "disabled",
    enabled: skill.enabled,
    risk: "low",
    meta: { skillId: skill.id },
    actions: buildSkillActions(skill)
  });
}

function pluginToItem(plugin) {
  return normalizeItem({
    id: `plugin:${plugin.id || plugin.name}`,
    name: plugin.name || plugin.id,
    kind: "plugin",
    category: "插件（Plugins）",
    description: plugin.description || "",
    source: plugin.manifestPath || "plugin",
    status: "installed",
    enabled: true,
    risk: plugin.trust === "full-access" ? "medium" : "low",
    meta: { version: plugin.version, trust: plugin.trust }
  });
}

function capabilityToItem(capability) {
  return normalizeItem({
    id: `capability:${capability.type}`,
    name: capability.type,
    kind: "capability",
    category: "主机能力（Host Capabilities）",
    description: capability.available === false ? "主机能力不可用" : "主机能力可用",
    source: "hana-bus",
    status: capability.available === false ? "unavailable" : "available",
    enabled: capability.available !== false,
    risk: "low"
  });
}

function normalizeItem(item) {
  const id = clean(item.id);
  const name = clean(item.name || item.label || id);
  if (!id || !name) return null;
  return {
    id,
    name,
    kind: clean(item.kind) || "integration",
    category: clean(item.category) || "集成（Integrations）",
    description: clean(item.description),
    source: clean(item.source),
    status: clean(item.status) || (item.enabled === false ? "disabled" : "available"),
    enabled: item.enabled !== false,
    risk: clean(item.risk) || "low",
    meta: item.meta && typeof item.meta === "object" ? item.meta : {},
    actions: normalizeActions(item.actions)
  };
}

function buildMcpActions(connector) {
  const connectorId = connector.id;
  const running = ["running", "connected", "ready"].includes(clean(connector.status).toLowerCase());
  return [
    {
      id: running ? "mcp.connector.stop" : "mcp.connector.start",
      label: running ? "停止（Stop）" : "启动（Start）",
      payload: { connectorId },
      risk: "medium"
    },
    {
      id: "mcp.connector.refresh_tools",
      label: "刷新工具（Refresh Tools）",
      payload: { connectorId },
      risk: "low"
    },
    {
      id: "mcp.agent.connector.enable",
      label: connector.enabled === false ? "为智能体（Agent）启用" : "为智能体（Agent）禁用",
      payload: { connectorId, enabled: connector.enabled === false },
      risk: "medium"
    }
  ];
}

function buildSkillActions(skill) {
  return [
    {
      id: "skill.toggle",
      label: skill.enabled ? "禁用（Disable）" : "启用（Enable）",
      payload: { skillId: skill.id, enabled: !skill.enabled },
      risk: "medium"
    }
  ];
}

function normalizeActions(actions) {
  return (Array.isArray(actions) ? actions : []).map((action) => ({
    id: clean(action.id || action.action),
    label: clean(action.label || action.id || action.action),
    payload: action.payload && typeof action.payload === "object" ? action.payload : {},
    risk: clean(action.risk) || "low"
  })).filter((action) => action.id && action.label);
}

function isAllowedMcpAction(action) {
  return new Set([
    "mcp.global.enabled",
    "mcp.connector.start",
    "mcp.connector.stop",
    "mcp.connector.refresh_tools",
    "mcp.agent.connector.enable",
    "mcp.agent.tool.enable"
  ]).has(action);
}

function normalizeEnabledSkills(config) {
  const enabled = config?.skills?.enabled;
  if (Array.isArray(enabled)) return enabled.map(clean).filter(Boolean);
  if (enabled && typeof enabled === "object") {
    return Object.entries(enabled)
      .filter(([, value]) => value !== false)
      .map(([key]) => clean(key))
      .filter(Boolean);
  }
  return [];
}

function dedupeItems(items) {
  const byId = new Map();
  for (const item of items) {
    if (!item || byId.has(item.id)) continue;
    byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

function summarizeBy(items, key) {
  const summary = {};
  for (const item of items) {
    const value = item[key] || "unknown";
    summary[value] = (summary[value] || 0) + 1;
  }
  return summary;
}

function summarizeHealth(items, { mcp, skills }) {
  const disabled = items.filter((item) => item.enabled === false).length;
  const highRisk = items.filter((item) => item.risk === "high").length;
  const unavailable = items.filter((item) => ["unavailable", "failed", "error"].includes(item.status)).length;
  return {
    status: highRisk || unavailable ? "needs-attention" : "ready",
    total: items.length,
    disabled,
    highRisk,
    unavailable,
    mcpConnectors: mcp.connectors.length,
    skills: skills.skills.length
  };
}

function listBusCapabilities(ctx) {
  try {
    const capabilities = ctx?.bus?.listCapabilities?.();
    return Array.isArray(capabilities) ? capabilities.map((item) => ({ type: clean(item.type), available: item.available !== false })).filter((item) => item.type) : [];
  } catch {
    return [];
  }
}

function hasCapability(ctx, type) {
  return listBusCapabilities(ctx).some((capability) => capability.type === type && capability.available !== false);
}

function safeReadDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
