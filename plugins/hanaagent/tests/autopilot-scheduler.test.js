import assert from "node:assert/strict";
import test from "node:test";
import {
  createAutopilotScheduler,
  getAutopilotScheduleConfig,
  setAutopilotScheduleConfig
} from "../lib/autopilot-scheduler.js";

function makeCtx() {
  const values = {};
  return {
    config: {
      getAll() {
        return values;
      },
      setMany(next) {
        Object.assign(values, next);
      }
    },
    log: {
      warn() {}
    }
  };
}

test("autopilot schedule config normalizes and persists settings", () => {
  const ctx = makeCtx();
  assert.equal(getAutopilotScheduleConfig(ctx).enabled, false);
  const saved = setAutopilotScheduleConfig(ctx, {
    enabled: true,
    mode: "run",
    intervalMinutes: 0,
    maxMissionsPerTick: 99,
    runOnStartup: true
  });
  assert.equal(saved.enabled, true);
  assert.equal(saved.mode, "run");
  assert.equal(saved.intervalMinutes, 1);
  assert.equal(saved.maxMissionsPerTick, 20);
  assert.equal(getAutopilotScheduleConfig(ctx).runOnStartup, true);
});

test("autopilot scheduler runs manual ticks and skips disabled interval ticks", async () => {
  const ctx = makeCtx();
  let count = 0;
  const scheduler = createAutopilotScheduler(ctx, {
    tick: async ({ reason, config }) => {
      count += 1;
      return { ok: true, reason, mode: config.mode, scanned: 1 };
    }
  });

  const skipped = await scheduler.runTick("interval");
  assert.equal(skipped.skipped, true);
  assert.equal(count, 0);

  const manual = await scheduler.runTick("manual");
  assert.equal(manual.ok, true);
  assert.equal(manual.reason, "manual");
  assert.equal(count, 1);
});

test("autopilot scheduler start and stop expose status", () => {
  const ctx = makeCtx();
  setAutopilotScheduleConfig(ctx, { enabled: true, intervalMinutes: 1 });
  const scheduler = createAutopilotScheduler(ctx, { tick: async () => ({ ok: true }), minIntervalMs: 60_000 });
  const started = scheduler.start();
  assert.equal(started.started, true);
  assert.equal(scheduler.status().active, true);
  scheduler.stop();
  assert.equal(scheduler.status().active, false);
});
