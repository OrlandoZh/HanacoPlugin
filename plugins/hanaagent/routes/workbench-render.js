import {
  cleanString,
  escapeAttr,
  escapeHtmlText,
  escapeJson,
  addQuery,
  normalizeHermesPageAlias
} from "./workbench-utils.js"

const HERMES_PAGE_ALIASES = [
  { path: "/", section: "dashboard", label: "Dashboard", target: "mobileSectionControl", note: "Hermes dashboard overview is mapped to the HanaAgent OpenHanako workbench overview." },
  { path: "/index", section: "dashboard", label: "Index", target: "mobileSectionControl", note: "Hermes index route opens the HanaAgent workbench overview." },
  { path: "/dashboard", section: "dashboard", label: "Dashboard", target: "mobileSectionControl", note: "Hermes dashboard metrics are provided by HanaAgent overview and setup doctor panels." },
  { path: "/chat", section: "chat", label: "Chat", target: "mobileSectionRuntime", note: "Hermes chat is mapped to OpenHanako session selection, history, live events, export, fork, and dispatch controls." },
  { path: "/chat/:sessionKey", section: "chat", label: "Chat Session", target: "mobileSectionRuntime", note: "Hermes chat session deep links render the same OpenHanako-safe session runtime surface." },
  { path: "/conductor", section: "conductor", label: "Conductor", target: "mobileSectionConductor", note: "Hermes Conductor missions are mapped to HanaAgent Mission control, assignment dispatch, reports, and continuation." },
  { path: "/swarm", section: "swarm", label: "Swarm", target: "mobileSectionConductor", note: "Hermes Swarm opens the HanaAgent multi-agent mission and worker control plane." },
  { path: "/swarm2", section: "swarm", label: "Swarm2", target: "mobileSectionConductor", note: "Hermes Swarm2 worker IDE and lifecycle concepts are represented in HanaAgent worker cards, lifecycle, and handoff panels." },
  { path: "/tasks", section: "tasks", label: "Tasks", target: "board", note: "Hermes TaskBoard maps to the HanaAgent Kanban task board." },
  { path: "/files", section: "files", label: "Files", target: "mobileSectionFiles", note: "Hermes Files maps to the HanaAgent workspaceRoots file sandbox, editor, preview, diff, and patch review." },
  { path: "/terminal", section: "terminal", label: "Terminal", target: "terminalOutput", note: "Hermes terminal maps to OpenHanako host-managed terminal capabilities." },
  { path: "/memory", section: "memory", label: "Memory", target: "memoryPanel", note: "Hermes memory browser maps to OpenHanako memory capabilities plus HanaAgent local memory fallback." },
  { path: "/skills", section: "skills", label: "Skills", target: "integrationCatalogPanel", note: "Hermes skills marketplace maps to Integration Catalog and host-managed agent skill actions." },
  { path: "/mcp", section: "mcp", label: "MCP", target: "integrationCatalogPanel", note: "Hermes MCP catalog maps to OpenHanako MCP runtime and settings-action capabilities." },
  { path: "/operations", section: "operations", label: "Operations", target: "operationsPanel", note: "Hermes Operations maps to HanaAgent profile presets, readiness, roster import/export, and topology." },
  { path: "/profiles", section: "profiles", label: "Profiles", target: "agentProfilePanel", note: "Hermes profile management maps to HanaAgent agent profile overrides and OpenHanako default agent config." },
  { path: "/jobs", section: "jobs", label: "Jobs", target: "jobsPanel", note: "Hermes jobs map to HanaAgent jobs, scheduler, and autopilot tick controls." },
  { path: "/settings", section: "settings", label: "Settings", target: "workbenchSettingsPanel", note: "Hermes settings map to HanaAgent workbench settings while provider secrets remain host-managed by OpenHanako." },
  { path: "/settings/providers", section: "settings", label: "Provider Settings", target: "providerSetupPanel", note: "Hermes provider setup is represented by an OpenHanako-safe provider readiness panel, setup snippets, model chooser, and host-managed secret guidance." },
  { path: "/vt-capital", section: "runtime", label: "VT Capital", target: "mobileSectionRuntime", note: "Hermes VT Capital observe-only dashboard maps to HanaAgent worker/run/checkpoint runtime stats." },
  { path: "/reserve", section: "standalone", label: "Reserve", target: "mobileSectionControl", note: "Hermes reservation page is a standalone surface; HanaAgent exposes a compatibility notice and keeps work inside OpenHanako." },
  { path: "/reserve/confirm", section: "standalone", label: "Reserve Confirm", target: "mobileSectionControl", note: "Hermes reservation confirmation is a standalone surface; HanaAgent exposes host-safe compatibility only." },
  { path: "/early-access", section: "standalone", label: "Early Access", target: "mobileSectionControl", note: "Hermes early-access page is standalone marketing/onboarding; HanaAgent opens the usable workbench directly." },
  { path: "/hermes-world", section: "standalone", label: "Hermes World", target: "mobileSectionControl", note: "Hermes World is a standalone game/demo surface; HanaAgent maps it to the agent workbench rather than external reservation services." },
  { path: "/world", section: "standalone", label: "World", target: "mobileSectionControl", note: "Hermes World route is represented as a compatibility entry into the HanaAgent workbench." },
  { path: "/agora", section: "standalone", label: "Agora", target: "mobileSectionControl", note: "Hermes Agora multiplayer route is represented as a compatibility entry into the HanaAgent workbench." },
  { path: "/playground", section: "standalone", label: "Playground", target: "mobileSectionControl", note: "Hermes Playground demo route is represented as a compatibility entry into the HanaAgent workbench." },
  { path: "/*", section: "fallback", label: "SPA Fallback", target: "mobileSectionControl", note: "Hermes SPA fallback maps unknown non-API plugin paths to the HanaAgent workbench." }
];

function buildHermesPageAlias(c, alias = {}) {
  const route = alias.path || c.req.path || "/workbench";
  const params = typeof c.req.param === "function" ? c.req.param() : {};
  const sessionKey = cleanString(params?.sessionKey || "");
  return {
    route,
    requestedPath: c.req.path || route,
    section: alias.section || "workbench",
    label: alias.label || route,
    target: alias.target || "mobileSectionControl",
    note: alias.note || "Hermes Workspace page route mapped to HanaAgent OpenHanako plugin workbench.",
    sessionKey
  };
}

export async function renderWorkbench(c, ctx, hermesPageAlias = null) {
  const token = c.req.query("token") || "";
  const hanaCss = c.req.query("hana-css") || "";
  const theme = c.req.query("hana-theme") || "inherit";
  const pageAlias = normalizeHermesPageAlias(c, hermesPageAlias);
  const base = `/api/plugins/${ctx.pluginId}`;
  const urls = {
    state: addQuery(`${base}/api/state`, { token }),
    overview: addQuery(`${base}/api/overview`, { token }),
    workers: addQuery(`${base}/api/workers`, { token }),
    search: addQuery(`${base}/api/search`, { token }),
    workspaceRoots: addQuery(`${base}/api/workspace-roots`, { token }),
    workspaceFiles: addQuery(`${base}/api/workspace-files`, { token }),
    workspaceFile: addQuery(`${base}/api/workspace-file`, { token }),
    workspaceFileDownload: addQuery(`${base}/api/workspace-file/download`, { token }),
    workspaceFileDiff: addQuery(`${base}/api/workspace-file/diff`, { token }),
    workspacePatchReview: addQuery(`${base}/api/workspace-file/patch-review`, { token }),
    workspaceFileUpload: addQuery(`${base}/api/workspace-file/upload`, { token }),
    workspaceFileAction: addQuery(`${base}/api/workspace-file/action`, { token }),
    blueprint: addQuery(`${base}/api/blueprint`, { token }),
    parity: addQuery(`${base}/api/parity`, { token }),
    agents: addQuery(`${base}/api/agents`, { token }),
    sessions: addQuery(`${base}/api/sessions`, { token }),
    sessionStatus: addQuery(`${base}/api/session-status`, { token }),
    usage: addQuery(`${base}/api/usage`, { token }),
    contextUsage: addQuery(`${base}/api/context-usage`, { token }),
    agentProfiles: addQuery(`${base}/api/agent-profiles`, { token }),
    agentSkills: addQuery(`${base}/api/agent-skills`, { token }),
    memory: addQuery(`${base}/api/memory`, { token }),
    knowledgeList: addQuery(`${base}/api/knowledge/list`, { token }),
    knowledgeSearch: addQuery(`${base}/api/knowledge/search`, { token }),
    knowledgeRead: addQuery(`${base}/api/knowledge/read`, { token }),
    knowledgeGraph: addQuery(`${base}/api/knowledge/graph`, { token }),
    integrations: addQuery(`${base}/api/integrations`, { token }),
    integrationAction: addQuery(`${base}/api/integrations/action`, { token }),
    hostCheckpoints: addQuery(`${base}/api/host-checkpoints`, { token }),
    hostTasks: addQuery(`${base}/api/host-tasks`, { token }),
    deferredTasks: addQuery(`${base}/api/deferred-tasks`, { token }),
    sessionHistory: addQuery(`${base}/api/session-history`, { token }),
    sessionExport: addQuery(`${base}/api/session-export`, { token }),
    sessionExportBatch: addQuery(`${base}/api/session-export/batch`, { token }),
    sessionFork: addQuery(`${base}/api/session-fork`, { token }),
    sessionTitle: addQuery(`${base}/api/session-title`, { token }),
    sessionAliases: addQuery(`${base}/api/session-aliases`, { token }),
    sessionTombstones: addQuery(`${base}/api/session-tombstones`, { token }),
    sessionEvents: addQuery(`${base}/api/session-events`, { token }),
    sessionAbort: addQuery(`${base}/api/session-abort`, { token }),
    sessionRevertTurn: addQuery(`${base}/api/session-revert-turn`, { token }),
    dispatch: addQuery(`${base}/api/dispatch`, { token }),
    tasks: addQuery(`${base}/api/tasks`, { token }),
    clearDone: addQuery(`${base}/api/tasks/clear-done`, { token }),
    checkpoints: addQuery(`${base}/api/checkpoints`, { token }),
    checkpointReminders: addQuery(`${base}/api/checkpoint-reminders`, { token }),
    agentOutputs: addQuery(`${base}/api/agent-outputs`, { token }),
    swarmActivity: addQuery(`${base}/api/swarm-activity`, { token }),
    workerArtifacts: addQuery(`${base}/api/worker-artifacts`, { token }),
    approvals: addQuery(`${base}/api/approvals`, { token }),
    agenda: addQuery(`${base}/api/agenda`, { token }),
    calendar: addQuery(`${base}/api/calendar`, { token }),
    runRecords: addQuery(`${base}/api/run-records`, { token }),
    runLearnings: addQuery(`${base}/api/run-learnings`, { token }),
    runCompare: addQuery(`${base}/api/run-compare`, { token }),
    inbox: addQuery(`${base}/api/inbox`, { token }),
    autopilot: addQuery(`${base}/api/autopilot`, { token }),
    autopilotLoop: addQuery(`${base}/api/autopilot/loop`, { token }),
    autopilotSchedule: addQuery(`${base}/api/autopilot/schedule`, { token }),
    autopilotTick: addQuery(`${base}/api/autopilot/tick`, { token }),
    jobs: addQuery(`${base}/api/jobs`, { token }),
    operations: addQuery(`${base}/api/operations`, { token }),
    operationPresets: addQuery(`${base}/api/operations/presets`, { token }),
    operationPresetMission: addQuery(`${base}/api/operations/presets`, { token }),
    operationProfiles: addQuery(`${base}/api/operations/profiles`, { token }),
    operationSwarmRosterImport: addQuery(`${base}/api/operations/swarm-roster/import`, { token }),
    setupDoctor: addQuery(`${base}/api/setup-doctor`, { token }),
    providerSetup: addQuery(`${base}/api/provider-setup`, { token }),
    gatewayReprobe: addQuery(`${base}/api/gateway-reprobe`, { token }),
    modelSuggestions: addQuery(`${base}/api/model-suggestions`, { token }),
    syncHistory: addQuery(`${base}/api/checkpoints/sync-history`, { token }),
    clearCheckpoints: addQuery(`${base}/api/checkpoints/clear`, { token }),
    defaults: addQuery(`${base}/api/defaults`, { token }),
    missions: addQuery(`${base}/api/missions`, { token }),
    missionRoles: addQuery(`${base}/api/mission-roles`, { token }),
    terminals: addQuery(`${base}/api/terminals`, { token })
  };

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${hanaCss ? `<link rel="stylesheet" href="${escapeAttr(hanaCss)}">` : ""}
  <title>Hanaco 智能体工作台</title>
  <style>
    :root {
      color-scheme: light;
      --bg: var(--hana-bg, #f5f6f3);
      --panel: var(--hana-bg-card, #ffffff);
      --panel-2: color-mix(in srgb, var(--panel) 84%, var(--bg));
      --field: color-mix(in srgb, var(--panel) 96%, white);
      --text: var(--hana-text, #1e2528);
      --muted: var(--hana-text-muted, #667276);
      --line: color-mix(in srgb, var(--text) 14%, transparent);
      --line-strong: color-mix(in srgb, var(--text) 24%, transparent);
      --accent: var(--hana-accent, #0f766e);
      --accent-2: #b7791f;
      --ok: #1f8a5b;
      --warn: #b7791f;
      --bad: #bf3d35;
      --shadow: rgba(17, 24, 28, .10);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        color-scheme: dark;
        --bg: var(--hana-bg, #0c1114);
        --panel: var(--hana-bg-card, #121a1f);
        --panel-2: #0f161b;
        --field: #0b1216;
        --text: var(--hana-text, #e7eef0);
        --muted: var(--hana-text-muted, #9aa8ad);
        --line: rgba(231, 238, 240, .13);
        --line-strong: rgba(231, 238, 240, .22);
        --accent: var(--hana-accent, #2dd4bf);
        --accent-2: #f2b84b;
        --ok: #45c58f;
        --warn: #f2b84b;
        --bad: #ff756e;
        --shadow: rgba(0, 0, 0, .36);
      }
    }
    body[data-workbench-theme="light"] {
      color-scheme: light;
      --bg: var(--hana-bg, #f5f6f3);
      --panel: var(--hana-bg-card, #ffffff);
      --panel-2: color-mix(in srgb, var(--panel) 84%, var(--bg));
      --field: color-mix(in srgb, var(--panel) 96%, white);
      --text: var(--hana-text, #1e2528);
      --muted: var(--hana-text-muted, #667276);
      --line: color-mix(in srgb, var(--text) 14%, transparent);
      --line-strong: color-mix(in srgb, var(--text) 24%, transparent);
      --shadow: rgba(17, 24, 28, .10);
    }
    body[data-workbench-theme="dark"] {
      color-scheme: dark;
      --bg: var(--hana-bg, #0c1114);
      --panel: var(--hana-bg-card, #121a1f);
      --panel-2: #0f161b;
      --field: #0b1216;
      --text: var(--hana-text, #e7eef0);
      --muted: var(--hana-text-muted, #9aa8ad);
      --line: rgba(231, 238, 240, .13);
      --line-strong: rgba(231, 238, 240, .22);
      --shadow: rgba(0, 0, 0, .36);
    }
    body[data-workbench-accent="blue"] { --accent: #2563eb; --accent-2: #0f766e; }
    body[data-workbench-accent="green"] { --accent: #0f766e; --accent-2: #b7791f; }
    body[data-workbench-accent="orange"] { --accent: #c45f10; --accent-2: #2563eb; }
    body[data-workbench-accent="purple"] { --accent: #7c3aed; --accent-2: #0f766e; }
    body[data-workbench-accent="mono"] { --accent: #52525b; --accent-2: #71717a; }
    body[data-workbench-preset="claude-official"],
    body[data-workbench-preset="hermes"] {
      --bg: #0d1021;
      --panel: #151936;
      --panel-2: #11152d;
      --field: #0b0f24;
      --text: #edf0ff;
      --muted: #aab2da;
      --line: rgba(237, 240, 255, .13);
      --line-strong: rgba(237, 240, 255, .25);
      --accent: #7c8cff;
      --accent-2: #2dd4bf;
    }
    body[data-workbench-preset="claude-official-light"],
    body[data-workbench-preset="nous"] {
      --bg: #f6f7ff;
      --panel: #ffffff;
      --panel-2: #eef1ff;
      --field: #ffffff;
      --text: #20243a;
      --muted: #68708f;
      --line: rgba(32, 36, 58, .13);
      --line-strong: rgba(32, 36, 58, .24);
      --accent: #536dfe;
      --accent-2: #0f766e;
    }
    body[data-workbench-preset="claude-classic"],
    body[data-workbench-preset="bronze"] {
      --bg: #171410;
      --panel: #241f19;
      --panel-2: #1e1a15;
      --field: #15120f;
      --text: #f3eadc;
      --muted: #b9a894;
      --line: rgba(243, 234, 220, .14);
      --line-strong: rgba(243, 234, 220, .25);
      --accent: #d59a45;
      --accent-2: #6fb6ff;
    }
    body[data-workbench-preset="classic-light"] {
      --bg: #fbf4e8;
      --panel: #fffaf1;
      --panel-2: #f4eadc;
      --field: #fffdf8;
      --text: #34281c;
      --muted: #806f5e;
      --line: rgba(52, 40, 28, .14);
      --line-strong: rgba(52, 40, 28, .25);
      --accent: #b7791f;
      --accent-2: #2563eb;
    }
    body[data-workbench-preset="slate"] {
      --bg: #0f172a;
      --panel: #162033;
      --panel-2: #111827;
      --field: #0b1220;
      --text: #e5edf7;
      --muted: #9dafc4;
      --line: rgba(229, 237, 247, .14);
      --line-strong: rgba(229, 237, 247, .25);
      --accent: #38bdf8;
      --accent-2: #a3e635;
    }
    body[data-workbench-preset="slate-light"] {
      --bg: #f3f7fb;
      --panel: #ffffff;
      --panel-2: #e8f0f7;
      --field: #ffffff;
      --text: #182333;
      --muted: #627084;
      --line: rgba(24, 35, 51, .13);
      --line-strong: rgba(24, 35, 51, .24);
      --accent: #0ea5e9;
      --accent-2: #16a34a;
    }
    body[data-workbench-preset="mono"] {
      --bg: #101010;
      --panel: #1a1a1a;
      --panel-2: #151515;
      --field: #0d0d0d;
      --text: #eeeeee;
      --muted: #adadad;
      --line: rgba(238, 238, 238, .14);
      --line-strong: rgba(238, 238, 238, .25);
      --accent: #d4d4d8;
      --accent-2: #a1a1aa;
    }
    body[data-workbench-preset="mono-light"] {
      --bg: #f6f6f6;
      --panel: #ffffff;
      --panel-2: #ededed;
      --field: #ffffff;
      --text: #242424;
      --muted: #6f6f6f;
      --line: rgba(36, 36, 36, .13);
      --line-strong: rgba(36, 36, 36, .24);
      --accent: #3f3f46;
      --accent-2: #71717a;
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-size: 14px;
      line-height: 1.45;
    }
    button, input, select, textarea {
      font: inherit;
      color: inherit;
    }
    button {
      border: 1px solid var(--line-strong);
      border-radius: 7px;
      background: var(--panel);
      min-height: 34px;
      padding: 7px 10px;
      cursor: pointer;
      transition: border-color .14s ease, background .14s ease, transform .14s ease;
    }
    button:hover { border-color: color-mix(in srgb, var(--accent) 58%, var(--line-strong)); }
    button:active { transform: translateY(1px); }
    button:disabled { cursor: default; opacity: .56; transform: none; }
    .primary {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
      font-weight: 700;
    }
    .danger { color: var(--bad); }
    input, select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--field);
      padding: 8px 10px;
      outline: none;
    }
    textarea {
      min-height: 118px;
      resize: vertical;
    }
    input:focus, select:focus, textarea:focus {
      border-color: color-mix(in srgb, var(--accent) 70%, var(--line));
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent);
    }
    .shell {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
    }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 3;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--line);
      background: color-mix(in srgb, var(--bg) 94%, transparent);
      backdrop-filter: blur(12px);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .mark {
      width: 32px;
      height: 32px;
      display: grid;
      place-items: center;
      border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--line));
      border-radius: 8px;
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 10%, transparent);
      flex: 0 0 auto;
    }
    .brand h1 {
      margin: 0;
      font-size: 16px;
      line-height: 1.1;
      letter-spacing: 0;
    }
    .brand small {
      display: block;
      color: var(--muted);
      font-size: 12px;
      margin-top: 2px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .command-wrap {
      position: relative;
      min-width: min(420px, 44vw);
      flex: 1 1 320px;
    }
    .command-input {
      min-height: 34px;
      padding-right: 82px;
    }
    .command-key {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--muted);
      pointer-events: none;
    }
    .command-panel {
      position: absolute;
      top: calc(100% + 8px);
      left: 0;
      right: 0;
      z-index: 6;
      display: none;
      max-height: min(520px, 70vh);
      overflow: auto;
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: 0 20px 44px var(--shadow);
      padding: 8px;
    }
    .command-panel.open { display: grid; gap: 8px; }
    .slash-wrap {
      position: relative;
    }
    .slash-wrap textarea {
      margin-bottom: 0;
      padding-right: 74px;
    }
    .voice-button {
      position: absolute;
      right: 8px;
      top: 8px;
      min-height: 28px;
      padding: 5px 8px;
      font-size: 11px;
      border-radius: 7px;
      z-index: 2;
    }
    .voice-button.listening {
      border-color: var(--danger);
      color: var(--danger);
      background: color-mix(in srgb, var(--danger) 10%, var(--panel));
    }
    .voice-status {
      position: absolute;
      right: 8px;
      bottom: 8px;
      max-width: min(280px, 70%);
      color: var(--muted);
      font-size: 11px;
      pointer-events: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .slash-panel {
      position: absolute;
      left: 0;
      right: 0;
      bottom: calc(100% + 8px);
      z-index: 5;
      display: none;
      max-height: 300px;
      overflow: auto;
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: 0 18px 38px var(--shadow);
      padding: 8px;
    }
    .slash-panel.open { display: grid; gap: 8px; }
    .connection-banner {
      display: none;
      margin: 10px 16px 0;
      border: 1px solid var(--line-strong);
      border-left: 4px solid var(--accent);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: 0 12px 30px var(--shadow);
      padding: 10px;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
    }
    .connection-banner.open { display: grid; }
    .connection-banner.ready { border-left-color: var(--ok); }
    .connection-banner.degraded { border-left-color: var(--warn); }
    .connection-banner.blocked,
    .connection-banner.offline { border-left-color: var(--bad); }
    .connection-banner b,
    .connection-banner span {
      overflow-wrap: anywhere;
    }
    .connection-banner b {
      font-size: 13px;
    }
    .connection-banner span {
      color: var(--muted);
      font-size: 12px;
    }
    .hermes-route-banner {
      margin: 10px 16px 0;
      border: 1px solid color-mix(in srgb, var(--accent) 32%, var(--line));
      border-radius: 8px;
      background: color-mix(in srgb, var(--accent) 7%, var(--panel));
      padding: 9px 10px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
    }
    .hermes-route-banner b,
    .hermes-route-banner span {
      overflow-wrap: anywhere;
    }
    .hermes-route-banner b {
      font-size: 13px;
    }
    .hermes-route-banner span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      margin-top: 2px;
    }
    .composer-tools {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 8px;
    }
    .attachment-list {
      display: grid;
      gap: 6px;
      margin-top: 8px;
    }
    .attachment-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 7px 8px;
      background: var(--panel-2);
    }
    .attachment-item b,
    .attachment-item span {
      overflow-wrap: anywhere;
    }
    .attachment-item span {
      color: var(--muted);
      font-size: 11px;
    }
    .research-card {
      border: 1px solid color-mix(in srgb, var(--accent) 36%, var(--line));
      border-radius: 8px;
      background: color-mix(in srgb, var(--accent) 7%, var(--panel));
      padding: 12px;
      display: grid;
      gap: 10px;
    }
    .research-card-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: flex-start;
    }
    .research-card h3 {
      margin: 0;
      font-size: 15px;
      line-height: 1.25;
    }
    .research-card p {
      margin: 0;
      color: var(--muted);
      overflow-wrap: anywhere;
    }
    .research-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .research-section {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
      padding: 9px;
      display: grid;
      gap: 6px;
      align-content: start;
    }
    .research-section b {
      font-size: 12px;
    }
    .research-section ul {
      margin: 0;
      padding-left: 18px;
      color: var(--muted);
      font-size: 12px;
    }
    .research-section li {
      margin: 3px 0;
      overflow-wrap: anywhere;
    }
    @media (max-width: 780px) {
      .research-grid {
        grid-template-columns: 1fr;
      }
    }
    .command-result {
      width: 100%;
      display: grid;
      gap: 4px;
      text-align: left;
      background: var(--panel-2);
    }
    .command-result b {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .command-result span {
      color: var(--muted);
      font-size: 11px;
      overflow-wrap: anywhere;
    }
    .command-result.active {
      border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 10%, var(--panel));
    }
    .command-palette-input {
      min-height: 40px;
      font-size: 14px;
    }
    .command-palette-list {
      display: grid;
      gap: 8px;
      max-height: min(52vh, 460px);
      overflow: auto;
    }
    .command-palette-item {
      width: 100%;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      text-align: left;
      background: var(--panel-2);
    }
    .command-palette-item b,
    .command-palette-item span {
      overflow-wrap: anywhere;
    }
    .command-palette-item span {
      color: var(--muted);
      font-size: 11px;
    }
    .command-palette-item.active {
      border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 10%, var(--panel));
    }
    .command-meta {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px 10px;
      background: var(--panel);
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--warn);
    }
    .dot.ok { background: var(--ok); }
    .dot.bad { background: var(--bad); }
    .main {
      width: min(1480px, 100%);
      margin: 0 auto;
      scroll-margin-top: 80px;
      padding: 16px;
      display: grid;
      grid-template-columns: minmax(280px, 360px) minmax(0, 1fr) minmax(290px, 390px);
      gap: 14px;
      align-items: start;
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      scroll-margin-top: 80px;
      background: var(--panel);
      box-shadow: 0 10px 28px var(--shadow);
      overflow: hidden;
    }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 12px 10px;
      border-bottom: 1px solid var(--line);
      background: var(--panel-2);
    }
    .panel-title {
      margin: 0;
      font-size: 13px;
      line-height: 1.2;
      font-weight: 800;
    }
    .panel-body {
      padding: 12px;
      display: grid;
      gap: 12px;
    }
    .label {
      display: grid;
      gap: 6px;
      font-size: 12px;
      color: var(--muted);
      font-weight: 700;
    }
    .label span { color: var(--muted); }
    .metrics {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    .metric {
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 9px;
      background: var(--panel-2);
      min-width: 0;
    }
    .metric b {
      display: block;
      font-size: 20px;
      line-height: 1;
      font-variant-numeric: tabular-nums;
    }
    .metric span {
      display: block;
      margin-top: 4px;
      color: var(--muted);
      font-size: 11px;
    }
    .segments {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
    }
    .segment {
      min-height: 42px;
      padding: 7px 8px;
      text-align: left;
      font-size: 12px;
      background: var(--panel-2);
    }
    .segment.active {
      border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 12%, var(--panel));
    }
    .segment b { display: block; font-size: 12px; }
    .segment span { display: block; color: var(--muted); font-size: 11px; margin-top: 1px; }
    .split {
      display: grid;
      grid-template-columns: 1fr 130px;
      gap: 8px;
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }
    .conductor-stage {
      display: grid;
      gap: 12px;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: radial-gradient(circle at 50% 10%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 42%), var(--panel-2);
    }
    .conductor-hero {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .conductor-kicker {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      border: 1px solid color-mix(in srgb, var(--accent) 46%, var(--line));
      border-radius: 999px;
      padding: 5px 10px;
      color: var(--accent);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .16em;
      text-transform: uppercase;
      background: color-mix(in srgb, var(--accent) 9%, transparent);
    }
    .conductor-title {
      margin: 8px 0 0;
      font-size: 13px;
      color: var(--muted);
    }
    .office {
      position: relative;
      min-height: 340px;
      border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--line));
      border-radius: 8px;
      overflow: hidden;
      background:
        linear-gradient(color-mix(in srgb, var(--text) 5%, transparent) 1px, transparent 1px),
        linear-gradient(90deg, color-mix(in srgb, var(--text) 5%, transparent) 1px, transparent 1px),
        color-mix(in srgb, var(--panel) 86%, #10212a);
      background-size: 28px 28px;
    }
    .swarm-hub-card {
      position: absolute;
      left: 50%;
      top: 16px;
      z-index: 3;
      width: min(520px, calc(100% - 28px));
      transform: translateX(-50%);
      display: grid;
      gap: 8px;
      border: 1px solid color-mix(in srgb, var(--accent) 52%, var(--line));
      border-radius: 8px;
      background: color-mix(in srgb, var(--panel) 96%, transparent);
      box-shadow: 0 12px 30px var(--shadow);
      padding: 10px;
    }
    .swarm-hub-main {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
    }
    .swarm-hub-avatar {
      width: 40px;
      height: 40px;
      display: grid;
      place-items: center;
      border: 1px solid color-mix(in srgb, var(--accent) 48%, var(--line));
      border-radius: 999px;
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 10%, var(--panel));
      font-weight: 900;
    }
    .swarm-hub-title {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .swarm-hub-title b,
    .swarm-hub-title span {
      overflow-wrap: anywhere;
    }
    .swarm-hub-title span {
      color: var(--muted);
      font-size: 11px;
    }
    .swarm-hub-metrics {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      justify-content: flex-end;
    }
    .swarm-hub-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      justify-content: center;
    }
    .swarm-hub-wires {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
    }
    .swarm-hub-wire {
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--field);
      padding: 6px;
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .swarm-hub-wire b {
      font-size: 11px;
      overflow-wrap: anywhere;
    }
    .swarm-hub-wire span {
      color: var(--muted);
      font-size: 10px;
      overflow-wrap: anywhere;
    }
    .desk {
      position: absolute;
      width: 82px;
      height: 42px;
      border: 1px solid var(--line-strong);
      border-radius: 7px;
      background: color-mix(in srgb, var(--panel) 92%, var(--accent));
      box-shadow: 0 10px 18px color-mix(in srgb, #000 12%, transparent);
    }
    .desk::after {
      content: "";
      position: absolute;
      left: 22px;
      right: 22px;
      bottom: -8px;
      height: 6px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--muted) 32%, transparent);
    }
    .worker {
      position: absolute;
      width: 96px;
      transform: translate(-50%, -50%);
      display: grid;
      justify-items: center;
      gap: 4px;
      text-align: center;
      cursor: pointer;
    }
    .worker-avatar {
      width: 34px;
      height: 34px;
      display: grid;
      place-items: center;
      border-radius: 8px;
      border: 1px solid color-mix(in srgb, var(--accent) 48%, var(--line));
      background: color-mix(in srgb, var(--accent) 18%, var(--panel));
      font-weight: 900;
      color: var(--accent);
    }
    .worker.running .worker-avatar,
    .worker.active .worker-avatar {
      box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 13%, transparent);
    }
    .worker.blocked .worker-avatar {
      border-color: color-mix(in srgb, var(--bad) 58%, var(--line));
      color: var(--bad);
    }
    .worker.done .worker-avatar {
      border-color: color-mix(in srgb, var(--ok) 58%, var(--line));
      color: var(--ok);
    }
    .worker b {
      max-width: 96px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
    }
    .worker small {
      max-width: 96px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--muted);
      font-size: 11px;
    }
    .worker-ide-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 10px;
      margin-top: 8px;
    }
    .worker-ide-card {
      display: grid;
      gap: 6px;
      align-content: start;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: var(--field);
      min-height: 108px;
    }
    .worker-ide-card h4 {
      margin: 0;
      font-size: 12px;
      color: var(--text);
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
    }
    .worker-ide-card p,
    .worker-ide-card li {
      margin: 0;
      font-size: 12px;
      color: var(--muted);
      overflow-wrap: anywhere;
    }
    .worker-ide-card ul {
      display: grid;
      gap: 4px;
      margin: 0;
      padding-left: 16px;
    }
    .worker-ide-shell {
      display: grid;
      gap: 10px;
    }
    .worker-ide-hub {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 10px;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--field);
      padding: 10px;
    }
    .worker-ide-avatar {
      width: 38px;
      height: 38px;
      border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--line));
      border-radius: 999px;
      display: grid;
      place-items: center;
      color: var(--accent);
      font-weight: 900;
      background: color-mix(in srgb, var(--accent) 10%, var(--panel));
    }
    .worker-ide-hub-main {
      display: grid;
      gap: 3px;
      min-width: 0;
    }
    .worker-ide-hub-main b,
    .worker-ide-hub-main span {
      overflow-wrap: anywhere;
    }
    .worker-ide-hub-main span {
      color: var(--muted);
      font-size: 12px;
    }
    .worker-ide-metrics {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 6px;
    }
    .worker-ide-tabs {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      border-bottom: 1px solid var(--line);
      padding-bottom: 8px;
    }
    .worker-ide-tab {
      min-height: 28px;
      padding: 5px 9px;
      border-radius: 999px;
      font-size: 11px;
    }
    .worker-ide-tab.active {
      border-color: var(--accent);
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 10%, var(--panel));
    }
    .worker-ide-pane {
      display: grid;
      gap: 10px;
      min-height: 160px;
    }
    .worker-lane-map {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin-top: 8px;
    }
    .worker-lane-node {
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--panel-2);
      padding: 8px;
      display: grid;
      gap: 3px;
      min-width: 0;
    }
    .worker-lane-node b {
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .worker-lane-node span {
      color: var(--muted);
      font-size: 11px;
      overflow-wrap: anywhere;
    }
    .worker-chat-feed,
    .worker-queue-list,
    .worker-evidence-grid {
      display: grid;
      gap: 8px;
    }
    .worker-chat-msg,
    .worker-queue-row,
    .worker-evidence-item {
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--field);
      padding: 8px;
      display: grid;
      gap: 4px;
    }
    .worker-chat-msg b,
    .worker-queue-row b,
    .worker-evidence-item b {
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .worker-chat-msg span,
    .worker-queue-row span,
    .worker-evidence-item span {
      color: var(--muted);
      font-size: 11px;
      overflow-wrap: anywhere;
    }
    .worker-preview-panel {
      display: grid;
      gap: 8px;
      margin-top: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--field);
      padding: 8px;
    }
    .worker-preview-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }
    .worker-preview-head b,
    .worker-preview-head span {
      overflow-wrap: anywhere;
    }
    .worker-preview-frame {
      width: 100%;
      min-height: 320px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
    }
    .worker-visual-picker {
      display: grid;
      gap: 8px;
      border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--line));
      border-radius: 8px;
      background: color-mix(in srgb, var(--accent) 7%, var(--field));
      padding: 9px;
    }
    .worker-visual-picker-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(0, .8fr);
      gap: 8px;
    }
    .worker-visual-picker textarea {
      min-height: 58px;
    }
    .worker-visual-picker small {
      color: var(--muted);
      overflow-wrap: anywhere;
    }
    .artifact-preview-panel {
      display: none;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
      padding: 9px;
      margin-bottom: 8px;
    }
    .artifact-preview-panel.open {
      display: grid;
    }
    .artifact-preview-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .artifact-preview-title {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .artifact-preview-title b {
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .artifact-preview-title span {
      color: var(--muted);
      font-size: 11px;
      overflow-wrap: anywhere;
    }
    .artifact-preview-frame {
      width: 100%;
      height: min(360px, 48vh);
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #fff;
    }
    .quick-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .quick-actions button[disabled] {
      opacity: .45;
      cursor: not-allowed;
    }
    .integration-toolbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 160px auto;
      gap: 8px;
      margin-bottom: 8px;
    }
    .integration-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 6px;
    }
    .integration-actions button[data-risk="medium"] {
      border-color: color-mix(in srgb, var(--warn) 42%, var(--line));
    }
    .integration-actions button[data-risk="high"] {
      border-color: color-mix(in srgb, var(--bad) 48%, var(--line));
      color: var(--bad);
    }
    @media (max-width: 720px) {
      .integration-toolbar {
        grid-template-columns: 1fr;
      }
    }
    .mission-drop {
      min-height: 78px;
      display: grid;
      gap: 4px;
      place-items: center;
      border: 1px dashed var(--line-strong);
      border-radius: 8px;
      color: var(--muted);
      text-align: center;
      padding: 12px;
    }
    .mission-drop b { color: var(--text); font-size: 13px; }
    .mission-drop span { font-size: 12px; overflow-wrap: anywhere; }
    .progress {
      height: 8px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--field);
      overflow: hidden;
    }
    .progress > span {
      display: block;
      height: 100%;
      width: var(--value, 0%);
      background: linear-gradient(90deg, var(--accent), var(--ok));
    }
    .assignment-list {
      display: grid;
      gap: 8px;
      max-height: 320px;
      overflow: auto;
    }
    .assignment {
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--panel-2);
      padding: 9px;
      display: grid;
      gap: 7px;
    }
    .assignment b { font-size: 12px; overflow-wrap: anywhere; }
    .assignment p { margin: 0; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
    .output-box {
      min-height: 110px;
      max-height: 260px;
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--field);
      padding: 10px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: var(--text);
    }
    .message-preview {
      display: grid;
      gap: 10px;
      white-space: normal;
      font: 13px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .message-preview.empty {
      place-items: center;
      color: var(--muted);
      text-align: center;
    }
    .worker-output-wrap {
      position: relative;
    }
    .scroll-bottom-button {
      position: absolute;
      right: 10px;
      bottom: 10px;
      z-index: 2;
      display: none;
      align-items: center;
      gap: 5px;
      min-height: 30px;
      border-color: color-mix(in srgb, var(--accent) 58%, var(--line));
      background: color-mix(in srgb, var(--panel) 96%, transparent);
      box-shadow: 0 10px 24px var(--shadow);
    }
    .scroll-bottom-button.visible {
      display: inline-flex;
    }
    .chat-empty-state {
      display: grid;
      gap: 8px;
      justify-items: center;
      max-width: 320px;
      margin: 0 auto;
      color: var(--muted);
      text-align: center;
    }
    .chat-empty-state b {
      color: var(--text);
      font-size: 13px;
    }
    .chat-empty-state span {
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .message-card {
      display: grid;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--panel-2);
      padding: 10px;
    }
    .message-card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      color: var(--muted);
      font-size: 11px;
    }
    .message-card-head b {
      color: var(--text);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .message-body {
      display: grid;
      gap: 7px;
      min-width: 0;
    }
    .message-body p,
    .message-body ul,
    .message-body ol,
    .message-body blockquote,
    .message-body h3 {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .message-body h3 {
      font-size: 14px;
    }
    .message-body ul,
    .message-body ol {
      padding-left: 20px;
    }
    .message-body blockquote {
      border-left: 3px solid var(--accent);
      padding-left: 9px;
      color: var(--muted);
    }
    .message-code {
      display: grid;
      gap: 0;
      border: 1px solid var(--line-strong);
      border-radius: 7px;
      overflow: hidden;
      background: #050b0e;
    }
    .message-code-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 6px 8px;
      color: #a8c4c4;
      background: rgba(255, 255, 255, .06);
      font-size: 11px;
    }
    .message-code pre {
      margin: 0;
      max-height: 260px;
      overflow: auto;
      padding: 9px;
      color: #d7e8e8;
      white-space: pre;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .message-pill-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .message-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      border: 1px solid var(--line-strong);
      border-radius: 999px;
      padding: 3px 7px;
      color: var(--muted);
      background: var(--panel);
      font-size: 11px;
    }
    .message-pill.tool { border-color: color-mix(in srgb, var(--accent) 50%, var(--line)); color: var(--accent); }
    .message-pill.checkpoint { border-color: color-mix(in srgb, var(--ok) 50%, var(--line)); color: var(--ok); }
    .message-tool-details {
      display: grid;
      gap: 7px;
    }
    .message-tool-detail {
      border: 1px solid var(--line);
      border-radius: 7px;
      background: color-mix(in srgb, var(--panel) 86%, transparent);
      overflow: hidden;
    }
    .message-tool-detail summary {
      list-style: none;
      cursor: pointer;
      padding: 7px 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .message-tool-detail summary::-webkit-details-marker {
      display: none;
    }
    .message-tool-detail summary::after {
      content: "展开";
      color: var(--muted);
      font-size: 11px;
    }
    .message-tool-detail[open] summary::after {
      content: "收起";
    }
    .message-tool-detail pre {
      margin: 0;
      max-height: 220px;
      overflow: auto;
      border-top: 1px solid var(--line);
      padding: 8px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: var(--text);
      background: color-mix(in srgb, var(--bg) 64%, transparent);
    }
    .message-tool-detail .actions {
      padding: 7px 8px;
      border-top: 1px solid var(--line);
      justify-content: flex-start;
    }
    .tool-trace-item {
      cursor: default;
    }
    .message-thinking {
      border: 1px dashed color-mix(in srgb, var(--accent) 50%, var(--line));
      border-radius: 7px;
      padding: 8px;
      color: var(--muted);
      background: color-mix(in srgb, var(--accent) 7%, transparent);
      font-size: 12px;
    }
    .streaming-indicator {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      color: var(--muted);
      font-size: 12px;
    }
    .streaming-indicator::before {
      content: "";
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--accent);
      animation: streamPulse 1.1s ease-in-out infinite;
    }
    .streaming-cursor {
      display: inline-block;
      width: 7px;
      height: 1em;
      margin-left: 2px;
      border-radius: 2px;
      background: var(--accent);
      vertical-align: -2px;
      animation: streamCursor 1s steps(2, start) infinite;
    }
    .streaming-skeleton {
      height: 8px;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--line), color-mix(in srgb, var(--accent) 28%, var(--line)), var(--line));
      background-size: 220% 100%;
      animation: streamShimmer 1.4s ease-in-out infinite;
    }
    @keyframes streamPulse {
      0%, 100% { opacity: .35; transform: scale(.9); }
      50% { opacity: 1; transform: scale(1.12); }
    }
    @keyframes streamCursor {
      0%, 45% { opacity: 1; }
      46%, 100% { opacity: 0; }
    }
    @keyframes streamShimmer {
      from { background-position: 160% 0; }
      to { background-position: -60% 0; }
    }
    .inspector-panel {
      display: grid;
      gap: 8px;
      max-height: 360px;
      overflow: auto;
    }
    .inspector-toolbar {
      display: grid;
      gap: 8px;
    }
    .inspector-tabs {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .inspector-tab {
      min-height: 28px;
      padding: 5px 8px;
      border-radius: 999px;
      font-size: 11px;
    }
    .inspector-tab.active {
      border-color: var(--accent);
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 10%, var(--panel));
    }
    .inspector-collapse {
      justify-self: start;
    }
    .inspector-panel.collapsed .inspector-body {
      display: none;
    }
    .inspector-summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }
    .inspector-stat {
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--panel-2);
      padding: 8px;
      min-width: 0;
    }
    .inspector-stat b {
      display: block;
      font-size: 16px;
      line-height: 1;
    }
    .inspector-stat span {
      display: block;
      margin-top: 3px;
      color: var(--muted);
      font-size: 10px;
      overflow-wrap: anywhere;
    }
    .inspector-section {
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--panel-2);
      padding: 9px;
      display: grid;
      gap: 6px;
    }
    .inspector-section h3 {
      margin: 0;
      font-size: 12px;
    }
    .inspector-row {
      display: grid;
      gap: 2px;
      color: var(--muted);
      font-size: 11px;
      overflow-wrap: anywhere;
    }
    .inspector-row b {
      color: var(--text);
      font-size: 11px;
    }
    .timeline {
      display: grid;
      gap: 8px;
      max-height: 300px;
      overflow: auto;
    }
    .event {
      border-left: 2px solid color-mix(in srgb, var(--accent) 52%, var(--line));
      padding: 2px 0 2px 9px;
      display: grid;
      gap: 2px;
    }
    .terminal-output { scroll-margin-top: 80px; }
    .event span { color: var(--muted); font-size: 11px; }
    .board {
      display: grid;
      scroll-margin-top: 80px;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 10px;
      padding: 12px;
    }
    .board-toolbar {
      display: grid;
      grid-template-columns: minmax(180px, 1fr) minmax(120px, 160px) minmax(120px, 160px) auto auto;
      gap: 8px;
      align-items: center;
      padding: 12px 12px 0;
    }
    .bulk-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      padding: 8px 12px 0;
    }
    .bulk-toolbar select {
      min-height: 28px;
      max-width: 150px;
    }
    .lane {
      min-height: 360px;
      display: grid;
      grid-template-rows: auto 1fr;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
      overflow: hidden;
    }
    .lane.wip-warning {
      border-color: color-mix(in srgb, var(--warn) 70%, var(--line));
    }
    .lane.wip-over {
      border-color: color-mix(in srgb, var(--danger) 78%, var(--line));
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger) 28%, transparent);
    }
    .lane h3 {
      margin: 0;
      padding: 10px;
      border-bottom: 1px solid var(--line);
      font-size: 12px;
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }
    .lane-heading {
      display: inline-flex;
      align-items: center;
      min-width: 0;
      gap: 6px;
    }
    .lane-heading span:first-child {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .wip-tag.over {
      border-color: color-mix(in srgb, var(--danger) 64%, var(--line));
      color: var(--danger);
      background: color-mix(in srgb, var(--danger) 10%, transparent);
    }
    .wip-tag.warning {
      border-color: color-mix(in srgb, var(--warn) 64%, var(--line));
      color: var(--warn);
      background: color-mix(in srgb, var(--warn) 10%, transparent);
    }
    .wip-limit-input {
      width: 54px;
      min-height: 26px;
      padding: 3px 6px;
      font-size: 11px;
    }
    .lane-list {
      padding: 9px;
      display: grid;
      align-content: start;
      gap: 8px;
      min-height: 84px;
    }
    .lane.drag-over {
      border-color: var(--accent);
      box-shadow: inset 0 0 0 1px rgba(91, 140, 255, .35);
    }
    .task {
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--panel);
      padding: 9px;
      display: grid;
      gap: 7px;
    }
    .task[draggable="true"] {
      cursor: grab;
    }
    .task.dragging {
      opacity: .55;
      outline: 1px dashed var(--accent);
    }
    .task.drop-before {
      box-shadow: 0 -3px 0 var(--accent);
    }
    .item.pinned-draggable {
      cursor: grab;
    }
    .item.pinned-draggable.dragging {
      opacity: .55;
      outline: 1px dashed var(--accent);
    }
    .item.pinned-draggable.drop-before {
      box-shadow: 0 -3px 0 var(--accent);
    }
    .item.pinned-draggable.drop-after {
      box-shadow: 0 3px 0 var(--accent);
    }
    .task.focused {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent);
    }
    .task strong {
      font-size: 12px;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }
    .task p {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .task-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
    }
    .task-select {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .task-select input {
      width: 14px;
      height: 14px;
      margin: 0;
    }
    .task-editor-backdrop {
      position: fixed;
      inset: 0;
      z-index: 40;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 18px;
      background: rgba(8, 12, 18, .52);
      backdrop-filter: blur(8px);
    }
    .task-editor-backdrop.open {
      display: flex;
    }
    .shortcut-backdrop {
      position: fixed;
      inset: 0;
      z-index: 45;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 18px;
      background: rgba(8, 12, 18, .52);
      backdrop-filter: blur(8px);
    }
    .shortcut-backdrop.open {
      display: flex;
    }
    .shortcut-modal {
      width: min(720px, 100%);
      max-height: min(86vh, 760px);
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
    }
    .shortcut-body {
      display: grid;
      gap: 10px;
      padding: 12px;
    }
    .model-chooser-modal {
      width: min(860px, 100%);
    }
    .model-chooser-tools {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(160px, 220px);
      gap: 8px;
    }
    .model-choice-list {
      display: grid;
      gap: 8px;
      max-height: min(56vh, 520px);
      overflow: auto;
    }
    .model-choice {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
      padding: 10px;
      display: grid;
      gap: 8px;
    }
    .model-choice-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: flex-start;
    }
    .model-choice-head b,
    .model-choice-head span,
    .model-choice-meta span {
      overflow-wrap: anywhere;
    }
    .model-choice-meta {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .model-choice-meta span {
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      background: var(--field);
      padding: 2px 7px;
      font-size: 11px;
    }
    .provider-setup-grid {
      display: grid;
      gap: 8px;
    }
    .provider-setup-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
      padding: 10px;
      display: grid;
      gap: 8px;
    }
    .provider-setup-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: flex-start;
    }
    .provider-setup-head b,
    .provider-setup-card span,
    .provider-setup-card code,
    .provider-setup-snippet {
      overflow-wrap: anywhere;
    }
    .provider-setup-snippet {
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--field);
      padding: 8px;
      max-height: 150px;
      overflow: auto;
      white-space: pre-wrap;
      font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: var(--text);
    }
    @media (max-width: 720px) {
      .model-chooser-tools {
        grid-template-columns: 1fr;
      }
    }
    .shortcut-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }
    .shortcut-row {
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--panel-2);
      padding: 9px;
      display: grid;
      gap: 4px;
    }
    .shortcut-row kbd {
      justify-self: start;
      border: 1px solid var(--line-strong);
      border-bottom-width: 2px;
      border-radius: 6px;
      background: var(--field);
      padding: 2px 6px;
      font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .shortcut-row span {
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .tour-progress {
      display: flex;
      gap: 5px;
      flex-wrap: wrap;
    }
    .tour-dot {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: var(--line-strong);
    }
    .tour-dot.active {
      background: var(--accent);
    }
    .tour-step-card {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
      padding: 12px;
      display: grid;
      gap: 8px;
    }
    .tour-step-card h3 {
      margin: 0;
      font-size: 15px;
    }
    .tour-step-card p {
      margin: 0;
      color: var(--muted);
      overflow-wrap: anywhere;
    }
    .task-editor {
      width: min(760px, 100%);
      max-height: min(86vh, 760px);
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
    }
    .task-editor-head {
      position: sticky;
      top: 0;
      z-index: 1;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
      padding: 12px;
      border-bottom: 1px solid var(--line);
      background: var(--panel-2);
    }
    .task-editor-body {
      display: grid;
      gap: 12px;
      padding: 12px;
    }
    .task-editor-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }
    .task-editor textarea {
      min-height: 120px;
    }
    .mini {
      min-height: 28px;
      padding: 4px 7px;
      font-size: 11px;
    }
    .tag {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 3px 7px;
      color: var(--muted);
      font-size: 11px;
      white-space: nowrap;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .list {
      display: grid;
      gap: 8px;
      max-height: 270px;
      overflow: auto;
    }
    .item {
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--panel-2);
      padding: 9px;
      display: grid;
      gap: 4px;
    }
    .item b { font-size: 12px; overflow-wrap: anywhere; }
    .item span { color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
    .agenda-section {
      border-color: var(--line);
      background: var(--panel-2);
    }
    .agenda-section.attention {
      border-color: color-mix(in srgb, var(--bad) 44%, var(--line));
      background: color-mix(in srgb, var(--bad) 7%, var(--panel-2));
    }
    .agenda-section-head {
      width: 100%;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 8px;
      align-items: center;
      text-align: left;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--text);
      box-shadow: none;
    }
    .agenda-section-head:hover {
      transform: none;
      background: transparent;
    }
    .agenda-section-count {
      min-width: 24px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 2px 7px;
      color: var(--muted);
      font-size: 11px;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .agenda-section-toggle {
      color: var(--muted);
      font-size: 11px;
    }
    .agenda-section-body {
      display: grid;
      gap: 5px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--line);
    }
    .agenda-section-row {
      width: 100%;
      text-align: left;
      border: 1px solid transparent;
      border-radius: 6px;
      background: transparent;
      padding: 5px 6px;
      color: var(--muted);
      font-size: 11px;
      overflow-wrap: anywhere;
      box-shadow: none;
    }
    .agenda-section-row:hover {
      transform: none;
      color: var(--text);
      border-color: var(--line);
      background: var(--field);
    }
    .agenda-section-row[disabled] {
      cursor: default;
      opacity: 0.72;
    }
    .agenda-section-row[disabled]:hover {
      color: var(--muted);
      border-color: transparent;
      background: transparent;
    }
    .calendar-grid {
      display: grid;
      gap: 6px;
      min-width: 0;
    }
    .calendar-grid.month {
      grid-template-columns: repeat(7, minmax(86px, 1fr));
    }
    .calendar-grid.week {
      grid-template-columns: repeat(7, minmax(112px, 1fr));
    }
    .calendar-grid.day {
      grid-template-columns: minmax(0, 1fr);
    }
    .calendar-day,
    .calendar-hour {
      min-height: 82px;
      align-content: start;
    }
    .calendar-day.today {
      border-color: color-mix(in srgb, var(--accent) 58%, var(--line));
      background: color-mix(in srgb, var(--accent) 8%, var(--panel-2));
    }
    .calendar-hour {
      grid-template-columns: 52px minmax(0, 1fr);
      align-items: start;
    }
    .calendar-hour b {
      padding-top: 2px;
      color: var(--muted);
    }
    .calendar-hour-events {
      display: grid;
      gap: 5px;
      min-width: 0;
    }
    .calendar-event {
      width: 100%;
      text-align: left;
      padding: 6px 7px;
      border-radius: 6px;
      background: var(--field);
    }
    .calendar-event-job { border-color: color-mix(in srgb, var(--accent) 48%, var(--line)); }
    .calendar-event-mission { border-color: color-mix(in srgb, var(--ok) 42%, var(--line)); }
    .calendar-event-task { border-color: color-mix(in srgb, var(--warn) 42%, var(--line)); }
    .calendar-event-approval { border-color: color-mix(in srgb, var(--bad) 42%, var(--line)); }
    .calendar-more {
      color: var(--muted);
      font-size: 11px;
      padding: 0 2px;
    }
    .checkpoint-form {
      display: grid;
      gap: 8px;
    }
    .checkpoint-form textarea {
      min-height: 96px;
      font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .checkpoint-list {
      display: grid;
      gap: 8px;
      max-height: 260px;
      overflow: auto;
    }
    .checkpoint {
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--panel-2);
      padding: 9px;
      display: grid;
      gap: 6px;
    }
    .checkpoint p {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .roadmap {
      display: grid;
      gap: 8px;
      max-height: 280px;
      overflow: auto;
    }
    .roadmap-summary {
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--panel);
      padding: 9px;
      display: grid;
      gap: 6px;
      font-size: 11px;
      color: var(--muted);
    }
    .roadmap-summary strong {
      color: var(--text);
      font-size: 12px;
    }
    .roadmap-counts {
      display: flex;
      gap: 5px;
      flex-wrap: wrap;
    }
    .roadmap-item {
      border: 1px solid var(--line);
      border-radius: 7px;
      background: var(--panel-2);
      padding: 9px;
      display: grid;
      gap: 5px;
    }
    .roadmap-item b {
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .roadmap-item span {
      color: var(--muted);
      font-size: 11px;
      overflow-wrap: anywhere;
    }
    .toast-stack {
      position: fixed;
      top: 72px;
      right: 14px;
      z-index: 20;
      display: grid;
      gap: 8px;
      width: min(360px, calc(100vw - 28px));
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      border: 1px solid var(--line-strong);
      border-left: 4px solid var(--accent);
      border-radius: 8px;
      background: color-mix(in srgb, var(--panel) 96%, transparent);
      box-shadow: 0 16px 36px var(--shadow);
      padding: 10px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      animation: toast-in .16s ease-out;
    }
    .toast b,
    .toast span {
      overflow-wrap: anywhere;
    }
    .toast b {
      font-size: 12px;
    }
    .toast span {
      color: var(--muted);
      font-size: 11px;
    }
    .toast.complete { border-left-color: var(--ok); }
    .toast.failed { border-left-color: var(--bad); }
    .toast.alert { border-left-color: var(--warn); }
    .toast.chat,
    .toast.spawned,
    .toast.model { border-left-color: var(--accent); }
    .toast button {
      min-height: 24px;
      padding: 2px 7px;
      font-size: 11px;
    }
    .mobile-page-header {
      position: sticky;
      top: 0;
      z-index: 22;
      display: none;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 9px 10px;
      border-bottom: 1px solid var(--line);
      background: color-mix(in srgb, var(--bg) 95%, transparent);
      backdrop-filter: blur(12px);
    }
    .mobile-page-header b,
    .mobile-page-header span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mobile-page-header b {
      display: block;
      font-size: 13px;
      line-height: 1.1;
    }
    .mobile-page-header span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      margin-top: 2px;
    }
    .mobile-header-actions {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      flex: 0 0 auto;
    }
    .mobile-hamburger {
      width: 38px;
      min-height: 34px;
      display: grid;
      place-items: center;
      padding: 0;
    }
    .mobile-hamburger span,
    .mobile-hamburger::before,
    .mobile-hamburger::after {
      content: "";
      display: block;
      width: 16px;
      height: 2px;
      border-radius: 999px;
      background: currentColor;
    }
    .mobile-hamburger span {
      box-shadow: 0 5px 0 currentColor, 0 -5px 0 currentColor;
    }
    .mobile-drawer-backdrop {
      position: fixed;
      inset: 0;
      z-index: 50;
      display: none;
      background: rgba(8, 12, 18, .48);
      backdrop-filter: blur(8px);
    }
    .mobile-drawer-backdrop.open { display: block; }
    .mobile-sessions-panel {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      width: min(390px, 92vw);
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      gap: 10px;
      border-right: 1px solid var(--line-strong);
      background: var(--panel);
      box-shadow: 24px 0 54px var(--shadow);
      padding: 12px;
      transform: translateX(-100%);
      transition: transform .18s ease;
    }
    .mobile-drawer-backdrop.open .mobile-sessions-panel { transform: translateX(0); }
    .mobile-drawer-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
    }
    .mobile-drawer-head h2 {
      margin: 0;
      font-size: 14px;
    }
    .mobile-session-list {
      display: grid;
      gap: 8px;
      overflow: auto;
      padding-bottom: 8px;
    }
    .mobile-session-card {
      width: 100%;
      display: grid;
      gap: 4px;
      text-align: left;
      background: var(--panel-2);
    }
    .mobile-session-card.active {
      border-color: var(--accent);
      background: color-mix(in srgb, var(--accent) 11%, var(--panel));
    }
    .mobile-session-card b,
    .mobile-session-card span {
      overflow-wrap: anywhere;
    }
    .mobile-session-card span {
      color: var(--muted);
      font-size: 11px;
    }
    .mobile-tabbar {
      position: fixed;
      left: 10px;
      right: 10px;
      bottom: 10px;
      z-index: 18;
      display: none;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 6px;
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      background: color-mix(in srgb, var(--panel) 96%, transparent);
      box-shadow: 0 18px 42px var(--shadow);
      padding: 6px;
      transition: transform .18s ease, opacity .18s ease;
    }
    .mobile-tabbar button {
      min-height: 38px;
      padding: 5px 4px;
      display: grid;
      place-items: center;
      gap: 2px;
      font-size: 10px;
      border-radius: 7px;
    }
    .mobile-tabbar button b {
      font-size: 14px;
      line-height: 1;
      font-weight: 800;
    }
    .mobile-tabbar button.active {
      color: #fff;
      background: var(--accent);
      border-color: var(--accent);
    }
    body[data-mobile-nav-mode="integrated"] .mobile-tabbar {
      left: 6px;
      right: 6px;
      bottom: 6px;
      border-radius: 999px;
      padding: 5px;
    }
    body[data-mobile-nav-mode="scroll-hide"].mobile-nav-hidden .mobile-tabbar {
      transform: translateY(120%);
      opacity: 0;
      pointer-events: none;
    }
    @keyframes toast-in {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .status-chip {
      justify-self: start;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 2px 7px;
      font-size: 10px;
      color: var(--muted);
      background: var(--panel);
    }
    .status-chip.implemented {
      color: var(--ok);
      border-color: color-mix(in srgb, var(--ok) 42%, var(--line));
    }
    .status-chip.partial {
      color: var(--warn);
      border-color: color-mix(in srgb, var(--warn) 42%, var(--line));
    }
    .status-chip.plugin-implemented {
      color: var(--ok);
      border-color: color-mix(in srgb, var(--ok) 42%, var(--line));
    }
    .status-chip.host-provided {
      color: #78a6ff;
      border-color: color-mix(in srgb, #78a6ff 42%, var(--line));
    }
    .status-chip.capability-gated {
      color: var(--warn);
      border-color: color-mix(in srgb, var(--warn) 42%, var(--line));
    }
    .status-chip.out-of-scope-for-plugin {
      color: var(--muted);
      border-color: color-mix(in srgb, var(--muted) 42%, var(--line));
    }
    .status-chip.missing,
    .status-chip.blocked {
      color: var(--danger);
      border-color: color-mix(in srgb, var(--danger) 42%, var(--line));
    }
    .log {
      min-height: 230px;
      max-height: 330px;
      overflow: auto;
      margin: 0;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #081014;
      color: #d7e8e8;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .terminal-bar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) repeat(4, auto);
      gap: 8px;
    }
    .terminal-frame {
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      overflow: hidden;
      background: #050b0e;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, .05);
    }
    .terminal-titlebar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 7px 9px;
      color: #a8c4c4;
      background: rgba(255, 255, 255, .06);
      font: 11px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .terminal-dots {
      display: inline-flex;
      gap: 5px;
      align-items: center;
    }
    .terminal-dots span {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #ff6b6b;
    }
    .terminal-dots span:nth-child(2) { background: #f8c555; }
    .terminal-dots span:nth-child(3) { background: #4dd27e; }
    .terminal-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .terminal-output {
      min-height: 150px;
      max-height: 270px;
      overflow: auto;
      background: #050b0e;
      color: #d7e8e8;
      padding: 10px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .terminal-output .ansi-dim { color: #789196; }
    .terminal-output .ansi-red { color: #ff8a8a; }
    .terminal-output .ansi-green { color: #86efac; }
    .terminal-output .ansi-yellow { color: #fde68a; }
    .terminal-output .ansi-blue { color: #93c5fd; }
    .terminal-output .ansi-magenta { color: #d8b4fe; }
    .terminal-output .ansi-cyan { color: #67e8f9; }
    .terminal-output .ansi-bold { font-weight: 700; }
    .terminal-status {
      margin-top: 8px;
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .empty {
      min-height: 64px;
      display: grid;
      place-items: center;
      border: 1px dashed var(--line-strong);
      border-radius: 7px;
      color: var(--muted);
      font-size: 12px;
      text-align: center;
      padding: 10px;
    }
    .kbd {
      font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      color: var(--muted);
    }
    @media (max-width: 1180px) {
      .main { grid-template-columns: 320px minmax(0, 1fr); }
      .right { grid-column: 1 / -1; }
    }
    @media (max-width: 820px) {
      .mobile-page-header { display: flex; }
      .topbar { align-items: flex-start; flex-direction: column; display: none; }
      .toolbar { justify-content: flex-start; }
      .command-wrap { min-width: 100%; }
      .main { grid-template-columns: 1fr; padding: 10px 10px 74px; }
      .board { grid-template-columns: 1fr; }
      .board-toolbar { grid-template-columns: 1fr; }
      .lane { min-height: 180px; }
      .segments { grid-template-columns: repeat(2, 1fr); }
      .split { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .terminal-bar { grid-template-columns: 1fr; }
      .shortcut-grid { grid-template-columns: 1fr; }
      .artifact-preview-head { align-items: flex-start; flex-direction: column; }
      .mobile-tabbar { display: grid; }
      .toast-stack { top: auto; bottom: 78px; right: 10px; }
    }
  </style>
</head>
<body data-hana-theme="${escapeAttr(theme)}" data-hermes-route="${escapeAttr(pageAlias.route)}" data-hermes-section="${escapeAttr(pageAlias.section)}">
  <div id="toastStack" class="toast-stack" aria-live="polite" aria-atomic="false"></div>
  <header id="mobilePageHeader" class="mobile-page-header" aria-label="Mobile workbench header">
    <div>
      <b>Hanaco 工作台</b>
      <span id="mobileHeaderSubtitle">选择 session 后开始调度</span>
    </div>
    <div class="mobile-header-actions">
      <button id="mobileSearchBtn" class="mini" type="button" title="聚焦全局搜索">搜索</button>
      <button id="mobileSessionsBtn" class="mobile-hamburger" type="button" aria-controls="mobileSessionsDrawer" aria-expanded="false" title="打开移动会话面板"><span></span></button>
    </div>
  </header>
  <div id="mobileSessionsDrawer" class="mobile-drawer-backdrop" aria-hidden="true">
    <aside class="mobile-sessions-panel" role="dialog" aria-modal="true" aria-labelledby="mobileSessionsTitle">
      <div class="mobile-drawer-head">
        <div>
          <h2 id="mobileSessionsTitle">Sessions</h2>
          <span id="mobileSessionsMeta" class="tag">0 sessions</span>
        </div>
        <button id="mobileSessionsCloseBtn" class="mini" type="button">关闭</button>
      </div>
      <label class="label"><span>搜索会话</span><input id="mobileSessionSearchInput" placeholder="标题、别名、路径、agent、model" /></label>
      <div id="mobileSessionList" class="mobile-session-list"></div>
    </aside>
  </div>
  <nav id="mobileTabBar" class="mobile-tabbar" aria-label="Mobile workbench navigation">
    <button type="button" data-target="mobileSectionControl"><b>⌂</b><span>控制</span></button>
    <button type="button" data-target="mobileSectionConductor"><b>▶</b><span>任务</span></button>
    <button type="button" data-target="board"><b>▦</b><span>看板</span></button>
    <button type="button" data-target="mobileSectionRuntime"><b>◌</b><span>运行</span></button>
    <button type="button" data-target="mobileSectionFiles"><b>⌁</b><span>文件</span></button>
    <button type="button" data-target="terminalOutput"><b>⌘</b><span>终端</span></button>
  </nav>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <div class="mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M4 12h16M4 17h10"/><circle cx="18" cy="17" r="2.4"/></svg>
        </div>
        <div>
          <h1>Hanaco 智能体工作台</h1>
          <small>Agent Workbench</small>
        </div>
      </div>
      <div class="toolbar">
        <div class="command-wrap">
          <input id="globalSearchInput" class="command-input" placeholder="搜索 missions、tasks、memory、files、jobs、integrations" />
          <span class="command-key kbd">⌘K</span>
          <div id="globalSearchPanel" class="command-panel"></div>
        </div>
        <span class="status-pill"><span id="busDot" class="dot"></span><span id="busStatus">连接中</span></span>
        <button id="refreshBtn">刷新</button>
        <button id="saveDefaultsBtn">设为默认</button>
        <button id="onboardingTourBtn" title="打开工作台引导">引导</button>
        <button id="shortcutHelpBtn" title="打开快捷键帮助">快捷键</button>
      </div>
    </header>

    <section id="hermesRouteBanner" class="hermes-route-banner" data-hermes-route="${escapeAttr(pageAlias.route)}" data-hermes-target="${escapeAttr(pageAlias.target)}">
      <div>
        <b>Hermes 页面兼容入口：${escapeHtmlText(pageAlias.label)} <span class="tag">${escapeHtmlText(pageAlias.route)}</span></b>
        <span>${escapeHtmlText(pageAlias.note)}</span>
      </div>
      <button id="hermesRouteJumpBtn" class="mini" type="button">跳到对应区域</button>
    </section>

    <section id="connectionBanner" class="connection-banner" aria-live="polite">
      <div>
        <b id="connectionBannerTitle">Checking OpenHanako runtime</b>
        <span id="connectionBannerDetail">正在探测 session、model、memory、terminal 和 workspace 能力。</span>
      </div>
      <div class="actions">
        <button id="connectionRetryBtn" class="mini" type="button">重试</button>
        <button id="connectionDoctorBtn" class="mini" type="button">Setup Doctor</button>
      </div>
    </section>

    <main class="main">
      <section id="mobileSectionControl" class="panel left">
        <div class="panel-head">
          <h2 class="panel-title">控制台</h2>
          <span class="tag" id="selectedAgentTag">未选择</span>
        </div>
        <div class="panel-body">
          <div class="metrics">
            <div class="metric"><b id="agentCount">0</b><span>智能体</span></div>
            <div class="metric"><b id="sessionCount">0</b><span>会话</span></div>
            <div class="metric"><b id="taskCount">0</b><span>任务</span></div>
          </div>
          <label class="label"><span>智能体</span><select id="agentSelect"></select></label>
          <label class="label"><span>目标会话</span><select id="sessionSelect"></select></label>
          <label class="label"><span>搜索会话</span><input id="sessionSearchInput" placeholder="按标题、别名、路径或 agent 过滤" /></label>
          <div class="actions">
            <button id="reloadSessionsBtn">更新会话</button>
            <button id="pinSessionBtn">Pin 会话</button>
            <button id="pinModelBtn">Pin 模型</button>
            <button id="clearDoneBtn">清空已完成</button>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>当前会话</span></div>
            <div id="sessionDetail" class="item"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Pinned</span></div>
            <div class="actions" style="margin-bottom:8px">
              <button id="exportPinnedSessionsBtn">导出 Pinned</button>
            </div>
            <div id="pinnedPanel" class="list"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Modes</span></div>
            <div class="split" style="margin-bottom:8px">
              <input id="workbenchModeNameInput" placeholder="例如 Review Focus" />
              <select id="workbenchModeSelect"><option value="">选择 Mode</option></select>
            </div>
            <div class="actions" style="margin-bottom:8px">
              <button id="saveWorkbenchModeBtn">保存 Mode</button>
              <button id="applyWorkbenchModeBtn" class="primary">应用</button>
              <button id="renameWorkbenchModeBtn">重命名</button>
              <button id="deleteWorkbenchModeBtn" class="danger">删除</button>
            </div>
            <div id="workbenchModePanel" class="list"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Notifications</span></div>
            <div class="grid compact-grid" style="margin-bottom:8px">
              <label class="label"><span>声音</span><select id="notificationEnabledSelect"><option value="true">开启</option><option value="false">关闭</option></select></label>
              <label class="label"><span>音量</span><input id="notificationVolumeInput" type="number" min="0" max="1" step="0.05" /></label>
              <label class="label"><span>浏览器通知</span><select id="notificationBrowserSelect"><option value="false">关闭</option><option value="true">开启</option></select></label>
              <label class="label"><span>触觉</span><select id="notificationHapticsSelect"><option value="true">开启</option><option value="false">关闭</option></select></label>
            </div>
            <div class="actions" style="margin-bottom:8px">
              <button id="saveNotificationsBtn">保存通知</button>
              <button id="testNotificationBtn">测试</button>
            </div>
            <div id="notificationPanel" class="list"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Settings</span></div>
            <div class="grid compact-grid" style="margin-bottom:8px">
              <label class="label"><span>主题预设</span><select id="workbenchThemePresetSelect"><option value="hermes">Hermes</option><option value="claude-official">Claude Official</option><option value="claude-official-light">Claude Official Light</option><option value="claude-classic">Claude Classic</option><option value="classic-light">Classic Light</option><option value="slate">Slate</option><option value="slate-light">Slate Light</option><option value="mono">Mono</option><option value="mono-light">Mono Light</option></select></label>
              <label class="label"><span>主题</span><select id="workbenchThemeSelect"><option value="system">system</option><option value="light">light</option><option value="dark">dark</option></select></label>
              <label class="label"><span>强调色</span><select id="workbenchAccentSelect"><option value="blue">blue</option><option value="green">green</option><option value="orange">orange</option><option value="purple">purple</option><option value="mono">mono</option></select></label>
              <label class="label"><span>编辑字号</span><input id="editorFontSizeInput" type="number" min="11" max="22" step="1" /></label>
              <label class="label"><span>换行</span><select id="editorWordWrapSelect"><option value="true">开启</option><option value="false">关闭</option></select></label>
              <label class="label"><span>Minimap</span><select id="editorMinimapSelect"><option value="false">关闭</option><option value="true">开启</option></select></label>
              <label class="label"><span>用量阈值</span><input id="usageThresholdInput" type="number" min="50" max="95" step="5" /></label>
              <label class="label"><span>指标页脚</span><select id="systemMetricsFooterSelect"><option value="false">关闭</option><option value="true">开启</option></select></label>
              <label class="label"><span>移动导航</span><select id="mobileNavModeSelect"><option value="dock">dock</option><option value="integrated">integrated</option><option value="scroll-hide">scroll-hide</option></select></label>
              <label class="label"><span>Calendar TZ</span><input id="calendarTimezoneInput" placeholder="local / UTC / Asia/Shanghai" /></label>
            </div>
            <div class="actions" style="margin-bottom:8px">
              <button id="saveWorkbenchSettingsBtn">保存设置</button>
              <button id="resetWorkbenchSettingsBtn">重置</button>
            </div>
            <div id="workbenchSettingsPanel" class="list"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Provider Setup</span></div>
            <div class="actions" style="margin-bottom:8px">
              <button id="refreshProviderSetupBtn">刷新 Provider</button>
              <button id="openProviderModelChooserBtn">选择模型</button>
              <button id="copyProviderSetupBtn">复制配置片段</button>
              <button id="reprobeProviderSetupBtn">重新探测</button>
            </div>
            <div id="providerSetupPanel" class="provider-setup-grid"></div>
          </div>
        </div>
      </section>

      <section id="mobileSectionConductor" class="panel center">
        <div class="panel-head">
          <h2 class="panel-title">Conductor 指挥台</h2>
          <span class="tag" id="activeMissionTag">No mission</span>
        </div>
        <div class="panel-body">
          <div class="conductor-stage">
            <div class="conductor-hero">
              <div>
                <span class="conductor-kicker"><span class="dot ok"></span>CONDUCTOR</span>
                <p class="conductor-title">Launch a mission and watch your agent team build it live.</p>
              </div>
              <div class="actions">
                <button id="dispatchMissionBtn" class="primary" title="投递当前 mission assignments">启动</button>
                <button id="broadcastMissionBtn" title="按 roster acceptsBroadcast 向 worker 广播补充指令">Broadcast</button>
                <button id="swarmLaunchBtn" title="为每个 assignment 创建独立 worker session">Swarm</button>
                <button id="completeMissionBtn" title="标记完成">完成</button>
                <button id="stopMissionBtn" class="danger" title="停止当前 mission">停止</button>
                <button id="continueMissionBtn" title="基于当前 mission 继续">继续</button>
                <button id="copyPromptBtn" title="复制当前指挥 Prompt">复制 Prompt</button>
              </div>
            </div>
            <div id="officeView" class="office" aria-label="Agent office view"></div>
            <div id="missionDrop" class="mission-drop">No missions yet.<br>Launch your first mission and it will appear here.</div>
            <div class="progress" aria-label="Mission progress"><span id="missionProgressBar"></span></div>
            <div class="metrics">
              <div class="metric"><b id="missionProgress">0%</b><span>完成度</span></div>
              <div class="metric"><b id="missionActiveWorkers">0</b><span>活动 worker</span></div>
              <div class="metric"><b id="missionCost">$0.000</b><span>估算成本</span></div>
            </div>
            <div id="assignmentList" class="assignment-list"></div>
          </div>
          <div id="templateSegments" class="segments"></div>
          <div class="split" style="margin-bottom:8px">
            <label class="label"><span>Workflow 模板</span><select id="workflowTemplateSelect"><option value="">选择 Workflow</option></select></label>
            <div class="actions" style="align-self:end">
              <button id="loadWorkflowTemplatesBtn" class="mini">刷新 Workflow</button>
              <button id="previewWorkflowBtn" class="mini">预览</button>
              <button id="executeWorkflowBtn" class="primary">执行为 Mission</button>
            </div>
          </div>
          <div id="workflowPreviewPanel" class="list" style="margin-bottom:8px;display:none"></div>
          <label class="label"><span>Mission</span>
            <div class="slash-wrap">
              <textarea id="missionInput" placeholder="写下要交给智能体团队处理的目标，输入 / 打开快捷命令"></textarea>
              <button id="voiceInputBtn" class="mini voice-button" type="button" title="语音输入 Mission">Mic</button>
              <span id="voiceInputStatus" class="voice-status">voice ready</span>
              <div id="slashCommandPanel" class="slash-panel"></div>
            </div>
            <div class="composer-tools">
              <button id="attachMissionFilesBtn" class="mini" type="button" title="把本地文件作为 Mission 上下文">附件</button>
              <button id="clearMissionAttachmentsBtn" class="mini" type="button" title="清空 Mission 附件">清空附件</button>
              <span id="missionAttachmentStatus" class="tag">0 attachments</span>
            </div>
            <input id="missionAttachmentInput" type="file" multiple style="display:none" />
            <div id="missionAttachmentList" class="attachment-list"></div>
          </label>
          <div class="split">
            <label class="label"><span>补充上下文</span><input id="notesInput" placeholder="路径、约束、输出格式、验收标准" /></label>
            <label class="label"><span>模式</span>
              <select id="modeSelect">
                <option value="dispatch">执行</option>
                <option value="plan">计划</option>
                <option value="review">复核</option>
              </select>
            </label>
          </div>
          <div class="split">
            <label class="label"><span>执行智能体（Agent）</span><select id="conductorAgentSelect"></select></label>
            <label class="label"><span>Worker 数</span>
              <select id="workerCountSelect">
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4" selected>4</option>
                <option value="5">5</option>
              </select>
            </label>
            <div class="actions" style="align-self:end">
              <button id="createMissionBtn" class="primary">新建 Mission</button>
              <button id="draftBtn">加入待办</button>
            </div>
          </div>
        </div>
        <div class="board-toolbar">
          <input id="taskSearchInput" placeholder="搜索任务、描述、标签或 session" />
          <select id="taskAssigneeFilter"><option value="">全部负责人</option></select>
          <select id="taskPriorityFilter"><option value="">全部优先级</option></select>
          <button id="clearTaskFiltersBtn">清除筛选</button>
          <span id="taskFilterStatus" class="tag">all tasks</span>
        </div>
        <div class="bulk-toolbar">
          <select id="boardViewSelect"><option value="">Board views</option></select>
          <button id="saveBoardViewBtn" class="mini">保存视图</button>
          <button id="deleteBoardViewBtn" class="mini danger">删除视图</button>
          <button id="editWipLimitsBtn" class="mini">WIP 限制</button>
          <button id="selectVisibleTasksBtn" class="mini">选择可见</button>
          <button id="clearSelectedTasksBtn" class="mini">取消选择</button>
          <select id="bulkMoveLaneSelect">
            <option value="">批量移动到</option>
            <option value="backlog">待办</option>
            <option value="running">进行中</option>
            <option value="blocked">阻塞</option>
            <option value="review">复核</option>
            <option value="done">完成</option>
          </select>
          <select id="bulkPrioritySelect">
            <option value="">批量优先级</option>
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
          <button id="bulkDeleteTasksBtn" class="mini danger">删除选择</button>
          <span id="bulkTaskStatus" class="tag">0 selected</span>
        </div>
        <div class="board" id="board"></div>
        <div id="mobileSectionFiles" class="panel-body" style="border-top:1px solid var(--line); padding:12px 0 0">
          <div class="panel-head" style="padding:0 0 8px">
            <h2 class="panel-title">Files</h2>
            <span class="tag" id="workspaceFileTag">未加载</span>
          </div>
          <div class="split">
            <label class="label"><span>Root</span><select id="workspaceRootSelect"></select></label>
            <label class="label"><span>Path</span><input id="workspacePathInput" value="." placeholder="相对路径，如 . 或 docs" /></label>
          </div>
          <div class="actions">
            <button id="loadWorkspaceRootsBtn">Roots</button>
            <button id="loadWorkspaceFilesBtn">浏览</button>
            <button id="uploadWorkspaceFileBtn">上传</button>
            <button id="newWorkspaceFileBtn">新建文件</button>
            <button id="mkdirWorkspaceBtn">新建目录</button>
            <button id="renameWorkspaceBtn">重命名</button>
            <button id="deleteWorkspaceBtn" class="danger">删除</button>
            <button id="diffWorkspaceFileBtn">Diff</button>
            <button id="createPatchReviewBtn">Patch Review</button>
            <button id="acceptPatchReviewBtn" class="primary">采纳补丁</button>
            <button id="rejectPatchReviewBtn" class="danger">拒绝补丁</button>
            <button id="downloadWorkspaceFileBtn">下载</button>
            <button id="saveWorkspaceFileBtn" class="primary">保存</button>
          </div>
          <input id="workspaceUploadInput" type="file" style="display:none" />
          <div class="split" style="align-items:start">
            <div id="workspaceFileList" class="list"></div>
            <div>
              <textarea id="workspaceEditor" placeholder="选择文本文件后在这里编辑"></textarea>
              <div id="workspacePreview" class="output-box" style="margin-top:8px">文件预览会显示在这里。</div>
            </div>
          </div>
        </div>
      </section>

      <section id="mobileSectionRuntime" class="panel right">
        <div class="panel-head">
          <h2 class="panel-title">运行视图</h2>
          <span class="tag" id="lastDispatchTag">待命</span>
        </div>
        <div class="panel-body">
          <div>
            <div class="label" style="margin-bottom:6px"><span>Main Session</span></div>
            <div class="actions" style="margin-bottom:8px">
              <button id="loadHistoryBtn">读取历史</button>
              <button id="loadContextUsageBtn">上下文</button>
              <button id="connectEventsBtn">连接实时</button>
              <button id="disconnectEventsBtn">断开</button>
              <button id="syncHistoryBtn">同步 checkpoint</button>
              <button id="suggestSessionTitleBtn">建议标题</button>
              <button id="renameSessionAliasBtn">重命名</button>
              <button id="clearSessionAliasBtn">清除别名</button>
              <button id="forkSessionBtn">Fork 会话</button>
              <button id="hideSessionBtn" class="danger">隐藏会话</button>
              <button id="exportSessionMarkdownBtn">导出 MD</button>
              <button id="exportSessionJsonBtn">导出 JSON</button>
              <button id="exportSessionTextBtn">导出 TXT</button>
              <button id="exportSessionHtmlBtn">导出 HTML</button>
              <button id="exportSessionCsvBtn">导出 CSV</button>
              <button id="exportSessionZipBtn">导出 ZIP</button>
              <button id="abortSessionBtn" class="danger">中止会话</button>
            </div>
            <div id="contextUsagePanel" class="list"></div>
            <div id="sessionTitlePanel" class="list"></div>
            <div id="sessionTombstonePanel" class="list"></div>
            <div id="liveEventList" class="list"></div>
            <div id="sessionHistoryList" class="list"></div>
            <div id="missionHistory" class="list"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Tool Trace</span></div>
            <div class="actions" style="margin-bottom:8px">
              <button id="copyToolTraceBtn">复制轨迹</button>
              <button id="clearLiveTraceBtn">清空实时</button>
            </div>
            <div id="toolTracePanel" class="list"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Mission Events</span></div>
            <div id="missionTimeline" class="timeline"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Recent Swarm Activity</span></div>
            <div class="actions" style="margin-bottom:8px">
              <button id="loadSwarmActivityBtn">刷新 Activity</button>
              <button id="copySwarmActivityBtn">复制 Activity</button>
            </div>
            <div id="swarmActivityPanel" class="list swarm-activity-feed"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Worker Artifacts</span></div>
            <div class="actions" style="margin-bottom:8px">
              <button id="loadWorkerArtifactsBtn">刷新 Artifacts</button>
              <button id="copyWorkerArtifactsBtn">复制 Artifacts</button>
            </div>
            <div id="workerArtifactsPanel" class="list worker-artifacts-view"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Approvals</span></div>
            <div class="actions" style="margin-bottom:8px">
              <button id="loadApprovalsBtn">刷新 Approvals</button>
              <button id="copyApprovalsBtn">复制 Approvals</button>
            </div>
            <div id="approvalsPanel" class="list approvals-queue"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Agenda / Calendar</span></div>
            <div class="actions" style="margin-bottom:8px">
              <button id="loadAgendaBtn">刷新 Agenda</button>
              <button id="loadCalendarBtn">刷新 Calendar</button>
              <button id="copyAgendaBtn">复制 Agenda</button>
            </div>
            <div class="split" style="margin-bottom:8px">
              <label class="label"><span>Calendar Mode</span><select id="calendarModeSelect"><option value="day">Day</option><option value="week" selected>Week</option><option value="month">Month</option></select></label>
              <div class="actions" style="align-items:end">
                <button id="calendarPrevBtn">上一段</button>
                <button id="calendarTodayBtn">Today</button>
                <button id="calendarNextBtn">下一段</button>
              </div>
            </div>
            <div id="calendarRangeLabel" class="muted" style="margin-bottom:8px"></div>
            <div id="agendaPanel" class="list agenda-view"></div>
            <div id="calendarPanel" class="list calendar-view" style="margin-top:8px"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Mission Inbox</span></div>
            <div class="actions" style="margin-bottom:8px">
              <button id="loadMissionInboxBtn">刷新 Inbox</button>
              <button id="copyMissionInboxBtn">复制摘要</button>
            </div>
            <div id="missionInboxPanel" class="list"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Operations</span></div>
            <div class="split" style="margin-bottom:8px">
              <label class="label"><span>Profile</span><select id="operationPresetSelect"></select></label>
              <label class="label"><span>Saved</span><select id="operationProfileSelect"></select></label>
              <label class="label"><span>Workers</span><input id="operationWorkersInput" value="4" /></label>
            </div>
            <label class="label" style="margin-bottom:8px"><span>Profile 名称</span><input id="operationProfileNameInput" placeholder="例如 Hanaco Builder Team" /></label>
            <div class="split" style="margin-bottom:8px">
              <label class="label"><span>可见性</span><select id="operationVisibilitySelect"><option value="private">private</option><option value="workspace">workspace</option><option value="team">team</option><option value="public">public</option></select></label>
              <label class="label"><span>权限</span><input id="operationPermissionsInput" placeholder="dispatch,edit,share,terminal,files" /></label>
            </div>
            <label class="label" style="margin-bottom:8px"><span>共享给</span><input id="operationSharedWithInput" placeholder="user:orlando:owner, team:builder:operator" /></label>
            <div class="actions" style="margin-bottom:8px">
              <button id="loadOperationsBtn">刷新</button>
              <button id="saveOperationProfileBtn">保存 Profile</button>
              <button id="exportOperationProfileBtn">导出 Profile</button>
              <button id="exportSwarmRosterJsonBtn">导出 Roster JSON</button>
              <button id="exportSwarmRosterYamlBtn">导出 Roster YAML</button>
              <button id="applyOperationPresetBtn" class="primary">创建预设 Mission</button>
              <button id="applyOperationProfileBtn" class="primary">创建 Profile Mission</button>
              <button id="deleteOperationProfileBtn" class="danger">删除 Profile</button>
            </div>
            <label class="label" style="margin-bottom:8px"><span>导入 Profile JSON</span><textarea id="operationImportInput" rows="3" placeholder='{"schema":"hanaagent.operationProfile","profile":{...}}'></textarea></label>
            <div class="actions" style="margin-bottom:8px">
              <button id="importOperationProfileBtn">导入 Profile</button>
              <label style="display:flex;gap:6px;align-items:center"><input id="operationImportOverwriteInput" type="checkbox" /> overwrite</label>
            </div>
            <label class="label" style="margin-bottom:8px"><span>导入 Swarm Roster JSON/YAML</span><textarea id="operationRosterImportInput" rows="4" placeholder="version: 1&#10;workers:&#10;- id: builder&#10;  name: Builder&#10;  role: Scoped Implementation Agent"></textarea></label>
            <div class="actions" style="margin-bottom:8px">
              <button id="importSwarmRosterBtn">导入 Roster</button>
              <input id="operationRosterNameInput" placeholder="Roster profile 名称" />
            </div>
            <div id="operationsPanel" class="list"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Setup Doctor</span></div>
            <div class="actions" style="margin-bottom:8px">
              <button id="startOnboardingBtn">打开引导</button>
              <button id="resetOnboardingBtn">重置引导</button>
            </div>
            <div id="setupDoctorPanel" class="list"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Autopilot</span></div>
            <div class="actions" style="margin-bottom:8px">
              <button id="autopilotPreviewBtn">巡检建议</button>
              <button id="autopilotRunBtn">执行巡检</button>
              <button id="autopilotTickBtn">后台 Tick</button>
              <button id="loadAutopilotBtn">历史</button>
            </div>
            <div class="actions" style="margin-bottom:8px">
              <button id="startAutopilotLoopBtn">启动 Loop</button>
              <button id="pauseAutopilotLoopBtn">暂停</button>
              <button id="resumeAutopilotLoopBtn">恢复</button>
              <button id="stopAutopilotLoopBtn">停止</button>
            </div>
            <div class="split" style="margin-bottom:8px">
              <label class="label"><span>后台模式</span>
                <select id="autopilotScheduleMode">
                  <option value="preview">preview</option>
                  <option value="run">run</option>
                </select>
              </label>
              <label class="label"><span>间隔分钟</span><input id="autopilotIntervalInput" value="15" /></label>
              <label class="label"><span>Loop 轮数</span><input id="autopilotLoopIterationsInput" value="12" /></label>
              <label class="label"><span>升级阈值</span><input id="autopilotEscalationInput" value="3" /></label>
            </div>
            <div class="actions" style="margin-bottom:8px">
              <button id="enableAutopilotScheduleBtn">启用后台</button>
              <button id="disableAutopilotScheduleBtn">停用后台</button>
              <button id="loadAutopilotScheduleBtn">状态</button>
            </div>
            <div id="autopilotPanel" class="list"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Jobs / Scheduled Automation</span></div>
            <div class="split" style="margin-bottom:8px">
              <input id="jobTitleInput" placeholder="Job title，例如 Morning autopilot" />
              <select id="jobTypeSelect">
                <option value="autopilot-tick">Autopilot Tick</option>
                <option value="mission-autopilot">Mission Autopilot</option>
                <option value="dispatch-prompt">Dispatch Prompt</option>
              </select>
            </div>
            <div class="split" style="margin-bottom:8px">
              <input id="jobScheduleInput" placeholder="manual、hourly、daily 或 */15 * * * *" />
              <select id="jobModeSelect">
                <option value="preview">preview</option>
                <option value="run">run</option>
              </select>
            </div>
            <textarea id="jobPromptInput" placeholder="dispatch-prompt 类型可填写要定时投递的 prompt"></textarea>
            <div class="actions" style="margin:8px 0">
              <button id="createJobBtn" class="primary">创建 Job</button>
              <button id="loadJobsBtn">刷新 Jobs</button>
            </div>
            <div id="jobPanel" class="list"></div>
            <div id="jobOutputPanel" class="output-box" style="margin-top:8px">选择 Job 输出。</div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Full Outputs</span></div>
            <div class="actions output-filter-bar" style="margin-bottom:8px">
              <button class="mini output-filter active" type="button" data-output-filter="all">All</button>
              <button class="mini output-filter" type="button" data-output-filter="ok">Success</button>
              <button class="mini output-filter" type="button" data-output-filter="error">Errors</button>
              <button class="mini output-filter" type="button" data-output-filter="running">Running</button>
              <button id="loadAgentOutputsBtn">刷新 Outputs</button>
              <button id="copyAgentOutputsBtn">复制 Outputs</button>
            </div>
            <div id="agentOutputsPanel" class="list full-outputs-view"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Review Gate</span></div>
            <div class="actions" style="margin-bottom:8px">
              <button id="reviewGateBtn">运行门禁</button>
              <button id="recordReviewGateBtn">记录门禁</button>
              <button id="copyReviewGateBtn">复制结论</button>
              <button id="forceCompleteMissionBtn" class="danger">强制完成</button>
            </div>
            <div id="reviewGatePanel" class="list"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Worker Output</span></div>
            <div class="actions" style="margin-bottom:8px">
              <button id="loadReportBtn">生成报告</button>
              <button id="copyReportBtn">复制报告</button>
              <button id="downloadReportBtn">导出 Markdown</button>
              <button id="recordReportArtifactBtn">记录报告产物</button>
              <button id="buildResearchCardBtn">研究卡片</button>
            </div>
            <div class="worker-output-wrap">
              <div id="workerOutput" class="output-box message-preview empty">
                <div class="chat-empty-state">
                  <b>准备接收智能体输出</b>
                  <span>读取 session history、连接实时事件或启动 mission 后，这里会显示 Markdown、代码块、tool pills 和 checkpoint。</span>
                </div>
              </div>
              <button id="workerOutputScrollBtn" class="mini scroll-bottom-button" type="button" title="滚动到最新输出">↓ 最新</button>
            </div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Research Card</span></div>
            <div class="actions" style="margin-bottom:8px">
              <button id="refreshResearchCardBtn">刷新卡片</button>
              <button id="copyResearchCardBtn">复制卡片</button>
              <button id="saveResearchMemoryBtn">保存到 Memory</button>
              <button id="recordResearchArtifactBtn">记录产物</button>
            </div>
            <div id="researchCardPanel" class="list"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Inspector</span></div>
            <div id="inspectorPanel" class="inspector-panel"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>智能体列表</span></div>
            <div id="agentList" class="list"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Worker Drilldown</span></div>
            <div id="workerDrilldownPanel" class="list"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Agent Runtime</span></div>
            <div class="actions" style="margin-bottom:8px">
              <button id="loadAgentConfigBtn">读取配置</button>
              <button id="suggestModelBtn">建议模型</button>
              <button id="openModelChooserBtn">选择模型</button>
              <button id="saveAgentProfileBtn">保存 Profile</button>
              <button id="loadAgentSkillsBtn">Skills</button>
              <button id="loadUsageBtn">读取用量</button>
              <button id="loadHostCheckpointsBtn">宿主 checkpoint</button>
            </div>
            <div class="grid compact-grid">
              <label class="label"><span>名称</span><input id="agentProfileNameInput" placeholder="Agent display name" /></label>
              <label class="label"><span>模型</span><input id="agentProfileModelInput" placeholder="例如 gpt-5-mini" /></label>
              <label class="label"><span>Memory</span><select id="agentProfileMemorySelect"><option value="">沿用宿主</option><option value="enabled">开启</option><option value="disabled">关闭</option></select></label>
              <label class="label"><span>User Profile</span><select id="agentProfileUserProfileSelect"><option value="">沿用宿主</option><option value="enabled">开启</option><option value="disabled">关闭</option></select></label>
              <label class="label"><span>Max Turns</span><input id="agentProfileMaxTurnsInput" type="number" min="1" max="100" placeholder="50" /></label>
              <label class="label"><span>Gateway Timeout</span><input id="agentProfileGatewayTimeoutInput" type="number" min="10" max="600" placeholder="120" /></label>
              <label class="label"><span>Tool Use</span><select id="agentProfileToolUseSelect"><option value="">auto</option><option value="auto">auto</option><option value="required">required</option><option value="none">none</option></select></label>
              <label class="label"><span>Skills</span><input id="agentProfileSkillsInput" placeholder="review, build, research" /></label>
            </div>
            <div id="agentConfigPanel" class="list"></div>
            <div id="modelSuggestionPanel" class="list"></div>
            <div id="agentSkillsPanel" class="list"></div>
            <div id="usagePanel" class="list"></div>
            <div id="hostCheckpointPanel" class="list"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Integration Catalog</span></div>
            <div class="integration-toolbar">
              <input id="integrationSearchInput" placeholder="搜索 MCP、skills、插件或 capability" />
              <select id="integrationKindSelect">
                <option value="">全部类型</option>
                <option value="mcp">MCP</option>
                <option value="skill">Skills</option>
                <option value="plugin">Plugins</option>
                <option value="capability">Capabilities</option>
              </select>
              <button id="loadIntegrationsBtn">刷新目录</button>
            </div>
            <div id="integrationCatalogPanel" class="list"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Memory / Knowledge</span></div>
            <div class="actions memory-tabs" role="tablist" aria-label="Memory and Knowledge views" style="margin-bottom:8px">
              <button id="memoryTabMemoryBtn" class="mini primary" type="button" role="tab" aria-selected="true">Memory</button>
              <button id="memoryTabKnowledgeBtn" class="mini" type="button" role="tab" aria-selected="false">Knowledge</button>
            </div>
            <div class="actions" style="margin-bottom:8px">
              <button id="loadMemoryBtn">读取记忆</button>
              <button id="searchMemoryBtn">搜索</button>
              <button id="saveMemoryBtn" class="primary">保存记忆</button>
              <button id="deleteMemoryBtn" class="danger">删除本地记忆</button>
              <button id="loadKnowledgeBtn">读取 Knowledge</button>
              <button id="graphKnowledgeBtn">图谱</button>
            </div>
            <input id="memoryQueryInput" placeholder="memory / knowledge query，可留空" />
            <div id="memoryBrowserPane" style="margin-top:8px">
              <input id="memoryTitleInput" placeholder="本地记忆标题" />
              <input id="memorySummaryInput" placeholder="摘要，可留空" style="margin-top:8px" />
              <textarea id="memoryEditor" placeholder="选择或新建本地记忆后在这里编辑 Markdown" style="margin-top:8px"></textarea>
              <div id="memoryPanel" class="list" style="margin-top:8px"></div>
            </div>
            <div id="knowledgeBrowserPane" style="display:none;margin-top:8px">
              <div id="knowledgePanel" class="list"></div>
              <div id="knowledgeGraphPanel" class="list" style="margin-top:8px"></div>
            </div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Run Console</span></div>
            <div class="actions" style="margin-bottom:8px">
              <button id="addArtifactBtn">记录产物</button>
              <button id="addApprovalBtn">请求审批</button>
              <button id="addLearningBtn">沉淀经验</button>
              <button id="loadRunRecordsBtn">刷新</button>
            </div>
            <div class="split" style="margin-bottom:8px">
              <label class="label"><span>经验分类</span>
                <select id="runLearningFilterSelect">
                  <option value="all">all</option>
                  <option value="success">success</option>
                  <option value="failure">failure</option>
                  <option value="optimization">optimization</option>
                </select>
              </label>
              <label class="label"><span>Run A</span><select id="runCompareASelect"></select></label>
              <label class="label"><span>Run B</span><select id="runCompareBSelect"></select></label>
            </div>
            <div class="actions" style="margin-bottom:8px">
              <button id="loadRunLearningsBtn">刷新 Learnings</button>
              <button id="addCategorizedLearningBtn">添加分类经验</button>
              <button id="compareRunsBtn">Compare Runs</button>
              <button id="copyRunCompareBtn">复制对比</button>
            </div>
            <div id="artifactPreviewPanel" class="artifact-preview-panel" aria-live="polite"></div>
            <div id="runRecordPanel" class="list"></div>
            <div id="runLearningsPanel" class="list" style="margin-top:8px"></div>
            <div id="runComparePanel" class="list" style="margin-top:8px"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Session Lifecycle</span></div>
            <div class="actions" style="margin-bottom:8px">
              <button id="createSessionBtn">创建 worker session</button>
              <button id="loadSessionStatusBtn">读取状态</button>
              <button id="revertSessionTurnBtn" class="danger">回退最近一轮</button>
            </div>
            <div id="sessionLifecyclePanel" class="list"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Host Jobs</span></div>
            <div class="actions" style="margin-bottom:8px">
              <button id="loadHostTasksBtn">刷新任务</button>
              <button id="registerHostTaskBtn">注册任务</button>
              <button id="loadDeferredTasksBtn">Deferred</button>
            </div>
            <div id="hostTaskPanel" class="list"></div>
            <div id="deferredTaskPanel" class="list"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Session Terminal</span></div>
            <div class="terminal-bar">
              <input id="terminalCwdInput" placeholder="cwd，例如当前项目路径" />
              <button id="terminalStartBtn">启动</button>
              <button id="terminalRefreshBtn">读取</button>
              <button id="terminalAutoBtn">Auto</button>
              <button id="terminalCloseBtn" class="danger">关闭</button>
            </div>
            <div class="terminal-bar" style="grid-template-columns: 1fr auto; margin-top:8px">
              <input id="terminalCommandInput" placeholder="输入命令，回车发送" />
              <button id="terminalSendBtn">发送</button>
            </div>
            <div class="terminal-actions">
              <button id="terminalPwdBtn" class="mini" type="button">pwd</button>
              <button id="terminalLsBtn" class="mini" type="button">ls</button>
              <button id="terminalGitStatusBtn" class="mini" type="button">git status</button>
              <button id="terminalClearBtn" class="mini" type="button">清屏</button>
              <button id="terminalCopyBtn" class="mini" type="button">复制输出</button>
            </div>
            <div id="terminalStatus" class="terminal-status">detached</div>
            <div id="terminalFrame" class="terminal-frame">
              <div class="terminal-titlebar">
                <span class="terminal-dots" aria-hidden="true"><span></span><span></span><span></span></span>
                <span id="terminalTitle">HanaAgent TUI</span>
                <span id="terminalSeqBadge">seq 0</span>
              </div>
              <div id="terminalOutput" class="terminal-output terminal-screen">Terminal 需要宿主 terminal:* 能力和目标 session。</div>
            </div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>会话列表</span></div>
            <div id="sessionList" class="list"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>Checkpoint 收件箱</span></div>
            <div class="checkpoint-form">
              <select id="checkpointTaskSelect"></select>
              <textarea id="checkpointInput" placeholder="粘贴 worker 回复末尾的 STATE / RESULT / NEXT_ACTION 合约块"></textarea>
              <div class="actions">
                <button id="checkpointBtn">提交状态</button>
                <button id="clearCheckpointsBtn">清空收件箱</button>
              </div>
            </div>
            <div id="checkpointList" class="checkpoint-list"></div>
          </div>
          <div>
            <div class="label" style="margin-bottom:6px"><span>完善路线</span></div>
            <div id="roadmapList" class="roadmap"></div>
          </div>
          <pre id="log" class="log"></pre>
        </div>
      </section>
    </main>
    <footer id="systemMetricsFooter" class="terminal-status" style="display:none;padding:0 16px 12px"></footer>
  </div>

  <div id="taskEditorBackdrop" class="task-editor-backdrop" aria-hidden="true">
    <section class="task-editor" role="dialog" aria-modal="true" aria-labelledby="taskEditorTitle">
      <div class="task-editor-head">
        <div>
          <h2 id="taskEditorTitle" class="panel-title">Task Editor</h2>
          <span id="taskEditorMeta" class="tag">No task selected</span>
        </div>
        <button id="taskEditorCloseBtn" class="mini" type="button">关闭</button>
      </div>
      <div class="task-editor-body">
        <label class="label"><span>Title</span><input id="taskEditTitle" /></label>
        <label class="label"><span>Description</span><textarea id="taskEditDescription"></textarea></label>
        <div class="task-editor-grid">
          <label class="label"><span>Lane</span>
            <select id="taskEditColumn">
              <option value="backlog">待办</option>
              <option value="running">进行中</option>
              <option value="blocked">阻塞</option>
              <option value="review">复核</option>
              <option value="done">完成</option>
            </select>
          </label>
          <label class="label"><span>Priority</span>
            <select id="taskEditPriority">
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
          </label>
          <label class="label"><span>Assignee</span><input id="taskEditAssignee" placeholder="agent / worker / owner" /></label>
          <label class="label"><span>Due date</span><input id="taskEditDueDate" placeholder="YYYY-MM-DD 或说明" /></label>
          <label class="label"><span>Tags</span><input id="taskEditTags" placeholder="comma, separated" /></label>
          <label class="label"><span>Session path</span><input id="taskEditSessionPath" placeholder="/sessions/..." /></label>
          <label class="label"><span>Mission ID</span><input id="taskEditMissionId" /></label>
          <label class="label"><span>Assignment ID</span><input id="taskEditAssignmentId" /></label>
        </div>
        <div class="actions">
          <button id="taskEditorSaveBtn" class="primary" type="button">保存任务</button>
          <button id="taskEditorDuplicateBtn" type="button">复制为新任务</button>
          <button id="taskEditorDeleteBtn" class="danger" type="button">删除任务</button>
        </div>
      </div>
    </section>
  </div>

  <div id="shortcutHelpBackdrop" class="shortcut-backdrop" aria-hidden="true">
    <section class="shortcut-modal" role="dialog" aria-modal="true" aria-labelledby="shortcutHelpTitle">
      <div class="task-editor-head">
        <div>
          <h2 id="shortcutHelpTitle" class="panel-title">Keyboard Shortcuts</h2>
          <span class="tag">Hermes-style workbench controls</span>
        </div>
        <button id="shortcutHelpCloseBtn" class="mini" type="button">关闭</button>
      </div>
      <div id="shortcutHelpBody" class="shortcut-body"></div>
    </section>
  </div>

  <div id="commandPaletteBackdrop" class="shortcut-backdrop" aria-hidden="true">
    <section class="shortcut-modal" role="dialog" aria-modal="true" aria-labelledby="commandPaletteTitle">
      <div class="task-editor-head">
        <div>
          <h2 id="commandPaletteTitle" class="panel-title">Command Palette</h2>
          <span id="commandPaletteMeta" class="tag">Hermes-style ⌘K</span>
        </div>
        <button id="commandPaletteCloseBtn" class="mini" type="button">关闭</button>
      </div>
      <div class="shortcut-body">
        <input id="commandPaletteInput" class="command-palette-input" placeholder="搜索命令、打开面板或执行工作台动作" autocomplete="off" />
        <div id="commandPaletteList" class="command-palette-list"></div>
      </div>
    </section>
  </div>

  <div id="onboardingBackdrop" class="shortcut-backdrop" aria-hidden="true">
    <section class="shortcut-modal" role="dialog" aria-modal="true" aria-labelledby="onboardingTitle">
      <div class="task-editor-head">
        <div>
          <h2 id="onboardingTitle" class="panel-title">Workbench Tour</h2>
          <span id="onboardingMeta" class="tag">Hermes-style onboarding</span>
        </div>
        <button id="onboardingCloseBtn" class="mini" type="button">关闭</button>
      </div>
      <div id="onboardingBody" class="shortcut-body"></div>
    </section>
  </div>

  <div id="modelChooserBackdrop" class="shortcut-backdrop" aria-hidden="true">
    <section class="shortcut-modal model-chooser-modal" role="dialog" aria-modal="true" aria-labelledby="modelChooserTitle">
      <div class="task-editor-head">
        <div>
          <h2 id="modelChooserTitle" class="panel-title">Model Chooser</h2>
          <span id="modelChooserMeta" class="tag">Hermes-style provider selection</span>
        </div>
        <button id="modelChooserCloseBtn" class="mini" type="button">关闭</button>
      </div>
      <div class="shortcut-body">
        <div class="model-chooser-tools">
          <input id="modelChooserSearchInput" class="command-palette-input" placeholder="搜索 provider、model、tier、来源" autocomplete="off" />
          <select id="modelChooserSourceSelect">
            <option value="">全部来源</option>
            <option value="suggestion">Smart suggestions</option>
            <option value="pinned">Pinned models</option>
            <option value="metadata">Model metadata</option>
            <option value="current">Current runtime</option>
            <option value="session">Session metadata</option>
          </select>
        </div>
        <div id="modelChooserList" class="model-choice-list"></div>
      </div>
    </section>
  </div>

  <script>
    window.HANAAGENT = ${escapeJson({ urls, hermesPageAlias: pageAlias, hermesPageAliases: HERMES_PAGE_ALIASES })};
  </script>
  <script>
    window.parent && window.parent.postMessage({ type: 'ready' }, '*');

    const urls = window.HANAAGENT.urls;
    const lanes = [
      { id: 'backlog', label: '待办' },
      { id: 'running', label: '进行中' },
      { id: 'blocked', label: '阻塞' },
      { id: 'review', label: '复核' },
      { id: 'done', label: '完成' }
    ];
    const state = {
      agents: [],
      sessions: [],
      sessionSearchQuery: '',
      templates: [],
      blueprint: null,
      selectedTemplate: 'orchestrate',
      tasks: [],
      taskFilters: { query: '', assignee: '', priority: '' },
      activeBoardViewId: '',
      editingWipLimits: false,
      selectedTaskIds: [],
      editingTaskId: '',
      focusedTaskId: '',
      draggingTaskId: '',
      checkpoints: [],
      checkpointConflicts: [],
      checkpointReminders: [],
      checkpointReminderNotified: {},
      missions: [],
      activeMission: null,
      activeAssignmentId: '',
      sessionHistory: [],
      contextUsage: null,
      sessionTitleSuggestion: null,
      toolTrace: null,
      researchCard: null,
      inspectorTab: 'activity',
      inspectorCollapsed: false,
      liveEvents: [],
      liveTrace: [],
      eventSource: null,
      liveTextBuffer: '',
      liveDisplayBuffer: '',
      liveStreamFrame: 0,
      liveStreamActive: false,
      liveStreamStartedAt: '',
      activeReport: '',
      terminal: null,
      terminalSeq: 0,
      terminalOutput: '',
      terminalAutoRead: false,
      terminalPollTimer: null,
      terminalLastReadAt: '',
      terminalCommandHistory: [],
      terminalHistoryIndex: -1,
      workerCards: [],
      workerDetail: null,
      workerIdePane: 'overview',
      agentConfig: null,
      modelSuggestions: null,
      usage: null,
      hostCheckpoints: [],
      sessionStatus: null,
      agentSkills: null,
      memoryEntries: [],
      memoryEntry: null,
      memoryTab: 'memory',
      knowledgePages: [],
      knowledgeResults: [],
      knowledgePage: null,
      knowledgeGraph: null,
      integrations: null,
      runRecords: [],
      runRecordSummary: null,
      runLearnings: [],
      runLearningSummary: null,
      runLearningFilter: 'all',
      runCompare: null,
      agentOutputs: [],
      agentOutputSummary: null,
      agentOutputFilters: [],
      agentOutputFilter: 'all',
      swarmActivity: [],
      swarmActivitySummary: null,
      workerArtifacts: [],
      workerArtifactSummary: null,
      approvals: [],
      pendingApprovals: [],
      approvalHistory: [],
      approvalSummary: null,
      agenda: null,
      agendaSections: { attention: true, active: true, tasks: true, upcoming: true, completed: true, agents: true },
      calendar: null,
      calendarMode: 'week',
      calendarCursor: startOfCalendarDay(new Date()),
      inbox: null,
      inboxSummary: null,
      autopilot: null,
      autopilotRuns: [],
      autopilotSchedule: null,
      autopilotStatus: null,
      autopilotTick: null,
      autopilotLoop: null,
      jobs: [],
      jobScheduler: null,
      jobOutput: null,
      operations: null,
      setupDoctor: null,
      providerSetup: null,
      operationPresets: [],
      operationProfiles: [],
      reviewGate: null,
      reviewGateReport: '',
      workspaceRoots: [],
      workspaceFiles: [],
      workspaceFile: null,
      workspacePatchReview: null,
      workspacePath: '.',
      hostTasks: [],
      deferredTasks: [],
      searchResults: [],
      searchQuery: '',
      searchActiveIndex: 0,
      commandPaletteOpen: false,
      commandPaletteQuery: '',
      commandPaletteActiveIndex: 0,
      modelChooserOpen: false,
      modelChooserQuery: '',
      modelChooserSource: '',
      mobileSessionsOpen: false,
      workerOutputPinnedToBottom: true,
      slashQuery: '',
      slashActiveIndex: 0,
      voiceRecognition: null,
      voiceListening: false,
      voiceTranscript: '',
      attachments: [],
      artifactPreview: null,
      onboardingStep: 0,
      toasts: [],
      activeMobileSection: 'mobileSectionConductor',
      hermesAliasApplied: false,
      lastMobileScrollY: 0,
      config: {}
    };

    const inspectorTabs = [
      { id: 'activity', label: 'Activity' },
      { id: 'context', label: 'Context' },
      { id: 'tools', label: 'Tools' },
      { id: 'knowledge', label: 'Knowledge' },
      { id: 'worker', label: 'Worker' }
    ];

    const onboardingSteps = [
      { id: 'setup', title: 'Setup Doctor', target: 'setupDoctorPanel', detail: '先确认模型、会话、workspace roots、terminal、memory/skills 和 runtime capability。这里会告诉你真实 worker 是否已经能跑。' },
      { id: 'conductor', title: 'Conductor 指挥台', target: 'missionInput', detail: '把目标写进 Mission，选择模式和 worker 数，HanaAgent 会拆成 assignments 并生成看板任务。' },
      { id: 'sessions', title: 'Sessions / Pinned', target: 'pinnedPanel', detail: '选择 OpenHanako session、Pin 常用会话和模型，也可以保存 Modes 让一组偏好随时恢复。' },
      { id: 'board', title: 'Kanban TaskBoard', target: 'board', detail: '任务看板支持筛选、WIP 限制、拖拽排序、批量操作和 checkpoint 自动流转。' },
      { id: 'runtime', title: 'Agent Runtime', target: 'agentConfigPanel', detail: '运行视图聚合 agent config、skills、memory、usage、host checkpoint、session lifecycle 和 terminal。' },
      { id: 'files', title: 'Files / Workspace', target: 'workspaceFileList', detail: '受控 workspace roots 可以浏览、上传、预览、diff 和保存文本文件，路径安全由插件侧保护。' },
      { id: 'run-console', title: 'Run Console', target: 'runRecordPanel', detail: '把 worker output 固化为 artifact、approval 或 learning；artifact 可注册 OpenHanako 原生 HTML preview 并在工作台内嵌查看。' },
      { id: 'automation', title: 'Autopilot / Jobs', target: 'autopilotPanel', detail: 'Autopilot 和 Jobs 可以持续巡检 mission、同步 checkpoint、升级 blocker 并记录可审计建议。' }
    ];

    const keyboardShortcuts = [
      { keys: '⌘/ 或 ?', label: '打开快捷键帮助' },
      { keys: '⌘K', label: '打开 Command Palette' },
      { keys: 'Escape', label: '关闭 Command Palette、搜索、任务编辑器、快捷键帮助或 Artifact 预览' },
      { keys: '↑ / ↓', label: '在 Command Palette、全局搜索结果或看板任务中移动焦点' },
      { keys: 'Enter', label: '执行命令、打开搜索结果或编辑聚焦任务' },
      { keys: 'E', label: '编辑看板中聚焦任务' },
      { keys: 'X', label: '选择或取消选择看板中聚焦任务' },
      { keys: 'M', label: '推进看板中聚焦任务到下一列' },
      { keys: 'Delete', label: '删除看板中聚焦任务' },
      { keys: '/', label: '在 Mission 输入框打开 slash command 菜单' },
      { keys: 'Tab', label: '补全当前 slash command' },
      { keys: 'Ctrl/⌘ + Enter', label: '从 Mission 输入框新建 mission' },
      { keys: 'Enter', label: '在终端输入框发送命令' }
    ];

    const workbenchThemePresets = [
      { id: 'hermes', label: 'Hermes', mode: 'dark', accent: 'blue' },
      { id: 'claude-official', label: 'Claude Official', mode: 'dark', accent: 'blue' },
      { id: 'claude-official-light', label: 'Claude Official Light', mode: 'light', accent: 'blue' },
      { id: 'claude-classic', label: 'Claude Classic', mode: 'dark', accent: 'orange' },
      { id: 'classic-light', label: 'Classic Light', mode: 'light', accent: 'orange' },
      { id: 'slate', label: 'Slate', mode: 'dark', accent: 'blue' },
      { id: 'slate-light', label: 'Slate Light', mode: 'light', accent: 'blue' },
      { id: 'mono', label: 'Mono', mode: 'dark', accent: 'mono' },
      { id: 'mono-light', label: 'Mono Light', mode: 'light', accent: 'mono' }
    ];

    const slashCommands = [
      {
        id: '/new',
        label: '/new',
        title: '新 Mission',
        hint: '清空当前目标和上下文，准备一个新的 mission 草稿。',
        run: () => {
          $('missionInput').value = '';
          $('notesInput').value = '';
          state.attachments = [];
          renderMissionAttachments();
          $('missionInput').focus();
          log('已准备新 Mission 草稿');
        }
      },
      {
        id: '/plan',
        label: '/plan',
        title: '计划模式',
        hint: '切换到计划模式，适合先拆解任务和生成执行路线。',
        run: () => {
          $('modeSelect').value = 'plan';
          log('已切换到计划模式');
        }
      },
      {
        id: '/review',
        label: '/review',
        title: '复核模式',
        hint: '切换到复核模式，适合审查交付物、缺口和风险。',
        run: () => {
          $('modeSelect').value = 'review';
          log('已切换到复核模式');
        }
      },
      {
        id: '/dispatch',
        label: '/dispatch',
        title: '执行模式',
        hint: '切换到执行模式，适合直接投递给 worker。',
        run: () => {
          $('modeSelect').value = 'dispatch';
          log('已切换到执行模式');
        }
      },
      {
        id: '/model',
        label: '/model',
        title: '选择模型',
        hint: '打开 Hermes-style provider/model 选择器；可搜索、应用、Pin 或生成推荐。',
        run: () => openModelChooser({ refreshSuggestions: true })
      },
      {
        id: '/skills',
        label: '/skills',
        title: '读取 Skills',
        hint: '读取当前 agent 的 skills，并聚焦到运行时面板。',
        run: async () => {
          await loadAgentSkills();
          const panel = $('agentSkillsPanel');
          if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      },
      {
        id: '/save',
        label: '/save',
        title: '加入待办',
        hint: '把当前 mission 输入保存成任务看板里的待办项。',
        run: () => addDraft('backlog')
      },
      {
        id: '/help',
        label: '/help',
        title: '显示快捷命令',
        hint: '把可用 slash 命令写到运行输出中，便于查看。',
        run: () => {
          setWorkerOutputMessage({
            title: 'Slash Commands',
            role: 'help',
            text: slashCommands.map((item) => '- ' + item.label + ' - **' + item.title + '**\\n  ' + item.hint).join('\\n')
          });
          log('已显示 slash command 帮助');
        }
      }
    ];

    const commandPaletteCommands = [
      {
        id: 'refresh-workbench',
        title: 'Refresh Workbench',
        subtitle: '重新读取 agents、sessions、missions、tasks 和 runtime overview。',
        group: 'General',
        keywords: 'reload state overview 刷新 工作台',
        run: () => loadState()
      },
      {
        id: 'focus-global-search',
        title: 'Focus Global Search',
        subtitle: '搜索 missions、tasks、memory、files、jobs 和 integrations。',
        group: 'Search',
        keywords: 'find search command center 搜索',
        run: () => {
          $('globalSearchInput').focus();
          $('globalSearchInput').select();
        }
      },
      {
        id: 'open-onboarding',
        title: 'Open Onboarding Tour',
        subtitle: '打开 Hermes-style 工作台引导。',
        group: 'Help',
        keywords: 'tour setup doctor guide 引导',
        run: () => openOnboardingTour()
      },
      {
        id: 'open-shortcuts',
        title: 'Open Keyboard Shortcuts',
        subtitle: '查看全局、看板、composer、terminal 和 modal 快捷键。',
        group: 'Help',
        keywords: 'help keyboard shortcut 快捷键',
        run: () => openShortcutHelp()
      },
      {
        id: 'create-mission',
        title: 'Create Mission From Composer',
        subtitle: '用当前 Mission 输入框创建 Conductor mission。',
        group: 'Mission',
        keywords: 'new conductor create mission 新建 任务',
        run: () => createMissionFromInput()
      },
      {
        id: 'dispatch-mission',
        title: 'Dispatch Active Mission',
        subtitle: '把当前 mission 分派到目标 worker/session。',
        group: 'Mission',
        keywords: 'send run worker swarm 派发',
        run: () => dispatchActiveMission()
      },
      {
        id: 'load-report',
        title: 'Generate Mission Report',
        subtitle: '生成当前 mission 的 Markdown report。',
        group: 'Mission',
        keywords: 'report export summary 报告',
        run: () => loadMissionReport()
      },
      {
        id: 'sync-history',
        title: 'Sync Session Checkpoints',
        subtitle: '从目标 session history 同步 checkpoint。',
        group: 'Runtime',
        keywords: 'checkpoint history sync 同步',
        run: () => syncHistoryCheckpoints()
      },
      {
        id: 'load-integrations',
        title: 'Load Integration Catalog',
        subtitle: '刷新 MCP、skills、plugins 和 host capabilities 目录。',
        group: 'Runtime',
        keywords: 'mcp skills plugins catalog 集成',
        run: () => loadIntegrations()
      },
      {
        id: 'suggest-model',
        title: 'Open Model Chooser',
        subtitle: '搜索 smart suggestions、pinned models、metadata 和当前 runtime model。',
        group: 'Runtime',
        keywords: 'model provider suggestion smart chooser 模型 供应商',
        run: () => openModelChooser({ refreshSuggestions: true })
      },
      {
        id: 'open-terminal',
        title: 'Start Terminal',
        subtitle: '通过宿主管理 terminal:start 打开工作台终端。',
        group: 'Runtime',
        keywords: 'shell terminal tui 终端',
        run: () => startSessionTerminal()
      },
      {
        id: 'export-pinned',
        title: 'Export Pinned Sessions',
        subtitle: '导出 pinned sessions 的会话 bundle。',
        group: 'Export',
        keywords: 'download markdown json zip 导出',
        run: () => exportPinnedSessions()
      },
      {
        id: 'run-autopilot-tick',
        title: 'Run Autopilot Tick',
        subtitle: '手动触发一次 Autopilot preview/run tick。',
        group: 'Automation',
        keywords: 'autopilot scheduler jobs 自动',
        run: () => runAutopilotTickNow()
      },
      {
        id: 'save-defaults',
        title: 'Save Defaults',
        subtitle: '保存当前默认 agent 和 session。',
        group: 'Settings',
        keywords: 'default config preference 设置 默认',
        run: () => saveDefaults()
      }
    ];

    const $ = (id) => document.getElementById(id);

    function nowTime() {
      return new Date().toLocaleTimeString('zh-CN', { hour12: false });
    }

    function log(line) {
      const el = $('log');
      el.textContent = '[' + nowTime() + '] ' + line + '\\n' + el.textContent;
      pushToast({ kind: 'info', title: 'Workbench', detail: line, timeout: 2800 });
    }

    function pushToast(input = {}) {
      const title = String(input.title || 'HanaAgent');
      const detail = String(input.detail || '');
      const kind = String(input.kind || 'info');
      const id = 'toast-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      const toast = { id, kind, title, detail, createdAt: Date.now(), timeout: Math.max(1200, Math.min(12000, Number(input.timeout || 4200))) };
      state.toasts = [toast, ...(Array.isArray(state.toasts) ? state.toasts : [])].slice(0, 5);
      renderToasts();
      window.setTimeout(() => dismissToast(id), toast.timeout);
      return toast;
    }

    function dismissToast(id) {
      state.toasts = (Array.isArray(state.toasts) ? state.toasts : []).filter((toast) => toast.id !== id);
      renderToasts();
    }

    function renderToasts() {
      const root = $('toastStack');
      if (!root) return;
      root.innerHTML = '';
      for (const toast of Array.isArray(state.toasts) ? state.toasts : []) {
        const item = document.createElement('div');
        const toastKind = ['info', 'spawned', 'complete', 'failed', 'alert', 'chat', 'model'].includes(toast.kind) ? toast.kind : 'info';
        item.className = 'toast ' + toastKind;
        item.setAttribute('role', toast.kind === 'failed' || toast.kind === 'alert' ? 'alert' : 'status');
        item.innerHTML =
          '<div><b>' + escapeHtml(toast.title || 'HanaAgent') + '</b>' +
          (toast.detail ? '<span>' + escapeHtml(toast.detail) + '</span>' : '') + '</div>' +
          '<button class="mini" type="button" title="关闭">×</button>';
        item.querySelector('button').addEventListener('click', () => dismissToast(toast.id));
        root.appendChild(item);
      }
    }

    function notificationSettings() {
      const settings = (state.config && state.config.workbenchNotifications) || {};
      return {
        enabled: settings.enabled !== false,
        volume: Math.max(0, Math.min(1, Number(settings.volume ?? 0.28))),
        browser: Boolean(settings.browser),
        haptics: settings.haptics !== false
      };
    }

    function workbenchSettings() {
      const settings = (state.config && state.config.workbenchSettings) || {};
      const preset = workbenchThemePresets.find((item) => item.id === settings.themePreset) || workbenchThemePresets[0];
      return {
        themePreset: preset.id,
        theme: ['system', 'light', 'dark'].includes(settings.theme) ? settings.theme : preset.mode || 'system',
        accentColor: ['blue', 'green', 'orange', 'purple', 'mono'].includes(settings.accentColor) ? settings.accentColor : preset.accent || 'blue',
        editorFontSize: Math.max(11, Math.min(22, Number(settings.editorFontSize || 13))),
        editorWordWrap: settings.editorWordWrap !== false,
        editorMinimap: Boolean(settings.editorMinimap),
        usageThreshold: Math.max(50, Math.min(95, Number(settings.usageThreshold || 80))),
        showSystemMetricsFooter: Boolean(settings.showSystemMetricsFooter),
        mobileChatNavMode: ['dock', 'integrated', 'scroll-hide'].includes(settings.mobileChatNavMode) ? settings.mobileChatNavMode : 'dock',
        calendarTimezone: String(settings.calendarTimezone || 'local').trim() || 'local'
      };
    }

    function applyWorkbenchSettings() {
      const settings = workbenchSettings();
      document.body.dataset.workbenchTheme = settings.theme;
      document.body.dataset.workbenchAccent = settings.accentColor;
      document.body.dataset.workbenchPreset = settings.themePreset;
      document.body.dataset.mobileNavMode = settings.mobileChatNavMode;
      const editor = $('workspaceEditor');
      if (editor) {
        editor.style.fontSize = settings.editorFontSize + 'px';
        editor.style.whiteSpace = settings.editorWordWrap ? 'pre-wrap' : 'pre';
        editor.style.overflowX = settings.editorWordWrap ? 'hidden' : 'auto';
      }
      const footer = $('systemMetricsFooter');
      if (footer) {
        footer.style.display = settings.showSystemMetricsFooter ? 'block' : 'none';
        footer.textContent = [
          'agents ' + String(state.agents.length),
          'sessions ' + String(state.sessions.length),
          'tasks ' + String(state.tasks.length),
          'missions ' + String(state.missions.length),
          'mode ' + settings.theme + '/' + settings.accentColor
        ].join(' / ');
      }
      renderMobileTabBar();
    }

    function renderMobileTabBar() {
      const nav = $('mobileTabBar');
      if (!nav) return;
      const settings = workbenchSettings();
      document.body.dataset.mobileNavMode = settings.mobileChatNavMode;
      for (const button of Array.from(nav.querySelectorAll('button[data-target]'))) {
        button.classList.toggle('active', button.dataset.target === state.activeMobileSection);
      }
    }

    function jumpToMobileSection(targetId) {
      const target = $(targetId);
      if (!target) {
        pushToast({ kind: 'alert', title: 'Mobile Nav', detail: '目标区域不存在: ' + targetId });
        return;
      }
      state.activeMobileSection = targetId;
      renderMobileTabBar();
      const topbar = document.querySelector('.topbar');
      const header = document.querySelector('.mobile-page-header');
      let offset = 80;
      if (topbar && getComputedStyle(topbar).display !== 'none') {
        offset = Math.max(offset, topbar.offsetHeight + 8);
      } else if (header && getComputedStyle(header).display !== 'none') {
        offset = Math.max(offset, header.offsetHeight + 8);
      }
      const rect = target.getBoundingClientRect();
      const scrollTop = window.scrollY + rect.top - offset;
      window.scrollTo({ top: Math.max(0, scrollTop), behavior: 'smooth' });
    }

    function applyHermesPageAlias(options = {}) {
      const alias = (window.HANAAGENT && window.HANAAGENT.hermesPageAlias) || {};
      if (!alias.route || (state.hermesAliasApplied && !options.force)) return;
      state.hermesAliasApplied = true;
      const sessionPath = resolveHermesAliasSessionPath(alias);
      if (sessionPath && $('sessionSelect')) {
        $('sessionSelect').value = sessionPath;
        renderSessionDetail();
        renderMobileHeader();
        renderMobileSessionsPanel();
      }
      const target = alias.target || targetForHermesAliasSection(alias.section);
      state.activeMobileSection = target;
      renderMobileTabBar();
      window.setTimeout(() => {
        const node = $(target);
        if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, options.immediate ? 0 : 180);
      runHermesAliasSectionLoaders(alias);
      if (alias.route && alias.route !== '/workbench') {
        pushToast({
          kind: 'info',
          title: 'Hermes route',
          detail: (alias.label || alias.route) + ' 已映射到 HanaAgent 工作台',
          timeout: 3200
        });
      }
    }

    function targetForHermesAliasSection(section) {
      const map = {
        dashboard: 'mobileSectionControl',
        chat: 'mobileSectionRuntime',
        conductor: 'mobileSectionConductor',
        swarm: 'mobileSectionConductor',
        tasks: 'board',
        files: 'mobileSectionFiles',
        terminal: 'terminalOutput',
        memory: 'memoryPanel',
        skills: 'integrationCatalogPanel',
        mcp: 'integrationCatalogPanel',
        operations: 'operationsPanel',
        profiles: 'agentProfilePanel',
        jobs: 'jobPanel',
        settings: 'workbenchSettingsPanel',
        runtime: 'mobileSectionRuntime'
      };
      return map[section] || 'mobileSectionControl';
    }

    function resolveHermesAliasSessionPath(alias = {}) {
      const raw = decodeHermesRouteSegment(alias.sessionKey || '');
      if (!raw) return '';
      const candidates = [raw, '/' + raw, '/sessions/' + raw, '/sessions/' + raw + '.jsonl'];
      const normalizedRaw = normalizeRouteComparable(raw);
      for (const session of state.sessions || []) {
        const values = [
          session.path,
          session.title,
          session.alias,
          session.originalTitle,
          session.id,
          session.key
        ].filter(Boolean);
        if (values.some((value) => candidates.includes(String(value)))) return session.path;
        if (values.some((value) => normalizeRouteComparable(value) === normalizedRaw)) return session.path;
      }
      return raw.startsWith('/') ? raw : '';
    }

    function normalizeRouteComparable(value) {
      return decodeHermesRouteSegment(value)
        .replace(/^\\/+/, '')
        .replace(/^sessions\\//, '')
        .replace(/\\.jsonl$/i, '')
        .toLowerCase();
    }

    function decodeHermesRouteSegment(value) {
      const text = String(value || '').trim();
      if (!text) return '';
      try {
        return decodeURIComponent(text);
      } catch {
        return text;
      }
    }

    function runHermesAliasSectionLoaders(alias = {}) {
      const section = String(alias.section || '');
      if (section === 'memory') {
        loadMemoryEntries();
        loadKnowledgePages({ activate: false });
      }
      else if (section === 'skills' || section === 'mcp') loadIntegrations();
      else if (section === 'operations') loadOperations();
      else if (section === 'profiles') loadAgentConfig();
      else if (section === 'jobs') loadJobs();
      else if (section === 'files') loadWorkspaceFiles();
      else if (section === 'terminal') renderTerminal();
      else if (section === 'chat') {
        loadSessionHistory().catch(() => {});
        loadContextUsage().catch(() => {});
      }
    }

    function handleMobileNavScroll() {
      const settings = workbenchSettings();
      if (settings.mobileChatNavMode !== 'scroll-hide') {
        document.body.classList.remove('mobile-nav-hidden');
        state.lastMobileScrollY = window.scrollY || 0;
        return;
      }
      const current = window.scrollY || 0;
      const delta = current - Number(state.lastMobileScrollY || 0);
      if (current > 120 && delta > 8) document.body.classList.add('mobile-nav-hidden');
      else if (delta < -8) document.body.classList.remove('mobile-nav-hidden');
      state.lastMobileScrollY = current;
    }

    function renderMobileHeader() {
      const subtitle = $('mobileHeaderSubtitle');
      if (!subtitle) return;
      const selectedPath = $('sessionSelect') ? $('sessionSelect').value : '';
      const session = state.sessions.find((item) => item.path === selectedPath);
      if (session) {
        subtitle.textContent = sessionDisplayTitle(session) + (session.agentName || session.agentId ? ' / ' + (session.agentName || session.agentId) : '');
      } else {
        subtitle.textContent = String(state.sessions.length || 0) + ' sessions / ' + String(state.missions.length || 0) + ' missions';
      }
    }

    function renderMobileSessionsPanel() {
      const drawer = $('mobileSessionsDrawer');
      const list = $('mobileSessionList');
      if (!drawer || !list) return;
      drawer.classList.toggle('open', Boolean(state.mobileSessionsOpen));
      drawer.setAttribute('aria-hidden', state.mobileSessionsOpen ? 'false' : 'true');
      if ($('mobileSessionsBtn')) $('mobileSessionsBtn').setAttribute('aria-expanded', state.mobileSessionsOpen ? 'true' : 'false');
      const query = ($('mobileSessionSearchInput') ? $('mobileSessionSearchInput').value : state.sessionSearchQuery || '').trim().toLowerCase();
      const visibleSessions = filterSessionsForSidebar(state.sessions, query);
      if ($('mobileSessionsMeta')) $('mobileSessionsMeta').textContent = String(visibleSessions.length) + ' of ' + String(state.sessions.length) + ' sessions';
      list.innerHTML = '';
      if (!state.sessions.length) {
        list.innerHTML = '<div class="empty">暂无 OpenHanako 会话。先在宿主创建会话，或使用 Session Lifecycle 创建 worker session。</div>';
        return;
      }
      if (!visibleSessions.length) {
        list.innerHTML = '<div class="empty">没有匹配的会话</div>';
        return;
      }
      const selectedPath = $('sessionSelect') ? $('sessionSelect').value : '';
      for (const session of visibleSessions.slice(0, 40)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'mobile-session-card' + (session.path === selectedPath ? ' active' : '');
        item.innerHTML =
          '<b>' + escapeHtml(sessionDisplayTitle(session)) + '</b>' +
          '<span>' + escapeHtml((session.alias ? 'alias / ' : '') + (session.agentName || session.agentId || '-')) + '</span>' +
          '<span>' + escapeHtml(session.path || '-') + '</span>';
        item.addEventListener('click', () => selectMobileSession(session.path));
        list.appendChild(item);
      }
    }

    function openMobileSessionsPanel() {
      state.mobileSessionsOpen = true;
      if ($('mobileSessionSearchInput')) $('mobileSessionSearchInput').value = state.sessionSearchQuery || '';
      renderMobileSessionsPanel();
      window.setTimeout(() => {
        const input = $('mobileSessionSearchInput');
        if (input) input.focus();
      }, 30);
    }

    function closeMobileSessionsPanel() {
      state.mobileSessionsOpen = false;
      renderMobileSessionsPanel();
    }

    function selectMobileSession(sessionPath) {
      if (!sessionPath || !$('sessionSelect')) return;
      $('sessionSelect').value = sessionPath;
      renderSessionDetail();
      renderWorkbenchModes();
      renderMobileHeader();
      closeMobileSessionsPanel();
      jumpToMobileSection('mobileSectionConductor');
      pushToast({ kind: 'chat', title: 'Session selected', detail: sessionPath, timeout: 2600 });
    }

    function notifyWorkbench(kind, title, detail) {
      pushToast({ kind: kind === 'chatComplete' ? 'complete' : kind || 'info', title: title || 'HanaAgent', detail: detail || '', timeout: kind === 'failed' || kind === 'alert' ? 6500 : 4200 });
      const settings = notificationSettings();
      if (settings.haptics && navigator.vibrate) navigator.vibrate(kind === 'failed' || kind === 'alert' ? [8, 24, 8] : 8);
      if (settings.enabled) playWorkbenchSound(kind, settings.volume);
      if (settings.browser && 'Notification' in window) {
        if (Notification.permission === 'granted') {
          new Notification(title || 'HanaAgent', { body: detail || '', tag: 'hanaagent-' + String(kind || 'event') });
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then((permission) => {
            if (permission === 'granted') new Notification(title || 'HanaAgent', { body: detail || '', tag: 'hanaagent-' + String(kind || 'event') });
          }).catch(() => {});
        }
      }
    }

    function playWorkbenchSound(kind, volume) {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass || volume <= 0) return;
        const ctx = new AudioContextClass();
        const gain = ctx.createGain();
        gain.gain.value = Math.max(0, Math.min(1, volume)) * 0.18;
        gain.connect(ctx.destination);
        const patterns = {
          spawned: [[523.25, 0], [659.25, 0.08]],
          complete: [[783.99, 0]],
          failed: [[130.81, 0], [110, 0.11]],
          chat: [[659.25, 0]],
          chatComplete: [[659.25, 0], [523.25, 0.1]],
          alert: [[440, 0], [659.25, 0.08], [440, 0.16]],
          thinking: [[1046.5, 0]]
        };
        const notes = patterns[kind] || patterns.chat;
        notes.forEach(([frequency, offset]) => {
          const oscillator = ctx.createOscillator();
          oscillator.type = kind === 'failed' ? 'sawtooth' : 'sine';
          oscillator.frequency.value = frequency;
          oscillator.connect(gain);
          oscillator.start(ctx.currentTime + offset);
          oscillator.stop(ctx.currentTime + offset + (kind === 'thinking' ? 0.035 : 0.11));
        });
        window.setTimeout(() => ctx.close().catch(() => {}), 420);
      } catch {}
    }

    function setBus(ok, text) {
      $('busDot').className = 'dot ' + (ok ? 'ok' : 'bad');
      $('busStatus').textContent = text;
    }

    function renderConnectionBanner(input) {
      const banner = $('connectionBanner');
      if (!banner) return;
      const title = $('connectionBannerTitle');
      const detail = $('connectionBannerDetail');
      const doctor = input?.doctor || state.setupDoctor || {};
      const offline = input?.offline;
      const summary = doctor.summary || {};
      const blocking = Number(summary.blocking || 0);
      const warn = Number(summary.warn || 0);
      const readiness = Number(doctor.readiness || 0);
      let status = offline ? 'offline' : blocking ? 'blocked' : warn || readiness < 85 ? 'degraded' : 'ready';
      const label = status === 'ready' ? 'OpenHanako runtime ready' : status === 'blocked' ? 'Runtime setup blocked' : status === 'offline' ? 'Backend unavailable' : 'Runtime degraded mode';
      const message = offline
        ? (input.error || '无法读取 HanaAgent 状态，请检查 OpenHanako server 或插件 token。')
        : ('readiness ' + String(readiness) + '% / blocking ' + String(blocking) + ' / warn ' + String(warn) + ' / ' + (doctor.nextAction || 'Ready.'));
      banner.className = 'connection-banner open ' + status;
      if (title) title.textContent = label;
      if (detail) detail.textContent = message;
    }

    function renderConnectionChecking() {
      const banner = $('connectionBanner');
      if (!banner) return;
      banner.className = 'connection-banner open degraded';
      if ($('connectionBannerTitle')) $('connectionBannerTitle').textContent = 'Checking OpenHanako runtime';
      if ($('connectionBannerDetail')) $('connectionBannerDetail').textContent = '正在探测 session、model、memory、terminal 和 workspace 能力。';
    }

    async function requestJson(url, options) {
      const res = await fetch(url, options);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(data.error || 'request_failed');
        err.data = data;
        throw err;
      }
      return data;
    }

    async function loadState() {
      setBus(false, '连接中');
      renderConnectionChecking();
      try {
        const data = await requestJson(urls.state);
        state.agents = data.agents || [];
        state.sessions = data.sessions || [];
        state.templates = data.templates || [];
        state.blueprint = data.blueprint || null;
        state.tasks = data.tasks || [];
        state.checkpoints = data.checkpoints || [];
        state.checkpointConflicts = data.overview?.sections?.checkpoints?.conflicts || [];
        state.checkpointReminders = [];
        state.missions = data.missions || [];
        state.activeMission = data.activeMission || (state.missions[0] || null);
        state.workerCards = data.workerCards || [];
        state.agentSkills = data.agentSkills || null;
        state.memoryEntries = data.memoryEntries || [];
        state.integrations = data.integrations || (data.overview && data.overview.sections && data.overview.sections.integrations) || null;
        state.runRecords = data.runRecords || [];
        state.runRecordSummary = data.runRecordSummary || null;
        state.agentOutputs = data.agentOutputs?.outputs || data.overview?.sections?.agentOutputs?.items || [];
        state.agentOutputSummary = data.agentOutputs?.summary || data.overview?.sections?.agentOutputs?.summary || null;
        state.agentOutputFilters = data.agentOutputs?.availableFilters || data.overview?.sections?.agentOutputs?.availableFilters || [];
        state.swarmActivity = data.swarmActivity?.items || data.overview?.sections?.swarmActivity?.items || [];
        state.swarmActivitySummary = data.swarmActivity?.summary || data.overview?.sections?.swarmActivity?.summary || null;
        state.workerArtifacts = data.workerArtifacts?.items || data.overview?.sections?.workerArtifacts?.items || [];
        state.workerArtifactSummary = data.workerArtifacts?.summary || data.overview?.sections?.workerArtifacts?.summary || null;
        state.approvals = data.approvals?.approvals || data.overview?.sections?.approvals?.items || [];
        state.pendingApprovals = data.approvals?.pending || data.overview?.sections?.approvals?.pending || [];
        state.approvalHistory = data.approvals?.history || data.overview?.sections?.approvals?.history || [];
        state.approvalSummary = data.approvals?.summary || data.overview?.sections?.approvals?.summary || null;
        state.inbox = data.inbox || null;
        state.inboxSummary = data.inboxSummary || null;
        state.autopilot = data.autopilot || null;
        state.autopilotRuns = data.autopilotRuns || [];
        state.autopilotSchedule = data.autopilotSchedule || (data.config && data.config.autopilotSchedule) || null;
        state.autopilotLoop = data.autopilotLoop || data.overview?.sections?.autopilot?.loop || null;
        state.jobs = data.jobs || [];
        state.jobScheduler = data.overview?.sections?.jobs?.scheduler || data.jobScheduler || null;
        state.operations = data.operations || (data.overview && data.overview.sections && data.overview.sections.operations) || null;
        state.setupDoctor = data.setupDoctor || (data.overview && data.overview.sections && data.overview.sections.setupDoctor) || null;
        state.providerSetup = data.providerSetup || null;
        state.usage = data.usage || (data.overview && data.overview.sections && data.overview.sections.usage) || null;
        state.operationPresets = state.operations && Array.isArray(state.operations.presets) ? state.operations.presets : [];
        state.operationProfiles = state.operations && Array.isArray(state.operations.profiles) ? state.operations.profiles : [];
        state.config = data.config || {};
        if (state.config.defaultAgentId) $('agentSelect').value = state.config.defaultAgentId;
        if (state.activeMission && !state.activeAssignmentId) {
          const assignments = Array.isArray(state.activeMission.assignments) ? state.activeMission.assignments : [];
          state.activeAssignmentId = assignments[0] ? assignments[0].id : '';
        }
        setBus(Boolean(data.capabilities && data.capabilities.sessionSend), '已连接');
        renderAll();
        applyWorkbenchSettings();
        applyDefaults();
        applyHermesPageAlias();
        applyAutopilotScheduleInputs();
        await loadWorkspaceRoots();
        await loadProviderSetup({ silent: true });
        await loadCheckpointReminders({ notify: true, silent: true });
        maybeOpenOnboardingTour();
        log('已加载 Hana agent/session 状态');
      } catch (err) {
        setBus(false, '不可用');
        renderConnectionBanner({ offline: true, error: err.message });
        log('状态加载失败: ' + err.message);
        renderAll();
      }
    }

    function applyDefaults() {
      if (state.config.defaultAgentId) $('agentSelect').value = state.config.defaultAgentId;
      if (state.config.defaultSessionPath) $('sessionSelect').value = state.config.defaultSessionPath;
      renderSessionDetail();
    }

    async function reloadSessions() {
      const agentId = $('agentSelect').value;
      const sep = urls.sessions.includes('?') ? '&' : '?';
      try {
        const data = await requestJson(urls.sessions + sep + 'agentId=' + encodeURIComponent(agentId || ''));
        state.sessions = data.sessions || [];
        renderSessions();
        renderMetrics();
        renderSessionDetail();
        log('会话已更新');
      } catch (err) {
        log('会话更新失败: ' + err.message);
      }
    }

    function renderAll() {
      renderTemplates();
      renderAgents();
      renderSessions();
      renderMetrics();
      renderConductor();
      renderMissionHistory();
      renderSessionHistory();
      renderContextUsagePanel();
      renderSessionTitlePanel();
      renderSessionTombstones();
      renderLiveEvents();
      renderToolTrace();
      renderSwarmActivityPanel();
      renderWorkerArtifactsPanel();
      renderApprovalsPanel();
      renderAgendaPanel();
      renderCalendarPanel();
      renderResearchCard();
      renderMissionTimeline();
      renderMissionInboxPanel();
      renderOperationsPanel();
      renderSetupDoctorPanel();
      renderProviderSetupPanel();
      renderConnectionBanner();
      renderAutopilotPanel();
      renderJobPanel();
      renderAgentOutputsPanel();
      renderRunRecordPanel();
      renderReviewGatePanel();
      renderWorkspaceFilesPanel();
      renderBoard();
      renderCheckpointInbox();
      renderRoadmap();
      renderSessionDetail();
      renderPinnedPanel();
      renderWorkbenchModes();
      renderNotificationSettings();
      renderWorkbenchSettings();
      renderTerminal();
      renderRuntimePanels();
      renderModelSuggestions();
      renderWorkerDrilldownPanel();
      renderMemoryPanel();
      renderKnowledgePanel();
      renderGlobalSearchPanel();
      renderArtifactPreviewPanel();
      renderShortcutHelp();
      renderOnboardingTour();
      applyWorkbenchSettings();
    }

    function renderMetrics() {
      $('agentCount').textContent = String(state.agents.length);
      $('sessionCount').textContent = String(state.sessions.length);
      $('taskCount').textContent = String(state.tasks.filter((task) => task.column !== 'done' && task.lane !== 'done').length);
    }

    function renderConductor() {
      const mission = state.activeMission;
      $('activeMissionTag').textContent = mission ? (mission.phase || mission.state) + ' / ' + mission.title : 'No mission';
      const drop = $('missionDrop');
      if (mission) {
        const assignments = Array.isArray(mission.assignments) ? mission.assignments : [];
        const stats = missionStats(mission);
        drop.innerHTML =
          '<b>' + escapeHtml(mission.title) + '</b>' +
          '<span>' + escapeHtml(mission.goal) + '</span>' +
          '<span class="tag">' + assignments.length + ' assignments</span>' +
          '<span class="tag">' + escapeHtml(mission.state || 'active') + '</span>';
        $('missionProgress').textContent = stats.progress + '%';
        $('missionActiveWorkers').textContent = String(stats.active);
        $('missionCost').textContent = formatUsd(estimateMissionCost(mission.totalTokens || 0));
        $('missionProgressBar').style.setProperty('--value', stats.progress + '%');
      } else {
        drop.innerHTML = 'No missions yet.<br>Launch your first mission and it will appear here.';
        $('missionProgress').textContent = '0%';
        $('missionActiveWorkers').textContent = '0';
        $('missionCost').textContent = '$0.000';
        $('missionProgressBar').style.setProperty('--value', '0%');
      }
      renderAssignments();
      renderWorkerOutput();
      renderOffice();
    }

    function missionStats(mission) {
      const assignments = mission && Array.isArray(mission.assignments) ? mission.assignments : [];
      const total = assignments.length;
      const done = assignments.filter((item) => item.state === 'done').length;
      const active = assignments.filter((item) => ['running', 'checkpointed', 'review'].includes(item.state)).length;
      return {
        total,
        done,
        active,
        progress: total ? Math.round((done / total) * 100) : 0
      };
    }

    function estimateMissionCost(tokens) {
      return (Math.max(0, Number(tokens) || 0) / 1000000) * 5;
    }

    function formatUsd(value) {
      return '$' + Number(value || 0).toFixed(value >= 0.1 ? 2 : 3);
    }

    function renderAssignments() {
      const root = $('assignmentList');
      if (!root) return;
      const mission = state.activeMission;
      const assignments = mission && Array.isArray(mission.assignments) ? mission.assignments : [];
      root.innerHTML = '';
      if (!assignments.length) {
        root.innerHTML = '<div class="empty">暂无 worker assignment</div>';
        return;
      }
      for (const assignment of assignments) {
        const item = document.createElement('article');
        item.className = 'assignment';
        const selected = assignment.id === state.activeAssignmentId;
        item.innerHTML =
          '<div class="task-row"><span class="status-chip ' + escapeHtml(assignment.state) + '">' + escapeHtml(assignment.state) + '</span><span class="tag">' + escapeHtml(assignment.label) + '</span></div>' +
          '<b>' + escapeHtml(assignment.label + ': ' + (mission.title || 'Mission')) + '</b>' +
          '<p>' + escapeHtml(firstLine(assignment.task || assignment.rationale || '')) + '</p>' +
          '<div class="task-row">' +
            '<button class="mini view">' + (selected ? '正在查看' : '查看') + '</button>' +
            '<button class="mini brief">Brief</button>' +
            '<button class="mini brief-artifact">记录 Brief</button>' +
            '<button class="mini send">投递</button>' +
            '<button class="mini mark-done">完成</button>' +
            '<button class="mini danger block">阻塞</button>' +
          '</div>';
        item.querySelector('.view').addEventListener('click', () => {
          state.activeAssignmentId = assignment.id;
          renderAssignments();
          renderWorkerOutput();
          renderInspectorPanel();
          loadWorkerDrilldown(assignment.id);
        });
        item.querySelector('.brief').addEventListener('click', () => showAssignmentBrief(assignment.id));
        item.querySelector('.brief-artifact').addEventListener('click', () => recordAssignmentBriefArtifact(assignment.id));
        item.querySelector('.send').addEventListener('click', () => dispatchAssignment(assignment.id));
        item.querySelector('.mark-done').addEventListener('click', () => updateAssignmentState(assignment.id, 'done'));
        item.querySelector('.block').addEventListener('click', () => updateAssignmentState(assignment.id, 'blocked'));
        root.appendChild(item);
      }
    }

    function setWorkerOutputMessage(input = {}) {
      const root = $('workerOutput');
      if (!root) return;
      const text = String(input.text || '');
      root.className = 'output-box message-preview' + (text ? '' : ' empty');
      if (!text) {
        setWorkerOutputEmptyState(input.empty || '');
        updateWorkerOutputScrollButton();
        return;
      }
      const shouldStick = state.workerOutputPinnedToBottom || isWorkerOutputNearBottom();
      root.innerHTML = renderMessageCard({
        role: input.role || 'assistant',
        title: input.title || input.role || 'message',
        text,
        meta: input.meta || '',
        traceItems: input.traceItems || [],
        streaming: Boolean(input.streaming)
      });
      for (const button of Array.from(root.querySelectorAll('[data-copy-text]'))) {
        button.addEventListener('click', () => {
          const value = button.getAttribute('data-copy-text') || '';
          copyText(value).then(() => log('消息内容已复制')).catch(() => log('复制失败'));
        });
      }
      if (shouldStick) scrollWorkerOutputToBottom();
      else updateWorkerOutputScrollButton();
    }

    function setWorkerOutputEmptyState(detail) {
      const root = $('workerOutput');
      if (!root) return;
      root.className = 'output-box message-preview empty';
      root.innerHTML =
        '<div class="chat-empty-state">' +
          '<b>准备接收智能体输出</b>' +
          '<span>' + escapeHtml(detail || '读取 session history、连接实时事件或启动 mission 后，这里会显示 Markdown、代码块、tool pills 和 checkpoint。') + '</span>' +
          '<div class="actions"><button class="mini empty-load-history" type="button">读取历史</button><button class="mini empty-connect-live" type="button">连接实时</button><button class="mini empty-create-mission" type="button">新建 Mission</button></div>' +
        '</div>';
      const history = root.querySelector('.empty-load-history');
      const live = root.querySelector('.empty-connect-live');
      const mission = root.querySelector('.empty-create-mission');
      if (history) history.addEventListener('click', loadSessionHistory);
      if (live) live.addEventListener('click', connectSessionEvents);
      if (mission) mission.addEventListener('click', () => {
        const input = $('missionInput');
        if (input) {
          input.focus();
          input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    }

    function isWorkerOutputNearBottom() {
      const root = $('workerOutput');
      if (!root) return true;
      return root.scrollHeight - root.scrollTop - root.clientHeight < 32;
    }

    function scrollWorkerOutputToBottom() {
      const root = $('workerOutput');
      if (!root) return;
      root.scrollTop = root.scrollHeight;
      state.workerOutputPinnedToBottom = true;
      updateWorkerOutputScrollButton();
    }

    function updateWorkerOutputScrollButton() {
      const button = $('workerOutputScrollBtn');
      const root = $('workerOutput');
      if (!button || !root) return;
      const canScroll = root.scrollHeight > root.clientHeight + 8;
      const nearBottom = isWorkerOutputNearBottom();
      state.workerOutputPinnedToBottom = nearBottom;
      button.classList.toggle('visible', canScroll && !nearBottom);
    }

    function renderMessageCard(input = {}) {
      const text = String(input.text || '');
      const traceItems = Array.isArray(input.traceItems) ? input.traceItems : [];
      const pillHtml = renderMessagePills(text, traceItems);
      const toolDetailsHtml = renderMessageToolDetails(traceItems);
      const streaming = Boolean(input.streaming);
      return '' +
        '<article class="message-card">' +
          '<div class="message-card-head">' +
            '<b>' + escapeHtml(input.title || input.role || 'message') + '</b>' +
            '<div class="actions">' +
              (streaming ? '<span class="streaming-indicator">streaming</span>' : (input.meta ? '<span class="tag">' + escapeHtml(input.meta) + '</span>' : '')) +
              '<button class="mini" type="button" data-copy-text="' + escapeAttr(text) + '">复制</button>' +
            '</div>' +
          '</div>' +
          (pillHtml ? '<div class="message-pill-row">' + pillHtml + '</div>' : '') +
          toolDetailsHtml +
          '<div class="message-body">' + renderSafeMarkdown(text) + (streaming ? '<span class="streaming-cursor" aria-hidden="true"></span>' : '') + '</div>' +
        '</article>';
    }

    function renderMessagePills(text, traceItems) {
      const pills = [];
      const checkpointMatch = text.match(/STATE:\\s*([A-Z_]+)/);
      if (checkpointMatch) pills.push({ kind: 'checkpoint', label: 'checkpoint ' + checkpointMatch[1] });
      if (/BLOCKER:\\s*(?!none)/i.test(text)) pills.push({ kind: 'checkpoint', label: 'blocker' });
      for (const trace of traceItems.slice(0, 4)) {
        const kind = trace.kind || 'tool';
        const label = (trace.title || trace.status || kind).slice(0, 42);
        pills.push({ kind: kind === 'checkpoint' ? 'checkpoint' : 'tool', label: kind + ': ' + label });
      }
      return pills.map((pill) => '<span class="message-pill ' + escapeAttr(pill.kind) + '">' + escapeHtml(pill.label) + '</span>').join('');
    }

    function renderMessageToolDetails(traceItems) {
      const items = (Array.isArray(traceItems) ? traceItems : [])
        .filter((trace) => trace && ['tool', 'tool-result', 'command', 'file', 'checkpoint', 'error'].includes(trace.kind || ''))
        .slice(0, 8);
      if (!items.length) return '';
      return '<div class="message-tool-details">' + items.map((trace, index) => {
        const detail = formatTraceDetail(trace);
        const title = formatTraceTitle(trace);
        const open = index === 0 && (trace.kind === 'tool' || trace.kind === 'tool-result') ? ' open' : '';
        return '' +
          '<details class="message-tool-detail ' + escapeAttr(trace.kind || 'event') + '"' + open + '>' +
            '<summary><span><b>' + escapeHtml(title) + '</b></span><span class="tag">' + escapeHtml(trace.status || trace.source || 'observed') + '</span></summary>' +
            '<pre>' + escapeHtml(detail || '-') + '</pre>' +
            '<div class="actions"><button class="mini" type="button" data-copy-text="' + escapeAttr(detail) + '">复制详情</button></div>' +
          '</details>';
      }).join('') + '</div>';
    }

    function formatTraceTitle(trace = {}) {
      const kind = trace.kind || 'event';
      const title = trace.title || trace.status || kind;
      return kind + ': ' + String(title).slice(0, 80);
    }

    function formatTraceDetail(trace = {}) {
      return [
        'kind: ' + (trace.kind || 'event'),
        'title: ' + (trace.title || '-'),
        'status: ' + (trace.status || '-'),
        'source: ' + (trace.source || '-'),
        trace.at ? 'at: ' + trace.at : '',
        trace.sessionPath ? 'session: ' + trace.sessionPath : '',
        trace.messageId ? 'message: ' + trace.messageId : '',
        '',
        trace.detail || '-'
      ].filter((line, index) => index === 7 || line).join('\\n');
    }

    function renderSafeMarkdown(text) {
      const normalized = String(text || '').replace(/\\r\\n/g, '\\n');
      const fence = String.fromCharCode(96, 96, 96);
      const parts = normalized.split(fence);
      let html = '';
      for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        if (index % 2 === 1) {
          const lines = part.replace(/^\\n/, '').split('\\n');
          const language = (lines[0] || '').trim().slice(0, 32);
          const hasLanguage = /^[A-Za-z0-9_+.-]{1,32}$/.test(language);
          const code = (hasLanguage ? lines.slice(1) : lines).join('\\n').replace(/\\n$/, '');
          html += renderCodeBlock(code, hasLanguage ? language : 'text');
        } else {
          html += renderMarkdownText(part);
        }
      }
      return html || '<p><em>empty</em></p>';
    }

    function renderCodeBlock(code, language) {
      return '' +
        '<div class="message-code">' +
          '<div class="message-code-head"><span>' + escapeHtml(language || 'text') + '</span><button class="mini" type="button" data-copy-text="' + escapeAttr(code) + '">复制代码</button></div>' +
          '<pre><code>' + escapeHtml(code || '') + '</code></pre>' +
        '</div>';
    }

    function renderMarkdownText(text) {
      const lines = String(text || '').split('\\n');
      const html = [];
      let list = [];
      const flushList = () => {
        if (!list.length) return;
        html.push('<ul>' + list.map((item) => '<li>' + inlineMarkdown(item) + '</li>').join('') + '</ul>');
        list = [];
      };
      for (const raw of lines) {
        const line = raw.trimEnd();
        if (!line.trim()) {
          flushList();
          continue;
        }
        const thinking = line.match(/^\\s*(?:THINKING|REASONING):\\s*(.*)$/i);
        if (thinking) {
          flushList();
          html.push('<div class="message-thinking"><b>Thinking</b><br>' + inlineMarkdown(thinking[1] || '') + '</div>');
          continue;
        }
        const heading = line.match(/^#{1,3}\\s+(.+)$/);
        if (heading) {
          flushList();
          html.push('<h3>' + inlineMarkdown(heading[1]) + '</h3>');
          continue;
        }
        const bullet = line.match(/^[-*]\\s+(.+)$/);
        if (bullet) {
          list.push(bullet[1]);
          continue;
        }
        const quote = line.match(/^>\\s?(.+)$/);
        if (quote) {
          flushList();
          html.push('<blockquote>' + inlineMarkdown(quote[1]) + '</blockquote>');
          continue;
        }
        flushList();
        html.push('<p>' + inlineMarkdown(line) + '</p>');
      }
      flushList();
      return html.join('');
    }

    function inlineMarkdown(text) {
      const tick = String.fromCharCode(96);
      const inlineCode = new RegExp(tick + '([^' + tick + ']+)' + tick, 'g');
      return escapeHtml(String(text || ''))
        .replace(inlineCode, '<code>$1</code>')
        .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    }

    function renderWorkerOutput() {
      const root = $('workerOutput');
      if (!root) return;
      const assignment = getActiveAssignment();
      if (!assignment) {
        setWorkerOutputMessage({ empty: '选择 worker 或等待 checkpoint。' });
        return;
      }
      const lines = [
        assignment.label + ' / ' + assignment.state,
        '',
        assignment.output || assignment.result || assignment.task || '',
        assignment.blocker ? '\\nBLOCKER: ' + assignment.blocker : '',
        assignment.nextAction ? '\\nNEXT_ACTION: ' + assignment.nextAction : '',
        assignment.tokenCount ? '\\nTOKENS: ' + assignment.tokenCount : ''
      ].filter(Boolean);
      setWorkerOutputMessage({
        title: assignment.label || 'Worker Output',
        role: 'worker',
        text: lines.join('\\n'),
        meta: assignment.state || ''
      });
    }

    function getActiveAssignment() {
      const mission = state.activeMission;
      const assignments = mission && Array.isArray(mission.assignments) ? mission.assignments : [];
      return assignments.find((item) => item.id === state.activeAssignmentId) || assignments[0] || null;
    }

    async function showAssignmentBrief(assignmentId) {
      const mission = state.activeMission;
      const id = assignmentId || (getActiveAssignment() && getActiveAssignment().id);
      if (!mission || !id) {
        log('暂无 assignment brief 可查看');
        return;
      }
      try {
        const data = await requestJson(missionActionUrl(mission.id, 'assignments/' + encodeURIComponent(id) + '/brief'));
        state.activeAssignmentId = id;
        const text = data.yaml || safeStringify(data.brief || {});
        setWorkerOutputMessage({
          title: 'SwarmBrief',
          role: 'brief',
          text,
          meta: id
        });
        await copyText(text).catch(() => {});
        log('SwarmBrief 已显示并复制: ' + id);
      } catch (err) {
        log('读取 SwarmBrief 失败: ' + err.message);
      }
    }

    async function recordAssignmentBriefArtifact(assignmentId) {
      const mission = state.activeMission;
      const id = assignmentId || (getActiveAssignment() && getActiveAssignment().id);
      if (!mission || !id) {
        log('暂无 assignment brief 可记录');
        return;
      }
      try {
        const data = await requestJson(missionActionUrl(mission.id, 'assignments/' + encodeURIComponent(id) + '/brief/artifact'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        state.activeAssignmentId = id;
        state.runRecords.unshift(data.record);
        await loadRunRecords();
        setWorkerOutputMessage({
          title: data.record.title || 'SwarmBrief Artifact',
          role: 'artifact',
          text: data.record.content || data.yaml || '',
          meta: data.record.id
        });
        log('SwarmBrief 已记录为 artifact: ' + data.record.id);
        notifyWorkbench('complete', 'SwarmBrief artifact 已记录', data.record.title);
      } catch (err) {
        log('记录 SwarmBrief artifact 失败: ' + err.message);
        notifyWorkbench('failed', 'SwarmBrief artifact 记录失败', err.message);
      }
    }

    function firstLine(value) {
      return String(value || '').split(/\\r?\\n/).find((line) => line.trim()) || '';
    }

    function firstLines(value, count) {
      return String(value || '').split(/\\r?\\n/).slice(0, count || 20).join('\\n');
    }

    function formatBytes(value) {
      const bytes = Number(value) || 0;
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    }

    function safeStringify(value) {
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value || '');
      }
    }

    function renderOffice() {
      const root = $('officeView');
      if (!root) return;
      root.innerHTML = '';
      root.appendChild(renderSwarmHubCard());
      const desks = [
        [18, 34], [39, 34], [60, 34], [81, 34],
        [22, 58], [43, 58], [64, 58], [85, 58],
        [30, 80], [51, 80], [72, 80]
      ];
      desks.forEach((pos) => {
        const desk = document.createElement('div');
        desk.className = 'desk';
        desk.style.left = pos[0] + '%';
        desk.style.top = pos[1] + '%';
        root.appendChild(desk);
      });
      const mission = state.activeMission;
      const assignments = mission && Array.isArray(mission.assignments) ? mission.assignments : [];
      const workers = assignments.length
        ? assignments.map((assignment) => ({
            id: assignment.id,
            name: assignment.label,
            status: assignment.state,
            task: assignment.task,
            assignment
          }))
        : (state.workerCards || []).map((card) => ({
            id: card.id,
            name: card.name,
            status: card.status,
            task: card.activeTask ? card.activeTask.title : 'Awaiting mission',
            assignment: card.activeAssignment
          }));
      if (!workers.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.style.position = 'absolute';
        empty.style.left = '50%';
        empty.style.top = '50%';
        empty.style.transform = 'translate(-50%, -50%)';
        empty.textContent = 'Agent office will appear after Hana sessions or missions load.';
        root.appendChild(empty);
        return;
      }
      workers.slice(0, 8).forEach((worker, index) => {
        const pos = desks[index] || [20 + index * 10, 50];
        const el = document.createElement('div');
        el.className = 'worker ' + escapeHtml(worker.status || 'idle');
        el.style.left = pos[0] + 4 + '%';
        el.style.top = pos[1] - 8 + '%';
        el.innerHTML =
          '<div class="worker-avatar">' + escapeHtml(workerInitial(worker.name, index)) + '</div>' +
          '<b>' + escapeHtml(worker.name || worker.id) + '</b>' +
          '<small>' + escapeHtml(worker.status || 'idle') + '</small>';
        if (worker.assignment && worker.assignment.id) {
          el.addEventListener('click', () => {
            state.activeAssignmentId = worker.assignment.id;
            renderAssignments();
            renderWorkerOutput();
            loadWorkerDrilldown(worker.assignment.id);
          });
        }
        root.appendChild(el);
      });
    }

    function renderSwarmHubCard() {
      const hub = document.createElement('div');
      hub.className = 'swarm-hub-card';
      const agentId = $('agentSelect') ? $('agentSelect').value : '';
      const agent = state.agents.find((item) => item.id === agentId) || state.agents[0] || {};
      const mission = state.activeMission || {};
      const assignments = Array.isArray(mission.assignments) ? mission.assignments : [];
      const workerCards = Array.isArray(state.workerCards) ? state.workerCards : [];
      const activeWorkers = assignments.length
        ? assignments.filter((item) => !['done', 'cancelled', 'idle'].includes(String(item.state || '').toLowerCase())).length
        : workerCards.filter((item) => !['done', 'cancelled', 'idle', 'offline'].includes(String(item.status || '').toLowerCase())).length;
      const blockers = [
        ...assignments.filter((item) => String(item.state || '').toLowerCase() === 'blocked' || item.blocker).map((item) => item.blocker || item.label || item.id),
        ...((state.inbox && Array.isArray(state.inbox.items)) ? state.inbox.items.filter((item) => ['blocker', 'needs_input', 'approval'].includes(String(item.kind || item.type || '').toLowerCase())).map((item) => item.title || item.label || item.id) : [])
      ].filter(Boolean);
      const lanes = assignments.length
        ? assignments.map((item) => item.label || item.roleId || item.id)
        : workerCards.map((item) => item.name || item.role || item.id);
      const rooms = new Set([
        ...assignments.map((item) => item.sessionPath).filter(Boolean),
        ...workerCards.flatMap((item) => Array.isArray(item.sessions) ? item.sessions.map((session) => session.path || session.id) : []).filter(Boolean)
      ]);
      const missionTitle = mission.title || $('missionInput')?.value || 'No active mission';
      hub.innerHTML =
        '<div class="swarm-hub-main">' +
          '<div class="swarm-hub-avatar">' + escapeHtml(workerInitial(agent.name || agent.id || 'Hub', 0)) + '</div>' +
          '<div class="swarm-hub-title">' +
            '<b>' + escapeHtml(agent.name || agent.id || 'Hanaco Hub') + '</b>' +
            '<span>' + escapeHtml('orchestrator / ' + missionTitle) + '</span>' +
            '<span>' + escapeHtml('lanes: ' + (lanes.slice(0, 5).join(' / ') || '-')) + '</span>' +
          '</div>' +
          '<div class="swarm-hub-metrics">' +
            '<span class="tag">' + escapeHtml('swarm ' + String(assignments.length || workerCards.length || 0)) + '</span>' +
            '<span class="tag">' + escapeHtml('active ' + String(activeWorkers)) + '</span>' +
            '<span class="tag">' + escapeHtml('rooms ' + String(rooms.size)) + '</span>' +
            '<span class="tag">' + escapeHtml('blockers ' + String(blockers.length)) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="swarm-hub-wires">' +
          swarmHubWire('Route', mission.state || mission.phase || 'standby') +
          swarmHubWire('Monitor', blockers[0] || 'clear') +
          swarmHubWire('Collaborate', String(rooms.size) + ' session room(s)') +
          swarmHubWire('Topology', String(lanes.length) + ' lane(s)') +
        '</div>' +
        '<div class="swarm-hub-actions">' +
          '<button id="swarmHubRouteBtn" class="mini" type="button">Route Mission</button>' +
          '<button id="swarmHubAutopilotBtn" class="mini" type="button">Autopilot</button>' +
          '<button id="swarmHubInboxBtn" class="mini" type="button">Inbox</button>' +
          '<button id="swarmHubRefreshBtn" class="mini" type="button">Refresh</button>' +
        '</div>';
      setTimeout(() => bindSwarmHubActions(), 0);
      return hub;
    }

    function swarmHubWire(title, detail) {
      return '<div class="swarm-hub-wire"><b>' + escapeHtml(title) + '</b><span>' + escapeHtml(detail || '-') + '</span></div>';
    }

    function bindSwarmHubActions() {
      const route = $('swarmHubRouteBtn');
      const autopilot = $('swarmHubAutopilotBtn');
      const inbox = $('swarmHubInboxBtn');
      const refresh = $('swarmHubRefreshBtn');
      if (route) route.onclick = () => dispatchActiveMission();
      if (autopilot) autopilot.onclick = () => runAutopilot('preview');
      if (inbox) inbox.onclick = () => loadMissionInbox();
      if (refresh) refresh.onclick = () => loadState();
    }

    function workerInitial(name, index) {
      const text = String(name || '').trim();
      if (!text) return String(index + 1);
      return text.slice(0, 1).toUpperCase();
    }

    function renderMissionHistory() {
      const root = $('missionHistory');
      if (!root) return;
      root.innerHTML = '';
      if (!state.missions.length) {
        root.innerHTML = '<div class="empty">暂无 mission</div>';
        return;
      }
      for (const mission of state.missions.slice(0, 8)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'item';
        item.innerHTML =
          '<b>' + escapeHtml(mission.title) + '</b>' +
          '<span>' + escapeHtml(mission.state + ' / ' + formatTaskTime(mission.updatedAt)) + '</span>' +
          '<span>' + escapeHtml((mission.assignments || []).length + ' assignments') + '</span>';
        item.addEventListener('click', () => {
          state.activeMission = mission;
          renderConductor();
          renderMissionTimeline();
        });
        root.appendChild(item);
      }
    }

    function renderMissionTimeline() {
      const root = $('missionTimeline');
      if (!root) return;
      root.innerHTML = '';
      const mission = state.activeMission;
      const events = mission && Array.isArray(mission.events) ? mission.events : [];
      if (!events.length) {
        root.innerHTML = '<div class="empty">暂无事件</div>';
        return;
      }
      for (const event of events.slice().reverse().slice(0, 12)) {
        const el = document.createElement('div');
        el.className = 'event';
        el.innerHTML =
          '<b>' + escapeHtml(event.label || event.type) + '</b>' +
          '<span>' + escapeHtml((event.type || 'event') + ' / ' + formatTaskTime(event.at)) + '</span>';
        root.appendChild(el);
      }
    }

    function renderSwarmActivityPanel() {
      const root = $('swarmActivityPanel');
      if (!root) return;
      const items = Array.isArray(state.swarmActivity) ? state.swarmActivity : [];
      const summary = state.swarmActivitySummary || {};
      if (!items.length) {
        root.innerHTML = '<div class="empty">暂无 Recent Swarm Activity。Mission events、checkpoints、Run Console records、worker cards 和 jobs 会聚合到这里。</div>';
        return;
      }
      root.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'item';
      head.innerHTML =
        '<b>' + escapeHtml('Recent swarm activity / ' + String(summary.total || items.length) + ' entries') + '</b>' +
        '<span>' + escapeHtml('blockers ' + String(summary.blockers || 0) + ' / review ' + String(summary.review || 0) + ' / latest ' + (summary.latestAt ? formatTaskTime(summary.latestAt) : '-')) + '</span>' +
        '<span>' + escapeHtml(renderSwarmActivityKinds(summary.byKind || {})) + '</span>';
      root.appendChild(head);
      for (const activity of items.slice(0, 12)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'item swarm-activity-row';
        item.innerHTML =
          '<b>' + escapeHtml((activity.workerName || activity.workerId || activity.agentId || activity.source || 'swarm') + ' / ' + (activity.title || activity.kind || 'activity')) + '</b>' +
          '<span>' + escapeHtml((activity.kind || 'event') + ' / ' + (activity.status || '-') + ' / ' + (activity.at ? formatTaskTime(activity.at) : '-')) + '</span>' +
          '<span>' + escapeHtml(firstLine(activity.text || activity.source || '').slice(0, 180)) + '</span>' +
          '<span>' + escapeHtml([activity.missionTitle || activity.missionId, activity.assignmentId, activity.source].filter(Boolean).join(' / ')) + '</span>';
        item.addEventListener('click', () => openSwarmActivity(activity));
        root.appendChild(item);
      }
    }

    function renderSwarmActivityKinds(byKind) {
      const entries = Object.entries(byKind || {}).filter((entry) => entry[1]);
      if (!entries.length) return 'kinds: -';
      return 'kinds: ' + entries.slice(0, 6).map((entry) => entry[0] + ' ' + entry[1]).join(' / ');
    }

    function openSwarmActivity(activity) {
      if (!activity) return;
      const mission = state.missions.find((entry) => entry.id === activity.missionId);
      if (mission) {
        state.activeMission = mission;
        if (activity.assignmentId) state.activeAssignmentId = activity.assignmentId;
        renderConductor();
        renderMissionTimeline();
        renderInspectorPanel();
      }
      if (activity.workerId || activity.assignmentId || activity.agentId) {
        loadWorkerDrilldown(activity.workerId || activity.assignmentId || activity.agentId);
      }
      if (activity.text) {
        setWorkerOutputMessage({
          title: activity.title || 'Swarm Activity',
          role: activity.kind || 'activity',
          text: [
            activity.text,
            '',
            activity.missionTitle ? 'MISSION: ' + activity.missionTitle : '',
            activity.assignmentId ? 'ASSIGNMENT: ' + activity.assignmentId : '',
            activity.source ? 'SOURCE: ' + activity.source : ''
          ].filter(Boolean).join('\\n'),
          meta: activity.status || activity.kind || ''
        });
      }
      log('Swarm activity opened: ' + (activity.id || activity.title || activity.kind));
    }

    function renderWorkerArtifactsPanel() {
      const root = $('workerArtifactsPanel');
      if (!root) return;
      const items = Array.isArray(state.workerArtifacts) ? state.workerArtifacts : [];
      const summary = state.workerArtifactSummary || {};
      if (!items.length) {
        root.innerHTML = '<div class="empty">暂无 Worker Artifacts。Run Console artifacts、preview URL 和 worker changed files 会按 worker 聚合到这里。</div>';
        return;
      }
      root.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'item';
      head.innerHTML =
        '<b>' + escapeHtml('Worker artifacts / ' + String(summary.totalWorkers || items.length) + ' workers') + '</b>' +
        '<span>' + escapeHtml('artifacts ' + String(summary.artifacts || 0) + ' / previews ' + String(summary.previews || 0) + ' / changed files ' + String(summary.changedFiles || 0) + ' / latest ' + (summary.latestAt ? formatTaskTime(summary.latestAt) : '-')) + '</span>' +
        '<span>' + escapeHtml(renderSwarmActivityKinds(summary.byKind || {})) + '</span>';
      root.appendChild(head);
      for (const bucket of items.slice(0, 10)) {
        const artifacts = Array.isArray(bucket.artifacts) ? bucket.artifacts : [];
        const inferred = Array.isArray(bucket.syntheticArtifacts) ? bucket.syntheticArtifacts : [];
        const previews = Array.isArray(bucket.previews) ? bucket.previews : [];
        const item = document.createElement('article');
        item.className = 'item worker-artifact-card';
        item.innerHTML =
          '<b>' + escapeHtml((bucket.workerName || bucket.workerId || 'worker') + ' / ' + (bucket.missionTitle || bucket.missionId || bucket.assignmentId || 'workspace')) + '</b>' +
          '<span>' + escapeHtml('assignment ' + (bucket.assignmentId || '-') + ' / agent ' + (bucket.agentId || '-') + ' / updated ' + (bucket.updatedAt ? formatTaskTime(bucket.updatedAt) : '-')) + '</span>' +
          '<div class="artifact-chip-row">' +
            artifacts.slice(0, 6).map(renderWorkerArtifactChip).join('') +
            (!artifacts.length && inferred.length ? inferred.slice(0, 6).map(renderWorkerArtifactChip).join('') : '') +
            (artifacts.length + inferred.length > 6 ? '<span class="tag">+' + escapeHtml(String(artifacts.length + inferred.length - 6)) + ' more</span>' : '') +
          '</div>' +
          '<div class="artifact-chip-row">' +
            previews.slice(0, 4).map((preview) => '<button class="mini worker-preview-open" data-url="' + escapeAttr(preview.url || '') + '">' + escapeHtml(preview.label || preview.url || 'Preview') + '</button>').join('') +
            '<button class="mini worker-artifact-open">打开 Worker</button>' +
            '<button class="mini worker-artifact-copy">复制</button>' +
          '</div>';
        item.querySelector('.worker-artifact-open').addEventListener('click', () => openWorkerArtifactBucket(bucket));
        item.querySelector('.worker-artifact-copy').addEventListener('click', () => copyText(formatWorkerArtifactBucket(bucket)).then(() => log('Worker artifacts 已复制')));
        for (const button of item.querySelectorAll('.worker-preview-open')) {
          button.addEventListener('click', () => openPreviewUrl(button.dataset.url || ''));
        }
        root.appendChild(item);
      }
    }

    function renderWorkerArtifactChip(artifact) {
      return '<span class="tag artifact-chip" title="' + escapeAttr(artifact.path || artifact.summary || artifact.label || '') + '">' +
        escapeHtml((artifact.kind || 'file') + ': ' + (artifact.label || artifact.title || artifact.path || artifact.id || '-')) +
      '</span>';
    }

    function openWorkerArtifactBucket(bucket) {
      if (!bucket) return;
      if (bucket.missionId) {
        const mission = state.missions.find((entry) => entry.id === bucket.missionId);
        if (mission) {
          state.activeMission = mission;
          if (bucket.assignmentId) state.activeAssignmentId = bucket.assignmentId;
          renderConductor();
          renderMissionTimeline();
        }
      }
      loadWorkerDrilldown(bucket.workerId || bucket.assignmentId || bucket.agentId || '');
      setWorkerOutputMessage({
        title: 'Worker Artifacts',
        role: bucket.workerName || bucket.workerId || 'worker',
        text: formatWorkerArtifactBucket(bucket),
        meta: [bucket.missionTitle || bucket.missionId, bucket.assignmentId, bucket.agentId].filter(Boolean).join(' / ')
      });
      log('Worker artifacts opened: ' + (bucket.workerName || bucket.workerId || bucket.id));
    }

    function formatWorkerArtifactBucket(bucket) {
      const artifacts = [...(bucket.artifacts || []), ...(bucket.syntheticArtifacts || [])];
      const previews = bucket.previews || [];
      const changed = bucket.changedFiles || [];
      return [
        'WORKER: ' + (bucket.workerName || bucket.workerId || '-'),
        'MISSION: ' + (bucket.missionTitle || bucket.missionId || '-'),
        'ASSIGNMENT: ' + (bucket.assignmentId || '-'),
        'SESSION: ' + (bucket.sessionPath || '-'),
        '',
        'ARTIFACTS:',
        ...(artifacts.length ? artifacts.map((artifact) => '- ' + (artifact.kind || 'file') + ': ' + (artifact.label || artifact.title || artifact.path || artifact.id || '-') + (artifact.path ? ' / ' + artifact.path : '')) : ['- none']),
        '',
        'PREVIEWS:',
        ...(previews.length ? previews.map((preview) => '- ' + (preview.label || preview.id || 'Preview') + ': ' + (preview.url || '-')) : ['- none']),
        '',
        'CHANGED_FILES:',
        ...(changed.length ? changed.map((file) => '- ' + (file.relativePath || file.path || '-')) : ['- none'])
      ].join('\\n');
    }

    function renderApprovalsPanel() {
      const root = $('approvalsPanel');
      if (!root) return;
      const pending = Array.isArray(state.pendingApprovals) ? state.pendingApprovals : [];
      const history = Array.isArray(state.approvalHistory) ? state.approvalHistory : [];
      const summary = state.approvalSummary || {};
      if (!pending.length && !history.length) {
        root.innerHTML = '<div class="empty">暂无 Approvals。Run Console approval、Patch Review 和需要人工确认的 worker action 会进入这里。</div>';
        return;
      }
      root.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'item';
      const byRisk = summary.byRisk || {};
      head.innerHTML =
        '<b>' + escapeHtml('Approvals / ' + String(summary.pending || pending.length) + ' pending') + '</b>' +
        '<span>' + escapeHtml('approved ' + String(summary.approved || 0) + ' / denied ' + String(summary.denied || 0) + ' / high risk ' + String(byRisk.high || 0) + ' / latest ' + (summary.latestRequestedAt ? formatTaskTime(summary.latestRequestedAt) : '-')) + '</span>';
      root.appendChild(head);
      for (const approval of pending.slice(0, 8)) {
        const item = document.createElement('article');
        item.className = 'item approval-card pending';
        item.innerHTML =
          '<div class="task-row"><span class="status-chip partial">pending</span><span class="tag">' + escapeHtml(approval.risk || 'low') + '</span><span class="tag">' + escapeHtml(approval.toolName || approval.tool || 'approval') + '</span></div>' +
          '<b>' + escapeHtml((approval.agentName || approval.agentId || 'HanaAgent') + ' / ' + (approval.action || approval.id || 'Approval')) + '</b>' +
          '<span>' + escapeHtml((approval.missionTitle || approval.missionId || '-') + (approval.assignmentId ? ' / ' + approval.assignmentId : '') + ' / ' + (approval.requestedAt ? formatTaskTime(approval.requestedAt) : '-')) + '</span>' +
          '<pre>' + escapeHtml(firstLines(approval.context || approval.action || '', 5)) + '</pre>' +
          '<div class="actions"><button class="mini approval-open">打开</button><button class="mini approval-approve">批准</button><button class="mini danger approval-deny">拒绝</button></div>';
        item.querySelector('.approval-open').addEventListener('click', () => openApproval(approval));
        item.querySelector('.approval-approve').addEventListener('click', () => resolveApproval(approval.id, 'approve'));
        item.querySelector('.approval-deny').addEventListener('click', () => resolveApproval(approval.id, 'deny'));
        root.appendChild(item);
      }
      if (history.length) {
        const historyHead = document.createElement('div');
        historyHead.className = 'item';
        historyHead.innerHTML = '<b>Approval history</b><span>' + escapeHtml(String(history.length) + ' resolved approvals') + '</span>';
        root.appendChild(historyHead);
        for (const approval of history.slice(0, 5)) {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'item approval-card';
          item.innerHTML =
            '<b>' + escapeHtml((approval.status || '-') + ' / ' + (approval.action || approval.id || 'Approval')) + '</b>' +
            '<span>' + escapeHtml((approval.agentName || approval.agentId || 'HanaAgent') + ' / ' + (approval.resolvedAt ? formatTaskTime(approval.resolvedAt) : approval.requestedAt ? formatTaskTime(approval.requestedAt) : '-')) + '</span>' +
            '<span>' + escapeHtml(approval.context || approval.missionTitle || approval.missionId || '-') + '</span>';
          item.addEventListener('click', () => openApproval(approval));
          root.appendChild(item);
        }
      }
    }

    function openApproval(approval) {
      if (!approval) return;
      focusMissionReference(approval);
      if (approval.assignmentId || approval.workerId || approval.agentId) loadWorkerDrilldown(approval.assignmentId || approval.workerId || approval.agentId);
      setWorkerOutputMessage({
        title: 'Approval: ' + (approval.action || approval.id || ''),
        role: approval.status || 'approval',
        text: formatApprovalText(approval),
        meta: [approval.risk, approval.toolName || approval.tool, approval.missionTitle || approval.missionId].filter(Boolean).join(' / ')
      });
      log('Approval opened: ' + (approval.id || approval.action || 'approval'));
    }

    function formatApprovalText(approval) {
      return [
        'APPROVAL: ' + (approval.action || approval.id || '-'),
        'STATUS: ' + (approval.status || '-'),
        'RISK: ' + (approval.risk || '-'),
        'AGENT: ' + (approval.agentName || approval.agentId || '-'),
        'MISSION: ' + (approval.missionTitle || approval.missionId || '-'),
        'ASSIGNMENT: ' + (approval.assignmentId || '-'),
        'SESSION: ' + (approval.sessionPath || '-'),
        '',
        approval.context || JSON.stringify(approval.input || approval.meta || {}, null, 2)
      ].join('\\n');
    }

    function focusMissionReference(input = {}) {
      const missionId = input.missionId || ((input.type === 'mission' || input.kind === 'mission') ? input.id : '');
      if (!missionId) return null;
      const mission = state.missions.find((entry) => entry.id === missionId);
      if (!mission) return null;
      state.activeMission = mission;
      if (input.assignmentId) state.activeAssignmentId = input.assignmentId;
      renderConductor();
      renderMissionTimeline();
      renderMissionHistory();
      return mission;
    }

    function openTaskFromReference(input = {}) {
      const taskId = input.taskId || (input.type === 'task' || input.kind === 'task' ? input.id : '');
      if (!taskId) return false;
      const task = state.tasks.find((entry) => entry.id === taskId || entry.taskId === taskId);
      if (!task) return false;
      focusMissionReference({ missionId: task.missionId || input.missionId, assignmentId: task.assignmentId || input.assignmentId });
      renderBoard();
      openTaskEditor(task);
      log('Task opened: ' + (task.title || task.id));
      return true;
    }

    function findRunRecordById(recordId) {
      if (!recordId) return null;
      return (Array.isArray(state.runRecords) ? state.runRecords : []).find((record) => record.id === recordId || record.recordId === recordId) || null;
    }

    function findApprovalById(approvalId) {
      if (!approvalId) return null;
      const approvals = [
        ...(Array.isArray(state.approvals) ? state.approvals : []),
        ...(Array.isArray(state.pendingApprovals) ? state.pendingApprovals : []),
        ...(Array.isArray(state.approvalHistory) ? state.approvalHistory : [])
      ];
      return approvals.find((approval) => approval.id === approvalId || approval.approvalId === approvalId || approval.recordId === approvalId) || null;
    }

    function approvalFromRunRecord(record = {}) {
      return {
        id: record.id || record.recordId || '',
        approvalId: record.id || record.recordId || '',
        action: record.title || record.summary || 'Approval required',
        status: record.state || 'pending',
        risk: record.risk || (record.meta && record.meta.risk) || '',
        tool: record.tool || (record.meta && record.meta.tool) || 'run-console',
        toolName: record.tool || (record.meta && record.meta.tool) || 'run-console',
        context: record.content || record.summary || record.path || '',
        input: record.meta && (record.meta.input || record.meta.patch || record.meta.suggestion),
        meta: record.meta || {},
        agentId: record.agentId || '',
        agentName: record.requester || record.agentId || 'HanaAgent',
        missionId: record.missionId || '',
        assignmentId: record.assignmentId || '',
        workerId: record.workerId || record.assignmentId || '',
        sessionPath: record.sessionPath || '',
        recordId: record.id || ''
      };
    }

    function openRunRecord(record) {
      if (!record) return;
      focusMissionReference(record);
      if (record.taskId) openTaskFromReference(record);
      if (record.assignmentId || record.workerId || record.agentId) loadWorkerDrilldown(record.assignmentId || record.workerId || record.agentId);
      if (record.type === 'approval') {
        openApproval(findApprovalById(record.id) || approvalFromRunRecord(record));
        return;
      }
      setWorkerOutputMessage({
        title: 'Run record: ' + (record.title || record.id || ''),
        role: record.type || 'run-record',
        text: formatRunRecordDetail(record),
        meta: [record.state, record.missionId, record.assignmentId, record.sessionPath].filter(Boolean).join(' / ')
      });
      log('Run record opened: ' + (record.title || record.id || 'record'));
    }

    function formatRunRecordDetail(record = {}) {
      return [
        'TYPE: ' + (record.type || '-'),
        'TITLE: ' + (record.title || '-'),
        'STATE: ' + (record.state || '-'),
        'MISSION: ' + (record.missionId || '-'),
        'ASSIGNMENT: ' + (record.assignmentId || '-'),
        'TASK: ' + (record.taskId || '-'),
        'SESSION: ' + (record.sessionPath || '-'),
        'PATH: ' + (record.path || '-'),
        '',
        record.content || record.summary || JSON.stringify(record.meta || {}, null, 2)
      ].join('\\n');
    }

    function renderAgendaPanel() {
      const root = $('agendaPanel');
      if (!root) return;
      const agenda = state.agenda || {};
      const summary = agenda.summary || {};
      const sections = agenda.sections || {};
      if (!agenda.ok) {
        root.innerHTML = '<div class="empty">刷新后显示需关注项、活跃 mission、今日任务、未来 Jobs、最近完成和 agent 状态。</div>';
        return;
      }
      root.innerHTML =
        '<div class="item"><b>' + escapeHtml((agenda.greeting || 'Agenda') + ' / attention ' + String(summary.attention || 0)) + '</b><span>' + escapeHtml('active ' + String(summary.active || 0) + ' / due today ' + String(summary.tasksDueToday || 0) + ' / upcoming ' + String(summary.upcoming || 0) + ' / completed ' + String(summary.completed || 0)) + '</span></div>' +
        renderAgendaSection('attention', 'Needs Attention', sections.attention, 'attention') +
        renderAgendaSection('active', 'Active Missions', sections.activeMissions, 'mission') +
        renderAgendaSection('tasks', 'Tasks Due Today', sections.tasksDueToday, 'task') +
        renderAgendaSection('upcoming', 'Upcoming Jobs', sections.upcomingJobs, 'job') +
        renderAgendaSection('completed', 'Recent Completions', sections.recentCompletions, 'completion') +
        renderAgendaSection('agents', 'Agent Statuses', sections.agentStatuses, 'agent');
      for (const button of root.querySelectorAll('[data-agenda-section]')) {
        button.addEventListener('click', () => toggleAgendaSection(button.dataset.agendaSection));
      }
      for (const button of root.querySelectorAll('[data-agenda-kind]')) {
        const item = findAgendaItem(button.dataset.agendaSectionId, button.dataset.agendaId, button.dataset.agendaKind);
        if (item) button.addEventListener('click', () => openAgendaItem(item, button.dataset.agendaKind || 'item'));
      }
    }

    function renderAgendaSection(sectionId, title, items, kind) {
      const list = Array.isArray(items) ? items : [];
      const open = state.agendaSections[sectionId] !== false;
      const tone = sectionId === 'attention' ? ' attention' : '';
      return '<section class="item agenda-section' + tone + '">' +
        '<button type="button" class="agenda-section-head" data-agenda-section="' + escapeAttr(sectionId) + '">' +
          '<b>' + escapeHtml(title) + '</b>' +
          '<span class="agenda-section-count">' + escapeHtml(String(list.length)) + '</span>' +
          '<span class="agenda-section-toggle">' + escapeHtml(open ? 'Hide' : 'Show') + '</span>' +
        '</button>' +
        (open ? '<div class="agenda-section-body">' +
          (list.length ? list.slice(0, 8).map((item) => renderAgendaItemButton(sectionId, item, kind)).join('') : '<button type="button" class="agenda-section-row" disabled>clear</button>') +
          (list.length > 8 ? '<button type="button" class="agenda-section-row" disabled>+' + escapeHtml(String(list.length - 8)) + ' more</button>' : '') +
        '</div>' : '') +
      '</section>';
    }

    function renderAgendaItemButton(sectionId, item, kind) {
      const id = agendaItemId(item, kind);
      return '<button type="button" class="agenda-section-row" data-agenda-section-id="' + escapeAttr(sectionId) + '" data-agenda-kind="' + escapeAttr(kind || '') + '" data-agenda-id="' + escapeAttr(id) + '">' +
        escapeHtml(formatAgendaItem(item, kind)) +
      '</button>';
    }

    function agendaItemId(item, kind) {
      if (!item) return '';
      if (kind === 'task') return item.id || item.taskId || item.title || '';
      if (kind === 'job') return item.id || item.jobId || item.name || item.title || '';
      if (kind === 'agent') return item.id || item.agentId || item.name || '';
      return item.id || item.missionId || item.assignmentId || item.title || '';
    }

    function findAgendaItem(sectionId, itemId, kind) {
      const sections = (state.agenda && state.agenda.sections) || {};
      const lists = {
        attention: sections.attention,
        active: sections.activeMissions,
        tasks: sections.tasksDueToday,
        upcoming: sections.upcomingJobs,
        completed: sections.recentCompletions,
        agents: sections.agentStatuses
      };
      const list = Array.isArray(lists[sectionId]) ? lists[sectionId] : [];
      return list.find((item) => agendaItemId(item, kind) === itemId) || null;
    }

    function toggleAgendaSection(sectionId) {
      if (!sectionId) return;
      state.agendaSections[sectionId] = state.agendaSections[sectionId] === false;
      renderAgendaPanel();
    }

    function formatAgendaItem(item, kind) {
      if (kind === 'agent') return (item.name || item.id || '-') + ' / ' + (item.status || '-');
      if (kind === 'job') return (item.name || item.title || item.id || '-') + ' / ' + (item.nextRunAt ? formatTaskTime(item.nextRunAt) : '-') + ' / ' + (item.schedule || '-');
      if (kind === 'task') return (item.title || item.id || '-') + ' / ' + (item.priority || '-') + ' / due ' + (item.dueDate || '-');
      return (item.title || item.id || '-') + ' / ' + (item.status || item.type || '-') + ' / ' + (item.at ? formatTaskTime(item.at) : item.startedAt ? formatTaskTime(item.startedAt) : item.completedAt ? formatTaskTime(item.completedAt) : '-');
    }

    function openAgendaItem(item, kind) {
      if (!item) return;
      focusMissionReference({ ...item, kind });
      if (kind === 'attention' && item.type === 'approval') {
        const approval = findApprovalById(item.id) || approvalFromRunRecord(findRunRecordById(item.id) || item);
        openApproval(approval);
        return;
      }
      if (kind === 'attention' && item.type === 'run') {
        const record = findRunRecordById(item.id);
        if (record) {
          openRunRecord(record);
          return;
        }
      }
      if (kind === 'task') {
        if (openTaskFromReference(item)) return;
      }
      if (kind === 'job') {
        openJobDetail(item.id || item.jobId);
        return;
      }
      if (kind === 'agent') {
        const workerId = item.id || item.agentId || item.name;
        if (workerId) loadWorkerDrilldown(workerId);
      } else if (item.assignmentId || item.workerId || item.agentId) {
        loadWorkerDrilldown(item.assignmentId || item.workerId || item.agentId);
      }
      setWorkerOutputMessage({
        title: 'Agenda item: ' + (item.title || item.name || item.id || kind || ''),
        role: kind || item.type || 'agenda',
        text: formatAgendaDetail(item, kind),
        meta: [item.status || item.type, item.missionId, item.assignmentId, item.nextRunAt || item.dueDate].filter(Boolean).join(' / ')
      });
      log('Agenda item opened: ' + (item.title || item.name || item.id || kind || 'item'));
    }

    function formatAgendaDetail(item, kind) {
      return [
        'KIND: ' + (kind || item.type || '-'),
        'TITLE: ' + (item.title || item.name || '-'),
        'STATUS: ' + (item.status || '-'),
        'MISSION: ' + (item.missionId || '-'),
        'ASSIGNMENT: ' + (item.assignmentId || '-'),
        'TASK: ' + (kind === 'task' ? (item.id || item.taskId || '-') : '-'),
        'JOB: ' + (kind === 'job' ? (item.id || item.jobId || '-') : '-'),
        'WHEN: ' + (item.at || item.startedAt || item.completedAt || item.nextRunAt || item.dueDate || '-'),
        'DETAIL: ' + (item.detail || item.schedule || item.priority || item.type || '-')
      ].join('\\n');
    }

    function renderCalendarPanel() {
      const root = $('calendarPanel');
      if (!root) return;
      const calendar = state.calendar || {};
      const events = Array.isArray(calendar.events) ? calendar.events : [];
      const rangeLabel = $('calendarRangeLabel');
      if (rangeLabel) rangeLabel.textContent = formatCalendarRangeLabel();
      if (!calendar.ok) {
        root.innerHTML = '<div class="empty">刷新后显示 Calendar events。Mission runs、scheduled jobs、task due dates 和 approvals 会聚合到这里。</div>';
        return;
      }
      const summary = calendar.summary || {};
      const mode = state.calendarMode || calendar.mode || 'week';
      root.innerHTML =
        '<div class="item"><b>Calendar / ' + escapeHtml(mode) + ' / ' + escapeHtml(String(events.length)) + ' events</b><span>' + escapeHtml((calendar.range?.start || '-') + ' -> ' + (calendar.range?.end || '-')) + '</span><span>' + escapeHtml('timezone ' + (calendar.timezone || workbenchSettings().calendarTimezone || 'local')) + '</span><span>missions ' + escapeHtml(String(summary.missions || 0)) + ' / jobs ' + escapeHtml(String(summary.jobs || 0)) + ' / tasks ' + escapeHtml(String(summary.tasks || 0)) + ' / approvals ' + escapeHtml(String(summary.approvals || 0)) + '</span></div>' +
        renderCalendarGrouped(events, mode);
      for (const item of root.querySelectorAll('[data-calendar-key]')) {
        const event = events.find((entry) => entry.key === item.dataset.calendarKey);
        if (event) item.addEventListener('click', () => openCalendarEvent(event));
      }
    }

    function renderCalendarGrouped(events, mode) {
      if (!events.length) return '<div class="empty">该范围没有 Calendar events。</div>';
      if (mode === 'day') return renderCalendarDay(events);
      return renderCalendarDays(events, mode === 'month' ? 35 : 7, mode === 'month' ? 'month' : 'week');
    }

    function renderCalendarDay(events) {
      const byHour = groupCalendarEventsByHour(events);
      return '<div class="calendar-grid day">' + Array.from({ length: 24 }, (_, hour) => {
        const items = byHour[String(hour)] || [];
        return '<div class="item calendar-hour"><b>' + escapeHtml(String(hour).padStart(2, '0') + ':00') + '</b><div class="calendar-hour-events">' +
          (items.length ? items.map(renderCalendarEventButton).join('') : '<span>clear</span>') +
        '</div></div>';
      }).join('') + '</div>';
    }

    function renderCalendarDays(events, visibleDays, mode) {
      const range = getCalendarQueryRange();
      const byDay = groupCalendarEventsByDayKey(events);
      const todayKey = calendarDayKey(new Date());
      const days = [];
      for (let index = 0; index < visibleDays; index += 1) {
        const day = addCalendarDays(range.start, index);
        if (day >= range.end) break;
        days.push(day);
      }
      return '<div class="calendar-grid ' + escapeHtml(mode || 'week') + '">' + days.map((day) => {
        const key = calendarDayKey(day);
        const items = byDay[key] || [];
        return '<div class="item calendar-day' + (key === todayKey ? ' today' : '') + '"><b>' + escapeHtml(formatCalendarDayLabel(day) + ' / ' + String(items.length)) + '</b>' +
          (items.length ? items.slice(0, mode === 'month' ? 4 : 8).map(renderCalendarEventButton).join('') : '<span>clear</span>') +
          (items.length > (mode === 'month' ? 4 : 8) ? '<div class="calendar-more">' + escapeHtml('+' + String(items.length - (mode === 'month' ? 4 : 8)) + ' more') + '</div>' : '') +
        '</div>';
      }).join('') + '</div>';
    }

    function renderCalendarEventButton(event) {
      const kind = event.type || 'event';
      const displayDate = event.localTime || (event.date ? formatCalendarDateTime(event.date) : '-');
      return '<button type="button" class="calendar-event calendar-event-' + escapeHtml(kind) + '" data-calendar-key="' + escapeHtml(event.key || '') + '">' +
        '<b>' + escapeHtml((event.title || event.id || '-') + ' / ' + kind) + '</b>' +
        '<span>' + escapeHtml(displayDate + ' / ' + (event.status || event.priority || calendarScheduleLabel(event.schedule) || '-')) + '</span>' +
        '<span>' + escapeHtml(event.detail || event.missionId || event.sessionPath || '') + '</span>' +
      '</button>';
    }

    function groupCalendarEventsByDayKey(events) {
      const grouped = {};
      for (const event of events) {
        const key = event.dayKey || calendarDayKey(new Date(event.date || 0));
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(event);
      }
      return grouped;
    }

    function groupCalendarEventsByHour(events) {
      const grouped = {};
      for (const event of events) {
        const match = String(event.localTime || '').match(/\s(\d{2}):\d{2}$/);
        const date = new Date(event.date || 0);
        const hour = match ? Number(match[1]) : Number.isNaN(date.getTime()) ? 0 : date.getHours();
        const key = String(hour);
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(event);
      }
      return grouped;
    }

    function formatCalendarRangeLabel() {
      const range = getCalendarQueryRange();
      return (state.calendarMode || 'week').toUpperCase() + ' / ' + formatCalendarDayLabel(range.start) + ' -> ' + formatCalendarDayLabel(addCalendarDays(range.end, -1));
    }

    function formatCalendarDayLabel(date) {
      return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', weekday: 'short' });
    }

    function formatCalendarDateTime(value) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value || '');
      return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour12: false, hour: '2-digit', minute: '2-digit' });
    }

    function calendarScheduleLabel(schedule) {
      if (!schedule) return '';
      if (typeof schedule === 'string') return schedule;
      return schedule.expression || schedule.type || '';
    }

    function calendarDayKey(date) {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'unknown';
      return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
    }

    function startOfCalendarDay(date) {
      return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    function addCalendarDays(date, days) {
      const next = new Date(date);
      next.setDate(next.getDate() + days);
      return next;
    }

    function getCalendarQueryRange() {
      const mode = state.calendarMode || 'week';
      const start = startOfCalendarDay(state.calendarCursor instanceof Date ? state.calendarCursor : new Date(state.calendarCursor || Date.now()));
      const end = addCalendarDays(start, mode === 'day' ? 1 : mode === 'month' ? 35 : 7);
      return { start, end };
    }

    function calendarUrl() {
      const range = getCalendarQueryRange();
      return addQuery(urls.calendar, {
        mode: state.calendarMode || 'week',
        start: range.start.toISOString(),
        end: range.end.toISOString(),
        timezone: workbenchSettings().calendarTimezone
      });
    }

    async function shiftCalendar(direction) {
      const mode = state.calendarMode || 'week';
      const days = mode === 'day' ? 1 : mode === 'month' ? 35 : 7;
      state.calendarCursor = addCalendarDays(state.calendarCursor, direction * days);
      renderCalendarPanel();
      await loadCalendar();
    }

    async function resetCalendarToday() {
      state.calendarCursor = startOfCalendarDay(new Date());
      renderCalendarPanel();
      await loadCalendar();
    }

    async function setCalendarMode(mode) {
      state.calendarMode = mode || 'week';
      state.calendarCursor = startOfCalendarDay(state.calendarCursor instanceof Date ? state.calendarCursor : new Date(state.calendarCursor || Date.now()));
      renderCalendarPanel();
      await loadCalendar();
    }

    function openCalendarEvent(event) {
      if (!event) return;
      focusMissionReference(event);
      if (event.type === 'task' && openTaskFromReference(event)) return;
      if (event.type === 'approval') {
        const approval = findApprovalById(event.id) || approvalFromRunRecord(findRunRecordById(event.id) || event);
        openApproval(approval);
        return;
      }
      if (event.type === 'job') {
        openJobDetail(event.id);
        return;
      }
      setWorkerOutputMessage({
        title: 'Calendar event: ' + (event.title || event.id || ''),
        role: event.type || 'calendar',
        text: formatCalendarEvent(event),
        meta: event.date || ''
      });
      log('Calendar event opened: ' + (event.id || event.title || 'event'));
    }

    function formatCalendarEvent(event) {
      return [
        'TYPE: ' + (event.type || '-'),
        'TITLE: ' + (event.title || '-'),
        'DATE: ' + (event.localTime || event.date || '-'),
        'TIMEZONE: ' + (event.timezone || state.calendar?.timezone || workbenchSettings().calendarTimezone || 'local'),
        'STATUS: ' + (event.status || '-'),
        'MISSION: ' + (event.missionId || '-'),
        'ASSIGNMENT: ' + (event.assignmentId || '-'),
        'DETAIL: ' + (event.detail || '-')
      ].join('\\n');
    }

    function renderMissionInboxPanel() {
      const root = $('missionInboxPanel');
      if (!root) return;
      const inbox = state.inbox || {};
      const items = Array.isArray(inbox.items) ? inbox.items : [];
      const summary = inbox.summary || state.inboxSummary || {};
      if (!items.length) {
        root.innerHTML = '<div class="empty">Inbox 会集中显示 blocker、待审批、待复核、handoff 和 Review Gate 风险。</div>';
        return;
      }
      root.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'item';
      head.innerHTML =
        '<b>' + escapeHtml('Open ' + String(summary.total || items.length) + ' / Critical ' + String(summary.critical || 0) + ' / Review ' + String(summary.review || 0)) + '</b>' +
        '<span>' + escapeHtml('blockers ' + String(summary.blockers || 0) + ' / approvals ' + String(summary.approvals || 0) + ' / needs input ' + String(summary.needsInput || 0) + ' / gate ' + String(summary.reviewGate || 0)) + '</span>';
      root.appendChild(head);
      for (const inboxItem of items.slice(0, 12)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'item';
        item.innerHTML =
          '<b>' + escapeHtml((inboxItem.severity || 'medium') + ' / ' + (inboxItem.title || inboxItem.kind || 'Inbox item')) + '</b>' +
          '<span>' + escapeHtml((inboxItem.missionTitle || inboxItem.missionId || '-') + (inboxItem.assignmentLabel ? ' / ' + inboxItem.assignmentLabel : '')) + '</span>' +
          '<span>' + escapeHtml(inboxItem.detail || inboxItem.action || '-') + '</span>';
        item.addEventListener('click', () => {
          const mission = state.missions.find((entry) => entry.id === inboxItem.missionId);
          if (mission) {
            state.activeMission = mission;
            if (inboxItem.assignmentId) state.activeAssignmentId = inboxItem.assignmentId;
            renderConductor();
            renderMissionTimeline();
          }
          if (inboxItem.assignmentId) loadWorkerDrilldown(inboxItem.assignmentId);
        });
        root.appendChild(item);
      }
    }

    function renderOperationsPanel() {
      const root = $('operationsPanel');
      const select = $('operationPresetSelect');
      const profileSelect = $('operationProfileSelect');
      if (!root || !select || !profileSelect) return;
      const ops = state.operations || {};
      const presets = Array.isArray(state.operationPresets) && state.operationPresets.length
        ? state.operationPresets
        : (Array.isArray(ops.presets) ? ops.presets : []);
      const profiles = Array.isArray(state.operationProfiles) && state.operationProfiles.length
        ? state.operationProfiles
        : (Array.isArray(ops.profiles) ? ops.profiles : []);
      const previous = select.value || ops.recommendedPresetId || 'builder';
      select.innerHTML = '';
      for (const preset of presets) {
        const option = document.createElement('option');
        option.value = preset.id;
        option.textContent = preset.label + ' / ' + preset.role;
        select.appendChild(option);
      }
      if (presets.some((preset) => preset.id === previous)) select.value = previous;
      const previousProfile = profileSelect.value;
      profileSelect.innerHTML = '';
      for (const profile of profiles.filter((item) => !item.builtin)) {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = profile.label + ' / ' + profile.role;
        profileSelect.appendChild(option);
      }
      if (profiles.some((profile) => profile.id === previousProfile)) profileSelect.value = previousProfile;
      fillOperationProfileForm(profiles.find((profile) => profile.id === profileSelect.value) || null);
      const selected = presets.find((preset) => preset.id === select.value) || presets[0] || null;
      if (selected && $('operationWorkersInput')) $('operationWorkersInput').value = String(selected.maxWorkers || 4);
      root.innerHTML = '';
      if (!ops.ok && !presets.length) {
        root.innerHTML = '<div class="empty">Operations 会显示 profile presets、队伍健康度和 setup gap。</div>';
        return;
      }
      const metrics = ops.metrics || {};
      const head = document.createElement('div');
      head.className = 'item';
      head.innerHTML =
        '<b>' + escapeHtml('Readiness ' + String(ops.readiness || 0) + '% / ' + (ops.status || 'unknown')) + '</b>' +
        '<span>' + escapeHtml('agents ' + String(metrics.agents || 0) + ' / sessions ' + String(metrics.sessions || 0) + ' / workers ' + String(metrics.workers || 0) + ' / active ' + String(metrics.activeWorkers || 0)) + '</span>' +
        '<span>' + escapeHtml('blockers ' + String(metrics.blockers || 0) + ' / approvals ' + String(metrics.pendingApprovals || 0) + ' / autopilot ' + (metrics.autopilotEnabled ? 'on' : 'off')) + '</span>';
      root.appendChild(head);
      if (selected) {
        const presetEl = document.createElement('div');
        presetEl.className = 'item';
        presetEl.innerHTML =
          '<b>' + escapeHtml(selected.label + ' / ' + selected.role) + '</b>' +
          '<span>' + escapeHtml(selected.mission) + '</span>' +
          '<span>' + escapeHtml('roles: ' + (selected.roles || []).join(', ') + ' / tags: ' + (selected.tags || []).join(', ')) + '</span>';
        root.appendChild(presetEl);
      }
      const saved = profiles.filter((profile) => !profile.builtin).slice(0, 6);
      for (const profile of saved) {
        const permissions = profile.permissions || {};
        const enabledPermissions = Object.keys(permissions).filter((key) => permissions[key]);
        const rosterHints = (profile.lanes || []).map((lane) => {
          const bits = [lane.roleId + (lane.agentId ? '@' + lane.agentId : '')];
          if (lane.model) bits.push(lane.model);
          if (Array.isArray(lane.tools) && lane.tools.length) bits.push('tools:' + lane.tools.slice(0, 3).join('/'));
          if (Array.isArray(lane.greenlightRequiredFor) && lane.greenlightRequiredFor.length) bits.push('gate:' + lane.greenlightRequiredFor.slice(0, 2).join('/'));
          return bits.join(' ');
        });
        const profileEl = document.createElement('div');
        profileEl.className = 'item';
        profileEl.innerHTML =
          '<b>' + escapeHtml('Saved: ' + profile.label + ' / ' + profile.role) + '</b>' +
          '<span>' + escapeHtml(profile.mission) + '</span>' +
          '<span>' + escapeHtml('visibility: ' + (profile.visibility || 'private') + ' / permissions: ' + enabledPermissions.join(', ')) + '</span>' +
          '<span>' + escapeHtml('lanes: ' + rosterHints.join(', ')) + '</span>' +
          '<span>' + escapeHtml('shared: ' + ((profile.sharedWith || []).map((entry) => entry.type + ':' + entry.id + ':' + entry.role).join(', ') || '-')) + '</span>';
        root.appendChild(profileEl);
      }
      const missing = (Array.isArray(ops.checks) ? ops.checks : []).filter((check) => !check.available).slice(0, 6);
      if (missing.length) {
        const gap = document.createElement('div');
        gap.className = 'item';
        gap.innerHTML =
          '<b>' + escapeHtml('Needs setup') + '</b>' +
          '<span>' + escapeHtml(missing.map((item) => item.id).join(', ')) + '</span>';
        root.appendChild(gap);
      }
    }

    function fillOperationProfileForm(profile) {
      if (!profile) return;
      if ($('operationProfileNameInput')) $('operationProfileNameInput').value = profile.label || '';
      if ($('operationVisibilitySelect')) $('operationVisibilitySelect').value = profile.visibility || 'private';
      if ($('operationPermissionsInput')) {
        const permissions = profile.permissions || {};
        $('operationPermissionsInput').value = Object.keys(permissions).filter((key) => permissions[key]).join(', ');
      }
      if ($('operationSharedWithInput')) {
        $('operationSharedWithInput').value = (profile.sharedWith || []).map((entry) => entry.type + ':' + entry.id + ':' + entry.role).join(', ');
      }
      if ($('operationWorkersInput')) $('operationWorkersInput').value = String(profile.maxWorkers || 4);
    }

    function parseOperationPermissions() {
      const raw = $('operationPermissionsInput') ? $('operationPermissionsInput').value : '';
      const enabled = new Set(raw.split(',').map((item) => item.trim()).filter(Boolean));
      return {
        dispatch: !enabled.size || enabled.has('dispatch'),
        edit: !enabled.size || enabled.has('edit'),
        manageApprovals: enabled.has('manageApprovals') || enabled.has('approvals'),
        manageAutopilot: enabled.has('manageAutopilot') || enabled.has('autopilot'),
        terminal: enabled.has('terminal'),
        files: enabled.has('files'),
        share: enabled.has('share')
      };
    }

    function parseOperationSharedWith() {
      const raw = $('operationSharedWithInput') ? $('operationSharedWithInput').value : '';
      return raw.split(',').map((item) => item.trim()).filter(Boolean).map((item) => {
        const parts = item.split(':').map((part) => part.trim()).filter(Boolean);
        if (parts.length === 1) return { type: 'user', id: parts[0], role: 'viewer' };
        return { type: parts[0] || 'user', id: parts[1] || '', role: parts[2] || 'viewer' };
      }).filter((entry) => entry.id);
    }

    function renderSetupDoctorPanel() {
      const root = $('setupDoctorPanel');
      if (!root) return;
      const doctor = state.setupDoctor || {};
      const checks = Array.isArray(doctor.checks) ? doctor.checks : [];
      root.innerHTML = '';
      if (!checks.length) {
        root.innerHTML = '<div class="empty">Setup Doctor 会检查模型、会话、文件根目录和宿主运行能力。</div>';
        return;
      }
      const head = document.createElement('div');
      head.className = 'item';
      const tour = onboardingState();
      head.innerHTML =
        '<b>' + escapeHtml('Setup ' + String(doctor.readiness || 0) + '% / ' + (doctor.status || 'unknown')) + '</b>' +
        '<span>' + escapeHtml('blocking ' + String(doctor.summary?.blocking || 0) + ' / warn ' + String(doctor.summary?.warn || 0) + ' / pass ' + String(doctor.summary?.pass || 0)) + '</span>' +
        '<span>' + escapeHtml(doctor.nextAction || '-') + '</span>' +
        '<span>' + escapeHtml('tour: ' + (tour.completed ? 'complete' : tour.dismissed ? 'dismissed' : 'open') + ' / step ' + String((tour.lastStep || 0) + 1) + '/' + String(onboardingSteps.length)) + '</span>';
      root.appendChild(head);
      for (const check of checks) {
        const status = check.status || 'warn';
        const el = document.createElement('div');
        el.className = 'item';
        const repair = check.repair || null;
        el.innerHTML =
          '<span class="status-chip ' + escapeHtml(status === 'pass' ? 'implemented' : status === 'fail' ? 'blocked' : 'partial') + '">' + escapeHtml(status) + '</span>' +
          '<b>' + escapeHtml(check.label || check.id || 'check') + '</b>' +
          '<span>' + escapeHtml(check.detail || '') + '</span>' +
          '<span>' + escapeHtml(check.action || '') + '</span>' +
          (repair && repair.type ? '<div class="actions"><button class="mini setup-repair" type="button">' + escapeHtml(repair.label || '打开') + '</button></div>' : '');
        const repairButton = el.querySelector('.setup-repair');
        if (repairButton) repairButton.addEventListener('click', () => runSetupDoctorRepair(check));
        root.appendChild(el);
      }
    }

    async function runSetupDoctorRepair(check) {
      const repair = check && check.repair ? check.repair : null;
      if (!repair || !repair.type) return;
      try {
        if (repair.type === 'open-provider-setup') {
          jumpToMobileSection(repair.target || 'providerSetupPanel');
          await loadProviderSetup({ silent: true });
          openModelChooser({ refreshSuggestions: true }).catch(() => {});
        } else if (repair.type === 'open-model-chooser') {
          await openModelChooser({ refreshSuggestions: true });
        } else if (repair.type === 'create-worker-session') {
          jumpToMobileSection('agentConfigPanel');
          await createWorkerSession();
        } else if (repair.type === 'reload-sessions') {
          await reloadSessions();
          jumpToMobileSection('sessionSelect');
        } else if (repair.type === 'sync-history') {
          await syncCheckpointsFromHistory();
          jumpToMobileSection('checkpointList');
        } else if (repair.type === 'open-files') {
          jumpToMobileSection(repair.target || 'workspaceFileList');
          await loadWorkspaceRoots();
        } else if (repair.type === 'open-terminal') {
          jumpToMobileSection(repair.target || 'terminalOutput');
          await listSessionTerminals();
        } else if (repair.type === 'open-memory-skills') {
          jumpToMobileSection(repair.target || 'memoryEditor');
          loadMemoryEntries().catch(() => {});
          loadAgentSkills().catch(() => {});
        } else if (repair.type === 'open-operations') {
          jumpToMobileSection(repair.target || 'operationsPanel');
          await loadOperations();
        } else if (repair.type === 'reload-state') {
          await loadState();
        } else {
          jumpToMobileSection(repair.target || 'setupDoctorPanel');
        }
        log('Setup Doctor action: ' + (repair.label || repair.type));
      } catch (err) {
        const fallback = repair.fallback || null;
        if (fallback && fallback.type) {
          await runSetupDoctorRepair({ repair: fallback });
          return;
        }
        log('Setup Doctor action 失败: ' + err.message);
      }
    }

    function renderProviderSetupPanel() {
      const root = $('providerSetupPanel');
      if (!root) return;
      const setup = state.providerSetup || {};
      const providers = Array.isArray(setup.providers) ? setup.providers : [];
      root.innerHTML = '';
      if (!providers.length) {
        root.innerHTML = '<div class="empty">刷新后显示 Hermes Provider Setup 兼容向导：provider 状态、模型、用量、配置片段和 OpenHanako 安全提示。</div>';
        return;
      }
      const head = document.createElement('div');
      head.className = 'provider-setup-card';
      const summary = setup.summary || {};
      const connection = setup.connection || {};
      head.innerHTML =
        '<div class="provider-setup-head"><b>' + escapeHtml('Provider Setup / ' + (connection.label || connection.status || 'unknown')) + '</b><span class="tag">' + escapeHtml(setup.mode || 'openhanako-plugin') + '</span></div>' +
        '<span>' + escapeHtml('configured ' + String(summary.configured || 0) + ' / catalog ' + String(summary.catalog || providers.length) + ' / models ' + String(summary.models || 0) + ' / usage providers ' + String(summary.usageProviders || 0)) + '</span>' +
        '<span>' + escapeHtml(setup.note || 'Provider secrets are managed by OpenHanako host settings, not by the HanaAgent plugin UI.') + '</span>';
      root.appendChild(head);
      for (const provider of providers.slice(0, 12)) {
        const item = document.createElement('div');
        item.className = 'provider-setup-card';
        const status = provider.configured ? 'configured' : provider.discovered ? 'discovered' : provider.local ? 'local-ready' : 'setup-needed';
        const auth = Array.isArray(provider.authTypes) ? provider.authTypes.join(', ') : '';
        const models = Array.isArray(provider.models) ? provider.models.slice(0, 5).join(', ') : '';
        item.innerHTML =
          '<div class="provider-setup-head"><div><b>' + escapeHtml(provider.name || provider.id) + '</b><span>' + escapeHtml(provider.description || '') + '</span></div><span class="status-chip ' + escapeHtml(provider.configured ? 'implemented' : provider.discovered || provider.local ? 'partial' : 'blocked') + '">' + escapeHtml(status) + '</span></div>' +
          '<div class="model-choice-meta">' +
            '<span>' + escapeHtml('auth ' + (auth || '-')) + '</span>' +
            '<span>' + escapeHtml('models ' + String(provider.modelCount || 0)) + '</span>' +
            '<span>' + escapeHtml('tokens ' + String(provider.usage?.totalTokens || 0)) + '</span>' +
            '<span>' + escapeHtml(provider.source || 'catalog') + '</span>' +
          '</div>' +
          (models ? '<span>' + escapeHtml(models) + '</span>' : '<span>' + escapeHtml(provider.nextAction || 'Configure this provider through OpenHanako host settings, then refresh provider setup.') + '</span>') +
          '<pre class="provider-setup-snippet">' + escapeHtml(provider.configExample || '') + '</pre>' +
          '<div class="actions"><button class="mini copy-provider-config">复制片段</button><button class="mini pin-provider-model">Pin 首个模型</button><button class="mini open-provider-docs">Docs</button></div>';
        const copy = item.querySelector('.copy-provider-config');
        if (copy) copy.addEventListener('click', () => copyProviderSnippet(provider));
        const pin = item.querySelector('.pin-provider-model');
        if (pin) {
          pin.disabled = !(Array.isArray(provider.models) && provider.models.length);
          pin.addEventListener('click', () => pinProviderFirstModel(provider));
        }
        const docs = item.querySelector('.open-provider-docs');
        if (docs) {
          docs.disabled = !provider.docsUrl;
          docs.addEventListener('click', () => window.open(provider.docsUrl, '_blank', 'noopener'));
        }
        root.appendChild(item);
      }
    }

    async function loadProviderSetup(options = {}) {
      try {
        const sep = urls.providerSetup.includes('?') ? '&' : '?';
        const data = await requestJson(urls.providerSetup + sep + 'agent=' + encodeURIComponent(($('agentSelect') && $('agentSelect').value) || ''));
        state.providerSetup = data;
        renderProviderSetupPanel();
        if (!options.silent) log('Provider Setup 已刷新');
      } catch (err) {
        if (!options.silent) log('Provider Setup 刷新失败: ' + err.message);
      }
    }

    async function copyProviderSnippet(provider) {
      const text = provider?.configExample || (state.providerSetup && state.providerSetup.recommendedSnippet) || '';
      if (!text) {
        log('没有可复制的 provider 配置片段');
        return;
      }
      try {
        await copyText(text);
        log('Provider 配置片段已复制: ' + (provider?.id || 'all'));
      } catch (err) {
        log('复制 Provider 配置失败: ' + err.message);
      }
    }

    async function copyProviderSetupSnippet() {
      const text = state.providerSetup?.recommendedSnippet || '';
      if (!text) {
        await loadProviderSetup({ silent: true });
      }
      return copyProviderSnippet({ id: 'recommended', configExample: state.providerSetup?.recommendedSnippet || text });
    }

    async function pinProviderFirstModel(provider) {
      const model = Array.isArray(provider?.models) ? provider.models[0] : '';
      if (!model) return;
      await pinModelChoice({
        model,
        provider: provider.id || '',
        source: 'provider-setup',
        reason: 'Pinned from Provider Setup readiness panel.'
      });
      renderProviderSetupPanel();
    }

    async function reprobeProviderSetup() {
      try {
        await requestJson(urls.gatewayReprobe || urls.providerSetup, { method: 'POST' });
      } catch {}
      await loadProviderSetup();
      renderConnectionBanner();
    }

    async function loadOperations() {
      try {
        const data = await requestJson(urls.operations);
        state.operations = data.operations || null;
        state.operationPresets = state.operations && Array.isArray(state.operations.presets) ? state.operations.presets : state.operationPresets;
        state.operationProfiles = state.operations && Array.isArray(state.operations.profiles) ? state.operations.profiles : state.operationProfiles;
        renderOperationsPanel();
        log('Operations 已刷新');
      } catch (err) {
        log('Operations 刷新失败: ' + err.message);
      }
    }

    async function saveOperationProfile() {
      const presetId = $('operationPresetSelect').value || 'builder';
      const preset = (state.operationPresets || []).find((item) => item.id === presetId) || {};
      const label = $('operationProfileNameInput').value.trim() || ((preset.label || presetId) + ' Team');
      const agentId = $('agentSelect').value;
      const sessionPath = $('sessionSelect').value;
      const roles = Array.isArray(preset.roles) ? preset.roles.slice(0, Number($('operationWorkersInput').value || preset.maxWorkers || 4)) : [];
      try {
        const data = await requestJson(urls.operationProfiles, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || undefined,
            label,
            role: preset.role || 'Operations',
            mission: $('missionInput').value.trim() || preset.mission || '',
            roles,
            maxWorkers: Number($('operationWorkersInput').value || preset.maxWorkers || 4) || 4,
            tags: preset.tags || [],
            presetId,
            visibility: $('operationVisibilitySelect') ? $('operationVisibilitySelect').value : 'private',
            permissions: parseOperationPermissions(),
            sharedWith: parseOperationSharedWith(),
            defaultAgentId: agentId,
            defaultSessionPath: sessionPath,
            lanes: roles.map((roleId) => ({ id: roleId, roleId, label: roleId, agentId, sessionPath }))
          })
        });
        if (data.profile) {
          state.operationProfiles = [data.profile, ...state.operationProfiles.filter((profile) => profile.id !== data.profile.id)];
          if ($('operationProfileSelect')) $('operationProfileSelect').value = data.profile.id;
        }
        renderOperationsPanel();
        log('Operations profile 已保存: ' + label);
      } catch (err) {
        log('保存 Operations profile 失败: ' + err.message);
      }
    }

    async function exportOperationProfile() {
      const profileId = $('operationProfileSelect').value;
      if (!profileId) {
        log('请先选择一个 Operations profile');
        return;
      }
      window.open(urls.operationProfiles + '/' + encodeURIComponent(profileId) + '/export', '_blank', 'noopener');
      log('Operations profile 导出已打开: ' + profileId);
    }

    async function exportSwarmRoster(format) {
      const profileId = $('operationProfileSelect').value;
      if (!profileId) {
        log('请先选择一个 Operations profile');
        return;
      }
      const sep = urls.operationProfiles.includes('?') ? '&' : '?';
      window.open(urls.operationProfiles + '/' + encodeURIComponent(profileId) + '/swarm-roster' + sep + 'download=1&format=' + encodeURIComponent(format || 'json'), '_blank', 'noopener');
      log('Swarm roster 导出已打开: ' + profileId + ' / ' + (format || 'json'));
    }

    async function importOperationProfile() {
      const raw = $('operationImportInput') ? $('operationImportInput').value.trim() : '';
      if (!raw) {
        log('请先粘贴 Profile JSON');
        return;
      }
      let bundle;
      try {
        bundle = JSON.parse(raw);
      } catch (err) {
        log('Profile JSON 解析失败: ' + err.message);
        return;
      }
      try {
        const data = await requestJson(urls.operationProfiles + '/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bundle,
            overwrite: $('operationImportOverwriteInput') ? $('operationImportOverwriteInput').checked : false
          })
        });
        if (data.profile) {
          state.operationProfiles = [data.profile, ...state.operationProfiles.filter((profile) => profile.id !== data.profile.id)];
          if ($('operationProfileSelect')) $('operationProfileSelect').value = data.profile.id;
          if ($('operationImportInput')) $('operationImportInput').value = '';
        }
        renderOperationsPanel();
        log('Operations profile 已导入: ' + (data.profile?.label || data.profile?.id || 'profile'));
      } catch (err) {
        log('导入 Operations profile 失败: ' + err.message);
      }
    }

    async function importSwarmRoster() {
      const raw = $('operationRosterImportInput') ? $('operationRosterImportInput').value.trim() : '';
      if (!raw) {
        log('请先粘贴 Swarm Roster JSON/YAML');
        return;
      }
      const label = $('operationRosterNameInput') ? $('operationRosterNameInput').value.trim() : '';
      try {
        const data = await requestJson(urls.operationSwarmRosterImport, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: raw,
            label,
            overwrite: $('operationImportOverwriteInput') ? $('operationImportOverwriteInput').checked : false
          })
        });
        if (data.profile) {
          state.operationProfiles = [data.profile, ...state.operationProfiles.filter((profile) => profile.id !== data.profile.id)];
          if ($('operationProfileSelect')) $('operationProfileSelect').value = data.profile.id;
          if ($('operationRosterImportInput')) $('operationRosterImportInput').value = '';
          if ($('operationRosterNameInput')) $('operationRosterNameInput').value = '';
        }
        renderOperationsPanel();
        log('Swarm roster 已导入: ' + (data.profile?.label || data.profile?.id || 'roster'));
      } catch (err) {
        log('导入 Swarm roster 失败: ' + err.message);
      }
    }

    async function applyOperationPreset() {
      const presetId = $('operationPresetSelect').value || 'builder';
      const goal = $('missionInput').value.trim() || 'Run the selected operations profile against the current workspace objective.';
      const notes = $('notesInput').value.trim();
      const maxWorkers = Number($('operationWorkersInput').value || 4) || 4;
      try {
        const data = await requestJson(urls.operationPresetMission + '/' + encodeURIComponent(presetId) + '/mission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            goal,
            notes,
            maxWorkers,
            sessionPath: $('sessionSelect').value,
            agentId: resolveConductorAgentId()
          })
        });
        state.activeMission = data.mission;
        state.missions = [data.mission, ...state.missions.filter((mission) => mission.id !== data.mission.id)];
        state.tasks = [...(data.tasks || []), ...state.tasks.filter((task) => !(data.tasks || []).some((next) => next.id === task.id))];
        state.activeAssignmentId = data.mission && data.mission.assignments && data.mission.assignments[0] ? data.mission.assignments[0].id : '';
        renderAll();
        log('Operations preset 已创建 mission: ' + presetId);
      } catch (err) {
        log('Operations preset 创建失败: ' + err.message);
      }
    }

    async function applyOperationProfile() {
      const profileId = $('operationProfileSelect').value;
      if (!profileId) {
        log('请先保存或选择一个 Operations profile');
        return;
      }
      const goal = $('missionInput').value.trim() || 'Run the selected operations profile against the current workspace objective.';
      const notes = $('notesInput').value.trim();
      try {
        const data = await requestJson(urls.operationProfiles + '/' + encodeURIComponent(profileId) + '/mission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal, notes })
        });
        state.activeMission = data.mission;
        state.missions = [data.mission, ...state.missions.filter((mission) => mission.id !== data.mission.id)];
        state.tasks = [...(data.tasks || []), ...state.tasks.filter((task) => !(data.tasks || []).some((next) => next.id === task.id))];
        state.activeAssignmentId = data.mission && data.mission.assignments && data.mission.assignments[0] ? data.mission.assignments[0].id : '';
        renderAll();
        log('Operations profile 已创建 mission: ' + profileId);
      } catch (err) {
        log('Operations profile 创建失败: ' + err.message);
      }
    }

    async function deleteOperationProfile() {
      const profileId = $('operationProfileSelect').value;
      if (!profileId) {
        log('没有可删除的 Operations profile');
        return;
      }
      try {
        await requestJson(urls.operationProfiles + '/' + encodeURIComponent(profileId), { method: 'DELETE' });
        state.operationProfiles = state.operationProfiles.filter((profile) => profile.id !== profileId);
        renderOperationsPanel();
        log('Operations profile 已删除: ' + profileId);
      } catch (err) {
        log('删除 Operations profile 失败: ' + err.message);
      }
    }

    function renderAutopilotPanel() {
      const root = $('autopilotPanel');
      if (!root) return;
      const run = state.autopilot;
      const suggestions = run && Array.isArray(run.suggestions) ? run.suggestions : [];
      const runs = Array.isArray(state.autopilotRuns) ? state.autopilotRuns : [];
      const schedule = state.autopilotSchedule || {};
      const tick = state.autopilotTick || null;
      const loop = state.autopilotLoop || {};
      if (!run && !runs.length && !schedule.enabled && !tick && (!loop.state || loop.state === 'idle')) {
        root.innerHTML = '<div class="empty">Autopilot 会根据 mission、checkpoint 和 session status 给出可审计调度建议。</div>';
        return;
      }
      root.innerHTML = '';
      if (loop.state && loop.state !== 'idle') {
        const loopItem = document.createElement('div');
        loopItem.className = 'item';
        loopItem.innerHTML =
          '<b>' + escapeHtml('Loop ' + loop.state + ' / iteration ' + String(loop.iteration || 0) + '/' + String(loop.maxIterations || 0)) + '</b>' +
          '<span>' + escapeHtml((loop.mode || 'preview') + ' / max missions ' + String(loop.maxMissionsPerTick || 5) + ' / critical streak ' + String(loop.consecutiveCritical || 0) + '/' + String(loop.escalationThreshold || 3)) + '</span>' +
          '<span>' + escapeHtml((loop.reason || '-') + (loop.lastTick ? ' / last scanned ' + String(loop.lastTick.scanned || 0) : '')) + '</span>';
        root.appendChild(loopItem);
      }
      if (schedule.enabled || state.autopilotStatus) {
        const scheduleItem = document.createElement('div');
        scheduleItem.className = 'item';
        scheduleItem.innerHTML =
          '<b>' + escapeHtml('Schedule ' + (schedule.enabled ? 'enabled' : 'disabled')) + '</b>' +
          '<span>' + escapeHtml((schedule.mode || 'preview') + ' / every ' + String(schedule.intervalMinutes || 15) + ' minutes / max ' + String(schedule.maxMissionsPerTick || 5)) + '</span>' +
          '<span>' + escapeHtml(state.autopilotStatus && state.autopilotStatus.active ? 'background active' : 'background idle') + '</span>';
        root.appendChild(scheduleItem);
      }
      if (tick) {
        const tickItem = document.createElement('div');
        tickItem.className = 'item';
        tickItem.innerHTML =
          '<b>' + escapeHtml('Last tick: ' + (tick.mode || 'preview') + ' / scanned ' + String(tick.scanned || 0)) + '</b>' +
          '<span>' + escapeHtml((tick.reason || 'manual') + ' / errors ' + String((tick.errors || []).length) + (tick.skipped ? ' / skipped ' + (tick.reason || '') : '')) + '</span>';
        root.appendChild(tickItem);
      }
      if (run) {
        const summary = document.createElement('div');
        summary.className = 'item';
        summary.innerHTML =
          '<b>' + escapeHtml(run.summary || 'Autopilot scan') + '</b>' +
          '<span>' + escapeHtml((run.mode || 'preview') + ' / suggestions ' + suggestions.length) + '</span>' +
          '<span>' + escapeHtml(run.createdAt ? formatTaskTime(run.createdAt) : '') + '</span>';
        root.appendChild(summary);
      }
      for (const suggestion of suggestions.slice(0, 8)) {
        const item = document.createElement('div');
        item.className = 'item';
        item.innerHTML =
          '<b>' + escapeHtml((suggestion.action || 'monitor') + (suggestion.assignmentLabel ? ' / ' + suggestion.assignmentLabel : '')) + '</b>' +
          '<span>' + escapeHtml((suggestion.severity || 'info') + ' / ' + (suggestion.sessionPath || suggestion.taskId || suggestion.missionId || '-')) + '</span>' +
          '<span>' + escapeHtml(suggestion.reason || '-') + '</span>';
        root.appendChild(item);
      }
      if (!suggestions.length && runs.length) {
        for (const itemRun of runs.slice(0, 5)) {
          const item = document.createElement('div');
          item.className = 'item';
          item.innerHTML =
            '<b>' + escapeHtml(itemRun.summary || 'Autopilot run') + '</b>' +
            '<span>' + escapeHtml((itemRun.mode || 'preview') + ' / ' + formatTaskTime(itemRun.createdAt)) + '</span>';
          root.appendChild(item);
        }
      }
    }

    function renderJobPanel() {
      const root = $('jobPanel');
      if (!root) return;
      const jobs = Array.isArray(state.jobs) ? state.jobs : [];
      const scheduler = state.jobScheduler || {};
      const head = document.createElement('div');
      head.className = 'item';
      head.innerHTML =
        '<b>' + escapeHtml('Scheduler ' + (scheduler.active ? 'active' : 'idle') + (scheduler.running ? ' / running' : '')) + '</b>' +
        '<span>' + escapeHtml('interval ' + String(Math.round((scheduler.intervalMs || 0) / 1000) || '-') + 's / last scanned ' + String((scheduler.lastResult && scheduler.lastResult.scanned) || 0)) + '</span>';
      if (!jobs.length) {
        root.innerHTML = '';
        root.appendChild(head);
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '暂无 scheduled jobs。可创建 Autopilot Tick、Mission Autopilot 或 Dispatch Prompt。';
        root.appendChild(empty);
        renderJobOutputPanel();
        return;
      }
      root.innerHTML = '';
      root.appendChild(head);
      for (const job of jobs.slice(0, 12)) {
        const item = document.createElement('div');
        item.className = 'item';
        const latest = Array.isArray(job.runs) ? job.runs[0] : null;
        item.innerHTML =
          '<b>' + escapeHtml(job.title || job.id) + '</b>' +
          '<span>' + escapeHtml((job.type || '-') + ' / ' + (job.status || '-') + ' / ' + ((job.schedule && job.schedule.expression) || 'manual')) + '</span>' +
          '<span>' + escapeHtml('mode ' + (job.mode || 'preview') + ' / last ' + (job.lastRunAt ? formatTaskTime(job.lastRunAt) : '-') + ' / next ' + (job.nextRunAt ? formatTaskTime(job.nextRunAt) : '-')) + '</span>' +
          (latest ? '<span>' + escapeHtml('latest: ' + latest.status + ' / ' + (latest.summary || '-')) + '</span>' : '') +
          '<div class="actions">' +
            '<button class="mini trigger">触发</button>' +
            '<button class="mini output">输出</button>' +
            '<button class="mini pause">' + (job.status === 'paused' ? '恢复' : '暂停') + '</button>' +
            '<button class="mini danger remove">删除</button>' +
          '</div>';
        item.querySelector('.trigger').addEventListener('click', () => triggerJob(job.id));
        item.querySelector('.output').addEventListener('click', () => loadJobOutput(job.id));
        item.querySelector('.pause').addEventListener('click', () => job.status === 'paused' ? resumeJob(job.id) : pauseJob(job.id));
        item.querySelector('.remove').addEventListener('click', () => deleteJob(job.id));
        root.appendChild(item);
      }
      renderJobOutputPanel();
    }

    function renderJobOutputPanel() {
      const root = $('jobOutputPanel');
      if (!root) return;
      const output = state.jobOutput;
      if (!output || !output.latest) {
        root.textContent = '选择 Job 输出。';
        return;
      }
      root.textContent = [
        'JOB: ' + output.jobId,
        'STATUS: ' + (output.latest.status || '-'),
        'SUMMARY: ' + (output.latest.summary || '-'),
        'TIME: ' + (output.latest.createdAt || '-'),
        '',
        output.latest.output || JSON.stringify(output.latest.result || {}, null, 2)
      ].join('\\n');
    }

    async function openJobDetail(jobId) {
      if (!jobId) return;
      const job = (Array.isArray(state.jobs) ? state.jobs : []).find((entry) => entry.id === jobId || entry.jobId === jobId);
      if (job) {
        focusMissionReference({ missionId: job.missionId });
        const latest = Array.isArray(job.runs) ? job.runs[0] : null;
        setWorkerOutputMessage({
          title: 'Job: ' + (job.title || job.name || job.id),
          role: job.status || 'job',
          text: formatJobDetail(job, latest),
          meta: [job.type, job.status, job.nextRunAt ? formatTaskTime(job.nextRunAt) : ''].filter(Boolean).join(' / ')
        });
      }
      await loadJobOutput(jobId);
      log('Job opened: ' + jobId);
    }

    function formatJobDetail(job = {}, latest = null) {
      return [
        'JOB: ' + (job.title || job.name || job.id || '-'),
        'ID: ' + (job.id || job.jobId || '-'),
        'TYPE: ' + (job.type || '-'),
        'STATUS: ' + (job.status || '-'),
        'SCHEDULE: ' + ((job.schedule && (job.schedule.expression || job.schedule.type)) || job.schedule || 'manual'),
        'MODE: ' + (job.mode || '-'),
        'MISSION: ' + (job.missionId || '-'),
        'AGENT: ' + (job.agentId || '-'),
        'LAST RUN: ' + (job.lastRunAt || '-'),
        'NEXT RUN: ' + (job.nextRunAt || '-'),
        '',
        latest ? 'LATEST: ' + (latest.status || '-') + ' / ' + (latest.summary || latest.output || '-') : 'LATEST: -',
        job.prompt ? '\\nPROMPT:\\n' + job.prompt : ''
      ].filter(Boolean).join('\\n');
    }

    function renderAgentOutputsPanel() {
      renderAgentOutputFilterButtons();
      const root = $('agentOutputsPanel');
      if (!root) return;
      const outputs = Array.isArray(state.agentOutputs) ? state.agentOutputs : [];
      const summary = state.agentOutputSummary || {};
      if (!outputs.length) {
        root.innerHTML = '<div class="empty">暂无 Full Outputs。Job runs、Run Console records、checkpoints 和 worker assignment output 会集中显示在这里。</div>';
        return;
      }
      root.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'item';
      const byStatus = summary.byStatus || {};
      head.innerHTML =
        '<b>' + escapeHtml('Outputs / ' + String(summary.total || outputs.length) + ' recent runs across the team') + '</b>' +
        '<span>' + escapeHtml('success ' + String(byStatus.ok || 0) + ' / errors ' + String(byStatus.error || 0) + ' / running ' + String(byStatus.running || 0) + ' / latest ' + (summary.latestAt ? formatTaskTime(summary.latestAt) : '-')) + '</span>';
      root.appendChild(head);
      for (const output of outputs.slice(0, 12)) {
        const item = document.createElement('article');
        item.className = 'item full-output-card';
        const statusClass = output.status === 'ok' ? 'implemented' : output.status === 'error' ? 'blocked' : output.status === 'running' ? 'partial' : '';
        const sourceUrl = firstUrl(output.fullOutput || output.summary || '');
        const retry = output.jobId && output.status === 'error'
          ? '<button class="mini retry-output">Retry</button>'
          : '';
        const link = sourceUrl ? '<button class="mini open-output-link">Link</button>' : '';
        item.innerHTML =
          '<div class="task-row"><span class="status-chip ' + escapeHtml(statusClass) + '">' + escapeHtml(output.status || 'unknown') + '</span><span class="tag">' + escapeHtml(output.source || 'output') + '</span><span class="tag">' + escapeHtml(output.at ? formatTaskTime(output.at) : '') + '</span></div>' +
          '<b>' + escapeHtml((output.agentName || output.agentId || 'HanaAgent') + ' / ' + (output.jobName || output.source || 'Output')) + '</b>' +
          '<span>' + escapeHtml(output.summary || firstLine(output.fullOutput || '') || '-') + '</span>' +
          '<pre>' + escapeHtml(firstLines(output.fullOutput || output.summary || '', 8)) + '</pre>' +
          '<div class="actions"><button class="mini copy-output">复制</button><button class="mini view-output">查看</button>' + link + retry + '</div>';
        item.querySelector('.copy-output').addEventListener('click', () => copyText(output.fullOutput || output.summary || '').then(() => log('Output 已复制')));
        item.querySelector('.view-output').addEventListener('click', () => openAgentOutput(output));
        const open = item.querySelector('.open-output-link');
        const retryButton = item.querySelector('.retry-output');
        if (open) open.addEventListener('click', () => openPreviewUrl(sourceUrl));
        if (retryButton) retryButton.addEventListener('click', () => triggerJob(output.jobId).then(() => loadAgentOutputs()));
        root.appendChild(item);
      }
    }

    function renderAgentOutputFilterButtons() {
      const filters = Array.isArray(state.agentOutputFilters) && state.agentOutputFilters.length
        ? state.agentOutputFilters
        : [
            { id: 'all', label: 'All', count: 0 },
            { id: 'ok', label: 'Success', count: 0 },
            { id: 'error', label: 'Errors', count: 0 },
            { id: 'running', label: 'Running', count: 0 }
          ];
      for (const button of Array.from(document.querySelectorAll('[data-output-filter]'))) {
        const id = button.getAttribute('data-output-filter') || 'all';
        const item = filters.find((entry) => entry.id === id) || { label: id, count: 0 };
        button.textContent = item.label + (Number.isFinite(Number(item.count)) ? ' ' + String(item.count) : '');
        button.classList.toggle('active', id === state.agentOutputFilter);
      }
    }

    function openAgentOutput(output) {
      if (!output) return;
      if (output.missionId) {
        const mission = state.missions.find((entry) => entry.id === output.missionId);
        if (mission) {
          state.activeMission = mission;
          if (output.assignmentId) state.activeAssignmentId = output.assignmentId;
          renderConductor();
          renderMissionTimeline();
        }
      }
      setWorkerOutputMessage({
        title: output.jobName || output.source || 'Agent Output',
        role: output.status || 'output',
        text: output.fullOutput || output.summary || '',
        meta: [output.source, output.agentName || output.agentId, output.status].filter(Boolean).join(' / ')
      });
      if (output.assignmentId || output.agentId) loadWorkerDrilldown(output.assignmentId || output.agentId);
      log('Output opened: ' + (output.id || output.summary || 'output'));
    }

    function firstUrl(value) {
      const match = String(value || '').match(/https?:\\/\\/[^\\s)]+/i);
      return match ? match[0] : '';
    }

    function renderReviewGatePanel() {
      const root = $('reviewGatePanel');
      if (!root) return;
      const gate = state.reviewGate;
      if (!gate) {
        root.innerHTML = '<div class="empty">Review Gate 会在完成前检查 blocker、审批、checkpoint、review/QA 证据和交付产物。</div>';
        return;
      }
      const statusClass = gate.status === 'pass' ? 'implemented' : gate.status === 'fail' ? 'blocked' : 'partial';
      root.innerHTML = '';
      const summary = document.createElement('div');
      summary.className = 'item';
      summary.innerHTML =
        '<span class="status-chip ' + escapeHtml(statusClass) + '">' + escapeHtml(gate.status || 'unknown') + '</span>' +
        '<b>' + escapeHtml(gate.summary || 'Review gate result') + '</b>' +
        '<span>' + escapeHtml('assignments ' + ((gate.stats && gate.stats.completedAssignments) || 0) + '/' + ((gate.stats && gate.stats.assignments) || 0) + ' / checkpoints ' + ((gate.stats && gate.stats.checkpoints) || 0) + ' / artifacts ' + ((gate.stats && gate.stats.artifacts) || 0)) + '</span>';
      root.appendChild(summary);
      const findings = Array.isArray(gate.findings) ? gate.findings : [];
      if (!findings.length) {
        const pass = document.createElement('div');
        pass.className = 'item';
        pass.innerHTML = '<b>无阻塞发现</b><span>可以交付。</span>';
        root.appendChild(pass);
        return;
      }
      for (const finding of findings.slice(0, 10)) {
        const item = document.createElement('div');
        item.className = 'item';
        item.innerHTML =
          '<b>' + escapeHtml((finding.severity || 'warn') + ' / ' + (finding.title || finding.id)) + '</b>' +
          '<span>' + escapeHtml(finding.detail || '-') + '</span>';
        root.appendChild(item);
      }
    }

    function renderTemplates() {
      const root = $('templateSegments');
      root.innerHTML = '';
      const templates = state.templates.length ? state.templates : [
        { id: 'orchestrate', label: '任务编排', summary: '拆解、分配、检查点' }
      ];
      for (const template of templates) {
        const btn = document.createElement('button');
        btn.className = 'segment' + (state.selectedTemplate === template.id ? ' active' : '');
        btn.type = 'button';
        btn.innerHTML = '<b>' + escapeHtml(template.label) + '</b><span>' + escapeHtml(template.summary || '') + '</span>';
        btn.addEventListener('click', () => {
          state.selectedTemplate = template.id;
          const summary = $('templateSummary');
          if (summary) summary.textContent = template.label;
          renderTemplates();
        });
        root.appendChild(btn);
      }
      const selected = templates.find((item) => item.id === state.selectedTemplate) || templates[0];
      const summary = $('templateSummary');
      if (summary) summary.textContent = selected ? selected.label : '任务编排';
    }

    function resolveConductorAgentId() {
      const conductor = $('conductorAgentSelect');
      if (conductor && conductor.value) return conductor.value;
      const global = $('agentSelect');
      if (global && global.value) return global.value;
      return (state.agents[0] && state.agents[0].id) || '';
    }

    let workflowTemplates = [];
    let workflowList = [];

    async function loadWorkflowTemplates() {
      try {
        const data = await requestJson('/api/workflow-templates');
        workflowTemplates = data.templates || [];
        const wfData = await requestJson('/api/workflows');
        workflowList = wfData.workflows || [];
        renderWorkflowSelect();
      } catch (err) {
        log('Workflow 加载失败: ' + err.message);
      }
    }

    function renderWorkflowSelect() {
      const select = $('workflowTemplateSelect');
      if (!select) return;
      const current = select.value;
      select.innerHTML = '<option value="">选择 Workflow</option>';
      for (const wf of workflowList) {
        const opt = document.createElement('option');
        opt.value = wf.id;
        opt.textContent = wf.name || wf.id;
        select.appendChild(opt);
      }
      for (const tpl of workflowTemplates) {
        const opt = document.createElement('option');
        opt.value = 'template:' + tpl.id;
        opt.textContent = '模板: ' + (tpl.name || tpl.id);
        select.appendChild(opt);
      }
      select.value = current;
    }

    async function previewWorkflow() {
      const select = $('workflowTemplateSelect');
      const panel = $('workflowPreviewPanel');
      if (!select || !select.value || !panel) return;
      const value = select.value;
      let workflowId = value;
      if (value.startsWith('template:')) {
        const templateId = value.slice('template:'.length);
        try {
          const result = await requestJson('/api/workflows', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ templateId, name: 'Workflow from ' + templateId })
          });
          if (!result.ok) { log('创建 Workflow 失败: ' + (result.error || '')); return; }
          workflowId = result.workflow.id;
          select.value = workflowId;
          workflowList = [result.workflow, ...workflowList];
          renderWorkflowSelect();
          select.value = workflowId;
        } catch (err) { log('创建 Workflow 失败: ' + err.message); return; }
      }
      try {
        const result = await requestJson('/api/workflows/' + encodeURIComponent(workflowId) + '/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        panel.style.display = 'block';
        if (!result.ok) {
          panel.innerHTML = '<div class="empty">预览失败: ' + escapeHtml(result.error || '') + '</div>';
          return;
        }
        const exec = result.execution || {};
        const path = (exec.path || []).join(' → ') || '-';
        const status = exec.status || '-';
        const warnings = (exec.warnings || []).map((w) => escapeHtml(w.message || '')).join('<br>');
        panel.innerHTML =
          '<div class="item"><b>状态</b><span>' + escapeHtml(status) + '</span></div>' +
          '<div class="item"><b>路径</b><span>' + escapeHtml(path) + '</span></div>' +
          (warnings ? '<div class="item"><b>警告</b><span>' + warnings + '</span></div>' : '');
      } catch (err) {
        panel.style.display = 'block';
        panel.innerHTML = '<div class="empty">预览请求失败: ' + escapeHtml(err.message) + '</div>';
      }
    }

    async function executeWorkflowAsMission() {
      const select = $('workflowTemplateSelect');
      if (!select || !select.value) {
        log('请先选择 Workflow');
        return;
      }
      const value = select.value;
      let workflowId = value;
      if (value.startsWith('template:')) {
        const templateId = value.slice('template:'.length);
        try {
          const result = await requestJson('/api/workflows', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ templateId, name: 'Workflow from ' + templateId })
          });
          if (!result.ok) { log('创建 Workflow 失败: ' + (result.error || '')); return; }
          workflowId = result.workflow.id;
          workflowList = [result.workflow, ...workflowList];
          renderWorkflowSelect();
          select.value = workflowId;
        } catch (err) { log('创建 Workflow 失败: ' + err.message); return; }
      }
      try {
        const result = await requestJson('/api/workflows/' + encodeURIComponent(workflowId) + '/mission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: resolveConductorAgentId(),
            sessionPath: $('sessionSelect') ? $('sessionSelect').value : '',
            maxWorkers: $('workerCountSelect') ? $('workerCountSelect').value : 4
          })
        });
        if (!result.ok) { log('执行 Workflow 失败: ' + (result.error || '')); return; }
        state.activeMission = result.mission || state.activeMission;
        state.activeAssignmentId = result.mission && result.mission.assignments && result.mission.assignments[0] ? result.mission.assignments[0].id : state.activeAssignmentId;
        await reloadTasks();
        renderConductor();
        renderMissionTimeline();
        log('Workflow 已编译为 Mission: ' + (result.mission ? result.mission.title : ''));
      } catch (err) {
        log('执行 Workflow 失败: ' + err.message);
      }
    }

    function renderAgents() {
      const select = $('agentSelect');
      const current = select.value;
      select.innerHTML = '<option value="">全部智能体</option>';
      for (const agent of state.agents) {
        const option = document.createElement('option');
        option.value = agent.id;
        option.textContent = agent.name + (agent.isPrimary ? ' / primary' : agent.isCurrent ? ' / current' : '');
        select.appendChild(option);
      }
      select.value = current || state.config.defaultAgentId || '';
      $('selectedAgentTag').textContent = select.options[select.selectedIndex] ? select.options[select.selectedIndex].textContent : '未选择';

      const conductorSelect = $('conductorAgentSelect');
      if (conductorSelect) {
        const currentConductor = conductorSelect.value;
        conductorSelect.innerHTML = '<option value="">沿用全局（全部智能体）</option>';
        for (const agent of state.agents) {
          const option = document.createElement('option');
          option.value = agent.id;
          option.textContent = agent.name + (agent.isPrimary ? ' / primary' : agent.isCurrent ? ' / current' : '');
          conductorSelect.appendChild(option);
        }
        conductorSelect.value = currentConductor || state.config.defaultAgentId || (state.agents[0] ? state.agents[0].id : '');
      }

      const list = $('agentList');
      list.innerHTML = '';
      if (!state.agents.length) {
        list.innerHTML = '<div class="empty">暂无智能体数据</div>';
        return;
      }
      for (const agent of state.agents) {
        const item = document.createElement('div');
        item.className = 'item';
        item.innerHTML = '<b>' + escapeHtml(agent.name) + '</b><span>' + escapeHtml(agent.id || '-') + '</span><span>' + (agent.isPrimary ? 'primary' : agent.isCurrent ? 'current' : 'available') + '</span>';
        item.addEventListener('click', () => loadWorkerDrilldown(agent.id));
        list.appendChild(item);
      }
    }

    function renderSessions() {
      const select = $('sessionSelect');
      const current = select.value;
      select.innerHTML = '<option value="">选择已有会话</option>';
      for (const session of state.sessions) {
        const option = document.createElement('option');
        option.value = session.path;
        option.textContent = sessionDisplayTitle(session) + (session.agentName ? ' / ' + session.agentName : '');
        select.appendChild(option);
      }
      select.value = current || state.config.defaultSessionPath || '';

      const list = $('sessionList');
      list.innerHTML = '';
      if (!state.sessions.length) {
        list.innerHTML = '<div class="empty">暂无会话数据</div>';
        renderMobileHeader();
        renderMobileSessionsPanel();
        return;
      }
      const query = (state.sessionSearchQuery || '').trim().toLowerCase();
      const visibleSessions = filterSessionsForSidebar(state.sessions, query);
      const summary = document.createElement('div');
      summary.className = 'item';
      summary.innerHTML =
        '<b>' + escapeHtml(query ? 'Session Search' : 'Recent Sessions') + '</b>' +
        '<span>' + escapeHtml(String(visibleSessions.length) + ' of ' + String(state.sessions.length) + (query ? ' matched' : ' shown')) + '</span>';
      list.appendChild(summary);
      if (!visibleSessions.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = '没有匹配的会话';
        list.appendChild(empty);
        renderMobileHeader();
        renderMobileSessionsPanel();
        return;
      }
      for (const session of visibleSessions.slice(0, 20)) {
        const item = document.createElement('div');
        item.className = 'item';
        item.innerHTML =
          '<b>' + escapeHtml(sessionDisplayTitle(session)) + '</b>' +
          '<span>' + escapeHtml((session.alias ? 'alias / ' : '') + (session.agentName || session.agentId || '-')) + '</span>' +
          '<span>' + escapeHtml(session.path) + '</span>';
        item.addEventListener('click', () => {
          $('sessionSelect').value = session.path;
          renderSessionDetail();
          renderMobileHeader();
          renderMobileSessionsPanel();
        });
        list.appendChild(item);
      }
      renderMobileHeader();
      renderMobileSessionsPanel();
    }

    function filterSessionsForSidebar(sessions, query) {
      const items = Array.isArray(sessions) ? sessions : [];
      if (!query) return items;
      return items.filter((session) => {
        const haystack = [
          sessionDisplayTitle(session),
          session.title,
          session.alias,
          session.path,
          session.agentName,
          session.agentId,
          session.cwd,
          session.modelId
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      });
    }

    function renderSessionDetail() {
      const path = $('sessionSelect').value;
      const session = state.sessions.find((item) => item.path === path);
      const el = $('sessionDetail');
      if (!session) {
        el.innerHTML = '<b>未选择会话</b><span>投递前需要选择一个已有 Hana 会话</span>';
        return;
      }
      el.innerHTML =
        '<b>' + escapeHtml(sessionDisplayTitle(session)) + '</b>' +
        '<span>' + escapeHtml(session.agentName || session.agentId || '-') + '</span>' +
        (session.alias && session.originalTitle ? '<span>原始标题：' + escapeHtml(session.originalTitle) + '</span>' : '') +
        '<span class="kbd">' + escapeHtml(session.path) + '</span>';
      if (!$('terminalCwdInput').value && session.cwd) $('terminalCwdInput').value = session.cwd;
    }

    function sessionDisplayTitle(session) {
      return (session && (session.title || session.path)) || 'Session';
    }

    function renderSessionTitlePanel() {
      const root = $('sessionTitlePanel');
      if (!root) return;
      const suggestion = state.sessionTitleSuggestion;
      if (!suggestion || !suggestion.title) {
        root.innerHTML = '<div class="empty">建议标题会根据当前会话历史生成，可用于 Pin 会话标题。</div>';
        return;
      }
      root.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'item';
      head.innerHTML =
        '<b>' + escapeHtml(suggestion.title) + '</b>' +
        '<span>' + escapeHtml('source: ' + (suggestion.source || '-') + ' / messages ' + String(suggestion.messageCount || 0)) + '</span>' +
        '<span>' + escapeHtml(suggestion.sessionPath || '') + '</span>' +
        '<div class="actions"><button class="mini apply-title">用于 Pin</button><button class="mini copy-title">复制</button></div>';
      root.appendChild(head);
      const apply = head.querySelector('.apply-title');
      const copy = head.querySelector('.copy-title');
      if (apply) apply.addEventListener('click', () => applySuggestedSessionTitle());
      if (copy) copy.addEventListener('click', () => copyText(suggestion.title).then(() => log('标题已复制')));
      const candidates = Array.isArray(suggestion.candidates) ? suggestion.candidates : [];
      for (const item of candidates.slice(1, 4)) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'item';
        el.innerHTML =
          '<b>' + escapeHtml(item.title || '-') + '</b>' +
          '<span>' + escapeHtml((item.source || '-') + ' / score ' + String(item.score || 0)) + '</span>';
        el.addEventListener('click', () => {
          state.sessionTitleSuggestion = { ...suggestion, title: item.title, source: item.source };
          renderSessionTitlePanel();
        });
        root.appendChild(el);
      }
    }

    function renderContextUsagePanel() {
      const root = $('contextUsagePanel');
      if (!root) return;
      const result = state.contextUsage || null;
      const context = result && result.context ? result.context : null;
      if (!context) {
        root.innerHTML = '<div class="empty">点击“上下文”后显示当前 session 的 context meter、剩余 token 和阈值提醒。</div>';
        return;
      }
      const threshold = workbenchSettings().usageThreshold;
      const percent = Number(context.percent || 0);
      const statusLabel = percent >= Math.min(95, threshold + 10) ? '接近上限' : percent >= threshold ? '偏高' : '健康';
      root.innerHTML =
        '<div class="item">' +
          '<b>' + escapeHtml(String(context.percent || 0) + '% / ' + statusLabel) + '</b>' +
          '<span>' + escapeHtml(String(context.usedTokens || 0) + ' / ' + String(context.maxContextTokens || 0) + ' tokens') + '</span>' +
          '<span>' + escapeHtml('remaining: ' + String(context.remainingTokens || 0) + ' / messages: ' + String(context.messageCount || 0)) + '</span>' +
          '<span>' + escapeHtml('threshold: ' + String(threshold) + '% / source: ' + (context.source || '-') + ' / explicit messages: ' + String(context.messagesWithTokenCount || 0)) + '</span>' +
        '</div>';
    }

    function renderSessionTombstones() {
      const root = $('sessionTombstonePanel');
      if (!root) return;
      const tombstones = Array.isArray(state.config.sessionTombstones) ? state.config.sessionTombstones : [];
      if (!tombstones.length) {
        root.innerHTML = '<div class="empty">隐藏的 session 会显示在这里，可随时恢复；不会删除 OpenHanako 真实会话文件。</div>';
        return;
      }
      root.innerHTML = '';
      for (const tombstone of tombstones.slice(0, 8)) {
        const item = document.createElement('div');
        item.className = 'item';
        item.innerHTML =
          '<b>' + escapeHtml(tombstone.title || tombstone.sessionPath || 'Hidden session') + '</b>' +
          '<span>' + escapeHtml('hidden / ' + (tombstone.deletedAt || '-')) + '</span>' +
          '<span>' + escapeHtml(tombstone.sessionPath || '-') + '</span>' +
          '<div class="actions"><button class="mini restore-session">恢复</button></div>';
        const restore = item.querySelector('.restore-session');
        if (restore) restore.addEventListener('click', () => restoreSessionTombstone(tombstone.sessionPath || ''));
        root.appendChild(item);
      }
    }

    function renderPinnedPanel() {
      const root = $('pinnedPanel');
      if (!root) return;
      const sessions = Array.isArray(state.config.pinnedSessions) ? state.config.pinnedSessions : [];
      const models = Array.isArray(state.config.pinnedModels) ? state.config.pinnedModels : [];
      root.innerHTML = '';
      if (!sessions.length && !models.length) {
        root.innerHTML = '<div class="empty">Pin 常用会话或模型后会显示在这里。</div>';
        return;
      }
      for (const [index, pinned] of sessions.slice(0, 8).entries()) {
        const item = document.createElement('div');
        item.className = 'item pinned-draggable';
        item.draggable = true;
        item.dataset.pinnedKind = 'session';
        item.dataset.pinnedKey = pinned.sessionPath || '';
        item.innerHTML =
          '<b>' + escapeHtml(pinned.title || pinned.sessionPath || 'Pinned session') + '</b>' +
          '<span>' + escapeHtml('session / ' + (pinned.agentId || '-')) + '</span>' +
          '<span>' + escapeHtml(pinned.sessionPath || '-') + '</span>' +
          '<div class="actions"><button class="mini pin-up">上移</button><button class="mini pin-down">下移</button><button class="mini select">选择</button><button class="mini make-default">默认</button><button class="mini danger remove">移除</button></div>';
        item.querySelector('.pin-up').disabled = index === 0;
        item.querySelector('.pin-down').disabled = index >= sessions.length - 1;
        item.querySelector('.pin-up').addEventListener('click', () => movePinnedSession(pinned.sessionPath || '', -1));
        item.querySelector('.pin-down').addEventListener('click', () => movePinnedSession(pinned.sessionPath || '', 1));
        item.querySelector('.select').addEventListener('click', () => selectPinnedSession(pinned));
        item.querySelector('.make-default').addEventListener('click', () => setPinnedSessionDefault(pinned));
        item.querySelector('.remove').addEventListener('click', () => removePinnedSession(pinned.sessionPath || ''));
        bindPinnedDrag(item);
        root.appendChild(item);
      }
      for (const [index, pinned] of models.slice(0, 8).entries()) {
        const item = document.createElement('div');
        item.className = 'item pinned-draggable';
        item.draggable = true;
        item.dataset.pinnedKind = 'model';
        item.dataset.pinnedKey = pinnedModelKey(pinned);
        item.innerHTML =
          '<b>' + escapeHtml(pinned.model || 'Pinned model') + '</b>' +
          '<span>' + escapeHtml('model / ' + (pinned.provider || '-')) + '</span>' +
          '<span>' + escapeHtml(pinned.agentId ? 'agent ' + pinned.agentId : 'global preference') + '</span>' +
          '<div class="actions"><button class="mini pin-up">上移</button><button class="mini pin-down">下移</button><button class="mini apply-model">应用</button><button class="mini danger remove">移除</button></div>';
        item.querySelector('.pin-up').disabled = index === 0;
        item.querySelector('.pin-down').disabled = index >= models.length - 1;
        item.querySelector('.pin-up').addEventListener('click', () => movePinnedModel(pinned, -1));
        item.querySelector('.pin-down').addEventListener('click', () => movePinnedModel(pinned, 1));
        item.querySelector('.apply-model').addEventListener('click', () => applyPinnedModel(pinned));
        item.querySelector('.remove').addEventListener('click', () => removePinnedModel(pinned));
        bindPinnedDrag(item);
        root.appendChild(item);
      }
    }

    function bindPinnedDrag(item) {
      item.addEventListener('dragstart', handlePinnedDragStart);
      item.addEventListener('dragover', handlePinnedDragOver);
      item.addEventListener('dragleave', handlePinnedDragLeave);
      item.addEventListener('drop', handlePinnedDrop);
      item.addEventListener('dragend', clearPinnedDragState);
    }

    function pinnedModelKey(pinned) {
      return [pinned && pinned.agentId ? pinned.agentId : '', pinned && pinned.model ? pinned.model : ''].join(':');
    }

    function handlePinnedDragStart(event) {
      if (event.target && event.target.closest && event.target.closest('button')) {
        event.preventDefault();
        return;
      }
      const item = event.currentTarget;
      const payload = {
        kind: item.dataset.pinnedKind || '',
        key: item.dataset.pinnedKey || ''
      };
      if (!payload.kind || !payload.key) {
        event.preventDefault();
        return;
      }
      state.draggingPinned = payload;
      item.classList.add('dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', 'hanaagent-pinned:' + payload.kind + ':' + payload.key);
      }
    }

    function handlePinnedDragOver(event) {
      const dragged = getDraggedPinned(event);
      const target = event.currentTarget;
      if (!dragged || dragged.kind !== target.dataset.pinnedKind || dragged.key === target.dataset.pinnedKey) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      clearPinnedDropState();
      const box = target.getBoundingClientRect();
      const before = event.clientY < box.top + box.height / 2;
      target.classList.add(before ? 'drop-before' : 'drop-after');
    }

    function handlePinnedDragLeave(event) {
      const target = event.currentTarget;
      if (target && target.contains(event.relatedTarget)) return;
      target.classList.remove('drop-before', 'drop-after');
    }

    async function handlePinnedDrop(event) {
      const dragged = getDraggedPinned(event);
      const target = event.currentTarget;
      if (!dragged || dragged.kind !== target.dataset.pinnedKind || dragged.key === target.dataset.pinnedKey) return;
      event.preventDefault();
      const box = target.getBoundingClientRect();
      const before = target.classList.contains('drop-before') || (!target.classList.contains('drop-after') && event.clientY < box.top + box.height / 2);
      const targetKey = target.dataset.pinnedKey || '';
      clearPinnedDropState();
      if (dragged.kind === 'session') {
        const pinnedSessions = reorderPinnedItems(
          Array.isArray(state.config.pinnedSessions) ? state.config.pinnedSessions : [],
          (item) => item.sessionPath || '',
          dragged.key,
          targetKey,
          before ? 'before' : 'after'
        );
        await savePreferencesPatch({ pinnedSessions }, 'Pinned session 拖拽顺序已更新');
      } else if (dragged.kind === 'model') {
        const pinnedModels = reorderPinnedItems(
          Array.isArray(state.config.pinnedModels) ? state.config.pinnedModels : [],
          pinnedModelKey,
          dragged.key,
          targetKey,
          before ? 'before' : 'after'
        );
        await savePreferencesPatch({ pinnedModels }, 'Pinned model 拖拽顺序已更新');
      }
    }

    function getDraggedPinned(event) {
      if (state.draggingPinned && state.draggingPinned.kind && state.draggingPinned.key) return state.draggingPinned;
      const raw = event && event.dataTransfer ? event.dataTransfer.getData('text/plain') : '';
      const match = String(raw || '').match(/^hanaagent-pinned:([^:]+):(.+)$/);
      return match ? { kind: match[1], key: match[2] } : null;
    }

    function reorderPinnedItems(items, keyFor, sourceKey, targetKey, placement) {
      const list = [...(Array.isArray(items) ? items : [])];
      const from = list.findIndex((item) => keyFor(item) === sourceKey);
      if (from < 0) return list;
      const [moved] = list.splice(from, 1);
      const targetIndex = list.findIndex((item) => keyFor(item) === targetKey);
      if (targetIndex < 0) {
        list.push(moved);
        return list;
      }
      list.splice(placement === 'after' ? targetIndex + 1 : targetIndex, 0, moved);
      return list;
    }

    function clearPinnedDropState() {
      document.querySelectorAll('.pinned-draggable.drop-before, .pinned-draggable.drop-after').forEach((item) => item.classList.remove('drop-before', 'drop-after'));
    }

    function clearPinnedDragState() {
      state.draggingPinned = null;
      clearPinnedDropState();
      document.querySelectorAll('.pinned-draggable.dragging').forEach((item) => item.classList.remove('dragging'));
    }

    function currentWorkbenchModeSettings() {
      return {
        defaultAgentId: $('agentSelect') ? $('agentSelect').value || '' : '',
        defaultSessionPath: $('sessionSelect') ? $('sessionSelect').value || '' : '',
        mode: $('modeSelect') ? $('modeSelect').value || 'dispatch' : 'dispatch',
        workerCount: Number($('workerCountSelect') ? $('workerCountSelect').value || 4 : 4) || 4,
        preferredModel: $('agentProfileModelInput') ? $('agentProfileModelInput').value.trim() : '',
        preferredBudgetModel: currentPinnedModelAt(0),
        preferredPremiumModel: currentPinnedModelAt(1),
        smartSuggestionsEnabled: Boolean(state.modelSuggestions && Array.isArray(state.modelSuggestions.suggestions) && state.modelSuggestions.suggestions.length),
        onlySuggestCheaper: false,
        boardViewId: state.activeBoardViewId || '',
        operationProfileId: $('operationProfileSelect') ? $('operationProfileSelect').value || '' : ''
      };
    }

    function currentPinnedModelAt(index) {
      const models = Array.isArray(state.config.pinnedModels) ? state.config.pinnedModels : [];
      return models[index] && models[index].model ? models[index].model : '';
    }

    function workbenchModeDrift(mode) {
      const settings = (mode && mode.settings) || {};
      const current = currentWorkbenchModeSettings();
      const fields = [
        ['defaultAgentId', 'Agent'],
        ['defaultSessionPath', 'Session'],
        ['mode', 'Mission mode'],
        ['workerCount', 'Worker count'],
        ['preferredModel', 'Preferred model'],
        ['preferredBudgetModel', 'Budget model'],
        ['preferredPremiumModel', 'Premium model'],
        ['boardViewId', 'Board view'],
        ['operationProfileId', 'Operations profile']
      ];
      return fields.filter(([key]) => String(settings[key] || '') !== String(current[key] || '')).map(([, label]) => label);
    }

    function renderWorkbenchModes() {
      const select = $('workbenchModeSelect');
      const root = $('workbenchModePanel');
      if (!select || !root) return;
      const modes = Array.isArray(state.config.workbenchModes) ? state.config.workbenchModes : [];
      const current = select.value || state.config.activeWorkbenchModeId || '';
      select.innerHTML = '<option value="">选择 Mode</option>';
      for (const mode of modes) {
        const option = document.createElement('option');
        option.value = mode.id;
        option.textContent = mode.title || mode.id;
        select.appendChild(option);
      }
      if (current) select.value = current;
      const active = modes.find((mode) => mode.id === (select.value || state.config.activeWorkbenchModeId));
      const drift = active ? workbenchModeDrift(active) : [];
      if (!modes.length) {
        root.innerHTML = '<div class="empty">保存当前 agent/session/model/board 配置后，可像 Hermes Modes 一样快速应用。</div>';
        return;
      }
      root.innerHTML = '';
      if (active) {
        const head = document.createElement('div');
        head.className = 'item';
        head.innerHTML =
          '<b>' + escapeHtml(active.title || active.id) + '</b>' +
          '<span>' + escapeHtml(drift.length ? 'drift: ' + drift.join(', ') : 'in sync') + '</span>' +
          '<span>' + escapeHtml(active.description || 'mode preset') + '</span>';
        root.appendChild(head);
      }
      for (const mode of modes.slice(0, 8)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'item';
        const settings = mode.settings || {};
        item.innerHTML =
          '<b>' + escapeHtml(mode.title || mode.id) + '</b>' +
          '<span>' + escapeHtml([settings.mode || 'dispatch', settings.preferredModel || settings.preferredBudgetModel || settings.preferredPremiumModel || 'no model', String(settings.workerCount || 4) + ' workers'].join(' / ')) + '</span>' +
          '<span>' + escapeHtml(mode.description || (settings.defaultSessionPath || settings.defaultAgentId || '-')) + '</span>';
        item.addEventListener('click', () => {
          $('workbenchModeSelect').value = mode.id;
          renderWorkbenchModes();
        });
        root.appendChild(item);
      }
    }

    function renderNotificationSettings() {
      const root = $('notificationPanel');
      if (!root) return;
      const settings = notificationSettings();
      if ($('notificationEnabledSelect')) $('notificationEnabledSelect').value = String(settings.enabled);
      if ($('notificationVolumeInput')) $('notificationVolumeInput').value = String(settings.volume);
      if ($('notificationBrowserSelect')) $('notificationBrowserSelect').value = String(settings.browser);
      if ($('notificationHapticsSelect')) $('notificationHapticsSelect').value = String(settings.haptics);
      const permission = 'Notification' in window ? Notification.permission : 'unsupported';
      root.innerHTML =
        '<div class="item">' +
          '<b>' + escapeHtml(settings.enabled ? 'Sound enabled' : 'Sound disabled') + '</b>' +
          '<span>' + escapeHtml('volume ' + settings.volume + ' / browser ' + settings.browser + ' / haptics ' + settings.haptics) + '</span>' +
          '<span>' + escapeHtml('browser permission: ' + permission) + '</span>' +
        '</div>';
    }

    function renderWorkbenchSettings() {
      const root = $('workbenchSettingsPanel');
      if (!root) return;
      const settings = workbenchSettings();
      const preset = workbenchThemePresets.find((item) => item.id === settings.themePreset) || workbenchThemePresets[0];
      if ($('workbenchThemePresetSelect')) $('workbenchThemePresetSelect').value = settings.themePreset;
      if ($('workbenchThemeSelect')) $('workbenchThemeSelect').value = settings.theme;
      if ($('workbenchAccentSelect')) $('workbenchAccentSelect').value = settings.accentColor;
      if ($('editorFontSizeInput')) $('editorFontSizeInput').value = String(settings.editorFontSize);
      if ($('editorWordWrapSelect')) $('editorWordWrapSelect').value = String(settings.editorWordWrap);
      if ($('editorMinimapSelect')) $('editorMinimapSelect').value = String(settings.editorMinimap);
      if ($('usageThresholdInput')) $('usageThresholdInput').value = String(settings.usageThreshold);
      if ($('systemMetricsFooterSelect')) $('systemMetricsFooterSelect').value = String(settings.showSystemMetricsFooter);
      if ($('mobileNavModeSelect')) $('mobileNavModeSelect').value = settings.mobileChatNavMode;
      if ($('calendarTimezoneInput')) $('calendarTimezoneInput').value = settings.calendarTimezone;
      root.innerHTML =
        '<div class="item">' +
          '<b>' + escapeHtml('Theme ' + preset.label + ' / ' + settings.theme + ' / ' + settings.accentColor) + '</b>' +
          '<span>' + escapeHtml('editor ' + settings.editorFontSize + 'px / wrap ' + settings.editorWordWrap + ' / minimap ' + settings.editorMinimap) + '</span>' +
          '<span>' + escapeHtml('usage threshold ' + settings.usageThreshold + '% / metrics footer ' + settings.showSystemMetricsFooter + ' / mobile nav ' + settings.mobileChatNavMode + ' / calendar tz ' + settings.calendarTimezone) + '</span>' +
        '</div>';
      applyWorkbenchSettings();
    }

    function renderWorkspaceFilesPanel() {
      const rootSelect = $('workspaceRootSelect');
      const fileList = $('workspaceFileList');
      const tag = $('workspaceFileTag');
      if (!rootSelect || !fileList || !tag) return;
      const current = rootSelect.value;
      rootSelect.innerHTML = '';
      for (const root of state.workspaceRoots || []) {
        const option = document.createElement('option');
        option.value = root.id;
        option.textContent = root.label + (root.writable ? ' / writable' : ' / readonly');
        rootSelect.appendChild(option);
      }
      if (current) rootSelect.value = current;
      const file = state.workspaceFile;
      tag.textContent = file ? (file.relativePath || file.path || 'file') : ((state.workspaceFiles || []).length ? 'files ' + state.workspaceFiles.length : '未加载');
      if (state.workspacePatchReview && state.workspacePatchReview.state) {
        tag.textContent += ' / patch ' + state.workspacePatchReview.state;
      }
      fileList.innerHTML = '';
      const entries = Array.isArray(state.workspaceFiles) ? state.workspaceFiles : [];
      if (!entries.length) {
        fileList.innerHTML = '<div class="empty">点击 Roots / 浏览后显示受控 workspace 文件。</div>';
      } else {
        for (const entry of entries.slice(0, 80)) {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'item';
          item.innerHTML =
            '<b>' + escapeHtml((entry.type === 'directory' ? '[dir] ' : '') + entry.name) + '</b>' +
            '<span>' + escapeHtml(entry.relativePath || entry.path || '-') + '</span>' +
            '<span>' + escapeHtml((entry.kind || entry.type || '-') + ' / ' + formatBytes(entry.size || 0)) + '</span>';
          item.addEventListener('click', () => {
            if (entry.type === 'directory') {
              $('workspacePathInput').value = entry.relativePath || '.';
              loadWorkspaceFiles();
            } else {
              loadWorkspaceFile(entry.relativePath);
            }
          });
          fileList.appendChild(item);
        }
      }
      renderWorkspacePreview();
    }

    function renderWorkspacePreview() {
      const editor = $('workspaceEditor');
      const preview = $('workspacePreview');
      if (!editor || !preview) return;
      const file = state.workspaceFile;
      if (!file) {
        editor.value = '';
        preview.textContent = '文件预览会显示在这里。';
        return;
      }
      if (file.kind === 'image') {
        editor.value = '';
        const src = 'data:' + (file.mime || 'application/octet-stream') + ';base64,' + (file.content || '');
        preview.innerHTML = '<img alt="' + escapeAttr(file.relativePath || file.path || 'image') + '" src="' + src + '" style="max-width:100%;height:auto;border-radius:6px" />';
        return;
      }
      editor.value = file.content || '';
      preview.textContent = firstLines(file.content || '', 24);
    }

    function renderRuntimePanels() {
      renderInspectorPanel();
      renderAgentConfigPanel();
      renderAgentSkillsPanel();
      renderIntegrationCatalogPanel();
      renderMemoryPanel();
      renderRunRecordPanel();
      renderUsagePanel();
      renderHostCheckpointPanel();
      renderSessionLifecyclePanel();
      renderHostTaskPanel();
      renderDeferredTaskPanel();
    }

    function renderInspectorPanel() {
      const root = $('inspectorPanel');
      if (!root) return;
      const selectedPath = $('sessionSelect') ? $('sessionSelect').value : '';
      const session = state.sessions.find((item) => item.path === selectedPath) || {};
      const assignment = getActiveAssignment();
      const messages = Array.isArray(state.sessionHistory) ? state.sessionHistory : [];
      const liveEvents = Array.isArray(state.liveEvents) ? state.liveEvents : [];
      const historyTrace = state.toolTrace && Array.isArray(state.toolTrace.items) ? state.toolTrace.items : [];
      const liveTrace = Array.isArray(state.liveTrace) ? state.liveTrace : [];
      const traceItems = [...liveTrace, ...historyTrace];
      const memories = Array.isArray(state.memoryEntries) ? state.memoryEntries : [];
      const skills = state.agentSkills && Array.isArray(state.agentSkills.skills) ? state.agentSkills.skills : [];
      const context = state.contextUsage && state.contextUsage.context ? state.contextUsage.context : null;
      const lastMessage = messages[messages.length - 1] || null;
      const lastEvent = liveEvents[liveEvents.length - 1] || null;
      const sections = {
        activity: [
          inspectorSection('Session Activity', [
            ['Session', sessionDisplayTitle(session) || selectedPath || '未选择'],
            ['Agent', session.agentName || session.agentId || $('agentSelect')?.value || '-'],
            ['Last message', lastMessage ? (lastMessage.role || 'message') + ' / ' + firstLine(lastMessage.text || '').slice(0, 120) : '暂无历史'],
            ['Live event', lastEvent ? (lastEvent.type || 'event') + ' / ' + firstLine(lastEvent.text || lastEvent.delta || lastEvent.message || '').slice(0, 120) : '未连接或暂无事件']
          ])
        ],
        context: [
          inspectorSection('Context Usage', [
            ['Context', context ? String(context.usedTokens || 0) + ' / ' + String(context.maxContextTokens || 0) + ' tokens' : '点击“上下文”读取'],
            ['Remaining', context ? String(context.remainingTokens || 0) + ' tokens / ' + String(context.percent || 0) + '%' : '-'],
            ['Status', context ? (context.status || context.source || '-') : '-']
          ]),
          inspectorSection('Session Metadata', [
            ['Path', selectedPath || '-'],
            ['CWD', session.cwd || '-'],
            ['Model', session.modelId || session.model || '-']
          ])
        ],
        tools: [
          inspectorSection('Recent Tool Trace', traceItems.slice(-6).reverse().map((trace) => [
            trace.kind || 'event',
            [trace.title || trace.status || '-', trace.detail || trace.sessionPath || trace.source || '-'].filter(Boolean).join(' / ').slice(0, 180)
          ])),
          inspectorSection('Live Events', liveEvents.slice(-4).reverse().map((event) => [
            event.type || 'event',
            firstLine(event.text || event.delta || event.message || safeStringify(event.event || event)).slice(0, 160)
          ]))
        ],
        knowledge: [
          inspectorSection('Memory / Skills', [
            ['Memory', memories.length ? String(memories.length) + ' entries / ' + (memories[0].title || memories[0].memoryId || memories[0].id || '-') : '未读取或宿主未开放'],
            ['Skills', skills.length ? skills.slice(0, 4).map((skill) => skill.name || skill.id).join(', ') : '未读取或宿主未开放'],
            ['Research card', state.researchCard ? state.researchCard.title || 'generated' : '未生成']
          ])
        ],
        worker: [
          inspectorSection('Worker / Assignment', [
            ['Assignment', assignment ? (assignment.label || assignment.id) + ' / ' + (assignment.state || '-') : '未选择 worker'],
            ['Task', assignment ? firstLine(assignment.task || assignment.rationale || '-').slice(0, 140) : '-'],
            ['Checkpoint', assignment && (assignment.result || assignment.blocker || assignment.nextAction) ? firstLine(assignment.result || assignment.blocker || assignment.nextAction).slice(0, 140) : '暂无 checkpoint']
          ])
        ]
      };
      const activeTab = inspectorTabs.some((tab) => tab.id === state.inspectorTab) ? state.inspectorTab : 'activity';
      state.inspectorTab = activeTab;
      root.classList.toggle('collapsed', Boolean(state.inspectorCollapsed));
      root.innerHTML =
        '<div class="inspector-toolbar">' +
          '<div class="inspector-summary">' +
            inspectorStat(messages.length, 'messages') +
            inspectorStat(traceItems.length, 'tool trace') +
            inspectorStat(context ? String(context.percent || 0) + '%' : '-', 'context') +
          '</div>' +
          '<div class="inspector-tabs" role="tablist" aria-label="Inspector views">' +
            inspectorTabs.map((tab) => '<button class="mini inspector-tab ' + (tab.id === activeTab ? 'active' : '') + '" type="button" role="tab" aria-selected="' + (tab.id === activeTab ? 'true' : 'false') + '" data-inspector-tab="' + escapeAttr(tab.id) + '">' + escapeHtml(tab.label) + '</button>').join('') +
          '</div>' +
          '<button id="inspectorCollapseBtn" class="mini inspector-collapse" type="button">' + (state.inspectorCollapsed ? '展开 Inspector' : '折叠 Inspector') + '</button>' +
        '</div>' +
        '<div class="inspector-body" role="tabpanel">' + (sections[activeTab] || sections.activity).join('') + '</div>';
      for (const button of root.querySelectorAll('[data-inspector-tab]')) {
        button.addEventListener('click', () => {
          state.inspectorTab = button.dataset.inspectorTab || 'activity';
          state.inspectorCollapsed = false;
          renderInspectorPanel();
        });
      }
      const collapse = $('inspectorCollapseBtn');
      if (collapse) collapse.addEventListener('click', () => toggleInspectorCollapsed());
    }

    function toggleInspectorCollapsed() {
      state.inspectorCollapsed = !state.inspectorCollapsed;
      renderInspectorPanel();
    }

    function inspectorStat(value, label) {
      return '<div class="inspector-stat"><b>' + escapeHtml(String(value)) + '</b><span>' + escapeHtml(label) + '</span></div>';
    }

    function inspectorSection(title, rows) {
      const safeRows = Array.isArray(rows) && rows.length ? rows : [['Empty', '-']];
      return '<section class="inspector-section"><h3>' + escapeHtml(title) + '</h3>' +
        safeRows.map((row) => '<div class="inspector-row"><b>' + escapeHtml(row[0] || '-') + '</b><span>' + escapeHtml(row[1] || '-') + '</span></div>').join('') +
        '</section>';
    }

    function buildResearchCard() {
      const mission = $('missionInput') ? $('missionInput').value.trim() : '';
      const notes = $('notesInput') ? $('notesInput').value.trim() : '';
      const output = $('workerOutput') ? (($('workerOutput').innerText || $('workerOutput').textContent || '').trim()) : '';
      const messages = Array.isArray(state.sessionHistory) ? state.sessionHistory : [];
      const memory = Array.isArray(state.memoryEntries) ? state.memoryEntries : [];
      const traces = state.toolTrace && Array.isArray(state.toolTrace.items) ? state.toolTrace.items : [];
      const newline = String.fromCharCode(10);
      const corpus = [
        mission,
        notes,
        output,
        ...messages.slice(-8).map((item) => item.text || item.content || item.message || ''),
        ...memory.slice(0, 8).map((item) => [item.title, item.summary, item.content].filter(Boolean).join(' - ')),
        ...traces.slice(0, 12).map((item) => [item.title, item.detail, item.file, item.command].filter(Boolean).join(' '))
      ].filter(Boolean).join(newline);
      const title = mission ? firstLine(mission).slice(0, 90) : state.activeMission?.title || 'Research brief';
      const questions = researchQuestionsFromText(mission || notes || corpus);
      const sources = researchSourcesFromState(messages, memory, traces, output);
      const findings = researchFindingsFromText(corpus);
      const unknowns = researchUnknownsFromText(corpus, questions);
      const nextSteps = researchNextStepsFromText(corpus, sources, unknowns);
      state.researchCard = {
        title,
        summary: findings[0] || firstLine(notes || output || mission || 'No research content yet.'),
        questions,
        sources,
        findings,
        unknowns,
        nextSteps,
        generatedAt: new Date().toISOString(),
        sessionPath: $('sessionSelect') ? $('sessionSelect').value || '' : '',
        agentId: $('agentSelect') ? $('agentSelect').value || '' : '',
        missionId: state.activeMission ? state.activeMission.id : ''
      };
      renderResearchCard();
      notifyWorkbench('chat', 'Research Card 已生成', state.researchCard.title);
      log('Research Card 已生成');
      return state.researchCard;
    }

    function renderResearchCard() {
      const root = $('researchCardPanel');
      if (!root) return;
      const card = state.researchCard;
      if (!card) {
        root.innerHTML = '<div class="empty">点击“研究卡片”后，会从 Mission、Notes、session history、tool trace、memory 和 Worker Output 中生成嵌入式研究简报。</div>';
        return;
      }
      root.innerHTML =
        '<article class="research-card">' +
          '<div class="research-card-head"><div><h3>' + escapeHtml(card.title || 'Research Card') + '</h3><p>' + escapeHtml(card.summary || '-') + '</p></div><span class="tag">' + escapeHtml(formatTaskTime(card.generatedAt)) + '</span></div>' +
          '<div class="research-grid">' +
            researchSectionHtml('Research Questions', card.questions) +
            researchSectionHtml('Sources / Evidence', card.sources) +
            researchSectionHtml('Findings', card.findings) +
            researchSectionHtml('Uncertainty', card.unknowns) +
            researchSectionHtml('Next Steps', card.nextSteps) +
            researchSectionHtml('Context', [card.sessionPath ? 'session: ' + card.sessionPath : '', card.agentId ? 'agent: ' + card.agentId : '', card.missionId ? 'mission: ' + card.missionId : ''].filter(Boolean)) +
          '</div>' +
        '</article>';
    }

    function researchSectionHtml(title, items) {
      const safeItems = Array.isArray(items) && items.length ? items : ['-'];
      return '<section class="research-section"><b>' + escapeHtml(title) + '</b><ul>' +
        safeItems.slice(0, 8).map((item) => '<li>' + escapeHtml(item || '-') + '</li>').join('') +
        '</ul></section>';
    }

    function researchQuestionsFromText(text) {
      const lines = splitUsefulLines(text);
      const explicit = lines.filter((line) => /[?？]$|^(what|why|how|when|where|who|是否|如何|为什么|哪些|什么)/i.test(line)).slice(0, 5);
      if (explicit.length) return explicit;
      return lines.slice(0, 3).map((line) => '需要验证：' + line.replace(/^[-*#\d.\s]+/, '').slice(0, 120));
    }

    function researchSourcesFromState(messages, memory, traces, output) {
      const sources = [];
      const add = (text) => {
        const value = cleanText(text);
        if (value && !sources.includes(value)) sources.push(value.slice(0, 180));
      };
      for (const trace of traces) add([trace.source || 'tool-trace', trace.title || trace.command || trace.file || trace.detail].filter(Boolean).join(': '));
      for (const entry of memory.slice(0, 4)) add(['memory', entry.title || entry.memoryId || entry.id, entry.summary || entry.path].filter(Boolean).join(': '));
      for (const message of messages.slice(-4)) add(['session', message.role || message.type || 'message', firstLine(message.text || message.content || message.message || '')].filter(Boolean).join(': '));
      const urls = String(output || '').match(new RegExp('https?://[^\\\\s)]+', 'g')) || [];
      urls.slice(0, 5).forEach(add);
      return sources.length ? sources : ['当前上下文未发现明确来源；请补充来源 URL、文件或 session history。'];
    }

    function researchFindingsFromText(text) {
      const lines = splitUsefulLines(text);
      const signal = lines.filter((line) => /结论|发现|结果|result|finding|therefore|因此|说明|证明|evidence|source/i.test(line));
      return uniqueShortLines(signal.concat(lines)).slice(0, 6);
    }

    function researchUnknownsFromText(text, questions) {
      const lines = splitUsefulLines(text);
      const signal = lines.filter((line) => /待验证|未知|不确定|风险|缺口|TODO|unknown|uncertain|risk|gap|verify/i.test(line));
      if (signal.length) return uniqueShortLines(signal).slice(0, 5);
      return (questions || []).slice(0, 3).map((item) => '尚未形成可验证答案：' + item.slice(0, 110));
    }

    function researchNextStepsFromText(text, sources, unknowns) {
      const lines = splitUsefulLines(text);
      const signal = lines.filter((line) => /下一步|next|action|follow|todo|建议|验证|compare|对比/i.test(line));
      const fallback = [];
      if (!sources || sources.length <= 1) fallback.push('补充至少 2 个可追踪来源或相关文件路径。');
      if (unknowns && unknowns.length) fallback.push('逐条验证不确定项，并把证据写回 Worker Output 或 Memory。');
      fallback.push('将研究结论转为 mission assignment 或 run artifact 供复核。');
      return uniqueShortLines(signal.concat(fallback)).slice(0, 5);
    }

    function splitUsefulLines(text) {
      return String(text || '')
        .split(new RegExp(String.fromCharCode(10) + '+'))
        .map((line) => line.replace(/\s+/g, ' ').trim())
        .filter((line) => line && line.length > 8 && !isRuleOnlyLine(line))
        .map((line) => line.replace(/^[-*#>\d.)\s]+/, '').trim())
        .filter(Boolean);
    }

    function isRuleOnlyLine(line) {
      return String(line || '').split('').every((ch) => '-=_~'.includes(ch) || ch.charCodeAt(0) === 96);
    }

    function uniqueShortLines(lines) {
      const out = [];
      const seen = new Set();
      for (const line of lines || []) {
        const value = cleanText(line).slice(0, 180);
        const key = value.toLowerCase();
        if (!value || seen.has(key)) continue;
        seen.add(key);
        out.push(value);
      }
      return out;
    }

    function researchCardMarkdown(card = state.researchCard) {
      if (!card) return '';
      const newline = String.fromCharCode(10);
      const section = (title, items) => ['## ' + title, ...(Array.isArray(items) && items.length ? items : ['-']).map((item) => '- ' + item)].join(newline);
      return [
        '# Research Card: ' + (card.title || 'Research brief'),
        '',
        card.summary || '',
        '',
        section('Research Questions', card.questions),
        '',
        section('Sources / Evidence', card.sources),
        '',
        section('Findings', card.findings),
        '',
        section('Uncertainty', card.unknowns),
        '',
        section('Next Steps', card.nextSteps),
        '',
        ['## Context', card.sessionPath ? '- session: ' + card.sessionPath : '', card.agentId ? '- agent: ' + card.agentId : '', card.missionId ? '- mission: ' + card.missionId : '', card.generatedAt ? '- generated: ' + card.generatedAt : ''].filter(Boolean).join(newline)
      ].join(newline);
    }

    async function copyResearchCard() {
      const card = state.researchCard || buildResearchCard();
      const text = researchCardMarkdown(card);
      if (!text) return;
      await copyText(text);
      log('Research Card 已复制');
    }

    async function saveResearchCardToMemory() {
      const card = state.researchCard || buildResearchCard();
      const content = researchCardMarkdown(card);
      if (!content) return;
      try {
        const data = await requestJson(urls.memory, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Research: ' + (card.title || 'Brief'),
            summary: card.summary || '',
            content
          })
        });
        state.memoryEntry = data.entry || null;
        await loadMemoryEntries();
        log('Research Card 已保存到 Memory');
        notifyWorkbench('complete', 'Research Card 已保存', (data.entry && (data.entry.title || data.entry.memoryId)) || card.title);
      } catch (err) {
        log('保存 Research Card 到 Memory 失败: ' + err.message);
        notifyWorkbench('failed', 'Research Card 保存失败', err.message);
      }
    }

    async function recordResearchCardArtifact() {
      const card = state.researchCard || buildResearchCard();
      const content = researchCardMarkdown(card);
      if (!content) return;
      const mission = state.activeMission;
      const assignment = getActiveAssignment();
      try {
        const data = await requestJson(urls.runRecords, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'artifact',
            title: 'Research Card: ' + (card.title || 'Brief'),
            summary: card.summary || firstLine(content).slice(0, 160),
            content,
            missionId: mission ? mission.id : card.missionId || '',
            assignmentId: assignment ? assignment.id : '',
            taskId: assignment && assignment.taskId ? assignment.taskId : '',
            sessionPath: card.sessionPath || ($('sessionSelect') ? $('sessionSelect').value : ''),
            agentId: card.agentId || ($('agentSelect') ? $('agentSelect').value : '')
          })
        });
        state.runRecords.unshift(data.record);
        await loadRunRecords();
        log('Research Card 已记录为 Run artifact');
        notifyWorkbench('complete', 'Research artifact 已记录', data.record.title || card.title);
      } catch (err) {
        log('记录 Research Card 失败: ' + err.message);
        notifyWorkbench('failed', 'Research artifact 记录失败', err.message);
      }
    }

    function renderAgentConfigPanel() {
      const root = $('agentConfigPanel');
      if (!root) return;
      const config = state.agentConfig && state.agentConfig.config ? state.agentConfig.config : null;
      if (!config) {
        root.innerHTML = '<div class="empty">读取后显示 agent model、memory 和 enabled skills。</div>';
        return;
      }
      const skills = config.skills && Array.isArray(config.skills.enabled) ? config.skills.enabled : [];
      const agent = config.agent || {};
      fillAgentProfileForm(config);
      root.innerHTML =
        '<div class="item">' +
          '<b>' + escapeHtml(config.name || state.agentConfig.agentId || 'Agent') + '</b>' +
          '<span>model: ' + escapeHtml(config.model || '-') + '</span>' +
          '<span>memory: ' + escapeHtml(config.memory && config.memory.enabled ? 'enabled' : 'disabled') + '</span>' +
          '<span>user profile: ' + escapeHtml(config.memory && config.memory.userProfileEnabled === false ? 'disabled' : 'enabled') + '</span>' +
          '<span>agent behavior: max turns ' + escapeHtml(String(agent.maxTurns || '-')) + ' / timeout ' + escapeHtml(String(agent.gatewayTimeout || '-')) + 's / tool use ' + escapeHtml(agent.toolUseEnforcement || 'auto') + '</span>' +
          '<span>skills: ' + escapeHtml(skills.length ? skills.join(', ') : '-') + '</span>' +
          (config.override ? '<span>override: ' + escapeHtml(config.override.updatedAt || config.override.source || 'local') + '</span>' : '') +
        '</div>';
    }

    function fillAgentProfileForm(config) {
      if ($('agentProfileNameInput')) $('agentProfileNameInput').value = config.name || '';
      if ($('agentProfileModelInput')) $('agentProfileModelInput').value = config.model || '';
      if ($('agentProfileMemorySelect')) $('agentProfileMemorySelect').value = config.memory && config.memory.enabled === false ? 'disabled' : config.memory && config.memory.enabled === true ? 'enabled' : '';
      if ($('agentProfileUserProfileSelect')) $('agentProfileUserProfileSelect').value = config.memory && config.memory.userProfileEnabled === false ? 'disabled' : config.memory && config.memory.userProfileEnabled === true ? 'enabled' : '';
      if ($('agentProfileMaxTurnsInput')) $('agentProfileMaxTurnsInput').value = config.agent && config.agent.maxTurns ? String(config.agent.maxTurns) : '';
      if ($('agentProfileGatewayTimeoutInput')) $('agentProfileGatewayTimeoutInput').value = config.agent && config.agent.gatewayTimeout ? String(config.agent.gatewayTimeout) : '';
      if ($('agentProfileToolUseSelect')) $('agentProfileToolUseSelect').value = config.agent && config.agent.toolUseEnforcement ? config.agent.toolUseEnforcement : '';
      if ($('agentProfileSkillsInput')) {
        const skills = config.skills && Array.isArray(config.skills.enabled) ? config.skills.enabled : [];
        $('agentProfileSkillsInput').value = skills.join(', ');
      }
    }

    function renderModelSuggestions() {
      const root = $('modelSuggestionPanel');
      if (!root) return;
      const result = state.modelSuggestions || null;
      if (!result || !Array.isArray(result.recommendations)) {
        root.innerHTML = '<div class="empty">点击“建议模型”后显示基于 mission、模式和 pinned models 的推荐。</div>';
        return;
      }
      root.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'item';
      head.innerHTML =
        '<b>' + escapeHtml('Model Suggestions / ' + (result.targetTier || 'balanced')) + '</b>' +
        '<span>' + escapeHtml(result.toast || '-') + '</span>';
      root.appendChild(head);
      for (const suggestion of result.recommendations.slice(0, 5)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'item';
        const metaLine = [
          suggestion.contextWindow ? 'ctx ' + String(suggestion.contextWindow) : '',
          suggestion.inputCostPer1M || suggestion.outputCostPer1M ? 'price $' + String(suggestion.inputCostPer1M || 0) + '/$' + String(suggestion.outputCostPer1M || 0) + ' per 1M' : ''
        ].filter(Boolean).join(' / ');
        item.innerHTML =
          '<b>' + escapeHtml(suggestion.model || 'Configure model') + '</b>' +
          '<span>' + escapeHtml((suggestion.tier || '-') + ' / score ' + String(suggestion.score || 0) + ' / ' + (suggestion.source || '-')) + '</span>' +
          (metaLine ? '<span>' + escapeHtml(metaLine) + '</span>' : '') +
          '<span>' + escapeHtml(suggestion.reason || '') + '</span>';
        item.addEventListener('click', () => {
          if (suggestion.model && $('agentProfileModelInput')) $('agentProfileModelInput').value = suggestion.model;
          log(suggestion.model ? '已应用建议模型: ' + suggestion.model : '请先配置模型');
        });
        root.appendChild(item);
      }
    }

    function cleanText(value) {
      if (value === null || value === undefined) return '';
      if (typeof value === 'string') return value.trim();
      return String(value).trim();
    }

    function buildModelChooserCandidates() {
      const rows = [];
      const seen = new Set();
      const currentAgentId = $('agentSelect') ? $('agentSelect').value || '' : '';
      const add = (input, source, defaults = {}) => {
        const model = cleanText(input && (input.model || input.modelId || input.id || input.name || input));
        if (!model) return;
        const provider = cleanText(input && input.provider) || cleanText(defaults.provider);
        const key = (provider + ':' + model + ':' + source).toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        rows.push({
          model,
          provider,
          source,
          sourceLabel: defaults.sourceLabel || modelChooserSourceLabel(source),
          agentId: cleanText(input && input.agentId) || cleanText(defaults.agentId),
          tier: cleanText(input && input.tier) || cleanText(defaults.tier),
          score: Number(input && input.score) || 0,
          contextWindow: Number(input && input.contextWindow) || Number(defaults.contextWindow) || 0,
          inputCostPer1M: input && input.inputCostPer1M,
          outputCostPer1M: input && input.outputCostPer1M,
          reason: cleanText(input && (input.reason || input.description || input.summary)) || cleanText(defaults.reason),
          pinnedAt: cleanText(input && input.pinnedAt),
          sessionPath: cleanText(input && input.sessionPath) || cleanText(defaults.sessionPath)
        });
      };
      const suggestions = state.modelSuggestions && Array.isArray(state.modelSuggestions.recommendations) ? state.modelSuggestions.recommendations : [];
      suggestions.forEach((item) => add(item, 'suggestion', { sourceLabel: 'Smart suggestion' }));
      (Array.isArray(state.config.pinnedModels) ? state.config.pinnedModels : []).forEach((item) => add(item, 'pinned', { sourceLabel: 'Pinned model' }));
      (Array.isArray(state.config.modelMetadata) ? state.config.modelMetadata : []).forEach((item) => add(item, 'metadata', { sourceLabel: 'Model metadata' }));
      const currentModel = $('agentProfileModelInput') ? $('agentProfileModelInput').value.trim() : '';
      if (currentModel) add({ model: currentModel, agentId: currentAgentId }, 'current', { reason: 'Current Agent Runtime model input.' });
      const config = state.agentConfig && state.agentConfig.config ? state.agentConfig.config : {};
      if (config.model) add({ model: config.model, agentId: currentAgentId }, 'current', { reason: 'Current agent config model.' });
      for (const session of Array.isArray(state.sessions) ? state.sessions : []) {
        const model = session.modelId || session.model || '';
        if (model) add({ model, provider: session.provider, agentId: session.agentId, sessionPath: session.path }, 'session', { reason: session.title || session.path || 'Session metadata model.' });
      }
      return rows.sort((a, b) => modelChoiceRank(b) - modelChoiceRank(a) || a.model.localeCompare(b.model));
    }

    function modelChoiceRank(item) {
      const sourceScore = { suggestion: 50, pinned: 40, current: 30, metadata: 20, session: 10 }[item.source] || 0;
      return sourceScore + Number(item.score || 0);
    }

    function modelChooserSourceLabel(source) {
      return ({
        suggestion: 'Smart suggestion',
        pinned: 'Pinned model',
        metadata: 'Model metadata',
        current: 'Current runtime',
        session: 'Session metadata'
      })[source] || source || 'Model';
    }

    function modelChooserFilteredCandidates() {
      const query = String(state.modelChooserQuery || '').trim().toLowerCase();
      const source = state.modelChooserSource || '';
      return buildModelChooserCandidates().filter((item) => {
        if (source && item.source !== source) return false;
        if (!query) return true;
        return [
          item.model,
          item.provider,
          item.sourceLabel,
          item.tier,
          item.reason,
          item.agentId,
          item.sessionPath
        ].join(' ').toLowerCase().includes(query);
      });
    }

    function renderModelChooser() {
      const backdrop = $('modelChooserBackdrop');
      const list = $('modelChooserList');
      const input = $('modelChooserSearchInput');
      const sourceSelect = $('modelChooserSourceSelect');
      if (!backdrop || !list || !input || !sourceSelect) return;
      backdrop.classList.toggle('open', Boolean(state.modelChooserOpen));
      backdrop.setAttribute('aria-hidden', state.modelChooserOpen ? 'false' : 'true');
      input.value = state.modelChooserQuery || '';
      sourceSelect.value = state.modelChooserSource || '';
      if (!state.modelChooserOpen) return;
      const candidates = modelChooserFilteredCandidates();
      if ($('modelChooserMeta')) $('modelChooserMeta').textContent = String(candidates.length) + ' models';
      list.innerHTML = '';
      if (!candidates.length) {
        list.innerHTML = '<div class="empty">没有可选模型。先在 OpenHanako 配置模型，或在 HanaAgent pinned/modelMetadata 中加入候选。</div>';
        return;
      }
      for (const choice of candidates.slice(0, 60)) {
        const item = document.createElement('div');
        item.className = 'model-choice';
        const meta = [
          choice.sourceLabel,
          choice.provider ? 'provider ' + choice.provider : '',
          choice.tier ? 'tier ' + choice.tier : '',
          choice.score ? 'score ' + String(choice.score) : '',
          choice.contextWindow ? 'ctx ' + String(choice.contextWindow) : '',
          choice.inputCostPer1M || choice.outputCostPer1M ? 'price $' + String(choice.inputCostPer1M || 0) + '/$' + String(choice.outputCostPer1M || 0) + ' per 1M' : '',
          choice.agentId ? 'agent ' + choice.agentId : '',
          choice.sessionPath ? 'session linked' : ''
        ].filter(Boolean);
        item.innerHTML =
          '<div class="model-choice-head"><div><b>' + escapeHtml(choice.model) + '</b><span>' + escapeHtml(choice.provider || 'provider unset') + '</span></div><span class="tag">' + escapeHtml(choice.sourceLabel) + '</span></div>' +
          '<div class="model-choice-meta">' + meta.map((entry) => '<span>' + escapeHtml(entry) + '</span>').join('') + '</div>' +
          (choice.reason ? '<span>' + escapeHtml(choice.reason) + '</span>' : '') +
          '<div class="actions"><button class="mini primary apply-model-choice">应用</button><button class="mini pin-model-choice">Pin</button><button class="mini copy-model-choice">复制</button></div>';
        item.querySelector('.apply-model-choice').addEventListener('click', () => applyModelChoice(choice));
        item.querySelector('.pin-model-choice').addEventListener('click', () => pinModelChoice(choice));
        item.querySelector('.copy-model-choice').addEventListener('click', () => copyText(choice.model).then(() => log('模型 ID 已复制')));
        list.appendChild(item);
      }
    }

    async function openModelChooser(options = {}) {
      state.modelChooserOpen = true;
      renderModelChooser();
      setTimeout(() => {
        const input = $('modelChooserSearchInput');
        if (input) input.focus();
      }, 0);
      if (options.refreshSuggestions) await suggestModel({ keepChooserOpen: true });
    }

    function closeModelChooser() {
      state.modelChooserOpen = false;
      state.modelChooserQuery = '';
      state.modelChooserSource = '';
      renderModelChooser();
    }

    function handleModelChooserInput(event) {
      state.modelChooserQuery = event.target.value || '';
      renderModelChooser();
    }

    function handleModelChooserSource(event) {
      state.modelChooserSource = event.target.value || '';
      renderModelChooser();
    }

    function handleModelChooserKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeModelChooser();
      }
    }

    function applyModelChoice(choice) {
      if (!choice || !choice.model) return;
      if (choice.agentId && $('agentSelect')) $('agentSelect').value = choice.agentId;
      if ($('agentProfileModelInput')) $('agentProfileModelInput').value = choice.model;
      if ($('sessionSelect') && choice.sessionPath) $('sessionSelect').value = choice.sessionPath;
      renderAgents();
      renderSessions();
      renderSessionDetail();
      renderWorkbenchModes();
      closeModelChooser();
      log('已应用模型: ' + choice.model + (choice.provider ? ' / ' + choice.provider : ''));
      notifyWorkbench('model', '模型已应用', choice.model);
    }

    async function pinModelChoice(choice) {
      if (!choice || !choice.model) return;
      const agentId = choice.agentId || ($('agentSelect') ? $('agentSelect').value || '' : '');
      const pinnedModels = [
        {
          model: choice.model,
          provider: choice.provider || '',
          agentId,
          source: choice.source || 'chooser',
          pinnedAt: new Date().toISOString()
        },
        ...(Array.isArray(state.config.pinnedModels) ? state.config.pinnedModels : []).filter((item) => item.model !== choice.model || (item.agentId || '') !== agentId)
      ].slice(0, 12);
      await savePreferencesPatch({ pinnedModels }, 'Model Chooser 已 Pin 模型');
      state.modelChooserOpen = true;
      renderModelChooser();
    }

    function renderAgentSkillsPanel() {
      const root = $('agentSkillsPanel');
      if (!root) return;
      const skills = state.agentSkills && Array.isArray(state.agentSkills.skills) ? state.agentSkills.skills : [];
      if (!skills.length) {
        root.innerHTML = '<div class="empty">读取后显示 agent 可用 skills；宿主未开放 agent:skills 时会降级。</div>';
        return;
      }
      root.innerHTML = '';
      for (const skill of skills.slice(0, 8)) {
        const item = document.createElement('div');
        item.className = 'item';
        item.innerHTML =
          '<b>' + escapeHtml(skill.name || skill.id) + '</b>' +
          '<span>' + escapeHtml(skill.description || skill.category || '-') + '</span>' +
          '<span>' + escapeHtml(skill.enabled === false ? 'disabled' : 'enabled') + '</span>';
        root.appendChild(item);
      }
    }

    function renderIntegrationCatalogPanel() {
      const root = $('integrationCatalogPanel');
      if (!root) return;
      const catalog = state.integrations || {};
      const allItems = Array.isArray(catalog.items) ? catalog.items : [];
      const query = (($('integrationSearchInput') && $('integrationSearchInput').value) || '').trim().toLowerCase();
      const kind = (($('integrationKindSelect') && $('integrationKindSelect').value) || '').trim();
      const items = allItems.filter((item) => {
        if (kind && item.kind !== kind) return false;
        if (!query) return true;
        return [item.name, item.id, item.description, item.source, item.category, item.kind, item.status]
          .some((value) => String(value || '').toLowerCase().includes(query));
      });
      if (!items.length) {
        root.innerHTML = '<div class="empty">Integration Catalog 会汇总 MCP connectors、agent skills、host capabilities 和已安装插件。</div>';
        return;
      }
      root.innerHTML = '';
      const health = catalog.health || {};
      const head = document.createElement('div');
      head.className = 'item';
      head.innerHTML =
        '<b>' + escapeHtml('Catalog ' + (health.status || 'unknown') + ' / showing ' + String(items.length) + ' of ' + String(allItems.length || items.length)) + '</b>' +
        '<span>' + escapeHtml('mcp ' + String(health.mcpConnectors || 0) + ' / skills ' + String(health.skills || 0) + ' / disabled ' + String(health.disabled || 0) + ' / high risk ' + String(health.highRisk || 0)) + '</span>';
      root.appendChild(head);
      const groups = groupBy(items.slice(0, 40), (item) => item.category || item.kind || 'Integrations');
      for (const [category, groupItems] of groups) {
        const groupHead = document.createElement('div');
        groupHead.className = 'item';
        groupHead.innerHTML = '<b>' + escapeHtml(category + ' (' + groupItems.length + ')') + '</b>';
        root.appendChild(groupHead);
        for (const item of groupItems) {
          const el = document.createElement('div');
          el.className = 'item';
          const actions = Array.isArray(item.actions) ? item.actions : [];
          el.innerHTML =
            '<b>' + escapeHtml(item.name || item.id) + '</b>' +
            '<span>' + escapeHtml((item.kind || '-') + ' / ' + (item.status || '-') + ' / risk ' + (item.risk || 'low')) + '</span>' +
            '<span>' + escapeHtml(item.description || item.source || '-') + '</span>' +
            '<span>' + escapeHtml(item.source || '-') + '</span>' +
            (actions.length ? '<div class="integration-actions">' + actions.map((action) => '<button class="mini integration-action" data-action-id="' + escapeAttr(action.id || '') + '" data-payload="' + escapeAttr(JSON.stringify(action.payload || {})) + '" data-risk="' + escapeAttr(action.risk || 'low') + '">' + escapeHtml(action.label || action.id) + '</button>').join('') + '</div>' : '');
          for (const button of el.querySelectorAll('.integration-action')) {
            button.addEventListener('click', () => runIntegrationAction(button.dataset.actionId || '', button.dataset.payload || '{}'));
          }
          root.appendChild(el);
        }
      }
    }

    function groupBy(items, keyFn) {
      const groups = new Map();
      for (const item of items) {
        const key = keyFn(item);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      }
      return [...groups.entries()];
    }

    function unique(items) {
      return [...new Set((Array.isArray(items) ? items : []).map((item) => String(item || '').trim()).filter(Boolean))];
    }

    function getSlashQuery() {
      const input = $('missionInput');
      if (!input) return '';
      const value = input.value || '';
      const trimmed = value.trimStart();
      if (!trimmed.startsWith('/')) return '';
      const firstLine = trimmed.split('\\\\n')[0] || '';
      const token = firstLine.split(/\s+/)[0] || '';
      return token.startsWith('/') ? token : '';
    }

    function matchingSlashCommands() {
      const query = state.slashQuery || '';
      if (!query) return [];
      const normalized = query.toLowerCase();
      return slashCommands.filter((command) => {
        return command.label.toLowerCase().startsWith(normalized)
          || command.title.toLowerCase().includes(normalized.slice(1))
          || command.hint.toLowerCase().includes(normalized.slice(1));
      });
    }

    function renderSlashCommandPanel() {
      const panel = $('slashCommandPanel');
      if (!panel) return;
      const commands = matchingSlashCommands();
      if (!state.slashQuery) {
        panel.classList.remove('open');
        panel.innerHTML = '';
        return;
      }
      panel.classList.add('open');
      panel.innerHTML = '';
      if (!commands.length) {
        panel.innerHTML = '<div class="empty">没有匹配的快捷命令</div>';
        return;
      }
      commands.slice(0, 8).forEach((command, index) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'command-result' + (index === state.slashActiveIndex ? ' active' : '');
        item.innerHTML =
          '<b><span>' + escapeHtml(command.label + ' ' + command.title) + '</span><span class="tag">slash</span></b>' +
          '<span>' + escapeHtml(command.hint) + '</span>';
        item.addEventListener('click', () => executeSlashCommand(command));
        panel.appendChild(item);
      });
    }

    function closeSlashCommandPanel() {
      state.slashQuery = '';
      state.slashActiveIndex = 0;
      renderSlashCommandPanel();
    }

    function stripSlashInvocation(commandLabel) {
      const input = $('missionInput');
      if (!input) return;
      const value = input.value || '';
      const leading = value.match(/^\s*/)?.[0] || '';
      const trimmed = value.slice(leading.length);
      if (!trimmed.toLowerCase().startsWith(commandLabel.toLowerCase())) return;
      input.value = trimmed.slice(commandLabel.length).replace(/^\s+/, '');
    }

    async function executeSlashCommand(command) {
      if (!command) return;
      closeSlashCommandPanel();
      stripSlashInvocation(command.label);
      try {
        await command.run();
      } catch (err) {
        log('快捷命令失败 ' + command.label + ': ' + err.message);
      }
    }

    function updateSlashCommandQuery() {
      state.slashQuery = getSlashQuery();
      state.slashActiveIndex = 0;
      renderSlashCommandPanel();
    }

    function handleSlashCommandKeydown(event) {
      const commands = matchingSlashCommands();
      if (event.key === 'Escape' && state.slashQuery) {
        event.preventDefault();
        closeSlashCommandPanel();
        return;
      }
      if (!state.slashQuery || !commands.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        state.slashActiveIndex = Math.min(commands.length - 1, state.slashActiveIndex + 1);
        renderSlashCommandPanel();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        state.slashActiveIndex = Math.max(0, state.slashActiveIndex - 1);
        renderSlashCommandPanel();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        executeSlashCommand(commands[state.slashActiveIndex] || commands[0]);
      }
    }

    function getSpeechRecognitionCtor() {
      return window.SpeechRecognition || window.webkitSpeechRecognition || null;
    }

    function setVoiceInputStatus(text, listening) {
      const button = $('voiceInputBtn');
      const status = $('voiceInputStatus');
      state.voiceListening = Boolean(listening);
      if (button) {
        button.classList.toggle('listening', state.voiceListening);
        button.textContent = state.voiceListening ? 'Stop' : 'Mic';
        button.setAttribute('aria-pressed', state.voiceListening ? 'true' : 'false');
      }
      if (status) status.textContent = text || (state.voiceListening ? 'listening' : 'voice ready');
    }

    function appendVoiceTranscript(text) {
      const input = $('missionInput');
      const transcript = String(text || '').trim();
      if (!input || !transcript) return;
      const prefix = input.value.trim() ? '\\n' : '';
      input.value = input.value + prefix + transcript;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    }

    function ensureVoiceRecognition() {
      if (state.voiceRecognition) return state.voiceRecognition;
      const Recognition = getSpeechRecognitionCtor();
      if (!Recognition) return null;
      const recognition = new Recognition();
      recognition.lang = navigator.language || 'zh-CN';
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.onstart = () => setVoiceInputStatus('listening...', true);
      recognition.onend = () => setVoiceInputStatus(state.voiceTranscript ? 'voice captured' : 'voice ready', false);
      recognition.onerror = (event) => {
        const error = event && event.error ? event.error : 'speech_error';
        setVoiceInputStatus('voice ' + error, false);
        log('语音输入失败: ' + error);
      };
      recognition.onresult = (event) => {
        let interim = '';
        let finalText = '';
        for (let index = event.resultIndex || 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          const transcript = result && result[0] ? result[0].transcript : '';
          if (result && result.isFinal) finalText += transcript;
          else interim += transcript;
        }
        if (interim) setVoiceInputStatus('listening: ' + interim.trim(), true);
        if (finalText.trim()) {
          state.voiceTranscript = finalText.trim();
          appendVoiceTranscript(state.voiceTranscript);
          setVoiceInputStatus('voice captured', true);
          log('语音已写入 Mission');
        }
      };
      state.voiceRecognition = recognition;
      return recognition;
    }

    function toggleVoiceInput() {
      if (state.voiceListening && state.voiceRecognition) {
        state.voiceRecognition.stop();
        setVoiceInputStatus('voice stopped', false);
        return;
      }
      const recognition = ensureVoiceRecognition();
      if (!recognition) {
        setVoiceInputStatus('voice unsupported', false);
        log('当前浏览器不支持 Web Speech API 语音输入');
        return;
      }
      state.voiceTranscript = '';
      try {
        recognition.start();
      } catch (err) {
        setVoiceInputStatus('voice unavailable', false);
        log('语音输入启动失败: ' + err.message);
      }
    }

    function chooseMissionAttachments() {
      const input = $('missionAttachmentInput');
      if (input) input.click();
    }

    async function readMissionAttachmentsFromInput() {
      const input = $('missionAttachmentInput');
      const files = input && input.files ? Array.from(input.files) : [];
      if (!files.length) return;
      const remaining = Math.max(0, 5 - state.attachments.length);
      const selected = files.slice(0, remaining);
      if (!selected.length) {
        log('最多保留 5 个 Mission 附件');
        input.value = '';
        return;
      }
      for (const file of selected) {
        try {
          const attachment = await readMissionAttachment(file);
          state.attachments.push(attachment);
          log('附件已读取: ' + attachment.name);
        } catch (err) {
          log('附件读取失败 ' + (file.name || 'file') + ': ' + err.message);
        }
      }
      if (files.length > selected.length) log('已跳过超过上限的附件: ' + String(files.length - selected.length));
      input.value = '';
      renderMissionAttachments();
    }

    function readMissionAttachment(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        const maxTextBytes = 32 * 1024;
        const type = file.type || '';
        const isText = type.startsWith('text/')
          || /(?:json|xml|yaml|yml|csv|markdown|javascript|typescript|html|css)$/i.test(type)
          || /\.(?:txt|md|json|yaml|yml|csv|js|ts|tsx|jsx|html|css|py|go|rs|java|rb|php|sh|sql)$/i.test(file.name || '');
        reader.onerror = () => reject(new Error('file_read_failed'));
        reader.onload = () => {
          const raw = String(reader.result || '');
          const content = isText ? raw.slice(0, maxTextBytes) : '';
          resolve({
            id: 'att-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
            name: file.name || 'attachment',
            type: type || 'application/octet-stream',
            size: file.size || 0,
            kind: isText ? 'text' : type.startsWith('image/') ? 'image' : 'binary',
            content,
            preview: isText ? content.slice(0, 280) : type.startsWith('image/') ? raw.slice(0, 120) : '',
            truncated: isText && raw.length > maxTextBytes
          });
        };
        if (isText) reader.readAsText(file);
        else if (type.startsWith('image/')) reader.readAsDataURL(file);
        else resolve({
          id: 'att-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
          name: file.name || 'attachment',
          type: type || 'application/octet-stream',
          size: file.size || 0,
          kind: 'binary',
          content: '',
          preview: '',
          truncated: false
        });
      });
    }

    function formatBytes(value) {
      const size = Number(value) || 0;
      if (size < 1024) return String(size) + ' B';
      if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
      return (size / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function renderMissionAttachments() {
      const list = $('missionAttachmentList');
      const status = $('missionAttachmentStatus');
      const attachments = Array.isArray(state.attachments) ? state.attachments : [];
      if (status) status.textContent = String(attachments.length) + ' attachments';
      if (!list) return;
      list.innerHTML = '';
      for (const attachment of attachments) {
        const item = document.createElement('div');
        item.className = 'attachment-item';
        item.innerHTML =
          '<div><b>' + escapeHtml(attachment.name || 'attachment') + '</b>' +
          '<span>' + escapeHtml((attachment.kind || 'file') + ' / ' + formatBytes(attachment.size) + (attachment.truncated ? ' / truncated' : '')) + '</span></div>' +
          '<button class="mini remove">移除</button>';
        item.querySelector('.remove').addEventListener('click', () => {
          state.attachments = attachments.filter((entry) => entry.id !== attachment.id);
          renderMissionAttachments();
        });
        list.appendChild(item);
      }
    }

    function clearMissionAttachments() {
      state.attachments = [];
      renderMissionAttachments();
      log('Mission 附件已清空');
    }

    function missionAttachmentContext() {
      const attachments = Array.isArray(state.attachments) ? state.attachments : [];
      if (!attachments.length) return '';
      const lines = ['Mission 附件上下文：'];
      attachments.forEach((attachment, index) => {
        lines.push(
          '',
          '[' + String(index + 1) + '] ' + (attachment.name || 'attachment'),
          'type: ' + (attachment.type || attachment.kind || 'file') + ' / size: ' + formatBytes(attachment.size)
        );
        if (attachment.kind === 'text' && attachment.content) {
          lines.push('content:', attachment.content);
          if (attachment.truncated) lines.push('[truncated to first 32KB]');
        } else if (attachment.kind === 'image') {
          lines.push('image attached via browser; inspect file manually if visual details matter.');
        } else {
          lines.push('binary file attached; use filename/type as context and ask user before assuming content.');
        }
      });
      return lines.join('\\n');
    }

    function notesWithAttachments(notes) {
      const attachmentContext = missionAttachmentContext();
      return [String(notes || '').trim(), attachmentContext].filter(Boolean).join('\\n\\n');
    }

    function renderGlobalSearchPanel() {
      const panel = $('globalSearchPanel');
      if (!panel) return;
      const query = state.searchQuery || '';
      const results = Array.isArray(state.searchResults) ? state.searchResults : [];
      if (!query) {
        panel.classList.remove('open');
        panel.innerHTML = '';
        return;
      }
      panel.classList.add('open');
      panel.innerHTML = '';
      if (!results.length) {
        panel.innerHTML = '<div class="empty">未找到匹配项</div>';
        return;
      }
      const head = document.createElement('div');
      head.className = 'item';
      head.innerHTML =
        '<b>' + escapeHtml('Command Search / ' + results.length + ' results') + '</b>' +
        '<span>' + escapeHtml('Enter 打开，Esc 关闭，↑/↓ 选择') + '</span>';
      panel.appendChild(head);
      results.slice(0, 12).forEach((result, index) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'command-result' + (index === state.searchActiveIndex ? ' active' : '');
        item.innerHTML =
          '<b><span>' + escapeHtml(result.title || result.id || 'Result') + '</span><span class="tag">' + escapeHtml(result.kind || '-') + '</span></b>' +
          '<span>' + escapeHtml(result.subtitle || result.detail || '-') + '</span>' +
          '<span>' + escapeHtml(result.detail || result.id || '-') + '</span>' +
          '<div class="command-meta">' +
            '<span class="tag">' + escapeHtml(result.action || 'open') + '</span>' +
            (result.status ? '<span class="tag">' + escapeHtml(result.status) + '</span>' : '') +
            (result.source ? '<span class="tag">' + escapeHtml(result.source) + '</span>' : '') +
          '</div>';
        item.addEventListener('click', () => openSearchResult(result));
        panel.appendChild(item);
      });
    }

    async function runGlobalSearch() {
      const input = $('globalSearchInput');
      const query = input ? input.value.trim() : '';
      state.searchQuery = query;
      state.searchActiveIndex = 0;
      if (!query) {
        state.searchResults = [];
        renderGlobalSearchPanel();
        return;
      }
      const sep = urls.search.includes('?') ? '&' : '?';
      const params = new URLSearchParams();
      params.set('query', query);
      params.set('limit', '40');
      const agentId = $('agentSelect').value;
      const sessionPath = $('sessionSelect').value;
      if (agentId) params.set('agentId', agentId);
      if (sessionPath) params.set('sessionPath', sessionPath);
      try {
        const data = await requestJson(urls.search + sep + params.toString());
        state.searchResults = data.results || [];
        renderGlobalSearchPanel();
      } catch (err) {
        state.searchResults = [];
        renderGlobalSearchPanel();
        log('全局搜索失败: ' + err.message);
      }
    }

    async function openSearchResult(result) {
      if (!result) return;
      const target = result.target || {};
      try {
        if (target.missionId) {
          const mission = state.missions.find((item) => item.id === target.missionId);
          if (mission) state.activeMission = mission;
          if (target.assignmentId) state.activeAssignmentId = target.assignmentId;
          renderConductor();
          renderMissionTimeline();
          renderMissionHistory();
        }
        if (target.taskId) {
          const task = state.tasks.find((item) => item.id === target.taskId || item.taskId === target.taskId);
          if (task) {
            if (task.missionId) {
              const mission = state.missions.find((item) => item.id === task.missionId);
              if (mission) state.activeMission = mission;
            }
            if (task.assignmentId) state.activeAssignmentId = task.assignmentId;
            renderConductor();
            renderBoard();
          }
        }
        if (target.workerId || target.assignmentId || target.agentId) await loadWorkerDrilldown(target.workerId || target.assignmentId || target.agentId);
        if (target.sessionPath) {
          $('sessionSelect').value = target.sessionPath;
          renderSessionDetail();
        }
        if (target.memoryId) await readMemoryEntry(target.memoryId);
        if (target.rootId && target.path) {
          $('workspaceRootSelect').value = target.rootId;
          $('workspacePathInput').value = target.path;
          if (target.type === 'directory') await loadWorkspaceFiles();
          else await loadWorkspaceFile(target.path);
        }
        if (target.integrationQuery) {
          $('integrationSearchInput').value = target.integrationQuery;
          renderIntegrationCatalogPanel();
        }
        if (target.jobId) await loadJobOutput(target.jobId).catch(() => {});
        if (result.detail) setWorkerOutputMessage({ title: result.title || result.id || 'Search Result', role: result.kind || 'search', text: result.detail, meta: result.source || '' });
        closeGlobalSearch();
        log('已打开搜索结果: ' + (result.title || result.id));
      } catch (err) {
        log('打开搜索结果失败: ' + err.message);
      }
    }

    function closeGlobalSearch() {
      state.searchQuery = '';
      state.searchResults = [];
      state.searchActiveIndex = 0;
      if ($('globalSearchInput')) $('globalSearchInput').value = '';
      renderGlobalSearchPanel();
    }

    function matchingCommandPaletteCommands() {
      const query = String(state.commandPaletteQuery || '').trim().toLowerCase();
      const commands = commandPaletteCommands.map((command) => ({ ...command }));
      if (!query) return commands;
      return commands.filter((command) => {
        const haystack = [command.id, command.title, command.subtitle, command.group, command.keywords].join(' ').toLowerCase();
        return haystack.includes(query);
      });
    }

    function renderCommandPalette() {
      const backdrop = $('commandPaletteBackdrop');
      const list = $('commandPaletteList');
      const input = $('commandPaletteInput');
      if (!backdrop || !list || !input) return;
      backdrop.classList.toggle('open', Boolean(state.commandPaletteOpen));
      backdrop.setAttribute('aria-hidden', state.commandPaletteOpen ? 'false' : 'true');
      input.value = state.commandPaletteQuery || '';
      if (!state.commandPaletteOpen) {
        list.innerHTML = '';
        return;
      }
      const commands = matchingCommandPaletteCommands();
      state.commandPaletteActiveIndex = Math.max(0, Math.min(commands.length - 1, Number(state.commandPaletteActiveIndex || 0)));
      if ($('commandPaletteMeta')) $('commandPaletteMeta').textContent = String(commands.length) + ' commands';
      if (!commands.length) {
        list.innerHTML = '<div class="empty">没有匹配命令</div>';
        return;
      }
      list.innerHTML = '';
      commands.forEach((command, index) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'command-palette-item' + (index === state.commandPaletteActiveIndex ? ' active' : '');
        item.innerHTML =
          '<div><b>' + escapeHtml(command.title) + '</b><span>' + escapeHtml(command.subtitle || command.id) + '</span></div>' +
          '<span class="tag">' + escapeHtml(command.group || 'Command') + '</span>';
        item.addEventListener('click', () => executeCommandPaletteCommand(command));
        list.appendChild(item);
      });
    }

    function openCommandPalette() {
      state.commandPaletteOpen = true;
      state.commandPaletteQuery = '';
      state.commandPaletteActiveIndex = 0;
      renderCommandPalette();
      setTimeout(() => {
        const input = $('commandPaletteInput');
        if (input) {
          input.focus();
          input.select();
        }
      }, 0);
    }

    function closeCommandPalette() {
      state.commandPaletteOpen = false;
      state.commandPaletteQuery = '';
      state.commandPaletteActiveIndex = 0;
      renderCommandPalette();
    }

    async function executeCommandPaletteCommand(command) {
      if (!command || typeof command.run !== 'function') return;
      closeCommandPalette();
      try {
        await command.run();
        log('Command Palette: ' + command.title);
      } catch (err) {
        log('Command Palette 失败: ' + (err && err.message ? err.message : String(err)));
      }
    }

    function handleCommandPaletteInput(event) {
      state.commandPaletteQuery = event.target.value || '';
      state.commandPaletteActiveIndex = 0;
      renderCommandPalette();
    }

    function handleCommandPaletteKeydown(event) {
      const commands = matchingCommandPaletteCommands();
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCommandPalette();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        state.commandPaletteActiveIndex = Math.min(commands.length - 1, state.commandPaletteActiveIndex + 1);
        renderCommandPalette();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        state.commandPaletteActiveIndex = Math.max(0, state.commandPaletteActiveIndex - 1);
        renderCommandPalette();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        executeCommandPaletteCommand(commands[state.commandPaletteActiveIndex] || commands[0]);
      }
    }

    function isEditableTarget(target) {
      const tag = String(target?.tagName || '').toLowerCase();
      return ['input', 'textarea', 'select', 'button'].includes(tag) || Boolean(target?.isContentEditable);
    }

    function handleGlobalSearchKeydown(event) {
      const results = Array.isArray(state.searchResults) ? state.searchResults : [];
      if ((event.metaKey || event.ctrlKey) && event.key === '/') {
        event.preventDefault();
        openShortcutHelp();
        return;
      }
      if (event.key === '?' && !isEditableTarget(event.target)) {
        event.preventDefault();
        openShortcutHelp();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        openCommandPalette();
        return;
      }
      if (event.key === 'Escape') {
        if (state.mobileSessionsOpen) {
          closeMobileSessionsPanel();
          return;
        }
        if ($('commandPaletteBackdrop') && $('commandPaletteBackdrop').classList.contains('open')) {
          closeCommandPalette();
          return;
        }
        if ($('modelChooserBackdrop') && $('modelChooserBackdrop').classList.contains('open')) {
          closeModelChooser();
          return;
        }
        if ($('onboardingBackdrop') && $('onboardingBackdrop').classList.contains('open')) {
          closeOnboardingTour();
          return;
        }
        if ($('shortcutHelpBackdrop') && $('shortcutHelpBackdrop').classList.contains('open')) {
          closeShortcutHelp();
          return;
        }
        if (state.artifactPreview) {
          closeArtifactPreview();
          return;
        }
        if (state.searchQuery || results.length) closeGlobalSearch();
        return;
      }
      if (!results.length) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        state.searchActiveIndex = Math.min(results.length - 1, state.searchActiveIndex + 1);
        renderGlobalSearchPanel();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        state.searchActiveIndex = Math.max(0, state.searchActiveIndex - 1);
        renderGlobalSearchPanel();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        openSearchResult(results[state.searchActiveIndex] || results[0]);
      }
    }

    async function loadIntegrations() {
      const sep = urls.integrations.includes('?') ? '&' : '?';
      try {
        const data = await requestJson(urls.integrations + sep + 'agentId=' + encodeURIComponent($('agentSelect').value || ''));
        state.integrations = data;
        renderIntegrationCatalogPanel();
        log('Integration Catalog 已读取: ' + ((data.items || []).length));
      } catch (err) {
        log('读取 Integration Catalog 失败: ' + err.message);
      }
    }

    async function runIntegrationAction(action, payloadText) {
      let payload = {};
      try {
        payload = JSON.parse(payloadText || '{}');
      } catch {
        payload = {};
      }
      try {
        const data = await requestJson(urls.integrationAction, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            payload,
            agentId: resolveConductorAgentId() || ''
          })
        });
        const update = data.settingsUpdate || (data.result && data.result.settingsUpdate) || {};
        log('Integration action 完成: ' + (update.summary || action));
        await loadIntegrations();
      } catch (err) {
        log('Integration action 失败: ' + err.message);
      }
    }

    function renderWorkerDrilldownPanel() {
      const root = $('workerDrilldownPanel');
      if (!root) return;
      const detail = state.workerDetail;
      if (!detail || !detail.worker) {
        root.innerHTML = '<div class="empty">点击 office worker、assignment 或智能体，可查看 session、task、checkpoint、run record 和 host job 详情。</div>';
        return;
      }
      const summary = detail.summary || {};
      root.innerHTML =
        '<div class="item">' +
          '<b>' + escapeHtml(detail.worker.name || detail.worker.id || detail.workerId) + '</b>' +
          '<span>' + escapeHtml((detail.worker.status || 'unknown') + ' / ' + (detail.assignment ? detail.assignment.missionTitle || detail.assignment.missionId || '' : detail.agent ? detail.agent.id : '')) + '</span>' +
          '<span>' + escapeHtml('sessions ' + (summary.sessions || 0) + ' / tasks ' + (summary.tasks || 0) + ' / checkpoints ' + (summary.checkpoints || 0) + ' / records ' + (summary.runRecords || 0)) + '</span>' +
          '<span>' + escapeHtml('artifacts ' + (summary.artifacts || 0) + ' / previews ' + (summary.previews || 0) + ' / changed ' + (summary.changedFiles || 0)) + '</span>' +
          '<span>' + escapeHtml('host jobs ' + (summary.hostTasks || 0) + ' / deferred ' + (summary.deferredTasks || 0) + ' / tokens ' + (summary.usageTokens || 0)) + '</span>' +
        '</div>';
      if (detail.ide) {
        const ide = detail.ide;
        root.appendChild(renderWorkerIdePanel(ide, detail));
      }
      if (detail.assignment) {
        const assignment = document.createElement('div');
        assignment.className = 'item';
        assignment.innerHTML =
          '<b>Assignment: ' + escapeHtml(detail.assignment.label || detail.assignment.id) + '</b>' +
          '<span>' + escapeHtml((detail.assignment.state || '-') + ' / ' + (detail.assignment.sessionPath || '-')) + '</span>' +
          '<span>' + escapeHtml(detail.assignment.result || detail.assignment.blocker || detail.assignment.nextAction || firstLine(detail.assignment.task || '')) + '</span>';
        root.appendChild(assignment);
      }
      appendWorkerDetailList(root, 'Sessions', detail.sessions, (session) => [
        session.title || session.path,
        session.agentName || session.agentId || '-',
        session.path || '-'
      ]);
      appendWorkerDetailList(root, 'Tasks', detail.tasks, (task) => [
        task.title || task.taskId || task.id,
        (task.column || task.status || '-') + ' / ' + (task.priority || task.type || '-'),
        task.description || task.parentSessionPath || ''
      ]);
      appendWorkerDetailList(root, 'Checkpoints', detail.checkpoints, (checkpoint) => [
        checkpoint.state || checkpoint.label || checkpoint.id,
        checkpoint.result || checkpoint.blocker || checkpoint.nextAction || '-',
        checkpoint.sessionPath || checkpoint.taskId || ''
      ]);
      appendWorkerDetailList(root, 'Run Records', detail.runRecords, (record) => [
        record.title || record.id,
        (record.type || '-') + ' / ' + (record.state || '-'),
        record.summary || firstLine(record.content || '') || record.path || ''
      ]);
      appendWorkerDetailList(root, 'Host Jobs', detail.hostTasks, (task) => [
        task.taskId || task.id,
        (task.type || '-') + ' / ' + (task.status || '-'),
        task.parentSessionPath || ''
      ]);
    }

    function renderWorkerIdePanel(ide, detail) {
      const panel = document.createElement('div');
      panel.className = 'item worker-ide-shell';
      const health = ide.health || {};
      const queue = ide.taskQueue || {};
      const chat = ide.chat || {};
      const terminal = ide.terminal || {};
      const files = ide.files || {};
      const identity = ide.identity || {};
      const lifecycle = ide.lifecycle || detail.lifecycle || {};
      const actions = Array.isArray(ide.quickActions) ? ide.quickActions : [];
      const previews = Array.isArray(ide.previews) ? ide.previews : [];
      const chatSessions = Array.isArray(chat.sessions) ? chat.sessions : [];
      const blockers = Array.isArray(health.blockers) ? health.blockers : [];
      const paths = Array.isArray(files.paths) ? files.paths : [];
      const changedFiles = Array.isArray(files.changedFiles) ? files.changedFiles : [];
      const editorActions = Array.isArray(files.editorActions) ? files.editorActions : [];
      const artifacts = Array.isArray(ide.artifacts) ? ide.artifacts : [];
      const approvals = Array.isArray(ide.approvals) ? ide.approvals : [];
      const workerArtifactBuckets = detail && detail.workerArtifacts && Array.isArray(detail.workerArtifacts.items) ? detail.workerArtifacts.items : [];
      const evidence = ide.evidence || {};
      const evidenceCheckpoints = Array.isArray(evidence.checkpoints) ? evidence.checkpoints : [];
      const evidenceHandoffs = Array.isArray(evidence.handoffs) ? evidence.handoffs : [];
      const evidenceHostTasks = Array.isArray(evidence.hostTasks) ? evidence.hostTasks : [];
      const evidenceDeferredTasks = Array.isArray(evidence.deferredTasks) ? evidence.deferredTasks : [];
      const panes = [
        { id: 'overview', label: 'Overview' },
        { id: 'chat', label: 'Chat' },
        { id: 'queue', label: 'Queue' },
        { id: 'terminal', label: 'Terminal' },
        { id: 'preview', label: 'Preview' },
        { id: 'files', label: 'Files' },
        { id: 'evidence', label: 'Evidence' }
      ];
      const activePane = panes.some((pane) => pane.id === state.workerIdePane) ? state.workerIdePane : 'overview';
      state.workerIdePane = activePane;
      panel.innerHTML =
        '<div class="worker-ide-hub">' +
          '<div class="worker-ide-avatar">' + escapeHtml(workerInitials(ide.title || identity.agentName || ide.id || 'W')) + '</div>' +
          '<div class="worker-ide-hub-main">' +
            '<b>' + escapeHtml('Worker IDE: ' + (ide.title || ide.id || 'worker')) + '</b>' +
            '<span>' + escapeHtml((identity.role || identity.lane || 'lane') + ' / ' + (identity.agentName || identity.agentId || 'agent') + ' / ' + (identity.cwd || 'no cwd')) + '</span>' +
            '<span>' + escapeHtml(identity.sessionPath || 'no session bound') + '</span>' +
          '</div>' +
          '<div class="worker-ide-metrics">' +
            '<span class="tag">' + escapeHtml(ide.status || '-') + '</span>' +
            '<span class="tag">' + escapeHtml('health ' + (health.state || '-')) + '</span>' +
            '<span class="tag">' + escapeHtml('lifecycle ' + (lifecycle.state || lifecycle.lifecycleState || '-')) + '</span>' +
            '<span class="tag">' + escapeHtml('queue ' + String(queue.total || 0)) + '</span>' +
            '<span class="tag">' + escapeHtml('done ' + String(queue.done || 0)) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="worker-lane-map">' +
          workerLaneNode('Hub', 'routes / monitors / escalates') +
          workerLaneNode(identity.role || identity.lane || 'Lane', queue.current ? queue.current.title || queue.current.id : 'idle') +
          workerLaneNode('Runtime', terminal.available ? 'terminal attached-capable' : 'terminal gated') +
          workerLaneNode('Review', blockers.length ? blockers[0] : String(approvals.length) + ' approvals / ' + String(artifacts.length) + ' artifacts') +
        '</div>' +
        '<div class="worker-ide-tabs" role="tablist" aria-label="Worker IDE panes">' +
          panes.map((pane) => '<button class="mini worker-ide-tab ' + (pane.id === activePane ? 'active' : '') + '" type="button" role="tab" aria-selected="' + (pane.id === activePane ? 'true' : 'false') + '" data-worker-ide-pane="' + escapeAttr(pane.id) + '">' + escapeHtml(pane.label) + '</button>').join('') +
        '</div>' +
        '<div class="worker-ide-pane" role="tabpanel">' +
          renderWorkerIdePane(activePane, { ide, detail, lifecycle, health, queue, chat, terminal, files, identity, chatSessions, blockers, paths, changedFiles, artifacts, approvals, previews, workerArtifactBuckets, evidenceCheckpoints, evidenceHandoffs, evidenceHostTasks, evidenceDeferredTasks }) +
        '</div>' +
        '<div class="quick-actions">' +
          actions.map((action) => '<button class="mini worker-action" data-action-id="' + escapeAttr(action.id || '') + '" data-target="' + escapeAttr(action.target || '') + '"' + (action.enabled ? '' : ' disabled') + '>' + escapeHtml(action.label || action.id || 'Action') + '</button>').join('') +
        '</div>';
      if (identity.sessionPath) {
        const chatBox = document.createElement('div');
        chatBox.className = 'worker-preview-panel';
        chatBox.innerHTML =
          '<div class="worker-preview-head">' +
            '<div><b>Live Worker Chat</b><span class="tag">' + escapeHtml(identity.sessionPath) + '</span></div>' +
          '</div>' +
          '<div class="terminal-bar" style="grid-template-columns:minmax(0,1fr) auto">' +
            '<input class="worker-message-input" placeholder="发消息给这个 worker 的真实 session" />' +
            '<button class="mini worker-message-send">发送</button>' +
          '</div>';
        panel.appendChild(chatBox);
        const input = chatBox.querySelector('.worker-message-input');
        const send = chatBox.querySelector('.worker-message-send');
        const submit = () => sendWorkerMessage(ide.id || detail.workerId || '', identity.sessionPath, input);
        if (send) send.addEventListener('click', submit);
        if (input) input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') submit();
        });
      }
      if (previews.length) {
        const embedded = renderWorkerPreviewPanel(previews);
        if (embedded) panel.appendChild(embedded);
        const previewList = document.createElement('div');
        previewList.className = 'quick-actions';
        previewList.innerHTML = previews.slice(0, 4).map((preview) =>
          '<button class="mini preview-link" data-url="' + escapeAttr(preview.url || '') + '">' + escapeHtml(preview.label || preview.url || 'Preview') + '</button>'
        ).join('');
        panel.appendChild(previewList);
        for (const button of previewList.querySelectorAll('.preview-link')) {
          button.addEventListener('click', () => openPreviewUrl(button.dataset.url || ''));
        }
      }
      if (changedFiles.length || editorActions.length) {
        const editorPanel = renderWorkerEditorPanel(changedFiles, editorActions);
        if (editorPanel) panel.appendChild(editorPanel);
      }
      for (const button of panel.querySelectorAll('[data-worker-ide-pane]')) {
        button.addEventListener('click', () => {
          state.workerIdePane = button.dataset.workerIdePane || 'overview';
          renderWorkerDrilldownPanel();
        });
      }
      for (const button of panel.querySelectorAll('.worker-preview-fix-task')) {
        button.addEventListener('click', () => createPreviewFixTask(button, panel));
      }
      for (const button of panel.querySelectorAll('.preview-link-inline')) {
        button.addEventListener('click', () => openPreviewUrl(button.dataset.url || ''));
      }
      for (const button of panel.querySelectorAll('.worker-action')) {
        button.addEventListener('click', () => runWorkerQuickAction(button.dataset.actionId || '', button.dataset.target || '', ide, detail));
      }
      return panel;
    }

    function renderWorkerIdePane(pane, view) {
      if (pane === 'chat') return renderWorkerChatPane(view);
      if (pane === 'queue') return renderWorkerQueuePane(view);
      if (pane === 'terminal') return renderWorkerTerminalPane(view);
      if (pane === 'preview') return renderWorkerPreviewPane(view);
      if (pane === 'files') return renderWorkerFilesPane(view);
      if (pane === 'evidence') return renderWorkerEvidencePane(view);
      return renderWorkerOverviewPane(view);
    }

    function renderWorkerOverviewPane(view) {
      const usage = view.ide.usage || {};
      const project = view.files.project || {};
      const lifecycle = view.lifecycle || {};
      return '<div class="worker-ide-grid">' +
        workerIdeCard('Identity', [
          'agent: ' + (view.identity.agentName || view.identity.agentId || '-'),
          'role: ' + (view.identity.role || view.identity.lane || '-'),
          'session: ' + (view.identity.sessionPath || '-'),
          'cwd: ' + (view.identity.cwd || '-')
        ]) +
        workerIdeCard('Project', [
          'name: ' + (project.projectName || '-'),
          'branch: ' + (project.branch || '-'),
          'root: ' + (project.rootLabel || project.rootId || '-'),
          'scripts: ' + ((project.packageScripts || []).slice(0, 4).join(' / ') || '-')
        ]) +
        workerIdeCard('Health', [
          'state: ' + (view.health.state || '-'),
          'approvals: ' + String(view.health.pendingApprovals || 0),
          'deferred: ' + String(view.health.pendingDeferred || 0),
          view.blockers.length ? 'blocker: ' + view.blockers.join(' / ') : 'blocker: -'
        ]) +
        workerIdeCard('Activity', [
          'chat sessions: ' + String(view.chatSessions.length),
          'previews: ' + String(view.previews.length),
          'changed files: ' + String(view.changedFiles.length),
          'tokens: ' + String(usage.totalTokens || usage.tokens || view.detail.summary?.usageTokens || 0)
        ]) +
        workerIdeCard('Lifecycle', [
          'state: ' + (lifecycle.state || lifecycle.lifecycleState || '-'),
          'action: ' + (lifecycle.recommendedAction || '-'),
          'context: ' + String(lifecycle.contextTokens || 0) + ' / ' + String(lifecycle.policy?.hardLimit || '-'),
          'handoff: ' + (lifecycle.lastHandoffAt ? formatTaskTime(lifecycle.lastHandoffAt) : (lifecycle.canRequestHandoff ? 'request available' : '-')),
          'reason: ' + ((lifecycle.reasons || []).slice(0, 1).join(' / ') || '-')
        ]) +
        workerIdeCard('Last Seen', [
          view.health.latestCheckpointAt ? formatTaskTime(view.health.latestCheckpointAt) : '-',
          view.ide.generatedAt ? 'snapshot: ' + formatTaskTime(view.ide.generatedAt) : ''
        ]) +
      '</div>';
    }

    function renderWorkerChatPane(view) {
      const checkpoint = view.chat.latestCheckpoint || null;
      const messages = view.chatSessions.map((session) =>
        '<div class="worker-chat-msg">' +
          '<b>' + escapeHtml(session.title || session.path || 'session') + '</b>' +
          '<span>' + escapeHtml((session.agentId || '-') + ' / messages ' + String(session.messageCount || 0)) + '</span>' +
          '<span>' + escapeHtml(session.updatedAt ? formatTaskTime(session.updatedAt) : session.path || '') + '</span>' +
        '</div>'
      ).join('');
      return '<div class="worker-chat-feed">' +
        (messages || '<div class="empty">暂无 worker session feed。可先创建或绑定 worker session。</div>') +
        (checkpoint ? '<div class="worker-chat-msg"><b>Latest Checkpoint</b><span>' + escapeHtml(checkpoint.state || checkpoint.id || '-') + '</span><span>' + escapeHtml(checkpoint.result || checkpoint.blocker || checkpoint.nextAction || '-') + '</span></div>' : '') +
        '<div class="worker-chat-msg"><b>Transcript Hint</b><span>' + escapeHtml(view.chat.transcriptHint || 'session:history unavailable') + '</span></div>' +
      '</div>';
    }

    function renderWorkerQueuePane(view) {
      const rows = [];
      if (view.queue.current) rows.push({ label: 'Current', task: view.queue.current });
      for (const task of Array.isArray(view.queue.next) ? view.queue.next.slice(0, 6) : []) rows.push({ label: 'Next', task });
      return '<div class="worker-queue-list">' +
        (rows.length ? rows.map((row) =>
          '<div class="worker-queue-row">' +
            '<b>' + escapeHtml(row.label + ': ' + (row.task.title || row.task.id || 'task')) + '</b>' +
            '<span>' + escapeHtml((row.task.column || row.task.status || '-') + ' / ' + (row.task.priority || row.task.assignee || '-')) + '</span>' +
            '<span>' + escapeHtml(row.task.description || row.task.parentSessionPath || '') + '</span>' +
          '</div>'
        ).join('') : '<div class="empty">暂无队列任务。</div>') +
        '<div class="worker-queue-row"><b>Queue Summary</b><span>' + escapeHtml('total ' + String(view.queue.total || 0) + ' / done ' + String(view.queue.done || 0)) + '</span></div>' +
      '</div>';
    }

    function renderWorkerTerminalPane(view) {
      const hostTasks = Array.isArray(view.terminal.hostTasks) ? view.terminal.hostTasks : [];
      return '<div class="worker-ide-grid">' +
        workerIdeCard('Terminal Attach', [
          view.terminal.available ? 'available' : 'capability gated',
          'session: ' + (view.terminal.sessionPath || view.identity.sessionPath || '-'),
          'hint: ' + (view.terminal.attachHint || '-')
        ]) +
        workerIdeCard('Runtime Jobs', hostTasks.map((task) => (task.taskId || task.id || 'job') + ' / ' + (task.status || '-')).slice(0, 5)) +
      '</div>';
    }

    function renderWorkerPreviewPane(view) {
      if (!view.previews.length) return '<div class="empty">暂无可嵌入或可打开的项目预览 URL。</div>';
      const selected = view.previews[0] || {};
      const project = view.files.project || {};
      return '<div class="worker-visual-picker">' +
        '<div class="worker-preview-head">' +
          '<div><b>Visual Element Picker</b><small>' + escapeHtml((project.projectName || 'Worker project') + (project.branch ? ' / ' + project.branch : '') + ' / 从 preview 生成可追踪修复任务') + '</small></div>' +
          '<button class="mini worker-preview-fix-task" type="button" data-preview-url="' + escapeAttr(selected.url || '') + '" data-worker-id="' + escapeAttr(view.ide.id || '') + '" data-session-path="' + escapeAttr(view.identity.sessionPath || '') + '" data-mission-id="' + escapeAttr(view.detail.assignment?.missionId || state.activeMission?.id || '') + '" data-assignment-id="' + escapeAttr(view.detail.assignment?.id || '') + '">Create Fix Task</button>' +
        '</div>' +
        '<div class="worker-visual-picker-grid">' +
          '<input class="worker-preview-selector" placeholder="CSS selector / element label，例如 .hero-title 或 登录按钮" />' +
          '<select class="worker-preview-priority"><option value="high">high</option><option value="medium" selected>medium</option><option value="low">low</option></select>' +
        '</div>' +
        '<textarea class="worker-preview-issue" placeholder="描述视觉问题、期望行为或要修改的文案"></textarea>' +
        '<small>' + escapeHtml(selected.url || 'No preview selected') + '</small>' +
      '</div>' +
      '<div class="worker-ide-grid">' +
        workerIdeCard('Project Metadata', [
          'project: ' + (project.projectName || '-'),
          'cwd: ' + (project.cwd || '-'),
          'branch: ' + (project.branch || '-'),
          'package: ' + (project.packageManager || '-')
        ]) +
        workerIdeCard('Dev Scripts', (project.packageScripts || []).slice(0, 6).map((script) => 'npm run ' + script)) +
      '</div>' +
      '<div class="worker-queue-list">' + view.previews.slice(0, 6).map((preview) =>
        '<div class="worker-queue-row">' +
          '<b>' + escapeHtml(preview.label || preview.url) + '</b>' +
          '<span>' + escapeHtml((preview.local ? 'local' : 'remote') + ' / ' + (preview.embedAllowed ? 'embed' : 'open-only')) + '</span>' +
          '<span>' + escapeHtml(preview.url || '') + '</span>' +
        '</div>'
      ).join('') + '</div>';
    }

    function renderWorkerFilesPane(view) {
      const project = view.files.project || {};
      const changed = view.changedFiles.map((file) =>
        '<div class="worker-queue-row">' +
          '<b>' + escapeHtml(file.relativePath || file.path || 'file') + '</b>' +
          '<span>' + escapeHtml((file.rootLabel || '-') + ' / ' + (file.openable ? 'openable' : 'outside root')) + '</span>' +
        '</div>'
      ).join('');
      return '<div class="worker-queue-list">' +
        workerIdeCard('Workspace', [
          'roots: ' + String(Array.isArray(view.files.workspaceRoots) ? view.files.workspaceRoots.length : 0),
          'primary: ' + ((view.files.primaryRoot && (view.files.primaryRoot.label || view.files.primaryRoot.id)) || '-'),
          'project: ' + (project.projectName || '-'),
          'branch: ' + (project.branch || '-'),
          'scripts: ' + ((project.packageScripts || []).slice(0, 4).join(' / ') || '-')
        ]) +
        (changed || '<div class="empty">暂无 changed files 线索。</div>') +
      '</div>';
    }

    function renderWorkerEvidencePane(view) {
      const buckets = Array.isArray(view.workerArtifactBuckets) ? view.workerArtifactBuckets : [];
      const artifactCards = buckets.map((bucket) => {
        const artifacts = Array.isArray(bucket.artifacts) && bucket.artifacts.length ? bucket.artifacts : (bucket.syntheticArtifacts || []);
        const previews = Array.isArray(bucket.previews) ? bucket.previews : [];
        return '<div class="worker-evidence-item worker-artifact-evidence">' +
          '<b>' + escapeHtml('Artifacts: ' + (bucket.workerName || bucket.workerId || '-')) + '</b>' +
          '<span>' + escapeHtml('artifacts ' + String(artifacts.length) + ' / previews ' + String(previews.length) + ' / changed ' + String((bucket.changedFiles || []).length)) + '</span>' +
          '<div class="artifact-chip-row">' + artifacts.slice(0, 6).map(renderWorkerArtifactChip).join('') + '</div>' +
          '<div class="artifact-chip-row">' + previews.slice(0, 4).map((preview) => '<button class="mini preview-link-inline" data-url="' + escapeAttr(preview.url || '') + '">' + escapeHtml(preview.label || preview.url || 'Preview') + '</button>').join('') + '</div>' +
        '</div>';
      }).join('');
      const rows = [
        ...view.artifacts.map((item) => ({ type: 'Artifact', title: item.title || item.id, detail: item.summary || item.path || '' })),
        ...view.approvals.map((item) => ({ type: 'Approval', title: item.title || item.id, detail: (item.state || '-') + ' / ' + (item.summary || '') })),
        ...view.evidenceHandoffs.map((item) => ({ type: 'Handoff', title: item.title || item.workerId, detail: item.summary || item.path || '' })),
        ...view.evidenceCheckpoints.map((item) => ({ type: 'Checkpoint', title: item.state || item.id, detail: item.result || item.blocker || item.nextAction || '' })),
        ...view.evidenceHostTasks.map((item) => ({ type: 'Host Task', title: item.taskId || item.id, detail: (item.type || '-') + ' / ' + (item.status || '-') })),
        ...view.evidenceDeferredTasks.map((item) => ({ type: 'Deferred', title: item.taskId || item.id, detail: item.status || '' }))
      ].slice(0, 12);
      return '<div class="worker-evidence-grid">' + artifactCards + (rows.length ? rows.map((row) =>
        '<div class="worker-evidence-item"><b>' + escapeHtml(row.type + ': ' + (row.title || '-')) + '</b><span>' + escapeHtml(row.detail || '-') + '</span></div>'
      ).join('') : (artifactCards ? '' : '<div class="empty">暂无 evidence。同步 history 或记录 Run Console artifact 后会出现在这里。</div>')) + '</div>';
    }

    function workerLaneNode(title, detail) {
      return '<div class="worker-lane-node"><b>' + escapeHtml(title || '-') + '</b><span>' + escapeHtml(detail || '-') + '</span></div>';
    }

    function workerInitials(value) {
      const words = String(value || 'W').trim().split(/\\s+/).filter(Boolean);
      return words.slice(0, 2).map((word) => word[0] || '').join('').toUpperCase() || 'W';
    }

    async function createPreviewFixTask(button, panel) {
      const root = panel || document;
      const selector = root.querySelector('.worker-preview-selector') ? root.querySelector('.worker-preview-selector').value.trim() : '';
      const issue = root.querySelector('.worker-preview-issue') ? root.querySelector('.worker-preview-issue').value.trim() : '';
      const priority = root.querySelector('.worker-preview-priority') ? root.querySelector('.worker-preview-priority').value : 'medium';
      const previewUrl = button.dataset.previewUrl || '';
      const workerId = button.dataset.workerId || '';
      const sessionPath = button.dataset.sessionPath || '';
      const missionId = button.dataset.missionId || '';
      const assignmentId = button.dataset.assignmentId || '';
      if (!issue && !selector) {
        log('请填写 selector 或视觉问题描述');
        return;
      }
      const title = 'Preview fix: ' + (selector || firstLine(issue).slice(0, 64) || previewUrl || workerId || 'worker');
      const description = [
        'Source: HanaAgent Worker Visual Element Picker',
        previewUrl ? 'Preview URL: ' + previewUrl : '',
        selector ? 'Selected element: ' + selector : '',
        issue ? 'Issue: ' + issue : '',
        workerId ? 'Worker: ' + workerId : '',
        sessionPath ? 'Session: ' + sessionPath : ''
      ].filter(Boolean).join('\\n');
      try {
        const result = await requestJson(urls.tasks, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title,
            description,
            column: 'backlog',
            priority,
            assignee: workerId || $('agentSelect').value || '',
            tags: ['hanaagent', 'preview-fix', 'visual-picker'],
            sessionPath,
            missionId,
            assignmentId,
            mode: 'review',
            createdBy: 'hanaagent-worker-preview'
          })
        });
        if (result.task) {
          state.tasks.unshift(result.task);
          renderBoard();
          renderMetrics();
          state.workerIdePane = 'queue';
          renderWorkerDrilldownPanel();
          log('Preview fix task 已创建: ' + result.task.title);
          notifyWorkbench('complete', 'Preview fix task 已创建', result.task.title);
        } else {
          await reloadTasks();
          log('Preview fix task 已创建');
        }
      } catch (err) {
        log('创建 Preview fix task 失败: ' + err.message);
        notifyWorkbench('failed', '创建 Preview fix task 失败', err.message);
      }
    }

    function renderWorkerEditorPanel(changedFiles, editorActions) {
      const wrap = document.createElement('div');
      wrap.className = 'worker-preview-panel';
      const actions = Array.isArray(editorActions) ? editorActions : [];
      const files = Array.isArray(changedFiles) ? changedFiles : [];
      wrap.innerHTML =
        '<div class="worker-preview-head">' +
          '<div><b>Worker Editor</b><span class="tag">' + escapeHtml(String(files.length) + ' changed') + '</span></div>' +
          '<div class="actions">' + actions.map((action) =>
            '<button class="mini worker-editor-action" data-action-id="' + escapeAttr(action.id || '') + '" data-root-id="' + escapeAttr(action.rootId || '') + '" data-path="' + escapeAttr(action.path || '') + '"' + (action.enabled ? '' : ' disabled') + '>' + escapeHtml(action.label || action.id || 'Action') + '</button>'
          ).join('') + '</div>' +
        '</div>' +
        '<div class="list compact-list">' + files.slice(0, 8).map((file) =>
          '<button class="item worker-file-link" data-root-id="' + escapeAttr(file.rootId || '') + '" data-path="' + escapeAttr(file.relativePath || file.path || '') + '"' + (file.openable ? '' : ' disabled') + '>' +
            '<b>' + escapeHtml(file.relativePath || file.path || 'file') + '</b>' +
            '<span>' + escapeHtml(file.rootLabel || (file.openable ? 'workspace file' : 'outside workspace')) + '</span>' +
          '</button>'
        ).join('') + '</div>';
      for (const button of wrap.querySelectorAll('.worker-editor-action')) {
        button.addEventListener('click', () => runWorkerEditorAction(button.dataset.actionId || '', button.dataset.rootId || '', button.dataset.path || ''));
      }
      for (const button of wrap.querySelectorAll('.worker-file-link')) {
        button.addEventListener('click', () => runWorkerEditorAction('open-changed-file', button.dataset.rootId || '', button.dataset.path || ''));
      }
      return wrap;
    }

    async function runWorkerEditorAction(actionId, rootId, pathValue) {
      if (!rootId) {
        log('该文件不在已配置 Workspace root 内');
        return;
      }
      $('workspaceRootSelect').value = rootId;
      $('workspacePathInput').value = pathValue || '.';
      if (actionId === 'open-worker-root') {
        await loadWorkspaceFiles();
      } else if (actionId === 'diff-changed-file') {
        await loadWorkspaceFile(pathValue);
        await diffWorkspaceFile();
      } else if (actionId === 'save-changed-file') {
        const active = state.workspaceFile || {};
        const activeRoot = active.root && active.root.id ? active.root.id : $('workspaceRootSelect').value;
        const activePath = active.relativePath || $('workspacePathInput').value.trim();
        if (activeRoot === rootId && activePath === pathValue) {
          await saveWorkspaceFile();
        } else {
          await loadWorkspaceFile(pathValue);
          $('workspaceEditor').focus();
          log('Worker 文件已打开，可编辑后再次点击保存: ' + pathValue);
        }
      } else {
        await loadWorkspaceFile(pathValue);
      }
    }

    async function sendWorkerMessage(workerId, sessionPath, input) {
      const text = input && input.value ? input.value.trim() : '';
      if (!workerId || !sessionPath || !text) {
        log('请填写要发送给 worker 的消息');
        return;
      }
      try {
        const data = await requestJson(appendApiPath(urls.workers, encodeURIComponent(workerId) + '/message'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionPath, text })
        });
        if (input) input.value = '';
        if ($('sessionSelect')) $('sessionSelect').value = sessionPath;
        log('Worker 消息已发送: ' + workerId);
        await loadSessionHistory();
        await loadWorkerDrilldown(workerId);
        return data;
      } catch (err) {
        log('发送 Worker 消息失败: ' + err.message);
        return null;
      }
    }

    function renderWorkerPreviewPanel(previews) {
      const preview = (Array.isArray(previews) ? previews : []).find((item) => item && item.url && item.embedAllowed);
      if (!preview) return null;
      const wrap = document.createElement('div');
      wrap.className = 'worker-preview-panel';
      wrap.innerHTML =
        '<div class="worker-preview-head">' +
          '<div><b>Project Preview</b><span class="tag">' + escapeHtml(preview.label || preview.url) + '</span></div>' +
          '<div class="actions"><button class="mini refresh-preview">刷新</button><button class="mini open-preview">外部打开</button></div>' +
        '</div>' +
        '<iframe class="worker-preview-frame" title="Worker project preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" src="' + escapeAttr(preview.url) + '"></iframe>';
      const frame = wrap.querySelector('iframe');
      const refresh = wrap.querySelector('.refresh-preview');
      const open = wrap.querySelector('.open-preview');
      if (refresh) refresh.addEventListener('click', () => {
        if (frame) frame.src = preview.url;
        log('Preview 已刷新: ' + preview.url);
      });
      if (open) open.addEventListener('click', () => openPreviewUrl(preview.url));
      return wrap;
    }

    function workerIdeCard(title, lines) {
      const visible = (Array.isArray(lines) ? lines : []).filter((line) => String(line || '').trim()).slice(0, 5);
      return '<section class="worker-ide-card"><h4><span>' + escapeHtml(title) + '</span></h4><ul>' +
        visible.map((line) => '<li>' + escapeHtml(line) + '</li>').join('') +
        '</ul></section>';
    }

    async function runWorkerQuickAction(actionId, target, ide, detail) {
      const identity = (ide && ide.identity) || {};
      const sessionPath = target || identity.sessionPath || '';
      try {
        if (actionId === 'ensure-session') {
          await ensureWorkerSession(ide, detail);
        } else if (actionId === 'open-chat') {
          if (sessionPath) $('sessionSelect').value = sessionPath;
          await loadSessionHistory();
        } else if (actionId === 'sync-history') {
          if (sessionPath) $('sessionSelect').value = sessionPath;
          state.activeAssignmentId = detail.assignment ? detail.assignment.id : state.activeAssignmentId;
          await syncHistoryCheckpoints();
        } else if (actionId === 'request-handoff') {
          const workerId = detail.workerId || detail.worker?.id || detail.assignment?.id || ide.id;
          const data = await requestJson(appendApiPath(urls.workers, encodeURIComponent(workerId) + '/handoff'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionPath })
          });
          setWorkerOutputMessage({
            title: 'Worker Lifecycle Handoff',
            role: 'lifecycle',
            text: data.prompt || 'handoff requested',
            meta: (data.lifecycle && data.lifecycle.state) || workerId
          });
          log('Worker handoff 已请求: ' + workerId + ' / ' + ((data.lifecycle && data.lifecycle.state) || 'lifecycle'));
          notifyWorkbench(data.ok ? 'alert' : 'failed', data.ok ? 'Worker handoff 已请求' : 'Worker handoff 请求失败', workerId);
        } else if (actionId === 'abort-session') {
          if (sessionPath) $('sessionSelect').value = sessionPath;
          await abortCurrentSession();
        } else if (actionId === 'attach-terminal') {
          if (sessionPath) $('sessionSelect').value = sessionPath;
          await startSessionTerminal();
        } else if (actionId === 'open-preview') {
          openPreviewUrl(target);
        } else if (actionId === 'open-files') {
          if (identity.cwd) $('workspacePathInput').value = identity.cwd;
          await loadWorkspaceFiles();
        } else if (actionId === 'mark-done') {
          if (detail.assignment) await updateAssignmentState(detail.assignment.id, 'done');
        } else if (actionId === 'mark-blocked') {
          if (detail.assignment) await updateAssignmentState(detail.assignment.id, 'blocked');
        } else {
          log('未知 Worker action: ' + actionId);
          return;
        }
        await loadWorkerDrilldown(detail.workerId || detail.worker?.id || detail.assignment?.id || ide.id);
      } catch (err) {
        log('Worker action 失败: ' + err.message);
      }
    }

    async function ensureWorkerSession(ide, detail) {
      const workerId = (detail && (detail.workerId || detail.assignment?.id || detail.worker?.id)) || (ide && ide.id) || '';
      if (!workerId) {
        log('无法识别 worker');
        return null;
      }
      const identity = (ide && ide.identity) || {};
      const payload = {
        agentId: identity.agentId || $('agentSelect').value || '',
        cwd: identity.cwd || $('terminalCwdInput').value || '',
        title: 'HanaAgent Worker: ' + ((ide && (ide.title || ide.id)) || workerId)
      };
      const data = await requestJson(appendApiPath(urls.workers, encodeURIComponent(workerId) + '/session'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (data.sessionPath) {
        $('sessionSelect').value = data.sessionPath;
        log('Worker Session 已创建并绑定: ' + data.sessionPath);
      } else {
        log('Worker Session 创建完成');
      }
      await reloadSessions();
      await loadWorkerDrilldown(workerId);
      return data;
    }

    function openPreviewUrl(url) {
      if (!url) {
        log('暂无 preview URL');
        return;
      }
      window.open(url, '_blank', 'noopener,noreferrer');
      log('Preview 已打开: ' + url);
    }

    function appendWorkerDetailList(root, label, items, render) {
      const list = Array.isArray(items) ? items : [];
      if (!list.length) return;
      const head = document.createElement('div');
      head.className = 'item';
      head.innerHTML = '<b>' + escapeHtml(label + ' (' + list.length + ')') + '</b>';
      root.appendChild(head);
      for (const item of list.slice(0, 4)) {
        const lines = render(item);
        const el = document.createElement('div');
        el.className = 'item';
        el.innerHTML =
          '<b>' + escapeHtml(lines[0] || '-') + '</b>' +
          '<span>' + escapeHtml(lines[1] || '-') + '</span>' +
          '<span>' + escapeHtml(lines[2] || '') + '</span>';
        root.appendChild(el);
      }
    }

    function renderMemoryPanel() {
      renderMemoryTabs();
      const root = $('memoryPanel');
      if (!root) return;
      const entries = Array.isArray(state.memoryEntries) ? state.memoryEntries : [];
      if (!entries.length) {
        root.innerHTML = '<div class="empty">读取后显示宿主 memory 和 HanaAgent 本地可编辑记忆。</div>';
        renderMemoryEditor();
        renderKnowledgePanel();
        return;
      }
      root.innerHTML = '';
      for (const entry of entries.slice(0, 8)) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'item';
        item.innerHTML =
          '<b>' + escapeHtml(entry.title || entry.memoryId || entry.id) + '</b>' +
          '<span>' + escapeHtml(entry.summary || firstLine(entry.content || '') || entry.kind || '-') + '</span>' +
          '<span>' + escapeHtml((entry.source || entry.kind || 'memory') + ' / ' + (entry.updatedAt ? formatTaskTime(entry.updatedAt) : entry.path || '')) + '</span>';
        item.addEventListener('click', () => readMemoryEntry(entry.memoryId || entry.id));
        root.appendChild(item);
      }
      renderMemoryEditor();
      renderKnowledgePanel();
    }

    function renderMemoryTabs() {
      const active = state.memoryTab === 'knowledge' ? 'knowledge' : 'memory';
      const memoryPane = $('memoryBrowserPane');
      const knowledgePane = $('knowledgeBrowserPane');
      const memoryBtn = $('memoryTabMemoryBtn');
      const knowledgeBtn = $('memoryTabKnowledgeBtn');
      if (memoryPane) memoryPane.style.display = active === 'memory' ? '' : 'none';
      if (knowledgePane) knowledgePane.style.display = active === 'knowledge' ? '' : 'none';
      if (memoryBtn) {
        memoryBtn.classList.toggle('primary', active === 'memory');
        memoryBtn.setAttribute('aria-selected', active === 'memory' ? 'true' : 'false');
      }
      if (knowledgeBtn) {
        knowledgeBtn.classList.toggle('primary', active === 'knowledge');
        knowledgeBtn.setAttribute('aria-selected', active === 'knowledge' ? 'true' : 'false');
      }
    }

    function setMemoryTab(tab) {
      state.memoryTab = tab === 'knowledge' ? 'knowledge' : 'memory';
      renderMemoryTabs();
      if (state.memoryTab === 'knowledge' && !state.knowledgePages.length && !state.knowledgeResults.length) {
        loadKnowledgePages();
      }
    }

    function renderKnowledgePanel() {
      renderMemoryTabs();
      const root = $('knowledgePanel');
      if (!root) return;
      const query = $('memoryQueryInput') ? $('memoryQueryInput').value.trim() : '';
      const pages = query && state.knowledgeResults.length ? state.knowledgeResults : state.knowledgePages;
      const page = state.knowledgePage;
      if (!pages.length && !page) {
        root.innerHTML = '<div class="empty">读取后显示 Hermes Knowledge 页面、搜索结果和选中页面预览。</div>';
        renderKnowledgeGraphPanel();
        return;
      }
      root.innerHTML =
        '<div class="item"><b>Knowledge Browser</b><span>' + escapeHtml(String(pages.length)) + ' pages' + (query ? ' / query: ' + escapeHtml(query) : '') + '</span><span>来源: HanaAgent memory + OpenHanako memory capability</span></div>';
      if (page) {
        const preview = page.content || page.summary || '';
        const selected = document.createElement('div');
        selected.className = 'item';
        selected.innerHTML =
          '<b>' + escapeHtml(page.title || page.id || page.path || 'Knowledge Page') + '</b>' +
          '<span>' + escapeHtml(page.path || page.source || 'knowledge') + '</span>' +
          '<pre>' + escapeHtml(firstLines(preview, 8) || '(empty)') + '</pre>';
        root.appendChild(selected);
      }
      for (const item of pages.slice(0, 10)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'item';
        button.innerHTML =
          '<b>' + escapeHtml(item.title || item.id || item.path || '-') + '</b>' +
          '<span>' + escapeHtml(item.summary || firstLine(item.content || '') || item.source || '-') + '</span>' +
          '<span>' + escapeHtml((item.path || item.id || 'knowledge') + (item.updatedAt ? ' / ' + formatTaskTime(item.updatedAt) : '')) + '</span>';
        button.addEventListener('click', () => readKnowledgePage(item.path || item.id));
        root.appendChild(button);
      }
      renderKnowledgeGraphPanel();
    }

    function renderKnowledgeGraphPanel() {
      const root = $('knowledgeGraphPanel');
      if (!root) return;
      const graph = state.knowledgeGraph || {};
      const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
      const edges = Array.isArray(graph.edges) ? graph.edges : [];
      if (!nodes.length) {
        root.innerHTML = '<div class="empty">点击“图谱”后显示 Knowledge nodes / edges 摘要。</div>';
        return;
      }
      root.innerHTML =
        '<div class="item"><b>Knowledge Graph</b><span>' + escapeHtml(String(nodes.length)) + ' nodes / ' + escapeHtml(String(edges.length)) + ' edges</span><span>' + escapeHtml(graph.source || 'hanaagent-memory') + '</span></div>' +
        nodes.slice(0, 12).map((node) =>
          '<div class="item"><b>' + escapeHtml(node.label || node.id) + '</b><span>' + escapeHtml(node.id || '-') + '</span><span>' + escapeHtml(node.type || 'memory') + '</span></div>'
        ).join('');
    }

    function renderMemoryEditor() {
      const title = $('memoryTitleInput');
      const summary = $('memorySummaryInput');
      const editor = $('memoryEditor');
      if (!title || !summary || !editor) return;
      const entry = state.memoryEntry;
      if (!entry) return;
      title.value = entry.title || '';
      summary.value = entry.summary || '';
      editor.value = entry.content || '';
    }

    function renderRunRecordPanel() {
      const root = $('runRecordPanel');
      if (!root) return;
      renderArtifactPreviewPanel();
      renderRunCompareSelectors();
      const records = Array.isArray(state.runRecords) ? state.runRecords : [];
      const summary = state.runRecordSummary || {};
      if (!records.length) {
        root.innerHTML = '<div class="empty">暂无 artifacts / approvals / learnings。可从当前 worker output 快速记录。</div>';
        renderRunLearningsPanel();
        renderRunComparePanel();
        return;
      }
      root.innerHTML =
        '<div class="item"><b>Artifacts ' + escapeHtml(String(summary.artifacts || 0)) + ' / Approvals ' + escapeHtml(String(summary.pendingApprovals || 0)) + ' pending / Learnings ' + escapeHtml(String(summary.learnings || 0)) + '</b><span>Hermes Run Console records</span></div>';
      for (const record of records.slice(0, 8)) {
        const item = document.createElement('div');
        item.className = 'item';
        const artifactActions = record.type === 'artifact'
          ? '<div class="actions"><button class="mini materialize">文件化</button><button class="mini preview">预览</button></div>'
          : '';
        item.innerHTML =
          '<b>' + escapeHtml(record.title) + '</b>' +
          '<span>' + escapeHtml(record.type + ' / ' + record.state) + '</span>' +
          '<span>' + escapeHtml(record.summary || firstLine(record.content || '') || record.path || '-') + '</span>' +
          artifactActions +
          (record.type === 'approval' && record.state === 'pending'
            ? '<div class="actions"><button class="mini approve">批准</button><button class="mini danger deny">拒绝</button></div>'
            : '');
        const materialize = item.querySelector('.materialize');
        const preview = item.querySelector('.preview');
        const approve = item.querySelector('.approve');
        const deny = item.querySelector('.deny');
        if (materialize) materialize.addEventListener('click', () => materializeRunArtifact(record.id));
        if (preview) preview.addEventListener('click', () => previewRunArtifact(record));
        if (approve) approve.addEventListener('click', () => updateRunRecord(record.id, { state: 'approved' }));
        if (deny) deny.addEventListener('click', () => updateRunRecord(record.id, { state: 'denied' }));
        item.addEventListener('click', (event) => {
          if (event.target && event.target.closest && event.target.closest('button')) return;
          openRunRecord(record);
        });
        root.appendChild(item);
      }
      renderRunLearningsPanel();
      renderRunComparePanel();
    }

    function renderRunCompareSelectors() {
      const selectA = $('runCompareASelect');
      const selectB = $('runCompareBSelect');
      if (!selectA || !selectB) return;
      const previousA = selectA.value;
      const previousB = selectB.value;
      const records = Array.isArray(state.runRecords) ? state.runRecords : [];
      const missions = Array.isArray(state.missions) ? state.missions : [];
      const options = [];
      for (const mission of missions.slice(0, 12)) {
        options.push({ value: 'mission:' + mission.id, label: 'Mission: ' + (mission.title || mission.id) });
      }
      for (const record of records.slice(0, 24)) {
        options.push({ value: 'record:' + record.id, label: (record.type || 'record') + ': ' + (record.title || record.id) });
      }
      const html = '<option value="">选择 run</option>' + options.map((option) =>
        '<option value="' + escapeAttr(option.value) + '">' + escapeHtml(option.label) + '</option>'
      ).join('');
      selectA.innerHTML = html;
      selectB.innerHTML = html;
      selectA.value = options.some((item) => item.value === previousA) ? previousA : (options[0]?.value || '');
      selectB.value = options.some((item) => item.value === previousB) ? previousB : (options[1]?.value || options[0]?.value || '');
    }

    function renderRunLearningsPanel() {
      const root = $('runLearningsPanel');
      if (!root) return;
      const learnings = Array.isArray(state.runLearnings) ? state.runLearnings : [];
      const summary = state.runLearningSummary || {};
      if (!learnings.length) {
        root.innerHTML = '<div class="empty">暂无 Run Learnings。点击“添加分类经验”可沉淀 success / failure / optimization。</div>';
        return;
      }
      const counts = summary.byCategory || {};
      root.innerHTML =
        '<div class="item"><b>Run Learnings / ' + escapeHtml(String(summary.total || learnings.length)) + '</b><span>success ' + escapeHtml(String(counts.success || 0)) + ' / failure ' + escapeHtml(String(counts.failure || 0)) + ' / optimization ' + escapeHtml(String(counts.optimization || 0)) + '</span></div>';
      for (const learning of learnings.slice(0, 8)) {
        const item = document.createElement('div');
        item.className = 'item';
        item.innerHTML =
          '<div class="task-row"><span class="status-chip ' + escapeAttr(learning.category === 'failure' ? 'blocked' : learning.category === 'optimization' ? 'partial' : 'implemented') + '">' + escapeHtml(learning.category || 'learning') + '</span><span class="tag">' + escapeHtml(learning.missionTitle || learning.missionId || 'workspace') + '</span></div>' +
          '<b>' + escapeHtml(learning.title || learning.text || learning.id) + '</b>' +
          '<span>' + escapeHtml(firstLines(learning.text || learning.summary || '', 3)) + '</span>' +
          '<span>' + escapeHtml((learning.agentId || learning.requester || '-') + ' / ' + (learning.createdAt ? formatTaskTime(learning.createdAt) : '-')) + '</span>' +
          '<div class="actions"><button class="mini copy-learning">复制</button></div>';
        item.querySelector('.copy-learning').addEventListener('click', () => copyText(formatRunLearning(learning)).then(() => log('Run learning 已复制')));
        root.appendChild(item);
      }
    }

    function renderRunComparePanel() {
      const root = $('runComparePanel');
      if (!root) return;
      const compare = state.runCompare;
      if (!compare || !compare.ok) {
        root.innerHTML = '<div class="empty">选择 Run A / Run B 后点击 Compare Runs，显示状态、耗时、token、成本、agent、产物、审批和经验差异。</div>';
        return;
      }
      const runA = compare.runA || {};
      const runB = compare.runB || {};
      const metrics = Array.isArray(compare.metrics) ? compare.metrics : [];
      root.innerHTML =
        '<div class="item"><b>Compare Runs</b><span>' + escapeHtml((runA.title || runA.id || 'Run A') + ' ⇄ ' + (runB.title || runB.id || 'Run B')) + '</span><span>' + escapeHtml(compare.recommendation || '') + '</span></div>' +
        metrics.map(renderRunCompareMetricRow).join('');
    }

    function renderRunCompareMetricRow(metric) {
      const tone = metric.tone || 'neutral';
      const statusClass = tone === 'better' ? 'implemented' : tone === 'worse' ? 'blocked' : tone === 'same' ? 'host-provided' : 'partial';
      return '<div class="item">' +
        '<b>' + escapeHtml(metric.label || metric.id || 'metric') + ' <span class="status-chip ' + escapeAttr(statusClass) + '">' + escapeHtml(metric.arrow || '=') + ' ' + escapeHtml(metric.deltaLabel || 'Same') + '</span></b>' +
        '<span>A: ' + escapeHtml(String(metric.leftLabel ?? metric.left ?? '-')) + '</span>' +
        '<span>B: ' + escapeHtml(String(metric.rightLabel ?? metric.right ?? '-')) + '</span>' +
      '</div>';
    }

    function formatRunLearning(learning) {
      return [
        '# Run Learning',
        '',
        '- Category: ' + (learning.category || 'learning'),
        '- Mission: ' + (learning.missionTitle || learning.missionId || '-'),
        '- Assignment: ' + (learning.assignmentId || '-'),
        '- Session: ' + (learning.sessionPath || '-'),
        '',
        learning.text || learning.summary || learning.content || ''
      ].join('\\n');
    }

    function renderArtifactPreviewPanel() {
      const root = $('artifactPreviewPanel');
      if (!root) return;
      const preview = state.artifactPreview;
      if (!preview || !preview.previewUrl) {
        root.classList.remove('open');
        root.innerHTML = '';
        return;
      }
      root.classList.add('open');
      root.innerHTML =
        '<div class="artifact-preview-head">' +
          '<div class="artifact-preview-title">' +
            '<b>' + escapeHtml(preview.title || 'Artifact Preview') + '</b>' +
            '<span>' + escapeHtml(preview.previewUrl) + '</span>' +
          '</div>' +
          '<div class="actions"><button class="mini refresh-artifact-preview">刷新</button><button class="mini open-artifact-preview">外部打开</button><button class="mini close-artifact-preview">关闭</button></div>' +
        '</div>' +
        '<iframe class="artifact-preview-frame" title="Run artifact preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" src="' + escapeAttr(preview.previewUrl) + '"></iframe>';
      const frame = root.querySelector('iframe');
      const refresh = root.querySelector('.refresh-artifact-preview');
      const open = root.querySelector('.open-artifact-preview');
      const close = root.querySelector('.close-artifact-preview');
      if (refresh) refresh.addEventListener('click', () => {
        if (frame) frame.src = preview.previewUrl;
        log('Artifact 预览已刷新');
      });
      if (open) open.addEventListener('click', () => openPreviewUrl(preview.previewUrl));
      if (close) close.addEventListener('click', closeArtifactPreview);
    }

    function closeArtifactPreview() {
      state.artifactPreview = null;
      renderArtifactPreviewPanel();
      log('Artifact 预览已关闭');
    }

    function renderShortcutHelp() {
      const root = $('shortcutHelpBody');
      if (!root) return;
      root.innerHTML =
        '<div class="item"><b>工作台快捷键</b><span>这些快捷键覆盖 Hermes Workspace 的 command palette、chat composer、board 和 modal 帮助体验。</span></div>' +
        '<div class="shortcut-grid">' +
          keyboardShortcuts.map((item) =>
            '<div class="shortcut-row"><kbd>' + escapeHtml(item.keys) + '</kbd><span>' + escapeHtml(item.label) + '</span></div>'
          ).join('') +
        '</div>';
    }

    function openShortcutHelp() {
      const backdrop = $('shortcutHelpBackdrop');
      if (!backdrop) return;
      renderShortcutHelp();
      backdrop.classList.add('open');
      backdrop.setAttribute('aria-hidden', 'false');
      const close = $('shortcutHelpCloseBtn');
      if (close) close.focus();
    }

    function closeShortcutHelp() {
      const backdrop = $('shortcutHelpBackdrop');
      if (!backdrop) return;
      backdrop.classList.remove('open');
      backdrop.setAttribute('aria-hidden', 'true');
    }

    function onboardingState() {
      const settings = (state.config && state.config.workbenchOnboarding) || {};
      return {
        completed: Boolean(settings.completed),
        dismissed: Boolean(settings.dismissed),
        lastStep: Math.max(0, Math.min(onboardingSteps.length - 1, Number(settings.lastStep || 0))),
        completedAt: settings.completedAt || '',
        dismissedAt: settings.dismissedAt || ''
      };
    }

    function renderOnboardingTour() {
      const root = $('onboardingBody');
      if (!root) return;
      const tour = onboardingState();
      state.onboardingStep = Math.max(0, Math.min(onboardingSteps.length - 1, Number(state.onboardingStep || tour.lastStep || 0)));
      const step = onboardingSteps[state.onboardingStep] || onboardingSteps[0];
      const doctor = state.setupDoctor || {};
      const readiness = doctor.status ? ('Setup Doctor: ' + doctor.status + ' / blocking ' + String(doctor.summary?.blocking || 0)) : 'Setup Doctor 未读取';
      if ($('onboardingMeta')) $('onboardingMeta').textContent = 'Step ' + String(state.onboardingStep + 1) + ' / ' + String(onboardingSteps.length);
      root.innerHTML =
        '<div class="tour-progress">' + onboardingSteps.map((item, index) => '<span class="tour-dot ' + (index === state.onboardingStep ? 'active' : '') + '" title="' + escapeAttr(item.title) + '"></span>').join('') + '</div>' +
        '<div class="tour-step-card">' +
          '<h3>' + escapeHtml(step.title) + '</h3>' +
          '<p>' + escapeHtml(step.detail) + '</p>' +
          '<p>' + escapeHtml(readiness) + '</p>' +
        '</div>' +
        '<div class="actions"><button id="onboardingPrevBtn" class="mini">上一步</button><button id="onboardingJumpBtn" class="mini">定位区域</button><button id="onboardingNextBtn" class="mini primary">下一步</button><button id="onboardingDoneBtn" class="mini">完成</button><button id="onboardingDismissBtn" class="mini danger">稍后</button></div>';
      $('onboardingPrevBtn').disabled = state.onboardingStep <= 0;
      $('onboardingNextBtn').textContent = state.onboardingStep >= onboardingSteps.length - 1 ? '完成' : '下一步';
      $('onboardingPrevBtn').addEventListener('click', () => moveOnboardingStep(-1));
      $('onboardingNextBtn').addEventListener('click', () => state.onboardingStep >= onboardingSteps.length - 1 ? completeOnboardingTour() : moveOnboardingStep(1));
      $('onboardingDoneBtn').addEventListener('click', completeOnboardingTour);
      $('onboardingDismissBtn').addEventListener('click', dismissOnboardingTour);
      $('onboardingJumpBtn').addEventListener('click', () => focusOnboardingTarget(step));
    }

    function openOnboardingTour(stepIndex) {
      const tour = onboardingState();
      state.onboardingStep = Number.isFinite(Number(stepIndex)) ? Number(stepIndex) : tour.lastStep;
      renderOnboardingTour();
      const backdrop = $('onboardingBackdrop');
      if (!backdrop) return;
      backdrop.classList.add('open');
      backdrop.setAttribute('aria-hidden', 'false');
      const close = $('onboardingCloseBtn');
      if (close) close.focus();
    }

    function maybeOpenOnboardingTour() {
      const tour = onboardingState();
      if (tour.completed || tour.dismissed || window.__hanaagentOnboardingShown) return;
      window.__hanaagentOnboardingShown = true;
      openOnboardingTour(tour.lastStep || 0);
    }

    function closeOnboardingTour() {
      const backdrop = $('onboardingBackdrop');
      if (!backdrop) return;
      backdrop.classList.remove('open');
      backdrop.setAttribute('aria-hidden', 'true');
    }

    function moveOnboardingStep(delta) {
      state.onboardingStep = Math.max(0, Math.min(onboardingSteps.length - 1, state.onboardingStep + delta));
      saveOnboardingState({ lastStep: state.onboardingStep, dismissed: false }).catch(() => {});
      renderOnboardingTour();
    }

    function focusOnboardingTarget(step) {
      const target = step && step.target ? $(step.target) : null;
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (typeof target.focus === 'function') target.focus({ preventScroll: true });
      }
      log('引导定位: ' + ((step && step.title) || 'step'));
    }

    async function saveOnboardingState(next) {
      const previous = state.config.workbenchOnboarding || {};
      const payload = {
        ...previous,
        ...(next || {}),
        updatedAt: new Date().toISOString()
      };
      const data = await requestJson(urls.defaults, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workbenchOnboarding: payload })
      });
      state.config = data.config || state.config;
      return state.config.workbenchOnboarding;
    }

    async function completeOnboardingTour() {
      await saveOnboardingState({ completed: true, dismissed: false, lastStep: onboardingSteps.length - 1, completedAt: new Date().toISOString() });
      closeOnboardingTour();
      renderSetupDoctorPanel();
      notifyWorkbench('complete', '工作台引导已完成', 'HanaAgent tour complete');
      log('工作台引导已完成');
    }

    async function dismissOnboardingTour() {
      await saveOnboardingState({ dismissed: true, lastStep: state.onboardingStep, dismissedAt: new Date().toISOString() });
      closeOnboardingTour();
      renderSetupDoctorPanel();
      log('工作台引导已稍后处理');
    }

    async function resetOnboardingTour() {
      await saveOnboardingState({ completed: false, dismissed: false, lastStep: 0, completedAt: '', dismissedAt: '' });
      state.onboardingStep = 0;
      renderSetupDoctorPanel();
      openOnboardingTour(0);
      log('工作台引导已重置');
    }

    function renderUsagePanel() {
      const root = $('usagePanel');
      if (!root) return;
      const usage = state.usage;
      if (!usage || !usage.summary) {
        root.innerHTML = '<div class="empty">读取后显示 session/agent 的 token 和成本用量。</div>';
        return;
      }
      const summary = usage.summary;
      const attribution = usage.attribution || {};
      const missionRows = renderUsageAttributionRows('Missions', attribution.missions || []);
      const assignmentRows = renderUsageAttributionRows('Assignments', attribution.assignments || []);
      const sessionRows = renderUsageAttributionRows('Sessions', attribution.sessions || []);
      root.innerHTML =
        '<div class="item">' +
          '<b>' + escapeHtml(String(summary.totalTokens || 0)) + ' tokens</b>' +
          '<span>requests: ' + escapeHtml(String(summary.count || 0)) + '</span>' +
          '<span>prompt/completion: ' + escapeHtml(String(summary.promptTokens || 0)) + ' / ' + escapeHtml(String(summary.completionTokens || 0)) + '</span>' +
          '<span>cost: ' + escapeHtml(formatUsd(summary.costUsd || 0)) + '</span>' +
        '</div>' +
        missionRows + assignmentRows + sessionRows;
    }

    function renderUsageAttributionRows(title, rows) {
      const items = Array.isArray(rows) ? rows.slice(0, 4) : [];
      if (!items.length) return '';
      return '<div class="item"><b>' + escapeHtml(title + ' attribution') + '</b>' +
        items.map((item) => '<span>' + escapeHtml((item.label || item.id || '-') + ': ' + String(item.summary?.totalTokens || 0) + ' tokens / ' + formatUsd(item.summary?.costUsd || 0)) + '</span>').join('') +
        '</div>';
    }

    function renderHostCheckpointPanel() {
      const root = $('hostCheckpointPanel');
      if (!root) return;
      const items = Array.isArray(state.hostCheckpoints) ? state.hostCheckpoints : [];
      if (!items.length) {
        root.innerHTML = '<div class="empty">读取后显示 OpenHanako 宿主文件 checkpoint。</div>';
        return;
      }
      root.innerHTML = '';
      for (const checkpoint of items.slice(0, 6)) {
        const item = document.createElement('div');
        item.className = 'item';
        const checkpointId = checkpoint.id || checkpoint.checkpointId;
        item.innerHTML =
          '<b>' + escapeHtml(checkpoint.label || checkpointId) + '</b>' +
          '<span>' + escapeHtml(checkpoint.reason || checkpoint.checkpointId || checkpoint.id) + '</span>' +
          '<span>' + escapeHtml(formatTaskTime(checkpoint.createdAt) || checkpoint.sessionPath || '') + '</span>' +
          '<div class="actions"><button class="mini restore">恢复</button></div>';
        item.querySelector('.restore').addEventListener('click', () => restoreHostCheckpoint(checkpointId));
        root.appendChild(item);
      }
    }

    function renderSessionLifecyclePanel() {
      const root = $('sessionLifecyclePanel');
      if (!root) return;
      if (!state.sessionStatus) {
        root.innerHTML = '<div class="empty">读取后显示 session busy、needs input 和 last seen。创建 worker session 需要宿主 session:create。</div>';
        return;
      }
      const status = state.sessionStatus.status || {};
      root.innerHTML =
        '<div class="item">' +
          '<b>' + escapeHtml(status.state || state.sessionStatus.error || 'unknown') + '</b>' +
          '<span>busy: ' + escapeHtml(status.busy ? 'yes' : 'no') + '</span>' +
          '<span>needs input: ' + escapeHtml(status.needsInput ? 'yes' : 'no') + '</span>' +
          '<span>' + escapeHtml(status.message || status.lastSeen || state.sessionStatus.sessionPath || '') + '</span>' +
        '</div>';
    }

    function renderHostTaskPanel() {
      const root = $('hostTaskPanel');
      if (!root) return;
      const tasks = Array.isArray(state.hostTasks) ? state.hostTasks : [];
      if (!tasks.length) {
        root.innerHTML = '<div class="empty">暂无宿主 task。可注册一个 hanaagent-mission runtime task 做联动测试。</div>';
        return;
      }
      root.innerHTML = '';
      for (const task of tasks.slice(0, 8)) {
        const item = document.createElement('div');
        item.className = 'item';
        item.innerHTML =
          '<b>' + escapeHtml(task.taskId || task.id) + '</b>' +
          '<span>' + escapeHtml((task.type || '-') + ' / ' + (task.status || '-')) + '</span>' +
          '<span>' + escapeHtml(task.parentSessionPath || task.pluginId || '') + '</span>' +
          '<div class="actions"><button class="mini complete">完成</button><button class="mini danger cancel">取消</button></div>';
        item.querySelector('.complete').addEventListener('click', () => completeHostTask(task.taskId || task.id));
        item.querySelector('.cancel').addEventListener('click', () => cancelHostTask(task.taskId || task.id));
        root.appendChild(item);
      }
    }

    function renderDeferredTaskPanel() {
      const root = $('deferredTaskPanel');
      if (!root) return;
      const tasks = Array.isArray(state.deferredTasks) ? state.deferredTasks : [];
      if (!tasks.length) {
        root.innerHTML = '<div class="empty">暂无 deferred result 占位。</div>';
        return;
      }
      root.innerHTML = '';
      for (const task of tasks.slice(0, 6)) {
        const item = document.createElement('div');
        item.className = 'item';
        item.innerHTML =
          '<b>' + escapeHtml(task.taskId || task.id) + '</b>' +
          '<span>' + escapeHtml((task.status || 'pending') + ' / ' + (task.sessionPath || '-')) + '</span>';
        root.appendChild(item);
      }
    }

    function renderTerminal() {
      const root = $('terminalOutput');
      if (!root) return;
      const terminal = state.terminal || {};
      const terminalId = terminal.terminalId || terminal.id || '-';
      const output = state.terminalOutput || (state.terminal ? 'Terminal ready.' : 'Terminal 需要宿主 terminal:* 能力和目标 session。');
      root.innerHTML = renderAnsiTerminalOutput(output);
      const status = $('terminalStatus');
      if (status) {
        status.textContent = state.terminal
          ? [
              'attached ' + terminalId,
              terminal.status || 'unknown',
              'seq ' + String(state.terminalSeq || terminal.seq || 0),
              state.terminalAutoRead ? 'auto on' : 'auto off',
              state.terminalLastReadAt ? 'last ' + formatTaskTime(state.terminalLastReadAt) : ''
            ].filter(Boolean).join(' / ')
          : 'detached / auto off';
      }
      if ($('terminalTitle')) $('terminalTitle').textContent = state.terminal ? 'HanaAgent TUI / ' + terminalId : 'HanaAgent TUI / detached';
      if ($('terminalSeqBadge')) $('terminalSeqBadge').textContent = 'seq ' + String(state.terminalSeq || terminal.seq || 0);
      const autoButton = $('terminalAutoBtn');
      if (autoButton) autoButton.textContent = state.terminalAutoRead ? 'Auto On' : 'Auto';
      root.scrollTop = root.scrollHeight;
    }

    function renderAnsiTerminalOutput(value) {
      const input = String(value || '');
      const ansiPattern = new RegExp(String.fromCharCode(27) + '\\\\[([0-9;]*)m', 'g');
      let lastIndex = 0;
      let classes = [];
      let html = '';
      for (const match of input.matchAll(ansiPattern)) {
        html += renderTerminalChunk(input.slice(lastIndex, match.index), classes);
        classes = terminalAnsiClasses(match[1], classes);
        lastIndex = match.index + match[0].length;
      }
      html += renderTerminalChunk(input.slice(lastIndex), classes);
      return html.replace(new RegExp(String.fromCharCode(27) + '\\\\[[0-9;?]*[A-Za-z]', 'g'), '');
    }

    function renderTerminalChunk(chunk, classes) {
      if (!chunk) return '';
      const safe = escapeHtml(chunk);
      return classes.length ? '<span class="' + classes.join(' ') + '">' + safe + '</span>' : safe;
    }

    function terminalAnsiClasses(codeText, current) {
      const codes = String(codeText || '0').split(';').map((item) => Number(item || 0));
      let next = current.slice();
      for (const code of codes) {
        if (code === 0) next = [];
        if (code === 1 && !next.includes('ansi-bold')) next.push('ansi-bold');
        if (code === 2 && !next.includes('ansi-dim')) next.push('ansi-dim');
        if (code >= 30 && code <= 37) {
          next = next.filter((item) => !item.startsWith('ansi-') || item === 'ansi-bold' || item === 'ansi-dim');
          const names = { 30: 'ansi-dim', 31: 'ansi-red', 32: 'ansi-green', 33: 'ansi-yellow', 34: 'ansi-blue', 35: 'ansi-magenta', 36: 'ansi-cyan', 37: '' };
          if (names[code]) next.push(names[code]);
        }
        if (code === 39) next = next.filter((item) => !item.startsWith('ansi-') || item === 'ansi-bold' || item === 'ansi-dim');
      }
      return next;
    }

    function renderSessionHistory() {
      const root = $('sessionHistoryList');
      if (!root) return;
      root.innerHTML = '';
      if (!state.sessionHistory.length) {
        root.innerHTML = '<div class="empty">暂无会话历史</div>';
        return;
      }
      for (const message of state.sessionHistory.slice(-8).reverse()) {
        const item = document.createElement('div');
        item.className = 'item';
        item.innerHTML =
          '<b>' + escapeHtml(message.role || 'message') + '</b>' +
          '<span>' + escapeHtml(firstLine(message.text || '').slice(0, 180)) + '</span>' +
          '<span>' + escapeHtml(message.createdAt ? formatTaskTime(message.createdAt) : '') + '</span>';
        item.addEventListener('click', () => {
          const matchingTrace = (state.toolTrace && Array.isArray(state.toolTrace.items) ? state.toolTrace.items : []).filter((trace) => trace.messageId && message.id && trace.messageId === message.id);
          setWorkerOutputMessage({
            title: message.role || 'message',
            role: message.role || 'message',
            text: message.text || '',
            meta: message.createdAt ? formatTaskTime(message.createdAt) : '',
            traceItems: matchingTrace
          });
          $('checkpointInput').value = message.text || '';
        });
        root.appendChild(item);
      }
    }

    function renderLiveEvents() {
      const root = $('liveEventList');
      if (!root) return;
      root.innerHTML = '';
      const connected = state.eventSource && state.eventSource.readyState !== EventSource.CLOSED;
      const summary = document.createElement('div');
      summary.className = 'item';
      summary.innerHTML =
        '<b>' + escapeHtml(connected ? 'Live connected' : 'Live disconnected') + '</b>' +
        '<span>' + escapeHtml(state.liveEvents.length + ' events') + '</span>';
      root.appendChild(summary);
      for (const entry of state.liveEvents.slice(-8).reverse()) {
        const item = document.createElement('div');
        item.className = 'item';
        item.innerHTML =
          '<b>' + escapeHtml(entry.type || 'event') + '</b>' +
          '<span>' + escapeHtml(entry.sessionPath || '-') + '</span>' +
          '<span>' + escapeHtml(firstLine(entry.text || entry.delta || entry.message || JSON.stringify(entry.event || {})).slice(0, 180)) + '</span>';
        root.appendChild(item);
      }
    }

    function startSmoothLiveStream() {
      state.liveTextBuffer = '';
      state.liveDisplayBuffer = '';
      state.liveStreamActive = true;
      state.liveStreamStartedAt = new Date().toISOString();
      cancelSmoothStreamFrame();
      renderStreamingPlaceholder();
      scheduleSmoothStreamTick();
    }

    function appendSmoothStreamDelta(delta) {
      if (!state.liveStreamActive) {
        state.liveDisplayBuffer = state.liveDisplayBuffer || '';
        state.liveStreamActive = true;
        state.liveStreamStartedAt = state.liveStreamStartedAt || new Date().toISOString();
      }
      state.liveTextBuffer += String(delta || '');
      scheduleSmoothStreamTick();
    }

    function scheduleSmoothStreamTick() {
      if (state.liveStreamFrame) return;
      const raf = window.requestAnimationFrame || ((callback) => window.setTimeout(callback, 16));
      state.liveStreamFrame = raf(smoothStreamTick);
    }

    function smoothStreamTick() {
      state.liveStreamFrame = 0;
      const target = String(state.liveTextBuffer || '');
      const current = String(state.liveDisplayBuffer || '');
      if (!state.liveStreamActive && current === target) return;
      if (!target && !current) {
        renderStreamingPlaceholder();
        if (state.liveStreamActive) scheduleSmoothStreamTick();
        return;
      }
      if (current.length < target.length) {
        const remaining = target.length - current.length;
        const step = Math.max(1, Math.min(24, Math.ceil(remaining / 3)));
        state.liveDisplayBuffer = target.slice(0, current.length + step);
      } else {
        state.liveDisplayBuffer = target;
      }
      setWorkerOutputMessage({
        title: 'Live assistant stream',
        role: 'assistant',
        text: state.liveDisplayBuffer,
        meta: state.liveStreamActive ? 'streaming' : 'turn_end',
        traceItems: state.liveTrace.slice(-6),
        streaming: state.liveStreamActive
      });
      if (state.liveStreamActive || state.liveDisplayBuffer.length < target.length) scheduleSmoothStreamTick();
    }

    function flushSmoothLiveStream(meta = 'turn_end') {
      cancelSmoothStreamFrame();
      state.liveDisplayBuffer = state.liveTextBuffer || state.liveDisplayBuffer || '';
      if (state.liveDisplayBuffer) {
        setWorkerOutputMessage({
          title: 'Live assistant stream',
          role: 'assistant',
          text: state.liveDisplayBuffer,
          meta,
          traceItems: state.liveTrace.slice(-6),
          streaming: false
        });
      }
      state.liveStreamActive = false;
    }

    function stopSmoothLiveStream() {
      cancelSmoothStreamFrame();
      state.liveStreamActive = false;
      state.liveStreamStartedAt = '';
    }

    function cancelSmoothStreamFrame() {
      if (!state.liveStreamFrame) return;
      const caf = window.cancelAnimationFrame || window.clearTimeout;
      caf(state.liveStreamFrame);
      state.liveStreamFrame = 0;
    }

    function renderStreamingPlaceholder() {
      const root = $('workerOutput');
      if (!root) return;
      const shouldStick = state.workerOutputPinnedToBottom || isWorkerOutputNearBottom();
      root.className = 'output-box message-preview';
      root.innerHTML =
        '<article class="message-card">' +
          '<div class="message-card-head"><b>Live assistant stream</b><span class="streaming-indicator">thinking</span></div>' +
          '<div class="message-body"><div class="message-thinking"><b>Thinking</b><br>等待 OpenHanako session event 增量...</div><div class="streaming-skeleton" style="width:88%"></div><div class="streaming-skeleton" style="width:64%; margin-top:8px"></div></div>' +
        '</article>';
      if (shouldStick) scrollWorkerOutputToBottom();
      else updateWorkerOutputScrollButton();
    }

    function renderToolTrace() {
      const root = $('toolTracePanel');
      if (!root) return;
      const historyTrace = state.toolTrace && Array.isArray(state.toolTrace.items) ? state.toolTrace.items : [];
      const liveTrace = Array.isArray(state.liveTrace) ? state.liveTrace : [];
      const items = [...liveTrace, ...historyTrace].sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, 40);
      if (!items.length) {
        root.innerHTML = '<div class="empty">读取 session history 或连接实时事件后显示 tool calls、命令、文件变更、checkpoint 和错误轨迹。</div>';
        return;
      }
      root.innerHTML = '';
      const summary = summarizeToolTrace(items);
      const head = document.createElement('div');
      head.className = 'item';
      head.innerHTML =
        '<b>' + escapeHtml('Trace ' + items.length + ' / tools ' + summary.tool + ' / results ' + summary.toolResult + ' / commands ' + summary.command + ' / files ' + summary.file) + '</b>' +
        '<span>' + escapeHtml('checkpoints ' + summary.checkpoint + ' / errors ' + summary.error + ' / live ' + liveTrace.length) + '</span>';
      root.appendChild(head);
      for (const trace of items) {
        const item = document.createElement('div');
        item.className = 'item tool-trace-item';
        item.innerHTML =
          '<b>' + escapeHtml((trace.kind || 'event') + ' / ' + (trace.title || trace.status || 'trace')) + '</b>' +
          '<span>' + escapeHtml((trace.status || '-') + ' / ' + (trace.source || '-') + ' / ' + (trace.at ? formatTaskTime(trace.at) : '')) + '</span>' +
          '<span>' + escapeHtml(trace.detail || trace.sessionPath || trace.messageId || '-') + '</span>' +
          '<div class="actions"><button class="mini open-trace" type="button">打开</button><button class="mini copy-trace" type="button">复制详情</button></div>';
        const open = item.querySelector('.open-trace');
        const copy = item.querySelector('.copy-trace');
        if (open) open.addEventListener('click', () => {
          setWorkerOutputMessage({
            title: (trace.kind || 'event') + ' / ' + (trace.title || 'trace'),
            role: 'tool-trace',
            meta: trace.status || trace.source || '',
            text: [
            trace.kind + ' / ' + trace.title,
            trace.status || '',
            trace.source || '',
            trace.at || '',
            '',
            trace.detail || ''
          ].join('\\n'),
            traceItems: [trace]
          });
        });
        if (copy) copy.addEventListener('click', () => {
          copyText(formatTraceDetail(trace)).then(() => log('Tool trace 详情已复制')).catch(() => log('复制失败'));
        });
        root.appendChild(item);
      }
    }

    function summarizeToolTrace(items) {
      const summary = { tool: 0, toolResult: 0, command: 0, file: 0, checkpoint: 0, error: 0, turn: 0 };
      for (const item of items) {
        const key = item.kind === 'tool-result' ? 'toolResult' : item.kind;
        summary[key] = (summary[key] || 0) + 1;
      }
      return summary;
    }

    function traceFromLiveEvent(payload) {
      const type = payload && payload.type ? String(payload.type) : 'event';
      const event = payload && payload.event && typeof payload.event === 'object' ? payload.event : payload;
      const at = (payload && payload.at) || new Date().toISOString();
      const sessionPath = (payload && payload.sessionPath) || '';
      const toolName = event && (event.toolName || event.name || (event.tool && event.tool.name) || (event.function && event.function.name));
      if (type === 'tool_result' || type === 'toolResult' || (event && (event.tool_use_id || event.tool_call_id))) {
        return {
          id: type + '-' + at + '-' + (event.tool_use_id || event.tool_call_id || 'result'),
          kind: 'tool-result',
          status: event.status || event.state || type,
          title: event.toolName || event.name || event.tool_use_id || event.tool_call_id || 'Tool result',
          detail: safeStringify(event.output || event.result || event.content || event).slice(0, 500),
          at,
          source: 'session-event',
          sessionPath
        };
      }
      if (toolName || type.indexOf('tool') !== -1) {
        return {
          id: type + '-' + at + '-' + (toolName || 'tool'),
          kind: 'tool',
          status: event.status || event.state || type,
          title: toolName || type,
          detail: safeStringify(event.input || event.arguments || event.args || event.result || event.output || event).slice(0, 500),
          at,
          source: 'session-event',
          sessionPath
        };
      }
      if (type.indexOf('terminal') !== -1 || type.indexOf('command') !== -1) {
        return {
          id: type + '-' + at,
          kind: 'command',
          status: type,
          title: firstLine(payload.text || payload.message || payload.delta || type).slice(0, 160),
          detail: safeStringify(event).slice(0, 500),
          at,
          source: 'session-event',
          sessionPath
        };
      }
      if (type === 'error' || event.error) {
        return {
          id: type + '-' + at,
          kind: 'error',
          status: 'error',
          title: event.error || event.message || 'Error',
          detail: safeStringify(event).slice(0, 500),
          at,
          source: 'session-event',
          sessionPath
        };
      }
      if (type === 'turn_end') {
        return {
          id: type + '-' + at,
          kind: 'turn',
          status: 'done',
          title: 'Turn ended',
          detail: sessionPath,
          at,
          source: 'session-event',
          sessionPath
        };
      }
      return null;
    }

    async function copyToolTrace() {
      const historyTrace = state.toolTrace && Array.isArray(state.toolTrace.items) ? state.toolTrace.items : [];
      const liveTrace = Array.isArray(state.liveTrace) ? state.liveTrace : [];
      const items = [...liveTrace, ...historyTrace].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
      const lines = ['# HanaAgent Tool Trace', '', ...items.map((item) => '- [' + (item.kind || 'event') + '] ' + (item.title || '-') + ' / ' + (item.status || '-') + ' :: ' + (item.detail || ''))];
      try {
        await navigator.clipboard.writeText(lines.join('\\n'));
        log('Tool Trace 已复制');
      } catch {
        log(lines.join('\\n'));
      }
    }

    function connectSessionEvents() {
      const sessionPath = $('sessionSelect').value;
      if (!sessionPath) {
        log('请先选择会话');
        return;
      }
      disconnectSessionEvents();
      const sep = urls.sessionEvents.includes('?') ? '&' : '?';
      const eventUrl = urls.sessionEvents + sep + 'sessionPath=' + encodeURIComponent(sessionPath);
      startSmoothLiveStream();
      state.eventSource = new EventSource(eventUrl);
      state.eventSource.addEventListener('open', () => {
        log('实时事件已连接');
        renderStreamingPlaceholder();
        renderLiveEvents();
        renderInspectorPanel();
      });
      state.eventSource.addEventListener('session-event', (event) => {
        let payload = {};
        try { payload = JSON.parse(event.data || '{}'); } catch {}
        state.liveEvents.push(payload);
        state.liveEvents = state.liveEvents.slice(-80);
        const trace = traceFromLiveEvent(payload);
        if (trace) {
          state.liveTrace.push(trace);
          state.liveTrace = state.liveTrace.slice(-120);
        }
        if (payload.type === 'text_delta' && payload.delta) {
          appendSmoothStreamDelta(payload.delta);
        } else if (payload.type === 'turn_end') {
          flushSmoothLiveStream('turn_end');
          log('实时 turn_end，可同步 checkpoint');
        } else if (payload.type === 'error') {
          flushSmoothLiveStream('error');
          log('实时事件错误: ' + (payload.message || payload.error || 'unknown'));
        }
        renderLiveEvents();
        renderToolTrace();
        renderInspectorPanel();
      });
      state.eventSource.addEventListener('error', () => {
        flushSmoothLiveStream('stream_error');
        log('实时事件连接中断');
        renderLiveEvents();
        renderToolTrace();
        renderInspectorPanel();
      });
      renderLiveEvents();
      renderToolTrace();
      renderInspectorPanel();
    }

    function disconnectSessionEvents() {
      if (state.eventSource) {
        state.eventSource.close();
        state.eventSource = null;
        log('实时事件已断开');
      }
      stopSmoothLiveStream();
      renderLiveEvents();
      renderToolTrace();
      renderInspectorPanel();
    }

    function renderRoadmap() {
      const root = $('roadmapList');
      if (!root) return;
      const blueprint = state.blueprint || {};
      const parity = blueprint.parity || {};
      const categories = Array.isArray(parity.categories) ? parity.categories : [];
      const coverage = Array.isArray(blueprint.currentCoverage) ? blueprint.currentCoverage : [];
      const phases = Array.isArray(blueprint.phases) ? blueprint.phases : [];
      root.innerHTML = '';
      if (categories.length) {
        const summary = parity.summary || {};
        const summaryEl = document.createElement('div');
        summaryEl.className = 'roadmap-summary';
        summaryEl.innerHTML =
          '<strong>Hermes 复刻审计</strong>' +
          '<span>' + (summary.completeForPluginScope ? '插件职责范围内暂无 missing 项。' : '存在未完成的插件职责项。') + '</span>' +
          '<div class="roadmap-counts">' +
            '<span class="status-chip plugin-implemented">plugin ' + escapeHtml(String(summary.pluginImplemented || 0)) + '</span>' +
            '<span class="status-chip capability-gated">gated ' + escapeHtml(String(summary.capabilityGated || 0)) + '</span>' +
            '<span class="status-chip host-provided">host ' + escapeHtml(String(summary.hostProvided || 0)) + '</span>' +
            '<span class="status-chip out-of-scope-for-plugin">scope ' + escapeHtml(String(summary.outOfScopeForPlugin || 0)) + '</span>' +
            '<span class="status-chip missing">missing ' + escapeHtml(String(summary.missing || 0)) + '</span>' +
          '</div>';
        root.appendChild(summaryEl);
        for (const category of categories) {
          const items = Array.isArray(category.items) ? category.items : [];
          const counts = items.reduce((acc, item) => {
            const key = item.status || 'unknown';
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          }, {});
          const el = document.createElement('div');
          el.className = 'roadmap-item';
          el.innerHTML =
            '<span class="status-chip plugin-implemented">' + escapeHtml(String(counts['plugin-implemented'] || 0)) + ' plugin</span>' +
            '<b>' + escapeHtml(category.label || category.id || 'category') + '</b>' +
            '<span>' + escapeHtml(items.slice(0, 3).map((item) => item.label).join(' / ')) + '</span>';
          root.appendChild(el);
        }
        return;
      }
      const items = coverage.length ? coverage : phases;
      if (!items.length) {
        root.innerHTML = '<div class="empty">暂无路线图数据</div>';
        return;
      }
      for (const item of items.slice(0, 10)) {
        const status = item.status || item.id || 'planned';
        const el = document.createElement('div');
        el.className = 'roadmap-item';
        el.innerHTML =
          '<span class="status-chip ' + escapeHtml(status) + '">' + escapeHtml(status) + '</span>' +
          '<b>' + escapeHtml(item.label || item.id || 'item') + '</b>' +
          '<span>' + escapeHtml(item.summary || '') + '</span>';
        root.appendChild(el);
      }
    }

    function renderBoard() {
      const root = $('board');
      root.innerHTML = '';
      renderTaskFilterControls();
      const visibleTasks = filterBoardTasks(state.tasks);
      pruneSelectedTasks();
      const status = $('taskFilterStatus');
      if (status) status.textContent = String(visibleTasks.length) + ' of ' + String(state.tasks.length) + ' tasks';
      renderBoardViewControls();
      const limits = boardWipLimits();
      for (const lane of lanes) {
        const laneEl = document.createElement('section');
        laneEl.className = 'lane';
        laneEl.dataset.lane = lane.id;
        const tasks = visibleTasks.filter((task) => (task.column || task.lane) === lane.id);
        const allLaneCount = (state.tasks || []).filter((task) => (task.column || task.lane) === lane.id).length;
        const wip = laneWipState(lane.id, allLaneCount, limits);
        if (wip.over) laneEl.classList.add('wip-over');
        else if (wip.warning) laneEl.classList.add('wip-warning');
        laneEl.innerHTML =
          '<h3><span class="lane-heading"><span>' + escapeHtml(lane.label) + '</span>' + renderWipLimitInput(lane.id, limits) + '</span>' +
          '<span class="tag wip-tag ' + escapeAttr(wip.className) + '">' + escapeHtml(wip.label) + '</span></h3><div class="lane-list"></div>';
        const limitInput = laneEl.querySelector('.wip-limit-input');
        if (limitInput) limitInput.addEventListener('change', () => saveBoardWipLimitsFromInputs());
        const list = laneEl.querySelector('.lane-list');
        list.dataset.lane = lane.id;
        list.addEventListener('dragover', (event) => handleTaskDragOver(event, lane.id));
        list.addEventListener('dragleave', (event) => handleTaskDragLeave(event, laneEl));
        list.addEventListener('drop', (event) => handleTaskDrop(event, lane.id));
        if (!tasks.length) {
          list.innerHTML = '<div class="empty">暂无任务</div>';
        } else {
          for (const task of tasks) list.appendChild(renderTask(task));
        }
        root.appendChild(laneEl);
      }
      renderBulkTaskStatus(visibleTasks);
      renderCheckpointTaskOptions();
    }

    function boardWipLimits() {
      const raw = state.config && typeof state.config.boardWipLimits === 'object' ? state.config.boardWipLimits : {};
      const limits = {};
      for (const lane of lanes) {
        const value = Number(raw[lane.id]);
        if (Number.isFinite(value) && value > 0) limits[lane.id] = Math.min(99, Math.floor(value));
      }
      return limits;
    }

    function laneWipState(laneId, count, limits) {
      const limit = Number(limits[laneId] || 0);
      if (!limit) return { limit: 0, label: String(count), className: '', warning: false, over: false };
      const over = count > limit;
      const warning = !over && count === limit;
      return {
        limit,
        label: String(count) + '/' + String(limit),
        className: over ? 'over' : warning ? 'warning' : '',
        warning,
        over
      };
    }

    function renderWipLimitInput(laneId, limits) {
      if (!state.editingWipLimits) return '';
      return '<input class="wip-limit-input" type="number" min="0" max="99" data-lane="' + escapeAttr(laneId) + '" value="' + escapeAttr(limits[laneId] || '') + '" title="0 或空表示不限制" />';
    }

    function renderTaskFilterControls() {
      const assigneeSelect = $('taskAssigneeFilter');
      const prioritySelect = $('taskPriorityFilter');
      if (assigneeSelect) {
        const current = state.taskFilters.assignee || assigneeSelect.value || '';
        const assignees = unique(state.tasks.map((task) => task.assignee).filter(Boolean)).sort();
        assigneeSelect.innerHTML = '<option value="">全部负责人</option>' + assignees.map((assignee) => '<option value="' + escapeAttr(assignee) + '">' + escapeHtml(assignee) + '</option>').join('');
        assigneeSelect.value = assignees.includes(current) ? current : '';
        state.taskFilters.assignee = assigneeSelect.value;
      }
      if (prioritySelect) {
        const current = state.taskFilters.priority || prioritySelect.value || '';
        const priorities = unique(state.tasks.map((task) => task.priority).filter(Boolean)).sort();
        prioritySelect.innerHTML = '<option value="">全部优先级</option>' + priorities.map((priority) => '<option value="' + escapeAttr(priority) + '">' + escapeHtml(priority) + '</option>').join('');
        prioritySelect.value = priorities.includes(current) ? current : '';
        state.taskFilters.priority = prioritySelect.value;
      }
    }

    function filterBoardTasks(tasks) {
      const filters = state.taskFilters || {};
      const query = String(filters.query || '').trim().toLowerCase();
      const assignee = String(filters.assignee || '').trim();
      const priority = String(filters.priority || '').trim();
      return (Array.isArray(tasks) ? tasks : []).filter((task) => {
        if (assignee && task.assignee !== assignee) return false;
        if (priority && task.priority !== priority) return false;
        if (!query) return true;
        const haystack = [
          task.title,
          task.description,
          task.assignee,
          task.priority,
          task.templateLabel,
          task.sessionPath,
          task.missionId,
          task.assignmentId,
          ...(Array.isArray(task.tags) ? task.tags : [])
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      });
    }

    function updateTaskFilters() {
      state.taskFilters = {
        query: $('taskSearchInput') ? $('taskSearchInput').value || '' : '',
        assignee: $('taskAssigneeFilter') ? $('taskAssigneeFilter').value || '' : '',
        priority: $('taskPriorityFilter') ? $('taskPriorityFilter').value || '' : ''
      };
      state.activeBoardViewId = '';
      renderBoard();
    }

    function clearTaskFilters() {
      state.taskFilters = { query: '', assignee: '', priority: '' };
      state.activeBoardViewId = '';
      if ($('taskSearchInput')) $('taskSearchInput').value = '';
      if ($('taskAssigneeFilter')) $('taskAssigneeFilter').value = '';
      if ($('taskPriorityFilter')) $('taskPriorityFilter').value = '';
      renderBoard();
    }

    function renderBoardViewControls() {
      const select = $('boardViewSelect');
      if (!select) return;
      const views = Array.isArray(state.config.savedBoardViews) ? state.config.savedBoardViews : [];
      const current = state.activeBoardViewId || select.value || '';
      select.innerHTML = '<option value="">Board views</option>' + views.map((view) => '<option value="' + escapeAttr(view.id || '') + '">' + escapeHtml(view.title || view.id || 'View') + '</option>').join('');
      select.value = views.some((view) => view.id === current) ? current : '';
      state.activeBoardViewId = select.value;
      const deleteBtn = $('deleteBoardViewBtn');
      if (deleteBtn) deleteBtn.disabled = !state.activeBoardViewId;
    }

    function applyBoardView() {
      const viewId = $('boardViewSelect').value || '';
      const view = (Array.isArray(state.config.savedBoardViews) ? state.config.savedBoardViews : []).find((item) => item.id === viewId);
      if (!view) {
        state.activeBoardViewId = '';
        return;
      }
      state.taskFilters = {
        query: view.filters?.query || '',
        assignee: view.filters?.assignee || '',
        priority: view.filters?.priority || ''
      };
      state.activeBoardViewId = view.id;
      if ($('taskSearchInput')) $('taskSearchInput').value = state.taskFilters.query;
      renderBoard();
      log('已应用 Board View: ' + (view.title || view.id));
    }

    function boardViewId(title) {
      return String(title || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    }

    function currentBoardViewPayload(title, existing) {
      const now = new Date().toISOString();
      return {
        id: existing?.id || boardViewId(title),
        title: title.trim(),
        filters: {
          query: state.taskFilters.query || '',
          assignee: state.taskFilters.assignee || '',
          priority: state.taskFilters.priority || ''
        },
        createdAt: existing?.createdAt || now,
        updatedAt: now
      };
    }

    async function saveBoardView() {
      const existing = (Array.isArray(state.config.savedBoardViews) ? state.config.savedBoardViews : []).find((view) => view.id === state.activeBoardViewId);
      const title = window.prompt('Board view name', existing?.title || state.taskFilters.query || state.taskFilters.assignee || state.taskFilters.priority || 'My board view');
      if (title === null) return;
      const cleanTitle = title.trim();
      if (!cleanTitle) {
        log('视图名称不能为空');
        return;
      }
      const view = currentBoardViewPayload(cleanTitle, existing);
      const savedBoardViews = [
        view,
        ...(Array.isArray(state.config.savedBoardViews) ? state.config.savedBoardViews : []).filter((item) => item.id !== view.id)
      ].slice(0, 12);
      await savePreferencesPatch({ savedBoardViews }, 'Board View 已保存');
      state.activeBoardViewId = view.id;
      renderBoard();
    }

    async function deleteBoardView() {
      const viewId = state.activeBoardViewId || $('boardViewSelect').value || '';
      if (!viewId) return;
      const savedBoardViews = (Array.isArray(state.config.savedBoardViews) ? state.config.savedBoardViews : []).filter((view) => view.id !== viewId);
      await savePreferencesPatch({ savedBoardViews }, 'Board View 已删除');
      state.activeBoardViewId = '';
      renderBoard();
    }

    async function toggleWipLimitEditor() {
      state.editingWipLimits = !state.editingWipLimits;
      renderBoard();
      const button = $('editWipLimitsBtn');
      if (button) button.textContent = state.editingWipLimits ? '完成 WIP' : 'WIP 限制';
      if (state.editingWipLimits) log('正在编辑看板 WIP 限制，0 或空表示不限制');
    }

    async function saveBoardWipLimitsFromInputs() {
      const boardWipLimits = {};
      document.querySelectorAll('.wip-limit-input').forEach((input) => {
        const laneId = input.dataset.lane || '';
        const value = Number(input.value);
        if (laneId && Number.isFinite(value) && value > 0) boardWipLimits[laneId] = Math.min(99, Math.floor(value));
      });
      await savePreferencesPatch({ boardWipLimits }, 'WIP 限制已保存');
      renderBoard();
    }

    function renderTask(task) {
      const el = document.createElement('article');
      el.className = 'task' + (state.focusedTaskId === task.id ? ' focused' : '');
      el.draggable = true;
      el.tabIndex = 0;
      el.dataset.taskId = task.id || '';
      const lane = task.column || task.lane || 'backlog';
      const nextLane = nextLaneId(lane);
      const selected = state.selectedTaskIds.includes(task.id);
      el.innerHTML =
        '<div class="task-row"><label class="task-select"><input class="task-check" type="checkbox" ' + (selected ? 'checked' : '') + ' /><span class="tag">' + escapeHtml(task.templateLabel || task.priority || '任务') + '</span></label><span class="tag">' + escapeHtml(formatTaskTime(task.createdAt || task.updatedAt)) + '</span></div>' +
        '<strong>' + escapeHtml(task.title) + '</strong>' +
        (task.description ? '<p>' + escapeHtml(task.description) + '</p>' : '') +
        '<div class="task-row"><button class="mini edit">编辑</button><button class="mini move">' + (nextLane ? '推进' : '归档') + '</button><button class="mini danger remove">删除</button></div>';
      el.querySelector('.task-check').addEventListener('change', (event) => toggleTaskSelection(task.id, event.target.checked));
      el.querySelector('.edit').addEventListener('click', () => openTaskEditor(task));
      el.querySelector('.move').addEventListener('click', async () => {
        try {
          if (nextLane) {
            await requestJson(taskActionUrl(task.id, 'move'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ column: nextLane })
            });
          } else {
            await requestJson(taskActionUrl(task.id), { method: 'DELETE' });
          }
          await reloadTasks();
        } catch (err) {
          log('任务更新失败: ' + err.message);
        }
      });
      el.querySelector('.remove').addEventListener('click', async () => {
        try {
          await requestJson(taskActionUrl(task.id), { method: 'DELETE' });
          await reloadTasks();
        } catch (err) {
        log('任务删除失败: ' + err.message);
        }
      });
      el.addEventListener('dragstart', (event) => {
        state.draggingTaskId = task.id || '';
        state.focusedTaskId = task.id || '';
        el.classList.add('dragging');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', state.draggingTaskId);
        }
      });
      el.addEventListener('dragend', () => {
        state.draggingTaskId = '';
        clearTaskDropState();
      });
      el.addEventListener('focus', () => setFocusedTask(task.id));
      el.addEventListener('click', () => setFocusedTask(task.id));
      return el;
    }

    function setFocusedTask(taskId) {
      if (!taskId || state.focusedTaskId === taskId) return;
      state.focusedTaskId = taskId;
      document.querySelectorAll('.task.focused').forEach((item) => item.classList.remove('focused'));
      const card = Array.from(document.querySelectorAll('.task')).find((item) => item.dataset.taskId === taskId);
      if (card) card.classList.add('focused');
    }

    function focusedTask() {
      return (state.tasks || []).find((task) => task.id === state.focusedTaskId) || null;
    }

    function toggleTaskSelection(taskId, selected) {
      if (!taskId) return;
      const ids = new Set(state.selectedTaskIds || []);
      if (selected) ids.add(taskId);
      else ids.delete(taskId);
      state.selectedTaskIds = Array.from(ids);
      renderBoard();
    }

    function selectVisibleTasks() {
      const ids = new Set(state.selectedTaskIds || []);
      for (const task of filterBoardTasks(state.tasks)) {
        if (task.id) ids.add(task.id);
      }
      state.selectedTaskIds = Array.from(ids);
      renderBoard();
    }

    function clearSelectedTasks() {
      state.selectedTaskIds = [];
      renderBoard();
    }

    function pruneSelectedTasks() {
      const available = new Set((state.tasks || []).map((task) => task.id).filter(Boolean));
      state.selectedTaskIds = (state.selectedTaskIds || []).filter((taskId) => available.has(taskId));
    }

    function renderBulkTaskStatus(visibleTasks) {
      const selected = state.selectedTaskIds || [];
      const visibleIds = new Set((visibleTasks || []).map((task) => task.id).filter(Boolean));
      const visibleSelected = selected.filter((taskId) => visibleIds.has(taskId)).length;
      const status = $('bulkTaskStatus');
      if (status) status.textContent = String(selected.length) + ' selected' + (visibleSelected !== selected.length ? ' / ' + String(visibleSelected) + ' visible' : '');
      const disabled = selected.length === 0;
      for (const id of ['clearSelectedTasksBtn', 'bulkMoveLaneSelect', 'bulkPrioritySelect', 'bulkDeleteTasksBtn']) {
        const el = $(id);
        if (el) el.disabled = disabled;
      }
    }

    async function applyTaskBatch(action, payload) {
      const taskIds = [...(state.selectedTaskIds || [])];
      if (!taskIds.length) {
        log('请先选择任务');
        return null;
      }
      try {
        const result = await requestJson(appendApiPath(urls.tasks, 'batch'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, taskIds, ...(payload || {}) })
        });
        state.selectedTaskIds = [];
        await reloadTasks();
        log('批量任务操作完成: ' + action + ' / ' + String((result.processed || []).length) + ' processed' + ((result.failed || []).length ? ' / ' + String(result.failed.length) + ' failed' : ''));
        return result;
      } catch (err) {
        log('批量任务操作失败: ' + err.message);
        return null;
      }
    }

    async function bulkMoveTasks() {
      const lane = $('bulkMoveLaneSelect').value;
      if (!lane) return;
      await applyTaskBatch('move', { column: lane });
      $('bulkMoveLaneSelect').value = '';
    }

    async function bulkUpdatePriority() {
      const priority = $('bulkPrioritySelect').value;
      if (!priority) return;
      await applyTaskBatch('update', { updates: { priority } });
      $('bulkPrioritySelect').value = '';
    }

    async function bulkDeleteTasks() {
      if (!state.selectedTaskIds.length) return;
      if (!window.confirm('删除选中的 ' + String(state.selectedTaskIds.length) + ' 个任务？')) return;
      await applyTaskBatch('delete');
    }

    function openTaskEditor(task) {
      if (!task || !task.id) return;
      state.editingTaskId = task.id;
      $('taskEditTitle').value = task.title || '';
      $('taskEditDescription').value = task.description || '';
      $('taskEditColumn').value = task.column || task.lane || 'backlog';
      $('taskEditPriority').value = task.priority || 'medium';
      $('taskEditAssignee').value = task.assignee || '';
      $('taskEditDueDate').value = task.dueDate || '';
      $('taskEditTags').value = Array.isArray(task.tags) ? task.tags.join(', ') : '';
      $('taskEditSessionPath').value = task.sessionPath || '';
      $('taskEditMissionId').value = task.missionId || '';
      $('taskEditAssignmentId').value = task.assignmentId || '';
      $('taskEditorMeta').textContent = [task.id, task.templateLabel || task.mode || '', task.updatedAt ? 'updated ' + formatTaskTime(task.updatedAt) : ''].filter(Boolean).join(' / ');
      $('taskEditorBackdrop').classList.add('open');
      $('taskEditorBackdrop').setAttribute('aria-hidden', 'false');
      $('taskEditTitle').focus();
    }

    function closeTaskEditor() {
      state.editingTaskId = '';
      $('taskEditorBackdrop').classList.remove('open');
      $('taskEditorBackdrop').setAttribute('aria-hidden', 'true');
    }

    function currentTaskEditorPayload() {
      return {
        title: $('taskEditTitle').value.trim(),
        description: $('taskEditDescription').value,
        column: $('taskEditColumn').value,
        priority: $('taskEditPriority').value,
        assignee: $('taskEditAssignee').value,
        dueDate: $('taskEditDueDate').value,
        tags: $('taskEditTags').value.split(',').map((item) => item.trim()).filter(Boolean),
        sessionPath: $('taskEditSessionPath').value,
        missionId: $('taskEditMissionId').value,
        assignmentId: $('taskEditAssignmentId').value
      };
    }

    async function saveTaskEditor() {
      const taskId = state.editingTaskId;
      if (!taskId) return;
      const payload = currentTaskEditorPayload();
      if (!payload.title) {
        log('任务标题不能为空');
        $('taskEditTitle').focus();
        return;
      }
      try {
        await requestJson(taskActionUrl(taskId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        await reloadTasks();
        closeTaskEditor();
        log('任务已保存: ' + payload.title);
      } catch (err) {
        log('任务保存失败: ' + err.message);
      }
    }

    async function duplicateTaskEditor() {
      const payload = currentTaskEditorPayload();
      if (!payload.title) {
        log('任务标题不能为空');
        $('taskEditTitle').focus();
        return;
      }
      try {
        const result = await requestJson(urls.tasks, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            title: payload.title + ' copy',
            createdBy: 'user',
            mode: 'dispatch'
          })
        });
        await reloadTasks();
        if (result.task) openTaskEditor(result.task);
        log('任务已复制: ' + (result.task ? result.task.title : payload.title));
      } catch (err) {
        log('任务复制失败: ' + err.message);
      }
    }

    async function deleteTaskEditor() {
      const taskId = state.editingTaskId;
      if (!taskId) return;
      if (!window.confirm('删除这个任务？')) return;
      try {
        await requestJson(taskActionUrl(taskId), { method: 'DELETE' });
        await reloadTasks();
        closeTaskEditor();
        log('任务已删除');
      } catch (err) {
        log('任务删除失败: ' + err.message);
      }
    }

    async function handleBoardKeyboard(event) {
      const tag = String(event.target?.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select', 'button'].includes(tag)) return;
      if ($('taskEditorBackdrop') && $('taskEditorBackdrop').classList.contains('open')) return;
      const task = focusedTask();
      if (!task) return;
      if (event.key === 'e' || event.key === 'E') {
        event.preventDefault();
        openTaskEditor(task);
      } else if (event.key === 'x' || event.key === 'X') {
        event.preventDefault();
        toggleTaskSelection(task.id, !state.selectedTaskIds.includes(task.id));
      } else if (event.key === 'm' || event.key === 'M') {
        event.preventDefault();
        await advanceFocusedTask(task);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        await deleteFocusedTask(task);
      }
    }

    async function advanceFocusedTask(task) {
      const nextLane = nextLaneId(task.column || task.lane || 'backlog');
      if (!nextLane) return;
      try {
        await requestJson(taskActionUrl(task.id, 'move'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ column: nextLane })
        });
        await reloadTasks();
        state.focusedTaskId = task.id;
        log('快捷键推进任务到 ' + nextLane);
      } catch (err) {
        log('快捷键推进失败: ' + err.message);
      }
    }

    async function deleteFocusedTask(task) {
      if (!window.confirm('删除当前聚焦任务？')) return;
      try {
        await requestJson(taskActionUrl(task.id), { method: 'DELETE' });
        state.focusedTaskId = '';
        await reloadTasks();
        log('当前任务已删除');
      } catch (err) {
        log('当前任务删除失败: ' + err.message);
      }
    }

    function handleTaskDragOver(event, laneId) {
      const taskId = getDraggedTaskId(event);
      if (!taskId) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      const laneEl = event.currentTarget.closest('.lane');
      if (laneEl) laneEl.classList.add('drag-over');
      const before = getTaskDropBefore(event.currentTarget, event.clientY, taskId);
      clearTaskDropState();
      if (laneEl) laneEl.classList.add('drag-over');
      if (before) before.classList.add('drop-before');
    }

    function handleTaskDragLeave(event, laneEl) {
      if (!laneEl || laneEl.contains(event.relatedTarget)) return;
      laneEl.classList.remove('drag-over');
      laneEl.querySelectorAll('.drop-before').forEach((item) => item.classList.remove('drop-before'));
    }

    async function handleTaskDrop(event, laneId) {
      const taskId = getDraggedTaskId(event);
      if (!taskId) return;
      event.preventDefault();
      const list = event.currentTarget;
      const before = getTaskDropBefore(list, event.clientY, taskId);
      const position = before ? getTaskPositionInList(list, before, taskId) : getTaskPositionInList(list, null, taskId);
      clearTaskDropState();
      try {
        await requestJson(taskActionUrl(taskId, 'move'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ column: laneId, position })
        });
        await reloadTasks();
        log('任务已移动到 ' + laneId);
      } catch (err) {
        log('任务拖放失败: ' + err.message);
      }
    }

    function getDraggedTaskId(event) {
      return state.draggingTaskId || (event.dataTransfer && event.dataTransfer.getData('text/plain')) || '';
    }

    function getTaskDropBefore(list, pointerY, draggedTaskId) {
      const cards = Array.from(list.querySelectorAll('.task:not(.dragging)')).filter((item) => item.dataset.taskId !== draggedTaskId);
      let closest = { offset: Number.NEGATIVE_INFINITY, element: null };
      for (const card of cards) {
        const box = card.getBoundingClientRect();
        const offset = pointerY - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) closest = { offset, element: card };
      }
      return closest.element;
    }

    function getTaskPositionInList(list, before, draggedTaskId) {
      const cards = Array.from(list.querySelectorAll('.task')).filter((item) => item.dataset.taskId !== draggedTaskId);
      if (!before) return cards.length;
      return Math.max(0, cards.findIndex((item) => item === before));
    }

    function clearTaskDropState() {
      document.querySelectorAll('.lane.drag-over').forEach((item) => item.classList.remove('drag-over'));
      document.querySelectorAll('.task.drop-before').forEach((item) => item.classList.remove('drop-before'));
      document.querySelectorAll('.task.dragging').forEach((item) => item.classList.remove('dragging'));
    }

    function nextLaneId(lane) {
      if (lane === 'backlog') return 'running';
      if (lane === 'running') return 'review';
      if (lane === 'blocked') return 'review';
      if (lane === 'review') return 'done';
      return '';
    }

    function currentPayload() {
      const notes = notesWithAttachments($('notesInput').value);
      return {
        sessionPath: $('sessionSelect').value,
        templateId: state.selectedTemplate,
        mission: $('missionInput').value,
        notes,
        rawNotes: $('notesInput').value,
        attachments: state.attachments,
        mode: $('modeSelect').value
      };
    }

    async function reloadTasks() {
      try {
        const sep = urls.tasks.includes('?') ? '&' : '?';
        const data = await requestJson(urls.tasks + sep + 'includeDone=true');
        state.tasks = data.tasks || [];
        renderBoard();
        renderMetrics();
        renderCheckpointTaskOptions();
      } catch (err) {
        log('任务加载失败: ' + err.message);
      }
    }

    async function reloadMissions() {
      try {
        const data = await requestJson(urls.missions);
        state.missions = data.missions || [];
        if (state.activeMission) {
          state.activeMission = state.missions.find((mission) => mission.id === state.activeMission.id) || state.missions[0] || null;
        } else {
          state.activeMission = state.missions[0] || null;
        }
        renderConductor();
        renderMissionHistory();
        renderMissionTimeline();
      } catch (err) {
        log('Mission 加载失败: ' + err.message);
      }
    }

    async function reloadCheckpoints() {
      try {
        const data = await requestJson(urls.checkpoints);
        state.checkpoints = data.checkpoints || [];
        state.checkpointConflicts = data.conflicts || [];
        await loadCheckpointReminders({ notify: true, silent: true });
        renderCheckpointInbox();
      } catch (err) {
        log('Checkpoint 加载失败: ' + err.message);
      }
    }

    async function loadCheckpointReminders(options = {}) {
      try {
        const sep = urls.checkpointReminders.includes('?') ? '&' : '?';
        const data = await requestJson(urls.checkpointReminders + sep + 'due=' + (options.dueOnly === true ? 'true' : 'false'));
        state.checkpointReminders = data.reminders || [];
        if (options.notify) notifyDueCheckpointReminders(state.checkpointReminders);
        renderCheckpointInbox();
        if (!options.silent) log('Checkpoint reminders 已刷新: ' + String(state.checkpointReminders.length));
        return data;
      } catch (err) {
        if (!options.silent) log('Checkpoint reminders 刷新失败: ' + err.message);
        return null;
      }
    }

    function notifyDueCheckpointReminders(reminders) {
      for (const reminder of Array.isArray(reminders) ? reminders : []) {
        const key = reminder.checkpointId || reminder.id;
        if (!key || state.checkpointReminderNotified[key]) continue;
        if (reminder.reminderTriggeredAt) continue;
        if (!reminder.due) continue;
        state.checkpointReminderNotified[key] = true;
        notifyWorkbench('alert', 'Checkpoint reminder', reminder.reminderNote || reminder.nextAction || reminder.blocker || reminder.state || key);
        requestJson(checkpointActionUrl(key, 'reminder'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'trigger' })
        }).catch(() => {});
      }
    }

    async function loadSessionHistory() {
      const sessionPath = $('sessionSelect').value;
      if (!sessionPath) {
        log('请先选择会话');
        return null;
      }
      const sep = urls.sessionHistory.includes('?') ? '&' : '?';
      try {
        const data = await requestJson(urls.sessionHistory + sep + 'sessionPath=' + encodeURIComponent(sessionPath) + '&limit=40');
        state.sessionHistory = data.messages || [];
        state.toolTrace = data.toolTrace || null;
        renderSessionHistory();
        renderToolTrace();
        renderInspectorPanel();
        if (state.researchCard) buildResearchCard();
        const lastAssistant = [...state.sessionHistory].reverse().find((item) => item.role === 'assistant' || item.role === 'agent');
        if (lastAssistant) setWorkerOutputMessage({ title: lastAssistant.role || 'assistant', role: lastAssistant.role || 'assistant', text: lastAssistant.text || '', meta: lastAssistant.createdAt ? formatTaskTime(lastAssistant.createdAt) : '', traceItems: state.toolTrace && Array.isArray(state.toolTrace.items) ? state.toolTrace.items.filter((trace) => trace.messageId && lastAssistant.id && trace.messageId === lastAssistant.id) : [] });
        log('会话历史已读取: ' + state.sessionHistory.length);
        return data;
      } catch (err) {
        log('读取会话历史失败: ' + err.message);
        return null;
      }
    }

    function exportSession(format) {
      const sessionPath = $('sessionSelect').value;
      if (!sessionPath) {
        log('请先选择会话');
        return;
      }
      const sep = urls.sessionExport.includes('?') ? '&' : '?';
      window.open(urls.sessionExport + sep + 'sessionPath=' + encodeURIComponent(sessionPath) + '&format=' + encodeURIComponent(format || 'markdown'), '_blank', 'noopener');
      log('会话导出已打开: ' + (format || 'markdown'));
    }

    function exportPinnedSessions() {
      const pinned = Array.isArray(state.config.pinnedSessions) ? state.config.pinnedSessions : [];
      if (!pinned.length) {
        log('暂无 pinned sessions 可导出');
        return;
      }
      const sep = urls.sessionExportBatch.includes('?') ? '&' : '?';
      window.open(urls.sessionExportBatch + sep + 'mode=pinned&format=zip', '_blank', 'noopener');
      log('Pinned sessions ZIP 导出已打开: ' + pinned.length);
    }

    async function syncHistoryCheckpoints() {
      const sessionPath = $('sessionSelect').value;
      if (!sessionPath) {
        log('请先选择会话');
        return;
      }
      const assignment = getActiveAssignment();
      const taskId = assignment && assignment.taskId ? assignment.taskId : $('checkpointTaskSelect').value;
      try {
        const result = await requestJson(urls.syncHistory, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionPath,
            taskId,
            missionId: state.activeMission ? state.activeMission.id : '',
            assignmentId: assignment ? assignment.id : '',
            agentId: resolveConductorAgentId(),
            limit: 60
          })
        });
        state.sessionHistory = result.history ? (result.history.messages || []) : state.sessionHistory;
        state.toolTrace = result.history ? (result.history.toolTrace || state.toolTrace) : state.toolTrace;
        await reloadTasks();
        await reloadMissions();
        await reloadCheckpoints();
        renderSessionHistory();
        renderToolTrace();
        if (state.researchCard) buildResearchCard();
        log('历史同步完成: 新增 checkpoint ' + (result.created || []).length + ' 个');
      } catch (err) {
        log('同步历史失败: ' + err.message);
      }
    }

    async function abortCurrentSession() {
      const sessionPath = $('sessionSelect').value;
      if (!sessionPath) {
        log('请先选择会话');
        return;
      }
      try {
        await requestJson(urls.sessionAbort, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionPath })
        });
        log('已请求中止会话: ' + sessionPath);
      } catch (err) {
        log('中止会话失败: ' + err.message);
      }
    }

    async function createWorkerSession() {
      const cwd = $('terminalCwdInput').value.trim();
      const agentId = $('agentSelect').value || (state.agents[0] && state.agents[0].id) || '';
      try {
        const data = await requestJson(urls.sessions, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId,
            cwd,
            title: state.activeMission ? state.activeMission.title : 'HanaAgent worker session',
            missionId: state.activeMission ? state.activeMission.id : '',
            assignmentId: state.activeAssignmentId || ''
          })
        });
        if (data.session && data.session.path) {
          state.sessions.unshift(data.session);
          $('sessionSelect').value = data.session.path;
          renderSessions();
          renderSessionDetail();
        }
        log('Worker session 已创建: ' + (data.session && data.session.path ? data.session.path : 'ok'));
      } catch (err) {
        log('创建 worker session 失败: ' + err.message);
      }
    }

    async function loadSessionStatus() {
      const sessionPath = $('sessionSelect').value;
      if (!sessionPath) {
        log('请先选择会话');
        return;
      }
      const sep = urls.sessionStatus.includes('?') ? '&' : '?';
      try {
        const data = await requestJson(urls.sessionStatus + sep + 'sessionPath=' + encodeURIComponent(sessionPath));
        state.sessionStatus = data;
        renderSessionLifecyclePanel();
        log('Session 状态已读取: ' + ((data.status && data.status.state) || 'unknown'));
      } catch (err) {
        state.sessionStatus = { ok: false, error: err.message, sessionPath };
        renderSessionLifecyclePanel();
        log('读取 Session 状态失败: ' + err.message);
      }
    }

    async function revertCurrentSessionTurn() {
      const sessionPath = $('sessionSelect').value;
      if (!sessionPath) {
        log('请先选择会话');
        return;
      }
      if (!window.confirm('回退当前会话最近一轮 assistant turn？')) return;
      try {
        const data = await requestJson(urls.sessionRevertTurn, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionPath })
        });
        log('会话已请求回退: ' + (data.branchPath || data.sessionPath || sessionPath));
        await loadSessionHistory();
        await loadSessionStatus();
      } catch (err) {
        log('回退会话失败: ' + err.message);
      }
    }

    async function loadAgentConfig() {
      const agentId = $('agentSelect').value || (state.agents[0] && state.agents[0].id) || '';
      if (!agentId) {
        log('请先选择智能体');
        return;
      }
      try {
        const data = await requestJson(appendApiPath(urls.agents, encodeURIComponent(agentId) + '/config'));
        state.agentConfig = data;
        renderAgentConfigPanel();
        log('Agent 配置已读取: ' + agentId);
      } catch (err) {
        state.agentConfig = null;
        renderAgentConfigPanel();
        log('读取 Agent 配置失败: ' + err.message);
      }
    }

    async function saveAgentProfile() {
      const agentId = $('agentSelect').value || (state.agents[0] && state.agents[0].id) || '';
      if (!agentId) {
        log('请先选择智能体');
        return;
      }
      const memoryValue = $('agentProfileMemorySelect').value;
      const userProfileValue = $('agentProfileUserProfileSelect').value;
      const maxTurns = clampInteger($('agentProfileMaxTurnsInput').value, 1, 100);
      const gatewayTimeout = clampInteger($('agentProfileGatewayTimeoutInput').value, 10, 600);
      const toolUse = $('agentProfileToolUseSelect').value;
      const memory = {};
      if (memoryValue) memory.enabled = memoryValue === 'enabled';
      if (userProfileValue) memory.userProfileEnabled = userProfileValue === 'enabled';
      const agent = {};
      if (maxTurns) agent.maxTurns = maxTurns;
      if (gatewayTimeout) agent.gatewayTimeout = gatewayTimeout;
      if (['auto', 'required', 'none'].includes(toolUse)) agent.toolUseEnforcement = toolUse;
      const partial = {
        name: $('agentProfileNameInput').value.trim(),
        model: $('agentProfileModelInput').value.trim(),
        memory,
        agent,
        skills: {
          enabled: $('agentProfileSkillsInput').value.split(',').map((item) => item.trim()).filter(Boolean)
        }
      };
      try {
        const data = await requestJson(appendApiPath(urls.agents, encodeURIComponent(agentId) + '/config'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ partial })
        });
        state.agentConfig = data;
        renderAgentConfigPanel();
        log('Agent Profile 已保存: ' + agentId + (data.host && data.host.ok ? '（已同步宿主）' : '（本地 override）'));
      } catch (err) {
        log('保存 Agent Profile 失败: ' + err.message);
      }
    }

    function clampInteger(value, min, max) {
      const number = Number(value);
      if (!Number.isFinite(number)) return 0;
      return Math.min(max, Math.max(min, Math.trunc(number)));
    }

    async function loadAgentSkills() {
      const agentId = $('agentSelect').value || (state.agents[0] && state.agents[0].id) || '';
      if (!agentId) {
        log('请先选择智能体');
        return;
      }
      const sep = urls.agentSkills.includes('?') ? '&' : '?';
      try {
        const data = await requestJson(urls.agentSkills + sep + 'agentId=' + encodeURIComponent(agentId));
        state.agentSkills = data;
        renderAgentSkillsPanel();
        renderInspectorPanel();
        log('Agent skills 已读取: ' + ((data.skills || []).length));
      } catch (err) {
        state.agentSkills = { ok: false, error: err.message, skills: [] };
        renderAgentSkillsPanel();
        renderInspectorPanel();
        log('读取 Agent skills 失败: ' + err.message);
      }
    }

    async function loadMemoryEntries() {
      state.memoryTab = 'memory';
      const sep = urls.memory.includes('?') ? '&' : '?';
      const params = new URLSearchParams();
      const agentId = $('agentSelect').value;
      const sessionPath = $('sessionSelect').value;
      const query = $('memoryQueryInput').value.trim();
      if (agentId) params.set('agentId', agentId);
      if (sessionPath) params.set('sessionPath', sessionPath);
      if (query) params.set('query', query);
      params.set('limit', '40');
      try {
        const data = await requestJson(urls.memory + sep + params.toString());
        state.memoryEntries = data.entries || [];
        renderMemoryPanel();
        renderInspectorPanel();
        log('Memory 已读取: ' + state.memoryEntries.length);
      } catch (err) {
        state.memoryEntries = [];
        renderMemoryPanel();
        renderInspectorPanel();
        log('读取 Memory 失败: ' + err.message);
      }
    }

    async function loadKnowledgePages(options = {}) {
      const sep = urls.knowledgeList.includes('?') ? '&' : '?';
      const params = new URLSearchParams();
      const query = $('memoryQueryInput').value.trim();
      if (query) params.set('query', query);
      params.set('limit', '80');
      try {
        const data = await requestJson(urls.knowledgeList + sep + params.toString());
        state.knowledgePages = data.pages || [];
        state.knowledgeResults = [];
        if (options.activate !== false) state.memoryTab = 'knowledge';
        renderKnowledgePanel();
        renderInspectorPanel();
        log('Knowledge 已读取: ' + state.knowledgePages.length);
      } catch (err) {
        state.knowledgePages = [];
        renderKnowledgePanel();
        log('读取 Knowledge 失败: ' + err.message);
      }
    }

    async function searchKnowledgePages() {
      const sep = urls.knowledgeSearch.includes('?') ? '&' : '?';
      const params = new URLSearchParams();
      const query = $('memoryQueryInput').value.trim();
      if (query) params.set('q', query);
      params.set('limit', '80');
      try {
        const data = await requestJson(urls.knowledgeSearch + sep + params.toString());
        state.knowledgeResults = data.results || [];
        state.memoryTab = 'knowledge';
        renderKnowledgePanel();
        log('Knowledge 搜索命中: ' + state.knowledgeResults.length);
      } catch (err) {
        state.knowledgeResults = [];
        renderKnowledgePanel();
        log('搜索 Knowledge 失败: ' + err.message);
      }
    }

    async function readKnowledgePage(pagePath) {
      if (!pagePath) return;
      const sep = urls.knowledgeRead.includes('?') ? '&' : '?';
      const params = new URLSearchParams({ path: pagePath });
      try {
        const data = await requestJson(urls.knowledgeRead + sep + params.toString());
        const page = data.page || {};
        state.knowledgePage = { ...page, content: data.content || page.content || page.summary || '' };
        state.memoryTab = 'knowledge';
        renderKnowledgePanel();
        setWorkerOutputMessage({
          title: state.knowledgePage.title || state.knowledgePage.id || pagePath,
          role: 'knowledge',
          text: state.knowledgePage.content || state.knowledgePage.summary || '(empty)',
          meta: state.knowledgePage.path || pagePath
        });
        log('Knowledge 页面已读取: ' + pagePath);
      } catch (err) {
        log('读取 Knowledge 页面失败: ' + err.message);
      }
    }

    async function loadKnowledgeGraph() {
      try {
        const data = await requestJson(urls.knowledgeGraph);
        state.knowledgeGraph = data;
        state.memoryTab = 'knowledge';
        renderKnowledgePanel();
        log('Knowledge 图谱已读取: ' + ((data.nodes || []).length) + ' nodes');
      } catch (err) {
        state.knowledgeGraph = { nodes: [], edges: [], error: err.message };
        renderKnowledgePanel();
        log('读取 Knowledge 图谱失败: ' + err.message);
      }
    }

    async function loadWorkerDrilldown(workerId) {
      if (!workerId) return;
      try {
        const data = await requestJson(appendApiPath(urls.workers, encodeURIComponent(workerId)));
        state.workerDetail = data;
        renderWorkerDrilldownPanel();
        log('Worker drilldown 已读取: ' + workerId);
      } catch (err) {
        state.workerDetail = { worker: { id: workerId, name: workerId, status: 'unavailable' }, summary: {}, error: err.message };
        renderWorkerDrilldownPanel();
        log('Worker drilldown 失败: ' + err.message);
      }
    }

    async function readMemoryEntry(memoryId) {
      if (!memoryId) return;
      try {
        const data = await requestJson(appendApiPath(urls.memory, encodeURIComponent(memoryId)));
        const entry = data.entry || {};
        state.memoryEntry = entry;
        renderMemoryEditor();
        setWorkerOutputMessage({ title: entry.title || memoryId, role: 'memory', text: entry.content || entry.summary || '(empty)', meta: entry.id || memoryId });
        log('Memory 条目已读取: ' + memoryId);
      } catch (err) {
        log('读取 Memory 条目失败: ' + err.message);
      }
    }

    async function saveMemoryEntry() {
      const current = state.memoryEntry || {};
      const title = $('memoryTitleInput').value.trim() || current.title || 'HanaAgent Memory';
      const summary = $('memorySummaryInput').value.trim();
      const content = $('memoryEditor').value || '';
      const memoryId = current.source === 'hanaagent:memory' ? current.memoryId : '';
      try {
        const data = await requestJson(memoryId ? appendApiPath(urls.memory, encodeURIComponent(memoryId)) : urls.memory, {
          method: memoryId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, summary, content })
        });
        state.memoryEntry = data.entry || null;
        await loadMemoryEntries();
        renderMemoryEditor();
        log('Memory 已保存: ' + ((data.entry && data.entry.memoryId) || title));
      } catch (err) {
        log('保存 Memory 失败: ' + err.message);
      }
    }

    async function deleteMemoryEntry() {
      const current = state.memoryEntry || {};
      if (!current.memoryId || current.source !== 'hanaagent:memory') {
        log('只能删除 HanaAgent 本地记忆');
        return;
      }
      if (!window.confirm('删除本地记忆 ' + current.title + ' ?')) return;
      try {
        await requestJson(appendApiPath(urls.memory, encodeURIComponent(current.memoryId)), { method: 'DELETE' });
        state.memoryEntry = null;
        $('memoryTitleInput').value = '';
        $('memorySummaryInput').value = '';
        $('memoryEditor').value = '';
        await loadMemoryEntries();
        log('Memory 已删除: ' + current.memoryId);
      } catch (err) {
        log('删除 Memory 失败: ' + err.message);
      }
    }

    async function loadUsage() {
      const sep = urls.usage.includes('?') ? '&' : '?';
      const params = new URLSearchParams();
      const sessionPath = $('sessionSelect').value;
      const agentId = $('agentSelect').value;
      if (sessionPath) params.set('sessionPath', sessionPath);
      if (agentId) params.set('agentId', agentId);
      params.set('limit', '80');
      try {
        const data = await requestJson(urls.usage + sep + params.toString());
        if (!data.attribution && state.usage && state.usage.attribution) data.attribution = state.usage.attribution;
        state.usage = data;
        renderUsagePanel();
        log('用量已读取: ' + ((data.summary && data.summary.totalTokens) || 0) + ' tokens');
      } catch (err) {
        state.usage = null;
        renderUsagePanel();
        log('读取用量失败: ' + err.message);
      }
    }

    async function loadContextUsage() {
      const sessionPath = $('sessionSelect').value;
      if (!sessionPath) {
        log('请先选择会话');
        return;
      }
      const sep = urls.contextUsage.includes('?') ? '&' : '?';
      const params = new URLSearchParams();
      params.set('sessionPath', sessionPath);
      const agentId = $('agentSelect').value;
      if (agentId) params.set('agentId', agentId);
      const session = state.sessions.find((item) => item.path === sessionPath) || {};
      const model = (session.modelId || session.model || ($('agentProfileModelInput') && $('agentProfileModelInput').value) || '').trim();
      if (model) params.set('modelId', model);
      params.set('historyLimit', '120');
      try {
        const data = await requestJson(urls.contextUsage + sep + params.toString());
        state.contextUsage = data;
        renderContextUsagePanel();
        renderInspectorPanel();
        const context = data.context || {};
        log('上下文占用: ' + String(context.percent || 0) + '% / ' + String(context.usedTokens || 0) + ' tokens');
      } catch (err) {
        state.contextUsage = null;
        renderContextUsagePanel();
        renderInspectorPanel();
        log('读取上下文失败: ' + err.message);
      }
    }

    async function loadHostCheckpoints() {
      const sep = urls.hostCheckpoints.includes('?') ? '&' : '?';
      const params = new URLSearchParams();
      const sessionPath = $('sessionSelect').value;
      if (sessionPath) params.set('sessionPath', sessionPath);
      try {
        const data = await requestJson(urls.hostCheckpoints + (params.toString() ? sep + params.toString() : ''));
        state.hostCheckpoints = data.checkpoints || [];
        renderHostCheckpointPanel();
        log('宿主 checkpoint 已读取: ' + state.hostCheckpoints.length);
      } catch (err) {
        state.hostCheckpoints = [];
        renderHostCheckpointPanel();
        log('读取宿主 checkpoint 失败: ' + err.message);
      }
    }

    async function restoreHostCheckpoint(checkpointId) {
      if (!checkpointId) {
        log('缺少宿主 checkpoint id');
        return;
      }
      if (!window.confirm('恢复宿主文件 checkpoint ' + checkpointId + ' ?')) return;
      try {
        const data = await requestJson(hostCheckpointActionUrl(checkpointId, 'restore'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: 'hanaagent' })
        });
        log('宿主 checkpoint 已恢复: ' + (data.restoredTo || data.restoredFiles || checkpointId));
        await loadHostCheckpoints();
      } catch (err) {
        log('恢复宿主 checkpoint 失败: ' + err.message);
      }
    }

    async function loadHostTasks() {
      const sep = urls.hostTasks.includes('?') ? '&' : '?';
      const params = new URLSearchParams();
      params.set('pluginId', 'hanaagent');
      try {
        const data = await requestJson(urls.hostTasks + sep + params.toString());
        state.hostTasks = data.tasks || [];
        renderHostTaskPanel();
        log('宿主任务已读取: ' + state.hostTasks.length);
      } catch (err) {
        state.hostTasks = [];
        renderHostTaskPanel();
        log('读取宿主任务失败: ' + err.message);
      }
    }

    async function registerHostTask() {
      const mission = state.activeMission;
      const taskId = 'hanaagent-' + Date.now();
      try {
        await requestJson(urls.hostTasks, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId,
            type: 'hanaagent-mission',
            sessionPath: $('sessionSelect').value,
            agentId: resolveConductorAgentId(),
            persist: true,
            meta: {
              label: mission ? mission.title : 'HanaAgent mission runtime',
              missionId: mission ? mission.id : '',
              assignmentId: state.activeAssignmentId || ''
            }
          })
        });
        log('宿主任务已注册: ' + taskId);
        await loadHostTasks();
      } catch (err) {
        log('注册宿主任务失败: ' + err.message);
      }
    }

    async function completeHostTask(taskId) {
      if (!taskId) return;
      try {
        await requestJson(hostTaskActionUrl(taskId, 'complete'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ result: { ok: true, source: 'hanaagent' } })
        });
        log('宿主任务已完成: ' + taskId);
        await loadHostTasks();
      } catch (err) {
        log('完成宿主任务失败: ' + err.message);
      }
    }

    async function cancelHostTask(taskId) {
      if (!taskId) return;
      try {
        await requestJson(hostTaskActionUrl(taskId, 'cancel'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'operator cancel' })
        });
        log('宿主任务已取消: ' + taskId);
        await loadHostTasks();
      } catch (err) {
        log('取消宿主任务失败: ' + err.message);
      }
    }

    async function loadDeferredTasks() {
      const sep = urls.deferredTasks.includes('?') ? '&' : '?';
      const params = new URLSearchParams();
      const sessionPath = $('sessionSelect').value;
      if (sessionPath) params.set('sessionPath', sessionPath);
      try {
        const data = await requestJson(urls.deferredTasks + (params.toString() ? sep + params.toString() : ''));
        state.deferredTasks = data.pending || [];
        renderDeferredTaskPanel();
        log('Deferred tasks 已读取: ' + state.deferredTasks.length);
      } catch (err) {
        state.deferredTasks = [];
        renderDeferredTaskPanel();
        log('读取 Deferred tasks 失败: ' + err.message);
      }
    }

    async function listSessionTerminals() {
      const sessionPath = $('sessionSelect').value;
      if (!sessionPath) {
        log('请先选择会话');
        return [];
      }
      const sep = urls.terminals.includes('?') ? '&' : '?';
      try {
        const data = await requestJson(urls.terminals + sep + 'sessionPath=' + encodeURIComponent(sessionPath));
        if (!state.terminal && data.terminals && data.terminals[0]) {
          state.terminal = data.terminals[0];
          state.terminalSeq = state.terminal.seq || 0;
        }
        if (state.terminal) startTerminalAutoRead();
        renderTerminal();
        log('Terminal 列表已读取: ' + (data.terminals || []).length);
        return data.terminals || [];
      } catch (err) {
        log('读取 Terminal 失败: ' + err.message);
        return [];
      }
    }

    async function startSessionTerminal() {
      const sessionPath = $('sessionSelect').value;
      const cwd = $('terminalCwdInput').value.trim();
      if (!sessionPath) {
        log('请先选择会话');
        return;
      }
      if (!cwd) {
        log('请填写 cwd');
        return;
      }
      try {
        const data = await requestJson(urls.terminals, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionPath, cwd, label: 'HanaAgent Terminal', cols: 120, rows: 28 })
        });
        state.terminal = data.terminal;
        state.terminalSeq = data.terminal ? data.terminal.seq || 0 : 0;
        state.terminalOutput = '';
        startTerminalAutoRead();
        renderTerminal();
        log('Terminal 已启动: ' + (state.terminal ? state.terminal.terminalId : 'unknown'));
        await readSessionTerminal();
      } catch (err) {
        log('启动 Terminal 失败: ' + err.message);
      }
    }

    async function readSessionTerminal() {
      const sessionPath = $('sessionSelect').value;
      if (!state.terminal) {
        const terminals = await listSessionTerminals();
        if (!terminals.length) return;
      }
      const terminalId = state.terminal && (state.terminal.terminalId || state.terminal.id);
      if (!sessionPath || !terminalId) return;
      const url = terminalActionUrl(terminalId, 'read');
      const sep = url.includes('?') ? '&' : '?';
      try {
        const data = await requestJson(url + sep + 'sessionPath=' + encodeURIComponent(sessionPath) + '&sinceSeq=' + encodeURIComponent(state.terminalSeq || 0));
        if (data.output) state.terminalOutput += data.output;
        if (Number.isFinite(Number(data.seq))) state.terminalSeq = Number(data.seq);
        state.terminalLastReadAt = new Date().toISOString();
        renderTerminal();
      } catch (err) {
        log('读取 Terminal 输出失败: ' + err.message);
      }
    }

    function startTerminalAutoRead() {
      if (state.terminalPollTimer) return;
      state.terminalAutoRead = true;
      state.terminalPollTimer = window.setInterval(() => {
        if (!state.terminalAutoRead || !state.terminal) return;
        readSessionTerminal();
      }, 1500);
      renderTerminal();
    }

    function stopTerminalAutoRead() {
      state.terminalAutoRead = false;
      if (state.terminalPollTimer) {
        window.clearInterval(state.terminalPollTimer);
        state.terminalPollTimer = null;
      }
      renderTerminal();
    }

    function toggleTerminalAutoRead() {
      if (state.terminalAutoRead) {
        stopTerminalAutoRead();
        log('Terminal 自动读取已关闭');
        return;
      }
      if (!state.terminal) {
        listSessionTerminals().then((terminals) => {
          if (terminals.length) {
            startTerminalAutoRead();
            log('Terminal 自动读取已开启');
          }
        });
        return;
      }
      startTerminalAutoRead();
      log('Terminal 自动读取已开启');
    }

    async function writeSessionTerminal(chars) {
      const sessionPath = $('sessionSelect').value;
      const terminalId = state.terminal && (state.terminal.terminalId || state.terminal.id);
      if (!sessionPath || !terminalId) {
        log('请先启动 Terminal');
        return;
      }
      const payload = typeof chars === 'string' ? chars : $('terminalCommandInput').value;
      if (!payload) return;
      rememberTerminalCommand(payload);
      try {
        const data = await requestJson(terminalActionUrl(terminalId, 'write'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionPath, chars: payload.endsWith('\\n') || payload.endsWith('\\r') ? payload : payload + '\\r' })
        });
        $('terminalCommandInput').value = '';
        if (data.output) state.terminalOutput += data.output;
        if (Number.isFinite(Number(data.seq))) state.terminalSeq = Number(data.seq);
        renderTerminal();
      } catch (err) {
        log('写入 Terminal 失败: ' + err.message);
      }
    }

    function rememberTerminalCommand(command) {
      const value = String(command || '').trim();
      if (!value) return;
      const history = state.terminalCommandHistory.filter((item) => item !== value);
      history.push(value);
      state.terminalCommandHistory = history.slice(-30);
      state.terminalHistoryIndex = state.terminalCommandHistory.length;
    }

    function recallTerminalCommand(direction) {
      const history = state.terminalCommandHistory;
      if (!history.length) return;
      const input = $('terminalCommandInput');
      if (!input) return;
      const next = Math.max(0, Math.min(history.length, state.terminalHistoryIndex + direction));
      state.terminalHistoryIndex = next;
      input.value = next >= history.length ? '' : history[next];
      input.focus();
      input.selectionStart = input.value.length;
      input.selectionEnd = input.value.length;
    }

    function queueTerminalCommand(command) {
      const input = $('terminalCommandInput');
      if (input) input.value = command;
      writeSessionTerminal(command);
    }

    function clearTerminalOutput() {
      state.terminalOutput = '';
      renderTerminal();
      log('Terminal 输出已清空');
    }

    async function copyTerminalOutput() {
      await copyText(state.terminalOutput || '');
      log('Terminal 输出已复制');
    }

    async function closeSessionTerminal() {
      const sessionPath = $('sessionSelect').value;
      const terminalId = state.terminal && (state.terminal.terminalId || state.terminal.id);
      if (!sessionPath || !terminalId) return;
      try {
        await requestJson(terminalActionUrl(terminalId, 'close'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionPath })
        });
        state.terminal = null;
        state.terminalSeq = 0;
        stopTerminalAutoRead();
        state.terminalOutput += '\\n[terminal closed]\\n';
        renderTerminal();
        log('Terminal 已关闭');
      } catch (err) {
        log('关闭 Terminal 失败: ' + err.message);
      }
    }

    async function loadWorkspaceRoots() {
      try {
        const data = await requestJson(urls.workspaceRoots);
        state.workspaceRoots = data.roots || [];
        renderWorkspaceFilesPanel();
        log('Workspace roots 已读取: ' + state.workspaceRoots.length);
        if (state.workspaceRoots.length && !state.workspaceFiles.length) await loadWorkspaceFiles();
      } catch (err) {
        log('读取 Workspace roots 失败: ' + err.message);
      }
    }

    async function loadWorkspaceFiles() {
      const rootId = $('workspaceRootSelect').value;
      const pathValue = $('workspacePathInput').value.trim() || '.';
      const params = new URLSearchParams({ rootId, path: pathValue, depth: '2', maxEntries: '500' });
      const sep = urls.workspaceFiles.includes('?') ? '&' : '?';
      try {
        const data = await requestJson(urls.workspaceFiles + sep + params.toString());
        state.workspaceFiles = data.entries || [];
        state.workspacePath = data.relativePath || pathValue;
        renderWorkspaceFilesPanel();
        log('Workspace files 已读取: ' + state.workspaceFiles.length);
      } catch (err) {
        log('读取 Workspace files 失败: ' + err.message);
      }
    }

    async function loadWorkspaceFile(relativePath) {
      const rootId = $('workspaceRootSelect').value;
      const pathValue = relativePath || $('workspacePathInput').value.trim() || '.';
      const params = new URLSearchParams({ rootId, path: pathValue });
      const sep = urls.workspaceFile.includes('?') ? '&' : '?';
      try {
        const data = await requestJson(urls.workspaceFile + sep + params.toString());
        state.workspaceFile = data;
        state.workspacePatchReview = null;
        $('workspacePathInput').value = data.relativePath || pathValue;
        renderWorkspaceFilesPanel();
        log('Workspace file 已读取: ' + (data.relativePath || pathValue));
      } catch (err) {
        log('读取 Workspace file 失败: ' + err.message);
      }
    }

    async function diffWorkspaceFile() {
      const file = state.workspaceFile;
      const rootId = $('workspaceRootSelect').value;
      const pathValue = $('workspacePathInput').value.trim() || (file && file.relativePath) || '';
      if (!pathValue) {
        log('请先选择或填写文件路径');
        return;
      }
      if (file && file.kind === 'image') {
        log('图片预览不支持 Diff');
        return;
      }
      try {
        const data = await requestJson(urls.workspaceFileDiff, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rootId, path: pathValue, content: $('workspaceEditor').value })
        });
        state.workspacePatchReview = null;
        $('workspacePreview').textContent = data.diff || 'No diff';
        $('workspaceFileTag').textContent = data.changed ? ('diff +' + data.stats.additions + ' -' + data.stats.deletions) : 'no changes';
        log('Workspace diff 已生成: ' + (data.relativePath || pathValue));
      } catch (err) {
        log('生成 Workspace diff 失败: ' + err.message);
      }
    }

    async function createWorkspacePatchReview() {
      const file = state.workspaceFile;
      const rootId = $('workspaceRootSelect').value;
      const pathValue = $('workspacePathInput').value.trim() || (file && file.relativePath) || '';
      if (!pathValue) {
        log('请先选择或填写文件路径');
        return;
      }
      if (file && file.kind === 'image') {
        log('图片预览不支持 Patch Review');
        return;
      }
      try {
        const mission = state.activeMission || {};
        const assignment = getActiveAssignment() || {};
        const data = await requestJson(urls.workspacePatchReview, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rootId,
            path: pathValue,
            content: $('workspaceEditor').value,
            missionId: mission.id || '',
            assignmentId: assignment.id || '',
            taskId: assignment.taskId || '',
            sessionPath: $('sessionSelect').value || assignment.sessionPath || '',
            agentId: resolveConductorAgentId() || assignment.agentId || ''
          })
        });
        if (!data.changed) {
          state.workspacePatchReview = null;
          $('workspaceFileTag').textContent = 'no changes';
          log('Patch Review 未创建：内容没有变化');
          return;
        }
        state.workspacePatchReview = data.review || null;
        if (data.diff && data.diff.diff) $('workspacePreview').textContent = data.diff.diff;
        $('workspaceFileTag').textContent = data.review ? ('patch pending +' + (data.diff.stats.additions || 0) + ' -' + (data.diff.stats.deletions || 0)) : 'patch review failed';
        if (data.review) {
          state.runRecords.unshift(data.review);
          renderRunRecordPanel();
          renderWorkspaceFilesPanel();
          log('Patch Review 已创建: ' + data.review.title);
          notifyWorkbench('alert', 'Patch Review 待审批', data.review.title);
        }
      } catch (err) {
        log('创建 Patch Review 失败: ' + err.message);
      }
    }

    async function acceptWorkspacePatchReview() {
      const review = state.workspacePatchReview;
      if (!review || !review.id) {
        log('请先创建 Patch Review');
        return;
      }
      try {
        const data = await requestJson(appendApiPath(urls.workspacePatchReview, encodeURIComponent(review.id) + '/accept'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        state.workspacePatchReview = data.review || null;
        if (data.file) {
          state.workspaceFile = data.file;
          $('workspacePathInput').value = data.file.relativePath || $('workspacePathInput').value;
        }
        await loadWorkspaceFiles();
        renderRunRecordPanel();
        renderWorkspaceFilesPanel();
        log('Patch Review 已采纳并写入: ' + ((data.file && data.file.relativePath) || review.title));
        notifyWorkbench('complete', 'Patch 已采纳', (data.file && data.file.relativePath) || review.title);
      } catch (err) {
        log('采纳 Patch Review 失败: ' + err.message);
      }
    }

    async function rejectWorkspacePatchReview() {
      const review = state.workspacePatchReview;
      if (!review || !review.id) {
        log('请先创建 Patch Review');
        return;
      }
      const reason = window.prompt('拒绝原因', 'Needs revision') || '';
      try {
        const data = await requestJson(appendApiPath(urls.workspacePatchReview, encodeURIComponent(review.id) + '/reject'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason })
        });
        state.workspacePatchReview = data.review || null;
        await refreshRunRecords();
        renderWorkspaceFilesPanel();
        log('Patch Review 已拒绝: ' + (reason || review.title));
        notifyWorkbench('failed', 'Patch 已拒绝', reason || review.title);
      } catch (err) {
        log('拒绝 Patch Review 失败: ' + err.message);
      }
    }

    function downloadWorkspaceFile() {
      const file = state.workspaceFile;
      const rootId = $('workspaceRootSelect').value;
      const pathValue = $('workspacePathInput').value.trim() || (file && file.relativePath) || '';
      if (!pathValue) {
        log('请先选择或填写文件路径');
        return;
      }
      const sep = urls.workspaceFileDownload.includes('?') ? '&' : '?';
      const params = new URLSearchParams({ rootId, path: pathValue });
      window.open(urls.workspaceFileDownload + sep + params.toString(), '_blank', 'noopener,noreferrer');
      log('Workspace file 下载已打开: ' + pathValue);
    }

    async function saveWorkspaceFile() {
      const file = state.workspaceFile;
      const rootId = $('workspaceRootSelect').value;
      const pathValue = $('workspacePathInput').value.trim() || (file && file.relativePath) || '';
      if (!pathValue) {
        log('请先选择或填写文件路径');
        return;
      }
      if (file && file.kind === 'image') {
        log('图片预览不支持在此保存');
        return;
      }
      try {
        const data = await requestJson(urls.workspaceFile, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rootId, path: pathValue, content: $('workspaceEditor').value })
        });
        state.workspaceFile = data;
        await loadWorkspaceFiles();
        renderWorkspaceFilesPanel();
        log('Workspace file 已保存: ' + (data.relativePath || pathValue));
      } catch (err) {
        log('保存 Workspace file 失败: ' + err.message);
      }
    }

    function chooseWorkspaceUpload() {
      const input = $('workspaceUploadInput');
      if (!input) return;
      input.value = '';
      input.click();
    }

    async function uploadWorkspaceFileFromInput() {
      const input = $('workspaceUploadInput');
      const file = input && input.files && input.files[0] ? input.files[0] : null;
      if (!file) return;
      const rootId = $('workspaceRootSelect').value;
      const current = $('workspacePathInput').value.trim() || '.';
      const target = uploadTargetPath(current, file.name || 'upload.bin');
      try {
        const content = await readFileAsBase64(file);
        const data = await requestJson(urls.workspaceFileUpload, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rootId,
            path: target,
            filename: file.name || target,
            mime: file.type || '',
            encoding: 'base64',
            content
          })
        });
        state.workspaceFile = data;
        $('workspacePathInput').value = data.relativePath || target;
        await loadWorkspaceFiles();
        renderWorkspaceFilesPanel();
        log('Workspace file 已上传: ' + (data.relativePath || target));
      } catch (err) {
        log('上传 Workspace file 失败: ' + err.message);
      }
    }

    function uploadTargetPath(current, filename) {
      const safeName = String(filename || 'upload.bin').split(/[\\\\/]/).filter(Boolean).pop() || 'upload.bin';
      if (!current || current === '.') return safeName;
      if (current.endsWith('/')) return current + safeName;
      const selected = state.workspaceFile;
      if (selected && selected.relativePath === current && selected.kind !== 'directory') return current;
      const entry = state.workspaceFiles.find((item) => item.relativePath === current);
      if (entry && entry.type === 'directory') return current.replace(/\\/$/, '') + '/' + safeName;
      return current.includes('.') ? current : current.replace(/\\/$/, '') + '/' + safeName;
    }

    function readFileAsBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('file_read_failed'));
        reader.onload = () => {
          const text = String(reader.result || '');
          resolve(text.includes(',') ? text.split(',').pop() : text);
        };
        reader.readAsDataURL(file);
      });
    }

    async function newWorkspaceFile() {
      const rootId = $('workspaceRootSelect').value;
      const current = $('workspacePathInput').value.trim() || '.';
      const fallback = current.endsWith('/') || current === '.' ? (current === '.' ? 'untitled.md' : current + 'untitled.md') : current;
      const target = window.prompt('新建文件相对路径', fallback);
      if (!target) return;
      $('workspacePathInput').value = target;
      $('workspaceEditor').value = '';
      state.workspaceFile = { root: { id: rootId }, relativePath: target, kind: 'text', content: '', writable: true };
      renderWorkspaceFilesPanel();
      await saveWorkspaceFile();
    }

    async function mkdirWorkspacePath() {
      const rootId = $('workspaceRootSelect').value;
      const current = $('workspacePathInput').value.trim() || '.';
      const target = window.prompt('新建目录相对路径', current === '.' ? 'new-folder' : current + '/new-folder');
      if (!target) return;
      try {
        await requestJson(urls.workspaceFileAction, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'mkdir', rootId, path: target })
        });
        $('workspacePathInput').value = target;
        await loadWorkspaceFiles();
        log('Workspace 目录已创建: ' + target);
      } catch (err) {
        log('创建 Workspace 目录失败: ' + err.message);
      }
    }

    async function renameWorkspacePath() {
      const rootId = $('workspaceRootSelect').value;
      const from = $('workspacePathInput').value.trim() || (state.workspaceFile && state.workspaceFile.relativePath) || '';
      if (!from || from === '.') {
        log('请先选择要重命名的文件或目录');
        return;
      }
      const to = window.prompt('重命名为相对路径', from);
      if (!to || to === from) return;
      try {
        const data = await requestJson(urls.workspaceFileAction, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'rename', rootId, path: from, to })
        });
        $('workspacePathInput').value = data.relativePath || to;
        state.workspaceFile = null;
        await loadWorkspaceFiles();
        log('Workspace 路径已重命名: ' + from + ' -> ' + to);
      } catch (err) {
        log('重命名 Workspace 路径失败: ' + err.message);
      }
    }

    async function deleteWorkspacePath() {
      const rootId = $('workspaceRootSelect').value;
      const target = $('workspacePathInput').value.trim() || (state.workspaceFile && state.workspaceFile.relativePath) || '';
      if (!target || target === '.') {
        log('不能删除 workspace root');
        return;
      }
      if (!window.confirm('删除 ' + target + ' ?')) return;
      try {
        await requestJson(urls.workspaceFileAction, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', rootId, path: target })
        });
        state.workspaceFile = null;
        $('workspaceEditor').value = '';
        $('workspacePathInput').value = '.';
        await loadWorkspaceFiles();
        log('Workspace 路径已删除: ' + target);
      } catch (err) {
        log('删除 Workspace 路径失败: ' + err.message);
      }
    }

    async function loadRunRecords() {
      try {
        const data = await requestJson(urls.runRecords);
        state.runRecords = data.records || [];
        state.runRecordSummary = data.summary || null;
        renderRunRecordPanel();
        log('Run records 已刷新: ' + state.runRecords.length);
      } catch (err) {
        log('刷新 Run records 失败: ' + err.message);
      }
    }

    async function loadMissionInbox() {
      const mission = state.activeMission;
      const sep = urls.inbox.includes('?') ? '&' : '?';
      try {
        const data = await requestJson(urls.inbox + (mission ? sep + 'missionId=' + encodeURIComponent(mission.id) : ''));
        state.inbox = data;
        state.inboxSummary = data.summary || null;
        renderMissionInboxPanel();
        log('Mission Inbox 已刷新: ' + ((data.summary && data.summary.total) || 0));
      } catch (err) {
        log('Mission Inbox 刷新失败: ' + err.message);
      }
    }

    async function copyMissionInboxSummary() {
      const inbox = state.inbox || {};
      const summary = inbox.summary || {};
      const items = Array.isArray(inbox.items) ? inbox.items : [];
      const lines = [
        '# HanaAgent Mission Inbox',
        '',
        '- Total: ' + String(summary.total || items.length || 0),
        '- Critical: ' + String(summary.critical || 0),
        '- Blockers: ' + String(summary.blockers || 0),
        '- Approvals: ' + String(summary.approvals || 0),
        '- Needs input: ' + String(summary.needsInput || 0),
        '- Review: ' + String(summary.review || 0),
        '- Review gate: ' + String(summary.reviewGate || 0),
        '',
        ...items.slice(0, 20).map((item) => '- [' + (item.severity || 'medium') + '] ' + (item.title || item.kind || 'item') + ' :: ' + (item.detail || item.action || ''))
      ];
      try {
        await navigator.clipboard.writeText(lines.join('\\n'));
        log('Mission Inbox 摘要已复制');
      } catch {
        log('复制失败，请检查浏览器剪贴板权限');
      }
    }

    async function runAutopilot(mode) {
      const mission = state.activeMission;
      if (!mission) {
        log('暂无 mission 可巡检');
        return;
      }
      try {
        const data = await requestJson(missionActionUrl(mission.id, 'autopilot'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: mode || 'preview' })
        });
        state.autopilot = data.run || null;
        renderAutopilotPanel();
        if (mode === 'run') {
          await reloadTasks();
          await reloadMissions();
        }
        log('Autopilot ' + (mode || 'preview') + ': ' + ((data.run && data.run.summary) || 'ok'));
      } catch (err) {
        log('Autopilot 失败: ' + err.message);
      }
    }

    async function loadAutopilotRuns() {
      const sep = urls.autopilot.includes('?') ? '&' : '?';
      const mission = state.activeMission;
      try {
        const data = await requestJson(urls.autopilot + (mission ? sep + 'missionId=' + encodeURIComponent(mission.id) : ''));
        state.autopilotRuns = data.runs || [];
        state.autopilot = data.latest || state.autopilot;
        state.autopilotSchedule = data.schedule || state.autopilotSchedule;
        state.autopilotLoop = data.loop || state.autopilotLoop;
        renderAutopilotPanel();
        log('Autopilot 历史已读取: ' + state.autopilotRuns.length);
      } catch (err) {
        log('读取 Autopilot 历史失败: ' + err.message);
      }
    }

    async function loadAutopilotSchedule() {
      try {
        const data = await requestJson(urls.autopilotSchedule);
        state.autopilotSchedule = data.schedule || null;
        state.autopilotStatus = data.status || null;
        state.autopilotLoop = data.loop || state.autopilotLoop;
        applyAutopilotScheduleInputs();
        renderAutopilotPanel();
        log('Autopilot 后台状态已读取');
      } catch (err) {
        log('读取 Autopilot 后台状态失败: ' + err.message);
      }
    }

    async function saveAutopilotSchedule(enabled) {
      const payload = {
        enabled,
        mode: $('autopilotScheduleMode').value || 'preview',
        intervalMinutes: $('autopilotIntervalInput').value || 15,
        maxMissionsPerTick: 5
      };
      try {
        const data = await requestJson(urls.autopilotSchedule, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        state.autopilotSchedule = data.schedule || payload;
        state.autopilotStatus = data.status || null;
        state.autopilotLoop = data.loop || state.autopilotLoop;
        renderAutopilotPanel();
        log('Autopilot 后台已' + (enabled ? '启用' : '停用'));
      } catch (err) {
        log('保存 Autopilot 后台设置失败: ' + err.message);
      }
    }

    async function runAutopilotTickNow() {
      try {
        const data = await requestJson(urls.autopilotTick, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reason: 'operator',
            mode: $('autopilotScheduleMode').value || 'preview',
            maxMissionsPerTick: 5
          })
        });
        state.autopilotTick = data;
        state.autopilotLoop = data.loop || state.autopilotLoop;
        await loadAutopilotRuns();
        renderAutopilotPanel();
        log('Autopilot tick 完成: scanned ' + (data.scanned || 0));
      } catch (err) {
        log('Autopilot tick 失败: ' + err.message);
      }
    }

    async function controlAutopilotLoop(action) {
      const payload = {
        action,
        mode: $('autopilotScheduleMode').value || 'preview',
        intervalMinutes: $('autopilotIntervalInput').value || 15,
        maxIterations: $('autopilotLoopIterationsInput').value || 12,
        escalationThreshold: $('autopilotEscalationInput').value || 3,
        maxMissionsPerTick: 5
      };
      try {
        const data = await requestJson(urls.autopilotLoop, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        state.autopilotLoop = data.loop || null;
        renderAutopilotPanel();
        log('Autopilot loop ' + action + ': ' + ((data.loop && data.loop.state) || 'ok'));
      } catch (err) {
        log('Autopilot loop ' + action + ' 失败: ' + err.message);
      }
    }

    async function loadJobs() {
      try {
        const data = await requestJson(urls.jobs);
        state.jobs = data.jobs || [];
        state.jobScheduler = data.scheduler || null;
        renderJobPanel();
        log('Jobs 已读取: ' + state.jobs.length);
      } catch (err) {
        state.jobs = [];
        renderJobPanel();
        log('读取 Jobs 失败: ' + err.message);
      }
    }

    async function createScheduledJob() {
      const activeMission = state.activeMission || null;
      const payload = {
        title: $('jobTitleInput').value.trim() || 'HanaAgent scheduled job',
        type: $('jobTypeSelect').value || 'autopilot-tick',
        schedule: $('jobScheduleInput').value.trim() || 'manual',
        mode: $('jobModeSelect').value || 'preview',
        agentId: resolveConductorAgentId() || '',
        missionId: activeMission ? activeMission.id : '',
        prompt: $('jobPromptInput').value.trim(),
        payload: {
          sessionPath: $('sessionSelect').value || '',
          maxMissionsPerTick: $('workerCountSelect').value || 5
        }
      };
      try {
        const data = await requestJson(urls.jobs, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        state.jobs = [data.job, ...state.jobs.filter((job) => job.id !== data.job.id)];
        renderJobPanel();
        log('Job 已创建: ' + data.job.title);
      } catch (err) {
        log('创建 Job 失败: ' + err.message);
      }
    }

    async function triggerJob(jobId) {
      try {
        const data = await requestJson(jobActionUrl(jobId, 'trigger'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: true })
        });
        if (data.job) state.jobs = state.jobs.map((job) => job.id === data.job.id ? data.job : job);
        state.jobOutput = { jobId, latest: data.run || null };
        renderJobPanel();
        await loadAgentOutputs();
        log('Job 已触发: ' + jobId);
      } catch (err) {
        log('触发 Job 失败: ' + err.message);
      }
    }

    async function pauseJob(jobId) {
      await updateJobStatus(jobId, 'pause');
    }

    async function resumeJob(jobId) {
      await updateJobStatus(jobId, 'resume');
    }

    async function updateJobStatus(jobId, action) {
      try {
        const data = await requestJson(jobActionUrl(jobId, action), { method: 'POST' });
        if (data.job) state.jobs = state.jobs.map((job) => job.id === data.job.id ? data.job : job);
        renderJobPanel();
        log('Job ' + action + ': ' + jobId);
      } catch (err) {
        log('更新 Job 失败: ' + err.message);
      }
    }

    async function deleteJob(jobId) {
      try {
        await requestJson(jobActionUrl(jobId), { method: 'DELETE' });
        state.jobs = state.jobs.filter((job) => job.id !== jobId);
        renderJobPanel();
        log('Job 已删除: ' + jobId);
      } catch (err) {
        log('删除 Job 失败: ' + err.message);
      }
    }

    async function loadJobOutput(jobId) {
      try {
        const data = await requestJson(jobActionUrl(jobId, 'output'));
        state.jobOutput = data;
        renderJobOutputPanel();
        log('Job 输出已读取: ' + jobId);
      } catch (err) {
        log('读取 Job 输出失败: ' + err.message);
      }
    }

    function applyAutopilotScheduleInputs() {
      const schedule = state.autopilotSchedule || {};
      const loop = state.autopilotLoop || {};
      if ($('autopilotScheduleMode')) $('autopilotScheduleMode').value = schedule.mode || 'preview';
      if ($('autopilotIntervalInput')) $('autopilotIntervalInput').value = String(schedule.intervalMinutes || 15);
      if ($('autopilotLoopIterationsInput')) $('autopilotLoopIterationsInput').value = String(loop.maxIterations || 12);
      if ($('autopilotEscalationInput')) $('autopilotEscalationInput').value = String(loop.escalationThreshold || 3);
    }

    async function addRunRecord(type) {
      const mission = state.activeMission;
      const assignment = getActiveAssignment();
      const output = $('workerOutput').innerText || $('workerOutput').textContent || '';
      const fallbackTitle = type === 'artifact' ? 'Worker artifact' : type === 'approval' ? 'Approval required' : 'Mission learning';
      try {
        const data = await requestJson(urls.runRecords, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type,
            title: fallbackTitle + (assignment ? ': ' + assignment.label : ''),
            summary: firstLine(output).slice(0, 160),
            content: output,
            missionId: mission ? mission.id : '',
            assignmentId: assignment ? assignment.id : '',
            taskId: assignment && assignment.taskId ? assignment.taskId : '',
            sessionPath: $('sessionSelect').value,
            agentId: resolveConductorAgentId(),
            state: type === 'approval' ? 'pending' : undefined,
            requester: assignment ? assignment.label : ''
          })
        });
        state.runRecords.unshift(data.record);
        state.runRecordSummary = null;
        await loadRunRecords();
        await loadAgentOutputs();
        await loadWorkerArtifacts();
        await reloadMissions();
        await loadMissionInbox();
        await loadApprovals();
        if (type === 'learning') await loadRunLearnings();
        log('Run record 已创建: ' + data.record.type);
        notifyWorkbench(type === 'approval' ? 'alert' : type === 'artifact' ? 'complete' : 'chat', 'Run record 已创建', data.record.title || data.record.type);
      } catch (err) {
        log('创建 Run record 失败: ' + err.message);
        notifyWorkbench('failed', 'Run record 创建失败', err.message);
      }
    }

    async function addCategorizedLearning() {
      const category = $('runLearningFilterSelect').value === 'all' ? 'success' : $('runLearningFilterSelect').value;
      const mission = state.activeMission;
      const assignment = getActiveAssignment();
      const output = $('workerOutput').innerText || $('workerOutput').textContent || '';
      const text = window.prompt('输入要沉淀的运行经验', firstLine(output).slice(0, 180));
      if (!text || !text.trim()) return;
      try {
        const data = await requestJson(urls.runRecords, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'learning',
            title: category + ': ' + firstLine(text).slice(0, 80),
            summary: firstLine(text).slice(0, 160),
            content: text,
            missionId: mission ? mission.id : '',
            assignmentId: assignment ? assignment.id : '',
            taskId: assignment && assignment.taskId ? assignment.taskId : '',
            sessionPath: $('sessionSelect').value,
            agentId: resolveConductorAgentId(),
            requester: assignment ? assignment.label : '',
            meta: { category, source: 'run-learnings-panel' }
          })
        });
        state.runRecords.unshift(data.record);
        await loadRunRecords();
        await loadRunLearnings();
        log('分类经验已添加: ' + category);
        notifyWorkbench('complete', 'Run learning 已添加', category);
      } catch (err) {
        log('添加分类经验失败: ' + err.message);
      }
    }

    async function loadRunLearnings() {
      try {
        const missionId = state.activeMission && state.activeMission.id ? state.activeMission.id : '';
        const category = $('runLearningFilterSelect') ? $('runLearningFilterSelect').value : state.runLearningFilter;
        state.runLearningFilter = category || 'all';
        const params = [
          'limit=80',
          missionId ? 'missionId=' + encodeURIComponent(missionId) : '',
          category && category !== 'all' ? 'category=' + encodeURIComponent(category) : ''
        ].filter(Boolean).join('&');
        const url = urls.runLearnings + (urls.runLearnings.includes('?') ? '&' : '?') + params;
        const data = await requestJson(url);
        state.runLearnings = data.learnings || [];
        state.runLearningSummary = data.summary || null;
        renderRunLearningsPanel();
        log('Run learnings 已刷新: ' + String(state.runLearnings.length));
      } catch (err) {
        log('刷新 Run learnings 失败: ' + err.message);
      }
    }

    async function compareSelectedRuns() {
      const runA = $('runCompareASelect').value;
      const runB = $('runCompareBSelect').value;
      if (!runA || !runB) {
        log('请选择 Run A 和 Run B');
        return;
      }
      try {
        const params = new URLSearchParams();
        applyRunCompareParam(params, 'A', runA);
        applyRunCompareParam(params, 'B', runB);
        const url = urls.runCompare + (urls.runCompare.includes('?') ? '&' : '?') + params.toString();
        const data = await requestJson(url);
        state.runCompare = data;
        renderRunComparePanel();
        log('Run compare 已生成: ' + (data.recommendation || 'ok'));
      } catch (err) {
        log('Run compare 失败: ' + err.message);
      }
    }

    function applyRunCompareParam(params, suffix, value) {
      const parts = String(value || '').split(':');
      const kind = parts.shift();
      const id = parts.join(':');
      if (!id) return;
      if (kind === 'mission') params.set('mission' + suffix, id);
      else if (kind === 'record') params.set('run' + suffix, id);
    }

    async function copyRunCompareSummary() {
      if (!state.runCompare || !state.runCompare.ok) {
        await compareSelectedRuns();
      }
      if (!state.runCompare || !state.runCompare.ok) return;
      const text = formatRunCompare(state.runCompare);
      await copyText(text);
      log('Run compare 已复制');
    }

    function formatRunCompare(compare) {
      const lines = [
        '# HanaAgent Run Compare',
        '',
        'Run A: ' + ((compare.runA && (compare.runA.title || compare.runA.id)) || '-'),
        'Run B: ' + ((compare.runB && (compare.runB.title || compare.runB.id)) || '-'),
        '',
        compare.recommendation || '',
        '',
        '## Metrics'
      ];
      for (const metric of compare.metrics || []) {
        lines.push('- ' + (metric.label || metric.id) + ': ' + String(metric.leftLabel ?? metric.left ?? '-') + ' -> ' + String(metric.rightLabel ?? metric.right ?? '-') + ' (' + (metric.deltaLabel || 'same') + ')');
      }
      return lines.join('\\n');
    }

    async function loadAgenda() {
      try {
        const data = await requestJson(urls.agenda);
        state.agenda = data;
        renderAgendaPanel();
        log('Agenda 已刷新: attention ' + String(data.summary?.attention || 0));
      } catch (err) {
        log('Agenda 刷新失败: ' + err.message);
      }
    }

    async function loadCalendar() {
      try {
        const data = await requestJson(calendarUrl());
        state.calendar = data;
        renderCalendarPanel();
        log('Calendar 已刷新: events ' + String((data.events || []).length));
      } catch (err) {
        log('Calendar 刷新失败: ' + err.message);
      }
    }

    async function copyAgendaSummary() {
      if (!state.agenda || !state.agenda.ok) await loadAgenda();
      if (!state.agenda || !state.agenda.ok) return;
      await copyText(formatAgendaSummary(state.agenda));
      log('Agenda 已复制');
    }

    function formatAgendaSummary(agenda) {
      const sections = agenda.sections || {};
      const lines = [
        '# HanaAgent Agenda',
        '',
        '- Attention: ' + String(agenda.summary?.attention || 0),
        '- Active: ' + String(agenda.summary?.active || 0),
        '- Tasks due today: ' + String(agenda.summary?.tasksDueToday || 0),
        '- Upcoming jobs: ' + String(agenda.summary?.upcoming || 0),
        '',
        '## Needs Attention',
        ...((sections.attention || []).map((item) => '- ' + formatAgendaItem(item, 'attention'))),
        '',
        '## Upcoming',
        ...((sections.upcomingJobs || []).map((item) => '- ' + formatAgendaItem(item, 'job')))
      ];
      return lines.join('\\n');
    }

    async function materializeRunArtifact(recordId) {
      if (!recordId) return;
      try {
        const data = await requestJson(runRecordActionUrl(recordId, 'artifact-file'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionPath: $('sessionSelect').value })
        });
        await loadRunRecords();
        await loadAgentOutputs();
        await loadWorkerArtifacts();
        await reloadMissions();
        await loadMissionInbox();
        setWorkerOutputMessage({
          title: 'Artifact file',
          role: 'artifact',
          text: [
          'Artifact file',
          data.file ? data.file.filename : recordId,
          '',
          data.sessionFile && data.sessionFile.ok ? 'SessionFile registered.' : 'SessionFile unavailable: ' + ((data.sessionFile && data.sessionFile.error) || 'not staged'),
          data.contentUrl ? 'Preview URL: ' + data.contentUrl : ''
        ].join('\\n')
        });
        log('Artifact 已文件化: ' + (data.file && data.file.filename ? data.file.filename : recordId));
      } catch (err) {
        log('Artifact 文件化失败: ' + err.message);
      }
    }

    async function previewRunArtifact(record) {
      if (!record || !record.id) return;
      try {
        const data = await requestJson(runRecordActionUrl(record.id, 'artifact-preview'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionPath: $('sessionSelect').value })
        });
        await loadRunRecords();
        await loadAgentOutputs();
        await loadWorkerArtifacts();
        await reloadMissions();
        setWorkerOutputMessage({
          title: 'Artifact preview',
          role: 'artifact',
          text: [
          'Artifact preview',
          data.previewUrl || data.previewId || record.id,
          '',
          data.file ? 'file: ' + data.file.filename : '',
          data.source ? 'source: ' + data.source : ''
        ].filter(Boolean).join('\\n')
        });
        if (data.previewUrl) {
          state.artifactPreview = {
            recordId: record.id,
            title: record.title || data.previewId || 'Artifact Preview',
            previewUrl: data.previewUrl,
            previewId: data.previewId || '',
            expiresAt: data.expiresAt || '',
            source: data.source || ''
          };
          renderArtifactPreviewPanel();
          const panel = $('artifactPreviewPanel');
          if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        log('Artifact 原生预览已注册: ' + (data.previewUrl || data.previewId || record.id));
      } catch (err) {
        log('Artifact 预览失败: ' + err.message);
      }
    }

    async function updateRunRecord(recordId, updates) {
      try {
        await requestJson(appendApiPath(urls.runRecords, encodeURIComponent(recordId)), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates || {})
        });
        await loadRunRecords();
        await loadAgentOutputs();
        await reloadMissions();
        await loadMissionInbox();
        await loadSwarmActivity();
        await loadWorkerArtifacts();
        await loadApprovals();
        log('Run record 已更新');
      } catch (err) {
        log('更新 Run record 失败: ' + err.message);
      }
    }

    async function loadSwarmActivity() {
      try {
        const missionId = state.activeMission && state.activeMission.id ? state.activeMission.id : '';
        const url = urls.swarmActivity + (urls.swarmActivity.includes('?') ? '&' : '?') + 'limit=80' + (missionId ? '&missionId=' + encodeURIComponent(missionId) : '');
        const data = await requestJson(url);
        state.swarmActivity = data.items || [];
        state.swarmActivitySummary = data.summary || null;
        renderSwarmActivityPanel();
        log('Swarm activity 已刷新: ' + String(state.swarmActivity.length));
      } catch (err) {
        log('Swarm activity 刷新失败: ' + err.message);
      }
    }

    async function loadAgentOutputs(filter) {
      if (filter) state.agentOutputFilter = filter;
      try {
        const missionId = state.activeMission && state.activeMission.id ? state.activeMission.id : '';
        const params = [
          'limit=80',
          'filter=' + encodeURIComponent(state.agentOutputFilter || 'all'),
          missionId ? 'missionId=' + encodeURIComponent(missionId) : ''
        ].filter(Boolean).join('&');
        const url = urls.agentOutputs + (urls.agentOutputs.includes('?') ? '&' : '?') + params;
        const data = await requestJson(url);
        state.agentOutputs = data.outputs || [];
        state.agentOutputSummary = data.summary || null;
        state.agentOutputFilters = data.availableFilters || [];
        renderAgentOutputsPanel();
        log('Agent outputs 已刷新: ' + String(state.agentOutputs.length));
      } catch (err) {
        log('Agent outputs 刷新失败: ' + err.message);
      }
    }

    async function loadWorkerArtifacts() {
      try {
        const missionId = state.activeMission && state.activeMission.id ? state.activeMission.id : '';
        const params = [
          'limit=80',
          missionId ? 'missionId=' + encodeURIComponent(missionId) : ''
        ].filter(Boolean).join('&');
        const url = urls.workerArtifacts + (urls.workerArtifacts.includes('?') ? '&' : '?') + params;
        const data = await requestJson(url);
        state.workerArtifacts = data.items || [];
        state.workerArtifactSummary = data.summary || null;
        renderWorkerArtifactsPanel();
        log('Worker artifacts 已刷新: ' + String(state.workerArtifacts.length));
      } catch (err) {
        log('Worker artifacts 刷新失败: ' + err.message);
      }
    }

    async function loadApprovals() {
      try {
        const missionId = state.activeMission && state.activeMission.id ? state.activeMission.id : '';
        const params = [
          'limit=80',
          missionId ? 'missionId=' + encodeURIComponent(missionId) : ''
        ].filter(Boolean).join('&');
        const url = urls.approvals + (urls.approvals.includes('?') ? '&' : '?') + params;
        const data = await requestJson(url);
        state.approvals = data.approvals || [];
        state.pendingApprovals = data.pending || [];
        state.approvalHistory = data.history || [];
        state.approvalSummary = data.summary || null;
        renderApprovalsPanel();
        log('Approvals 已刷新: pending ' + String(state.pendingApprovals.length));
      } catch (err) {
        log('Approvals 刷新失败: ' + err.message);
      }
    }

    async function resolveApproval(approvalId, action) {
      if (!approvalId) return;
      try {
        const data = await requestJson(appendApiPath(urls.approvals, encodeURIComponent(approvalId) + '/' + encodeURIComponent(action)), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resolvedBy: 'hanaagent-workbench' })
        });
        state.pendingApprovals = data.pending || [];
        state.approvalHistory = data.history || [];
        state.approvalSummary = data.summary || null;
        await loadRunRecords();
        await loadMissionInbox();
        await loadApprovals();
        renderApprovalsPanel();
        log('Approval 已' + (action === 'approve' ? '批准' : '拒绝') + ': ' + approvalId);
        notifyWorkbench(action === 'approve' ? 'complete' : 'alert', 'Approval resolved', approvalId);
      } catch (err) {
        log('Approval 处理失败: ' + err.message);
        notifyWorkbench('failed', 'Approval 处理失败', err.message);
      }
    }

    function copySwarmActivitySummary() {
      const items = Array.isArray(state.swarmActivity) ? state.swarmActivity : [];
      const text = items.slice(0, 20).map((item, index) => [
        String(index + 1) + '. ' + (item.workerName || item.workerId || item.agentId || 'swarm') + ' / ' + (item.kind || 'event') + ' / ' + (item.status || '-'),
        item.title || '',
        firstLine(item.text || ''),
        item.at || ''
      ].filter(Boolean).join('\\n')).join('\\n\\n');
      return copyText(text || 'No swarm activity').then(() => log('Swarm activity 已复制'));
    }

    function copyAgentOutputsSummary() {
      const outputs = Array.isArray(state.agentOutputs) ? state.agentOutputs : [];
      const text = outputs.slice(0, 20).map((output, index) => [
        String(index + 1) + '. ' + (output.agentName || output.agentId || 'HanaAgent') + ' / ' + (output.status || 'unknown') + ' / ' + (output.source || 'output'),
        output.jobName || '',
        output.summary || firstLine(output.fullOutput || ''),
        output.at || ''
      ].filter(Boolean).join('\\n')).join('\\n\\n');
      return copyText(text || 'No agent outputs').then(() => log('Agent outputs 已复制'));
    }

    function copyWorkerArtifactsSummary() {
      const items = Array.isArray(state.workerArtifacts) ? state.workerArtifacts : [];
      const text = items.slice(0, 20).map((bucket, index) => String(index + 1) + '. ' + formatWorkerArtifactBucket(bucket)).join('\\n\\n');
      return copyText(text || 'No worker artifacts').then(() => log('Worker artifacts 已复制'));
    }

    function copyApprovalsSummary() {
      const approvals = Array.isArray(state.approvals) ? state.approvals : [];
      const text = approvals.slice(0, 20).map((approval, index) => String(index + 1) + '. ' + formatApprovalText(approval)).join('\\n\\n');
      return copyText(text || 'No approvals').then(() => log('Approvals 已复制'));
    }

    function bindAgentOutputFilters() {
      for (const button of Array.from(document.querySelectorAll('[data-output-filter]'))) {
        button.addEventListener('click', () => loadAgentOutputs(button.getAttribute('data-output-filter') || 'all'));
      }
    }

    function taskActionUrl(taskId, action) {
      const encoded = encodeURIComponent(taskId);
      return appendApiPath(urls.tasks, encoded + (action ? '/' + action : ''));
    }

    function checkpointActionUrl(checkpointId) {
      const encoded = encodeURIComponent(checkpointId);
      return appendApiPath(urls.checkpoints, encoded);
    }

    function missionActionUrl(missionId, suffix) {
      return appendApiPath(urls.missions, encodeURIComponent(missionId) + (suffix ? '/' + suffix : ''));
    }

    function terminalActionUrl(terminalId, suffix) {
      return appendApiPath(urls.terminals, encodeURIComponent(terminalId) + (suffix ? '/' + suffix : ''));
    }

    function hostTaskActionUrl(taskId, suffix) {
      return appendApiPath(urls.hostTasks, encodeURIComponent(taskId) + (suffix ? '/' + suffix : ''));
    }

    function hostCheckpointActionUrl(checkpointId, suffix) {
      return appendApiPath(urls.hostCheckpoints, encodeURIComponent(checkpointId) + (suffix ? '/' + suffix : ''));
    }

    function jobActionUrl(jobId, suffix) {
      return appendApiPath(urls.jobs, encodeURIComponent(jobId) + (suffix ? '/' + suffix : ''));
    }

    function runRecordActionUrl(recordId, suffix) {
      return appendApiPath(urls.runRecords, encodeURIComponent(recordId) + (suffix ? '/' + suffix : ''));
    }

    function appendApiPath(url, suffix) {
      const index = url.indexOf('?');
      const path = index === -1 ? url : url.slice(0, index);
      const query = index === -1 ? '' : url.slice(index);
      return path.replace(/\\/$/, '') + '/' + suffix + query;
    }

    function renderCheckpointTaskOptions() {
      const select = $('checkpointTaskSelect');
      if (!select) return;
      const current = select.value;
      select.innerHTML = '<option value="">不关联任务</option>';
      const activeTasks = state.tasks.filter((item) => (item.column || item.lane) !== 'done');
      for (const task of activeTasks) {
        const option = document.createElement('option');
        option.value = task.id;
        option.textContent = task.title;
        select.appendChild(option);
      }
      select.value = current || (activeTasks[0] ? activeTasks[0].id : '');
    }

    function renderCheckpointInbox() {
      renderCheckpointTaskOptions();
      const root = $('checkpointList');
      if (!root) return;
      root.innerHTML = '';
      const conflicts = Array.isArray(state.checkpointConflicts) ? state.checkpointConflicts : [];
      if (!state.checkpoints.length && !conflicts.length) {
        root.innerHTML = '<div class="empty">暂无 checkpoint</div>';
        return;
      }
      for (const conflict of conflicts.slice(0, 4)) {
        const item = document.createElement('article');
        item.className = 'checkpoint';
        item.innerHTML =
          '<div class="task-row"><span class="status-chip blocked">CONFLICT</span><span class="tag">' + escapeHtml((conflict.states || []).join(' / ')) + '</span></div>' +
          '<b>' + escapeHtml('Checkpoint 冲突：' + (conflict.taskId || conflict.sessionPath || conflict.agentId || conflict.key)) + '</b>' +
          '<p>' + escapeHtml('同一任务/会话有 ' + String((conflict.checkpoints || []).length) + ' 条不同状态汇报，请采纳一条作为当前证据。') + '</p>';
        for (const checkpoint of (conflict.checkpoints || []).slice(0, 4)) {
          const row = document.createElement('div');
          row.className = 'task-row';
          row.innerHTML =
            '<span class="tag">' + escapeHtml(checkpoint.state + ' / ' + formatTaskTime(checkpoint.createdAt)) + '</span>' +
            '<button class="mini accept">采纳</button>';
          row.querySelector('.accept').addEventListener('click', () => resolveCheckpointConflict(checkpoint.id));
          item.appendChild(row);
        }
        root.appendChild(item);
      }
      for (const checkpoint of state.checkpoints.slice(0, 8)) {
        const task = state.tasks.find((item) => item.id === checkpoint.taskId);
        const reminder = checkpointReminderFor(checkpoint.id) || (checkpoint.reminderAt ? checkpoint : null);
        const item = document.createElement('article');
        item.className = 'checkpoint';
        const flags = [
          checkpoint.conflict ? 'conflict' : '',
          checkpoint.accepted ? 'accepted' : '',
          checkpoint.superseded ? 'superseded' : ''
        ].filter(Boolean).join(' / ');
        item.innerHTML =
          '<div class="task-row"><span class="status-chip ' + escapeHtml(checkpoint.columnSuggestion || '') + '">' + escapeHtml(checkpoint.state) + '</span><span class="tag">' + escapeHtml(formatTaskTime(checkpoint.createdAt)) + '</span></div>' +
          (task ? '<b>' + escapeHtml(task.title) + '</b>' : '<b>未关联任务</b>') +
          (checkpoint.result ? '<p>' + escapeHtml(checkpoint.result) + '</p>' : '') +
          (checkpoint.blocker ? '<p>阻塞：' + escapeHtml(checkpoint.blocker) + '</p>' : '') +
          (checkpoint.nextAction ? '<p>下一步：' + escapeHtml(checkpoint.nextAction) + '</p>' : '') +
          (reminder && reminder.reminderAt ? '<p>提醒：' + escapeHtml(formatTaskTime(reminder.reminderAt) + (reminder.reminderNote ? ' / ' + reminder.reminderNote : '')) + '</p>' : '') +
          '<div class="task-row"><span class="tag">' + escapeHtml((checkpoint.columnSuggestion || '-') + (flags ? ' / ' + flags : '')) + '</span>' +
            (checkpoint.conflict ? '<button class="mini accept">采纳</button>' : '') +
            '<button class="mini remind">15 分钟提醒</button>' +
            (reminder && reminder.reminderAt ? '<button class="mini clear-reminder">清除提醒</button>' : '') +
            '<button class="mini danger remove">删除</button></div>';
        const accept = item.querySelector('.accept');
        if (accept) accept.addEventListener('click', () => resolveCheckpointConflict(checkpoint.id));
        item.querySelector('.remind').addEventListener('click', () => setCheckpointReminder(checkpoint.id, 15));
        const clearReminder = item.querySelector('.clear-reminder');
        if (clearReminder) clearReminder.addEventListener('click', () => clearCheckpointReminder(checkpoint.id));
        item.querySelector('.remove').addEventListener('click', async () => {
          try {
            await requestJson(checkpointActionUrl(checkpoint.id), { method: 'DELETE' });
            await reloadCheckpoints();
          } catch (err) {
            log('Checkpoint 删除失败: ' + err.message);
          }
        });
        root.appendChild(item);
      }
    }

    function checkpointReminderFor(checkpointId) {
      return (Array.isArray(state.checkpointReminders) ? state.checkpointReminders : []).find((item) => item.checkpointId === checkpointId || item.id === checkpointId) || null;
    }

    async function setCheckpointReminder(checkpointId, minutes) {
      const checkpoint = state.checkpoints.find((item) => item.id === checkpointId) || {};
      try {
        await requestJson(checkpointActionUrl(checkpointId, 'reminder'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            minutes: minutes || 15,
            note: checkpoint.nextAction || checkpoint.blocker || checkpoint.result || checkpoint.state || 'Checkpoint follow-up'
          })
        });
        await reloadCheckpoints();
        log('Checkpoint reminder 已设置: ' + checkpointId);
        notifyWorkbench('complete', 'Checkpoint reminder 已设置', (minutes || 15) + ' minutes');
      } catch (err) {
        log('Checkpoint reminder 设置失败: ' + err.message);
        notifyWorkbench('failed', 'Checkpoint reminder 设置失败', err.message);
      }
    }

    async function clearCheckpointReminder(checkpointId) {
      try {
        await requestJson(checkpointActionUrl(checkpointId, 'reminder'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'clear' })
        });
        delete state.checkpointReminderNotified[checkpointId];
        await reloadCheckpoints();
        log('Checkpoint reminder 已清除: ' + checkpointId);
      } catch (err) {
        log('Checkpoint reminder 清除失败: ' + err.message);
      }
    }

    async function resolveCheckpointConflict(checkpointId) {
      try {
        const result = await requestJson(checkpointActionUrl(checkpointId, 'resolve'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ applyToTask: true, resolvedBy: 'operator' })
        });
        await reloadCheckpoints();
        await reloadTasks();
        await reloadMissions();
        await loadMissionInbox();
        log('Checkpoint 冲突已采纳: ' + (result.accepted && result.accepted.state ? result.accepted.state : checkpointId));
      } catch (err) {
        log('Checkpoint 冲突处理失败: ' + err.message);
      }
    }

    async function addDraft(lane) {
      const payload = currentPayload();
      if (!payload.mission.trim()) {
        log('请先填写目标');
        return null;
      }
      return createTaskFromPayload(payload, lane);
    }

    async function createMissionFromInput() {
      const payload = currentPayload();
      if (!payload.mission.trim()) {
        log('请先填写 Mission');
        return;
      }
      $('createMissionBtn').disabled = true;
      try {
        const template = state.templates.find((item) => item.id === payload.templateId) || {};
        const result = await requestJson(urls.missions, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            goal: payload.mission,
            title: payload.mission,
            notes: payload.notes,
            mode: payload.mode,
            templateId: payload.templateId,
            templateLabel: template.label || '任务编排',
            sessionPath: payload.sessionPath,
            agentId: resolveConductorAgentId(),
            maxWorkers: $('workerCountSelect').value
          })
        });
        state.activeMission = result.mission;
        await reloadTasks();
        await reloadMissions();
        await loadMissionInbox();
        await loadSwarmActivity();
        log('Mission 已创建: ' + result.mission.title);
        notifyWorkbench('spawned', 'Mission 已创建', result.mission.title);
      } catch (err) {
        log('Mission 创建失败: ' + err.message);
        notifyWorkbench('failed', 'Mission 创建失败', err.message);
      } finally {
        $('createMissionBtn').disabled = false;
      }
    }

    async function dispatchActiveMission() {
      const mission = state.activeMission;
      if (!mission) {
        await createMissionFromInput();
        if (!state.activeMission) return;
      }
      const active = state.activeMission;
      const url = appendApiPath(urls.missions, encodeURIComponent(active.id) + '/dispatch');
      $('dispatchMissionBtn').disabled = true;
      try {
        const result = await requestJson(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionPath: $('sessionSelect').value })
        });
        $('lastDispatchTag').textContent = result.ok ? 'mission live' : 'dispatch degraded';
        await reloadMissions();
        await loadSwarmActivity();
        log('Mission assignments 已投递: ' + (result.sent || []).filter((item) => item.ok).length + '/' + (result.sent || []).length);
        notifyWorkbench(result.ok ? 'spawned' : 'alert', 'Mission 已投递', active.title || active.id);
      } catch (err) {
        $('lastDispatchTag').textContent = '投递失败';
        log('Mission 投递失败: ' + err.message);
        notifyWorkbench('failed', 'Mission 投递失败', err.message);
      } finally {
        $('dispatchMissionBtn').disabled = false;
      }
    }

    async function dispatchAssignment(assignmentId) {
      const mission = state.activeMission;
      if (!mission || !assignmentId) return;
      const url = appendApiPath(urls.missions, encodeURIComponent(mission.id) + '/dispatch');
      try {
        const result = await requestJson(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assignmentId, sessionPath: $('sessionSelect').value })
        });
        state.activeAssignmentId = assignmentId;
        await reloadMissions();
        await reloadTasks();
        await loadMissionInbox();
        await loadSwarmActivity();
        log('Assignment 已投递: ' + assignmentId + ' / ' + (result.ok ? 'ok' : 'degraded'));
        notifyWorkbench(result.ok ? 'chat' : 'alert', 'Assignment 已投递', assignmentId);
      } catch (err) {
        log('Assignment 投递失败: ' + err.message);
        notifyWorkbench('failed', 'Assignment 投递失败', err.message);
      }
    }

    async function broadcastActiveMission() {
      const mission = state.activeMission;
      if (!mission) {
        log('请先创建或选择一个 Mission');
        return;
      }
      const message = ($('notesInput') && $('notesInput').value.trim()) || ($('missionInput') && $('missionInput').value.trim()) || '继续当前 mission，按各自 assignment 更新 checkpoint。';
      const url = appendApiPath(urls.missions, encodeURIComponent(mission.id) + '/broadcast');
      $('broadcastMissionBtn').disabled = true;
      try {
        const result = await requestJson(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message })
        });
        state.activeMission = result.mission || state.activeMission;
        state.missions = [state.activeMission, ...state.missions.filter((item) => item.id !== state.activeMission.id)];
        renderConductor();
        renderMissionTimeline();
        const sentCount = (result.sent || []).filter((item) => item.ok).length;
        log('Mission broadcast 已发送: ' + sentCount + '/' + (result.sent || []).length + ' skipped ' + (result.skipped || []).length);
        notifyWorkbench(result.ok ? 'chat' : 'alert', 'Mission broadcast', String(sentCount) + ' workers');
      } catch (err) {
        log('Mission broadcast 失败: ' + err.message);
        notifyWorkbench('failed', 'Mission broadcast 失败', err.message);
      } finally {
        $('broadcastMissionBtn').disabled = false;
      }
    }

    async function swarmLaunchActiveMission() {
      const mission = state.activeMission;
      if (!mission) {
        await createMissionFromInput();
        if (!state.activeMission) return;
      }
      const active = state.activeMission;
      $('swarmLaunchBtn').disabled = true;
      try {
        const data = await requestJson(missionActionUrl(active.id, 'swarm-launch'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId: resolveConductorAgentId(),
            cwd: $('terminalCwdInput').value.trim(),
            memoryEnabled: true
          })
        });
        if (data.mission) state.activeMission = data.mission;
        await reloadSessions();
        await reloadMissions();
        await reloadTasks();
        $('lastDispatchTag').textContent = data.ok ? 'swarm live' : 'swarm degraded';
        log('Swarm sessions 已启动: ' + (data.launched || []).filter((item) => item.ok).length + '/' + (data.launched || []).length);
      } catch (err) {
        $('lastDispatchTag').textContent = 'swarm 失败';
        log('Swarm 启动失败: ' + err.message);
      } finally {
        $('swarmLaunchBtn').disabled = false;
      }
    }

    async function updateAssignmentState(assignmentId, nextState) {
      const mission = state.activeMission;
      if (!mission || !assignmentId) return;
      const url = appendApiPath(urls.missions, encodeURIComponent(mission.id) + '/assignments/' + encodeURIComponent(assignmentId));
      try {
        await requestJson(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: nextState })
        });
        state.activeAssignmentId = assignmentId;
        await reloadMissions();
        await reloadTasks();
        await loadMissionInbox();
        log('Assignment 状态已更新: ' + nextState);
      } catch (err) {
        log('Assignment 更新失败: ' + err.message);
      }
    }

    async function stopActiveMission() {
      const mission = state.activeMission;
      if (!mission) return;
      try {
        await requestJson(appendApiPath(urls.missions, encodeURIComponent(mission.id) + '/stop'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'operator stop' })
        });
        await reloadMissions();
        await reloadTasks();
        await loadMissionInbox();
        log('Mission 已停止');
        notifyWorkbench('alert', 'Mission 已停止', mission.title || mission.id);
      } catch (err) {
        log('Mission 停止失败: ' + err.message);
        notifyWorkbench('failed', 'Mission 停止失败', err.message);
      }
    }

    async function completeActiveMission() {
      const mission = state.activeMission;
      if (!mission) return;
      try {
        const gateData = await runReviewGate(false);
        if (gateData && gateData.gate && gateData.gate.status === 'fail') {
          log('Review Gate 未通过，已阻止完成。可修复后重试，或使用强制完成。');
          return;
        }
        await requestJson(appendApiPath(urls.missions, encodeURIComponent(mission.id) + '/complete'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        await reloadMissions();
        await reloadTasks();
        await loadMissionInbox();
        log('Mission 已标记完成');
        notifyWorkbench('complete', 'Mission 已完成', mission.title || mission.id);
      } catch (err) {
        log('Mission 完成失败: ' + err.message);
        notifyWorkbench('failed', 'Mission 完成失败', err.message);
      }
    }

    async function forceCompleteActiveMission() {
      const mission = state.activeMission;
      if (!mission) return;
      try {
        const data = await requestJson(appendApiPath(urls.missions, encodeURIComponent(mission.id) + '/complete'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force: true, summary: 'Force completed by operator after Review Gate.' })
        });
        if (data.gate) state.reviewGate = data.gate;
        if (data.reviewGateReport) state.reviewGateReport = data.reviewGateReport;
        renderReviewGatePanel();
        await reloadMissions();
        await reloadTasks();
        await loadMissionInbox();
        log('Mission 已强制完成: ' + ((data.gate && data.gate.status) || 'no gate'));
      } catch (err) {
        log('强制完成失败: ' + err.message);
      }
    }

    async function runReviewGate(record) {
      const mission = state.activeMission;
      if (!mission) {
        log('暂无 mission 可运行门禁');
        return null;
      }
      try {
        const data = await requestJson(missionActionUrl(mission.id, 'review-gate'), {
          method: record ? 'POST' : 'GET',
          headers: record ? { 'Content-Type': 'application/json' } : undefined,
          body: record ? JSON.stringify({ recordedBy: 'hanaagent-workbench' }) : undefined
        });
        state.reviewGate = data.gate || null;
        state.reviewGateReport = data.report || '';
        if (data.mission) state.activeMission = data.mission;
        renderReviewGatePanel();
        renderMissionTimeline();
        await loadMissionInbox();
        log('Review Gate: ' + ((state.reviewGate && state.reviewGate.status) || 'unknown'));
        return data;
      } catch (err) {
        if (err.data && err.data.gate) {
          state.reviewGate = err.data.gate;
          state.reviewGateReport = err.data.report || '';
          renderReviewGatePanel();
        }
        log('Review Gate 失败: ' + err.message);
        return err.data || null;
      }
    }

    async function copyReviewGateReport() {
      if (!state.reviewGateReport) {
        await runReviewGate(false);
      }
      if (!state.reviewGateReport) return;
      try {
        await navigator.clipboard.writeText(state.reviewGateReport);
        log('Review Gate 结论已复制');
      } catch {
        log(state.reviewGateReport);
      }
    }

    async function continueActiveMission() {
      const mission = state.activeMission;
      if (!mission) return;
      const instructions = $('missionInput').value.trim() || $('notesInput').value.trim() || '继续推进当前 mission，优先处理未完成和阻塞的 worker assignment。';
      try {
        const result = await requestJson(missionActionUrl(mission.id, 'continue'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instructions,
            sessionPath: $('sessionSelect').value || mission.sessionPath || '',
            agentId: resolveConductorAgentId() || mission.agentId || '',
            maxWorkers: $('workerCountSelect').value
          })
        });
        state.activeMission = result.mission;
        state.activeAssignmentId = result.mission && result.mission.assignments && result.mission.assignments[0] ? result.mission.assignments[0].id : '';
        $('missionInput').value = '';
        await reloadTasks();
        await reloadMissions();
        await loadMissionInbox();
        log('Continuation mission 已创建' + (result.started ? '并已投递 worker Brief' : '') + ': ' + result.mission.title);
      } catch (err) {
        log('继续 Mission 失败: ' + err.message);
      }
    }

    async function loadMissionReport() {
      const mission = state.activeMission;
      if (!mission) {
        log('暂无 mission 可生成报告');
        return '';
      }
      try {
        const data = await requestJson(missionActionUrl(mission.id, 'report'));
        state.activeReport = data.report || '';
        setWorkerOutputMessage({ title: 'Mission Report', role: 'report', text: state.activeReport || 'No report generated.', meta: mission.id || '' });
        log('Mission report 已生成');
        return state.activeReport;
      } catch (err) {
        log('生成报告失败: ' + err.message);
        return '';
      }
    }

    async function copyMissionReport() {
      const report = state.activeReport || await loadMissionReport();
      if (!report) return;
      try {
        await navigator.clipboard.writeText(report);
        log('Mission report 已复制');
      } catch {
        log(report);
      }
    }

    function downloadMissionReport() {
      const mission = state.activeMission;
      if (!mission) return;
      window.open(missionActionUrl(mission.id, 'export'), '_blank', 'noopener');
      log('Mission report 导出已打开');
    }

    async function recordMissionReportArtifact() {
      const mission = state.activeMission;
      if (!mission) {
        log('暂无 mission 可记录报告产物');
        return;
      }
      const report = state.activeReport || await loadMissionReport();
      if (!report) return;
      const assignment = getActiveAssignment();
      try {
        const data = await requestJson(missionActionUrl(mission.id, 'report-artifact'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            report,
            assignmentId: assignment ? assignment.id : '',
            taskId: assignment && assignment.taskId ? assignment.taskId : '',
            sessionPath: $('sessionSelect') ? $('sessionSelect').value : mission.sessionPath || '',
            agentId: $('agentSelect') ? $('agentSelect').value : mission.agentId || '',
            materialize: true,
            preview: true
          })
        });
        if (data.record) {
          state.runRecords.unshift(data.record);
          state.activeReport = report;
        }
        await loadRunRecords();
        await loadAgentOutputs();
        await loadWorkerArtifacts();
        await reloadMissions();
        await loadMissionInbox();
        await loadSwarmActivity();
        if (data.preview && data.preview.previewUrl) {
          state.artifactPreview = {
            recordId: data.record.id,
            title: data.record.title || 'Mission Report',
            previewUrl: data.preview.previewUrl,
            previewId: data.preview.previewId || '',
            expiresAt: data.preview.expiresAt || '',
            source: data.preview.source || ''
          };
          renderArtifactPreviewPanel();
          const panel = $('artifactPreviewPanel');
          if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        setWorkerOutputMessage({
          title: data.record && data.record.title ? data.record.title : 'Mission Report Artifact',
          role: 'artifact',
          text: [
            report,
            '',
            data.file && data.file.ok && data.file.file ? 'Artifact file: ' + data.file.file.filename : '',
            data.sessionFile && data.sessionFile.ok ? 'SessionFile registered.' : '',
            data.preview && data.preview.previewUrl ? 'Preview URL: ' + data.preview.previewUrl : ''
          ].filter(Boolean).join('\\n'),
          meta: data.record ? data.record.id : mission.id
        });
        log('Mission report 已记录为 Run artifact');
        notifyWorkbench('complete', 'Mission report artifact 已记录', data.record ? data.record.title : mission.title);
      } catch (err) {
        log('记录 Mission report artifact 失败: ' + err.message);
        notifyWorkbench('failed', 'Mission report artifact 记录失败', err.message);
      }
    }

    async function createTaskFromPayload(payload, lane) {
      const template = state.templates.find((item) => item.id === payload.templateId) || {};
      const result = await requestJson(urls.tasks, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          column: lane,
          title: payload.mission.trim(),
          description: payload.notes.trim(),
          sessionPath: payload.sessionPath,
          templateId: payload.templateId,
          mode: payload.mode,
          priority: lane === 'running' ? 'high' : 'medium',
          tags: ['hanaagent'],
          assignee: $('agentSelect').value,
          position: Date.now(),
          createdBy: 'hanaagent-workbench',
          templateLabel: template.label || '任务'
        })
      });
      if (result.task) {
        state.tasks.unshift(result.task);
        renderBoard();
        renderMetrics();
      } else {
        await reloadTasks();
      }
      return result.task || null;
    }

    function formatTaskTime(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' });
    }

    function buildPromptText(payload) {
      const assignment = getActiveAssignment();
      if (state.activeMission && assignment) {
        const contract = state.blueprint && Array.isArray(state.blueprint.checkpointContract)
          ? state.blueprint.checkpointContract
          : [
              'STATE: DONE | BLOCKED | NEEDS_INPUT | HANDOFF | IN_PROGRESS | NEEDS_REVIEW',
              'FILES_CHANGED: exact paths or none',
              'COMMANDS_RUN: exact commands or none',
              'RESULT: concrete result/proof',
              'BLOCKER: blocker or none',
              'NEXT_ACTION: exact recommended next action'
            ];
        return [
          '你是 Hanaco Conductor 指挥台中的 worker。',
          '',
          'Mission: ' + state.activeMission.title,
          'Mission ID: ' + state.activeMission.id,
          '',
          '总体目标：',
          state.activeMission.goal,
          '',
          state.activeMission.notes ? '补充上下文：\\n' + state.activeMission.notes + '\\n' : '',
          '你的角色：' + assignment.label,
          'Assignment ID: ' + assignment.id,
          '',
          '你的任务：',
          assignment.task,
          '',
          'Checkpoint 合约：',
          ...contract
        ].filter(Boolean).join('\\n');
      }
      const template = state.templates.find((item) => item.id === payload.templateId) || {};
      const lines = [
        template.prompt || '',
        '',
        '工作台模式：' + (payload.mode === 'review' ? '复核' : payload.mode === 'plan' ? '计划' : '执行'),
        '',
        '目标：',
        payload.mission || '(未填写)',
        ''
      ];
      if (payload.notes) lines.push('补充上下文：', payload.notes, '');
      const contract = state.blueprint && Array.isArray(state.blueprint.checkpointContract)
        ? state.blueprint.checkpointContract
        : [
            'STATE: DONE | BLOCKED | NEEDS_INPUT | HANDOFF | IN_PROGRESS | NEEDS_REVIEW',
            'FILES_CHANGED: exact paths or none',
            'COMMANDS_RUN: exact commands or none',
            'RESULT: concrete result/proof',
            'BLOCKER: blocker or none',
            'NEXT_ACTION: exact recommended next action'
          ];
      lines.push(
        'Checkpoint 合约：',
        ...contract,
        '',
        '请在回复最后给出：',
        '1. 当前状态',
        '2. 下一步动作',
        '3. 需要用户确认的事项'
      );
      return lines.join('\\n');
    }

    async function copyPrompt() {
      const payload = currentPayload();
      const text = buildPromptText(payload);
      try {
        await copyText(text);
        log('Prompt 已复制');
      } catch {
        log(text);
      }
    }

    async function copyText(text) {
      await navigator.clipboard.writeText(String(text || ''));
    }

    async function saveDefaults() {
      try {
        const data = await requestJson(urls.defaults, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            defaultAgentId: $('agentSelect').value,
            defaultSessionPath: $('sessionSelect').value
          })
        });
        state.config = data.config || state.config;
        renderPinnedPanel();
        renderWorkbenchModes();
        log('默认目标已保存');
      } catch (err) {
        log('保存默认目标失败: ' + err.message);
      }
    }

    async function savePreferencesPatch(patch, successMessage) {
      try {
        const data = await requestJson(urls.defaults, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch)
        });
        state.config = data.config || state.config;
        renderPinnedPanel();
        renderWorkbenchModes();
        renderNotificationSettings();
        renderBoard();
        log(successMessage);
      } catch (err) {
        log('保存偏好失败: ' + err.message);
      }
    }

    function slugModeId(value) {
      return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
    }

    async function saveCurrentWorkbenchMode() {
      const title = $('workbenchModeNameInput').value.trim() || 'Workbench Mode';
      const id = slugModeId($('workbenchModeSelect').value || title) || 'workbench-mode';
      const now = new Date().toISOString();
      const modes = (Array.isArray(state.config.workbenchModes) ? state.config.workbenchModes : []).filter((mode) => mode.id !== id);
      const previous = (state.config.workbenchModes || []).find((mode) => mode.id === id) || {};
      const mode = {
        id,
        title,
        description: previous.description || 'Saved from HanaAgent Workbench',
        settings: currentWorkbenchModeSettings(),
        createdAt: previous.createdAt || now,
        updatedAt: now
      };
      await savePreferencesPatch({ workbenchModes: [mode, ...modes].slice(0, 16), activeWorkbenchModeId: id }, 'Workbench mode 已保存: ' + title);
      $('workbenchModeSelect').value = id;
      $('workbenchModeNameInput').value = title;
      renderWorkbenchModes();
    }

    async function applySelectedWorkbenchMode() {
      const modeId = $('workbenchModeSelect').value || state.config.activeWorkbenchModeId || '';
      const mode = (state.config.workbenchModes || []).find((item) => item.id === modeId);
      if (!mode) {
        log('请先选择 Workbench Mode');
        return;
      }
      const settings = mode.settings || {};
      if ($('agentSelect') && settings.defaultAgentId) $('agentSelect').value = settings.defaultAgentId;
      if ($('sessionSelect') && settings.defaultSessionPath) $('sessionSelect').value = settings.defaultSessionPath;
      if ($('modeSelect') && settings.mode) $('modeSelect').value = settings.mode;
      if ($('workerCountSelect') && settings.workerCount) $('workerCountSelect').value = String(settings.workerCount);
      if ($('agentProfileModelInput') && settings.preferredModel) $('agentProfileModelInput').value = settings.preferredModel;
      if ($('boardViewSelect') && settings.boardViewId) {
        $('boardViewSelect').value = settings.boardViewId;
        applyBoardView();
      }
      if ($('operationProfileSelect') && settings.operationProfileId) $('operationProfileSelect').value = settings.operationProfileId;
      await savePreferencesPatch({
        defaultAgentId: settings.defaultAgentId || $('agentSelect').value || '',
        defaultSessionPath: settings.defaultSessionPath || $('sessionSelect').value || '',
        activeWorkbenchModeId: mode.id
      }, 'Workbench mode 已应用: ' + (mode.title || mode.id));
      renderAgents();
      renderSessions();
      renderSessionDetail();
      renderOperationsPanel();
      renderWorkbenchModes();
    }

    async function renameSelectedWorkbenchMode() {
      const modeId = $('workbenchModeSelect').value || '';
      const title = $('workbenchModeNameInput').value.trim();
      if (!modeId || !title) {
        log('请选择 Mode 并填写新名称');
        return;
      }
      const modes = (state.config.workbenchModes || []).map((mode) => mode.id === modeId ? { ...mode, title, updatedAt: new Date().toISOString() } : mode);
      await savePreferencesPatch({ workbenchModes: modes }, 'Workbench mode 已重命名: ' + title);
      renderWorkbenchModes();
    }

    async function deleteSelectedWorkbenchMode() {
      const modeId = $('workbenchModeSelect').value || '';
      if (!modeId) {
        log('请先选择要删除的 Workbench Mode');
        return;
      }
      if (!window.confirm('删除这个 Workbench Mode？')) return;
      const modes = (state.config.workbenchModes || []).filter((mode) => mode.id !== modeId);
      const patch = { workbenchModes: modes };
      if (state.config.activeWorkbenchModeId === modeId) patch.activeWorkbenchModeId = '';
      await savePreferencesPatch(patch, 'Workbench mode 已删除');
      $('workbenchModeSelect').value = '';
      renderWorkbenchModes();
    }

    async function saveNotificationSettings() {
      const patch = {
        workbenchNotifications: {
          enabled: $('notificationEnabledSelect').value === 'true',
          volume: Number($('notificationVolumeInput').value || 0.28),
          browser: $('notificationBrowserSelect').value === 'true',
          haptics: $('notificationHapticsSelect').value === 'true'
        }
      };
      await savePreferencesPatch(patch, '通知设置已保存');
      renderNotificationSettings();
    }

    function testNotificationSettings() {
      notifyWorkbench('alert', 'HanaAgent 通知测试', 'Web Audio / browser notification / haptics');
      log('通知测试已触发');
    }

    function applyThemePresetSelection() {
      const preset = workbenchThemePresets.find((item) => item.id === ($('workbenchThemePresetSelect') && $('workbenchThemePresetSelect').value)) || workbenchThemePresets[0];
      if ($('workbenchThemeSelect')) $('workbenchThemeSelect').value = preset.mode || 'system';
      if ($('workbenchAccentSelect')) $('workbenchAccentSelect').value = preset.accent || 'blue';
    }

    async function saveWorkbenchSettings() {
      const patch = {
        workbenchSettings: {
          themePreset: $('workbenchThemePresetSelect').value || 'hermes',
          theme: $('workbenchThemeSelect').value || 'system',
          accentColor: $('workbenchAccentSelect').value || 'blue',
          editorFontSize: Number($('editorFontSizeInput').value || 13),
          editorWordWrap: $('editorWordWrapSelect').value === 'true',
          editorMinimap: $('editorMinimapSelect').value === 'true',
          usageThreshold: Number($('usageThresholdInput').value || 80),
          showSystemMetricsFooter: $('systemMetricsFooterSelect').value === 'true',
          mobileChatNavMode: $('mobileNavModeSelect').value || 'dock',
          calendarTimezone: $('calendarTimezoneInput').value || 'local'
        }
      };
      await savePreferencesPatch(patch, '工作台设置已保存');
      renderWorkbenchSettings();
      renderContextUsagePanel();
    }

    async function resetWorkbenchSettings() {
      await savePreferencesPatch({
        workbenchSettings: {
          themePreset: 'hermes',
          theme: 'dark',
          accentColor: 'blue',
          editorFontSize: 13,
          editorWordWrap: true,
          editorMinimap: false,
          usageThreshold: 80,
          showSystemMetricsFooter: false,
          mobileChatNavMode: 'dock',
          calendarTimezone: 'local'
        }
      }, '工作台设置已重置');
      renderWorkbenchSettings();
      renderContextUsagePanel();
    }

    function selectPinnedSession(pinned) {
      if (pinned.agentId) $('agentSelect').value = pinned.agentId;
      if (pinned.sessionPath) $('sessionSelect').value = pinned.sessionPath;
      renderAgents();
      renderSessions();
      renderSessionDetail();
      log('已选择 pinned session: ' + (pinned.title || pinned.sessionPath));
    }

    function setPinnedSessionDefault(pinned) {
      if (!pinned || !pinned.sessionPath) {
        log('Pinned session 缺少路径');
        return;
      }
      if (pinned.agentId) $('agentSelect').value = pinned.agentId;
      $('sessionSelect').value = pinned.sessionPath;
      savePreferencesPatch({
        defaultAgentId: pinned.agentId || $('agentSelect').value || '',
        defaultSessionPath: pinned.sessionPath
      }, 'Pinned session 已设为默认');
    }

    function removePinnedSession(sessionPath) {
      if (!sessionPath) return;
      const pinnedSessions = (Array.isArray(state.config.pinnedSessions) ? state.config.pinnedSessions : [])
        .filter((item) => item.sessionPath !== sessionPath);
      const patch = { pinnedSessions };
      if (state.config.defaultSessionPath === sessionPath) patch.defaultSessionPath = '';
      savePreferencesPatch(patch, 'Pinned session 已移除');
    }

    function movePinnedSession(sessionPath, direction) {
      if (!sessionPath || !direction) return;
      const pinnedSessions = movePinnedItem(
        Array.isArray(state.config.pinnedSessions) ? state.config.pinnedSessions : [],
        (item) => item.sessionPath === sessionPath,
        direction
      );
      savePreferencesPatch({ pinnedSessions }, 'Pinned session 顺序已更新');
    }

    function applyPinnedModel(pinned) {
      if (!pinned || !pinned.model) {
        log('Pinned model 缺少模型 ID');
        return;
      }
      if (pinned.agentId) $('agentSelect').value = pinned.agentId;
      if ($('agentProfileModelInput')) $('agentProfileModelInput').value = pinned.model || '';
      renderAgents();
      log('已应用 pinned model: ' + pinned.model);
    }

    function removePinnedModel(pinned) {
      if (!pinned || !pinned.model) return;
      const pinnedModels = (Array.isArray(state.config.pinnedModels) ? state.config.pinnedModels : [])
        .filter((item) => item.model !== pinned.model || (item.agentId || '') !== (pinned.agentId || ''));
      savePreferencesPatch({ pinnedModels }, 'Pinned model 已移除');
    }

    function movePinnedModel(pinned, direction) {
      if (!pinned || !pinned.model || !direction) return;
      const pinnedModels = movePinnedItem(
        Array.isArray(state.config.pinnedModels) ? state.config.pinnedModels : [],
        (item) => item.model === pinned.model && (item.agentId || '') === (pinned.agentId || ''),
        direction
      );
      savePreferencesPatch({ pinnedModels }, 'Pinned model 顺序已更新');
    }

    function movePinnedItem(items, predicate, direction) {
      const list = [...(Array.isArray(items) ? items : [])];
      const index = list.findIndex(predicate);
      const nextIndex = index + (direction < 0 ? -1 : 1);
      if (index < 0 || nextIndex < 0 || nextIndex >= list.length) return list;
      const [item] = list.splice(index, 1);
      list.splice(nextIndex, 0, item);
      return list;
    }

    function pinCurrentSession() {
      const sessionPath = $('sessionSelect').value;
      if (!sessionPath) {
        log('请先选择会话');
        return;
      }
      const session = state.sessions.find((item) => item.path === sessionPath) || {};
      const pinnedSessions = [
        {
          sessionPath,
          title: session.title || sessionPath.split('/').pop() || 'Pinned session',
          agentId: session.agentId || $('agentSelect').value || '',
          cwd: session.cwd || '',
          pinnedAt: new Date().toISOString()
        },
        ...(Array.isArray(state.config.pinnedSessions) ? state.config.pinnedSessions : []).filter((item) => item.sessionPath !== sessionPath)
      ].slice(0, 12);
      savePreferencesPatch({ pinnedSessions }, 'Pinned session 已保存');
    }

    async function suggestSessionTitle() {
      const sessionPath = $('sessionSelect').value;
      if (!sessionPath) {
        log('请先选择会话');
        return;
      }
      const session = state.sessions.find((item) => item.path === sessionPath) || {};
      try {
        const data = await requestJson(urls.sessionTitle, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionPath,
            agentId: $('agentSelect').value || session.agentId || '',
            currentTitle: session.title || '',
            limit: 80
          })
        });
        state.sessionTitleSuggestion = data;
        renderSessionTitlePanel();
        log('会话标题建议: ' + (data.title || '-'));
      } catch (err) {
        log('生成会话标题失败: ' + err.message);
      }
    }

    async function renameCurrentSessionAlias(initialTitle) {
      const sessionPath = $('sessionSelect').value;
      if (!sessionPath) {
        log('请先选择会话');
        return null;
      }
      const session = state.sessions.find((item) => item.path === sessionPath) || {};
      const fallback = initialTitle || (state.sessionTitleSuggestion && state.sessionTitleSuggestion.title) || session.title || '';
      const title = window.prompt('Session title', fallback);
      if (title === null) return null;
      const cleanTitle = title.trim();
      if (!cleanTitle) {
        log('标题不能为空');
        return null;
      }
      try {
        const data = await requestJson(urls.sessionAliases, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionPath, title: cleanTitle })
        });
        state.config = data.config || state.config;
        state.sessions = state.sessions.map((item) => item.path === sessionPath
          ? { ...item, originalTitle: item.originalTitle || item.title, title: cleanTitle, alias: data.alias || { title: cleanTitle } }
          : item);
        renderSessions();
        $('sessionSelect').value = sessionPath;
        renderSessionDetail();
        renderPinnedPanel();
        log('会话别名已保存: ' + cleanTitle);
        return data.alias || null;
      } catch (err) {
        log('保存会话别名失败: ' + err.message);
        return null;
      }
    }

    async function clearCurrentSessionAlias() {
      const sessionPath = $('sessionSelect').value;
      if (!sessionPath) {
        log('请先选择会话');
        return;
      }
      try {
        const data = await requestJson(urls.sessionAliases, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionPath })
        });
        state.config = data.config || state.config;
        state.sessions = state.sessions.map((item) => {
          if (item.path !== sessionPath) return item;
          const { alias, originalTitle, ...rest } = item;
          return { ...rest, title: originalTitle || rest.title };
        });
        renderSessions();
        $('sessionSelect').value = sessionPath;
        renderSessionDetail();
        renderPinnedPanel();
        log('会话别名已清除');
      } catch (err) {
        log('清除会话别名失败: ' + err.message);
      }
    }

    async function hideCurrentSession() {
      const sessionPath = $('sessionSelect').value;
      if (!sessionPath) {
        log('请先选择会话');
        return;
      }
      const session = state.sessions.find((item) => item.path === sessionPath) || {};
      if (!window.confirm('从 HanaAgent 工作台隐藏这个 session？不会删除 OpenHanako 真实会话文件。')) return;
      try {
        const data = await requestJson(urls.sessionTombstones, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionPath,
            title: sessionDisplayTitle(session),
            agentId: session.agentId || $('agentSelect').value || ''
          })
        });
        state.config = data.config || state.config;
        state.sessions = state.sessions.filter((item) => item.path !== sessionPath);
        $('sessionSelect').value = state.config.defaultSessionPath || '';
        renderSessions();
        renderSessionDetail();
        renderSessionTombstones();
        renderPinnedPanel();
        log('会话已隐藏: ' + sessionPath);
      } catch (err) {
        log('隐藏会话失败: ' + err.message);
      }
    }

    async function forkCurrentSession() {
      const sessionPath = $('sessionSelect').value;
      if (!sessionPath) {
        log('请先选择会话');
        return;
      }
      const session = state.sessions.find((item) => item.path === sessionPath) || {};
      const instructions = window.prompt('Fork instructions', '延续这个会话的目标，先总结状态再继续推进。');
      if (instructions === null) return;
      try {
        const data = await requestJson(urls.sessionFork, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionPath,
            agentId: $('agentSelect').value || session.agentId || '',
            cwd: session.cwd || '',
            model: session.modelId || '',
            title: 'Fork: ' + sessionDisplayTitle(session),
            instructions,
            maxMessages: 24,
            send: true
          })
        });
        if (data.session && data.session.path) {
          state.sessions = [data.session, ...state.sessions.filter((item) => item.path !== data.session.path)];
          $('sessionSelect').value = data.session.path;
          renderSessions();
          $('sessionSelect').value = data.session.path;
          renderSessionDetail();
          state.sessionHistory = [];
          state.toolTrace = data.history ? data.history.toolTrace : state.toolTrace;
          renderSessionHistory();
          renderToolTrace();
          log('Fork 会话已创建并投递上下文: ' + data.session.path);
        } else {
          const prompt = data.forkPrompt && data.forkPrompt.prompt ? data.forkPrompt.prompt : '';
          if (prompt) await copyText(prompt).catch(() => {});
          log('Fork prompt 已生成，请手动创建新会话后发送。');
        }
      } catch (err) {
        const prompt = err.data && err.data.forkPrompt && err.data.forkPrompt.prompt ? err.data.forkPrompt.prompt : '';
        if (prompt) {
          await copyText(prompt).catch(() => {});
          log('Fork 创建失败，prompt 已复制: ' + err.message);
        } else {
          log('Fork 会话失败: ' + err.message);
        }
      }
    }

    async function restoreSessionTombstone(sessionPath) {
      if (!sessionPath) return;
      try {
        const data = await requestJson(urls.sessionTombstones, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionPath })
        });
        state.config = data.config || state.config;
        await reloadSessions();
        renderSessionTombstones();
        log('会话已恢复: ' + sessionPath);
      } catch (err) {
        log('恢复会话失败: ' + err.message);
      }
    }

    async function applySuggestedSessionTitle() {
      const suggestion = state.sessionTitleSuggestion || {};
      const sessionPath = suggestion.sessionPath || $('sessionSelect').value;
      const title = suggestion.title || '';
      if (!sessionPath || !title) {
        log('没有可应用的标题建议');
        return;
      }
      await renameCurrentSessionAlias(title);
      const session = state.sessions.find((item) => item.path === sessionPath) || {};
      const pinnedSessions = [
        {
          sessionPath,
          title,
          agentId: session.agentId || $('agentSelect').value || '',
          cwd: session.cwd || '',
          pinnedAt: new Date().toISOString(),
          titleSource: suggestion.source || 'hanaagent-title-suggestion'
        },
        ...(Array.isArray(state.config.pinnedSessions) ? state.config.pinnedSessions : []).filter((item) => item.sessionPath !== sessionPath)
      ].slice(0, 12);
      savePreferencesPatch({ pinnedSessions }, '标题已用于 Pin 会话');
    }

    function pinCurrentModel() {
      const model = ($('agentProfileModelInput') && $('agentProfileModelInput').value.trim())
        || (state.agentConfig && state.agentConfig.config && state.agentConfig.config.model)
        || '';
      if (!model) {
        log('请先读取或填写模型');
        return;
      }
      const agentId = $('agentSelect').value || '';
      const pinnedModels = [
        {
          model,
          provider: '',
          agentId,
          pinnedAt: new Date().toISOString()
        },
        ...(Array.isArray(state.config.pinnedModels) ? state.config.pinnedModels : []).filter((item) => item.model !== model || item.agentId !== agentId)
      ].slice(0, 12);
      savePreferencesPatch({ pinnedModels }, 'Pinned model 已保存');
    }

    async function suggestModel(options = {}) {
      const payload = currentPayload();
      try {
        const data = await requestJson(urls.modelSuggestions, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            goal: payload.mission,
            notes: payload.notes,
            mode: payload.mode,
            templateId: payload.templateId,
            agentId: resolveConductorAgentId() || '',
            currentModel: $('agentProfileModelInput') ? $('agentProfileModelInput').value.trim() : ''
          })
        });
        state.modelSuggestions = data;
        renderModelSuggestions();
        if (state.modelChooserOpen) renderModelChooser();
        log(data.toast || '模型建议已生成');
        notifyWorkbench('model', '模型建议已生成', data.toast || '');
        if (!options.keepChooserOpen && !state.modelChooserOpen) openModelChooser();
      } catch (err) {
        log('模型建议失败: ' + err.message);
        notifyWorkbench('failed', '模型建议失败', err.message);
        if (state.modelChooserOpen) renderModelChooser();
      }
    }

    async function clearDone() {
      try {
        const result = await requestJson(urls.clearDone, { method: 'POST' });
        await reloadTasks();
        log('已清空完成任务: ' + (result.removed || 0));
      } catch (err) {
        log('清空完成任务失败: ' + err.message);
      }
    }

    async function submitCheckpoint() {
      const text = $('checkpointInput').value;
      if (!text.trim()) {
        log('请先粘贴 checkpoint 合约块');
        return;
      }
      try {
        const result = await requestJson(urls.checkpoints, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            taskId: $('checkpointTaskSelect').value,
            sessionPath: $('sessionSelect').value,
            agentId: resolveConductorAgentId(),
            source: 'manual',
            applyToTask: true
          })
        });
        $('checkpointInput').value = '';
        await reloadCheckpoints();
        await reloadTasks();
        await reloadMissions();
        await loadMissionInbox();
        log('Checkpoint 已记录: ' + result.checkpoint.state + ' -> ' + result.checkpoint.columnSuggestion + (result.checkpoint.conflict ? '（存在冲突，等待采纳）' : ''));
        notifyWorkbench(result.checkpoint.state === 'DONE' ? 'complete' : result.checkpoint.state === 'BLOCKED' ? 'alert' : 'chat', 'Checkpoint 已记录', result.checkpoint.state + ' -> ' + result.checkpoint.columnSuggestion);
      } catch (err) {
        log('Checkpoint 记录失败: ' + err.message);
        notifyWorkbench('failed', 'Checkpoint 记录失败', err.message);
      }
    }

    async function clearCheckpointInbox() {
      try {
        const result = await requestJson(urls.clearCheckpoints, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        state.checkpoints = [];
        renderCheckpointInbox();
        log('已清空 checkpoint: ' + (result.removed || 0));
      } catch (err) {
        log('清空 checkpoint 失败: ' + err.message);
      }
    }

    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[ch]);
    }

    function escapeAttr(value) {
      return String(value || '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[ch]);
    }

    $('refreshBtn').addEventListener('click', loadState);
    if ($('hermesRouteJumpBtn')) {
      $('hermesRouteJumpBtn').addEventListener('click', () => {
        const alias = (window.HANAAGENT && window.HANAAGENT.hermesPageAlias) || {};
        jumpToMobileSection(alias.target || 'mobileSectionControl');
      });
    }
    $('saveDefaultsBtn').addEventListener('click', saveDefaults);
    $('onboardingTourBtn').addEventListener('click', () => openOnboardingTour());
    $('startOnboardingBtn').addEventListener('click', () => openOnboardingTour());
    $('resetOnboardingBtn').addEventListener('click', resetOnboardingTour);
    $('onboardingCloseBtn').addEventListener('click', closeOnboardingTour);
    $('onboardingBackdrop').addEventListener('click', (event) => {
      if (event.target === $('onboardingBackdrop')) closeOnboardingTour();
    });
    $('shortcutHelpBtn').addEventListener('click', openShortcutHelp);
    $('shortcutHelpCloseBtn').addEventListener('click', closeShortcutHelp);
    $('shortcutHelpBackdrop').addEventListener('click', (event) => {
      if (event.target === $('shortcutHelpBackdrop')) closeShortcutHelp();
    });
    $('commandPaletteCloseBtn').addEventListener('click', closeCommandPalette);
    $('commandPaletteBackdrop').addEventListener('click', (event) => {
      if (event.target === $('commandPaletteBackdrop')) closeCommandPalette();
    });
    $('commandPaletteInput').addEventListener('input', handleCommandPaletteInput);
    $('commandPaletteInput').addEventListener('keydown', handleCommandPaletteKeydown);
    $('modelChooserCloseBtn').addEventListener('click', closeModelChooser);
    $('modelChooserBackdrop').addEventListener('click', (event) => {
      if (event.target === $('modelChooserBackdrop')) closeModelChooser();
    });
    $('modelChooserSearchInput').addEventListener('input', handleModelChooserInput);
    $('modelChooserSearchInput').addEventListener('keydown', handleModelChooserKeydown);
    $('modelChooserSourceSelect').addEventListener('change', handleModelChooserSource);
    if ($('mobileTabBar')) {
      $('mobileTabBar').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-target]');
        if (button) jumpToMobileSection(button.dataset.target);
      });
    }
    if ($('mobileSessionsBtn')) $('mobileSessionsBtn').addEventListener('click', openMobileSessionsPanel);
    if ($('mobileSessionsCloseBtn')) $('mobileSessionsCloseBtn').addEventListener('click', closeMobileSessionsPanel);
    if ($('mobileSessionsDrawer')) {
      $('mobileSessionsDrawer').addEventListener('click', (event) => {
        if (event.target === $('mobileSessionsDrawer')) closeMobileSessionsPanel();
      });
    }
    if ($('mobileSearchBtn')) {
      $('mobileSearchBtn').addEventListener('click', () => {
        jumpToMobileSection('mobileSectionControl');
        $('globalSearchInput').focus();
      });
    }
    if ($('mobileSessionSearchInput')) {
      $('mobileSessionSearchInput').addEventListener('input', () => {
        state.sessionSearchQuery = $('mobileSessionSearchInput').value || '';
        if ($('sessionSearchInput')) $('sessionSearchInput').value = state.sessionSearchQuery;
        renderSessions();
      });
    }
    $('connectionRetryBtn').addEventListener('click', loadState);
    $('connectionDoctorBtn').addEventListener('click', () => jumpToMobileSection('setupDoctorPanel'));
    $('refreshProviderSetupBtn').addEventListener('click', () => loadProviderSetup());
    $('openProviderModelChooserBtn').addEventListener('click', () => openModelChooser({ refreshSuggestions: true }));
    $('copyProviderSetupBtn').addEventListener('click', copyProviderSetupSnippet);
    $('reprobeProviderSetupBtn').addEventListener('click', reprobeProviderSetup);
    window.addEventListener('scroll', handleMobileNavScroll, { passive: true });
    let searchTimer = null;
    $('globalSearchInput').addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runGlobalSearch, 160);
    });
    $('globalSearchInput').addEventListener('keydown', handleGlobalSearchKeydown);
    document.addEventListener('keydown', handleGlobalSearchKeydown);
    $('sessionSearchInput').addEventListener('input', () => {
      state.sessionSearchQuery = $('sessionSearchInput').value || '';
      renderSessions();
    });
    $('agentSelect').addEventListener('change', renderWorkbenchModes);
    $('sessionSelect').addEventListener('change', renderWorkbenchModes);
    $('reloadSessionsBtn').addEventListener('click', reloadSessions);
    $('pinSessionBtn').addEventListener('click', pinCurrentSession);
    $('pinModelBtn').addEventListener('click', pinCurrentModel);
    $('exportPinnedSessionsBtn').addEventListener('click', exportPinnedSessions);
    $('workbenchModeSelect').addEventListener('change', renderWorkbenchModes);
    $('saveWorkbenchModeBtn').addEventListener('click', saveCurrentWorkbenchMode);
    $('applyWorkbenchModeBtn').addEventListener('click', applySelectedWorkbenchMode);
    $('renameWorkbenchModeBtn').addEventListener('click', renameSelectedWorkbenchMode);
    $('deleteWorkbenchModeBtn').addEventListener('click', deleteSelectedWorkbenchMode);
    $('saveNotificationsBtn').addEventListener('click', saveNotificationSettings);
    $('testNotificationBtn').addEventListener('click', testNotificationSettings);
    $('saveWorkbenchSettingsBtn').addEventListener('click', saveWorkbenchSettings);
    $('resetWorkbenchSettingsBtn').addEventListener('click', resetWorkbenchSettings);
    for (const id of ['workbenchThemePresetSelect', 'workbenchThemeSelect', 'workbenchAccentSelect', 'editorFontSizeInput', 'editorWordWrapSelect', 'editorMinimapSelect', 'usageThresholdInput', 'systemMetricsFooterSelect', 'mobileNavModeSelect', 'calendarTimezoneInput']) {
      const el = $(id);
      if (el) el.addEventListener('change', () => {
        if (id === 'workbenchThemePresetSelect') applyThemePresetSelection();
        state.config.workbenchSettings = {
          ...workbenchSettings(),
          themePreset: $('workbenchThemePresetSelect').value || 'hermes',
          theme: $('workbenchThemeSelect').value || 'system',
          accentColor: $('workbenchAccentSelect').value || 'blue',
          editorFontSize: Number($('editorFontSizeInput').value || 13),
          editorWordWrap: $('editorWordWrapSelect').value === 'true',
          editorMinimap: $('editorMinimapSelect').value === 'true',
          usageThreshold: Number($('usageThresholdInput').value || 80),
          showSystemMetricsFooter: $('systemMetricsFooterSelect').value === 'true',
          mobileChatNavMode: $('mobileNavModeSelect').value || 'dock',
          calendarTimezone: $('calendarTimezoneInput').value || 'local'
        };
        renderWorkbenchSettings();
        renderContextUsagePanel();
      });
    }
    $('clearDoneBtn').addEventListener('click', clearDone);
    $('createMissionBtn').addEventListener('click', createMissionFromInput);
    $('missionInput').addEventListener('input', updateSlashCommandQuery);
    $('missionInput').addEventListener('keydown', handleSlashCommandKeydown);
    $('modeSelect').addEventListener('change', renderWorkbenchModes);
    $('workerCountSelect').addEventListener('change', renderWorkbenchModes);
    $('voiceInputBtn').addEventListener('click', toggleVoiceInput);
    $('attachMissionFilesBtn').addEventListener('click', chooseMissionAttachments);
    $('clearMissionAttachmentsBtn').addEventListener('click', clearMissionAttachments);
    $('missionAttachmentInput').addEventListener('change', readMissionAttachmentsFromInput);
    $('dispatchMissionBtn').addEventListener('click', dispatchActiveMission);
    $('broadcastMissionBtn').addEventListener('click', broadcastActiveMission);
    $('swarmLaunchBtn').addEventListener('click', swarmLaunchActiveMission);
    if ($('loadWorkflowTemplatesBtn')) $('loadWorkflowTemplatesBtn').addEventListener('click', loadWorkflowTemplates);
    if ($('previewWorkflowBtn')) $('previewWorkflowBtn').addEventListener('click', previewWorkflow);
    if ($('executeWorkflowBtn')) $('executeWorkflowBtn').addEventListener('click', executeWorkflowAsMission);
    $('stopMissionBtn').addEventListener('click', stopActiveMission);
    $('completeMissionBtn').addEventListener('click', completeActiveMission);
    $('continueMissionBtn').addEventListener('click', continueActiveMission);
    $('draftBtn').addEventListener('click', () => addDraft('backlog').catch((err) => log('任务创建失败: ' + err.message)));
    $('copyPromptBtn').addEventListener('click', copyPrompt);
    $('taskSearchInput').addEventListener('input', updateTaskFilters);
    $('taskAssigneeFilter').addEventListener('change', updateTaskFilters);
    $('taskPriorityFilter').addEventListener('change', updateTaskFilters);
    $('clearTaskFiltersBtn').addEventListener('click', clearTaskFilters);
    $('boardViewSelect').addEventListener('change', applyBoardView);
    $('saveBoardViewBtn').addEventListener('click', saveBoardView);
    $('deleteBoardViewBtn').addEventListener('click', deleteBoardView);
    $('editWipLimitsBtn').addEventListener('click', toggleWipLimitEditor);
    $('selectVisibleTasksBtn').addEventListener('click', selectVisibleTasks);
    $('clearSelectedTasksBtn').addEventListener('click', clearSelectedTasks);
    $('bulkMoveLaneSelect').addEventListener('change', bulkMoveTasks);
    $('bulkPrioritySelect').addEventListener('change', bulkUpdatePriority);
    $('bulkDeleteTasksBtn').addEventListener('click', bulkDeleteTasks);
    $('taskEditorCloseBtn').addEventListener('click', closeTaskEditor);
    $('taskEditorSaveBtn').addEventListener('click', saveTaskEditor);
    $('taskEditorDuplicateBtn').addEventListener('click', duplicateTaskEditor);
    $('taskEditorDeleteBtn').addEventListener('click', deleteTaskEditor);
    $('taskEditorBackdrop').addEventListener('click', (event) => {
      if (event.target === $('taskEditorBackdrop')) closeTaskEditor();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && $('taskEditorBackdrop').classList.contains('open')) closeTaskEditor();
    });
    document.addEventListener('keydown', handleBoardKeyboard);
    $('loadReportBtn').addEventListener('click', loadMissionReport);
    $('copyReportBtn').addEventListener('click', copyMissionReport);
    $('downloadReportBtn').addEventListener('click', downloadMissionReport);
    $('recordReportArtifactBtn').addEventListener('click', recordMissionReportArtifact);
    $('buildResearchCardBtn').addEventListener('click', buildResearchCard);
    $('refreshResearchCardBtn').addEventListener('click', buildResearchCard);
    $('copyResearchCardBtn').addEventListener('click', copyResearchCard);
    $('saveResearchMemoryBtn').addEventListener('click', saveResearchCardToMemory);
    $('recordResearchArtifactBtn').addEventListener('click', recordResearchCardArtifact);
    $('workerOutput').addEventListener('scroll', updateWorkerOutputScrollButton, { passive: true });
    $('workerOutputScrollBtn').addEventListener('click', scrollWorkerOutputToBottom);
    $('terminalStartBtn').addEventListener('click', startSessionTerminal);
    $('terminalRefreshBtn').addEventListener('click', readSessionTerminal);
    $('terminalAutoBtn').addEventListener('click', toggleTerminalAutoRead);
    $('terminalSendBtn').addEventListener('click', () => writeSessionTerminal());
    $('terminalCloseBtn').addEventListener('click', closeSessionTerminal);
    $('terminalPwdBtn').addEventListener('click', () => queueTerminalCommand('pwd'));
    $('terminalLsBtn').addEventListener('click', () => queueTerminalCommand('ls'));
    $('terminalGitStatusBtn').addEventListener('click', () => queueTerminalCommand('git status --short'));
    $('terminalClearBtn').addEventListener('click', clearTerminalOutput);
    $('terminalCopyBtn').addEventListener('click', copyTerminalOutput);
    $('loadWorkspaceRootsBtn').addEventListener('click', loadWorkspaceRoots);
    $('loadWorkspaceFilesBtn').addEventListener('click', loadWorkspaceFiles);
    $('uploadWorkspaceFileBtn').addEventListener('click', chooseWorkspaceUpload);
    $('workspaceUploadInput').addEventListener('change', uploadWorkspaceFileFromInput);
    $('newWorkspaceFileBtn').addEventListener('click', newWorkspaceFile);
    $('mkdirWorkspaceBtn').addEventListener('click', mkdirWorkspacePath);
    $('renameWorkspaceBtn').addEventListener('click', renameWorkspacePath);
    $('deleteWorkspaceBtn').addEventListener('click', deleteWorkspacePath);
    $('diffWorkspaceFileBtn').addEventListener('click', diffWorkspaceFile);
    $('createPatchReviewBtn').addEventListener('click', createWorkspacePatchReview);
    $('acceptPatchReviewBtn').addEventListener('click', acceptWorkspacePatchReview);
    $('rejectPatchReviewBtn').addEventListener('click', rejectWorkspacePatchReview);
    $('downloadWorkspaceFileBtn').addEventListener('click', downloadWorkspaceFile);
    $('saveWorkspaceFileBtn').addEventListener('click', saveWorkspaceFile);
    $('loadAgentConfigBtn').addEventListener('click', loadAgentConfig);
    $('suggestModelBtn').addEventListener('click', () => openModelChooser({ refreshSuggestions: true }));
    $('openModelChooserBtn').addEventListener('click', () => openModelChooser());
    $('saveAgentProfileBtn').addEventListener('click', saveAgentProfile);
    $('loadAgentSkillsBtn').addEventListener('click', loadAgentSkills);
    $('loadIntegrationsBtn').addEventListener('click', loadIntegrations);
    $('integrationSearchInput').addEventListener('input', renderIntegrationCatalogPanel);
    $('integrationKindSelect').addEventListener('change', renderIntegrationCatalogPanel);
    $('loadUsageBtn').addEventListener('click', loadUsage);
    $('loadHostCheckpointsBtn').addEventListener('click', loadHostCheckpoints);
    $('memoryTabMemoryBtn').addEventListener('click', () => setMemoryTab('memory'));
    $('memoryTabKnowledgeBtn').addEventListener('click', () => setMemoryTab('knowledge'));
    $('loadMemoryBtn').addEventListener('click', loadMemoryEntries);
    $('searchMemoryBtn').addEventListener('click', () => state.memoryTab === 'knowledge' ? searchKnowledgePages() : loadMemoryEntries());
    $('saveMemoryBtn').addEventListener('click', saveMemoryEntry);
    $('deleteMemoryBtn').addEventListener('click', deleteMemoryEntry);
    $('loadKnowledgeBtn').addEventListener('click', loadKnowledgePages);
    $('graphKnowledgeBtn').addEventListener('click', loadKnowledgeGraph);
    $('addArtifactBtn').addEventListener('click', () => addRunRecord('artifact'));
    $('addApprovalBtn').addEventListener('click', () => addRunRecord('approval'));
    $('addLearningBtn').addEventListener('click', () => addRunRecord('learning'));
    $('loadRunRecordsBtn').addEventListener('click', loadRunRecords);
    $('loadRunLearningsBtn').addEventListener('click', loadRunLearnings);
    $('runLearningFilterSelect').addEventListener('change', loadRunLearnings);
    $('addCategorizedLearningBtn').addEventListener('click', addCategorizedLearning);
    $('compareRunsBtn').addEventListener('click', compareSelectedRuns);
    $('copyRunCompareBtn').addEventListener('click', copyRunCompareSummary);
    $('loadAgentOutputsBtn').addEventListener('click', () => loadAgentOutputs());
    $('copyAgentOutputsBtn').addEventListener('click', copyAgentOutputsSummary);
    bindAgentOutputFilters();
    $('loadSwarmActivityBtn').addEventListener('click', loadSwarmActivity);
    $('copySwarmActivityBtn').addEventListener('click', copySwarmActivitySummary);
    $('loadWorkerArtifactsBtn').addEventListener('click', loadWorkerArtifacts);
    $('copyWorkerArtifactsBtn').addEventListener('click', copyWorkerArtifactsSummary);
    $('loadApprovalsBtn').addEventListener('click', loadApprovals);
    $('copyApprovalsBtn').addEventListener('click', copyApprovalsSummary);
    $('loadAgendaBtn').addEventListener('click', loadAgenda);
    $('loadCalendarBtn').addEventListener('click', loadCalendar);
    $('copyAgendaBtn').addEventListener('click', copyAgendaSummary);
    $('calendarModeSelect').addEventListener('change', (event) => setCalendarMode(event.target.value));
    $('calendarPrevBtn').addEventListener('click', () => shiftCalendar(-1));
    $('calendarTodayBtn').addEventListener('click', resetCalendarToday);
    $('calendarNextBtn').addEventListener('click', () => shiftCalendar(1));
    $('loadMissionInboxBtn').addEventListener('click', loadMissionInbox);
    $('copyMissionInboxBtn').addEventListener('click', copyMissionInboxSummary);
    $('autopilotPreviewBtn').addEventListener('click', () => runAutopilot('preview'));
    $('autopilotRunBtn').addEventListener('click', () => runAutopilot('run'));
    $('autopilotTickBtn').addEventListener('click', runAutopilotTickNow);
    $('loadAutopilotBtn').addEventListener('click', loadAutopilotRuns);
    $('startAutopilotLoopBtn').addEventListener('click', () => controlAutopilotLoop('start'));
    $('pauseAutopilotLoopBtn').addEventListener('click', () => controlAutopilotLoop('pause'));
    $('resumeAutopilotLoopBtn').addEventListener('click', () => controlAutopilotLoop('resume'));
    $('stopAutopilotLoopBtn').addEventListener('click', () => controlAutopilotLoop('stop'));
    $('loadAutopilotScheduleBtn').addEventListener('click', loadAutopilotSchedule);
    $('enableAutopilotScheduleBtn').addEventListener('click', () => saveAutopilotSchedule(true));
    $('disableAutopilotScheduleBtn').addEventListener('click', () => saveAutopilotSchedule(false));
    $('createJobBtn').addEventListener('click', createScheduledJob);
    $('loadJobsBtn').addEventListener('click', loadJobs);
    $('loadOperationsBtn').addEventListener('click', loadOperations);
    $('saveOperationProfileBtn').addEventListener('click', saveOperationProfile);
    $('exportOperationProfileBtn').addEventListener('click', exportOperationProfile);
    $('exportSwarmRosterJsonBtn').addEventListener('click', () => exportSwarmRoster('json'));
    $('exportSwarmRosterYamlBtn').addEventListener('click', () => exportSwarmRoster('yaml'));
    $('importOperationProfileBtn').addEventListener('click', importOperationProfile);
    $('importSwarmRosterBtn').addEventListener('click', importSwarmRoster);
    $('applyOperationPresetBtn').addEventListener('click', applyOperationPreset);
    $('applyOperationProfileBtn').addEventListener('click', applyOperationProfile);
    $('deleteOperationProfileBtn').addEventListener('click', deleteOperationProfile);
    $('operationPresetSelect').addEventListener('change', renderOperationsPanel);
    $('operationProfileSelect').addEventListener('change', renderOperationsPanel);
    $('reviewGateBtn').addEventListener('click', () => runReviewGate(false));
    $('recordReviewGateBtn').addEventListener('click', () => runReviewGate(true));
    $('copyReviewGateBtn').addEventListener('click', copyReviewGateReport);
    $('forceCompleteMissionBtn').addEventListener('click', forceCompleteActiveMission);
    $('createSessionBtn').addEventListener('click', createWorkerSession);
    $('loadSessionStatusBtn').addEventListener('click', loadSessionStatus);
    $('revertSessionTurnBtn').addEventListener('click', revertCurrentSessionTurn);
    $('loadHostTasksBtn').addEventListener('click', loadHostTasks);
    $('registerHostTaskBtn').addEventListener('click', registerHostTask);
    $('loadDeferredTasksBtn').addEventListener('click', loadDeferredTasks);
    $('terminalCommandInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        writeSessionTerminal();
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        recallTerminalCommand(-1);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        recallTerminalCommand(1);
      }
    });
    $('loadHistoryBtn').addEventListener('click', loadSessionHistory);
    $('loadContextUsageBtn').addEventListener('click', loadContextUsage);
    $('exportSessionMarkdownBtn').addEventListener('click', () => exportSession('markdown'));
    $('exportSessionJsonBtn').addEventListener('click', () => exportSession('json'));
    $('exportSessionTextBtn').addEventListener('click', () => exportSession('text'));
    $('exportSessionHtmlBtn').addEventListener('click', () => exportSession('html'));
    $('exportSessionCsvBtn').addEventListener('click', () => exportSession('csv'));
    $('exportSessionZipBtn').addEventListener('click', () => exportSession('zip'));
    $('suggestSessionTitleBtn').addEventListener('click', suggestSessionTitle);
    $('renameSessionAliasBtn').addEventListener('click', () => renameCurrentSessionAlias());
    $('clearSessionAliasBtn').addEventListener('click', clearCurrentSessionAlias);
    $('forkSessionBtn').addEventListener('click', forkCurrentSession);
    $('hideSessionBtn').addEventListener('click', hideCurrentSession);
    $('connectEventsBtn').addEventListener('click', connectSessionEvents);
    $('disconnectEventsBtn').addEventListener('click', disconnectSessionEvents);
    $('copyToolTraceBtn').addEventListener('click', copyToolTrace);
    $('clearLiveTraceBtn').addEventListener('click', () => {
      state.liveTrace = [];
      renderToolTrace();
      renderInspectorPanel();
      log('实时 Tool Trace 已清空');
    });
    $('syncHistoryBtn').addEventListener('click', syncHistoryCheckpoints);
    $('abortSessionBtn').addEventListener('click', abortCurrentSession);
    $('checkpointBtn').addEventListener('click', submitCheckpoint);
    $('clearCheckpointsBtn').addEventListener('click', clearCheckpointInbox);
    $('agentSelect').addEventListener('change', () => {
      renderAgents();
      reloadSessions();
    });
    $('sessionSelect').addEventListener('change', () => {
      disconnectSessionEvents();
      stopTerminalAutoRead();
      state.terminal = null;
      state.terminalSeq = 0;
      state.terminalOutput = '';
      state.terminalLastReadAt = '';
      state.contextUsage = null;
      state.sessionTitleSuggestion = null;
      state.researchCard = null;
      state.liveTextBuffer = '';
      state.liveDisplayBuffer = '';
      stopSmoothLiveStream();
      renderTerminal();
      renderSessionDetail();
      renderContextUsagePanel();
      renderSessionTitlePanel();
      renderMobileHeader();
      renderMobileSessionsPanel();
      renderInspectorPanel();
      renderResearchCard();
    });

    renderAll();
    renderMissionAttachments();
    setVoiceInputStatus(getSpeechRecognitionCtor() ? 'voice ready' : 'voice unsupported', false);
    loadState();
  </script>
</body>
</html>`;
}

export function registerHermesPageAliases(app, ctx, options = {}) {
  for (const alias of HERMES_PAGE_ALIASES) {
    const isFallback = alias.path === "/*";
    if (options.fallbackOnly && !isFallback) continue;
    if (!options.includeFallback && isFallback) continue;
    app.get(alias.path, async (c) => {
      if (isFallback && c.req.path.startsWith("/api/")) return c.notFound();
      return c.html(await renderWorkbench(c, ctx, buildHermesPageAlias(c, alias)));
    });
  }
}
