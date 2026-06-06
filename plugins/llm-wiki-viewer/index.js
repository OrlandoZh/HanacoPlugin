import fs from "node:fs";

export default class LlmWikiViewerPlugin {
  async onload() {
    fs.mkdirSync(this.ctx.dataDir, { recursive: true });
    this.ctx.log.info("llm-wiki-viewer plugin loaded");
  }
}
