import path from "node:path"

import {
  buildModelSuggestions,
  getAgentConfig,
  getTemplates,
  hasBusCapability,
  listAgentSkills,
  listMemoryEntries,
  listSessions,
  listUsage,
  readMemoryEntry,
  sendSessionMessage
} from "../lib/hanaagent-core.js"
import {
  applyIntegrationAction,
  buildIntegrationCatalog
} from "../lib/integration-catalog.js"
import {
  createWorkspaceDirectory,
  deleteWorkspacePath,
  diffWorkspaceFile,
  listWorkspaceFiles,
  listWorkspaceRoots,
  readWorkspaceFile,
  renameWorkspacePath,
  uploadWorkspaceFile,
  writeWorkspaceFile
} from "../lib/workspace-files.js"
import {
  buildHandoffPrompt,
  buildWorkerLifecycle
} from "../lib/worker-lifecycle.js"
import {
  listHandoffs,
  readHandoff
} from "../lib/handoff-store.js"
import {
  buildPresetMissionInput,
  buildProfileMissionInput,
  deleteOperationProfile,
  exportOperationProfile,
  exportSwarmRoster,
  getOperationProfile,
  importOperationProfile,
  importSwarmRoster,
  listOperationPresets,
  listOperationProfiles,
  saveOperationProfile,
  seedOperationProfileFromPreset
} from "../lib/operations-profile.js"
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  listWorkflowTemplates,
  listWorkflows,
  previewWorkflowExecution,
  updateWorkflow,
  validateWorkflow
} from "../lib/workflow-store.js"
import {
  createRunRecord,
  listRunRecords,
  updateRunRecord
} from "../lib/run-store.js"
import {
  appendMissionEvent,
  createMission,
  getMission,
  listMissions
} from "../lib/mission-store.js"
import {
  listLocalMemory
} from "../lib/memory-store.js"
import {
  listCheckpoints
} from "../lib/checkpoint-store.js"
import {
  listTasks
} from "../lib/task-store.js"
import {
  getSessionHistory
} from "../lib/hanaagent-core.js"
import {
  cleanString,
  clampNumber,
  clampRouteNumber,
  downloadFilename,
  firstCompatLine,
  overviewMissionItems,
  readJson,
  validateWorkspacePatchRecord,
  PROVIDER_SETUP_CATALOG,
  normalizeModelMetadataConfig,
  normalizePinnedModels,
  normalizeWorkbenchSettings
} from "./workbench-utils.js"

// Cross-module dependencies — assigned in registerCoreRoutes from workbench.js
let buildOverview = null
let buildWorkerDrilldown = null
let buildAgentOutputs = null
let buildSwarmActivity = null
let buildWorkerArtifacts = null
let launchAssignmentWorkerSession = null
let createMissionTasks = null
let createWorkflowMission = null

function isHttpOrOpenHanakoUrl(value) {
  const text = cleanString(value);
  if (!text) return true;
  if (text.startsWith("openhanako://")) return true;
  try {
    const parsed = new URL(text);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}


function workspaceEntryToHermesFileEntry(entry = {}) {
  return {
    name: entry.name,
    path: entry.relativePath || entry.path || "",
    type: entry.type === "directory" ? "folder" : "file",
    size: entry.size,
    modifiedAt: entry.updatedAt,
    kind: entry.kind,
    relativePath: entry.relativePath || ""
  };
}

function workspaceFileStatus(result = {}) {
  if (result.error === "file_not_found" || result.error === "workspace_root_not_found") return 404;
  if (result.error === "file_too_large" || result.error === "content_too_large") return 413;
  if (result.error === "path_exists") return 409;
  if (result.error === "root_readonly" || result.error === "path_not_allowed" || result.error === "symlink_not_allowed") return 403;
  return 422;
}


function handleHermesFilesGetCompat(ctx, input = {}) {
  const action = cleanString(input.action) || "list";
  const rootId = cleanString(input.rootId);
  const filePath = cleanString(input.path) || ".";
  if (action === "read") {
    const result = readWorkspaceFile(ctx, { rootId, path: filePath });
    if (!result.ok) return { status: workspaceFileStatus(result), body: result };
    const isImage = result.kind === "image";
    return {
      status: 200,
      body: {
        ok: true,
        type: isImage ? "image" : "text",
        path: result.relativePath,
        rootId: result.root?.id || rootId || "plugin-data",
        base: result.root?.path || "",
        content: isImage
          ? `data:${result.mime || "application/octet-stream"};base64,${result.content || ""}`
          : result.content || "",
        encoding: isImage ? "data-url" : "utf8",
        size: result.size,
        writable: result.writable,
        source: "hanaagent-workspace-file"
      }
    };
  }
  if (action === "download") {
    const result = readWorkspaceFile(ctx, { rootId, path: filePath });
    if (!result.ok) return { status: workspaceFileStatus(result), body: result };
    return {
      response(c) {
        const filename = downloadFilename(result.relativePath || result.path || "workspace-file");
        c.header("content-type", result.mime || "application/octet-stream");
        c.header("content-disposition", `attachment; filename="${filename}"`);
        if (result.encoding === "base64") return c.body(Buffer.from(result.content || "", "base64"));
        return c.body(result.content || "");
      }
    };
  }
  if (action && action !== "list") {
    return { status: 400, body: { ok: false, error: "unsupported_action", action } };
  }
  const result = listWorkspaceFiles(ctx, {
    rootId,
    path: filePath,
    depth: input.maxDepth,
    maxEntries: input.maxEntries
  });
  if (!result.ok) return { status: workspaceFileStatus(result), body: result };
  return {
    status: 200,
    body: {
      ok: true,
      root: result.relativePath === "." ? "" : result.relativePath,
      base: result.root?.path || "",
      rootId: result.root?.id || rootId || "plugin-data",
      entries: result.entries.map(workspaceEntryToHermesFileEntry),
      truncated: result.truncated,
      source: "hanaagent-workspace-files"
    }
  };
}

async function handleHermesFilesPostCompat(ctx, c) {
  const body = await readJson(c);
  const action = cleanString(body.action) || "write";
  const rootId = cleanString(body.rootId);
  let result;
  if (action === "mkdir") result = createWorkspaceDirectory(ctx, { rootId, path: body.path });
  else if (action === "rename") result = renameWorkspacePath(ctx, { rootId, from: body.from || body.path, to: body.to || body.newPath || body.name });
  else if (action === "delete") result = deleteWorkspacePath(ctx, { rootId, path: body.path });
  else if (action === "write" || action === "upload") result = writeWorkspaceFile(ctx, { rootId, path: body.path, content: body.content });
  else result = { ok: false, error: "unsupported_action", action };
  if (!result.ok) return { status: workspaceFileStatus(result), body: result };
  return {
    status: 200,
    body: {
      ok: true,
      action,
      path: result.relativePath || result.to || result.deleted || cleanString(body.path),
      rootId: result.root?.id || rootId || "plugin-data",
      file: result.kind ? {
        type: result.kind === "image" ? "image" : "text",
        path: result.relativePath,
        content: result.content,
        size: result.size,
        writable: result.writable
      } : undefined,
      source: "hanaagent-workspace-files"
    }
  };
}


function hermesCapabilityMap(capabilities = {}) {
  return {
    health: true,
    chatCompletions: Boolean(capabilities.sessionSend),
    models: true,
    streaming: Boolean(capabilities.sessionEvents || capabilities.sessionSend),
    sessions: Boolean(capabilities.sessionList || capabilities.sessionCreate || capabilities.sessionSend || capabilities.sessionHistory),
    skills: Boolean(capabilities.agentSkills),
    memory: Boolean(capabilities.memoryList),
    config: true,
    jobs: true,
    mcp: Boolean(capabilities.mcp || capabilities.agentSkills),
    mcpFallback: true,
    conductor: true,
    kanban: true,
    enhancedChat: Boolean(capabilities.sessionHistory || capabilities.sessionEvents),
    dashboard: true
  };
}


async function buildHermesModelsCompat(ctx, input = {}) {
  const config = ctx.config?.getAll?.() || {};
  const agentId = cleanString(input.agentId || config.defaultAgentId);
  let agentConfig = {};
  if (agentId && hasBusCapability(ctx, "agent:config")) {
    try {
      const result = await getAgentConfig(ctx, { agentId });
      if (!result.ok && result.error) {
        agentConfig = {
          modelLookupWarning: result.error,
          agentId
        };
      }
      if (result.ok) agentConfig = result.config || {};
    } catch (error) {
      agentConfig = {
        modelLookupWarning: error?.message || "agent_config_failed",
        agentId
      };
    }
  }
  const models = [];
  const add = (item = {}, source = "metadata") => {
    const id = cleanString(item.id || item.model || item.modelId || item.name);
    if (!id) return;
    const provider = cleanString(item.provider || item.owned_by) || (id.includes("/") ? id.split("/")[0] : "openhanako");
    if (models.some((model) => model.id === id && model.provider === provider)) return;
    models.push({
      ...item,
      id,
      name: cleanString(item.name || item.label || item.displayName) || id,
      provider,
      source,
      contextWindow: Number(item.contextWindow || item.contextTokens || item.maxContextTokens || 0) || undefined,
      inputCostPer1M: Number(item.inputCostPer1M || item.promptCostPer1M || 0) || undefined,
      outputCostPer1M: Number(item.outputCostPer1M || item.completionCostPer1M || 0) || undefined
    });
  };
  for (const item of Array.isArray(config.modelMetadata) ? config.modelMetadata : []) add(item, "modelMetadata");
  for (const item of Array.isArray(config.pinnedModels) ? config.pinnedModels : []) add(item, "pinnedModels");
  add({ model: agentConfig?.model || agentConfig?.models?.chat || agentConfig?.models?.default, provider: agentConfig?.provider || agentConfig?.modelProvider }, "agent-config");
  return {
    ok: true,
    object: "list",
    data: models,
    models,
    configuredProviders: [...new Set(models.map((model) => model.provider).filter(Boolean))],
    source: "openhanako-plugin-config",
    warning: agentConfig.modelLookupWarning || undefined,
    streamAcceptedTimeoutMs: 120000,
    streamHandoffTimeoutMs: 300000
  };
}


function buildHermesConfigCompat(ctx) {
  const config = ctx.config?.getAll?.() || {};
  return {
    ok: true,
    source: "hanaagent-plugin-config",
    mode: "openhanako-plugin",
    config: {
      defaultAgentId: cleanString(config.defaultAgentId),
      defaultSessionPath: cleanString(config.defaultSessionPath),
      workspaceRoots: Array.isArray(config.workspaceRoots) ? config.workspaceRoots : [],
      pinnedModels: Array.isArray(config.pinnedModels) ? normalizePinnedModels(config.pinnedModels) : [],
      modelMetadata: Array.isArray(config.modelMetadata) ? normalizeModelMetadataConfig(config.modelMetadata) : [],
      autopilotSchedule: config.autopilotSchedule || {},
      workerLifecyclePolicy: config.workerLifecyclePolicy || {},
      workbenchSettings: config.workbenchSettings || {}
    },
    env: {
      HERMES_API_URL: "openhanako://host",
      HERMES_DASHBOARD_URL: "openhanako://host",
      HANA_PLUGIN_ID: ctx.pluginId || "hanaagent"
    },
    editableKeys: ["defaultAgentId", "defaultSessionPath", "workspaceRoots", "pinnedModels", "modelMetadata", "autopilotSchedule", "workerLifecyclePolicy", "workbenchSettings"],
    note: "Hermes 配置兼容数据存储在 OpenHanako 插件配置中；HanaAgent 不会写入 ~/.hermes/config.yaml。"
  };
}


function patchHermesConfigCompat(ctx, body = {}) {
  const values = {};
  const input = body.config && typeof body.config === "object" ? { ...body.config, ...body } : body;
  if (typeof input.defaultAgentId === "string") values.defaultAgentId = input.defaultAgentId.trim();
  if (typeof input.defaultSessionPath === "string") values.defaultSessionPath = input.defaultSessionPath.trim();
  if (Array.isArray(input.workspaceRoots)) values.workspaceRoots = input.workspaceRoots.slice(0, 20);
  if (Array.isArray(input.pinnedModels)) values.pinnedModels = normalizePinnedModels(input.pinnedModels);
  if (Array.isArray(input.modelMetadata)) values.modelMetadata = normalizeModelMetadataConfig(input.modelMetadata);
  if (input.autopilotSchedule && typeof input.autopilotSchedule === "object") values.autopilotSchedule = input.autopilotSchedule;
  if (input.workerLifecyclePolicy && typeof input.workerLifecyclePolicy === "object") values.workerLifecyclePolicy = input.workerLifecyclePolicy;
  if (input.workbenchSettings && typeof input.workbenchSettings === "object") values.workbenchSettings = normalizeWorkbenchSettings(input.workbenchSettings);
  if (!Object.keys(values).length) return { ok: false, error: "no_supported_config_keys", supportedKeys: buildHermesConfigCompat(ctx).editableKeys };
  ctx.config.setMany(values);
  return { ok: true, updated: values, ...buildHermesConfigCompat(ctx) };
}


function buildHermesConnectionSettingsCompat(ctx) {
  const config = ctx.config?.getAll?.() || {};
  return {
    ok: true,
    gateway: cleanString(config.hermesGatewayUrl) || "openhanako://host",
    dashboard: cleanString(config.hermesDashboardUrl) || "openhanako://host/plugins/hanaagent/workbench",
    mode: "openhanako-plugin",
    source: "hanaagent-plugin-config",
    note: "HanaAgent 将连接覆盖项存储在插件配置中，不会写入 ~/.hermes/workspace-overrides.json。"
  };
}


function patchHermesConnectionSettingsCompat(ctx, body = {}) {
  const values = {};
  if (typeof body.gateway === "string") {
    if (body.gateway && !isHttpOrOpenHanakoUrl(body.gateway)) return { ok: false, error: "gateway must be a valid http(s) or openhanako URL" };
    values.hermesGatewayUrl = body.gateway.trim();
  }
  if (typeof body.dashboard === "string") {
    if (body.dashboard && !isHttpOrOpenHanakoUrl(body.dashboard)) return { ok: false, error: "dashboard must be a valid http(s) or openhanako URL" };
    values.hermesDashboardUrl = body.dashboard.trim();
  }
  if (!Object.keys(values).length) return { ok: false, error: "no_supported_connection_keys" };
  ctx.config.setMany(values);
  return { ok: true, ...buildHermesConnectionSettingsCompat(ctx) };
}


async function buildHermesGatewayStatusCompat(ctx) {
  const overview = await buildOverview(ctx);
  const capabilities = hermesCapabilityMap(overview.capabilities || {});
  return {
    ok: true,
    capabilities,
    mode: "openhanako-plugin",
    claudeUrl: "openhanako://host",
    dashboardUrl: "openhanako://host/plugins/hanaagent/workbench",
    gateway: {
      available: true,
      url: "openhanako://host",
      source: "hanaagent-plugin"
    },
    dashboard: {
      available: true,
      url: "openhanako://host/plugins/hanaagent/workbench",
      source: "hanaagent-workbench"
    },
    setupDoctor: overview.setupDoctor || null
  };
}


async function buildHermesConnectionStatusCompat(ctx) {
  const overview = await buildOverview(ctx);
  const capabilities = overview.capabilities || {};
  const config = ctx.config?.getAll?.() || {};
  const modelConfigured = Boolean((Array.isArray(config.modelMetadata) && config.modelMetadata.length) || (Array.isArray(config.pinnedModels) && config.pinnedModels.length));
  const chatReady = Boolean(capabilities.sessionSend || capabilities.sessionCreate);
  const enhanced = chatReady && Boolean(capabilities.sessionHistory || capabilities.agentSkills || capabilities.memoryList);
  const blocked = overview.setupDoctor?.readiness === "blocked";
  const status = blocked && !chatReady ? "disconnected" : enhanced ? "enhanced" : chatReady ? "connected" : "partial";
  return {
    status,
    label: status === "enhanced" ? "增强" : status === "connected" ? "已连接" : status === "disconnected" ? "未连接" : "部分可用",
    detail: overview.setupDoctor?.nextAction || "OpenHanako 插件能力可通过 HanaAgent 使用。",
    health: !blocked,
    chatReady,
    modelConfigured,
    activeModel: config.pinnedModels?.[0]?.model || config.modelMetadata?.[0]?.model || "",
    chatMode: enhanced ? "enhanced-claude" : chatReady ? "portable" : "disconnected",
    capabilities: hermesCapabilityMap(capabilities),
    claudeUrl: "openhanako://host"
  };
}


async function buildHermesGatewayReprobeCompat(ctx) {
  const gateway = await buildHermesGatewayStatusCompat(ctx);
  const connection = await buildHermesConnectionStatusCompat(ctx);
  return {
    ok: true,
    capabilities: gateway.capabilities,
    mode: gateway.mode,
    claudeUrl: gateway.claudeUrl,
    dashboardUrl: gateway.dashboardUrl,
    gateway: gateway.gateway,
    dashboard: gateway.dashboard,
    connection,
    source: "hanaagent-openhanako-capability-probe"
  };
}


function buildHermesAuthCheckCompat(ctx) {
  return {
    ok: true,
    authenticated: true,
    mode: "openhanako-plugin",
    pluginId: ctx.pluginId || "hanaagent",
    source: "openhanako-plugin-auth",
    note: "OpenHanako 插件路由令牌会在 HanaAgent 路由执行前完成身份验证。"
  };
}


function buildHermesAuthCompat(ctx, input = {}) {
  return {
    ok: true,
    authenticated: true,
    mode: "openhanako-plugin",
    pluginId: ctx.pluginId || "hanaagent",
    source: "openhanako-plugin-auth",
    passwordAccepted: Boolean(cleanString(input.password)),
    note: "Hermes 密码认证由 OpenHanako 宿主管理。能够访问此路由表示插件令牌和认证边界已接受该请求。"
  };
}


async function buildHermesPingCompat(ctx) {
  const connection = await buildHermesConnectionStatusCompat(ctx);
  return {
    ok: true,
    status: "ok",
    platform: "hanaagent",
    mode: "openhanako-plugin",
    checkedAt: Date.now(),
    connection
  };
}


function buildHermesWorkspaceCompat(ctx) {
  const roots = listWorkspaceRoots(ctx).roots || [];
  const primary = roots[0] || null;
  const folderName = primary?.label || (primary?.path ? path.basename(primary.path) : "hanaagent");
  return {
    ok: true,
    path: primary?.path || ctx.dataDir,
    folderName,
    source: primary ? "plugin.workspaceRoots" : "plugin.dataDir",
    isValid: true,
    workspaces: roots.map((root) => ({
      name: root.label || root.id || path.basename(root.path || ""),
      path: root.path,
      writable: root.writable !== false,
      id: root.id
    })),
    last: primary?.path || ctx.dataDir,
    mode: "openhanako-plugin",
    note: "Hermes /api/workspace 兼容范围仅限已配置的 HanaAgent 工作区根目录。"
  };
}


async function buildHermesPluginsCompat(ctx) {
  const catalog = await buildIntegrationCatalog(ctx, {});
  const plugins = (catalog.items || [])
    .filter((item) => item.kind === "plugin")
    .map((item) => ({
      id: item.id.replace(/^plugin:/, ""),
      name: item.name,
      description: item.description || "",
      status: item.status || "installed",
      enabled: item.enabled !== false,
      source: item.source || "openhanako-plugin",
      manifestPath: item.meta?.manifestPath || "",
      category: item.category || "Plugins"
    }));
  if (!plugins.some((plugin) => plugin.id === (ctx.pluginId || "hanaagent"))) {
    plugins.unshift({
      id: ctx.pluginId || "hanaagent",
      name: "HanaAgent Workbench",
      description: "OpenHanako plugin implementation of Hermes Workspace-style agent workbench.",
      status: "active",
      enabled: true,
      source: "current-plugin",
      category: "Agent Workbench"
    });
  }
  return {
    ok: true,
    plugins,
    total: plugins.length,
    source: "hanaagent-integration-catalog"
  };
}


function buildHermesMcpPresetsCompat() {
  return [
    {
      id: "local-files",
      name: "本地文件",
      description: "通过 OpenHanako MCP 配置提供的宿主管理文件工具。",
      transport: "stdio",
      trusted: true,
      source: "hanaagent"
    },
    {
      id: "browser",
      name: "Browser",
      description: "安装在 OpenHanako 中时可用的浏览器自动化连接器。",
      transport: "host",
      trusted: true,
      source: "hanaagent"
    }
  ];
}


async function buildHermesMcpHubSearchCompat(ctx, input = {}) {
  const catalog = await buildIntegrationCatalog(ctx, {});
  const query = cleanString(input.query).toLowerCase();
  const limit = clampRouteNumber(input.limit, 1, 200, 50);
  const results = (catalog.items || [])
    .filter((item) => item.kind === "mcp")
    .filter((item) => !query || [item.id, item.name, item.description, item.category].some((value) => String(value || "").toLowerCase().includes(query)))
    .slice(0, limit)
    .map((item) => ({
      id: item.id.replace(/^mcp:/, ""),
      name: item.name,
      description: item.description || "",
      category: item.category || "MCP",
      source: item.source || "openhanako",
      installed: item.enabled !== false,
      status: item.status || "configured",
      transport: item.meta?.transport || "",
      toolCount: item.meta?.toolCount || 0
    }));
  return {
    ok: true,
    results,
    total: results.length,
    source: "hanaagent-integration-catalog",
    mode: "openhanako-plugin"
  };
}


async function buildHermesMcpDiscoverCompat(ctx, input = {}) {
  const name = cleanString(input.name || input.id);
  const catalog = await buildIntegrationCatalog(ctx, {});
  const item = (catalog.items || []).find((entry) => entry.kind === "mcp" && (!name || entry.id === `mcp:${name}` || entry.name === name || entry.id.endsWith(`:${name}`)));
  const tools = item?.meta?.tools || item?.tools || [];
  return {
    ok: Boolean(item || !name),
    status: item ? "ok" : "unknown",
    tools: Array.isArray(tools) ? tools : [],
    discoveredTools: Array.isArray(tools) ? tools : [],
    error: item || !name ? undefined : "mcp_server_not_found",
    mode: "openhanako-plugin",
    source: "hanaagent-integration-catalog"
  };
}


async function buildHermesMcpTestCompat(ctx, input = {}) {
  const discovered = await buildHermesMcpDiscoverCompat(ctx, input);
  return {
    ok: discovered.ok,
    status: discovered.ok ? "ok" : "failed",
    discoveredTools: discovered.discoveredTools || [],
    latencyMs: 0,
    error: discovered.error,
    mode: "openhanako-plugin",
    source: discovered.source
  };
}


async function buildHermesMcpCompat(ctx, input = {}) {
  const catalog = await buildIntegrationCatalog(ctx, { agentId: cleanString(input.agentId) });
  const servers = (catalog.items || [])
    .filter((item) => item.kind === "mcp")
    .map((item) => ({
      id: item.id.replace(/^mcp:/, ""),
      name: item.name,
      status: item.status || (item.enabled === false ? "disabled" : "configured"),
      enabled: item.enabled !== false,
      transport: item.meta?.transport || "",
      toolCount: item.meta?.toolCount || 0,
      authStatus: item.meta?.authStatus || "",
      source: item.source || "openhanako-mcp",
      category: item.category || "MCP",
      actions: item.actions || []
    }));
  return {
    ok: true,
    servers,
    items: servers,
    total: servers.length,
    categories: ["All", "Connected", "Failed", "Disabled"],
    source: "hanaagent-integration-catalog",
    capabilityGated: !hermesCapabilityMap((await buildOverview(ctx)).capabilities || {}).mcp,
    health: catalog.health || null,
    errors: catalog.errors || []
  };
}


async function buildHermesSkillsCompat(ctx, input = {}) {
  const agentId = cleanString(input.agentId);
  const query = cleanString(input.query).toLowerCase();
  const limit = clampRouteNumber(input.limit, 1, 500, 120);
  const result = await listAgentSkills(ctx, { agentId });
  const catalog = await buildIntegrationCatalog(ctx, { agentId });
  const catalogSkills = (catalog.items || [])
    .filter((item) => item.kind === "skill")
    .map((item) => ({
      id: item.id.replace(/^skill:/, ""),
      slug: item.id.replace(/^skill:/, ""),
      name: item.name,
      description: item.description || "",
      category: item.category || "Skills",
      enabled: item.enabled !== false,
      installed: item.enabled !== false,
      sourcePath: item.source || "",
      origin: item.source ? "installed" : "marketplace",
      risk: item.risk || "low",
      actions: item.actions || []
    }));
  const busSkills = (result.skills || []).map((skill) => ({
    id: cleanString(skill.id || skill.name),
    slug: cleanString(skill.id || skill.name),
    name: cleanString(skill.name || skill.id),
    description: cleanString(skill.description || skill.summary),
    category: cleanString(skill.category) || "Skills",
    enabled: skill.enabled !== false,
    installed: skill.enabled !== false,
    sourcePath: cleanString(skill.source || skill.path || skill.baseDir),
    origin: "installed",
    risk: "low"
  }));
  const seen = new Set();
  let skills = [...busSkills, ...catalogSkills].filter((skill) => {
    if (!skill.id || seen.has(skill.id)) return false;
    seen.add(skill.id);
    if (!query) return true;
    return [skill.id, skill.name, skill.description, skill.category].some((value) => String(value || "").toLowerCase().includes(query));
  });
  const sort = cleanString(input.sort) || "name";
  skills = skills.sort((a, b) => String(a[sort] || a.name).localeCompare(String(b[sort] || b.name))).slice(0, limit);
  const categories = [...new Set(["All", ...skills.map((skill) => skill.category || "Skills")])];
  return {
    ok: result.ok || skills.length >= 0,
    skills,
    items: skills,
    total: skills.length,
    tab: cleanString(input.tab) || "installed",
    categories,
    source: result.ok ? "agent:skills" : "hanaagent-integration-catalog",
    error: result.ok ? undefined : result.error
  };
}


function getProviderSetupCatalogEntry(providerId) {
  const normalized = cleanString(providerId).toLowerCase();
  return PROVIDER_SETUP_CATALOG.find((provider) => provider.id === normalized) || null;
}

function providerDisplayName(providerId) {
  const value = cleanString(providerId);
  if (!value) return "未知模型服务商";
  return value.split(/[-_\s/]+/).filter(Boolean).map((part) => part.slice(0, 1).toUpperCase() + part.slice(1)).join(" ");
}

function buildProviderSetupConfigExample(provider = {}, authType = "api-key") {
  const providerId = cleanString(provider.id) || "provider";
  const profileKey = authType === "local" ? `${providerId}:local` : `${providerId}:default`;
  const profile = { provider: providerId };
  if (authType === "api-key") profile.apiKey = "set-in-openhanako-host-settings";
  if (authType === "oauth") profile.oauth = { enabled: true, managedBy: "openhanako-host" };
  if (authType === "cli-token") profile.token = "managed-by-openhanako-or-provider-cli";
  return JSON.stringify({ auth: { profiles: { [profileKey]: profile } } }, null, 2);
}

function buildProviderSetupRecommendedSnippet(providers = []) {
  const entries = providers
    .filter((provider) => provider.configured || provider.local)
    .slice(0, 4)
    .map((provider) => [provider.local ? `${provider.id}:local` : `${provider.id}:default`, {
      provider: provider.id,
      ...(provider.local ? {} : { secret: "host-managed" })
    }]);
  if (!entries.length) {
    entries.push(["openai:default", { provider: "openai", apiKey: "set-in-openhanako-host-settings" }]);
  }
  return JSON.stringify({ auth: { profiles: Object.fromEntries(entries) } }, null, 2);
}


function buildHermesLocalProvidersCompat(ctx) {
  const config = ctx.config?.getAll?.() || {};
  const metadata = normalizeModelMetadataConfig(config.modelMetadata || []);
  const providers = new Map();
  for (const model of metadata) {
    const provider = cleanString(model.provider || (model.model || "").split("/")[0] || "openhanako");
    if (!provider) continue;
    if (!providers.has(provider)) {
      providers.set(provider, {
        id: provider,
        name: provider,
        status: "configured",
        source: "hanaagent.modelMetadata",
        models: []
      });
    }
    providers.get(provider).models.push(model.model || model.id || model.name);
  }
  return {
    ok: true,
    providers: [...providers.values()],
    models: metadata,
    source: "hanaagent-plugin-config",
    note: "本地模型服务商发现通过 OpenHanako 插件模型元数据表示；服务商安装仍由宿主管理。"
  };
}


async function buildHermesProviderUsageCompat(ctx, input = {}) {
  const usage = await listUsage(ctx, {
    provider: input.provider,
    modelId: input.modelId,
    limit: input.limit || 500
  });
  const entries = usage.entries || [];
  const providers = new Map();
  for (const entry of entries) {
    const provider = cleanString(entry.provider || entry.model?.provider || "unknown");
    const model = cleanString(entry.modelId || entry.model?.modelId || entry.model || "unknown");
    const key = provider || "unknown";
    if (!providers.has(key)) {
      providers.set(key, {
        provider: key,
        requests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        models: {}
      });
    }
    const aggregate = providers.get(key);
    const prompt = Number(entry.promptTokens || entry.usage?.prompt_tokens || entry.usage?.input || 0) || 0;
    const completion = Number(entry.completionTokens || entry.usage?.completion_tokens || entry.usage?.output || 0) || 0;
    aggregate.requests += 1;
    aggregate.promptTokens += prompt;
    aggregate.completionTokens += completion;
    aggregate.totalTokens += prompt + completion;
    aggregate.models[model] = (aggregate.models[model] || 0) + prompt + completion;
  }
  return {
    ok: usage.ok,
    updatedAt: Date.now(),
    providers: [...providers.values()],
    entries,
    summary: usage.summary || {},
    source: "openhanako-usage-ledger",
    error: usage.ok ? undefined : usage.error
  };
}


async function buildHermesProviderSetupCompat(ctx, input = {}) {
  const [models, localProviders, usage, connection] = await Promise.all([
    buildHermesModelsCompat(ctx, { agentId: input.agentId || "" }),
    Promise.resolve(buildHermesLocalProvidersCompat(ctx)),
    buildHermesProviderUsageCompat(ctx, { limit: 500 }),
    buildHermesConnectionStatusCompat(ctx)
  ]);
  const modelRows = Array.isArray(models.models) ? models.models : [];
  const localRows = Array.isArray(localProviders.providers) ? localProviders.providers : [];
  const usageRows = Array.isArray(usage.providers) ? usage.providers : [];
  const configuredProviders = new Set([
    ...((models.configuredProviders || []).map((provider) => cleanString(provider).toLowerCase()).filter(Boolean)),
    ...modelRows.map((model) => cleanString(model.provider).toLowerCase()).filter(Boolean),
    ...localRows.map((provider) => cleanString(provider.id || provider.provider).toLowerCase()).filter(Boolean)
  ]);
  const usageByProvider = new Map(usageRows.map((row) => [cleanString(row.provider).toLowerCase(), row]));
  const localByProvider = new Map(localRows.map((row) => [cleanString(row.id || row.provider).toLowerCase(), row]));
  const providerIds = new Set([
    ...PROVIDER_SETUP_CATALOG.map((provider) => provider.id),
    ...configuredProviders,
    ...usageRows.map((row) => cleanString(row.provider).toLowerCase()).filter(Boolean)
  ]);
  const providers = [...providerIds].sort((a, b) => {
    const configuredDelta = Number(configuredProviders.has(b)) - Number(configuredProviders.has(a));
    if (configuredDelta) return configuredDelta;
    const catalogDelta = Number(Boolean(getProviderSetupCatalogEntry(b))) - Number(Boolean(getProviderSetupCatalogEntry(a)));
    if (catalogDelta) return catalogDelta;
    return a.localeCompare(b);
  }).map((providerId) => {
    const catalog = getProviderSetupCatalogEntry(providerId) || {
      id: providerId,
      name: providerDisplayName(providerId),
      description: "从 OpenHanako 模型元数据或用量账本发现的模型服务商。",
      authTypes: ["host-managed"],
      docsUrl: ""
    };
    const providerModels = modelRows
      .filter((model) => cleanString(model.provider).toLowerCase() === providerId)
      .map((model) => cleanString(model.model || model.id || model.name))
      .filter(Boolean);
    const local = localByProvider.get(providerId);
    const localModels = Array.isArray(local?.models) ? local.models.map((model) => cleanString(model)).filter(Boolean) : [];
    const uniqueModels = [...new Set([...providerModels, ...localModels])];
    const usageRow = usageByProvider.get(providerId) || null;
    const configured = configuredProviders.has(providerId);
    return {
      ...catalog,
      configured,
      discovered: Boolean(local || usageRow || uniqueModels.length),
      local: catalog.authTypes?.includes("local") || local?.status === "configured",
      source: configured ? "openhanako-config" : usageRow ? "usage-ledger" : local ? local.source || "local-provider" : "catalog",
      models: uniqueModels,
      modelCount: uniqueModels.length,
      usage: usageRow,
      configExample: buildProviderSetupConfigExample(catalog, catalog.authTypes?.[0] || "api-key"),
      nextAction: configured
        ? "该模型服务商已出现在 OpenHanako 模型元数据中。可使用模型选择器或为 HanaAgent 任务固定模型。"
        : "请在 OpenHanako 宿主或模型服务商设置中配置凭据，然后刷新此面板。"
    };
  });
  const recommendedSnippet = buildProviderSetupRecommendedSnippet(providers);
  return {
    ok: true,
    mode: "openhanako-plugin",
    source: "hanaagent-provider-setup",
    configPath: "OpenHanako host provider settings",
    hermesConfigPath: "~/.hermes/config.yaml",
    summary: {
      catalog: PROVIDER_SETUP_CATALOG.length,
      configured: providers.filter((provider) => provider.configured).length,
      discovered: providers.filter((provider) => provider.discovered).length,
      models: modelRows.length,
      usageProviders: usageRows.length
    },
    providers,
    models: modelRows,
    localProviders: localRows,
    usage: usageRows,
    connection,
    recommendedSnippet,
    editableKeys: ["modelMetadata", "pinnedModels"],
    safeActions: ["refresh", "copy-config-snippet", "open-model-chooser", "pin-model", "gateway-reprobe"],
    note: "HanaAgent 复现 Hermes 模型服务商配置体验，但不会保存服务商 API Key 或 OAuth 令牌。密钥仍由 OpenHanako 宿主管理。"
  };
}


async function buildHermesSystemMetricsCompat(ctx) {
  const overview = await buildOverview(ctx);
  const connection = await buildHermesConnectionStatusCompat(ctx);
  const usage = overview.usage?.summary || {};
  return {
    checkedAt: Date.now(),
    cpu: {
      loadPercent: 0,
      loadAverage1m: 0,
      cores: 0,
      source: "host-metrics-unavailable-in-plugin"
    },
    memory: {
      usedBytes: 0,
      totalBytes: 0,
      usedPercent: 0,
      source: "host-metrics-unavailable-in-plugin"
    },
    disk: {
      path: ctx.dataDir,
      usedBytes: 0,
      totalBytes: 0,
      usedPercent: 0,
      source: "host-metrics-unavailable-in-plugin"
    },
    hermes: {
      status: connection.status,
      health: connection.health,
      dashboard: true,
      mode: "openhanako-plugin"
    },
    hanaagent: {
      missions: overview.missions?.length || 0,
      tasks: overview.tasks?.length || 0,
      checkpoints: overview.checkpoints?.length || 0,
      usage
    },
    note: "OpenHanako 插件不会直接读取原始操作系统指标；HanaAgent 提供工作台和运行时指标，并将宿主指标标记为不可用。"
  };
}

function buildHermesOAuthDeviceCodeCompat(ctx, input = {}) {
  const provider = cleanString(input.provider);
  if (!provider) return { ok: false, error: "provider_required" };
  return {
    ok: false,
    status: "unsupported",
    provider,
    mode: "openhanako-plugin",
    pluginId: ctx.pluginId || "hanaagent",
    source: "host-oauth-gate",
    error: "oauth_device_flow_host_managed",
    note: "HanaAgent 不会在插件内执行模型服务商 OAuth 登录。请通过 OpenHanako 宿主设置配置凭据，或由宿主开放 OAuth 能力。"
  };
}


function buildHermesOAuthPollTokenCompat(ctx, input = {}) {
  const provider = cleanString(input.provider);
  const deviceCode = cleanString(input.deviceCode || input.device_code || input.sessionId);
  if (!provider || !deviceCode) return { ok: false, status: "error", error: "provider_or_deviceCode_required" };
  return {
    ok: false,
    status: "error",
    provider,
    deviceCode,
    mode: "openhanako-plugin",
    pluginId: ctx.pluginId || "hanaagent",
    source: "host-oauth-gate",
    message: "OAuth 轮询由 OpenHanako 宿主管理；HanaAgent 不持久化或交换模型服务商 OAuth 令牌。"
  };
}


function responseFromFileContent(file, options = {}) {
  const kind = cleanString(options.kind) === "media" ? "media" : "preview";
  const routeMime = mimeForRoutePath(file.relativePath || file.path || "");
  const fileMime = cleanString(file.mime);
  const mime = fileMime === "text/plain; charset=utf-8" && routeMime !== "application/octet-stream"
    ? routeMime
    : fileMime || routeMime;
  if (kind === "media" && !isMediaMime(mime)) {
    return {
      status: 415,
      body: { ok: false, error: "unsupported_media_type", mime, source: options.source || "hanaagent-files" }
    };
  }
  if (kind === "preview" && !isPreviewMime(mime)) {
    return {
      status: 415,
      body: { ok: false, error: "unsupported_preview_type", mime, source: options.source || "hanaagent-files" }
    };
  }
  const bytes = file.encoding === "base64"
    ? Buffer.from(file.content || "", "base64")
    : Buffer.from(file.content || "", "utf8");
  const maxBytes = kind === "media" ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
  if (bytes.length > maxBytes) {
    return {
      status: 413,
      body: { ok: false, error: "file_too_large", size: bytes.length, maxBytes, source: options.source || "hanaagent-files" }
    };
  }
  return {
    response(c) {
      c.header("content-type", mime || "application/octet-stream");
      c.header("cache-control", kind === "media" ? "private, max-age=60" : "no-store");
      c.header("referrer-policy", "no-referrer");
      c.header("x-content-type-options", "nosniff");
      if (options.filename) c.header("content-disposition", `inline; filename="${options.filename}"`);
      return c.body(bytes);
    }
  };
}


function serveHermesLocalFileCompat(ctx, input = {}) {
  const kind = cleanString(input.kind) === "media" ? "media" : "preview";
  const artifactId = cleanString(input.artifactId);
  const requestPath = cleanString(input.path);
  if (artifactId) return serveHermesArtifactFileCompat(ctx, { artifactId, kind });
  if (!requestPath) {
    return {
      status: 400,
      body: { ok: false, error: "path_or_artifactId_required", mode: "openhanako-plugin" }
    };
  }

  const result = readWorkspaceFile(ctx, {
    rootId: input.rootId,
    path: requestPath
  });
  if (!result.ok) {
    const status = result.error === "file_not_found" ? 404 : result.error === "file_too_large" ? 413 : result.error === "unsupported_file_type" ? 415 : 403;
    return { status, body: { ...result, mode: "openhanako-plugin", source: "workspaceRoots" } };
  }
  return responseFromFileContent(result, {
    kind,
    filename: downloadFilename(result.relativePath || result.path || "workspace-file"),
    source: "workspaceRoots"
  });
}


function serveHermesArtifactFileCompat(ctx, input = {}) {
  const artifact = readRunRecordArtifactFile(ctx.dataDir, input.artifactId);
  if (!artifact.ok && artifact.error === "artifact_file_missing") {
    const materialized = materializeRunRecordFile(ctx.dataDir, input.artifactId, {});
    if (materialized.ok) return serveHermesArtifactFileCompat(ctx, input);
  }
  if (!artifact.ok) {
    const status = artifact.error === "record_not_found" ? 404 : artifact.error === "artifact_file_not_found" ? 404 : artifact.error === "artifact_file_outside_data_dir" ? 403 : 422;
    return { status, body: { ...artifact, mode: "openhanako-plugin", source: "run-record-artifacts" } };
  }
  return responseFromFileContent({
    ok: true,
    kind: "text",
    mime: artifact.file?.mime || "text/plain; charset=utf-8",
    encoding: "utf8",
    content: artifact.content || "",
    relativePath: artifact.file?.filename || artifact.record?.title || artifact.record?.id || input.artifactId,
    size: artifact.file?.size || Buffer.byteLength(artifact.content || "", "utf8")
  }, {
    kind: input.kind,
    filename: downloadFilename(artifact.file?.filename || artifact.record?.title || "artifact"),
    source: "run-record-artifacts"
  });
}


async function buildHermesTranscribeCompat(ctx, c) {
  const contentType = cleanString(c.req.header("content-type")).toLowerCase();
  if (contentType.includes("multipart/form-data")) {
    let form;
    try {
      form = await c.req.formData();
    } catch {
      return { ok: false, error: "audio_file_required" };
    }
    const file = form.get("file");
    if (!file || typeof file !== "object" || typeof file.size !== "number") return { ok: false, error: "audio_file_required" };
    if (file.size > 25 * 1024 * 1024) return { ok: false, error: "audio_file_too_large", maxBytes: 25 * 1024 * 1024 };
  }
  return {
    ok: false,
    error: "transcription_provider_unavailable",
    status: "capability-gated",
    mode: "openhanako-plugin",
    pluginId: ctx.pluginId || "hanaagent",
    source: "host-stt-capability",
    note: "Hermes /api/transcribe 需要语音转文字服务商。除非 OpenHanako 开放 STT 能力，否则 HanaAgent 不会从插件路由上传音频。"
  };
}


async function buildHermesPlaygroundAdminCompat(ctx) {
  const overview = await buildOverview(ctx);
  return {
    ok: true,
    mode: "openhanako-plugin",
    source: "hanaagent-workbench-runtime",
    playground: {
      enabled: false,
      reason: "Hermes Playground 的执行智能体管理是独立演示界面，不属于 OpenHanako 插件运行时。"
    },
    stats: {
      agents: overview.agents?.length || 0,
      sessions: overview.sessions?.length || 0,
      missions: overview.missions?.length || 0,
      tasks: overview.tasks?.length || 0,
      runRecords: overview.runRecords?.length || 0,
      checkpoints: overview.checkpoints?.length || 0
    },
    capabilities: overview.capabilities || {},
    setupDoctor: overview.setupDoctor || null
  };
}


async function buildHermesPlaygroundNpcCompat(ctx, input = {}) {
  const npcId = cleanString(input.npcId || input.id).toLowerCase();
  const playerMessage = cleanString(input.playerMessage || input.message || input.prompt);
  if (!npcId) return { ok: false, error: "unknown_npcId" };
  if (!playerMessage) return { ok: false, error: "message_required" };
  const personas = {
    athena: "Sage of the Hanaco workbench",
    apollo: "Narrator of agent runs",
    iris: "Messenger of session events",
    nike: "Review gate champion",
    pan: "Tool and MCP guide",
    chronos: "Memory and checkpoint archivist",
    hermes: "Guildmaster of missions",
    eros: "Onboarding guide"
  };
  if (!personas[npcId]) return { ok: false, error: "unknown_npcId" };
  const reply = [
    `${personas[npcId]} is available in compatibility mode.`,
    "The original Hermes Playground NPC uses a standalone gateway demo; inside OpenHanako, use HanaAgent missions, skills, memory, and session chat for real agent work."
  ].join(" ");
  return {
    ok: true,
    reply,
    ms: 0,
    fallback: true,
    npcId,
    mode: "openhanako-plugin",
    source: "hanaagent-playground-compat"
  };
}


async function buildHermesVtCapitalCompat(ctx) {
  const overview = await buildOverview(ctx);
  const runRecords = listRunRecords(ctx.dataDir, { type: "artifact" }).slice(0, 8);
  const blockers = listCheckpoints(ctx.dataDir).filter((checkpoint) => checkpoint.state === "blocked" || checkpoint.blocker).slice(0, 5);
  return {
    ok: true,
    checkedAt: Date.now(),
    plugin: {
      name: "hanaagent-vt-capital-compat",
      version: "0.1.0",
      mode: "observe_only",
      executionEnabled: false
    },
    paths: {
      dataDir: ctx.dataDir,
      workspaceRoots: (overview.workspaceRoots || []).map((root) => root.path)
    },
    marketBias: {
      fileExists: false,
      updatedAt: null,
      latest: null,
      recent: []
    },
    council: {
      fileExists: false,
      recent: []
    },
    workers: (overview.workerCards || []).map((worker) => ({
      workerId: worker.id || worker.workerId,
      role: worker.lane || worker.role || worker.title || "worker",
      state: worker.state || worker.health?.state || "unknown",
      currentTask: worker.currentTask || worker.assignment?.task || null,
      lastSummary: worker.summary || worker.output || null,
      runtimeExists: true,
      profilePath: "openhanako://hanaagent/workers/" + encodeURIComponent(worker.id || worker.workerId || "worker")
    })),
    guardian: {
      requireOrderScope: true,
      executionMode: "observe_only",
      liveBlocked: true,
      executionEnabled: false,
      lastRiskCheck: blockers[0] || null,
      lastOrderProposed: null,
      lastOrderExecuted: null,
      demoState: {
        trackedOrders: 0,
        openOrders: 0,
        lastOrder: null
      },
      recentBlocks: blockers
    },
    notes: runRecords.map((record) => ({
      title: record.title,
      path: record.path || `hanaagent://run-records/${record.id}`,
      mtimeMs: Date.parse(record.updatedAt || record.createdAt || "") || 0,
      size: Buffer.byteLength(record.content || record.summary || "", "utf8")
    })),
    source: "hanaagent-observe-only-compat",
    note: "Hermes vt-capital 是仓库专用的只读观察控制台。HanaAgent 根据工作台运行时数据提供不含交易功能的兼容载荷。"
  };
}

function mimeForRoutePath(filePath) {
  const ext = path.extname(cleanString(filePath)).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/plain; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg"
  };
  return map[ext] || "application/octet-stream";
}

function isMediaMime(mime) {
  const value = cleanString(mime).toLowerCase();
  return value.startsWith("image/") || value.startsWith("video/") || value.startsWith("audio/");
}

function isPreviewMime(mime) {
  const value = cleanString(mime).toLowerCase();
  return value.startsWith("text/")
    || value.startsWith("image/")
    || value.includes("json")
    || value.includes("javascript")
    || value.includes("svg");
}

function rankSearchResults(items, query) {
  const needle = cleanString(query).toLowerCase();
  return (Array.isArray(items) ? items : [])
    .map((item) => ({ ...item, score: scoreSearchItem(item, needle) }))
    .sort((a, b) => b.score - a.score || String(a.title || "").localeCompare(String(b.title || "")));
}

function scoreSearchItem(item, needle) {
  if (!needle) return 1;
  const title = String(item.title || "").toLowerCase();
  const subtitle = String(item.subtitle || "").toLowerCase();
  const detail = String(item.detail || "").toLowerCase();
  const id = String(item.id || "").toLowerCase();
  let score = 0;
  if (title === needle) score += 100;
  if (title.startsWith(needle)) score += 80;
  if (title.includes(needle)) score += 60;
  if (subtitle.includes(needle)) score += 25;
  if (id.includes(needle)) score += 18;
  if (detail.includes(needle)) score += 10;
  return score;
}


function countBy(items, keyFn) {
  const counts = {};
  for (const item of Array.isArray(items) ? items : []) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}


function firstMatchingLine(content, query) {
  const needle = cleanString(query).toLowerCase();
  if (!needle) return "";
  return String(content || "").split(/\r?\n/).find((line) => line.toLowerCase().includes(needle)) || "";
}



async function buildGlobalSearch(ctx, input = {}) {
  const query = cleanString(input.query);
  const limit = clampNumber(input.limit, 1, 80, 30);
  const results = [];
  const errors = [];
  const push = (item) => {
    if (!item || !item.id) return;
    results.push({
      score: 0,
      action: "open",
      source: "hanaagent",
      ...item
    });
  };

  let tasks = [];
  let checkpoints = [];
  let missions = [];
  let runRecords = [];
  let jobs = [];
  let localMemory = [];
  let roots = [];
  let integrations = null;
  let sessions = [];

  for (const [label, read] of [
    ["tasks", () => { tasks = listTasks(ctx.dataDir, { includeDone: true }); }],
    ["checkpoints", () => { checkpoints = listCheckpoints(ctx.dataDir); }],
    ["missions", () => { missions = listMissions(ctx.dataDir, { includeArchived: true }); }],
    ["run-records", () => { runRecords = listRunRecords(ctx.dataDir); }],
    ["jobs", () => { jobs = listJobs(ctx.dataDir); }],
    ["memory", () => { localMemory = listLocalMemory(ctx.dataDir, { query, limit: 80 }).entries || []; }],
    ["workspace-roots", () => { roots = listWorkspaceRoots(ctx).roots || []; }]
  ]) {
    try {
      read();
    } catch (error) {
      errors.push({ source: label, error: error?.message || String(error) });
    }
  }
  try {
    integrations = await buildIntegrationCatalog(ctx, { agentId: cleanString(input.agentId) });
  } catch (error) {
    errors.push({ source: "integrations", error: error?.message || String(error) });
  }
  try {
    const sessionResult = await listSessions(ctx, { agentId: cleanString(input.agentId) });
    sessions = sessionResult.sessions || [];
  } catch (error) {
    errors.push({ source: "sessions", error: error?.message || String(error) });
  }

  const assignments = missions.flatMap((mission) => (mission.assignments || []).map((assignment) => ({ ...assignment, mission })));

  for (const session of sessions) {
    push({
      id: `session:${session.path}`,
      kind: "session",
      title: session.title || session.path,
      subtitle: `${session.agentName || session.agentId || "session"} / ${session.messageCount || 0} messages`,
      detail: [session.firstMessage, session.originalTitle, session.path].filter(Boolean).join("\n"),
      status: session.alias ? "alias" : "active",
      target: {
        sessionPath: session.path,
        agentId: session.agentId || ""
      }
    });
  }
  if (query && hasBusCapability(ctx, "session:history")) {
    const preferredSessionPath = cleanString(input.sessionPath);
    const searchableSessions = [
      ...sessions.filter((session) => preferredSessionPath && session.path === preferredSessionPath),
      ...sessions.filter((session) => !preferredSessionPath || session.path !== preferredSessionPath)
    ].slice(0, 12);
    for (const session of searchableSessions) {
      try {
        const history = await getSessionHistory(ctx, { sessionPath: session.path, limit: 80 });
        if (!history.ok) {
          errors.push({ source: `session-history:${session.path}`, error: history.error || "session_history_failed" });
          continue;
        }
        for (const message of history.messages || []) {
          const line = firstMatchingLine(message.text || "", query);
          if (!line) continue;
          push({
            id: `session-message:${session.path}:${message.id}`,
            kind: "session-message",
            title: session.title || session.path,
            subtitle: `${message.role || "message"} / ${message.createdAt || "history match"}`,
            detail: line,
            status: "history",
            source: "session:history",
            target: {
              sessionPath: session.path,
              agentId: session.agentId || "",
              messageId: message.id || ""
            }
          });
        }
      } catch (error) {
        errors.push({ source: `session-history:${session.path}`, error: error?.message || String(error) });
      }
    }
  }

  for (const mission of missions) {
    push({
      id: `mission:${mission.id}`,
      kind: "mission",
      title: mission.title || mission.id,
      subtitle: `${mission.state || "mission"} / ${(mission.assignments || []).length} workers`,
      detail: mission.goal || mission.notes || "",
      status: mission.state || mission.phase || "",
      target: { missionId: mission.id }
    });
    for (const assignment of mission.assignments || []) {
      push({
        id: `assignment:${assignment.id}`,
        kind: "worker",
        title: assignment.label || assignment.id,
        subtitle: `${assignment.state || "assignment"} / ${mission.title || mission.id}`,
        detail: assignment.task || assignment.result || assignment.blocker || "",
        status: assignment.state || "",
        target: {
          missionId: mission.id,
          assignmentId: assignment.id,
          workerId: assignment.id,
          sessionPath: assignment.sessionPath || "",
          agentId: assignment.agentId || ""
        }
      });
    }
  }
  for (const task of tasks) {
    push({
      id: `task:${task.id || task.taskId}`,
      kind: "task",
      title: task.title || task.id || task.taskId,
      subtitle: `${task.column || task.status || "task"} / ${task.assignee || task.sessionPath || "-"}`,
      detail: task.description || task.notes || "",
      status: task.column || task.status || "",
      target: {
        taskId: task.id || task.taskId,
        missionId: task.missionId || "",
        assignmentId: task.assignmentId || "",
        sessionPath: task.sessionPath || ""
      }
    });
  }
  for (const checkpoint of checkpoints) {
    push({
      id: `checkpoint:${checkpoint.id || checkpoint.checkpointId}`,
      kind: "checkpoint",
      title: checkpoint.state || checkpoint.label || checkpoint.id || checkpoint.checkpointId,
      subtitle: checkpoint.sessionPath || checkpoint.taskId || "checkpoint",
      detail: checkpoint.result || checkpoint.blocker || checkpoint.nextAction || checkpoint.rawText || "",
      status: checkpoint.state || "",
      target: {
        taskId: checkpoint.taskId || "",
        sessionPath: checkpoint.sessionPath || "",
        agentId: checkpoint.agentId || ""
      }
    });
  }
  for (const record of runRecords) {
    push({
      id: `run:${record.id}`,
      kind: record.type || "run-record",
      title: record.title || record.id,
      subtitle: `${record.type || "record"} / ${record.state || "-"}`,
      detail: record.summary || record.content || record.path || "",
      status: record.state || "",
      target: {
        missionId: record.missionId || "",
        assignmentId: record.assignmentId || "",
        sessionPath: record.sessionPath || ""
      }
    });
  }
  for (const memory of localMemory) {
    push({
      id: `memory:${memory.memoryId || memory.id}`,
      kind: "memory",
      title: memory.title || memory.memoryId || memory.id,
      subtitle: memory.summary || memory.path || "local memory",
      detail: memory.content || "",
      status: "local",
      source: memory.source || "hanaagent:memory",
      target: { memoryId: memory.memoryId || memory.id }
    });
  }
  for (const job of jobs) {
    push({
      id: `job:${job.id}`,
      kind: "job",
      title: job.title || job.id,
      subtitle: `${job.type || "job"} / ${job.status || "-"}`,
      detail: job.prompt || job.summary || job.schedule || "",
      status: job.status || "",
      target: { jobId: job.id, missionId: job.missionId || "", sessionPath: job.sessionPath || "" }
    });
  }
  for (const item of Array.isArray(integrations?.items) ? integrations.items : []) {
    push({
      id: `integration:${item.id}`,
      kind: item.kind || "integration",
      title: item.name || item.id,
      subtitle: `${item.status || "-"} / risk ${item.risk || "low"}`,
      detail: item.description || item.source || "",
      status: item.status || "",
      source: item.source || "integration-catalog",
      target: { integrationQuery: item.name || item.id || "" }
    });
  }
  for (const root of roots.slice(0, 8)) {
    try {
      const listed = listWorkspaceFiles(ctx, { rootId: root.id, path: ".", depth: 2, maxEntries: 200 });
      for (const entry of listed.entries || []) {
        let detail = entry.relativePath || entry.path || "";
        if (query && entry.type !== "directory" && Number(entry.size || 0) <= 64 * 1024) {
          const file = readWorkspaceFile(ctx, { rootId: root.id, path: entry.relativePath || entry.path || "." });
          if (file.ok && file.kind === "text") detail = firstMatchingLine(file.content, query) || file.content.slice(0, 500) || detail;
        }
        push({
          id: `file:${root.id}:${entry.relativePath || entry.path}`,
          kind: entry.type === "directory" ? "directory" : "file",
          title: entry.name || entry.relativePath || entry.path,
          subtitle: `${root.label || root.id} / ${entry.relativePath || entry.path}`,
          detail,
          status: entry.type || entry.kind || "",
          source: root.id,
          target: { rootId: root.id, path: entry.relativePath || entry.path || ".", type: entry.type || entry.kind || "" }
        });
      }
    } catch (error) {
      errors.push({ source: `files:${root.id}`, error: error?.message || String(error) });
    }
  }

  const ranked = rankSearchResults(results, query)
    .filter((item) => !query || item.score > 0)
    .slice(0, limit)
    .map(({ score, ...item }) => ({ ...item, score }));

  return {
    ok: true,
    query,
    total: ranked.length,
    results: ranked,
    groups: countBy(ranked, (item) => item.kind || "result"),
    errors
  };
}


export function registerCoreRoutes(app, ctx, deps = {}) {
  if (deps.buildOverview) buildOverview = deps.buildOverview
  if (deps.buildWorkerDrilldown) buildWorkerDrilldown = deps.buildWorkerDrilldown
  if (deps.buildAgentOutputs) buildAgentOutputs = deps.buildAgentOutputs
  if (deps.buildSwarmActivity) buildSwarmActivity = deps.buildSwarmActivity
  if (deps.buildWorkerArtifacts) buildWorkerArtifacts = deps.buildWorkerArtifacts
  if (deps.launchAssignmentWorkerSession) launchAssignmentWorkerSession = deps.launchAssignmentWorkerSession
  if (deps.createMissionTasks) createMissionTasks = deps.createMissionTasks
  if (deps.createWorkflowMission) createWorkflowMission = deps.createWorkflowMission

  app.get("/api/state", async (c) => {
    return c.json(await buildOverview(ctx));
  });

  app.get("/api/overview", async (c) => {
    return c.json(await buildOverview(ctx));
  });

  app.get("/api/agent-outputs", async (c) => {
    const overview = await buildOverview(ctx);
    const outputs = buildAgentOutputs(overview, {
      filter: c.req.query("filter") || "all",
      limit: c.req.query("limit") || "",
      agentId: c.req.query("agentId") || "",
      missionId: c.req.query("missionId") || "",
      sessionPath: c.req.query("sessionPath") || ""
    });
    return c.json({ ok: true, ...outputs, mode: "openhanako-plugin", source: "hanaagent-agent-outputs" });
  });

  app.get("/api/swarm-activity", async (c) => {
    const overview = await buildOverview(ctx);
    const activity = buildSwarmActivity(overview, {
      limit: c.req.query("limit") || "",
      workerId: c.req.query("workerId") || "",
      missionId: c.req.query("missionId") || ""
    });
    return c.json({ ok: true, ...activity, mode: "openhanako-plugin", source: "hanaagent-swarm-activity" });
  });

  app.get("/api/worker-artifacts", async (c) => {
    const overview = await buildOverview(ctx);
    const artifacts = buildWorkerArtifacts(overview, {
      limit: c.req.query("limit") || "",
      workerId: c.req.query("workerId") || "",
      missionId: c.req.query("missionId") || "",
      assignmentId: c.req.query("assignmentId") || ""
    });
    return c.json({ ok: true, ...artifacts, mode: "openhanako-plugin", source: "hanaagent-worker-artifacts" });
  });

  app.get("/api/dashboard/overview", async (c) => {
    const overview = await buildOverview(ctx);
    return c.json({
      ok: true,
      dashboard: overview,
      overview,
      mode: "openhanako-plugin",
      source: "hanaagent-overview"
    });
  });

  app.get("/api/workers/:workerId", async (c) => {
    const overview = await buildOverview(ctx);
    const result = buildWorkerDrilldown(overview, c.req.param("workerId"));
    return c.json(result, result.ok ? 200 : 404);
  });

  app.get("/api/workers/:workerId/lifecycle", async (c) => {
    const overview = await buildOverview(ctx);
    const drilldown = buildWorkerDrilldown(overview, c.req.param("workerId"));
    if (!drilldown.ok) return c.json(drilldown, 404);
    return c.json({
      ok: true,
      workerId: drilldown.workerId,
      lifecycle: drilldown.lifecycle,
      worker: drilldown.worker,
      assignment: drilldown.assignment
    });
  });

  app.post("/api/workers/:workerId/message", async (c) => {
    const overview = await buildOverview(ctx);
    const drilldown = buildWorkerDrilldown(overview, c.req.param("workerId"));
    if (!drilldown.ok) return c.json(drilldown, 404);
    const body = await readJson(c);
    const sessionPath = cleanString(body.sessionPath)
      || drilldown.ide?.identity?.sessionPath
      || drilldown.assignment?.sessionPath
      || drilldown.sessions?.[0]?.path
      || "";
    const result = await sendSessionMessage(ctx, {
      sessionPath,
      text: body.text || body.message || body.prompt
    });
    return c.json({ ...result, workerId: drilldown.workerId, ide: drilldown.ide }, result.ok ? 200 : result.error === "sessionPath_required" || result.error === "message_required" ? 422 : 503);
  });

  app.post("/api/workers/:workerId/handoff", async (c) => {
    const overview = await buildOverview(ctx);
    const drilldown = buildWorkerDrilldown(overview, c.req.param("workerId"));
    if (!drilldown.ok) return c.json(drilldown, 404);
    const body = await readJson(c);
    const lifecycle = buildWorkerLifecycle({
      worker: drilldown.worker,
      assignment: drilldown.assignment,
      sessions: drilldown.sessions,
      checkpoints: drilldown.checkpoints,
      usage: drilldown.usage,
      policy: body.policy
    });
    const prompt = buildHandoffPrompt({
      worker: drilldown.worker,
      assignment: drilldown.assignment,
      lifecycle
    });
    const sessionPath = cleanString(body.sessionPath) || lifecycle.sessionPath || drilldown.ide?.identity?.sessionPath || "";
    const result = await sendSessionMessage(ctx, { sessionPath, text: prompt });
    if (drilldown.assignment?.missionId) {
      appendMissionEvent(ctx.dataDir, drilldown.assignment.missionId, {
        type: "worker_handoff_requested",
        label: `已请求 ${drilldown.worker?.name || drilldown.workerId} 交接`,
        meta: {
          workerId: drilldown.workerId,
          assignmentId: drilldown.assignment?.id,
          sessionPath,
          lifecycleState: lifecycle.state,
          contextTokens: lifecycle.contextTokens
        }
      });
    }
    if (result.ok) {
      createRunRecord(ctx.dataDir, {
        type: "approval",
        title: `Worker handoff requested: ${drilldown.worker?.name || drilldown.workerId}`,
        summary: `Lifecycle ${lifecycle.state}; waiting for STATE: HANDOFF checkpoint.`,
        content: prompt,
        missionId: drilldown.assignment?.missionId,
        assignmentId: drilldown.assignment?.id,
        taskId: drilldown.assignment?.taskId,
        sessionPath,
        agentId: drilldown.assignment?.agentId || drilldown.agent?.id,
        state: "pending",
        risk: lifecycle.state === "renew_required" ? "high" : "medium",
        tool: "worker-lifecycle/handoff",
        requester: "hanaagent-lifecycle",
        meta: {
          kind: "worker-handoff",
          workerId: drilldown.workerId,
          lifecycle
        }
      });
    }
    return c.json({ ...result, workerId: drilldown.workerId, lifecycle, prompt }, result.ok ? 200 : result.error === "sessionPath_required" ? 422 : 503);
  });

  app.post("/api/workers/:workerId/session", async (c) => {
    const overview = await buildOverview(ctx);
    const drilldown = buildWorkerDrilldown(overview, c.req.param("workerId"));
    if (!drilldown.ok) return c.json(drilldown, 404);
    const mission = drilldown.assignment?.missionId
      ? getMission(ctx.dataDir, drilldown.assignment.missionId)
      : null;
    if (!mission || !drilldown.assignment) return c.json({ ok: false, error: "assignment_mission_not_found", workerId: drilldown.workerId }, 404);
    const body = await readJson(c);
    const result = await launchAssignmentWorkerSession(ctx, mission, drilldown.assignment, body);
    const latestOverview = await buildOverview(ctx);
    const latest = buildWorkerDrilldown(latestOverview, c.req.param("workerId"));
    return c.json({ ...result, workerId: drilldown.workerId, worker: latest }, result.ok ? 200 : 503);
  });

  app.get("/api/handoffs", (c) => {
    return c.json(listHandoffs(ctx.dataDir, {
      workerId: c.req.query("workerId") || "",
      limit: c.req.query("limit") || ""
    }));
  });

  app.get("/api/handoffs/:workerId", (c) => {
    const result = readHandoff(ctx.dataDir, c.req.param("workerId"));
    return c.json(result, result.ok ? 200 : result.error === "handoff_not_found" ? 404 : 422);
  });

  app.get("/api/search", async (c) => {
    const result = await buildGlobalSearch(ctx, {
      query: c.req.query("query") || "",
      agentId: c.req.query("agentId") || "",
      sessionPath: c.req.query("sessionPath") || "",
      limit: c.req.query("limit") || ""
    });
    return c.json(result);
  });

  app.get("/api/integrations", async (c) => {
    const catalog = await buildIntegrationCatalog(ctx, { agentId: c.req.query("agentId") || "" });
    return c.json(catalog);
  });

  app.post("/api/integrations/action", async (c) => {
    const result = await applyIntegrationAction(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/operations", async (c) => {
    const overview = await buildOverview(ctx);
    return c.json({ ok: true, operations: overview.operations || overview.overview?.sections?.operations || null });
  });

  app.get("/api/setup-doctor", async (c) => {
    const overview = await buildOverview(ctx);
    return c.json({ ok: true, setupDoctor: overview.setupDoctor || overview.overview?.sections?.setupDoctor || null });
  });

  app.get("/api/operations/presets", (c) => {
    return c.json({ ok: true, presets: listOperationPresets() });
  });

  app.get("/api/operations/profiles", (c) => {
    return c.json({ ok: true, profiles: listOperationProfiles(ctx.dataDir) });
  });

  app.post("/api/operations/profiles", async (c) => {
    const body = await readJson(c);
    const result = body.presetId && !body.label && !body.mission
      ? seedOperationProfileFromPreset(ctx.dataDir, body.presetId, body)
      : saveOperationProfile(ctx.dataDir, body);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.post("/api/operations/profiles/import", async (c) => {
    const result = importOperationProfile(ctx.dataDir, await readJson(c));
    return c.json(result, result.ok ? 200 : result.error === "profile_exists" ? 409 : 422);
  });

  app.post("/api/operations/swarm-roster/import", async (c) => {
    const result = importSwarmRoster(ctx.dataDir, await readJson(c));
    return c.json(result, result.ok ? 200 : result.error === "profile_exists" ? 409 : 422);
  });

  app.get("/api/operations/profiles/:profileId/export", (c) => {
    const result = exportOperationProfile(ctx.dataDir, c.req.param("profileId"));
    if (!result.ok) return c.json(result, 404);
    return new Response(JSON.stringify(result.bundle, null, 2) + "\n", {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${downloadFilename(result.filename)}"`
      }
    });
  });

  app.get("/api/operations/profiles/:profileId/swarm-roster", (c) => {
    const format = cleanString(c.req.query("format") || "json").toLowerCase();
    const result = exportSwarmRoster(ctx.dataDir, c.req.param("profileId"), { format });
    if (!result.ok) return c.json(result, 404);
    const wantsDownload = c.req.query("download") === "1" || c.req.query("download") === "true";
    if (!wantsDownload) return c.json({ ok: true, profile: result.profile, roster: result.roster, format: result.format });
    return new Response(result.body, {
      headers: {
        "content-type": result.format === "yaml" ? "application/yaml; charset=utf-8" : "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${downloadFilename(result.filename)}"`
      }
    });
  });

  app.delete("/api/operations/profiles/:profileId", (c) => {
    const result = deleteOperationProfile(ctx.dataDir, c.req.param("profileId"));
    return c.json(result, result.ok ? 200 : 404);
  });

  app.post("/api/operations/presets/:presetId/mission", async (c) => {
    const body = await readJson(c);
    const result = createMission(ctx.dataDir, buildPresetMissionInput({
      ...body,
      presetId: c.req.param("presetId")
    }));
    if (!result.ok) return c.json(result, 422);
    const taskResults = createMissionTasks(ctx, result.mission, "hanaagent-operations");
    const mission = getMission(ctx.dataDir, result.mission.id) || result.mission;
    return c.json({ ok: true, mission, tasks: taskResults.map((item) => item.task) });
  });

  app.post("/api/operations/profiles/:profileId/mission", async (c) => {
    const profile = getOperationProfile(ctx.dataDir, c.req.param("profileId"));
    if (!profile) return c.json({ ok: false, error: "profile_not_found" }, 404);
    const body = await readJson(c);
    const result = createMission(ctx.dataDir, buildProfileMissionInput({
      ...body,
      profile,
      sessionPath: body.sessionPath || "",
      agentId: body.agentId || "",
      templateLabelPrefix: "Profile"
    }));
    if (!result.ok) return c.json(result, 422);
    const taskResults = createMissionTasks(ctx, result.mission, "hanaagent-operations-profile");
    const mission = getMission(ctx.dataDir, result.mission.id) || result.mission;
    return c.json({ ok: true, profile, mission, tasks: taskResults.map((item) => item.task) });
  });

  app.get("/api/workflow-templates", (c) => {
    return c.json({ ok: true, templates: listWorkflowTemplates() });
  });

  app.get("/api/workflows", (c) => {
    const workflows = listWorkflows(ctx.dataDir, {
      category: c.req.query("category") || "",
      query: c.req.query("query") || ""
    });
    return c.json({ ok: true, workflows, templates: listWorkflowTemplates(), total: workflows.length });
  });

  app.post("/api/workflows", async (c) => {
    const result = createWorkflow(ctx.dataDir, await readJson(c));
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/workflows/:workflowId", (c) => {
    const workflow = getWorkflow(ctx.dataDir, c.req.param("workflowId"));
    if (!workflow) return c.json({ ok: false, error: "workflow_not_found" }, 404);
    return c.json({ ok: true, workflow, validation: validateWorkflow(workflow) });
  });

  app.patch("/api/workflows/:workflowId", async (c) => {
    const result = updateWorkflow(ctx.dataDir, c.req.param("workflowId"), await readJson(c));
    return c.json(result, result.ok ? 200 : 404);
  });

  app.delete("/api/workflows/:workflowId", (c) => {
    const result = deleteWorkflow(ctx.dataDir, c.req.param("workflowId"));
    return c.json(result, result.ok ? 200 : 404);
  });

  app.post("/api/workflows/:workflowId/preview", async (c) => {
    const workflow = getWorkflow(ctx.dataDir, c.req.param("workflowId"));
    if (!workflow) return c.json({ ok: false, error: "workflow_not_found" }, 404);
    const body = await readJson(c);
    const result = previewWorkflowExecution(workflow, body.input && typeof body.input === "object" ? body.input : body);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.post("/api/workflows/:workflowId/execute", async (c) => {
    const workflow = getWorkflow(ctx.dataDir, c.req.param("workflowId"));
    if (!workflow) return c.json({ ok: false, error: "workflow_not_found" }, 404);
    const body = await readJson(c);
    const mode = cleanString(body.mode || body.executionMode || body.runMode || "preview");
    if (mode === "mission" || body.createMission === true) {
      const result = createWorkflowMission(ctx, workflow, body);
      return c.json({ ...result, mode: "mission" }, result.ok ? 200 : 422);
    }
    const result = previewWorkflowExecution(workflow, body.input && typeof body.input === "object" ? body.input : body);
    return c.json({ ...result, mode: "preview", workflow }, result.ok ? 200 : 422);
  });

  app.post("/api/workflows/:workflowId/execute-stream", async (c) => {
    const workflow = getWorkflow(ctx.dataDir, c.req.param("workflowId"));
    if (!workflow) return c.json({ ok: false, error: "workflow_not_found" }, 404);
    const body = await readJson(c);
    const mode = cleanString(body.mode || body.executionMode || body.runMode || "preview");
    const preview = previewWorkflowExecution(workflow, body.input && typeof body.input === "object" ? body.input : body);
    const events = [
      ["workflow-start", { ok: true, workflowId: workflow.id, workflowName: workflow.name, mode, at: new Date().toISOString() }],
      ...((preview.execution?.path || []).map((nodeId) => ["node-result", {
        workflowId: workflow.id,
        nodeId,
        result: preview.execution.nodeResults?.[nodeId] || null
      }])),
      ["workflow-preview", { ok: preview.ok, status: preview.execution?.status || "failed", validation: preview.validation || [], warnings: preview.execution?.warnings || [] }]
    ];
    if (mode === "mission" || body.createMission === true) {
      const missionResult = createWorkflowMission(ctx, workflow, body);
      events.push(["mission", missionResult]);
    }
    events.push(["workflow-complete", { ok: preview.ok, workflowId: workflow.id, status: preview.execution?.status || "completed", at: new Date().toISOString() }]);
    c.header("content-type", "text/event-stream");
    c.header("cache-control", "no-cache");
    c.header("connection", "keep-alive");
    return c.body(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data).replace(/\n/g, "\\n")}\n\n`).join(""));
  });

  app.post("/api/workflows/:workflowId/mission", async (c) => {
    const workflow = getWorkflow(ctx.dataDir, c.req.param("workflowId"));
    if (!workflow) return c.json({ ok: false, error: "workflow_not_found" }, 404);
    const body = await readJson(c);
    const result = createWorkflowMission(ctx, workflow, body);
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/workspace-roots", (c) => {
    return c.json(listWorkspaceRoots(ctx));
  });

  app.get("/api/paths", (c) => {
    const roots = listWorkspaceRoots(ctx).roots || [];
    const primaryRoot = roots[0] || null;
    return c.json({
      ok: true,
      mode: "openhanako-plugin",
      claudeHome: ctx.dataDir,
      hermesHome: ctx.dataDir,
      hanaHome: ctx.dataDir,
      memoriesDir: path.join(ctx.dataDir, "memory"),
      skillsDir: "openhanako://agent-skills",
      workspaceRoot: primaryRoot?.path || ctx.dataDir,
      workspaceRoots: roots,
      note: "Hermes /api/paths compatibility is scoped to HanaAgent plugin data and configured OpenHanako workspaceRoots."
    });
  });

  app.get("/api/files", (c) => {
    const result = handleHermesFilesGetCompat(ctx, {
      action: c.req.query("action") || "list",
      rootId: c.req.query("rootId") || "",
      path: c.req.query("path") || ".",
      maxDepth: c.req.query("maxDepth") || c.req.query("depth") || "",
      maxEntries: c.req.query("maxEntries") || ""
    });
    if (result.response) return result.response(c);
    return c.json(result.body, result.status);
  });

  app.post("/api/files", async (c) => {
    const result = await handleHermesFilesPostCompat(ctx, c);
    if (result.response) return result.response(c);
    return c.json(result.body, result.status);
  });

  app.get("/api/workspace-files", (c) => {
    const result = listWorkspaceFiles(ctx, {
      rootId: c.req.query("rootId") || "",
      path: c.req.query("path") || ".",
      depth: c.req.query("depth") || "",
      maxEntries: c.req.query("maxEntries") || ""
    });
    return c.json(result, result.ok ? 200 : result.error === "workspace_root_not_found" ? 404 : 403);
  });

  app.get("/api/workspace-file", (c) => {
    const result = readWorkspaceFile(ctx, {
      rootId: c.req.query("rootId") || "",
      path: c.req.query("path") || "."
    });
    const status = result.ok ? 200 : result.error === "file_not_found" ? 404 : result.error === "file_too_large" ? 413 : 403;
    return c.json(result, status);
  });

  app.get("/api/workspace-file/download", (c) => {
    const result = readWorkspaceFile(ctx, {
      rootId: c.req.query("rootId") || "",
      path: c.req.query("path") || "."
    });
    if (!result.ok) {
      const status = result.error === "file_not_found" ? 404 : result.error === "file_too_large" ? 413 : 403;
      return c.json(result, status);
    }
    const filename = downloadFilename(result.relativePath || result.path || "workspace-file");
    c.header("content-type", result.mime || "application/octet-stream");
    c.header("content-disposition", `attachment; filename="${filename}"`);
    if (result.encoding === "base64") return c.body(Buffer.from(result.content || "", "base64"));
    return c.body(result.content || "");
  });

  app.post("/api/workspace-file", async (c) => {
    const result = writeWorkspaceFile(ctx, await readJson(c));
    const status = result.ok ? 200 : result.error === "content_too_large" ? 413 : result.error === "root_readonly" ? 403 : 422;
    return c.json(result, status);
  });

  app.post("/api/workspace-file/upload", async (c) => {
    const result = uploadWorkspaceFile(ctx, await readJson(c));
    const status = result.ok
      ? 200
      : result.error === "content_too_large"
        ? 413
        : result.error === "root_readonly"
          ? 403
          : result.error === "path_exists"
            ? 409
            : 422;
    return c.json(result, status);
  });

  app.post("/api/workspace-file/diff", async (c) => {
    const result = diffWorkspaceFile(ctx, await readJson(c));
    const status = result.ok ? 200 : result.error === "file_not_found" ? 404 : result.error === "file_too_large" ? 413 : 422;
    return c.json(result, status);
  });

  app.post("/api/workspace-file/patch-review", async (c) => {
    const body = await readJson(c);
    const diff = diffWorkspaceFile(ctx, body);
    if (!diff.ok) {
      const status = diff.error === "file_not_found" ? 404 : diff.error === "file_too_large" ? 413 : diff.error === "root_readonly" ? 403 : 422;
      return c.json(diff, status);
    }
    if (!diff.changed) return c.json({ ok: true, changed: false, diff, review: null });
    const review = createRunRecord(ctx.dataDir, {
      type: "approval",
      title: cleanString(body.title) || `Patch review: ${diff.relativePath || body.path || "workspace file"}`,
      summary: `Review workspace patch for ${diff.relativePath || body.path || "workspace file"} (+${diff.stats?.additions || 0} -${diff.stats?.deletions || 0})`,
      content: diff.diff,
      path: diff.path,
      missionId: cleanString(body.missionId),
      assignmentId: cleanString(body.assignmentId),
      taskId: cleanString(body.taskId),
      sessionPath: cleanString(body.sessionPath),
      agentId: cleanString(body.agentId),
      state: "pending",
      risk: cleanString(body.risk) || "medium",
      tool: "workspace-file/patch-review",
      requester: "hanaagent-files",
      meta: {
        kind: "workspace-patch",
        rootId: diff.root?.id || cleanString(body.rootId),
        relativePath: diff.relativePath || cleanString(body.path),
        path: diff.path,
        content: typeof body.content === "string" ? body.content : "",
        stats: diff.stats || {},
        diff: diff.diff,
        createdBy: "hanaagent-files"
      }
    });
    const status = review.ok ? 200 : 422;
    return c.json({ ok: review.ok, changed: true, diff, review: review.record, error: review.error }, status);
  });

  app.post("/api/workspace-file/patch-review/:recordId/accept", async (c) => {
    const recordId = c.req.param("recordId");
    const record = listRunRecords(ctx.dataDir, { includeAll: true }).find((item) => item.id === recordId);
    const gate = validateWorkspacePatchRecord(record);
    if (!gate.ok) return c.json(gate, gate.error === "record_not_found" ? 404 : 422);
    const write = writeWorkspaceFile(ctx, {
      rootId: record.meta.rootId,
      path: record.meta.relativePath,
      content: record.meta.content
    });
    if (!write.ok) {
      const status = write.error === "root_readonly" ? 403 : write.error === "file_not_found" ? 404 : write.error === "content_too_large" ? 413 : 422;
      return c.json({ ok: false, error: write.error, write }, status);
    }
    const updated = updateRunRecord(ctx.dataDir, record.id, {
      state: "approved",
      meta: {
        ...record.meta,
        acceptedAt: new Date().toISOString(),
        write: {
          relativePath: write.relativePath,
          size: write.size
        }
      }
    });
    return c.json({ ok: updated.ok, review: updated.record, file: write });
  });

  app.post("/api/workspace-file/patch-review/:recordId/reject", async (c) => {
    const recordId = c.req.param("recordId");
    const body = await readJson(c);
    const record = listRunRecords(ctx.dataDir, { includeAll: true }).find((item) => item.id === recordId);
    const gate = validateWorkspacePatchRecord(record);
    if (!gate.ok) return c.json(gate, gate.error === "record_not_found" ? 404 : 422);
    const updated = updateRunRecord(ctx.dataDir, record.id, {
      state: "denied",
      summary: cleanString(body.reason) || record.summary,
      meta: {
        ...record.meta,
        rejectedAt: new Date().toISOString(),
        rejectReason: cleanString(body.reason)
      }
    });
    return c.json({ ok: updated.ok, review: updated.record });
  });

  app.delete("/api/workspace-file", async (c) => {
    const result = deleteWorkspacePath(ctx, await readJson(c));
    const status = result.ok ? 200 : result.error === "file_not_found" ? 404 : result.error === "root_readonly" ? 403 : 422;
    return c.json(result, status);
  });

  app.post("/api/workspace-file/action", async (c) => {
    const body = await readJson(c);
    const action = cleanString(body.action);
    let result;
    if (action === "mkdir") result = createWorkspaceDirectory(ctx, body);
    else if (action === "rename") result = renameWorkspacePath(ctx, body);
    else if (action === "delete") result = deleteWorkspacePath(ctx, body);
    else result = { ok: false, error: "unsupported_action" };
    const status = result.ok ? 200 : result.error === "file_not_found" ? 404 : result.error === "root_readonly" ? 403 : 422;
    return c.json(result, status);
  });

  app.get("/api/templates", (c) => {
    return c.json({ ok: true, templates: getTemplates() });
  });

  app.post("/api/model-suggestions", async (c) => {
    const body = await readJson(c);
    let agentConfig = {};
    const config = ctx.config?.getAll?.() || {};
    const agentId = cleanString(body.agentId) || cleanString(config.defaultAgentId);
    if (agentId && hasBusCapability(ctx, "agent:config")) {
      const result = await getAgentConfig(ctx, { agentId });
      if (result.ok) agentConfig = result.config || {};
    }
    return c.json(buildModelSuggestions({
      ...body,
      agentId,
      agentConfig,
      pinnedModels: config.pinnedModels || [],
      modelMetadata: config.modelMetadata || []
    }));
  });

  app.get("/api/models", async (c) => {
    const result = await buildHermesModelsCompat(ctx, {
      agentId: c.req.query("agentId") || ""
    });
    return c.json(result);
  });

  app.get("/api/model/info", async (c) => {
    const result = await buildHermesModelsCompat(ctx, {
      agentId: c.req.query("agentId") || ""
    });
    const modelId = cleanString(c.req.query("model") || c.req.query("modelId") || c.req.query("id"));
    const models = result.models || [];
    const model = modelId
      ? models.find((item) => [item.id, item.model, item.name].includes(modelId))
      : models[0] || null;
    return c.json({
      ok: true,
      model,
      models,
      modelId,
      source: result.source || "hanaagent-model-metadata",
      mode: "openhanako-plugin"
    });
  });

  app.get("/api/provider-setup", async (c) => {
    return c.json(await buildHermesProviderSetupCompat(ctx, {
      agentId: c.req.query("agent") || c.req.query("agentId") || ""
    }));
  });

  app.get("/api/claude-config", async (c) => {
    return c.json(buildHermesConfigCompat(ctx));
  });

  app.get("/api/hermes-config", async (c) => {
    return c.json(buildHermesConfigCompat(ctx));
  });

  app.patch("/api/claude-config", async (c) => {
    const result = patchHermesConfigCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : 422);
  });

  app.post("/api/claude-config", async (c) => {
    const result = patchHermesConfigCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : 422);
  });

  app.patch("/api/hermes-config", async (c) => {
    const result = patchHermesConfigCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : 422);
  });

  app.post("/api/hermes-config", async (c) => {
    const result = patchHermesConfigCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : 422);
  });

  app.post("/api/config-patch", async (c) => {
    const result = patchHermesConfigCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/connection-settings", (c) => {
    return c.json(buildHermesConnectionSettingsCompat(ctx));
  });

  app.put("/api/connection-settings", async (c) => {
    const result = patchHermesConnectionSettingsCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : 400);
  });

  app.post("/api/gateway-reprobe", async (c) => {
    return c.json(await buildHermesGatewayReprobeCompat(ctx));
  });

  app.get("/api/connection-status", async (c) => {
    return c.json(await buildHermesConnectionStatusCompat(ctx));
  });

  app.get("/api/gateway-status", async (c) => {
    return c.json(await buildHermesGatewayStatusCompat(ctx));
  });

  app.get("/api/auth-check", (c) => {
    return c.json(buildHermesAuthCheckCompat(ctx));
  });

  const claudeProxyCompat = (c) => c.json({
    ok: false,
    error: "claude_proxy_host_managed",
    mode: "openhanako-plugin",
    source: "host-runtime",
    path: new URL(c.req.url).pathname,
    note: "OpenHanako plugins do not proxy arbitrary Claude/Hermes gateway paths; use host session/model capabilities."
  }, 501);

  app.all("/api/claude-proxy/$", claudeProxyCompat);

  app.all("/api/claude-proxy/*", claudeProxyCompat);

  app.post("/api/hermesworld/reservations", (c) => {
    return c.json({
      ok: false,
      error: "hermesworld_reservations_not_available",
      mode: "openhanako-plugin",
      source: "hanaagent-compat",
      note: "HermesWorld name reservations are a standalone Hermes web service and are not handled by the OpenHanako plugin."
    }, 501);
  });

  app.get("/api/hermesworld/reservations", (c) => {
    return c.json({ ok: true, count: 0, mode: "openhanako-plugin", source: "hanaagent-compat" });
  });

  app.post("/api/hermesworld/reservations/confirm", (c) => {
    return c.json({
      ok: false,
      error: "confirmation_token_not_found",
      mode: "openhanako-plugin",
      source: "hanaagent-compat"
    }, 404);
  });

  app.post("/api/auth", async (c) => {
    const result = buildHermesAuthCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : 400);
  });

  app.get("/api/ping", async (c) => {
    return c.json(await buildHermesPingCompat(ctx));
  });

  app.get("/api/workspace", (c) => {
    return c.json(buildHermesWorkspaceCompat(ctx));
  });

  app.get("/api/plugins", async (c) => {
    return c.json(await buildHermesPluginsCompat(ctx));
  });

  app.get("/api/mcp", async (c) => {
    return c.json(await buildHermesMcpCompat(ctx, {
      agentId: c.req.query("agentId") || ""
    }));
  });

  app.post("/api/mcp", async (c) => {
    const result = await applyIntegrationAction(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/mcp/presets", (c) => {
    return c.json({
      ok: true,
      presets: buildHermesMcpPresetsCompat(),
      source: "hanaagent-seed",
      mode: "openhanako-plugin"
    });
  });

  app.get("/api/mcp/hub-sources", (c) => {
    return c.json({
      ok: true,
      sources: [
        { id: "openhanako", name: "OpenHanako Connectors", enabled: true, trusted: true },
        { id: "hanaagent", name: "HanaAgent Built-ins", enabled: true, trusted: true }
      ],
      mode: "openhanako-plugin"
    });
  });

  app.get("/api/mcp/hub-sources/:id", (c) => {
    const id = c.req.param("id");
    return c.json({
      ok: true,
      source: { id, name: id === "openhanako" ? "OpenHanako Connectors" : id, enabled: true },
      mode: "openhanako-plugin"
    });
  });

  app.get("/api/mcp/hub-search", async (c) => {
    return c.json(await buildHermesMcpHubSearchCompat(ctx, {
      query: c.req.query("q") || c.req.query("query") || "",
      limit: c.req.query("limit") || ""
    }));
  });

  app.post("/api/mcp/discover", async (c) => {
    const body = await readJson(c);
    return c.json(await buildHermesMcpDiscoverCompat(ctx, body));
  });

  app.post("/api/mcp/test", async (c) => {
    const body = await readJson(c);
    return c.json(await buildHermesMcpTestCompat(ctx, body));
  });

  app.put("/api/mcp/configure", async (c) => {
    const result = await applyIntegrationAction(ctx, {
      action: "mcp.configure",
      payload: await readJson(c)
    });
    return c.json(result.ok ? result : {
      ok: false,
      error: result.error || "mcp_configure_host_managed",
      mode: "openhanako-plugin",
      source: "mcp:settings-action"
    }, result.ok ? 200 : 422);
  });

  app.get("/api/mcp/:name/logs", (c) => {
    return c.json({
      ok: true,
      name: c.req.param("name"),
      logs: [],
      source: "openhanako-plugin",
      note: "Connector logs are host-managed; HanaAgent exposes an empty compatibility log stream when no host log capability is available."
    });
  });

  app.get("/api/mcp/$name/logs", (c) => {
    return c.json({
      ok: true,
      name: "$name",
      logs: [],
      source: "openhanako-plugin",
      note: "Compatibility alias for Hermes file-route diff; use /api/mcp/:name/logs at runtime."
    });
  });

  app.get("/api/mcp/:name", async (c) => {
    const catalog = await buildIntegrationCatalog(ctx, {});
    const name = c.req.param("name");
    const item = (catalog.items || []).find((entry) => entry.kind === "mcp" && (entry.id === `mcp:${name}` || entry.name === name || entry.id.endsWith(`:${name}`)));
    return c.json({
      ok: Boolean(item),
      server: item || null,
      name,
      mode: "openhanako-plugin",
      source: "hanaagent-integration-catalog",
      error: item ? undefined : "mcp_server_not_found"
    }, item ? 200 : 404);
  });

  app.get("/api/skills", async (c) => {
    return c.json(await buildHermesSkillsCompat(ctx, {
      agentId: c.req.query("agentId") || "",
      query: c.req.query("query") || c.req.query("q") || "",
      tab: c.req.query("tab") || "",
      category: c.req.query("category") || "",
      sort: c.req.query("sort") || "",
      limit: c.req.query("limit") || ""
    }));
  });

  app.post("/api/skills", async (c) => {
    const body = await readJson(c);
    const result = await applyIntegrationAction(ctx, {
      action: "skill.toggle",
      agentId: body.agentId,
      payload: {
        skillId: body.skillId || body.id || body.slug,
        enabled: body.enabled !== false
      }
    });
    return c.json(result, result.ok ? 200 : 422);
  });

  app.get("/api/skills/hub-search", async (c) => {
    const result = await buildHermesSkillsCompat(ctx, {
      agentId: c.req.query("agentId") || "",
      query: c.req.query("q") || c.req.query("query") || "",
      limit: c.req.query("limit") || ""
    });
    return c.json({
      ok: true,
      results: (result.skills || []).map((skill) => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        source: skill.sourcePath || skill.origin || "openhanako",
        trust: skill.origin || "installed",
        installed: skill.installed !== false
      })),
      source: "hanaagent-skills-catalog",
      total: result.total || 0
    });
  });

  app.post("/api/skills/toggle", async (c) => {
    const body = await readJson(c);
    const result = await applyIntegrationAction(ctx, {
      action: "skill.toggle",
      agentId: body.agentId,
      payload: {
        skillId: body.skillId || body.id || body.name,
        enabled: body.enabled !== false
      }
    });
    return c.json(result, result.ok ? 200 : 422);
  });

  app.post("/api/skills/install", async (c) => {
    const body = await readJson(c);
    return c.json({
      ok: false,
      error: "skill_install_host_managed",
      skillId: cleanString(body.skillId || body.name || body.id),
      mode: "openhanako-plugin",
      note: "Skill installation is managed by OpenHanako; HanaAgent can surface installed skills and toggle host-exposed config."
    }, 501);
  });

  app.post("/api/skills/uninstall", async (c) => {
    const body = await readJson(c);
    return c.json({
      ok: false,
      error: "skill_uninstall_host_managed",
      skillId: cleanString(body.skillId || body.name || body.id),
      mode: "openhanako-plugin",
      note: "Skill uninstall is managed by OpenHanako; HanaAgent does not remove host skill files."
    }, 501);
  });

  app.get("/api/local-providers", (c) => {
    return c.json(buildHermesLocalProvidersCompat(ctx));
  });

  app.get("/api/provider-usage", async (c) => {
    return c.json(await buildHermesProviderUsageCompat(ctx, {
      provider: c.req.query("provider") || "",
      modelId: c.req.query("modelId") || c.req.query("model") || "",
      limit: c.req.query("limit") || ""
    }));
  });

  app.get("/api/system-metrics", async (c) => {
    return c.json(await buildHermesSystemMetricsCompat(ctx));
  });

  app.post("/api/oauth/device-code", async (c) => {
    const result = buildHermesOAuthDeviceCodeCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : result.error === "provider_required" ? 400 : 501);
  });

  app.post("/api/oauth.device-code", async (c) => {
    const result = buildHermesOAuthDeviceCodeCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : result.error === "provider_required" ? 400 : 501);
  });

  app.post("/api/oauth/poll-token", async (c) => {
    const result = buildHermesOAuthPollTokenCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : result.error === "provider_or_deviceCode_required" ? 400 : 501);
  });

  app.post("/api/oauth.poll-token", async (c) => {
    const result = buildHermesOAuthPollTokenCompat(ctx, await readJson(c));
    return c.json(result, result.ok ? 200 : result.error === "provider_or_deviceCode_required" ? 400 : 501);
  });

  app.get("/api/media", (c) => {
    const result = serveHermesLocalFileCompat(ctx, {
      path: c.req.query("path") || "",
      rootId: c.req.query("rootId") || c.req.query("root") || "",
      artifactId: c.req.query("artifactId") || c.req.query("artifact") || "",
      kind: "media"
    });
    if (result.response) return result.response(c);
    return c.json(result.body, result.status);
  });

  app.get("/api/preview-file", (c) => {
    const result = serveHermesLocalFileCompat(ctx, {
      path: c.req.query("path") || "",
      rootId: c.req.query("rootId") || c.req.query("root") || "",
      artifactId: c.req.query("artifactId") || c.req.query("artifact") || "",
      kind: "preview"
    });
    if (result.response) return result.response(c);
    return c.json(result.body, result.status);
  });

  app.post("/api/transcribe", async (c) => {
    const result = await buildHermesTranscribeCompat(ctx, c);
    return c.json(result, result.ok ? 200 : result.error === "audio_file_required" ? 400 : result.error === "audio_file_too_large" ? 413 : 501);
  });

  app.get("/api/playground-admin", async (c) => {
    return c.json(await buildHermesPlaygroundAdminCompat(ctx));
  });

  app.post("/api/playground-npc", async (c) => {
    const result = await buildHermesPlaygroundNpcCompat(ctx, await readJson(c));
    return c.json(result, result.error === "unknown_npcId" || result.error === "message_required" ? 400 : 200);
  });

  app.get("/api/vt-capital", async (c) => {
    return c.json(await buildHermesVtCapitalCompat(ctx));
  });

}
