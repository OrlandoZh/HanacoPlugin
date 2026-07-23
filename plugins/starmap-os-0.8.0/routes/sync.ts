import { getSyncRuntime } from "../lib/conversation-sync.ts";

export default function registerStarmapSync(app, ctx) {
  app.post("/sync", async (c) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    const reqCtx = c.get("pluginRequestContext");
    if (!reqCtx?.bus?.request) {
      return c.json({ ok: false, error: "缺少经过授权的插件请求上下文" }, 403);
    }
    if (!(c.req.header("content-type") || "").toLowerCase().startsWith("application/json")) {
      return c.json({ ok: false, error: "请求必须使用 application/json" }, 415);
    }
    let body;
    try { body = await c.req.json(); }
    catch (_) { return c.json({ ok: false, error: "请求必须是 JSON" }, 400); }
    const runtime = getSyncRuntime(ctx);
    const action = String(body?.action || "status");
    try {
      if (action === "enable") await runtime.setEnabled(true);
      else if (action === "disable") await runtime.setEnabled(false);
      else if (action === "backfill") {
        // 批量探索可能包含多个模型调用，不能让 HTTP 请求一直挂着。
        // 后台执行，界面通过 status 轮询真实进度。
        runtime.backfill().catch((error) => ctx.log?.warn?.("Starmap backfill failed", error?.message || error));
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      else if (action === "explore") {
        const result = await runtime.explore(body?.session_id);
        return c.json({ ok: true, result, status: runtime.status() });
      }
      else if (action === "flush") await runtime.flushQueue();
      else if (action !== "status") return c.json({ ok: false, error: "未知同步操作" }, 400);
      return c.json({ ok: true, status: runtime.status() });
    } catch (error) {
      ctx.log?.warn?.("Starmap sync route failed", error?.message || error);
      return c.json({ ok: false, error: String(error?.message || "同步操作失败").slice(0, 300) }, 502);
    }
  });
}
