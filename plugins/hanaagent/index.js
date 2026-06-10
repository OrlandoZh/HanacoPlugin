import fs from "node:fs";
import { createAutopilotScheduler } from "./lib/autopilot-scheduler.js";
import { createJobScheduler } from "./lib/job-scheduler.js";
import { runAutopilotTick, triggerJob } from "./routes/workbench.js";

export default class HanaAgentPlugin {
  async onload() {
    fs.mkdirSync(this.ctx.dataDir, { recursive: true });
    const scheduler = createAutopilotScheduler(this.ctx, {
      tick: (input) => runAutopilotTick(this.ctx, input)
    });
    this.ctx._hanaagentAutopilot = scheduler;
    scheduler.start();
    const jobScheduler = createJobScheduler(this.ctx, {
      trigger: (jobId, input) => triggerJob(this.ctx, jobId, input)
    });
    this.ctx._hanaagentJobs = jobScheduler;
    jobScheduler.start();
    this.register(() => {
      scheduler.stop();
      jobScheduler.stop();
      delete this.ctx._hanaagentAutopilot;
      delete this.ctx._hanaagentJobs;
    });
    this.ctx.log.info("hanaagent workbench plugin loaded");
  }
}
