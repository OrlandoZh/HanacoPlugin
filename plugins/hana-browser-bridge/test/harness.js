import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const HOST = "127.0.0.1";
const CHROME_CANDIDATES = [
  process.env.BB_CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
].filter(Boolean);

export async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, HOST, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForCdp(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const body = await new Promise((resolve, reject) => {
        const request = http.get({ host: HOST, port, path: "/json/version", timeout: 1000 }, (response) => {
          let data = "";
          response.on("data", (chunk) => { data += chunk; });
          response.on("end", () => resolve(data));
        });
        request.on("error", reject);
        request.on("timeout", () => request.destroy(new Error("CDP timeout")));
      });
      const parsed = JSON.parse(body);
      if (parsed.Browser) return parsed;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Chrome CDP did not start: ${lastError?.message || "unknown error"}`);
}

async function waitForDevToolsActivePort(userDataDir, timeoutMs = 30000) {
  const activePortPath = path.join(userDataDir, "DevToolsActivePort");
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const lines = fs.readFileSync(activePortPath, "utf8").trim().split(/\r?\n/);
      const port = Number(lines[0]);
      const browserPath = lines[1] || "";
      if (Number.isInteger(port) && port > 0 && port <= 65535 && /^\/devtools\/browser\/[A-Za-z0-9._-]+$/.test(browserPath)) {
        return { port, browserPath, activePortPath };
      }
      lastError = new Error("DevToolsActivePort content is invalid");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`DevToolsActivePort did not appear: ${lastError?.message || "unknown error"}`);
}

export async function launchChrome({ autoConnect = false } = {}) {
  const executable = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  if (!executable) throw new Error("Chrome not found; set BB_CHROME_BIN");
  let port = autoConnect ? 0 : await getFreePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-bb-plugin-it-"));
  const child = spawn(executable, [
    `--remote-debugging-address=${HOST}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--disable-background-networking",
    "about:blank",
  ], { detached: true, stdio: "ignore" });
  let browserPath = null;
  let activePortPath = null;
  if (autoConnect) {
    const active = await waitForDevToolsActivePort(userDataDir);
    port = active.port;
    browserPath = active.browserPath;
    activePortPath = active.activePortPath;
  }
  await waitForCdp(port);
  return {
    host: HOST,
    port,
    userDataDir,
    browserPath,
    activePortPath,
    pid: child.pid,
    isAlive() {
      try { process.kill(child.pid, 0); return true; } catch { return false; }
    },
    async teardown() {
      try { process.kill(-child.pid, "SIGKILL"); } catch {}
      try { process.kill(child.pid, "SIGKILL"); } catch {}
      await fs.promises.rm(userDataDir, { recursive: true, force: true });
    },
  };
}

export async function startFixture() {
  const html = `<!doctype html><meta charset="utf-8"><title>Browser Bridge Plugin Fixture</title>
  <div>总数 <span id="total">0</span> 成功 <span id="success">0</span> 失败 <span id="fail">0</span></div>
  <input id="trace-input"><script>window.__bbTest={getCounters:()=>({total:0,success:0,fail:0})};</script>`;
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, resolve);
  });
  const { port } = server.address();
  return {
    url: `http://${HOST}:${port}/`,
    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(resolve);
    }),
  };
}
