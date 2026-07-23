/**
 * lib/build-manager.js — Build state machine and process lifecycle
 *
 * States: running → validating → promoting → completed
 *                            → failed
 *                            → cancelling → cancelled
 *
 * Key design:
 *   - spawn detached:true on POSIX for proper process group
 *   - Manual pipeline timeout: mark _timedOut, keep state active, kill tree;
 *     close handler decides failed (timeout) vs cancelled (user)
 *   - cancel only allowed on running/cancelling (has live child process)
 *   - validating/promoting: no child → task_not_cancellable
 *   - killProcessTree grace cancel must be called on close/error
 *   - task.pid/task.proc cleared on close
 *   - Input clamping: bounded ints for timeouts and concurrency
 *   - cancelTask idempotent: kill tree created once; second call is a no-op
 */

import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { promoteBuild } from "./storage.js";
import { resolveProject, projectOverlayPath, projectDir, isValidProjectId } from "./projects.js";

// ─── Constants ────────────────────────────────────────────

const TERMINAL_STATES = new Set(["completed", "failed", "cancelled"]);
/** States with a live child process that can be killed */
const KILLABLE_STATES = new Set(["running", "cancelling"]);
/** States that block a new build for this project */
const ACTIVE_STATES = new Set(["running", "validating", "promoting", "cancelling"]);
const SIGKILL_GRACE_MS = 5000;
const MAX_LOG_TAIL = 200;

// Bounded config limits
const PIPELINE_TIMEOUT_MIN = 30;
const PIPELINE_TIMEOUT_MAX = 3600;
const CBM_TIMEOUT_MIN = 5;
const CBM_TIMEOUT_MAX = 900;
const MAX_CONCURRENT_MIN = 1;
const MAX_CONCURRENT_MAX = 4;

// ─── Input clamping ──────────────────────────────────────

/**
 * Clamp a value to [min, max]. If val is not a finite number,
 * fallback is used but ALSO clamped to [min, max].
 */
function clampInt(val, min, max, fallback) {
  const n = Number(val);
  const safe = Number.isFinite(n) ? n : Number(fallback);
  return Math.min(max, Math.max(min, Math.floor(safe)));
}

export function clampPipelineTimeout(v) { return clampInt(v, PIPELINE_TIMEOUT_MIN, PIPELINE_TIMEOUT_MAX, 300); }
export function clampCbmTimeout(v, pipelineTs) {
  const cap = Math.min(CBM_TIMEOUT_MAX, pipelineTs);
  return clampInt(v, CBM_TIMEOUT_MIN, cap, 120);
}
export function clampMaxConcurrent(v) { return clampInt(v, MAX_CONCURRENT_MIN, MAX_CONCURRENT_MAX, 1); }

// ─── CBM env builder (testable pure helper) ────────────────

/**
 * Build the environment object for cbm CLI and Python pipeline calls.
 * Merges process.env, CBM_TIMEOUT_SECONDS, and optional CBM_CACHE_DIR.
 * Does not leak the cache dir path in logs — callers only record a boolean.
 */
export function buildCbmEnv(cbmTimeoutSeconds, cbmCacheDir) {
  const env = { ...process.env, CBM_TIMEOUT_SECONDS: String(cbmTimeoutSeconds) };
  if (cbmCacheDir) env.CBM_CACHE_DIR = cbmCacheDir;
  return env;
}

// ─── Kill process tree helper ─────────────────────────────

/**
 * Kill a process tree: SIGTERM the group, schedule SIGKILL after grace.
 * Returns a cancel function — MUST be called on close/error to prevent
 * sending SIGKILL to a reused PID/PGID after the process has exited.
 */
export function killProcessTree(pid, graceMs = SIGKILL_GRACE_MS) {
  if (!pid) return () => {};
  const isPosix = process.platform !== "win32";

  if (isPosix) {
    try { process.kill(-pid, "SIGTERM"); } catch { /* already exited */ }
  } else {
    try { process.kill(pid, "SIGTERM"); } catch { /* already dead */ }
  }

  const timer = setTimeout(() => {
    if (isPosix) {
      try { process.kill(-pid, "SIGKILL"); } catch { /* already dead */ }
    } else {
      try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
    }
  }, graceMs);

  // Caller MUST invoke this on close/error to prevent stale SIGKILL
  return () => clearTimeout(timer);
}

// ─── Task registry ────────────────────────────────────────

const tasks = new Map();
let globalRunningCount = 0;

export function getTask(taskId) { return tasks.get(taskId) || null; }

export function getActiveTaskForProject(projectId) {
  for (const [taskId, task] of tasks) {
    if (task.projectId === projectId && ACTIVE_STATES.has(task.status)) {
      return { taskId, status: task.status };
    }
  }
  return null;
}

export function listTasks() {
  return [...tasks.entries()].map(([id, t]) => ({
    taskId: id, status: t.status, projectId: t.projectId,
    startedAt: t.startedAt, error: t.error || null,
  }));
}

// ─── Build ID generation ──────────────────────────────────

function generateBuildId() {
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return ts + "-" + crypto.randomBytes(4).toString("hex");
}

// ─── Log redaction ────────────────────────────────────────

export function redactLogs(logLines, rootPath) {
  if (!rootPath) return logLines;
  return logLines.map((line) => String(line).replaceAll(rootPath, "<project-root>"));
}

// ─── Terminal-idempotent state transitions ────────────────

function transitionTask(task, newState, error) {
  if (TERMINAL_STATES.has(task.status)) return;
  task.status = newState;
  if (error) task.error = error;
  if (TERMINAL_STATES.has(newState) && !task._countedDown) {
    task._countedDown = true;
    globalRunningCount = Math.max(0, globalRunningCount - 1);
  }
}

// ─── Cleanup helper: cancel grace timer + clear pid/proc ──

function cleanupTaskProcess(task) {
  if (task._killCancel) { task._killCancel(); task._killCancel = null; }
  if (task._pipelineTimer) { clearTimeout(task._pipelineTimer); task._pipelineTimer = null; }
  task.pid = null;
  task.proc = null;
}

function abortBeforeSpawn(task) {
  if (task.status === "cancelling") transitionTask(task, "cancelled");
  return TERMINAL_STATES.has(task.status);
}

// ─── Start build ──────────────────────────────────────────

export function startBuild(opts) {
  const pipelineTimeoutSeconds = clampPipelineTimeout(opts.pipelineTimeoutSeconds);
  const cbmTimeoutSeconds = clampCbmTimeout(opts.cbmTimeoutSeconds, pipelineTimeoutSeconds);
  const maxConcurrent = clampMaxConcurrent(opts.maxConcurrent);

  const {
    dataDir, projectId,
    pythonBinary = "python3", cbmBinary = "codebase-memory-mcp",
    pluginDir, cbmCacheDir,
  } = opts;

  if (!isValidProjectId(projectId)) return { ok: false, error: "invalid_projectId" };

  for (const [, t] of tasks) {
    if (t.projectId === projectId && ACTIVE_STATES.has(t.status)) {
      return { ok: false, error: "project_already_building", taskId: t.taskId };
    }
  }
  if (globalRunningCount >= maxConcurrent) {
    return { ok: false, error: "max_concurrent_reached" };
  }

  const taskId = crypto.randomUUID();
  const buildId = generateBuildId();
  const stagingPath = path.join(projectDir(dataDir, projectId), "staging", taskId);

  const task = {
    taskId, buildId, status: "running", projectId, dataDir, stagingPath,
    proc: null, pid: null,
    startedAt: new Date().toISOString(), logTail: [], error: null, rootPath: null,
    _countedDown: false, _pipelineTimer: null, _killCancel: null, _timedOut: false,
    _killIssued: false,
  };
  tasks.set(taskId, task);
  globalRunningCount++;

  (async () => {
    let projectMeta;
    try {
      projectMeta = await resolveProject(dataDir, projectId);
      if (!projectMeta) { transitionTask(task, "failed", "Project not found: " + projectId); return; }
    } catch (err) {
      transitionTask(task, "failed", "Project resolve error: " + err.message); return;
    }

    task.rootPath = projectMeta.root;
    if (abortBeforeSpawn(task)) return;

    const hanaAdapterPath = path.resolve(path.join(pluginDir, "pipeline", "hana_adapter.py"));
    const args = [
      hanaAdapterPath, "--project-root", projectMeta.root,
      "--output-root", stagingPath, "--cbm-binary", cbmBinary,
      "--materialize-source-preview",
    ];
    if (projectMeta.cbmProjectName) args.push("--cbm-project", projectMeta.cbmProjectName);

    try { await fsp.mkdir(stagingPath, { recursive: true }); }
    catch (err) { transitionTask(task, "failed", "Staging mkdir failed: " + err.message); return; }

    // Snapshot the adopted overlay into this task's staging directory. The
    // pipeline never reads the mutable project-level overlay after spawn.
    const overlayP = projectOverlayPath(dataDir, projectId);
    try {
      const overlayContent = await fsp.readFile(overlayP, "utf-8");
      JSON.parse(overlayContent);
      const snapshotPath = path.join(stagingPath, "overlay.input.json");
      await fsp.writeFile(snapshotPath, overlayContent, { encoding: "utf-8", mode: 0o600 });
      args.push("--overlay", snapshotPath);
    } catch (err) {
      if (err.code !== "ENOENT") {
        transitionTask(task, "failed", "Overlay snapshot failed: " + err.message);
        await fsp.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
        return;
      }
    }

    if (abortBeforeSpawn(task)) {
      await fsp.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
      return;
    }

    const env = buildCbmEnv(cbmTimeoutSeconds, cbmCacheDir);
    const isPosix = process.platform !== "win32";
    const proc = spawn(pythonBinary, args, {
      cwd: path.dirname(hanaAdapterPath), env, shell: false,
      stdio: ["ignore", "pipe", "pipe"], detached: isPosix,
    });

    task.proc = proc;
    task.pid = proc.pid;

    // Timeout: mark _timedOut, stay active (cancelling), kill tree once.
    task._pipelineTimer = setTimeout(() => {
      if (TERMINAL_STATES.has(task.status)) return;
      task._timedOut = true;
      task.error = "Pipeline timeout (" + pipelineTimeoutSeconds + "s)";
      if (task.status === "running") task.status = "cancelling";
      // Kill tree exactly once — _killIssued prevents double kill
      if (!task._killIssued) {
        task._killIssued = true;
        task._killCancel = killProcessTree(proc.pid);
      }
    }, pipelineTimeoutSeconds * 1000);

    const appendLog = (chunk) => {
      const lines = chunk.toString().split("\n").filter(Boolean);
      task.logTail.push(...lines);
      if (task.logTail.length > MAX_LOG_TAIL) task.logTail = task.logTail.slice(-MAX_LOG_TAIL);
    };
    if (proc.stdout) proc.stdout.on("data", appendLog);
    if (proc.stderr) proc.stderr.on("data", appendLog);

    proc.on("close", (code) => {
      cleanupTaskProcess(task);
      if (TERMINAL_STATES.has(task.status)) return;
      if (task._timedOut) {
        transitionTask(task, "failed", task.error || "Pipeline timeout");
        return;
      }
      if (task.status === "cancelling") {
        transitionTask(task, "cancelled");
        return;
      }
      if (code !== 0) {
        transitionTask(task, "failed", "Pipeline exited with code " + code);
        return;
      }
      validateAndPromote(task);
    });

    proc.on("error", (err) => {
      cleanupTaskProcess(task);
      if (TERMINAL_STATES.has(task.status)) return;
      if (task._timedOut) {
        transitionTask(task, "failed", task.error || "Pipeline error after timeout");
        return;
      }
      transitionTask(task, "failed", "Pipeline error: " + err.message);
    });

    if (isPosix) proc.unref();
  })();

  return { ok: true, taskId, buildId };
}

// ─── Validate and promote ─────────────────────────────────

async function validateAndPromote(task) {
  if (TERMINAL_STATES.has(task.status)) return;
  transitionTask(task, "validating");
  if (TERMINAL_STATES.has(task.status)) return;
  transitionTask(task, "promoting");
  if (TERMINAL_STATES.has(task.status)) return;
  try {
    const result = await promoteBuild(task.dataDir, task.projectId, task.buildId, task.stagingPath);
    if (!result.ok) { transitionTask(task, "failed", "Validation/promotion failed: " + result.error); return; }
    transitionTask(task, "completed");
  } catch (err) { transitionTask(task, "failed", "Promotion error: " + err.message); }
}

// ─── Cancel task ──────────────────────────────────────────

/**
 * Cancel a task. Idempotent — only kills the process tree once.
 * - running: transition to cancelling, kill tree once
 * - cancelling + no prior kill: kill tree once
 * - cancelling + kill already issued (_killIssued): idempotent return ok
 * - validating/promoting: task_not_cancellable
 * - timeout-driven cancelling (_timedOut): idempotent return ok, don't re-kill
 */
export function cancelTask(taskId) {
  const task = tasks.get(taskId);
  if (!task) return { ok: false, error: "task_not_found" };

  if (!KILLABLE_STATES.has(task.status)) return { ok: false, error: "task_not_cancellable" };

  // Timeout already issued a kill — idempotent, no second kill
  if (task._timedOut) return { ok: true };

  // Kill tree already issued (from a prior cancel) — idempotent
  if (task._killIssued) return { ok: true };

  // First cancel: transition state, issue kill
  if (task.status === "running") {
    task.status = "cancelling";
    // Still active — don't decrement count
  }

  // Clear pipeline timer (no need if timeout hasn't fired)
  if (task._pipelineTimer) { clearTimeout(task._pipelineTimer); task._pipelineTimer = null; }

  // Kill process tree exactly once
  task._killIssued = true;
  if (task.pid) {
    task._killCancel = killProcessTree(task.pid);
  } else if (task.proc) {
    try { task.proc.kill("SIGTERM"); } catch { /* */ }
  }

  return { ok: true };
}

// ─── Cancel all tasks (for onunload) ──────────────────────

export function cancelAllTasks() {
  for (const [, task] of tasks) {
    if (task.status === "running" || task.status === "cancelling") {
      if (!TERMINAL_STATES.has(task.status)) {
        task.status = "cancelled";
        if (!task._countedDown) {
          task._countedDown = true;
          globalRunningCount = Math.max(0, globalRunningCount - 1);
        }
      }
      if (task._pipelineTimer) clearTimeout(task._pipelineTimer);
      if (task.pid) {
        if (process.platform !== "win32") {
          try { process.kill(-task.pid, "SIGKILL"); } catch { /* */ }
        }
      } else if (task.proc) {
        try { task.proc.kill("SIGKILL"); } catch { /* */ }
      }
      cleanupTaskProcess(task);
    }
  }
}

// ─── Task detail ──────────────────────────────────────────

export function getTaskDetail(taskId) {
  const task = tasks.get(taskId);
  if (!task) return null;
  return {
    taskId: task.taskId, buildId: task.buildId, status: task.status,
    projectId: task.projectId, startedAt: task.startedAt,
    error: task.error || null, logTail: redactLogs(task.logTail || [], task.rootPath),
  };
}

// ─── Task pruning ─────────────────────────────────────────

const TASK_RETENTION_MS = 24 * 60 * 60 * 1000;

export function pruneTasks() {
  const now = Date.now();
  for (const [id, task] of tasks) {
    if (ACTIVE_STATES.has(task.status)) continue;
    if (now - new Date(task.startedAt).getTime() > TASK_RETENTION_MS) tasks.delete(id);
  }
}
