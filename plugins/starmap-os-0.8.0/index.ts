import { getSyncRuntime } from "./lib/conversation-sync.ts";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url));

async function serviceReachable(url) {
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/api/starmap/overview`, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch (_) { return false; }
}

function pythonCommand() {
  const configured = String(process.env.STARMAP_PYTHON || "").trim();
  const candidates = configured
    ? [[configured, []]]
    : process.platform === "win32"
      ? [["py", ["-3"]], ["python", []], ["python3", []]]
      : [["python3", []], ["python", []]];
  for (const [command, prefix] of candidates) {
    const checked = spawnSync(command, [...prefix, "--version"], { encoding: "utf8", timeout: 3000 });
    if (!checked.error && checked.status === 0) return { command, prefix };
  }
  return null;
}

async function startBundledService(ctx) {
  const configured = await ctx.config?.get?.("starmapServerUrl");
  const parsed = new URL(typeof configured === "string" && configured.trim() ? configured : "http://127.0.0.1:8790");
  if (parsed.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error("星图服务地址必须是本机 HTTP 地址");
  }
  const baseUrl = parsed.toString().replace(/\/$/, "");
  if (await serviceReachable(baseUrl)) return { baseUrl, process: null, external: true };
  const serverPath = join(PLUGIN_DIR, "service", "server.py");
  if (!existsSync(serverPath)) {
    ctx.log?.warn?.("Starmap bundled service not found; using external development service");
    return { baseUrl, process: null, external: true };
  }
  const python = pythonCommand();
  if (!python) throw new Error("星图需要 Python 3.9 或更高版本，请安装后重新启用插件");
  const child = spawn(python.command, [...python.prefix, serverPath, parsed.port || "8790"], {
    cwd: dirname(serverPath),
    env: { ...process.env, STARMAP_DATA_DIR: join(ctx.dataDir, "starmap-data") },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", (chunk) => ctx.log?.info?.(`[service] ${String(chunk).trim()}`));
  child.stderr?.on("data", (chunk) => ctx.log?.warn?.(`[service] ${String(chunk).trim()}`));
  child.on("error", (error) => ctx.log?.warn?.(`Starmap service error: ${error.message}`));
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (await serviceReachable(baseUrl)) return { baseUrl, process: child, external: false };
    if (child.exitCode !== null) break;
  }
  try { child.kill(); } catch (_) {}
  throw new Error("星图本机服务启动失败，请检查 Python 版本或 8790 端口占用");
}

export default class StarmapPlugin {
  async onload() {
    const service = await startBundledService(this.ctx);
    this.ctx._starmapService = service;
    const runtime = getSyncRuntime(this.ctx);
    // 实时监听先建立，再在后台补读最近公开对话，覆盖插件重启期间错过的结束事件。
    // backfill 只同步原文或补传既有结果，不自动调用 AI。
    if (runtime.enabled) await runtime.start({ backfill: true });

    this.ctx.log.info("Starmap plugin loaded");
    this.register?.(() => {
      if (service.process && service.process.exitCode === null) service.process.kill();
      delete this.ctx._starmapService;
    });
  }

  async onunload() {
    this.ctx?._starmapSync?.stop?.();
    const service = this.ctx?._starmapService;
    if (service?.process && service.process.exitCode === null) service.process.kill();
    this.ctx?.log?.info("Starmap plugin unloaded");
  }
}
