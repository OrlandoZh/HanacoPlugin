import fs from "node:fs";
import path from "node:path";

export function buildWorkerIdeSnapshot(input = {}) {
  const worker = input.worker || {};
  const agent = input.agent || null;
  const assignment = input.assignment || worker.activeAssignment || null;
  const sessions = Array.isArray(input.sessions) ? input.sessions : [];
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const checkpoints = Array.isArray(input.checkpoints) ? input.checkpoints : [];
  const runRecords = Array.isArray(input.runRecords) ? input.runRecords : [];
  const handoffs = Array.isArray(input.handoffs) ? input.handoffs : [];
  const hostTasks = Array.isArray(input.hostTasks) ? input.hostTasks : [];
  const deferredTasks = Array.isArray(input.deferredTasks) ? input.deferredTasks : [];
  const usage = input.usage || { entries: [], summary: {} };
  const lifecycle = input.lifecycle && typeof input.lifecycle === "object" ? input.lifecycle : null;
  const workspaceRoots = Array.isArray(input.workspaceRoots) ? input.workspaceRoots : [];
  const terminalAvailable = input.terminalAvailable === true;
  const sessionPath = clean(assignment?.sessionPath) || clean(worker.sessions?.[0]?.path) || clean(sessions[0]?.path);
  const agentId = clean(agent?.id) || clean(worker.agentId) || clean(assignment?.agentId);
  const previews = buildPreviewHints({ worker, assignment, sessions, tasks, checkpoints, runRecords, hostTasks, deferredTasks });

  return {
    ok: true,
    id: clean(worker.id) || clean(assignment?.id) || agentId || "worker",
    title: clean(worker.name) || clean(assignment?.label) || clean(agent?.name) || "工作器（Worker）",
    status: deriveStatus({ worker, assignment, checkpoints, tasks }),
    health: buildHealth({ assignment, checkpoints, tasks, hostTasks, deferredTasks }),
    identity: {
      agentId,
      agentName: clean(agent?.name),
      role: clean(assignment?.label || assignment?.roleId),
      lane: clean(assignment?.lane),
      sessionPath,
      cwd: clean(assignment?.cwd)
    },
    taskQueue: buildTaskQueue(tasks, assignment),
    chat: buildChatPreview(sessions, checkpoints),
    previews,
    terminal: {
      available: terminalAvailable,
      sessionPath,
      attachHint: terminalAvailable && sessionPath ? `terminal:start ${sessionPath}` : "",
      hostTasks: hostTasks.slice(0, 5)
    },
    files: buildFileHints({ assignment, runRecords, workspaceRoots }),
    artifacts: runRecords.filter((record) => record.type === "artifact").slice(0, 8),
    approvals: runRecords.filter((record) => record.type === "approval").slice(0, 8),
    usage: usage.summary || {},
    lifecycle,
    quickActions: buildQuickActions({ sessionPath, assignment, terminalAvailable, workspaceRoots, previews, lifecycle }),
    evidence: {
      checkpoints: checkpoints.slice(0, 8),
      handoffs: handoffs.slice(0, 8),
      hostTasks: hostTasks.slice(0, 8),
      deferredTasks: deferredTasks.slice(0, 8)
    },
    generatedAt: new Date().toISOString()
  };
}

function buildHealth({ assignment, checkpoints, tasks, hostTasks, deferredTasks }) {
  const latest = checkpoints[0] || null;
  const blockers = [
    ...(assignment?.blocker ? [assignment.blocker] : []),
    ...checkpoints.filter((item) => ["BLOCKED", "NEEDS_INPUT"].includes(clean(item.state).toUpperCase())).map((item) => item.blocker || item.result || item.rawText),
    ...tasks.filter((task) => clean(task.column) === "blocked").map((task) => task.title)
  ].filter(Boolean);
  const pendingApprovals = hostTasks.filter((task) => clean(task.status) === "pending_approval").length;
  const pendingDeferred = deferredTasks.filter((task) => !["done", "complete", "failed", "cancelled"].includes(clean(task.status))).length;
  const stale = latest ? ageMinutes(latest.createdAt || latest.updatedAt) > 60 : false;
  const state = blockers.length ? "blocked" : pendingApprovals ? "needs-approval" : stale ? "stale" : clean(assignment?.state) || clean(latest?.state).toLowerCase() || "idle";
  return {
    state,
    blockers: blockers.slice(0, 5),
    pendingApprovals,
    pendingDeferred,
    stale,
    latestCheckpointAt: latest?.createdAt || latest?.updatedAt || ""
  };
}

function buildTaskQueue(tasks, assignment) {
  const currentId = clean(assignment?.taskId);
  const current = tasks.find((task) => task.id === currentId || task.assignmentId === assignment?.id) || null;
  const queue = tasks
    .filter((task) => task !== current)
    .filter((task) => !["done", "cancelled"].includes(clean(task.column || task.lane)))
    .slice(0, 6);
  const done = tasks.filter((task) => ["done", "cancelled"].includes(clean(task.column || task.lane))).length;
  return {
    current,
    next: queue,
    done,
    total: tasks.length
  };
}

function buildChatPreview(sessions, checkpoints) {
  return {
    sessions: sessions.slice(0, 5).map((session) => ({
      path: session.path,
      title: session.title || session.firstMessage || session.path,
      agentId: session.agentId || "",
      messageCount: Number(session.messageCount || 0) || 0,
      updatedAt: session.updatedAt || session.mtime || ""
    })),
    latestCheckpoint: checkpoints[0] || null,
    transcriptHint: sessions[0]?.path ? `session:history ${sessions[0].path}` : ""
  };
}

function buildFileHints({ assignment, runRecords, workspaceRoots }) {
  const paths = new Set();
  const changedPaths = new Set();
  if (assignment?.cwd) paths.add(assignment.cwd);
  for (const file of normalizeChangedFiles(assignment?.filesChanged || assignment?.files || assignment?.changedFiles)) {
    paths.add(file.path);
    changedPaths.add(file.path);
  }
  for (const record of runRecords) {
    if (record.path) paths.add(record.path);
    if (record.meta?.filename) paths.add(record.meta.filename);
    for (const file of normalizeChangedFiles(record.filesChanged || record.files || record.meta?.filesChanged || record.meta?.files)) {
      paths.add(file.path);
      changedPaths.add(file.path);
    }
    if (record.type === "artifact" && record.path) changedPaths.add(record.path);
    if (record.type === "artifact" && record.meta?.filename) changedPaths.add(record.meta.filename);
  }
  const changedFiles = [...changedPaths]
    .filter((item) => looksLikeFilePath(item))
    .map((item) => buildWorkspaceFileTarget(item, workspaceRoots))
    .filter(Boolean)
    .slice(0, 12);
  const primaryRoot = findWorkspaceRoot(assignment?.cwd, workspaceRoots) || workspaceRoots[0] || null;
  const project = buildProjectMetadata({ assignment, primaryRoot, paths: [...paths], changedFiles });
  return {
    workspaceRoots: workspaceRoots.slice(0, 5),
    primaryRoot,
    project,
    paths: [...paths].slice(0, 12),
    changedFiles,
    editorActions: buildEditorActions({ primaryRoot, changedFiles, assignment })
  };
}

function buildProjectMetadata({ assignment, primaryRoot, paths, changedFiles }) {
  const cwd = clean(assignment?.cwd) || clean(primaryRoot?.path);
  const rootPath = clean(primaryRoot?.path);
  const rootLabel = clean(primaryRoot?.label || primaryRoot?.id);
  const packageInfo = readPackageInfo(rootPath);
  const branch = clean(assignment?.branch || assignment?.gitBranch || assignment?.meta?.branch) || readGitBranch(rootPath);
  const projectName = clean(assignment?.projectName || assignment?.project || assignment?.meta?.projectName)
    || packageInfo.name
    || rootLabel
    || path.basename(rootPath || cwd || "");
  return {
    projectName,
    cwd,
    rootId: clean(primaryRoot?.id),
    rootLabel,
    branch,
    packageScripts: packageInfo.scripts,
    packageManager: packageInfo.packageManager,
    changedFiles: changedFiles.map((file) => file.relativePath || file.path).filter(Boolean).slice(0, 12),
    pathHints: (Array.isArray(paths) ? paths : []).slice(0, 12)
  };
}

function readPackageInfo(rootPath) {
  const file = safeJoin(rootPath, "package.json");
  if (!file) return { name: "", scripts: [], packageManager: "" };
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 1024 * 1024) return { name: "", scripts: [], packageManager: "" };
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      name: clean(parsed?.name),
      packageManager: clean(parsed?.packageManager),
      scripts: Object.keys(parsed?.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {}).slice(0, 12)
    };
  } catch {
    return { name: "", scripts: [], packageManager: "" };
  }
}

function readGitBranch(rootPath) {
  const headPath = safeJoin(rootPath, ".git/HEAD");
  if (!headPath) return "";
  try {
    const stat = fs.statSync(headPath);
    if (!stat.isFile() || stat.size > 4096) return "";
    const head = fs.readFileSync(headPath, "utf8").trim();
    const match = head.match(/^ref:\s+refs\/heads\/(.+)$/);
    return clean(match ? match[1] : head.slice(0, 12));
  } catch {
    return "";
  }
}

function safeJoin(rootPath, relativePath) {
  const root = normalizePath(rootPath);
  if (!root) return "";
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(root + "/")) return "";
  return target;
}

function normalizeChangedFiles(value) {
  if (!value) return [];
  const list = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,]/)
      : [];
  return list.map((item) => {
    if (typeof item === "string") return { path: clean(item) };
    if (item && typeof item === "object") return { path: clean(item.path || item.file || item.relativePath), status: clean(item.status || item.state) };
    return null;
  }).filter((item) => item?.path);
}

function buildWorkspaceFileTarget(filePath, workspaceRoots) {
  const root = findWorkspaceRoot(filePath, workspaceRoots);
  if (!root) return { path: filePath, relativePath: filePath, rootId: "", rootLabel: "", openable: false };
  const relativePath = toRelativePath(filePath, root.path);
  return {
    path: filePath,
    relativePath,
    rootId: root.id || root.path || "",
    rootLabel: root.label || root.id || root.path || "",
    openable: Boolean(relativePath)
  };
}

function findWorkspaceRoot(filePath, workspaceRoots) {
  const value = clean(filePath);
  if (!value) return null;
  const roots = Array.isArray(workspaceRoots) ? workspaceRoots : [];
  const normalized = normalizePath(value);
  return roots
    .filter((root) => root?.path)
    .map((root) => ({ ...root, normalizedPath: normalizePath(root.path) }))
    .filter((root) => normalized === root.normalizedPath || normalized.startsWith(root.normalizedPath + "/"))
    .sort((a, b) => b.normalizedPath.length - a.normalizedPath.length)[0] || null;
}

function toRelativePath(filePath, rootPath) {
  const file = normalizePath(filePath);
  const root = normalizePath(rootPath);
  if (!file || !root) return "";
  if (file === root) return ".";
  return file.startsWith(root + "/") ? file.slice(root.length + 1) : filePath;
}

function buildEditorActions({ primaryRoot, changedFiles, assignment }) {
  const firstFile = changedFiles.find((file) => file.openable) || null;
  return [
    {
      id: "open-worker-root",
      label: "打开项目（Open Project）",
      enabled: Boolean(primaryRoot),
      rootId: primaryRoot?.id || "",
      path: assignment?.cwd && primaryRoot ? toRelativePath(assignment.cwd, primaryRoot.path) : ".",
      kind: "directory"
    },
    {
      id: "open-changed-file",
      label: "打开变更文件（Open Changed File）",
      enabled: Boolean(firstFile),
      rootId: firstFile?.rootId || "",
      path: firstFile?.relativePath || "",
      kind: "file"
    },
    {
      id: "diff-changed-file",
      label: "对比变更文件（Diff Changed File）",
      enabled: Boolean(firstFile),
      rootId: firstFile?.rootId || "",
      path: firstFile?.relativePath || "",
      kind: "diff"
    },
    {
      id: "save-changed-file",
      label: "保存文件（Save File）",
      enabled: Boolean(firstFile),
      rootId: firstFile?.rootId || "",
      path: firstFile?.relativePath || "",
      kind: "save"
    }
  ];
}

function looksLikeFilePath(value) {
  const text = clean(value);
  if (!text || /^https?:\/\//i.test(text)) return false;
  if (text === "." || text.endsWith("/")) return false;
  return text.includes("/") || /\.[a-z0-9]{1,8}$/i.test(text);
}

function normalizePath(value) {
  return clean(value).replace(/\\/g, "/").replace(/\/+$/g, "");
}

function buildPreviewHints(input = {}) {
  const candidates = [];
  collectPreviewText(candidates, input.worker);
  collectPreviewText(candidates, input.assignment);
  for (const item of input.sessions || []) collectPreviewText(candidates, item);
  for (const item of input.tasks || []) collectPreviewText(candidates, item);
  for (const item of input.checkpoints || []) collectPreviewText(candidates, item);
  for (const item of input.runRecords || []) collectPreviewText(candidates, item);
  for (const item of input.hostTasks || []) collectPreviewText(candidates, item);
  for (const item of input.deferredTasks || []) collectPreviewText(candidates, item);
  const seen = new Set();
  return candidates
    .flatMap((item) => extractPreviewUrls(item.text).map((url) => ({ url, source: item.source })))
    .filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .slice(0, 8)
    .map((item, index) => ({
      id: `preview-${index + 1}`,
      url: item.url,
      label: previewLabel(item.url),
      source: item.source,
      local: isLocalPreviewUrl(item.url),
      embedAllowed: isEmbeddablePreviewUrl(item.url),
      recommended: index === 0
    }));
}

function collectPreviewText(candidates, value, source = "") {
  if (!value) return;
  if (typeof value === "string") {
    candidates.push({ text: value, source: source || "text" });
    return;
  }
  if (typeof value !== "object") return;
  const label = source || clean(value.id) || clean(value.taskId) || clean(value.title) || clean(value.label) || clean(value.type) || "metadata";
  for (const key of ["url", "previewUrl", "localUrl", "devServerUrl", "href", "description", "summary", "content", "output", "result", "blocker", "nextAction", "rawText", "path"]) {
    if (typeof value[key] === "string") candidates.push({ text: value[key], source: `${label}:${key}` });
  }
  for (const key of ["meta", "payload", "result"]) {
    if (value[key] && typeof value[key] === "object") collectPreviewText(candidates, value[key], `${label}:${key}`);
  }
}

export function extractPreviewUrls(text) {
  const value = String(text || "");
  const matches = value.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[a-z0-9.-]+)(?::\d{2,5})?(?:\/[^\s"'<>)]*)?/gi) || [];
  return matches.map(cleanPreviewUrl).filter(Boolean);
}

function cleanPreviewUrl(url) {
  return clean(url).replace(/[),.;]+$/g, "");
}

function previewLabel(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? ":" + parsed.port : ""}${parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : ""}`;
  } catch {
    return url;
  }
}

function isLocalPreviewUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"].includes(host);
  } catch {
    return false;
  }
}

export function isEmbeddablePreviewUrl(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    if (["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"].includes(host)) return true;
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function buildQuickActions({ sessionPath, assignment, terminalAvailable, workspaceRoots, previews, lifecycle }) {
  return [
    { id: "ensure-session", label: "创建会话（Create Session）", enabled: Boolean(assignment?.id), target: assignment?.id || "" },
    { id: "open-chat", label: "打开对话（Open Chat）", enabled: Boolean(sessionPath), target: sessionPath },
    { id: "sync-history", label: "同步历史（Sync History）", enabled: Boolean(sessionPath), target: sessionPath },
    { id: "request-handoff", label: "请求交接（Request Handoff）", enabled: Boolean(sessionPath && lifecycle?.canRequestHandoff), target: sessionPath },
    { id: "abort-session", label: "中止会话（Abort Session）", enabled: Boolean(sessionPath), target: sessionPath },
    { id: "attach-terminal", label: "附加终端（Attach Terminal）", enabled: Boolean(terminalAvailable && sessionPath), target: sessionPath },
    { id: "open-preview", label: "打开预览（Open Preview）", enabled: Boolean(previews?.[0]?.url), target: previews?.[0]?.url || "" },
    { id: "open-files", label: "打开文件（Open Files）", enabled: workspaceRoots.length > 0, target: assignment?.cwd || "" },
    { id: "mark-done", label: "标记完成（Mark Done）", enabled: Boolean(assignment?.id), target: assignment?.id || "" },
    { id: "mark-blocked", label: "标记阻塞（Mark Blocked）", enabled: Boolean(assignment?.id), target: assignment?.id || "" }
  ];
}

function deriveStatus({ worker, assignment, checkpoints, tasks }) {
  const checkpoint = checkpoints[0];
  if (assignment?.state) return assignment.state;
  if (checkpoint?.state) return checkpoint.state;
  const running = tasks.find((task) => clean(task.column || task.lane) === "running");
  if (running) return "running";
  return clean(worker.status) || "idle";
}

function ageMinutes(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.round((Date.now() - time) / 60000));
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
