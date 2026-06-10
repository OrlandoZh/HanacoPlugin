export function getAutopilotScheduleConfig(ctx) {
  const config = safeConfig(ctx);
  return normalizeSchedule(config.autopilotSchedule);
}

export function setAutopilotScheduleConfig(ctx, input = {}) {
  const current = getAutopilotScheduleConfig(ctx);
  const next = normalizeSchedule({ ...current, ...input });
  if (typeof ctx?.config?.setMany === "function") {
    ctx.config.setMany({ autopilotSchedule: next });
  }
  return next;
}

export function createAutopilotScheduler(ctx, input = {}) {
  const tick = typeof input.tick === "function" ? input.tick : null;
  const minIntervalMs = Number(input.minIntervalMs) || 5000;
  let timer = null;
  let running = false;
  let lastResult = null;

  async function runTick(reason = "manual") {
    const config = getAutopilotScheduleConfig(ctx);
    if (!tick) return { ok: false, error: "tick_unavailable", config };
    if (!config.enabled && reason !== "manual" && reason !== "startup") return { ok: true, skipped: true, reason: "disabled", config };
    if (running) return { ok: true, skipped: true, reason: "already_running", config };
    running = true;
    try {
      lastResult = await tick({ reason, config });
      return lastResult;
    } finally {
      running = false;
    }
  }

  function start() {
    stop();
    const config = getAutopilotScheduleConfig(ctx);
    if (!config.enabled) return { ok: true, started: false, config };
    const intervalMs = Math.max(minIntervalMs, config.intervalMinutes * 60 * 1000);
    timer = setInterval(() => {
      runTick("interval").catch((error) => {
        ctx?.log?.warn?.(`autopilot scheduler tick failed: ${error?.message || error}`);
      });
    }, intervalMs);
    if (config.runOnStartup) {
      setTimeout(() => {
        runTick("startup").catch((error) => {
          ctx?.log?.warn?.(`autopilot startup tick failed: ${error?.message || error}`);
        });
      }, 50);
    }
    return { ok: true, started: true, intervalMs, config };
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    return { ok: true, stopped: true };
  }

  function status() {
    return {
      ok: true,
      running,
      active: Boolean(timer),
      config: getAutopilotScheduleConfig(ctx),
      lastResult
    };
  }

  return { start, stop, status, runTick };
}

function normalizeSchedule(input = {}) {
  return {
    enabled: input.enabled === true,
    mode: input.mode === "run" ? "run" : "preview",
    intervalMinutes: clampInt(input.intervalMinutes, 1, 1440, 15),
    runOnStartup: input.runOnStartup === true,
    maxMissionsPerTick: clampInt(input.maxMissionsPerTick, 1, 20, 5)
  };
}

function safeConfig(ctx) {
  try {
    return typeof ctx?.config?.getAll === "function" ? ctx.config.getAll() || {} : {};
  } catch {
    return {};
  }
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}
