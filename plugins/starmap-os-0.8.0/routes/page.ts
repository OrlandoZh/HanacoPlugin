export default function registerStarmapPage(app, ctx) {
  app.get("/page", async (c) => {
    const configured = await ctx.config?.get?.("starmapServerUrl");
    const parsed = new URL(typeof configured === "string" && configured.trim()
      ? configured.trim() : "http://127.0.0.1:8790");
    if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname)) {
      return c.html("<h2>星图服务地址必须是本机 HTTP 地址</h2>", 500);
    }
    const starmapUrl = parsed.toString().replace(/\/$/, "") + "/";
    const starmapOrigin = parsed.origin;
    return c.html(`
      <!doctype html>
      <meta charset="utf-8">
      <title>星图</title>
      <style>
        body { margin: 0; height: 100vh; overflow: hidden; }
        iframe { width: 100%; height: 100%; border: none; }
      </style>
      <iframe src=${JSON.stringify(starmapUrl)} id="starmap-frame"></iframe>
      <script>
        // 监听星图画布的插件能力请求。iframe 本身只负责界面，真正的
        // Hanako 会话读取与模型调用仍在经过授权的插件路由中执行。
        window.addEventListener("message", async (event) => {
          if (event.source !== document.getElementById("starmap-frame")?.contentWindow) return;
          if (event.data?.type === "starmap:plugin_sync") {
            const requestId = event.data.requestId;
            try {
              const syncUrl = new URL("./sync", window.location.href);
              // Hanako 将插件页授权凭证放在查询参数中；相对 fetch 不会自动
              // 继承当前查询串，必须显式透传，否则路由返回 missing_credential。
              syncUrl.search = window.location.search;
              const response = await fetch(syncUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(event.data.payload || {}),
              });
              const result = await response.json();
              event.source.postMessage({ type: "starmap:plugin_sync_result", requestId, result }, ${JSON.stringify(starmapOrigin)});
            } catch (error) {
              event.source.postMessage({ type: "starmap:plugin_sync_result", requestId,
                result: { ok: false, error: String(error?.message || error) } }, ${JSON.stringify(starmapOrigin)});
            }
            return;
          }
        });
      </script>
    `);
  });
}
