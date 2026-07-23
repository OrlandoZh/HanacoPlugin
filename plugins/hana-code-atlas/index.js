import fs from "node:fs";

export default class HanaCodeAtlasPlugin {
  async onload() {
    fs.mkdirSync(this.ctx.dataDir, { recursive: true });
    // Expose cancelAllTasks for onunload
    this._cancelAllTasks = null;
    this._cancelAllArchitectureTasks = null;
    try {
      const { cancelAllTasks } = await import("./lib/build-manager.js");
      this._cancelAllTasks = cancelAllTasks;
    } catch { /* build-manager may not load in test */ }
    try {
      const { cancelAllArchitectureTasks } = await import("./lib/architecture-generator-v2.js");
      this._cancelAllArchitectureTasks = cancelAllArchitectureTasks;
    } catch { /* architecture generator may not load in test */ }
    this.ctx.log.info("hana-code-atlas plugin loaded");
  }

  async onunload() {
    // Cancel all running build tasks on plugin unload
    if (this._cancelAllTasks) {
      try {
        this._cancelAllTasks();
        this.ctx.log.info("hana-code-atlas: all running tasks cancelled on unload");
      } catch (err) {
        this.ctx.log.error("hana-code-atlas: error cancelling tasks on unload: " + err.message);
      }
    }
    if (this._cancelAllArchitectureTasks) {
      try {
        this._cancelAllArchitectureTasks();
        this.ctx.log.info("hana-code-atlas: all architecture generation tasks cancelled on unload");
      } catch (err) {
        this.ctx.log.error("hana-code-atlas: error cancelling architecture tasks on unload: " + err.message);
      }
    }
  }
}
