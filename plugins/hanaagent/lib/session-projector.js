import { listMissions } from "./mission-store.js";

const PROJECTABLE_EVENT_TYPES = new Set(["turn_end", "done", "error"]);
const ACTIVE_MISSION_STATES = new Set(["active", "blocked", "planning", "paused"]);
const TERMINAL_ASSIGNMENT_STATES = new Set(["done", "cancelled"]);

export function createSessionProjector(ctx, input = {}) {
  const sync = typeof input.sync === "function" ? input.sync : null;
  const debounceMs = clampInt(input.debounceMs, 0, 60_000, 250);
  const recoveryDelayMs = clampInt(input.recoveryDelayMs, 0, 60_000, 1_000);
  const runRecoveryOnStart = input.runRecoveryOnStart !== false;
  const timers = new Map();
  const running = new Set();
  const dirty = new Set();
  const missionChains = new Map();
  let unsubscribe = null;
  let recoveryTimer = null;
  let lastResult = null;
  let startedAt = null;

  function start() {
    stop();
    if (!sync) return { ok: false, started: false, error: "session_projector_sync_unavailable" };
    if (typeof ctx?.bus?.subscribe !== "function") {
      return { ok: false, started: false, error: "hana_bus_subscribe_unavailable" };
    }

    unsubscribe = ctx.bus.subscribe((event, eventSessionPath) => {
      const type = clean(event?.type);
      if (!PROJECTABLE_EVENT_TYPES.has(type)) return;
      const sessionPath = clean(eventSessionPath || event?.sessionPath);
      if (!sessionPath) return;
      schedule(sessionPath, type);
    }, { types: [...PROJECTABLE_EVENT_TYPES] });
    startedAt = new Date().toISOString();

    if (runRecoveryOnStart) {
      recoveryTimer = setTimeout(() => {
        recover("startup").catch((error) => {
          ctx?.log?.warn?.(`session projector recovery failed: ${error?.message || error}`);
        });
      }, recoveryDelayMs);
      recoveryTimer.unref?.();
    }

    return { ok: true, started: true, startedAt };
  }

  function stop() {
    if (typeof unsubscribe === "function") unsubscribe();
    unsubscribe = null;
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = null;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    dirty.clear();
    missionChains.clear();
    return { ok: true, stopped: true };
  }

  function schedule(sessionPath, reason = "event") {
    const path = clean(sessionPath);
    if (!path) return { ok: false, scheduled: false, error: "sessionPath_required" };
    if (running.has(path)) {
      dirty.add(path);
      return { ok: true, scheduled: true, deferred: true, sessionPath: path, reason };
    }
    const current = timers.get(path);
    if (current) clearTimeout(current);
    const timer = setTimeout(() => {
      timers.delete(path);
      runProjection(path, reason).catch((error) => {
        ctx?.log?.warn?.(`session projector failed for ${path}: ${error?.message || error}`);
      });
    }, debounceMs);
    timer.unref?.();
    timers.set(path, timer);
    return { ok: true, scheduled: true, sessionPath: path, reason };
  }

  async function runProjection(sessionPath, reason = "manual") {
    const path = clean(sessionPath);
    if (!path) return { ok: false, error: "sessionPath_required", results: [] };
    if (running.has(path)) {
      dirty.add(path);
      return { ok: true, skipped: true, reason: "already_running", sessionPath: path, results: [] };
    }

    running.add(path);
    try {
      const targetSnapshot = findProjectionTargets(ctx?.dataDir, { sessionPath: path });
      const results = [];
      for (const target of targetSnapshot.targets) {
        results.push(await enqueueMissionProjection(target.missionId, async () => {
          try {
            return await sync({
              sessionPath: path,
              missionId: target.missionId,
              assignmentId: target.assignmentId,
              taskId: target.taskId,
              agentId: target.agentId,
              applyToTask: true,
              limit: 80,
              source: "session-projector",
              reason
            });
          } catch (error) {
            return {
              ok: false,
              error: error?.message || "session_projection_failed",
              missionId: target.missionId,
              assignmentId: target.assignmentId,
              sessionPath: path
            };
          }
        }));
      }
      lastResult = {
        ok: results.every((result) => result?.ok !== false),
        sessionPath: path,
        reason,
        projected: results.length,
        skippedShared: targetSnapshot.skippedShared,
        results,
        projectedAt: new Date().toISOString()
      };
      return lastResult;
    } finally {
      running.delete(path);
      if (dirty.delete(path)) schedule(path, "coalesced-event");
    }
  }

  async function recover(reason = "manual") {
    const snapshot = findProjectionTargets(ctx?.dataDir);
    const sessionPaths = [...new Set(snapshot.targets.map((target) => target.sessionPath))];
    const results = [];
    for (const sessionPath of sessionPaths) {
      results.push(await runProjection(sessionPath, reason));
    }
    lastResult = {
      ok: results.every((result) => result?.ok !== false),
      reason,
      recoveredSessions: sessionPaths.length,
      skippedShared: snapshot.skippedShared,
      results,
      projectedAt: new Date().toISOString()
    };
    return lastResult;
  }

  function status() {
    return {
      ok: true,
      active: typeof unsubscribe === "function",
      startedAt,
      pending: timers.size,
      running: running.size,
      missionQueues: missionChains.size,
      lastResult
    };
  }

  function enqueueMissionProjection(missionId, work) {
    const id = clean(missionId) || "unknown-mission";
    const previous = missionChains.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    const tracked = next.finally(() => {
      if (missionChains.get(id) === tracked) missionChains.delete(id);
    });
    missionChains.set(id, tracked);
    return tracked;
  }

  return { start, stop, status, schedule, project: runProjection, recover };
}

export function findProjectionTargets(dataDir, filters = {}) {
  if (!dataDir) return { targets: [], skippedShared: 0 };
  const sessionPath = clean(filters.sessionPath);
  const targets = [];
  let skippedShared = 0;
  for (const mission of listMissions(dataDir, { includeArchived: false })) {
    if (!ACTIVE_MISSION_STATES.has(mission.state)) continue;
    for (const assignment of Array.isArray(mission.assignments) ? mission.assignments : []) {
      if (TERMINAL_ASSIGNMENT_STATES.has(assignment.state)) continue;
      if (!assignment.sessionPath) continue;
      if (sessionPath && assignment.sessionPath !== sessionPath) continue;
      if (assignment.sessionBindingKind !== "dedicated") {
        skippedShared += 1;
        continue;
      }
      targets.push({
        missionId: mission.id,
        assignmentId: assignment.id,
        taskId: assignment.taskId || "",
        agentId: assignment.agentId || mission.agentId || "",
        sessionPath: assignment.sessionPath,
        sessionBindingKind: assignment.sessionBindingKind,
        sessionBoundAt: assignment.sessionBoundAt || assignment.updatedAt || assignment.createdAt
      });
    }
  }
  return { targets, skippedShared };
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
