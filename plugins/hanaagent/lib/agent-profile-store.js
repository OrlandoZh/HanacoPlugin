import fs from "node:fs";
import path from "node:path";

const STORE_FILE = "agent-profiles.json";

export function listAgentProfiles(dataDir) {
  return readStore(dataDir).profiles;
}

export function getAgentProfile(dataDir, agentId) {
  const id = clean(agentId);
  if (!id) return null;
  return readStore(dataDir).profiles.find((profile) => profile.agentId === id) || null;
}

export function saveAgentProfile(dataDir, input = {}) {
  const agentId = clean(input.agentId);
  if (!agentId) return { ok: false, error: "agentId_required" };

  const now = new Date().toISOString();
  const partial = normalizeProfilePartial(input.partial || input.config || input);
  const store = readStore(dataDir);
  const previous = store.profiles.find((profile) => profile.agentId === agentId) || null;
  const next = {
    agentId,
    name: clean(input.name) || clean(partial.name) || previous?.name || agentId,
    partial,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    source: clean(input.source) || "hanaagent"
  };
  const profiles = store.profiles.filter((profile) => profile.agentId !== agentId);
  profiles.unshift(next);
  writeStore(dataDir, { profiles });
  return { ok: true, profile: next };
}

export function deleteAgentProfile(dataDir, agentId) {
  const id = clean(agentId);
  if (!id) return { ok: false, error: "agentId_required" };
  const store = readStore(dataDir);
  const profiles = store.profiles.filter((profile) => profile.agentId !== id);
  if (profiles.length === store.profiles.length) return { ok: false, error: "profile_not_found", agentId: id };
  writeStore(dataDir, { profiles });
  return { ok: true, agentId: id };
}

export function mergeAgentProfileConfig(base = {}, profile = null) {
  if (!profile?.partial || typeof profile.partial !== "object") return base || {};
  const partial = profile.partial;
  const merged = {
    ...(base || {}),
    ...(partial.name ? { name: partial.name } : {}),
    ...(partial.description ? { description: partial.description } : {}),
    ...(partial.model ? { model: partial.model } : {}),
    models: {
      ...((base && base.models) || {}),
      ...(partial.models || {})
    },
    memory: {
      ...((base && base.memory) || {}),
      ...(partial.memory || {})
    },
    agent: {
      ...((base && base.agent) || {}),
      ...(partial.agent || {})
    },
    skills: {
      ...((base && base.skills) || {}),
      ...(partial.skills || {})
    },
    override: {
      agentId: profile.agentId,
      updatedAt: profile.updatedAt,
      source: profile.source || "hanaagent"
    }
  };
  if (partial.model) merged.models.chat = partial.model;
  return merged;
}

export function normalizeProfilePartial(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const skills = source.skills && typeof source.skills === "object" ? source.skills : {};
  const memory = source.memory && typeof source.memory === "object" ? source.memory : {};
  const models = source.models && typeof source.models === "object" ? source.models : {};
  const agent = source.agent && typeof source.agent === "object" ? source.agent : {};
  const partial = {};
  const name = clean(source.name);
  const description = clean(source.description || source.role || source.system);
  const model = clean(source.model || source.chatModel || models.chat);
  const memoryModel = clean(memory.model || source.memoryModel);
  const memoryEnabled = booleanValue(memory.enabled);
  const memoryUserProfile = booleanValue(memory.userProfileEnabled ?? memory.user_profile_enabled ?? source.userProfileEnabled);
  const maxTurns = boundedInteger(agent.maxTurns ?? agent.max_turns ?? source.maxTurns ?? source.max_turns, 1, 100);
  const gatewayTimeout = boundedInteger(agent.gatewayTimeout ?? agent.gateway_timeout ?? source.gatewayTimeout ?? source.gateway_timeout, 10, 600);
  const toolUseEnforcement = enumValue(agent.toolUseEnforcement ?? agent.tool_use_enforcement ?? source.toolUseEnforcement ?? source.tool_use_enforcement, ["auto", "required", "none"]);
  if (name) partial.name = name;
  if (description) partial.description = description;
  if (model) {
    partial.model = model;
    partial.models = { ...models, chat: model };
  } else if (Object.keys(models).length) {
    partial.models = sanitizeObject(models);
  }
  if (memoryEnabled !== null || memoryUserProfile !== null || memoryModel) {
    partial.memory = {};
    if (memoryEnabled !== null) partial.memory.enabled = memoryEnabled;
    if (memoryUserProfile !== null) partial.memory.userProfileEnabled = memoryUserProfile;
    if (memoryModel) partial.memory.model = memoryModel;
  }
  if (maxTurns !== null || gatewayTimeout !== null || toolUseEnforcement) {
    partial.agent = {};
    if (maxTurns !== null) partial.agent.maxTurns = maxTurns;
    if (gatewayTimeout !== null) partial.agent.gatewayTimeout = gatewayTimeout;
    if (toolUseEnforcement) partial.agent.toolUseEnforcement = toolUseEnforcement;
  }
  if (Array.isArray(skills.enabled) || typeof source.enabledSkills === "string" || Array.isArray(source.enabledSkills)) {
    const enabled = Array.isArray(skills.enabled)
      ? skills.enabled
      : Array.isArray(source.enabledSkills)
        ? source.enabledSkills
        : String(source.enabledSkills || "").split(",");
    partial.skills = {
      enabled: enabled.map(clean).filter(Boolean)
    };
  }
  return partial;
}

function readStore(dataDir) {
  const file = storePath(dataDir);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const profiles = Array.isArray(parsed?.profiles) ? parsed.profiles.map(normalizeProfile).filter(Boolean) : [];
    return { profiles };
  } catch {
    return { profiles: [] };
  }
}

function writeStore(dataDir, store) {
  const file = storePath(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ profiles: store.profiles || [] }, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function storePath(dataDir) {
  return path.join(dataDir || process.cwd(), STORE_FILE);
}

function normalizeProfile(profile) {
  if (!profile || typeof profile !== "object") return null;
  const agentId = clean(profile.agentId);
  if (!agentId) return null;
  return {
    agentId,
    name: clean(profile.name) || agentId,
    partial: normalizeProfilePartial(profile.partial || {}),
    createdAt: clean(profile.createdAt),
    updatedAt: clean(profile.updatedAt),
    source: clean(profile.source) || "hanaagent"
  };
}

function sanitizeObject(input) {
  const output = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (!clean(key)) continue;
    if (typeof value === "string") output[key] = clean(value);
    else if (typeof value === "boolean" || typeof value === "number") output[key] = value;
  }
  return output;
}

function booleanValue(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["true", "enabled", "on", "yes", "1"].includes(text)) return true;
    if (["false", "disabled", "off", "no", "0"].includes(text)) return false;
  }
  return null;
}

function boundedInteger(value, min, max) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function enumValue(value, allowed) {
  const text = clean(value);
  return allowed.includes(text) ? text : "";
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
