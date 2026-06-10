import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const PROFILE_PRESETS = [
  {
    id: "sage",
    label: "Sage",
    role: "Strategy",
    mission: "Clarify ambiguous goals, decompose strategy, and surface decisions before execution.",
    roles: ["orchestrator", "reviewer", "scribe"],
    maxWorkers: 3,
    tags: ["planning", "decision", "handoff"]
  },
  {
    id: "builder",
    label: "Builder",
    role: "Implementation",
    mission: "Ship focused implementation slices with tests, artifacts, and concrete verification.",
    roles: ["orchestrator", "builder", "qa", "scribe"],
    maxWorkers: 4,
    tags: ["build", "verify", "artifact"]
  },
  {
    id: "reviewer",
    label: "Reviewer",
    role: "Quality",
    mission: "Find regressions, missing evidence, unsafe assumptions, and release blockers.",
    roles: ["reviewer", "qa", "scribe"],
    maxWorkers: 3,
    tags: ["review", "risk", "gate"]
  },
  {
    id: "researcher",
    label: "Researcher",
    role: "Research",
    mission: "Gather sources, compare options, label uncertainty, and produce a decision-ready brief.",
    roles: ["orchestrator", "scribe", "reviewer"],
    maxWorkers: 3,
    tags: ["research", "sources", "brief"]
  },
  {
    id: "ops",
    label: "Ops",
    role: "Operations",
    mission: "Watch runtime health, jobs, blockers, stale workers, and human escalation queues.",
    roles: ["orchestrator", "qa", "scribe"],
    maxWorkers: 3,
    tags: ["health", "jobs", "escalation"]
  }
];

const REQUIRED_CAPABILITIES = [
  { id: "session:send", key: "sessionSend", weight: 3 },
  { id: "session:history", key: "sessionHistory", weight: 2 },
  { id: "session:status", key: "sessionStatus", weight: 2 },
  { id: "session:create", key: "sessionCreate", weight: 2 },
  { id: "task:*", key: "taskList", any: ["taskRegister", "taskUpdate"], weight: 2 },
  { id: "checkpoint:*", key: "checkpointList", any: ["checkpointFindBySessionSince"], weight: 2 },
  { id: "terminal:*", key: "terminalList", any: ["terminalStart", "terminalRead", "terminalWrite"], weight: 1 },
  { id: "usage:list", key: "usageList", weight: 1 },
  { id: "agent:config", key: "agentConfig", weight: 1 },
  { id: "agent:skills", key: "agentSkills", weight: 1 },
  { id: "memory:list", key: "memoryList", weight: 1 }
];

const ROSTER_ARRAY_FIELDS = [
  "modes",
  "tools",
  "skills",
  "capabilities",
  "preferredTaskTypes",
  "greenlightRequiredFor",
  "plugins",
  "pluginToolsets",
  "mcpServers"
];

const ROSTER_SCALAR_FIELDS = [
  "specialty",
  "model",
  "mission",
  "profile",
  "wrapper",
  "defaultCwd"
];

const MAX_PROFILE_ROLES = 24;
const MAX_PROFILE_LANES = 24;

export function listOperationPresets() {
  return PROFILE_PRESETS.map(clonePreset);
}

export function getOperationPreset(presetId) {
  const id = clean(presetId) || "builder";
  return clonePreset(PROFILE_PRESETS.find((preset) => preset.id === id) || PROFILE_PRESETS.find((preset) => preset.id === "builder"));
}

export function buildOperationsOverview(input = {}) {
  const capabilities = input.capabilities || {};
  const agents = Array.isArray(input.agents) ? input.agents : [];
  const sessions = Array.isArray(input.sessions) ? input.sessions : [];
  const workerCards = Array.isArray(input.workerCards) ? input.workerCards : [];
  const hostTasks = Array.isArray(input.hostTasks) ? input.hostTasks : [];
  const deferredTasks = Array.isArray(input.deferredTasks) ? input.deferredTasks : [];
  const inbox = input.inbox || {};
  const autopilotSchedule = input.autopilotSchedule || {};

  const capabilityChecks = REQUIRED_CAPABILITIES.map((item) => {
    const available = Boolean(capabilities[item.key] || (item.any || []).some((key) => capabilities[key]));
    return {
      id: item.id,
      available,
      weight: item.weight
    };
  });
  const totalWeight = capabilityChecks.reduce((sum, item) => sum + item.weight, 0);
  const readyWeight = capabilityChecks.filter((item) => item.available).reduce((sum, item) => sum + item.weight, 0);
  const readiness = totalWeight ? Math.round((readyWeight / totalWeight) * 100) : 0;
  const activeWorkers = workerCards.filter((card) => !["idle", "done", "cancelled", "offline"].includes(clean(card.status))).length;
  const blockers = Number(inbox.summary?.blockers || 0);
  const pendingApprovals = Number(inbox.summary?.approvals || 0);
  const openTasks = hostTasks.filter((task) => !["done", "complete", "completed", "cancelled", "failed"].includes(clean(task.status))).length;

  return {
    ok: true,
    readiness,
    status: readiness >= 85 ? "ready" : readiness >= 60 ? "needs-setup" : "limited",
    presets: listOperationPresets(),
    profiles: Array.isArray(input.profiles) ? input.profiles.map(cloneProfile) : [],
    recommendedPresetId: recommendPreset({ blockers, pendingApprovals, agents, activeWorkers }),
    metrics: {
      agents: agents.length,
      sessions: sessions.length,
      workers: workerCards.length,
      activeWorkers,
      hostTasks: hostTasks.length,
      openHostTasks: openTasks,
      deferredTasks: deferredTasks.length,
      blockers,
      pendingApprovals,
      autopilotEnabled: autopilotSchedule.enabled === true,
      shareableProfiles: Array.isArray(input.profiles) ? input.profiles.filter((profile) => profile.visibility !== "private").length : 0
    },
    checks: capabilityChecks
  };
}

export function buildPresetMissionInput(input = {}) {
  return buildProfileMissionInput({
    ...input,
    profile: getOperationPreset(input.presetId),
    templateLabelPrefix: "Operations"
  });
}

export function buildProfileMissionInput(input = {}) {
  const profile = normalizeProfile(input.profile || getOperationPreset(input.presetId));
  const goal = clean(input.goal) || profile.mission;
  return {
    goal,
    notes: [
      clean(input.notes),
      `Operations profile: ${profile.label} (${profile.role})`,
    `Profile mission: ${profile.mission}`,
      profile.defaultCwd ? `Default cwd: ${profile.defaultCwd}` : "",
      `Tags: ${profile.tags.join(", ")}`
    ].filter(Boolean).join("\n"),
    roles: profile.roles,
    lanes: profile.lanes.map(cloneLane),
    maxWorkers: clampInt(input.maxWorkers || profile.maxWorkers, 1, MAX_PROFILE_LANES, profile.maxWorkers),
    mode: clean(input.mode) || (profile.id === "reviewer" ? "review" : "dispatch"),
    templateId: clean(input.templateId) || (profile.id === "researcher" ? "research" : profile.id === "reviewer" ? "review" : "orchestrate"),
    templateLabel: `${clean(input.templateLabelPrefix) || "Operations"}: ${profile.label}`,
    sessionPath: clean(input.sessionPath) || "",
    agentId: clean(input.agentId) || "",
    cwd: profile.defaultCwd,
    defaultCwd: profile.defaultCwd,
    createdBy: "hanaagent-operations",
    presetId: profile.presetId || profile.id,
    profileId: profile.id
  };
}

export function listOperationProfiles(dataDir, options = {}) {
  const file = readProfileFile(dataDir);
  let profiles = file.profiles.map(normalizeProfile).filter(Boolean);
  if (options.includeBuiltins !== false) {
    const existing = new Set(profiles.map((profile) => profile.id));
    const builtins = PROFILE_PRESETS.map((preset) => normalizeProfile({ ...preset, builtin: true, presetId: preset.id }))
      .filter((profile) => !existing.has(profile.id));
    profiles = [...profiles, ...builtins];
  }
  return profiles.sort((a, b) => Number(b.updatedAt > a.updatedAt) - Number(a.updatedAt > b.updatedAt) || a.label.localeCompare(b.label));
}

export function getOperationProfile(dataDir, profileId) {
  const id = clean(profileId);
  if (!id) return null;
  return listOperationProfiles(dataDir).find((profile) => profile.id === id) || null;
}

export function saveOperationProfile(dataDir, input = {}) {
  const profile = normalizeProfile({
    ...input,
    id: clean(input.id) || `profile-${randomUUID()}`,
    builtin: false
  });
  if (!profile) return { ok: false, error: "profile_required" };
  const file = readProfileFile(dataDir);
  const profiles = file.profiles.map(normalizeProfile).filter((item) => item && item.id !== profile.id);
  profiles.push(profile);
  writeProfileFile(dataDir, { profiles });
  return { ok: true, profile };
}

export function exportOperationProfile(dataDir, profileId, options = {}) {
  const profile = getOperationProfile(dataDir, profileId);
  if (!profile) return { ok: false, error: "profile_not_found" };
  const exportedAt = clean(options.exportedAt) || new Date().toISOString();
  const bundle = {
    schema: "hanaagent.operationProfile",
    version: 1,
    exportedAt,
    source: {
      plugin: "hanaagent",
      format: "operation-profile-bundle"
    },
    profile: cloneProfile(profile)
  };
  return {
    ok: true,
    profile: bundle.profile,
    bundle,
    filename: `${safeFilename(profile.label || profile.id)}.hanaagent-profile.json`
  };
}

export function profileToSwarmRoster(profileInput, options = {}) {
  const profile = normalizeProfile(profileInput);
  if (!profile) return null;
  const exportedAt = clean(options.exportedAt) || new Date().toISOString();
  const workers = profile.lanes.map((lane) => laneToRosterWorker(lane, profile)).filter(Boolean);
  return {
    version: Number.isFinite(Number(options.version)) ? Number(options.version) : 1,
    metadata: {
      schema: "hanaagent.swarmRoster",
      source: "hanaagent",
      profileId: profile.id,
      profileLabel: profile.label,
      exportedAt
    },
    workers
  };
}

export function swarmRosterToProfile(rosterInput = {}, options = {}) {
  const roster = normalizeSwarmRosterPayload(rosterInput);
  if (!roster.ok) return { ok: false, error: roster.error };
  const workers = roster.roster.workers;
  const id = clean(options.id)
    || safeFilename(clean(roster.roster.metadata?.profileId) || clean(roster.roster.name) || clean(roster.roster.metadata?.profileLabel) || "swarm-roster");
  const label = clean(options.label)
    || clean(roster.roster.metadata?.profileLabel)
    || clean(roster.roster.name)
    || "Swarm Roster";
  const lanes = workers.map((worker, index) => rosterWorkerToLane(worker, index));
  const roles = unique(lanes.map((lane) => lane.roleId).filter(Boolean)).slice(0, MAX_PROFILE_ROLES);
  const defaultCwd = clean(options.defaultCwd) || clean(workers.find((worker) => clean(worker.defaultCwd || worker.cwd))?.defaultCwd) || "";
  const profile = normalizeProfile({
    id,
    label,
    role: clean(options.role) || "Swarm Roster",
    mission: clean(options.mission) || clean(roster.roster.mission) || "Coordinate an imported Hermes-style swarm roster.",
    roles,
    maxWorkers: clampInt(options.maxWorkers || roles.length || workers.length, 1, MAX_PROFILE_LANES, Math.min(Math.max(roles.length || workers.length, 1), MAX_PROFILE_LANES)),
    tags: ["swarm", "roster", "hermes"],
    lanes,
    defaultCwd,
    presetId: "swarm-roster",
    visibility: clean(options.visibility) || "workspace",
    importedFrom: clean(options.importedFrom) || clean(roster.roster.metadata?.source) || "swarm-roster",
    importedAt: clean(options.importedAt) || new Date().toISOString(),
    builtin: false
  });
  return profile ? { ok: true, profile, roster: roster.roster } : { ok: false, error: "profile_required" };
}

export function exportSwarmRoster(dataDir, profileId, options = {}) {
  const profile = getOperationProfile(dataDir, profileId);
  if (!profile) return { ok: false, error: "profile_not_found" };
  const roster = profileToSwarmRoster(profile, options);
  if (!roster) return { ok: false, error: "roster_required" };
  const format = clean(options.format || "json").toLowerCase();
  const filenameBase = safeFilename(`${profile.label || profile.id}-swarm-roster`);
  const body = format === "yaml" || format === "yml"
    ? stringifySimpleYaml(roster)
    : JSON.stringify(roster, null, 2) + "\n";
  return {
    ok: true,
    profile,
    roster,
    format: format === "yaml" || format === "yml" ? "yaml" : "json",
    body,
    filename: `${filenameBase}.${format === "yaml" || format === "yml" ? "yaml" : "json"}`
  };
}

export function importSwarmRoster(dataDir, input = {}) {
  const parsed = parseSwarmRosterInput(input);
  if (!parsed.ok) return parsed;
  const converted = swarmRosterToProfile(parsed.roster, input);
  if (!converted.ok) return converted;
  return importOperationProfile(dataDir, {
    profile: converted.profile,
    id: clean(input.id) || converted.profile.id,
    overwrite: input.overwrite === true,
    importedAt: clean(input.importedAt) || converted.profile.importedAt,
    importedFrom: clean(input.importedFrom) || "swarm-roster"
  });
}

export function importOperationProfile(dataDir, input = {}) {
  const payload = input.bundle || input.profile || input;
  const rawProfile = payload?.schema === "hanaagent.operationProfile" ? payload.profile : payload;
  const idPrefix = clean(input.idPrefix);
  const overwrite = input.overwrite === true;
  const importedAt = clean(input.importedAt) || new Date().toISOString();
  const profile = normalizeProfile({
    ...rawProfile,
    id: clean(input.id) || safeFilename(idPrefix ? `${idPrefix}-${clean(rawProfile?.id || rawProfile?.label)}` : clean(rawProfile?.id || rawProfile?.label)),
    importedAt,
    importedFrom: clean(input.importedFrom || payload?.source?.plugin || payload?.source?.format) || "operation-profile-bundle",
    builtin: false
  });
  if (!profile) return { ok: false, error: "profile_required" };
  const file = readProfileFile(dataDir);
  const profiles = file.profiles.map(normalizeProfile).filter(Boolean);
  const exists = profiles.some((item) => item.id === profile.id);
  if (exists && !overwrite) return { ok: false, error: "profile_exists", profileId: profile.id };
  const next = profiles.filter((item) => item.id !== profile.id);
  next.push(profile);
  writeProfileFile(dataDir, { profiles: next });
  return { ok: true, imported: true, overwritten: exists, profile };
}

export function deleteOperationProfile(dataDir, profileId) {
  const id = clean(profileId);
  if (!id) return { ok: false, error: "profileId_required" };
  const file = readProfileFile(dataDir);
  const profiles = file.profiles.map(normalizeProfile).filter(Boolean);
  const next = profiles.filter((profile) => profile.id !== id);
  if (next.length === profiles.length) return { ok: false, error: "profile_not_found" };
  writeProfileFile(dataDir, { profiles: next });
  return { ok: true, deleted: id };
}

export function seedOperationProfileFromPreset(dataDir, presetId, input = {}) {
  const preset = getOperationPreset(presetId);
  return saveOperationProfile(dataDir, {
    ...preset,
    ...input,
    id: clean(input.id) || `${preset.id}-profile`,
    presetId: preset.id,
    label: clean(input.label) || `${preset.label} Team`,
    builtin: false
  });
}

function recommendPreset({ blockers, pendingApprovals, agents, activeWorkers }) {
  if (blockers || pendingApprovals) return "ops";
  if (!agents.length || !activeWorkers) return "sage";
  return "builder";
}

function clonePreset(preset) {
  return {
    ...preset,
    roles: [...preset.roles],
    tags: [...preset.tags]
  };
}

function cloneProfile(profile) {
  return {
    ...profile,
    roles: [...profile.roles],
    tags: [...profile.tags],
    lanes: profile.lanes.map(cloneLane),
    permissions: { ...(profile.permissions || {}) },
    sharedWith: Array.isArray(profile.sharedWith) ? profile.sharedWith.map((entry) => ({ ...entry })) : []
  };
}

function normalizeProfile(value) {
  if (!value || typeof value !== "object") return null;
  const id = clean(value.id || value.presetId);
  const label = clean(value.label || value.name);
  if (!id || !label) return null;
  const roles = Array.isArray(value.roles) ? value.roles.map(clean).filter(Boolean).slice(0, MAX_PROFILE_ROLES) : ["orchestrator", "builder", "reviewer"];
  const tags = Array.isArray(value.tags) ? value.tags.map(clean).filter(Boolean).slice(0, 12) : [];
  const createdAt = clean(value.createdAt) || new Date().toISOString();
  const updatedAt = clean(value.updatedAt) || createdAt;
  const visibility = ["private", "workspace", "team", "public"].includes(clean(value.visibility)) ? clean(value.visibility) : "private";
  return {
    id,
    label,
    role: clean(value.role) || "Operations",
    mission: clean(value.mission) || "Coordinate an agent team and produce checkpointed results.",
    roles: roles.length ? roles : ["orchestrator", "builder", "reviewer"],
    maxWorkers: clampInt(value.maxWorkers, 1, MAX_PROFILE_LANES, roles.length || 3),
    tags,
    lanes: normalizeLanes(value.lanes, roles),
    defaultCwd: clean(value.defaultCwd || value.cwd),
    defaultAgentId: clean(value.defaultAgentId || value.agentId),
    defaultSessionPath: clean(value.defaultSessionPath || value.sessionPath),
    presetId: clean(value.presetId) || id,
    visibility,
    permissions: normalizePermissions(value.permissions),
    sharedWith: normalizeSharedWith(value.sharedWith),
    importedFrom: clean(value.importedFrom),
    importedAt: clean(value.importedAt),
    builtin: value.builtin === true,
    createdAt,
    updatedAt
  };
}

function normalizePermissions(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    dispatch: source.dispatch !== false,
    edit: source.edit !== false,
    manageApprovals: source.manageApprovals === true,
    manageAutopilot: source.manageAutopilot === true,
    terminal: source.terminal === true,
    files: source.files === true,
    share: source.share === true
  };
}

function normalizeSharedWith(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === "string") return { type: "user", id: clean(entry), role: "viewer" };
    return {
      type: clean(entry?.type) || "user",
      id: clean(entry?.id || entry?.name || entry?.email),
      role: ["viewer", "operator", "owner"].includes(clean(entry?.role)) ? clean(entry.role) : "viewer"
    };
  }).filter((entry) => entry.id).slice(0, 25);
}

function normalizeLanes(lanes, roles) {
  if (Array.isArray(lanes) && lanes.length) {
    return lanes.map((lane, index) => normalizeLane(lane, roles, index)).filter(Boolean).slice(0, MAX_PROFILE_LANES);
  }
  return roles.map((roleId) => ({
    id: roleId,
    roleId,
    label: roleId,
    agentId: "",
    sessionPath: "",
    cwd: ""
  }));
}

function cloneLane(lane) {
  const cloned = { ...lane };
  for (const field of ROSTER_ARRAY_FIELDS) {
    if (Array.isArray(cloned[field])) cloned[field] = [...cloned[field]];
  }
  return cloned;
}

function normalizeLane(lane, roles, index) {
  if (!lane || typeof lane !== "object") return null;
  const id = clean(lane.id) || clean(lane.roleId) || roles[index] || `lane-${index + 1}`;
  const roleId = clean(lane.roleId || lane.role_id || lane.role) || clean(lane.id) || roles[index] || "worker";
  const normalized = {
    id,
    roleId,
    label: clean(lane.label || lane.name) || clean(lane.role) || roleId,
    agentId: clean(lane.agentId || lane.agent_id),
    sessionPath: clean(lane.sessionPath || lane.session_path),
    cwd: clean(lane.cwd || lane.defaultCwd || lane.default_cwd)
  };
  for (const field of ROSTER_SCALAR_FIELDS) {
    const value = clean(lane[field] || lane[toSnake(field)]);
    if (value) normalized[field] = value;
  }
  for (const field of ROSTER_ARRAY_FIELDS) {
    const values = normalizeStringArray(lane[field] || lane[toSnake(field)]).slice(0, 40);
    if (values.length) normalized[field] = values;
  }
  if (Number.isFinite(Number(lane.maxConcurrentTasks || lane.max_concurrent_tasks))) {
    normalized.maxConcurrentTasks = clampInt(lane.maxConcurrentTasks || lane.max_concurrent_tasks, 1, 99, 1);
  }
  if (typeof lane.acceptsBroadcast === "boolean" || typeof lane.accepts_broadcast === "boolean") {
    normalized.acceptsBroadcast = lane.acceptsBroadcast === true || lane.accepts_broadcast === true;
  }
  if (typeof lane.reviewRequired === "boolean" || typeof lane.review_required === "boolean") {
    normalized.reviewRequired = lane.reviewRequired === true || lane.review_required === true;
  }
  return normalized;
}

function laneToRosterWorker(lane, profile) {
  const worker = {
    id: clean(lane.id) || clean(lane.roleId) || "worker",
    name: clean(lane.label || lane.name) || clean(lane.id) || "Worker",
    role: clean(lane.role || lane.roleId) || "Worker"
  };
  const defaults = {
    mission: clean(lane.mission) || profile.mission,
    profile: clean(lane.profile) || clean(lane.roleId),
    defaultCwd: clean(lane.defaultCwd || lane.cwd) || profile.defaultCwd
  };
  for (const field of ROSTER_SCALAR_FIELDS) {
    const value = clean(lane[field]) || clean(defaults[field]);
    if (value) worker[field] = value;
  }
  for (const field of ROSTER_ARRAY_FIELDS) {
    const values = normalizeStringArray(lane[field]);
    worker[field] = values;
  }
  if (Number.isFinite(Number(lane.maxConcurrentTasks))) worker.maxConcurrentTasks = clampInt(lane.maxConcurrentTasks, 1, 99, 1);
  if (typeof lane.acceptsBroadcast === "boolean") worker.acceptsBroadcast = lane.acceptsBroadcast;
  if (typeof lane.reviewRequired === "boolean") worker.reviewRequired = lane.reviewRequired;
  if (clean(lane.agentId)) worker.agentId = clean(lane.agentId);
  if (clean(lane.sessionPath)) worker.sessionPath = clean(lane.sessionPath);
  if (clean(lane.cwd)) worker.cwd = clean(lane.cwd);
  return worker;
}

function rosterWorkerToLane(worker, index) {
  const id = clean(worker.id) || safeFilename(clean(worker.name || worker.role)) || `worker-${index + 1}`;
  const lane = {
    id,
    roleId: safeFilename(clean(worker.profile || worker.role || id)) || id,
    label: clean(worker.name) || clean(worker.role) || id,
    agentId: clean(worker.agentId || worker.agent_id),
    sessionPath: clean(worker.sessionPath || worker.session_path),
    cwd: clean(worker.cwd || worker.defaultCwd || worker.default_cwd)
  };
  for (const field of ROSTER_SCALAR_FIELDS) {
    const value = clean(worker[field] || worker[toSnake(field)]);
    if (value) lane[field] = value;
  }
  for (const field of ROSTER_ARRAY_FIELDS) {
    const values = normalizeStringArray(worker[field] || worker[toSnake(field)]).slice(0, 40);
    if (values.length) lane[field] = values;
  }
  if (Number.isFinite(Number(worker.maxConcurrentTasks || worker.max_concurrent_tasks))) {
    lane.maxConcurrentTasks = clampInt(worker.maxConcurrentTasks || worker.max_concurrent_tasks, 1, 99, 1);
  }
  if (typeof worker.acceptsBroadcast === "boolean" || typeof worker.accepts_broadcast === "boolean") {
    lane.acceptsBroadcast = worker.acceptsBroadcast === true || worker.accepts_broadcast === true;
  }
  if (typeof worker.reviewRequired === "boolean" || typeof worker.review_required === "boolean") {
    lane.reviewRequired = worker.reviewRequired === true || worker.review_required === true;
  }
  return lane;
}

function parseSwarmRosterInput(input = {}) {
  if (input.roster && typeof input.roster === "object") return normalizeSwarmRosterPayload(input.roster);
  if (input.bundle && typeof input.bundle === "object") return normalizeSwarmRosterPayload(input.bundle);
  if (input.workers && typeof input === "object") return normalizeSwarmRosterPayload(input);
  const raw = typeof input === "string" ? input : clean(input.text || input.content || input.yaml || input.json);
  if (!raw) return { ok: false, error: "roster_required" };
  try {
    return normalizeSwarmRosterPayload(JSON.parse(raw));
  } catch {
    try {
      return normalizeSwarmRosterPayload(parseSimpleYaml(raw));
    } catch (error) {
      return { ok: false, error: "roster_parse_failed", detail: error.message || String(error) };
    }
  }
}

function normalizeSwarmRosterPayload(payload) {
  if (!payload || typeof payload !== "object") return { ok: false, error: "roster_required" };
  const workers = Array.isArray(payload.workers)
    ? payload.workers
    : Array.isArray(payload.roster?.workers)
      ? payload.roster.workers
      : [];
  if (!workers.length) return { ok: false, error: "workers_required" };
  return {
    ok: true,
    roster: {
      version: Number.isFinite(Number(payload.version)) ? Number(payload.version) : 1,
      name: clean(payload.name || payload.label),
      mission: clean(payload.mission),
      metadata: payload.metadata && typeof payload.metadata === "object" ? { ...payload.metadata } : {},
      workers: workers.map(normalizeRosterWorker).filter(Boolean).slice(0, MAX_PROFILE_LANES)
    }
  };
}

function normalizeRosterWorker(worker, index) {
  if (!worker || typeof worker !== "object") return null;
  const id = clean(worker.id) || safeFilename(clean(worker.name || worker.role)) || `worker-${index + 1}`;
  if (!id) return null;
  const normalized = {
    id,
    name: clean(worker.name) || id,
    role: clean(worker.role) || id
  };
  for (const field of ROSTER_SCALAR_FIELDS) {
    const value = clean(worker[field] || worker[toSnake(field)]);
    if (value) normalized[field] = value;
  }
  for (const field of ROSTER_ARRAY_FIELDS) {
    const values = normalizeStringArray(worker[field] || worker[toSnake(field)]).slice(0, 40);
    normalized[field] = values;
  }
  if (Number.isFinite(Number(worker.maxConcurrentTasks || worker.max_concurrent_tasks))) {
    normalized.maxConcurrentTasks = clampInt(worker.maxConcurrentTasks || worker.max_concurrent_tasks, 1, 99, 1);
  }
  if (typeof worker.acceptsBroadcast === "boolean" || typeof worker.accepts_broadcast === "boolean") {
    normalized.acceptsBroadcast = worker.acceptsBroadcast === true || worker.accepts_broadcast === true;
  }
  if (typeof worker.reviewRequired === "boolean" || typeof worker.review_required === "boolean") {
    normalized.reviewRequired = worker.reviewRequired === true || worker.review_required === true;
  }
  if (clean(worker.agentId || worker.agent_id)) normalized.agentId = clean(worker.agentId || worker.agent_id);
  if (clean(worker.sessionPath || worker.session_path)) normalized.sessionPath = clean(worker.sessionPath || worker.session_path);
  if (clean(worker.cwd)) normalized.cwd = clean(worker.cwd);
  return normalized;
}

function parseSimpleYaml(text) {
  const result = {};
  const lines = String(text || "").replace(/\t/g, "  ").split(/\r?\n/);
  let currentArrayKey = "";
  let currentObjectKey = "";
  let currentObject = null;
  let currentObjectArrayKey = "";
  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, "");
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    const trimmed = line.trim();
    if (currentArrayKey && indent === 0 && trimmed.startsWith("- ")) {
      const rest = trimmed.slice(2).trim();
      if (!rest) {
        currentObject = {};
        result[currentArrayKey].push(currentObject);
        currentObjectArrayKey = "";
      } else if (rest.includes(":")) {
        currentObject = {};
        result[currentArrayKey].push(currentObject);
        const [key, value] = splitYamlKeyValue(rest);
        if (value === "") {
          currentObject[key] = [];
          currentObjectArrayKey = key;
        } else {
          currentObject[key] = parseYamlScalar(value);
          currentObjectArrayKey = "";
        }
      } else {
        result[currentArrayKey].push(parseYamlScalar(rest));
        currentObject = null;
        currentObjectArrayKey = "";
      }
      continue;
    }
    if (indent === 0) {
      currentObject = null;
      currentObjectArrayKey = "";
      currentObjectKey = "";
      if (trimmed.endsWith(":")) {
        const key = trimmed.slice(0, -1).trim();
        if (key === "workers") {
          currentArrayKey = key;
          result[currentArrayKey] = [];
        } else {
          currentObjectKey = key;
          result[currentObjectKey] = {};
          currentArrayKey = "";
        }
      } else {
        const [key, rest] = splitYamlKeyValue(trimmed);
        result[key] = parseYamlScalar(rest);
        currentArrayKey = "";
      }
      continue;
    }
    if (currentObjectKey && indent >= 2) {
      const [key, value] = splitYamlKeyValue(trimmed);
      if (key) result[currentObjectKey][key] = parseYamlScalar(value);
      continue;
    }
    if (currentObject && indent >= 2) {
      if (trimmed.startsWith("- ") && currentObjectArrayKey) {
        currentObject[currentObjectArrayKey].push(parseYamlScalar(trimmed.slice(2).trim()));
        continue;
      }
      const [key, value] = splitYamlKeyValue(trimmed);
      if (!key) continue;
      if (value === "") {
        currentObject[key] = [];
        currentObjectArrayKey = key;
      } else {
        currentObject[key] = parseYamlScalar(value);
        currentObjectArrayKey = "";
      }
    }
  }
  return result;
}

function stringifySimpleYaml(value) {
  const lines = [];
  for (const [key, item] of Object.entries(value || {})) {
    if (Array.isArray(item)) {
      lines.push(`${key}:`);
      for (const entry of item) {
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          const entries = Object.entries(entry).filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && !(Array.isArray(entryValue) && entryValue.length === 0) && entryValue !== "");
          if (!entries.length) {
            lines.push("- {}");
            continue;
          }
          const [firstKey, firstValue] = entries[0];
          if (Array.isArray(firstValue)) {
            lines.push(`- ${firstKey}:`);
            for (const child of firstValue) lines.push(`  - ${formatYamlScalar(child)}`);
          } else {
            lines.push(`- ${firstKey}: ${formatYamlScalar(firstValue)}`);
          }
          for (const [childKey, childValue] of entries.slice(1)) {
            if (Array.isArray(childValue)) {
              lines.push(`  ${childKey}:`);
              for (const child of childValue) lines.push(`  - ${formatYamlScalar(child)}`);
            } else {
              lines.push(`  ${childKey}: ${formatYamlScalar(childValue)}`);
            }
          }
        } else {
          lines.push(`- ${formatYamlScalar(entry)}`);
        }
      }
    } else if (item && typeof item === "object") {
      lines.push(`${key}:`);
      for (const [childKey, childValue] of Object.entries(item)) {
        lines.push(`  ${childKey}: ${formatYamlScalar(childValue)}`);
      }
    } else {
      lines.push(`${key}: ${formatYamlScalar(item)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function splitYamlKeyValue(line) {
  const index = line.indexOf(":");
  if (index === -1) return [line.trim(), ""];
  return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
}

function parseYamlScalar(value) {
  const raw = clean(value);
  if (raw === "[]") return [];
  if (raw === "{}") return {};
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null" || raw === "~") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) return raw.slice(1, -1);
  return raw;
}

function formatYamlScalar(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const raw = String(value);
  if (!raw || /[:#\n\r]|^\s|\s$/.test(raw)) return JSON.stringify(raw);
  return raw;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    if (typeof value === "string" && value.trim()) return value.split(",").map(clean).filter(Boolean);
    return [];
  }
  return value.map((item) => clean(item)).filter(Boolean);
}

function unique(values) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function toSnake(value) {
  return clean(value).replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}

function readProfileFile(dataDir) {
  ensureProfileFile(dataDir);
  try {
    const raw = fs.readFileSync(profileFilePath(dataDir), "utf8").trim();
    if (!raw) return { profiles: [] };
    const parsed = JSON.parse(raw);
    return { profiles: Array.isArray(parsed?.profiles) ? parsed.profiles : [] };
  } catch {
    return { profiles: [] };
  }
}

function writeProfileFile(dataDir, data) {
  ensureProfileFile(dataDir);
  const file = profileFilePath(dataDir);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ profiles: data.profiles || [] }, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

function ensureProfileFile(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = profileFilePath(dataDir);
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ profiles: [] }, null, 2) + "\n", "utf8");
}

function profileFilePath(dataDir) {
  return path.join(dataDir, "operation-profiles.json");
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeFilename(value) {
  return (clean(value) || "operation-profile").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "operation-profile";
}
