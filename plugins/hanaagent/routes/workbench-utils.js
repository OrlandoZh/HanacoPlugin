// workbench-utils.js — shared utility functions and constants extracted from workbench.js

export const PROVIDER_SETUP_CATALOG = [
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude 模型，适用于长上下文编程、复核和任务编排。",
    authTypes: ["api-key", "cli-token"],
    docsUrl: "https://console.anthropic.com/settings/keys"
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "GPT 与推理模型，适用于聊天、工具调用和智能体规划。",
    authTypes: ["api-key"],
    docsUrl: "https://platform.openai.com/api-keys"
  },
  {
    id: "google",
    name: "Google",
    description: "Gemini 模型，可通过宿主运行时使用 API Key 或 OAuth。",
    authTypes: ["api-key", "oauth"],
    docsUrl: "https://aistudio.google.com/app/apikey"
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "通过一个网关统一访问多个模型服务商。",
    authTypes: ["api-key"],
    docsUrl: "https://openrouter.ai/keys"
  },
  {
    id: "minimax",
    name: "MiniMax",
    description: "MiniMax 基础模型与多模态模型。",
    authTypes: ["api-key"],
    docsUrl: "https://www.minimax.io/platform"
  },
  {
    id: "ollama",
    name: "Ollama",
    description: "在用户本机运行的本地模型。",
    authTypes: ["local"],
    docsUrl: "https://ollama.com/download"
  },
  {
    id: "atomic-chat",
    name: "Atomic Chat",
    description: "支持 Llama、Gemma、Qwen 等模型的本地大语言模型运行时。",
    authTypes: ["local"],
    docsUrl: "https://atomic.chat"
  }
];

export async function readJson(c) {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}


export function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}


export function escapeHtmlText(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


export function normalizeCalendarTimezone(value) {
  const text = cleanString(value) || "local";
  if (!text || text.toLowerCase() === "local" || text.toLowerCase() === "system") return "local";
  if (text.toUpperCase() === "UTC" || text.toLowerCase() === "z") return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: text }).format(new Date(0));
    return text;
  } catch {
    return "local";
  }
}

export function exportDisplayLabel(value) {
  const labels = {
    selected: "已选择",
    pinned: "已固定",
    user: "用户",
    assistant: "助手",
    system: "系统",
    tool: "工具",
    message: "消息",
    event: "事件",
    checkpoint: "检查点",
    command: "命令",
    file: "文件",
    ok: "成功",
    failed: "失败",
    changed: "已更改",
    observed: "已观察",
    pending: "待处理",
    running: "运行中",
    done: "已完成",
    ready: "就绪",
    unknown: "未知",
    available: "可用",
    unavailable: "不可用",
    blocked: "阻塞",
    review: "待复核"
  };
  const text = cleanString(value);
  return labels[text.toLowerCase()] || text;
}


export function clipForEvent(value, max = 1000) {
  const text = cleanString(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}


export function normalizeStringListCompat(value) {
  if (Array.isArray(value)) return value.map(cleanString).filter(Boolean);
  const text = cleanString(value);
  if (!text) return [];
  return text.split(/[,\n]/).map(cleanString).filter(Boolean);
}


export function toSnakeCompat(value) {
  return cleanString(value).replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}


export function clampRouteNumber(value, min, max, fallback) {
  if (value === "" || value === null || value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}


export function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}


export function clampDecimal(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

export function validateWorkspacePatchRecord(record) {
  if (!record) return { ok: false, error: "record_not_found" };
  if (record.type !== "approval" || record.meta?.kind !== "workspace-patch") return { ok: false, error: "workspace_patch_record_required" };
  if (record.state !== "pending") return { ok: false, error: "patch_review_already_resolved", state: record.state };
  if (!cleanString(record.meta?.rootId) || !cleanString(record.meta?.relativePath)) return { ok: false, error: "patch_target_missing" };
  if (typeof record.meta.content !== "string") return { ok: false, error: "patch_content_missing" };
  return { ok: true };
}


export function addQuery(url, params) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  return query ? `${url}?${query}` : url;
}


export function normalizeHermesPageAlias(c, alias = null) {
  const input = alias && typeof alias === "object" ? alias : {};
  return {
    route: cleanString(input.route) || c.req.path || "/workbench",
    requestedPath: cleanString(input.requestedPath) || c.req.path || "/workbench",
    section: cleanString(input.section) || "workbench",
    label: cleanString(input.label) || "Workbench",
    target: cleanString(input.target) || "mobileSectionControl",
    note: cleanString(input.note) || "Hermes Workspace page route mapped to HanaAgent OpenHanako plugin workbench.",
    sessionKey: cleanString(input.sessionKey)
  };
}


export function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}


export function escapeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}


export function downloadFilename(value) {
  const name = cleanString(String(value || "").split(/[\\/]/).filter(Boolean).pop() || "workspace-file")
    .replace(/[\r\n"]/g, "_")
    .replace(/[^\w .@()-]+/g, "_")
    .slice(0, 120);
  return name || "workspace-file";
}

export function computeHostGaps(capabilities) {
  const terminalAvailable = Boolean(capabilities.terminal || capabilities.terminalList || capabilities.terminalStart || capabilities.terminalRead || capabilities.terminalWrite || capabilities.terminalClose);
  return [
    { id: "session:create", available: Boolean(capabilities.sessionCreate), reason: "创建独立的执行智能体会话" },
    { id: "session:history", available: Boolean(capabilities.sessionHistory), reason: "显示执行智能体卡片的最近消息" },
    { id: "session:status", available: Boolean(capabilities.sessionStatus), reason: "读取实时运行状态" },
    { id: "session:abort", available: Boolean(capabilities.sessionAbort), reason: "停止失控的执行智能体" },
    { id: "session:revert-turn", available: Boolean(capabilities.sessionRevertTurn), reason: "恢复最近一轮助手消息的检查点" },
    { id: "agent:config", available: Boolean(capabilities.agentConfig), reason: "读取智能体模型、记忆和技能配置" },
    { id: "agent:skills", available: Boolean(capabilities.agentSkills), reason: "提供技能浏览界面" },
    { id: "usage:list", available: Boolean(capabilities.usageList), reason: "统计 Token 与成本" },
    { id: "checkpoint:list", available: Boolean(capabilities.checkpointList), reason: "审计宿主文件检查点" },
    { id: "task:*", available: Boolean(capabilities.taskList || capabilities.taskRegister), reason: "提供后台任务运行时" },
    { id: "deferred:*", available: Boolean(capabilities.deferredListPending || capabilities.deferredRegister), reason: "把异步结果投递回会话" },
    { id: "memory:list", available: Boolean(capabilities.memoryList), reason: "提供记忆浏览界面" },
    { id: "files", available: Boolean(capabilities.files), reason: "提供安全文件浏览器和编辑器" },
    { id: "terminal", available: terminalAvailable, reason: "使用宿主管理的伪终端（PTY）" }
  ];
}


export function buildSetupDoctor(input = {}) {
  const state = input.state || {};
  const capabilities = state.capabilities || {};
  const agents = Array.isArray(state.agents) ? state.agents : [];
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];
  const agentProfiles = Array.isArray(input.agentProfiles) ? input.agentProfiles : [];
  const workspaceRoots = Array.isArray(input.workspaceRoots) ? input.workspaceRoots : [];
  const incidents = Array.isArray(input.incidents) ? input.incidents : [];
  const hostGaps = Array.isArray(input.hostGaps) ? input.hostGaps : [];
  const operations = input.operations || {};
  const integrations = input.integrations || {};
  const config = state.config || {};
  const defaultAgent = config.defaultAgentId
    ? agents.find((agent) => agent.id === config.defaultAgentId)
    : agents[0];
  const defaultSession = config.defaultSessionPath
    ? sessions.find((session) => session.path === config.defaultSessionPath || session.sessionPath === config.defaultSessionPath)
    : sessions[0];
  const defaultProfile = defaultAgent
    ? agentProfiles.find((profile) => profile.agentId === defaultAgent.id || profile.config?.name === defaultAgent.name)
    : agentProfiles[0];
  const model = cleanString(defaultProfile?.config?.model || defaultProfile?.config?.models?.chat || defaultAgent?.model || defaultAgent?.modelId || defaultSession?.modelId || config.model);
  const terminalAvailable = Boolean(capabilities.terminalList || capabilities.terminalStart || capabilities.terminalRead || capabilities.terminalWrite || capabilities.terminalClose);
  const integrationHealth = integrations?.health || {};
  const checks = [
    {
      id: "agent",
      label: "Agent loaded",
      status: agents.length ? "pass" : "fail",
      weight: 3,
      detail: agents.length ? `${agents.length} agent(s) available` : "OpenHanako did not expose any agent.",
      action: agents.length ? "Ready for mission routing." : "Create or enable an OpenHanako agent.",
      repair: agents.length ? { type: "focus-section", target: "agentSelect", label: "View agents" } : { type: "reload-state", label: "Recheck agents" }
    },
    {
      id: "model",
      label: "Model/provider configured",
      status: model ? "pass" : "fail",
      weight: 4,
      detail: model ? `Default model: ${model}` : "No chat model detected from agent config, session, or plugin defaults.",
      action: model ? "Agent execution can use the configured model." : "Configure a chat model/API key in OpenHanako settings before running real workers.",
      repair: model
        ? { type: "open-model-chooser", label: "Review model" }
        : { type: "open-provider-setup", target: "providerSetupPanel", label: "Open Provider Setup", fallback: { type: "open-model-chooser", label: "Open Model Chooser" } }
    },
    {
      id: "session-send",
      label: "Session dispatch",
      status: capabilities.sessionSend ? "pass" : "fail",
      weight: 4,
      detail: capabilities.sessionSend ? "session:send is available." : "session:send is not available.",
      action: capabilities.sessionSend ? "Missions can dispatch worker prompts." : "Enable OpenHanako session runtime handlers.",
      repair: capabilities.sessionSend ? { type: "focus-section", target: "missionInput", label: "Open mission composer" } : { type: "reload-state", label: "Recheck session runtime" }
    },
    {
      id: "session",
      label: "Default/available session",
      status: defaultSession ? "pass" : (capabilities.sessionCreate ? "warn" : "fail"),
      weight: 2,
      detail: defaultSession ? `Session: ${defaultSession.title || defaultSession.path}` : "No existing session is available.",
      action: defaultSession ? "Worker cards can bind to this session." : capabilities.sessionCreate ? "Create a worker session from the workbench." : "Open or create a chat session in OpenHanako.",
      repair: defaultSession
        ? { type: "focus-section", target: "sessionSelect", label: "View session" }
        : capabilities.sessionCreate
          ? { type: "create-worker-session", label: "Create worker session" }
          : { type: "reload-sessions", label: "Reload sessions" }
    },
    {
      id: "session-history",
      label: "History and live inspection",
      status: capabilities.sessionHistory ? "pass" : "warn",
      weight: 2,
      detail: capabilities.sessionHistory ? "session:history is available." : "session:history is unavailable; worker trace will be limited.",
      action: capabilities.sessionHistory ? "Checkpoint sync and tool trace can read history." : "Expose session:history for Hermes-style trace parity.",
      repair: capabilities.sessionHistory ? { type: "sync-history", label: "Sync checkpoints" } : { type: "reload-state", label: "Recheck history" }
    },
    {
      id: "workspace-roots",
      label: "Workspace file roots",
      status: workspaceRoots.length ? "pass" : "warn",
      weight: 2,
      detail: workspaceRoots.length ? `${workspaceRoots.length} root(s) authorized` : "No writable workspace root is configured.",
      action: workspaceRoots.length ? "Files/editor preview can operate in the allowed roots." : "Add workspaceRoots in plugin defaults for file editing.",
      repair: workspaceRoots.length ? { type: "open-files", target: "workspaceFileList", label: "Open Files" } : { type: "open-files", target: "workspaceFileList", label: "Open Files setup" }
    },
    {
      id: "terminal",
      label: "Terminal runtime",
      status: terminalAvailable ? "pass" : "warn",
      weight: 1,
      detail: terminalAvailable ? "terminal:* capability is available." : "terminal:* capability is unavailable.",
      action: terminalAvailable ? "Session terminal can attach/read/write." : "Enable host-managed terminal handlers for PTY parity.",
      repair: terminalAvailable ? { type: "open-terminal", target: "terminalOutput", label: "Open Terminal" } : { type: "reload-state", label: "Recheck terminal" }
    },
    {
      id: "memory-skills",
      label: "Memory and skills surfaces",
      status: capabilities.memoryList || capabilities.agentSkills ? "pass" : "warn",
      weight: 1,
      detail: `memory:${capabilities.memoryList ? "on" : "local"} skills:${capabilities.agentSkills ? "on" : "gated"}`,
      action: capabilities.memoryList || capabilities.agentSkills ? "Runtime context panels are available." : "Local memory fallback works; host skills/memory handlers improve parity.",
      repair: capabilities.memoryList || capabilities.agentSkills ? { type: "open-memory-skills", target: "memoryEditor", label: "Open context" } : { type: "open-memory-skills", target: "memoryEditor", label: "Open local memory" }
    },
    {
      id: "operations",
      label: "Operations readiness",
      status: operations.readiness >= 85 ? "pass" : operations.readiness >= 60 ? "warn" : "fail",
      weight: 2,
      detail: `Operations readiness ${operations.readiness || 0}% / ${exportDisplayLabel(operations.status || "unknown")}`,
      action: "Use Operations checks to fill missing runtime capabilities.",
      repair: { type: "open-operations", target: "operationsPanel", label: "Open Operations" }
    },
    {
      id: "incidents",
      label: "Runtime incidents",
      status: incidents.some((item) => item.severity === "error") ? "fail" : incidents.length ? "warn" : "pass",
      weight: 2,
      detail: incidents.length ? `${incidents.length} incident(s): ${incidents.slice(0, 3).map((item) => item.id).join(", ")}` : "No runtime incidents detected.",
      action: incidents.length ? "Review overview incidents before long autonomous runs." : "Runtime stores are healthy.",
      repair: incidents.length ? { type: "reload-state", label: "Reload runtime" } : { type: "focus-section", target: "setupDoctorPanel", label: "View setup" }
    }
  ];
  const normalized = checks.map((check) => ({
    ...check,
    available: check.status === "pass"
  }));
  const totalWeight = normalized.reduce((sum, check) => sum + check.weight, 0);
  const readyWeight = normalized
    .filter((check) => check.status === "pass")
    .reduce((sum, check) => sum + check.weight, 0);
  const readiness = totalWeight ? Math.round((readyWeight / totalWeight) * 100) : 0;
  const summary = {
    total: normalized.length,
    pass: normalized.filter((check) => check.status === "pass").length,
    warn: normalized.filter((check) => check.status === "warn").length,
    blocking: normalized.filter((check) => check.status === "fail").length,
    hostGaps: hostGaps.filter((gap) => !gap.available).length,
    integrations: integrationHealth.total || 0
  };
  const firstBlocking = normalized.find((check) => check.status === "fail");
  const firstWarn = normalized.find((check) => check.status === "warn");
  return {
    ok: summary.blocking === 0,
    readiness,
    status: summary.blocking ? "blocked" : readiness >= 85 ? "ready" : "needs-setup",
    summary,
    nextAction: firstBlocking?.action || firstWarn?.action || "Workbench is ready for Hermes-style missions.",
    checks: normalized
  };
}

export function normalizePinnedSessions(items) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const sessionPath = cleanString(item?.sessionPath || item?.path);
    if (!sessionPath || seen.has(sessionPath)) continue;
    seen.add(sessionPath);
    result.push({
      sessionPath,
      title: cleanString(item?.title || item?.name) || sessionPath.split("/").filter(Boolean).pop() || sessionPath,
      agentId: cleanString(item?.agentId),
      cwd: cleanString(item?.cwd),
      pinnedAt: cleanString(item?.pinnedAt) || new Date().toISOString()
    });
    if (result.length >= 12) break;
  }
  return result;
}


export function normalizeSessionAliases(items) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const sessionPath = cleanString(item?.sessionPath || item?.path);
    const title = cleanString(item?.title || item?.name);
    if (!sessionPath || !title || seen.has(sessionPath)) continue;
    seen.add(sessionPath);
    result.push({
      sessionPath,
      title,
      source: cleanString(item?.source) || "hanaagent-workbench",
      updatedAt: cleanString(item?.updatedAt) || new Date().toISOString()
    });
    if (result.length >= 50) break;
  }
  return result;
}


export function normalizeSessionTombstones(items) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const sessionPath = cleanString(item?.sessionPath || item?.path);
    if (!sessionPath || seen.has(sessionPath)) continue;
    seen.add(sessionPath);
    result.push({
      sessionPath,
      title: cleanString(item?.title || item?.name),
      agentId: cleanString(item?.agentId),
      deletedAt: cleanString(item?.deletedAt) || new Date().toISOString(),
      reason: cleanString(item?.reason) || "hidden-from-hanaagent-workbench"
    });
    if (result.length >= 100) break;
  }
  return result;
}


export function normalizePinnedModels(items) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const model = cleanString(item?.model || item?.modelId);
    if (!model) continue;
    const agentId = cleanString(item?.agentId);
    const key = `${agentId}:${model}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      model,
      provider: cleanString(item?.provider),
      agentId,
      pinnedAt: cleanString(item?.pinnedAt) || new Date().toISOString()
    });
    if (result.length >= 12) break;
  }
  return result;
}


export function normalizeModelMetadataConfig(items) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const model = cleanString(item?.model || item?.modelId || item?.id);
    if (!model) continue;
    const provider = cleanString(item?.provider);
    const key = `${provider}:${model}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      model,
      provider,
      contextWindow: clampNumber(item?.contextWindow || item?.contextTokens || item?.maxContextTokens, 0, 1000000, 0),
      inputCostPer1M: clampDecimal(item?.inputCostPer1M || item?.promptCostPer1M || item?.inputCost, 0, 1000000, 0),
      outputCostPer1M: clampDecimal(item?.outputCostPer1M || item?.completionCostPer1M || item?.outputCost, 0, 1000000, 0),
      notes: cleanString(item?.notes || item?.description)
    });
    if (result.length >= 80) break;
  }
  return result;
}


export function normalizeSavedBoardViews(items) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const id = cleanString(item?.id || item?.title || item?.name).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
    const title = cleanString(item?.title || item?.name);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const filters = item?.filters && typeof item.filters === "object" ? item.filters : {};
    result.push({
      id,
      title,
      filters: {
        query: cleanString(filters.query),
        assignee: cleanString(filters.assignee),
        priority: cleanString(filters.priority)
      },
      createdAt: cleanString(item?.createdAt) || new Date().toISOString(),
      updatedAt: cleanString(item?.updatedAt) || new Date().toISOString()
    });
    if (result.length >= 12) break;
  }
  return result;
}


export function normalizeBoardWipLimits(input) {
  const valid = new Set(["backlog", "running", "blocked", "review", "done"]);
  const result = {};
  for (const [key, value] of Object.entries(input || {})) {
    const lane = cleanString(key);
    if (!valid.has(lane)) continue;
    const limit = Number(value);
    if (!Number.isFinite(limit) || limit <= 0) continue;
    result[lane] = Math.max(1, Math.min(99, Math.floor(limit)));
  }
  return result;
}


export function normalizeWorkbenchModes(items) {
  const seen = new Set();
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    const rawId = cleanString(item?.id || item?.title || item?.name);
    const id = rawId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
    const title = cleanString(item?.title || item?.name);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const settings = item?.settings && typeof item.settings === "object" ? item.settings : {};
    const mode = cleanString(settings.mode);
    const smart = settings.smartSuggestionsEnabled;
    result.push({
      id,
      title,
      description: cleanString(item?.description || item?.summary).slice(0, 240),
      settings: {
        defaultAgentId: cleanString(settings.defaultAgentId),
        defaultSessionPath: cleanString(settings.defaultSessionPath),
        mode: ["dispatch", "plan", "review"].includes(mode) ? mode : "dispatch",
        workerCount: clampNumber(settings.workerCount || settings.maxWorkers, 1, 8, 4),
        preferredModel: cleanString(settings.preferredModel || settings.model),
        preferredBudgetModel: cleanString(settings.preferredBudgetModel),
        preferredPremiumModel: cleanString(settings.preferredPremiumModel),
        smartSuggestionsEnabled: typeof smart === "boolean" ? smart : Boolean(smart),
        onlySuggestCheaper: Boolean(settings.onlySuggestCheaper),
        boardViewId: cleanString(settings.boardViewId),
        operationProfileId: cleanString(settings.operationProfileId)
      },
      createdAt: cleanString(item?.createdAt) || new Date().toISOString(),
      updatedAt: cleanString(item?.updatedAt) || new Date().toISOString()
    });
    if (result.length >= 16) break;
  }
  return result;
}


export function normalizeWorkbenchNotifications(input) {
  const volume = Number(input?.volume);
  return {
    enabled: typeof input?.enabled === "boolean" ? input.enabled : Boolean(input?.enabled),
    volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.28,
    browser: Boolean(input?.browser),
    haptics: typeof input?.haptics === "boolean" ? input.haptics : true
  };
}


export function normalizeWorkbenchSettings(input) {
  const themePreset = cleanString(input?.themePreset);
  const theme = cleanString(input?.theme);
  const accentColor = cleanString(input?.accentColor);
  const mobileChatNavMode = cleanString(input?.mobileChatNavMode);
  const allowedPresets = ["hermes", "starmap", "claude-official", "claude-official-light", "claude-classic", "classic-light", "slate", "slate-light", "mono", "mono-light"];
  return {
    themePreset: allowedPresets.includes(themePreset) ? themePreset : "starmap",
    theme: ["system", "light", "dark"].includes(theme) ? theme : "system",
    accentColor: ["blue", "green", "orange", "purple", "mono"].includes(accentColor) ? accentColor : "blue",
    editorFontSize: clampNumber(input?.editorFontSize, 11, 22, 13),
    editorWordWrap: typeof input?.editorWordWrap === "boolean" ? input.editorWordWrap : true,
    editorMinimap: Boolean(input?.editorMinimap),
    usageThreshold: clampNumber(input?.usageThreshold, 50, 95, 80),
    showSystemMetricsFooter: Boolean(input?.showSystemMetricsFooter),
    mobileChatNavMode: ["dock", "integrated", "scroll-hide"].includes(mobileChatNavMode) ? mobileChatNavMode : "dock",
    calendarTimezone: normalizeCalendarTimezone(input?.calendarTimezone)
  };
}


export function normalizeWorkbenchOnboarding(input) {
  return {
    completed: Boolean(input?.completed),
    dismissed: Boolean(input?.dismissed),
    lastStep: clampNumber(input?.lastStep, 0, 7, 0),
    completedAt: cleanString(input?.completedAt),
    dismissedAt: cleanString(input?.dismissedAt),
    updatedAt: cleanString(input?.updatedAt) || new Date().toISOString()
  };
}

export function activityTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(cleanString(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function firstCompatLine(value) {
  return String(value || "").split(/\r?\n/).find((line) => line.trim())?.trim() || "";
}

export function overviewMissionItems(overview = {}) {
  if (Array.isArray(overview.missions)) return overview.missions;
  if (Array.isArray(overview.missions?.items)) return overview.missions.items;
  if (Array.isArray(overview.overview?.sections?.missions?.items)) return overview.overview.sections.missions.items;
  return [];
}

