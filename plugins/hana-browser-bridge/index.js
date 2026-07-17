import { getBridgeStatus, shutdownMcpRuntime } from "./lib/mcp-client.js";

const HANA_BUS_SKIP = Symbol.for("hana.event-bus.skip");

export default class BrowserBridgePlugin {
  async onload() {
    const ctx = this.ctx;
    if (ctx.bus?.handle) {
      this.register(ctx.bus.handle("hana-browser-bridge:status", async (payload) => {
        if (payload?.pluginId && payload.pluginId !== ctx.pluginId) return HANA_BUS_SKIP;
        return await getBridgeStatus(ctx);
      }));
    }
    ctx.log.info("Browser Bridge for HanaAgent loaded; MCP starts lazily on first tool call");
  }

  async onunload() {
    await shutdownMcpRuntime({ stopChrome: true });
    this.ctx.log.info("Browser Bridge for HanaAgent unloaded");
  }
}
