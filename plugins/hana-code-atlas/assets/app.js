/**
 * assets/app.js — Hana Code Atlas 控制台
 *
 * 安静的插件工作台式控制页面：项目选择/注册、依赖状态、Architecture/Full
 * 分段切换、构建/取消、状态/错误展示，并内嵌 UA Viewer iframe。
 *
 * 与宿主交互：
 *   - 从 URL 读取 pluginSurfaceSession 并作为 X-Hana-Plugin-Surface-Session header 发送
 *   - 启动后向父窗口发送 Hana ready postMessage
 */

(function () {
  "use strict";

  const boot = window.__CODE_ATLAS__ || {};
  const pluginId = boot.pluginId || "";

  const surfaceSession = new URLSearchParams(location.search).get("pluginSurfaceSession") || "";
  const hostHanaApi = window.hana?.api || null;

  function normalizeApiPath(relative) {
    const clean = String(relative).replace(/^\/+/, "");
    if (!clean || clean.includes("..") || clean.includes("\\")) {
      throw new Error("Invalid plugin API path: " + relative);
    }
    return clean;
  }

  function apiUrl(relative) {
    const clean = normalizeApiPath(relative);
    if (typeof hostHanaApi?.url === "function") return hostHanaApi.url(clean);
    return `${location.origin}/api/plugins/${encodeURIComponent(pluginId)}/${clean}`;
  }

  function apiFetch(relative, init = {}) {
    const clean = normalizeApiPath(relative);
    if (typeof hostHanaApi?.fetch === "function") return hostHanaApi.fetch(clean, init);

    const headers = new Headers(init.headers || {});
    if (surfaceSession) {
      headers.set("X-Hana-Plugin-Surface-Session", surfaceSession);
    }
    return fetch(apiUrl(clean), { ...init, headers });
  }

  async function readJsonResponse(res, label) {
    const text = await res.text();
    const contentType = res.headers.get("content-type") || "unknown content-type";
    if (!text.trim()) {
      throw new Error(`${label}: HTTP ${res.status} 返回空响应`);
    }
    try {
      return JSON.parse(text);
    } catch {
      const preview = text.replace(/\s+/g, " ").trim().slice(0, 160);
      throw new Error(`${label}: HTTP ${res.status} 返回非 JSON（${contentType}）: ${preview}`);
    }
  }

  function responseError(res, data, fallback) {
    if (res.ok) return "";
    const detail = data && typeof data === "object" ? (data.error || data.message) : "";
    return detail || `${fallback}: HTTP ${res.status}`;
  }

  function postReady() {
    const payload = {
      protocol: "hana.plugin.ui",
      version: 1,
      kind: "event",
      type: "hana.ready",
    };
    try {
      window.parent?.postMessage?.(payload, "*");
    } catch (_) {}
  }

  // ─── DOM 初始化 ───────────────────────────────────────────

  const root = document.getElementById("root");
  root.innerHTML = `
    <div class="ca-shell">
      <header class="ca-header">
        <h1>Code Atlas</h1>
        <div class="ca-toolbar">
          <div class="ca-form-group">
            <label for="ca-project-select">项目</label>
            <select id="ca-project-select" class="ca-project-select" aria-label="选择项目"></select>
          </div>
          <button id="ca-refresh" class="ghost" aria-label="刷新状态">刷新</button>
        </div>
      </header>
      <div class="ca-body">
        <div class="ca-status-bar" role="status" aria-live="polite">
          <span id="ca-cbm-status" class="ca-status">cbm: …</span>
          <span id="ca-python-status" class="ca-status">python: …</span>
          <span id="ca-bundle-status" class="ca-status">bundle: …</span>
          <span id="ca-message" class="ca-message"></span>
        </div>
        <div class="ca-viewer-area">
          <aside class="ca-sidebar">
            <div class="ca-panel">
              <h2 class="ca-panel-title">添加项目</h2>
              <div class="ca-register-stack">
                <label class="ca-field-label" for="ca-candidate-search">已索引项目</label>
                <input id="ca-candidate-search" type="search" placeholder="搜索项目名、cbm 标识或路径" autocomplete="off" aria-controls="ca-candidate-table" disabled />
                <div class="ca-index-table-wrap" id="ca-candidate-table" aria-busy="true">
                  <table class="ca-index-table" aria-label="cbm 已索引项目">
                    <thead>
                      <tr><th scope="col">项目</th><th scope="col">规模</th><th scope="col"><span class="ca-visually-hidden">操作</span></th></tr>
                    </thead>
                    <tbody id="ca-candidate-table-body"></tbody>
                  </table>
                  <div id="ca-candidate-empty" class="ca-index-empty" role="status">正在读取 cbm 索引…</div>
                </div>
                <p id="ca-candidate-hint" class="ca-hint">搜索后选择项目；未注册项会填入根目录。</p>
                <div class="ca-divider" aria-hidden="true"><span>或</span></div>
                <label class="ca-field-label" for="ca-register-input">项目根目录绝对路径</label>
                <input id="ca-register-input" type="text" placeholder="/absolute/project/root" autocomplete="off" />
                <button id="ca-register-btn" class="primary">注册项目</button>
              </div>
            </div>
            <div class="ca-panel">
              <h2 class="ca-panel-title">视图分段</h2>
              <div class="ca-bundle-switch" role="group" aria-label="选择图谱分段">
                <button id="ca-bundle-arch" data-bundle="architecture" aria-pressed="false" disabled>Architecture</button>
                <button id="ca-bundle-full" class="active" data-bundle="full" aria-pressed="true">Full</button>
              </div>
              <p id="ca-architecture-hint" class="ca-hint">Architecture 需要先生成并审查语义草稿。</p>
              <div id="ca-build-section" class="ca-build-section">
                <div class="ca-actions">
                  <button id="ca-build-btn" class="primary">构建 Full 图谱</button>
                  <button id="ca-cancel-btn" class="danger" disabled>取消</button>
                </div>
              </div>
            </div>
            <div class="ca-panel">
              <h2 class="ca-panel-title">架构语义</h2>
              <p id="ca-architecture-status" class="ca-architecture-status" role="status">选择项目后可生成架构语义草稿。</p>
              <ol class="ca-workflow-steps" aria-label="Architecture 生成流程">
                <li id="ca-workflow-generate"><span>1</span><strong>生成</strong></li>
                <li id="ca-workflow-review"><span>2</span><strong>复审</strong></li>
                <li id="ca-workflow-adopt"><span>3</span><strong>确认</strong></li>
                <li id="ca-workflow-build"><span>4</span><strong>重建</strong></li>
              </ol>
              <div id="ca-architecture-ready-banner" class="ca-ready-banner" role="status" hidden>Architecture 已就绪</div>
              <div id="ca-architecture-progress" class="ca-architecture-progress" role="group" aria-label="Architecture 任务进度" hidden>
                <div class="ca-progress-heading">
                  <span id="ca-progress-label">准备上下文</span>
                  <strong id="ca-progress-percent">0%</strong>
                </div>
                <progress id="ca-progress-bar" max="100" value="0">0%</progress>
                <span id="ca-progress-elapsed" class="ca-progress-elapsed" hidden></span>
              </div>
              <details id="ca-llm-details" class="ca-llm-details" open>
                <summary>模型选择</summary>
              <div class="ca-llm-selectors">
                <section class="ca-llm-role" aria-labelledby="ca-generator-model-title">
                  <h3 id="ca-generator-model-title">生成模型</h3>
                  <label class="ca-field-label" for="ca-provider-select">Hana Provider</label>
                  <select id="ca-provider-select"><option value="">自动选择</option></select>
                  <label class="ca-field-label" for="ca-model-select">模型</label>
                  <select id="ca-model-select"><option value="">自动选择</option></select>
                  <label class="ca-custom-toggle"><input id="ca-generator-custom-toggle" type="checkbox" /> 使用自定义 ID</label>
                  <div id="ca-generator-custom-fields" class="ca-custom-fields" hidden>
                    <label class="ca-field-label" for="ca-provider-custom">Provider ID</label>
                    <input id="ca-provider-custom" type="text" autocomplete="off" spellcheck="false" disabled />
                    <label class="ca-field-label" for="ca-model-custom">模型 ID</label>
                    <input id="ca-model-custom" type="text" autocomplete="off" spellcheck="false" disabled />
                  </div>
                </section>
                <section class="ca-llm-role" aria-labelledby="ca-reviewer-model-title">
                  <h3 id="ca-reviewer-model-title">AI 复审模型</h3>
                  <label class="ca-field-label" for="ca-review-provider-select">Hana Provider</label>
                  <select id="ca-review-provider-select"><option value="">同生成模型</option></select>
                  <label class="ca-field-label" for="ca-review-model-select">模型</label>
                  <select id="ca-review-model-select"><option value="">同生成模型</option></select>
                  <label class="ca-custom-toggle"><input id="ca-review-custom-toggle" type="checkbox" /> 使用自定义 ID</label>
                  <div id="ca-review-custom-fields" class="ca-custom-fields" hidden>
                    <label class="ca-field-label" for="ca-review-provider-custom">Provider ID</label>
                    <input id="ca-review-provider-custom" type="text" autocomplete="off" spellcheck="false" disabled />
                    <label class="ca-field-label" for="ca-review-model-custom">模型 ID</label>
                    <input id="ca-review-model-custom" type="text" autocomplete="off" spellcheck="false" disabled />
                  </div>
                </section>
              </div>
              </details>
              <div class="ca-actions ca-workflow-actions">
                <button id="ca-architecture-next" class="primary" data-action="generate">生成并复审语义草稿</button>
                <button id="ca-cancel-architecture" class="danger" hidden disabled>取消任务</button>
              </div>
              <details id="ca-architecture-advanced" class="ca-advanced-actions" hidden>
                <summary>高级与异常恢复</summary>
                <button id="ca-regenerate-architecture">重新生成语义草稿</button>
              </details>
            </div>
            <div class="ca-panel ca-hidden" id="ca-log-panel">
              <h2 class="ca-panel-title">日志</h2>
              <pre id="ca-log" class="ca-log" aria-live="polite"></pre>
            </div>
          </aside>
          <div class="ca-iframe-wrap">
            <div id="ca-placeholder" class="ca-placeholder" role="status" aria-live="polite">
              <div class="ca-empty-state">
                <h2 id="ca-placeholder-title">添加第一个代码项目</h2>
                <p id="ca-placeholder-text">从左侧选择 cbm 已索引项目，或输入项目根目录绝对路径。</p>
              </div>
            </div>
            <iframe id="ca-frame" title="代码图谱 Viewer" allow="clipboard-write" hidden></iframe>
          </div>
        </div>
      </div>
    </div>
    <div id="ca-review-dialog" class="ca-modal-backdrop" hidden>
      <section class="ca-modal" role="dialog" aria-modal="true" aria-labelledby="ca-review-title">
        <header class="ca-modal-header">
          <h2 id="ca-review-title">审查 Architecture 草稿</h2>
          <button id="ca-review-close" aria-label="关闭审查">关闭</button>
        </header>
        <p class="ca-hint">生成模型和复审模型的输出都不是事实。请先阅读 AI 复审意见，再核对语义层、宏观域、路径规则和每层证据。</p>
        <div id="ca-review-summary" class="ca-review-summary"></div>
        <section class="ca-ai-review" aria-labelledby="ca-ai-review-title">
          <header class="ca-ai-review-header">
            <h3 id="ca-ai-review-title">AI 独立复审</h3>
            <span id="ca-ai-review-verdict" class="ca-review-verdict"></span>
          </header>
          <p id="ca-ai-review-summary" class="ca-ai-review-summary"></p>
          <ul id="ca-ai-review-findings" class="ca-ai-review-findings"></ul>
        </section>
        <details class="ca-overlay-details">
          <summary>查看完整 Architecture overlay JSON</summary>
          <pre id="ca-review-json" class="ca-review-json" tabindex="0" aria-label="Architecture 语义草稿 JSON"></pre>
        </details>
        <label class="ca-review-confirm"><input id="ca-review-checkbox" type="checkbox" aria-required="true" /> <span id="ca-review-confirm-text">我已阅读 AI 复审意见，并核对路径证据和架构边界，同意采用此草稿</span></label>
        <div class="ca-modal-actions">
          <button id="ca-adopt-architecture" class="primary" disabled>采用并开始重建</button>
          <button id="ca-review-cancel">返回</button>
        </div>
      </section>
    </div>
  `;

  // Reveal the iframe as soon as the usable shell exists. Data loading stays
  // asynchronous and must never hold the host handshake open.
  postReady();

  const els = {
    projectSelect: document.getElementById("ca-project-select"),
    refreshBtn: document.getElementById("ca-refresh"),
    cbmStatus: document.getElementById("ca-cbm-status"),
    pythonStatus: document.getElementById("ca-python-status"),
    bundleStatus: document.getElementById("ca-bundle-status"),
    message: document.getElementById("ca-message"),
    candidateSearch: document.getElementById("ca-candidate-search"),
    candidateTable: document.getElementById("ca-candidate-table"),
    candidateTableBody: document.getElementById("ca-candidate-table-body"),
    candidateEmpty: document.getElementById("ca-candidate-empty"),
    candidateHint: document.getElementById("ca-candidate-hint"),
    registerInput: document.getElementById("ca-register-input"),
    registerBtn: document.getElementById("ca-register-btn"),
    bundleArch: document.getElementById("ca-bundle-arch"),
    bundleFull: document.getElementById("ca-bundle-full"),
    architectureHint: document.getElementById("ca-architecture-hint"),
    architectureStatus: document.getElementById("ca-architecture-status"),
    architectureProgress: document.getElementById("ca-architecture-progress"),
    progressLabel: document.getElementById("ca-progress-label"),
    progressPercent: document.getElementById("ca-progress-percent"),
    progressBar: document.getElementById("ca-progress-bar"),
    progressElapsed: document.getElementById("ca-progress-elapsed"),
    architectureReadyBanner: document.getElementById("ca-architecture-ready-banner"),
    llmDetails: document.getElementById("ca-llm-details"),
    buildSection: document.getElementById("ca-build-section"),
    providerSelect: document.getElementById("ca-provider-select"),
    modelSelect: document.getElementById("ca-model-select"),
    generatorCustomToggle: document.getElementById("ca-generator-custom-toggle"),
    generatorCustomFields: document.getElementById("ca-generator-custom-fields"),
    providerCustom: document.getElementById("ca-provider-custom"),
    modelCustom: document.getElementById("ca-model-custom"),
    reviewProviderSelect: document.getElementById("ca-review-provider-select"),
    reviewModelSelect: document.getElementById("ca-review-model-select"),
    reviewCustomToggle: document.getElementById("ca-review-custom-toggle"),
    reviewCustomFields: document.getElementById("ca-review-custom-fields"),
    reviewProviderCustom: document.getElementById("ca-review-provider-custom"),
    reviewModelCustom: document.getElementById("ca-review-model-custom"),
    workflowGenerate: document.getElementById("ca-workflow-generate"),
    workflowReview: document.getElementById("ca-workflow-review"),
    workflowAdopt: document.getElementById("ca-workflow-adopt"),
    workflowBuild: document.getElementById("ca-workflow-build"),
    architectureNextBtn: document.getElementById("ca-architecture-next"),
    cancelArchitectureBtn: document.getElementById("ca-cancel-architecture"),
    architectureAdvanced: document.getElementById("ca-architecture-advanced"),
    regenerateArchitectureBtn: document.getElementById("ca-regenerate-architecture"),
    reviewDialog: document.getElementById("ca-review-dialog"),
    reviewCloseBtn: document.getElementById("ca-review-close"),
    reviewCancelBtn: document.getElementById("ca-review-cancel"),
    reviewSummary: document.getElementById("ca-review-summary"),
    aiReviewVerdict: document.getElementById("ca-ai-review-verdict"),
    aiReviewSummary: document.getElementById("ca-ai-review-summary"),
    aiReviewFindings: document.getElementById("ca-ai-review-findings"),
    reviewJson: document.getElementById("ca-review-json"),
    reviewCheckbox: document.getElementById("ca-review-checkbox"),
    reviewConfirmText: document.getElementById("ca-review-confirm-text"),
    adoptArchitectureBtn: document.getElementById("ca-adopt-architecture"),
    buildBtn: document.getElementById("ca-build-btn"),
    cancelBtn: document.getElementById("ca-cancel-btn"),
    logPanel: document.getElementById("ca-log-panel"),
    log: document.getElementById("ca-log"),
    placeholder: document.getElementById("ca-placeholder"),
    placeholderTitle: document.getElementById("ca-placeholder-title"),
    placeholderText: document.getElementById("ca-placeholder-text"),
    frame: document.getElementById("ca-frame"),
  };

  let state = {
    projects: [],
    candidates: [],
    candidateRegistry: null,
    candidateError: "",
    selectedProjectId: "",
    bundle: "full",
    taskId: null,
    pollTimer: null,
    buildStarting: false,
    cancelRequested: false,
    architectureProviders: [],
    architectureProviderError: "",
    architectureState: null,
    architectureTaskId: null,
    architecturePollTimer: null,
    architectureProgressHideTimer: null,
    architectureStarting: false,
    openArchitectureAfterBuild: false,
    architectureElapsedStart: null,
    architectureElapsedTimer: null,
  };

  // ─── 依赖状态渲染 ─────────────────────────────────────────

  function renderDeps() {
    const cbm = boot.cbmStatus || { ok: false };
    const py = boot.pythonStatus || { ok: false };
    setStatus(els.cbmStatus, cbm.ok ? "ok" : "fail", `cbm ${cbm.ok ? (cbm.version || "ok") : (cbm.error || "未找到")}`);
    setStatus(els.pythonStatus, py.ok ? "ok" : "fail", `python ${py.ok ? (py.version || "ok") : (py.error || "未找到")}`);
  }

  function setStatus(el, kind, text) {
    el.className = `ca-status ${kind}`;
    el.textContent = text;
  }

  function setMessage(text, type = "") {
    els.message.textContent = text;
    els.message.className = `ca-message ${type}`;
  }

  // ─── 项目列表 ─────────────────────────────────────────────

  async function refreshProjects() {
    try {
      const res = await apiFetch("/api/projects");
      const data = await readJsonResponse(res, "项目列表");
      const error = responseError(res, data, "项目列表读取失败");
      if (error) throw new Error(error);
      state.projects = Array.isArray(data.projects) ? data.projects : [];
      renderProjectSelect();
      return state.projects;
    } catch (err) {
      state.projects = [];
      renderProjectSelect();
      setMessage("项目列表读取失败: " + err.message, "error");
      return [];
    }
  }

  async function refreshCandidates() {
    try {
      const res = await apiFetch("/api/project-candidates");
      const data = await readJsonResponse(res, "cbm 项目候选");
      const error = responseError(res, data, "cbm 项目读取失败");
      if (error || !data.ok) throw new Error(error || data.error || "cbm 项目读取失败");
      state.candidates = Array.isArray(data.candidates) ? data.candidates : [];
      state.candidateRegistry = data.registry || null;
      state.candidateError = "";
      renderCandidateTable();
      return state.candidates;
    } catch (err) {
      state.candidates = [];
      state.candidateRegistry = null;
      state.candidateError = err.message;
      renderCandidateTable();
      return [];
    }
  }

  async function refreshAll() {
    await refreshProjects();
    await refreshCandidates();
    await refreshArchitectureProviders();
    await checkStatus();
  }

  function renderProjectSelect() {
    const current = els.projectSelect.value || state.selectedProjectId;
    els.projectSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = state.projects.length > 0 ? "选择项目…" : "暂无项目，请先注册";
    els.projectSelect.appendChild(placeholder);

    for (const p of state.projects) {
      const opt = document.createElement("option");
      opt.value = p.projectId;
      opt.textContent = p.name || p.projectId;
      opt.title = p.root || "";
      els.projectSelect.appendChild(opt);
    }

    const stillAvailable = state.projects.some((p) => p.projectId === current);
    if (current && stillAvailable) {
      els.projectSelect.value = current;
      state.selectedProjectId = current;
    } else if (state.projects.length > 0) {
      state.selectedProjectId = state.projects[0].projectId;
      els.projectSelect.value = state.selectedProjectId;
    } else {
      state.selectedProjectId = "";
    }
  }

  function formatMetric(value, unit) {
    return Number.isFinite(value) ? `${value.toLocaleString("zh-CN")} ${unit}` : `— ${unit}`;
  }

  function candidateMatches(candidate, terms) {
    if (terms.length === 0) return true;
    const haystack = [candidate.name, candidate.cbmProjectName, candidate.root]
      .filter(Boolean)
      .join("\n")
      .toLocaleLowerCase("zh-CN");
    return terms.every((term) => haystack.includes(term));
  }

  function renderCandidateTable() {
    const error = state.candidateError;
    const registry = state.candidateRegistry;
    const registeredByRoot = new Map(state.projects.map((project) => [project.root, project]));
    const terms = els.candidateSearch.value
      .trim()
      .toLocaleLowerCase("zh-CN")
      .split(/\s+/)
      .filter(Boolean);
    const matching = state.candidates.filter((candidate) => candidateMatches(candidate, terms));
    const active = !!state.taskId || state.buildStarting || !!state.architectureTaskId || state.architectureStarting;

    els.candidateTableBody.replaceChildren();
    for (const candidate of matching) {
      const registered = registeredByRoot.get(candidate.root) || null;
      const row = document.createElement("tr");
      if (registered) row.classList.add("is-registered");

      const projectCell = document.createElement("td");
      const nameLine = document.createElement("div");
      nameLine.className = "ca-index-name-line";
      const name = document.createElement("strong");
      name.textContent = candidate.name || candidate.cbmProjectName;
      nameLine.appendChild(name);
      if (registered) {
        const badge = document.createElement("span");
        badge.className = "ca-index-status";
        badge.textContent = "已注册";
        nameLine.appendChild(badge);
      }
      const root = document.createElement("div");
      root.className = "ca-index-path";
      root.textContent = candidate.root;
      root.title = candidate.root;
      projectCell.append(nameLine, root);

      const scaleCell = document.createElement("td");
      scaleCell.className = "ca-index-scale";
      const nodes = document.createElement("span");
      nodes.textContent = formatMetric(candidate.nodes, "节点");
      const edges = document.createElement("span");
      edges.textContent = formatMetric(candidate.edges, "边");
      scaleCell.append(nodes, edges);

      const actionCell = document.createElement("td");
      actionCell.className = "ca-index-action";
      const action = document.createElement("button");
      action.type = "button";
      action.className = "ca-table-action";
      action.dataset.action = registered ? "open" : "choose";
      action.dataset.root = candidate.root;
      if (registered) action.dataset.projectId = registered.projectId;
      action.textContent = registered ? "打开" : "选择";
      action.disabled = active;
      actionCell.appendChild(action);

      row.append(projectCell, scaleCell, actionCell);
      els.candidateTableBody.appendChild(row);
    }

    const sourceLabels = {
      "plugin-config": "插件设置",
      "process-env": "进程环境",
      "mcp-connector": "MCP connector",
      "cbm-default": "cbm 默认目录",
    };
    const registeredCount = state.candidates.filter((candidate) => registeredByRoot.has(candidate.root)).length;
    if (error) {
      els.candidateHint.textContent = `读取失败：${error}`;
    } else if (registry) {
      const cacheSource = sourceLabels[registry.source] || registry.source || "未知来源";
      const binarySource = sourceLabels[registry.binarySource] || registry.binarySource || "";
      const provenance = binarySource && registry.binarySource !== registry.source
        ? `${cacheSource} cache / ${binarySource} 命令`
        : cacheSource;
      const total = Number.isFinite(registry.candidateCount) ? registry.candidateCount : state.candidates.length;
      const resultText = terms.length > 0 ? `${matching.length}/${state.candidates.length} 个结果` : `${total} 个结构化项目`;
      const truncated = registry.truncated ? " · 当前显示前 500 项" : "";
      els.candidateHint.textContent = `${provenance} · ${resultText} · 已注册 ${registeredCount}${truncated}`;
      els.candidateHint.title = registry.cacheDir || "";
    } else {
      els.candidateHint.textContent = "未发现 cbm registry；请检查插件设置中的 CBM cache directory。";
      els.candidateHint.title = "";
    }

    els.candidateEmpty.hidden = matching.length > 0;
    els.candidateEmpty.textContent = error
      ? "无法读取 cbm 索引"
      : terms.length > 0
        ? "没有匹配的索引项目"
        : "当前 registry 中没有可访问的索引项目";
    els.candidateSearch.disabled = !!error || state.candidates.length === 0 || active;
    els.candidateTable.setAttribute("aria-busy", "false");
  }

  async function registerProject() {
    if (state.taskId || state.buildStarting || state.architectureTaskId || state.architectureStarting) {
      setMessage("构建或语义生成期间不能切换或注册项目", "error");
      return;
    }
    const root = els.registerInput.value.trim();
    if (!root) {
      setMessage("请输入项目根目录", "error");
      return;
    }
    setBusy(els.registerBtn, true);
    setMessage("正在注册项目…");
    try {
      const res = await apiFetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectRoot: root }),
      });
      const data = await readJsonResponse(res, "项目注册");
      const error = responseError(res, data, "注册失败");
      if (error || !data.ok) {
        setMessage(error || data.error || "注册失败", "error");
        return;
      }
      els.registerInput.value = "";
      setMessage("项目已注册", "success");
      await refreshProjects();
      await refreshCandidates();
      if (data.projectId) {
        state.selectedProjectId = data.projectId;
        els.projectSelect.value = data.projectId;
      } else if (data.project?.projectId) {
        state.selectedProjectId = data.project.projectId;
        els.projectSelect.value = data.project.projectId;
      }
      await checkStatus();
    } catch (err) {
      setMessage("注册失败: " + err.message, "error");
    } finally {
      setBusy(els.registerBtn, false);
    }
  }

  // ─── 分段切换 ─────────────────────────────────────────────

  function updateBundleSelection(bundle, force = false) {
    if (bundle === "architecture" && els.bundleArch.disabled && !force) return;
    state.bundle = bundle;
    const isArch = bundle === "architecture";
    els.bundleArch.classList.toggle("active", isArch);
    els.bundleFull.classList.toggle("active", !isArch);
    els.bundleArch.setAttribute("aria-pressed", String(isArch));
    els.bundleFull.setAttribute("aria-pressed", String(!isArch));
  }

  function setBundle(bundle) {
    if (bundle === "architecture" && els.bundleArch.disabled) {
      setMessage("Architecture 尚不可用：请先生成、审查并采用语义草稿，然后重新构建。", "error");
      return;
    }
    updateBundleSelection(bundle);
    checkStatus();
  }

  function updateArchitectureAvailability(data) {
    const hasArchitecture = !!data?.hasArchitecture;
    els.bundleArch.disabled = !hasArchitecture || !!state.taskId || state.architectureStarting || !!state.architectureTaskId;
    els.bundleArch.title = hasArchitecture ? "打开宏观架构图" : "需要生成、审查并采用语义草稿后重新构建";
    if (hasArchitecture) {
      els.architectureHint.textContent = "Architecture 已就绪，可在宏观架构与 Full 结构事实之间切换。";
    } else if (data?.project?.hasOverlay) {
      els.architectureHint.textContent = "语义 overlay 已采用，重新构建后启用 Architecture。";
    } else {
      els.architectureHint.textContent = "Architecture 需要先生成并审查语义草稿。";
    }
  }

  // ─── 状态检查 ─────────────────────────────────────────────

  function setPlaceholder(title, text) {
    els.placeholderTitle.textContent = title;
    els.placeholderText.textContent = text;
    els.placeholder.hidden = false;
    els.frame.hidden = true;
  }

  async function checkStatus() {
    const projectId = state.selectedProjectId;
    if (!projectId) {
      setStatus(els.bundleStatus, "warn", "未选择项目");
      updateArchitectureAvailability(null);
      renderArchitectureState(null);
      setPlaceholder("添加第一个代码项目", "从左侧选择 cbm 已索引项目，或输入项目根目录绝对路径。");
      return;
    }
    const requestedBundle = state.bundle;
    try {
      const res = await apiFetch(`/api/status?projectId=${encodeURIComponent(projectId)}&bundle=${encodeURIComponent(requestedBundle)}`);
      const data = await readJsonResponse(res, "图谱状态");
      const error = responseError(res, data, "状态读取失败");
      if (error) throw new Error(error);
      if (state.selectedProjectId !== projectId || state.bundle !== requestedBundle) return;

      updateArchitectureAvailability(data);
      await refreshArchitectureState(projectId);
      const useFullFallback = requestedBundle === "architecture" && !data.hasArchitecture && data.hasFull;
      if (useFullFallback) {
        updateBundleSelection("full");
        setMessage("该项目尚无可用 Architecture，已显示 Full 图谱", "success");
      }

      const activeBundle = useFullFallback ? "full" : requestedBundle;
      const hasBundle = useFullFallback ? data.hasFull : data.hasBundle;
      setStatus(els.bundleStatus, hasBundle ? "ok" : "warn", `${activeBundle}: ${hasBundle ? "就绪" : "无产物"}`);
      if (hasBundle) {
        els.placeholder.hidden = true;
        els.frame.hidden = false;
        loadFrame();
      } else {
        const label = activeBundle === "architecture" ? "Architecture" : "Full";
        setPlaceholder(`尚无 ${label} 图谱`, "点击左侧“开始构建”，完成后图谱会在此显示。");
      }
    } catch (err) {
      setStatus(els.bundleStatus, "fail", "状态读取失败");
      setMessage(err.message, "error");
    }
  }

  let frameLoadSequence = 0;

  async function loadFrame() {
    const projectId = state.selectedProjectId;
    const bundle = state.bundle;
    if (!projectId) return;

    const sequence = ++frameLoadSequence;
    const params = new URLSearchParams({
      projectId,
      bundle,
      "hana-theme": boot.theme || "inherit",
    });

    try {
      const res = await apiFetch(`/frame?${params.toString()}`);
      const html = await res.text();
      if (!res.ok) {
        const detail = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
        throw new Error(`Viewer frame HTTP ${res.status}: ${detail || "empty response"}`);
      }
      if (sequence !== frameLoadSequence || state.selectedProjectId !== projectId || state.bundle !== bundle) return;

      els.frame.removeAttribute("src");
      els.frame.srcdoc = html;
      els.placeholder.hidden = true;
      els.frame.hidden = false;
    } catch (err) {
      if (sequence !== frameLoadSequence || state.selectedProjectId !== projectId || state.bundle !== bundle) return;
      setPlaceholder("Viewer 加载失败", err.message);
      setMessage(err.message, "error");
    }
  }

  // ─── Architecture 语义草稿 ────────────────────────────────

  async function refreshArchitectureProviders() {
    state.architectureProviderError = "";
    try {
      const res = await apiFetch("/api/architecture/providers");
      const data = await readJsonResponse(res, "LLM Provider");
      if (!res.ok || !data.ok) throw new Error(data?.detail || responseError(res, data, "Provider 读取失败"));
      state.architectureProviders = Array.isArray(data.providers) ? data.providers : [];
      if (state.architectureProviders.length === 0) {
        state.architectureProviderError = "Hana 未返回可用的 chat Provider；请检查供应商配置和模型能力。";
      }
    } catch (err) {
      state.architectureProviders = [];
      state.architectureProviderError = err.message || "Provider 读取失败";
      setMessage(`Provider 读取失败：${state.architectureProviderError}`, "error");
    }
    renderArchitectureProviders();
    renderArchitectureState(state.architectureState);
  }

  function populateProviderSelect(select, emptyLabel) {
    const previousProvider = select.value;
    select.replaceChildren(new Option(emptyLabel, ""));
    for (const provider of state.architectureProviders) {
      select.appendChild(new Option(`${provider.id} (${provider.models?.length || 0})`, provider.id));
    }
    if (state.architectureProviders.some((provider) => provider.id === previousProvider)) select.value = previousProvider;
  }

  function populateModelSelect(providerSelect, modelSelect, emptyLabel) {
    const previousModel = modelSelect.value;
    modelSelect.replaceChildren(new Option(emptyLabel, ""));
    const providerId = providerSelect.value;
    const provider = providerId
      ? state.architectureProviders.find((p) => p.id === providerId)
      : null;
    const models = provider
      ? provider.models || []
      : state.architectureProviders.flatMap((p) => p.models || []);
    for (const model of [...new Set(models)]) {
      const meta = provider?.modelMeta?.[model]
        || state.architectureProviders.find((p) => p.modelMeta?.[model])?.modelMeta?.[model];
      const label = meta?.reasoning ? `${model} (推理)` : model;
      modelSelect.appendChild(new Option(label, model));
    }
    if (models.includes(previousModel)) modelSelect.value = previousModel;
  }

  function renderArchitectureProviders() {
    populateProviderSelect(els.providerSelect, "自动选择");
    populateProviderSelect(els.reviewProviderSelect, "同生成模型");
    renderArchitectureModels();
    renderReviewModels();
  }

  function renderArchitectureModels() {
    populateModelSelect(els.providerSelect, els.modelSelect, "自动选择");
  }

  function renderReviewModels() {
    populateModelSelect(els.reviewProviderSelect, els.reviewModelSelect, "同生成模型");
  }

  function setCustomModelMode(role, enabled) {
    const review = role === "review";
    const fields = review ? els.reviewCustomFields : els.generatorCustomFields;
    const providerCustom = review ? els.reviewProviderCustom : els.providerCustom;
    const modelCustom = review ? els.reviewModelCustom : els.modelCustom;
    fields.hidden = !enabled;
    providerCustom.disabled = !enabled;
    modelCustom.disabled = !enabled;
    renderArchitectureState(state.architectureState);
    if (enabled) providerCustom.focus();
  }

  function readModelChoice(role) {
    const review = role === "review";
    const customEnabled = (review ? els.reviewCustomToggle : els.generatorCustomToggle).checked;
    if (!customEnabled) {
      return {
        providerId: (review ? els.reviewProviderSelect : els.providerSelect).value || undefined,
        model: (review ? els.reviewModelSelect : els.modelSelect).value || undefined,
      };
    }
    const providerId = (review ? els.reviewProviderCustom : els.providerCustom).value.trim();
    const model = (review ? els.reviewModelCustom : els.modelCustom).value.trim();
    if (!providerId || !model) throw new Error(`${review ? "复审" : "生成"}自定义模式需要同时填写 Provider ID 和模型 ID`);
    return { providerId, model };
  }

  function getReasoningFlag(providerId, model) {
    if (!providerId || !model) return false;
    const provider = state.architectureProviders.find((p) => p.id === providerId);
    return !!provider?.modelMeta?.[model]?.reasoning;
  }

  function updateProgressElapsed(task) {
    const waitingStates = ["generating", "reviewing"];
    if (!task || !waitingStates.includes(task.status)) {
      els.progressElapsed.hidden = true;
      if (state.architectureElapsedTimer) {
        clearTimeout(state.architectureElapsedTimer);
        state.architectureElapsedTimer = null;
      }
      state.architectureElapsedStart = null;
      return;
    }
    if (!state.architectureElapsedStart) state.architectureElapsedStart = Date.now();
    const elapsed = Math.floor((Date.now() - state.architectureElapsedStart) / 1000);
    const isReviewStage = task.status === "reviewing";
    // Hana does not expose reasoning flag; always use 300s as the safe upper bound
    const limit = 300;
    els.progressElapsed.hidden = false;
    els.progressElapsed.textContent = `已等待 ${elapsed}s / 上限 ${limit}s`;
    state.architectureElapsedTimer = setTimeout(() => updateProgressElapsed(task), 1000);
  }

  function renderArchitectureProgress(task) {
    if (!task) {
      els.architectureProgress.hidden = true;
      return;
    }
    const labels = {
      preparing: "准备有界代码上下文",
      generating: "模型生成（等待 Provider 响应）",
      validating: "确定性校验",
      committing_draft: "写入语义草稿",
      reviewing: "AI 独立复审（等待 Provider 响应）",
      committing_review: "写入复审报告",
      cancelling: "正在取消",
      completed: "任务完成",
      review_failed: "AI 复审失败",
      failed: "任务失败",
      cancelled: "任务已取消",
    };
    const fallback = task.kind === "review"
      ? { preparing: 10, reviewing: 25, committing_review: 90, completed: 100 }
      : { preparing: 5, generating: 20, validating: 45, committing_draft: 55, reviewing: 65, committing_review: 90, completed: 100 };
    const progress = Math.max(0, Math.min(100, Math.round(Number(task.progress ?? fallback[task.status] ?? 0))));
    els.architectureProgress.hidden = false;
    els.architectureProgress.dataset.status = task.status || "preparing";
    els.progressLabel.textContent = labels[task.status] || task.status || "准备任务";
    els.progressPercent.textContent = `${progress}%`;
    els.progressBar.value = progress;
    els.progressBar.textContent = `${progress}%`;
    els.progressBar.setAttribute("aria-valuetext", `${progress}% · ${els.progressLabel.textContent}`);
    updateProgressElapsed(task);
  }

  function scheduleArchitectureProgressHide() {
    if (state.architectureProgressHideTimer) clearTimeout(state.architectureProgressHideTimer);
    state.architectureProgressHideTimer = setTimeout(() => {
      state.architectureProgressHideTimer = null;
      els.architectureProgress.hidden = true;
    }, 4000);
  }

  async function refreshArchitectureState(projectId = state.selectedProjectId) {
    if (!projectId) {
      state.architectureState = null;
      renderArchitectureState(null);
      return;
    }
    try {
      const res = await apiFetch(`/api/architecture?projectId=${encodeURIComponent(projectId)}`);
      const data = await readJsonResponse(res, "Architecture 状态");
      if (!res.ok || !data.ok) throw new Error(responseError(res, data, "Architecture 状态读取失败"));
      if (state.selectedProjectId !== projectId) return;
      state.architectureState = data;
      if (data.activeTask) {
        renderArchitectureProgress(data.activeTask);
        if (!state.architectureTaskId) {
          state.architectureTaskId = data.activeTask.taskId;
          pollArchitectureTask();
        }
      }
      renderArchitectureState(data);
    } catch (err) {
      state.architectureState = null;
      els.architectureStatus.textContent = `状态读取失败：${err.message}`;
    }
  }

  function renderWorkflowSteps({ hasDraft, hasReview, draftAdopted, architectureReady, activeTask, buildBusy }) {
    const activeStatus = activeTask?.status || "";
    let currentStep = 1;
    if (buildBusy || draftAdopted) currentStep = 4;
    else if (hasReview) currentStep = 3;
    else if (hasDraft || ["reviewing", "committing_review"].includes(activeStatus)) currentStep = 2;

    const steps = [
      { element: els.workflowGenerate, done: hasDraft, number: 1 },
      { element: els.workflowReview, done: hasReview, number: 2 },
      { element: els.workflowAdopt, done: draftAdopted, number: 3 },
      { element: els.workflowBuild, done: architectureReady, number: 4 },
    ];
    for (const step of steps) {
      step.element.classList.toggle("done", step.done);
      step.element.classList.toggle("current", !architectureReady && step.number === currentStep);
      if (!architectureReady && step.number === currentStep) step.element.setAttribute("aria-current", "step");
      else step.element.removeAttribute("aria-current");
    }
  }

  function configureArchitectureNext(action, label, disabled) {
    els.architectureNextBtn.dataset.action = action;
    els.architectureNextBtn.textContent = label;
    els.architectureNextBtn.disabled = disabled;
  }

  function renderArchitectureState(data) {
    const activeTask = data?.activeTask || null;
    const active = state.architectureStarting || !!state.architectureTaskId || !!activeTask;
    const buildBusy = state.buildStarting || !!state.taskId;
    const controlsBusy = active || buildBusy;
    const generatorCustom = els.generatorCustomToggle.checked;
    const reviewerCustom = els.reviewCustomToggle.checked;
    const customGeneratorReady = generatorCustom && !!els.providerCustom.value.trim() && !!els.modelCustom.value.trim();
    const hasSelectableProvider = state.architectureProviders.length > 0;
    const hasDraft = !!data?.hasDraft;
    const hasReview = !!data?.hasReview;
    const draftAdopted = !!data?.hasAdoptedOverlay && data?.draftMeta?.status === "adopted";
    const projectHasArchitecture = !!state.projects.find((project) => project.projectId === state.selectedProjectId)?.hasArchitecture;
    const architectureReady = projectHasArchitecture && draftAdopted && !data?.requiresBuild;
    const verdictLabels = { pass: "通过", revise: "建议修订", reject: "拒绝" };

    renderWorkflowSteps({ hasDraft, hasReview, draftAdopted, architectureReady, activeTask, buildBusy });

    els.architectureReadyBanner.hidden = !architectureReady;

    const showBuildSection = (!data?.hasAdoptedOverlay && !hasDraft) || architectureReady || buildBusy;
    els.buildSection.hidden = !showBuildSection;
    els.buildBtn.textContent = architectureReady ? "重新构建" : "构建 Full 图谱";

    const needsModelSelection = !hasDraft && !active && !buildBusy;
    if (needsModelSelection) els.llmDetails.open = true;
    else if (architectureReady || draftAdopted) els.llmDetails.open = false;

    if (state.architectureProviderError && customGeneratorReady && !hasDraft) {
      els.architectureStatus.textContent = `Provider 列表不可用，将使用自定义生成模型：${els.providerCustom.value.trim()} / ${els.modelCustom.value.trim()}`;
    } else if (state.architectureProviderError && !hasDraft) {
      els.architectureStatus.textContent = `Provider 列表不可用：${state.architectureProviderError}；可启用“使用自定义 ID”兜底。`;
    } else if (!state.selectedProjectId) {
      els.architectureStatus.textContent = "选择项目后可生成架构语义草稿。";
    } else if (buildBusy) {
      els.architectureStatus.textContent = "已采用语义 overlay，正在重建 Architecture…";
    } else if (active) {
      els.architectureStatus.textContent = "正在生成、确定性校验并进行 AI 独立复审…";
    } else if (hasDraft && !draftAdopted && hasReview) {
      const verdict = verdictLabels[data.review?.verdict] || data.review?.verdict || "未知";
      const confidence = Number.isFinite(data.review?.confidence) ? ` · 置信度 ${Math.round(data.review.confidence * 100)}%` : "";
      els.architectureStatus.textContent = `AI 复审${verdict}${confidence}；下一步是人工确认。`;
    } else if (hasDraft && !draftAdopted) {
      els.architectureStatus.textContent = "草稿已通过确定性校验，但 AI 复审未完成；下一步仅重试复审。";
    } else if (draftAdopted && data?.requiresBuild) {
      els.architectureStatus.textContent = "语义草稿已采用，尚未重建；下一步生成 Architecture Bundle。";
    } else if (architectureReady) {
      els.architectureStatus.textContent = "Architecture 已就绪。";
    } else if (draftAdopted) {
      els.architectureStatus.textContent = "语义 overlay 已采用；下一步重新构建。";
    } else {
      els.architectureStatus.textContent = "尚无语义草稿。生成后会自动进入确定性校验和 AI 独立复审。";
    }

    if (!state.selectedProjectId) {
      configureArchitectureNext("generate", "请先选择项目", true);
    } else if (active) {
      configureArchitectureNext("wait", "Architecture 任务进行中…", true);
    } else if (buildBusy) {
      configureArchitectureNext("wait", "正在重建 Architecture…", true);
    } else if (!hasDraft) {
      configureArchitectureNext("generate", "生成并复审语义草稿", !hasSelectableProvider && !customGeneratorReady);
    } else if (!hasReview && !draftAdopted) {
      configureArchitectureNext("review", "仅重试 AI 复审", false);
    } else if (!draftAdopted) {
      configureArchitectureNext("adopt", "审查并确认采用", false);
    } else if (!architectureReady) {
      configureArchitectureNext("build", "重新构建 Architecture", false);
    } else {
      configureArchitectureNext("open", "打开 Architecture", false);
    }

    els.cancelArchitectureBtn.hidden = !active;
    els.cancelArchitectureBtn.disabled = !state.architectureTaskId;
    els.architectureAdvanced.hidden = !hasDraft;
    els.regenerateArchitectureBtn.disabled = controlsBusy || (!hasSelectableProvider && !customGeneratorReady);
    els.generatorCustomToggle.disabled = controlsBusy;
    els.reviewCustomToggle.disabled = controlsBusy;
    els.providerSelect.disabled = controlsBusy || generatorCustom || !hasSelectableProvider;
    els.modelSelect.disabled = controlsBusy || generatorCustom || !hasSelectableProvider;
    els.reviewProviderSelect.disabled = controlsBusy || reviewerCustom || !hasSelectableProvider;
    els.reviewModelSelect.disabled = controlsBusy || reviewerCustom || !hasSelectableProvider;
    els.providerCustom.disabled = controlsBusy || !generatorCustom;
    els.modelCustom.disabled = controlsBusy || !generatorCustom;
    els.reviewProviderCustom.disabled = controlsBusy || !reviewerCustom;
    els.reviewModelCustom.disabled = controlsBusy || !reviewerCustom;
  }

  async function runArchitectureNext() {
    const action = els.architectureNextBtn.dataset.action;
    if (action === "generate") await startArchitectureGeneration();
    else if (action === "review") await startArchitectureReview();
    else if (action === "adopt") openArchitectureReview();
    else if (action === "build") await startBuild({ openArchitectureWhenReady: true });
    else if (action === "open") setBundle("architecture");
  }

  async function startArchitectureGeneration() {
    if (!state.selectedProjectId || state.architectureStarting || state.architectureTaskId || state.taskId) return;
    state.architectureStarting = true;
    if (state.architectureProgressHideTimer) clearTimeout(state.architectureProgressHideTimer);
    state.architectureProgressHideTimer = null;
    renderArchitectureProgress({ kind: "generation", status: "preparing", progress: 5 });
    renderArchitectureState(state.architectureState);
    setMessage("正在准备有界代码上下文…");
    try {
      const generatorChoice = readModelChoice("generator");
      const reviewerChoice = readModelChoice("review");
      const res = await apiFetch("/api/architecture/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: state.selectedProjectId,
          providerId: generatorChoice.providerId,
          model: generatorChoice.model,
          reviewerProviderId: reviewerChoice.providerId,
          reviewerModel: reviewerChoice.model,
        }),
      });
      const data = await readJsonResponse(res, "Architecture 生成");
      if (!res.ok || !data.ok) throw new Error(responseError(res, data, "生成启动失败"));
      state.architectureTaskId = data.taskId;
      state.architectureStarting = false;
      setMessage("正在生成 Architecture 语义草稿…");
      pollArchitectureTask();
    } catch (err) {
      state.architectureStarting = false;
      renderArchitectureProgress({ kind: "generation", status: "failed", progress: 5 });
      scheduleArchitectureProgressHide();
      setMessage(`生成启动失败：${err.message}`, "error");
      renderArchitectureState(state.architectureState);
    }
  }

  async function startArchitectureReview() {
    if (!state.selectedProjectId || state.architectureStarting || state.architectureTaskId || state.taskId) return;
    state.architectureStarting = true;
    if (state.architectureProgressHideTimer) clearTimeout(state.architectureProgressHideTimer);
    state.architectureProgressHideTimer = null;
    renderArchitectureProgress({ kind: "review", status: "preparing", progress: 10 });
    renderArchitectureState(state.architectureState);
    setMessage("正在准备 AI 独立复审…");
    try {
      const reviewerChoice = readModelChoice("review");
      const res = await apiFetch("/api/architecture/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: state.selectedProjectId,
          reviewerProviderId: reviewerChoice.providerId,
          reviewerModel: reviewerChoice.model,
        }),
      });
      const data = await readJsonResponse(res, "Architecture 复审");
      if (!res.ok || !data.ok) throw new Error(responseError(res, data, "复审启动失败"));
      state.architectureTaskId = data.taskId;
      state.architectureStarting = false;
      setMessage("正在进行 Architecture AI 独立复审…");
      pollArchitectureTask();
    } catch (err) {
      state.architectureStarting = false;
      renderArchitectureProgress({ kind: "review", status: "review_failed", progress: 10 });
      scheduleArchitectureProgressHide();
      setMessage(`复审启动失败：${err.message}`, "error");
      renderArchitectureState(state.architectureState);
    }
  }

  async function pollArchitectureTask() {
    if (!state.architectureTaskId) return;
    if (state.architecturePollTimer) clearTimeout(state.architecturePollTimer);
    try {
      const res = await apiFetch(`/api/architecture/tasks/${encodeURIComponent(state.architectureTaskId)}?projectId=${encodeURIComponent(state.selectedProjectId)}`);
      const data = await readJsonResponse(res, "Architecture 任务");
      if (!res.ok) throw new Error(responseError(res, data, "任务读取失败"));
      renderArchitectureProgress(data);
      if (["preparing", "generating", "validating", "committing_draft", "reviewing", "committing_review", "cancelling"].includes(data.status)) {
        const labels = { preparing: "准备上下文", generating: "模型生成", validating: "确定性校验", committing_draft: "写入确定性草稿", reviewing: "AI 独立复审", committing_review: "写入复审报告", cancelling: "正在取消" };
        const reviewStage = data.status === "reviewing" || data.status === "committing_review";
        const activeProviderId = reviewStage ? data.reviewerProviderId : data.providerId;
        const activeModel = reviewStage ? data.reviewerModel : data.model;
        els.architectureStatus.textContent = `${labels[data.status] || data.status} · ${activeProviderId || ""} ${activeModel || ""}`.trim();
        els.cancelArchitectureBtn.disabled = data.status === "committing_draft" || data.status === "committing_review";
        state.architecturePollTimer = setTimeout(pollArchitectureTask, data.status === "cancelling" ? 800 : 1200);
        return;
      }
      const completed = data.status === "completed";
      if (data.projectId && data.projectId !== state.selectedProjectId) {
        state.architectureTaskId = null;
        state.architectureStarting = false;
        return;
      }
      state.architectureTaskId = null;
      state.architectureStarting = false;
      if (completed) {
        const verdictLabels = { pass: "通过", revise: "建议修订", reject: "拒绝" };
        setMessage(`语义草稿已生成，AI 复审${verdictLabels[data.reviewVerdict] || data.reviewVerdict || "完成"}；请人工确认`, "success");
      } else if (data.status === "review_failed") {
        setMessage(`草稿已通过确定性校验，但 AI 复审失败${data.error ? `：${data.error}` : ""}`, "error");
      } else {
        setMessage(`语义草稿${data.status === "cancelled" ? "已取消" : "生成失败"}${data.error ? `：${data.error}` : ""}`, "error");
      }
      scheduleArchitectureProgressHide();
      await refreshArchitectureState();
    } catch (err) {
      state.architectureTaskId = null;
      state.architectureStarting = false;
      renderArchitectureProgress({ status: "failed", progress: Number(els.progressBar.value) || 0 });
      scheduleArchitectureProgressHide();
      setMessage(`Architecture 任务轮询失败：${err.message}`, "error");
      renderArchitectureState(state.architectureState);
    }
  }

  async function cancelArchitectureGeneration() {
    if (!state.architectureTaskId) return;
    try {
      const res = await apiFetch(`/api/architecture/tasks/${encodeURIComponent(state.architectureTaskId)}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: state.selectedProjectId }),
      });
      const data = await readJsonResponse(res, "取消 Architecture 生成");
      if (!res.ok) throw new Error(responseError(res, data, "取消失败"));
      setMessage("已请求取消 Architecture 生成");
    } catch (err) {
      setMessage(`取消失败：${err.message}`, "error");
    }
  }

  function openArchitectureReview() {
    const data = state.architectureState;
    if (!data?.hasDraft || !data.draft || !data.hasReview || !data.review) return;
    const layers = [...(data.draft.layers || []), data.draft.fallbackLayer].filter(Boolean);
    const macros = data.draft.architectureOverview?.macroDomains || [];
    const evidenceCount = Object.values(data.draft.evidence || {}).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0);
    const reviewer = [data.reviewMeta?.reviewerProviderId, data.reviewMeta?.reviewerModel].filter(Boolean).join(" / ") || "未知模型";
    els.reviewSummary.textContent = `${layers.length} 个语义层 · ${macros.length} 个宏观域 · ${evidenceCount} 条路径证据 · 草稿 ${data.draftMeta?.overlaySha256 || "未知"} · 复审 ${data.reviewMeta?.reviewReportSha256 || "未知"} · ${reviewer}`;

    const verdictLabels = { pass: "通过", revise: "建议修订", reject: "拒绝" };
    const verdict = data.review.verdict || "unknown";
    els.aiReviewVerdict.className = `ca-review-verdict ${verdict}`;
    els.aiReviewVerdict.textContent = `${verdictLabels[verdict] || verdict} · ${Math.round((data.review.confidence || 0) * 100)}%`;
    els.aiReviewSummary.textContent = verdict === "reject"
      ? `${data.review.summary || "无复审摘要"} AI 复审给出“拒绝”；继续采用代表你明确覆盖该建议。`
      : data.review.summary || "无复审摘要";
    els.aiReviewFindings.replaceChildren();

    const reviewItems = [
      ...(data.review.findings || []).map((finding) => ({
        kind: ["low", "medium", "high"].includes(finding.severity) ? finding.severity : "medium",
        title: `${finding.layerId || "全局"} · ${finding.issue}`,
        detail: `建议：${finding.suggestion}`,
        evidencePaths: finding.evidencePaths || [],
      })),
      ...(data.review.missingAreas || []).map((area) => ({
        kind: "missing",
        title: `遗漏领域 · ${area.name}`,
        detail: area.reason,
        evidencePaths: area.evidencePaths || [],
      })),
    ];
    if (reviewItems.length === 0) {
      const item = document.createElement("li");
      item.className = "pass";
      item.textContent = "AI 复审未发现需要修订的问题。";
      els.aiReviewFindings.appendChild(item);
    } else {
      for (const reviewItem of reviewItems) {
        const item = document.createElement("li");
        item.className = reviewItem.kind;
        const title = document.createElement("strong");
        title.textContent = reviewItem.title;
        const detail = document.createElement("span");
        detail.textContent = reviewItem.detail;
        item.append(title, detail);
        if (reviewItem.evidencePaths.length > 0) {
          const evidenceList = document.createElement("ul");
          evidenceList.className = "ca-review-evidence";
          for (const evidencePath of reviewItem.evidencePaths) {
            const pathItem = document.createElement("li");
            pathItem.textContent = evidencePath;
            evidenceList.appendChild(pathItem);
          }
          item.appendChild(evidenceList);
        }
        els.aiReviewFindings.appendChild(item);
      }
    }
    for (const aspect of data.review.positiveAspects || []) {
      const item = document.createElement("li");
      item.className = "positive";
      item.textContent = `肯定项 · ${aspect}`;
      els.aiReviewFindings.appendChild(item);
    }

    els.reviewJson.textContent = JSON.stringify(data.draft, null, 2);
    els.reviewConfirmText.textContent = verdict === "reject"
      ? "我已阅读 AI 复审意见，并明确决定覆盖其拒绝建议；我已核对路径证据和架构边界，同意采用此草稿"
      : "我已阅读 AI 复审意见，并核对路径证据和架构边界，同意采用此草稿";
    els.reviewCheckbox.checked = false;
    els.adoptArchitectureBtn.disabled = true;
    els.reviewDialog.hidden = false;
    document.querySelector(".ca-shell")?.setAttribute("inert", "");
    els.reviewCloseBtn.focus();
  }

  function closeArchitectureReview() {
    els.reviewDialog.hidden = true;
    document.querySelector(".ca-shell")?.removeAttribute("inert");
    els.architectureNextBtn.focus();
  }

  async function adoptArchitectureDraft() {
    const expectedSha256 = state.architectureState?.draftMeta?.overlaySha256 || "";
    const expectedReviewSha256 = state.architectureState?.reviewMeta?.reviewReportSha256 || "";
    if (!els.reviewCheckbox.checked || !expectedSha256 || !expectedReviewSha256) return;
    setBusy(els.adoptArchitectureBtn, true);
    try {
      const res = await apiFetch("/api/architecture/adopt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: state.selectedProjectId, expectedSha256, expectedReviewSha256 }),
      });
      const data = await readJsonResponse(res, "采用 Architecture 草稿");
      if (!res.ok || !data.ok) throw new Error(responseError(res, data, "采用失败"));
      closeArchitectureReview();
      setMessage("语义草稿已采用，正在启动 Architecture 重建…", "success");
      await refreshProjects();
      await refreshArchitectureState();
      const started = await startBuild({ openArchitectureWhenReady: true });
      if (!started) await checkStatus();
    } catch (err) {
      setMessage(`采用失败：${err.message}`, "error");
    } finally {
      setBusy(els.adoptArchitectureBtn, false);
    }
  }

  // ─── 构建任务 ─────────────────────────────────────────────

  async function startBuild({ openArchitectureWhenReady = false } = {}) {
    if (state.taskId || state.buildStarting) {
      setMessage("构建任务已在运行");
      return false;
    }
    if (state.architectureTaskId || state.architectureStarting) {
      setMessage("语义生成期间不能开始构建", "error");
      return false;
    }
    const projectId = state.selectedProjectId;
    if (!projectId) {
      setMessage("请先选择项目", "error");
      return false;
    }
    state.openArchitectureAfterBuild = false;
    state.buildStarting = true;
    setBuildControls(true, false);
    setMessage("启动构建…");
    try {
      const res = await apiFetch("/api/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const data = await readJsonResponse(res, "构建启动");
      const error = responseError(res, data, "构建启动失败");
      if (error || !data.ok) {
        setMessage(error || data.error || "构建启动失败", "error");
        state.buildStarting = false;
        setBuildControls(false, false);
        return false;
      }
      state.taskId = data.taskId;
      state.openArchitectureAfterBuild = openArchitectureWhenReady;
      state.buildStarting = false;
      state.cancelRequested = false;
      setBuildControls(true, true);
      setMessage(`构建中: ${state.taskId}`);
      els.logPanel.classList.remove("ca-hidden");
      els.log.textContent = "";
      els.cancelBtn.focus();
      pollTask();
      return true;
    } catch (err) {
      setMessage("构建启动失败: " + err.message, "error");
      state.buildStarting = false;
      setBuildControls(false, false);
      return false;
    }
  }

  async function cancelBuild() {
    if (!state.taskId || state.cancelRequested) return;
    state.cancelRequested = true;
    setBusy(els.cancelBtn, true);
    setMessage("正在请求取消…");
    try {
      const res = await apiFetch(`/api/tasks/${encodeURIComponent(state.taskId)}/cancel`, { method: "POST" });
      if (!res.ok) {
        const data = await readJsonResponse(res, "取消构建");
        state.cancelRequested = false;
        setBusy(els.cancelBtn, false);
        setMessage(responseError(res, data, "取消失败") || "取消失败", "error");
      } else {
        setMessage("已请求取消，等待进程退出…");
      }
    } catch (err) {
      state.cancelRequested = false;
      setBusy(els.cancelBtn, false);
      setMessage("取消失败: " + err.message, "error");
    }
  }

  async function pollTask() {
    if (!state.taskId) return;
    if (state.pollTimer) clearTimeout(state.pollTimer);
    try {
      const res = await apiFetch(`/api/tasks/${encodeURIComponent(state.taskId)}`);
      const data = await readJsonResponse(res, "构建任务");
      const error = responseError(res, data, "任务轮询失败");
      if (error) throw new Error(error);
      const status = data.status || "unknown";
      const logs = Array.isArray(data.logTail) ? data.logTail.join("\n") : "";
      if (logs) els.log.textContent = logs;

      if (status === "running") {
        setMessage("构建中…");
        state.pollTimer = setTimeout(pollTask, 1500);
      } else if (status === "cancelling") {
        setMessage("正在取消，等待进程退出…");
        state.pollTimer = setTimeout(pollTask, 1000);
      } else if (status === "completed") {
        setMessage("构建完成", "success");
        await finishBuild(true);
      } else if (["failed", "cancelled"].includes(status)) {
        setMessage(`构建${status === "failed" ? "失败" : "已取消"}${data.error ? ": " + data.error : ""}`, "error");
        await finishBuild(false);
      } else {
        setMessage(`任务状态: ${status}`);
        state.pollTimer = setTimeout(pollTask, 2000);
      }
    } catch (err) {
      setMessage("任务轮询失败: " + err.message, "error");
      await finishBuild(false);
    }
  }

  async function finishBuild(completed) {
    if (state.pollTimer) clearTimeout(state.pollTimer);
    const openArchitecture = completed && state.openArchitectureAfterBuild;
    state.pollTimer = null;
    state.taskId = null;
    state.buildStarting = false;
    state.cancelRequested = false;
    state.openArchitectureAfterBuild = false;
    setBuildControls(false, false);
    await refreshProjects();
    const project = state.projects.find((item) => item.projectId === state.selectedProjectId);
    if (openArchitecture && project?.hasArchitecture) updateBundleSelection("architecture", true);
    await checkStatus();
    if (openArchitecture && project?.hasArchitecture) els.bundleArch.focus();
  }

  function setBusy(button, busy) {
    button.disabled = busy;
    button.setAttribute("aria-busy", String(busy));
  }

  function setBuildControls(active, cancellable) {
    setBusy(els.buildBtn, active);
    els.projectSelect.disabled = active;
    els.candidateSearch.disabled = active || !!state.candidateError || state.candidates.length === 0;
    els.registerInput.disabled = active;
    els.registerBtn.disabled = active;
    els.cancelBtn.disabled = !cancellable;
    els.cancelBtn.setAttribute("aria-busy", String(active && !cancellable));
    updateArchitectureAvailability({
      hasArchitecture: state.projects.find((project) => project.projectId === state.selectedProjectId)?.hasArchitecture,
      project: state.projects.find((project) => project.projectId === state.selectedProjectId),
    });
    renderArchitectureState(state.architectureState);
    renderCandidateTable();
  }

  // ─── 事件绑定 ─────────────────────────────────────────────

  window.addEventListener("message", (event) => {
    if (event.source !== els.frame.contentWindow) return;
    const data = event.data;
    if (!data || data.protocol !== "hana.code-atlas.viewer" || !String(data.type || "").startsWith("viewer.")) return;
    const detail = String(data.detail || "Viewer runtime error");
    const mounted = (els.frame.contentDocument?.getElementById("root")?.childElementCount || 0) > 0;
    if (!mounted) setPlaceholder("Viewer 运行失败", detail);
    setMessage(detail, "error");
  });

  els.projectSelect.addEventListener("change", () => {
    if (state.taskId || state.buildStarting || state.architectureTaskId || state.architectureStarting) {
      els.projectSelect.value = state.selectedProjectId;
      setMessage("构建或语义生成期间不能切换项目", "error");
      return;
    }
    state.selectedProjectId = els.projectSelect.value;
    checkStatus();
  });

  els.refreshBtn.addEventListener("click", refreshAll);

  els.candidateSearch.addEventListener("input", renderCandidateTable);
  els.candidateSearch.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !els.candidateSearch.value) return;
    els.candidateSearch.value = "";
    renderCandidateTable();
  });

  els.candidateTableBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button || state.taskId || state.buildStarting || state.architectureTaskId || state.architectureStarting) return;
    if (button.dataset.action === "open") {
      const projectId = button.dataset.projectId || "";
      if (!state.projects.some((project) => project.projectId === projectId)) return;
      state.selectedProjectId = projectId;
      els.projectSelect.value = projectId;
      setMessage("已切换到注册项目", "success");
      checkStatus();
      return;
    }
    const root = button.dataset.root || "";
    if (!root) return;
    els.registerInput.value = root;
    els.registerInput.focus();
    setMessage("已选择索引项目，请确认后注册");
  });

  els.registerBtn.addEventListener("click", registerProject);
  els.registerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") registerProject();
  });

  els.bundleArch.addEventListener("click", () => setBundle("architecture"));
  els.bundleFull.addEventListener("click", () => setBundle("full"));

  els.providerSelect.addEventListener("change", renderArchitectureModels);
  els.reviewProviderSelect.addEventListener("change", renderReviewModels);
  els.generatorCustomToggle.addEventListener("change", () => setCustomModelMode("generator", els.generatorCustomToggle.checked));
  els.reviewCustomToggle.addEventListener("change", () => setCustomModelMode("review", els.reviewCustomToggle.checked));
  els.providerCustom.addEventListener("input", () => renderArchitectureState(state.architectureState));
  els.modelCustom.addEventListener("input", () => renderArchitectureState(state.architectureState));
  els.reviewProviderCustom.addEventListener("input", () => renderArchitectureState(state.architectureState));
  els.reviewModelCustom.addEventListener("input", () => renderArchitectureState(state.architectureState));
  els.architectureNextBtn.addEventListener("click", runArchitectureNext);
  els.cancelArchitectureBtn.addEventListener("click", cancelArchitectureGeneration);
  els.regenerateArchitectureBtn.addEventListener("click", startArchitectureGeneration);
  els.reviewCloseBtn.addEventListener("click", closeArchitectureReview);
  els.reviewCancelBtn.addEventListener("click", closeArchitectureReview);
  els.reviewCheckbox.addEventListener("change", () => {
    els.adoptArchitectureBtn.disabled = !els.reviewCheckbox.checked;
  });
  els.adoptArchitectureBtn.addEventListener("click", adoptArchitectureDraft);
  els.reviewDialog.addEventListener("click", (event) => {
    if (event.target === els.reviewDialog) closeArchitectureReview();
  });
  document.addEventListener("keydown", (event) => {
    if (els.reviewDialog.hidden) return;
    if (event.key === "Escape") {
      closeArchitectureReview();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...els.reviewDialog.querySelectorAll("button:not(:disabled), input:not(:disabled), summary, [tabindex]:not([tabindex='-1'])")];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  els.buildBtn.addEventListener("click", () => startBuild());
  els.cancelBtn.addEventListener("click", cancelBuild);

  // ─── 启动 ─────────────────────────────────────────────────

  renderDeps();
  refreshAll();
})();
