import fs from "node:fs";
import { createAutopilotScheduler } from "./lib/autopilot-scheduler.js";
import { createJobScheduler } from "./lib/job-scheduler.js";
import * as workbenchRoutes from "./routes/workbench.js";
import { createSessionProjector } from "./lib/session-projector.js";

export default class HanaAgentPlugin {
  async onload() {
    fs.mkdirSync(this.ctx.dataDir, { recursive: true });
    this.migrateWorkbenchThemeSettings();
    const scheduler = createAutopilotScheduler(this.ctx, {
      tick: (input) => workbenchRoutes.runAutopilotTick(this.ctx, input)
    });
    this.ctx._hanaagentAutopilot = scheduler;
    scheduler.start();
    const jobScheduler = createJobScheduler(this.ctx, {
      trigger: (jobId, input) => workbenchRoutes.triggerJob(this.ctx, jobId, input)
    });
    this.ctx._hanaagentJobs = jobScheduler;
    jobScheduler.start();
    const sessionProjector = createSessionProjector(this.ctx, {
      sync: (input) => {
        if (typeof workbenchRoutes.syncHistoryCheckpoints !== "function") {
          return { ok: false, error: "sync_history_checkpoints_unavailable" };
        }
        return workbenchRoutes.syncHistoryCheckpoints(this.ctx, input);
      }
    });
    this.ctx._hanaagentSessionProjector = sessionProjector;
    const projectorResult = sessionProjector.start();
    if (!projectorResult.ok) {
      this.ctx.log.warn(`session projector unavailable: ${projectorResult.error || "unknown_error"}`);
    }
    this.register(() => {
      scheduler.stop();
      jobScheduler.stop();
      sessionProjector.stop();
      delete this.ctx._hanaagentAutopilot;
      delete this.ctx._hanaagentJobs;
      delete this.ctx._hanaagentSessionProjector;
    });
    this.ctx.log.info("hanaagent workbench plugin loaded");
  }

  migrateWorkbenchThemeSettings() {
    const config = this.ctx.config?.getAll?.() || {};
    const settings = config.workbenchSettings;
    if (!settings || settings.themePreset !== "hermes" || settings.starmapDefaultApplied === true) return;
    this.ctx.config?.setMany?.({
      workbenchSettings: {
        ...settings,
        themePreset: "starmap",
        theme: "light",
        accentColor: "green",
        starmapDefaultApplied: true
      }
    });
    this.ctx.log?.info?.("hanaagent migrated legacy Hermes theme to Starmap theme");
  }
}
