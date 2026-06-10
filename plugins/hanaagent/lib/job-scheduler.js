import {
  listJobs,
  recordJobRun
} from "./job-store.js";

export function createJobScheduler(ctx, input = {}) {
  const trigger = typeof input.trigger === "function" ? input.trigger : null;
  const intervalMs = clampInt(input.intervalMs, 1000, 60 * 60 * 1000, 60 * 1000);
  const runOnStartup = input.runOnStartup !== false;
  let timer = null;
  let running = false;
  let lastResult = null;

  async function runDueJobs(reason = "manual", options = {}) {
    if (!trigger) return { ok: false, error: "trigger_unavailable" };
    if (running) return { ok: true, skipped: true, reason: "already_running", lastResult };
    running = true;
    try {
      const now = options.now ? new Date(options.now) : new Date();
      const jobs = listJobs(ctx.dataDir).filter((job) => isDueJob(job, now));
      const runs = [];
      const errors = [];
      for (const job of jobs) {
        try {
          const result = await trigger(job.id, {
            reason: `scheduler:${reason}`,
            mode: job.mode,
            scheduled: true
          });
          runs.push({
            jobId: job.id,
            ok: result?.ok !== false,
            runId: result?.run?.id || "",
            summary: result?.run?.summary || result?.result?.summary || ""
          });
        } catch (error) {
          errors.push({ jobId: job.id, error: error?.message || String(error) });
          recordJobRun(ctx.dataDir, job.id, {
            status: "failed",
            summary: error?.message || "scheduled job failed",
            output: error?.stack || error?.message || String(error),
            error: error?.message || String(error)
          });
        }
      }
      lastResult = {
        ok: errors.length === 0,
        reason,
        scanned: jobs.length,
        runs,
        errors,
        generatedAt: new Date().toISOString()
      };
      return lastResult;
    } finally {
      running = false;
    }
  }

  function start() {
    stop();
    timer = setInterval(() => {
      runDueJobs("interval").catch((error) => {
        ctx?.log?.warn?.(`job scheduler tick failed: ${error?.message || error}`);
      });
    }, intervalMs);
    if (runOnStartup) {
      setTimeout(() => {
        runDueJobs("startup").catch((error) => {
          ctx?.log?.warn?.(`job scheduler startup failed: ${error?.message || error}`);
        });
      }, 100);
    }
    return { ok: true, started: true, intervalMs };
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    return { ok: true, stopped: true };
  }

  function status() {
    return {
      ok: true,
      active: Boolean(timer),
      running,
      intervalMs,
      lastResult
    };
  }

  return { start, stop, status, runDueJobs };
}

export function isDueJob(job, now = new Date()) {
  if (!job || job.status !== "enabled") return false;
  const schedule = job.schedule || {};
  if (schedule.type === "manual" || schedule.expression === "manual") return false;
  const next = Date.parse(job.nextRunAt || "");
  if (Number.isFinite(next)) return next <= now.getTime();
  const last = Date.parse(job.lastRunAt || job.updatedAt || job.createdAt || "");
  if (!Number.isFinite(last)) return true;
  const everyMinutes = parseEveryMinutes(schedule.expression);
  if (!everyMinutes) return false;
  return last + everyMinutes * 60 * 1000 <= now.getTime();
}

function parseEveryMinutes(expression) {
  const value = clean(expression);
  const every = value.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (every) return Math.max(1, Math.min(1440, Number(every[1]) || 0));
  if (value === "hourly" || value === "0 * * * *") return 60;
  if (value === "daily" || value === "0 0 * * *") return 1440;
  return 0;
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
