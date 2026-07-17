import { getBridgeStatus, restartBridgeRuntime, shutdownMcpRuntime, startBridgeRuntime } from "../lib/mcp-client.js";

export default function registerBrowserBridgeRoutes(app, ctx) {
  app.get("/page", (c) => c.html(renderShell(c, ctx)));
  app.get("/api/status", async (c) => c.json(await getBridgeStatus(ctx)));
  app.post("/api/start", async (c) => c.json(await startBridgeRuntime(ctx)));
  app.post("/api/restart", async (c) => c.json(await restartBridgeRuntime(ctx)));
  app.post("/api/stop", async (c) => c.json(await shutdownMcpRuntime({ stopChrome: true })));
}

function renderShell(c, ctx) {
  const hanaCss = c.req.query("hana-css") || "";
  const theme = c.req.query("hana-theme") || "inherit";
  const assetBase = `/api/plugins/${encodeURIComponent(ctx.pluginId)}/assets`;
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Browser Bridge</title>
${hanaCss ? `<link rel="stylesheet" href="${escapeAttr(hanaCss)}">` : ""}
<link rel="stylesheet" href="${assetBase}/panel.css"></head>
<body data-hana-theme="${escapeAttr(theme)}"><div id="root"></div>
<script type="module" src="${assetBase}/panel.js"></script></body></html>`;
}

function escapeAttr(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
