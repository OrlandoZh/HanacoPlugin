const PROTOCOL = "hana.plugin.ui";
const VERSION = 1;

function targetOrigin() {
  const explicit = new URLSearchParams(location.search).get("hana-host-origin");
  if (explicit) return explicit;
  try { return new URL(document.referrer).origin; } catch { return "*"; }
}
function post(message) { window.parent.postMessage(message, targetOrigin()); }
function event(type, payload) { post({ protocol: PROTOCOL, version: VERSION, kind: "event", type, payload }); }
function currentPluginId() {
  const match = /^\/api\/plugins\/([^/]+)(?:\/|$)/.exec(location.pathname || "");
  if (!match) throw new Error("Plugin route is not under /api/plugins/:pluginId/");
  return decodeURIComponent(match[1]);
}
function apiUrl(relative) {
  const clean = String(relative).replace(/^\/+/, "");
  if (!clean || clean.includes("..") || clean.includes("\\") || /^[a-z][a-z0-9+.-]*:/i.test(clean)) throw new Error("Invalid plugin API path");
  return `${location.origin}/api/plugins/${encodeURIComponent(currentPluginId())}/${clean}`;
}
function apiFetch(relative, init = {}) {
  const surfaceSession = new URLSearchParams(location.search).get("pluginSurfaceSession");
  if (!surfaceSession) throw new Error("Missing pluginSurfaceSession");
  const headers = new Headers(init.headers || {});
  headers.set("X-Hana-Plugin-Surface-Session", surfaceSession);
  return fetch(apiUrl(relative), { ...init, headers });
}
const hana = {
  ready: () => event("hana.ready"),
  ui: { resize: (size) => event("ui.resize", size) },
};

const root = document.querySelector("#root");
root.innerHTML = `
<main class="shell">
  <header class="hero"><div><p class="eyebrow">HanaAgent Plugin</p><h1>Browser Bridge</h1><p>内部 MCP stdio · 双连接模式 · workflow 15 工具</p></div><span id="badge" class="badge">检查中</span></header>
  <section class="grid">
    <article class="card"><h2>MCP</h2><dl id="mcp"></dl></article>
    <article class="card"><h2>Chrome</h2><dl id="chrome"></dl></article>
    <article class="card"><h2>安全</h2><dl id="security"></dl></article>
  </section>
  <section class="actions">
    <button id="refresh" class="ghost">刷新</button><button id="start">启动</button><button id="restart" class="warn">重启 MCP</button><button id="emergency" class="danger">紧急断开</button><button id="stop" class="danger">停止</button>
  </section>
  <pre id="error" hidden></pre>
</main>`;

function yesNo(value) { return value ? "是" : "否"; }
function rows(target, entries) {
  target.innerHTML = entries.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v ?? "—")}</dd></div>`).join("");
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
async function refresh() {
  const res = await apiFetch("api/status");
  if (!res.ok) throw new Error(`Status HTTP ${res.status}`);
  const status = await res.json();
  const badge = document.querySelector("#badge");
  badge.textContent = status.mcp.connected && status.chrome.cdpOnline ? "运行中" : "未就绪";
  badge.className = `badge ${status.mcp.connected && status.chrome.cdpOnline ? "ok" : "idle"}`;
  rows(document.querySelector("#mcp"), [["已连接", yesNo(status.mcp.connected)], ["工具数", status.mcp.toolCount], ["传输", "stdio"], ["Bridge", status.mcp.bridgeAvailable ? "已内置" : "缺失"]]);
  const existing = status.connection?.mode === "existing-chrome";
  rows(document.querySelector("#chrome"), [
    ["连接模式", status.connection?.mode],
    ["CDP 在线", yesNo(status.chrome.cdpOnline)],
    ["端点", status.chrome.endpoint],
    ["浏览器", status.chrome.browser],
    [existing ? "User Data" : "Profile", existing ? status.chrome.userDataDir : status.chrome.profileDir],
    ["插件拥有", yesNo(status.connection?.ownsBrowser)],
    ["显式启动", status.connection?.explicitStartRequired ? yesNo(status.connection?.explicitStartGranted) : "不需要"],
    ["PID", status.chrome.pid],
  ]);
  rows(document.querySelector("#security"), [
    ["工具集", status.security.toolProfile],
    ["REST", "关闭"],
    ["仅回环", yesNo(status.security.loopbackOnly)],
    ["专用 Profile", yesNo(status.security.dedicatedProfile)],
    ["用户 Chrome 需审核", yesNo(status.security.userChromeRequiresReviewedStart)],
    ["Raw CDP 暴露", yesNo(status.security.rawCdpExposed)],
  ]);
  document.querySelector("#start").textContent = existing ? "授权并连接" : "启动";
  document.querySelector("#error").hidden = true;
}
function showNotice(message, type = "error") {
  const box = document.querySelector("#error");
  box.hidden = false;
  box.className = `notice ${type}`;
  box.textContent = message;
}
async function action(name) {
  setBusy(true);
  try {
    const res = await apiFetch(`api/${name}`, { method: "POST" });
    if (!res.ok) throw new Error(`${name} HTTP ${res.status}`);
    await refresh();
    showNotice(`Browser Bridge：${name} 完成`, "success");
  } catch (error) {
    showNotice(error.message, "error");
  } finally { setBusy(false); }
}
function setBusy(busy) { document.querySelectorAll("button").forEach((button) => { button.disabled = busy; }); }
document.querySelector("#refresh").onclick = () => {
  setBusy(true);
  refresh().catch((error) => showNotice(error.message, "error")).finally(() => setBusy(false));
};
document.querySelector("#start").onclick = () => action("start");
document.querySelector("#restart").onclick = () => action("restart");
document.querySelector("#emergency").onclick = () => action("emergency-detach");
document.querySelector("#stop").onclick = () => action("stop");
refresh().catch((error) => showNotice(error.message, "error"));
hana.ready(); hana.ui.resize({ height: 620 });
