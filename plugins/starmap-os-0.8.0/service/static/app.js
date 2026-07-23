/* 星图 · 前端逻辑 */
(function() {
"use strict";

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
let toastTimer;
const toast = (msg, err) => {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
};
const api = async (url, body) => {
  const opt = { headers: { "Content-Type": "application/json" } };
  if (body !== undefined) { opt.method = "POST"; opt.body = JSON.stringify(body); }
  const res = await fetch(url, opt);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "请求失败");
  return data;
};
let pluginRequestSequence = 0;
const pluginSync = payload => new Promise((resolve, reject) => {
  if (window.parent === window) {
    reject(new Error("请从 Hanako 的星图插件页面执行探索")); return;
  }
  const requestId = `starmap-${Date.now()}-${++pluginRequestSequence}`;
  const timer = setTimeout(() => {
    window.removeEventListener("message", receive);
    reject(new Error("Hanako 处理超时，请稍后重试"));
  }, 180000);
  function receive(event) {
    if (event.source !== window.parent || event.data?.type !== "starmap:plugin_sync_result"
        || event.data.requestId !== requestId) return;
    clearTimeout(timer); window.removeEventListener("message", receive);
    const result = event.data.result || {};
    if (!result.ok) reject(new Error(result.error || "Hanako 插件调用失败"));
    else resolve(result);
  }
  window.addEventListener("message", receive);
  window.parent.postMessage({ type: "starmap:plugin_sync", requestId, payload }, "*");
});
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c]);
const fmtTime = ts => { if (!ts) return ""; const d = new Date(ts); return d.getHours()+":"+String(d.getMinutes()).padStart(2,"0"); };
const fmtDate = ts => { if (!ts) return ""; return (ts+"").slice(0,10); };

/* 导航 */
const PAGES = [
  { id:"overview", ico:"⌂", label:"总览",     desc:"看数据" },
  { id:"audit",     ico:"✶", label:"审核",     desc:"保存/删除卡片" },
  { id:"knowledge", ico:"❖", label:"知识库",    desc:"已保存的卡片" },
  { id:"projects",  ico:"▣", label:"项目",      desc:"跨任务共享记忆" },
  { id:"review",    ico:"◎", label:"复盘",     desc:"周复盘与月复盘" },
  { id:"trash",     ico:"🗑", label:"废纸篓",   desc:"恢复误删" },
];

const NAV = PAGES.map(p => `<button class="nav-item" data-page="${p.id}" title="${p.desc}"><span class="ico">${p.ico}</span><span>${p.label}</span></button>`).join("");
$("#nav").innerHTML = NAV;

const PAGE_NAMES = { overview:"总览", audit:"审核", knowledge:"知识库", projects:"共享项目", review:"复盘", trash:"废纸篓" };
const STAGE_LABELS = { exploring:"探索中", direction_set:"方向已形成", action_ready:"等待行动", blocked:"存在阻塞", deep_dive:"值得深挖", archive_ready:"可以归档" };
const RECOMMENDATION_LABELS = { continue:"继续当前会话", new_session:"新开会话深挖", archive:"归档" };
const PAGE_DESC = {
  overview:"看今天有多少卡片待处理",
  audit:"看卡片，保存或删除。保存的自动进入知识库",
  knowledge:"已保存的卡片，按类型和领域检索",
  projects:"把多个 Hanako 任务合并成可持续更新的项目记忆",
  review:"总结这一段时间沉淀了哪些知识和技能",
  trash:"误删的卡片在这里恢复",
};

let currentPage = "overview";

function showPage(id) {
  currentPage = id;
  document.body.dataset.page = id;
  $$(".page").forEach(p => p.classList.toggle("active", p.id === "page-" + id));
  $$(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.page === id));
  $$(".route").forEach(n => n.classList.toggle("active", n.dataset.page === id));
  $("#page-title").textContent = PAGE_NAMES[id] || "";
  $("#page-subtitle").textContent = PAGE_DESC[id] || "";
  (renderers[id] || (()=>{}))();
}

window.navigateTo = function(id) { showPage(id); };

$("#nav").addEventListener("click", e => {
  const item = e.target.closest(".nav-item");
  if (item) showPage(item.dataset.page);
});

/* 弹窗 */
function openModal(title, bodyHtml, onClose) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = bodyHtml;
  $("#modal").removeAttribute("hidden");
  const close = () => { $("#modal").setAttribute("hidden",""); if (onClose) onClose(); };
  $("#modal-close").onclick = close;
  $("#modal").onclick = e => { if (e.target === $("#modal")) close(); };
  return close;
}

function confirmAction(title, message, confirmLabel="确认删除") {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; resolve(value); } };
    openModal(title, `<div class="confirm-message">${esc(message)}</div><div class="card-actions"><button class="btn" id="confirm-cancel">取消</button><button class="btn danger" id="confirm-submit">${esc(confirmLabel)}</button></div>`, () => finish(false));
    setTimeout(() => {
      $("#confirm-cancel").onclick = () => { $("#modal").setAttribute("hidden", ""); finish(false); };
      $("#confirm-submit").onclick = () => { $("#modal").setAttribute("hidden", ""); finish(true); };
    }, 0);
  });
}

/* 渲染器 */
const renderers = {};

/* ======== 总览 ======== */
renderers.overview = async () => {
  try {
    const [ov, conv, aiStatus] = await Promise.all([
      api("/api/starmap/overview"),
      api("/api/starmap/conversations?limit=100"),
      api("/api/starmap/ai-status")
    ]);
    const c = ov.conversations || {};
    const k = ov.knowledge || {};
    const t = ov.trash || {};
    const metrics = [
      ["待审核", c.pending_artifacts || 0],
      ["对话", c.sessions || 0],
      ["已确认", c.confirmed_artifacts || 0],
      ["待AI提炼", c.pending_ai_sessions || 0],
      ["提炼失败", c.failed_ai_sessions || 0],
      ["平均卡片", c.avg_artifacts_per_session || 0],
      ["确认率", `${c.confirmation_rate || 0}%`],
      ["平均审核", `${c.avg_review_seconds || 0}秒`],
      ["知识笔记", k.notes || 0],
      ["废纸篓", t.total || 0],
    ];
    $("#ov-metrics").innerHTML = metrics.map(([l,v]) =>
      `<div class="metric"><div class="value">${v}</div><div class="label">${l}</div></div>`
    ).join("");
    const aiState = aiStatus.status === "healthy" ? "运行正常" : aiStatus.status === "pending" ? "等待提炼" : "存在失败任务";
    $("#ai-runtime").innerHTML = `<div><small>调用方式</small><b>${esc(aiStatus.interface)}</b></div><div><small>AI 来源</small><b>${esc(aiStatus.provider)}</b></div><div><small>具体模型</small><b>${esc(aiStatus.model)}</b></div><div><small>插件状态</small><b class="ai-state ${esc(aiStatus.status)}">${esc(aiState)}</b></div><div><small>插件版本</small><b>${esc(aiStatus.plugin_id)} · v${esc(aiStatus.plugin_version)}</b></div><div><small>处理情况</small><b>${aiStatus.ready_sessions} 完成 · ${aiStatus.pending_sessions} 等待 · ${aiStatus.failed_sessions} 失败</b></div>`;
    // 展示每段对话的摘要
    const items = conv.items || [];
    if (!items.length) {
      $("#ov-list").innerHTML = '<div class="empty">暂无对话</div>'; return;
    }
    $("#ov-list").innerHTML = items.map(s => {
      const pc = s.pending_count || 0;
      const cc = s.confirmed_count || 0;
      const all = pc + cc;
      const progress = all > 0 ? Math.round(cc / all * 100) : 0;
      const summary = s.conversation_summary || {};
      const stage = STAGE_LABELS[summary.stage] || (s.extraction_status === "failed" ? "提炼失败" : s.extraction_status === "pending_ai" ? "等待 AI" : "已采集");
      const recommendation = RECOMMENDATION_LABELS[summary.recommendation] || "";
      return `<div class="card conversation-card">
        <div class="card-head">
          <span class="card-type">${esc(stage)}</span>
          <span class="card-time">${all} 张卡片 · ${progress}% 已确认</span>
        </div>
        <div class="card-title">${esc(s.title || '未命名')}</div>
        ${summary.one_liner ? `<div class="card-body">${esc(summary.one_liner)}</div>` : ""}
        ${summary.next_step ? `<div class="card-time" style="margin-top:6px">下一步：${esc(summary.next_step)}</div>` : ""}
        ${recommendation ? `<div class="card-time">建议：${esc(recommendation)}</div>` : ""}
        <div class="card-actions conversation-actions">
          <button class="btn small" onclick="window._openConversation('${esc(s.session_id)}')">读取原文</button>
          <button class="btn primary small" onclick="window._extractConversation(this,'${esc(s.session_id)}')">AI 提炼</button>
          <button class="btn danger small" onclick="window._deleteConversation('${esc(s.session_id)}','${esc(s.title || '未命名')}')">删除副本</button>
        </div>
      </div>`;
    }).join("");
    bindOverviewActions();
  } catch(e) { toast("加载失败"); }
};

window._extractConversation = async (button, sessionId) => {
  const old = button.textContent; button.disabled = true; button.textContent = "提炼中…";
  try {
    const result = await pluginSync({ action: "explore", session_id: sessionId });
    const extraction = result.result || {};
    if (extraction.extraction_failed) throw new Error("Hanako AI 提炼失败，原文已保留");
    if (extraction.queued) {
      toast("AI 提炼已完成，星图服务暂不可用，结果正在等待同步");
      button.disabled = false; button.textContent = old;
      return;
    }
    const detail = await api("/api/starmap/conversations/session?id=" + encodeURIComponent(sessionId));
    const pending = (detail.artifacts || []).filter(item => item.status === "pending_review");
    if (pending.length) toast(`AI 提炼完成，${pending.length} 张卡片已进入待审核`);
    else toast("AI 提炼完成，但本次没有生成可审核卡片");
    await renderers.overview();
  } catch (error) {
    toast(error.message || "AI 提炼失败", true);
    button.disabled = false; button.textContent = old;
  }
};

window._deleteConversation = async (sessionId, title) => {
  const ok = await confirmAction("删除星图副本", `确定删除“${title}”在星图中的原文和待审核卡片吗？Hanako 原对话不会删除，之后点“探索同步”可以重新读取。`);
  if (!ok) return;
  try {
    await api("/api/starmap/conversations/delete", { session_id: sessionId });
    toast("星图副本已删除；Hanako 原对话仍保留");
    await renderers.overview();
  } catch (error) { toast(error.message || "删除失败", true); }
};

/* 从总览打开真实会话，而不是把所有卡片都导向同一个审核页。 */
window._openConversation = async sessionId => {
  openModal("读取真实对话", '<div class="empty">正在读取 Hanako 原始消息…</div>');
  try {
    const detail = await api("/api/starmap/conversations/session?id=" + encodeURIComponent(sessionId));
    const session = detail.session || {};
    const messages = detail.messages || [];
    $("#modal-title").textContent = session.title || "未命名对话";
    $("#modal-body").innerHTML = `<div class="conversation-meta"><span>${messages.length} 条真实消息</span><span>${esc(session.agent_name || "Hanako")}</span><span>${esc(fmtDate(session.updated_at || session.created_at))}</span></div>
      ${renderConversationSummary(session)}
      <div class="conversation-thread">${messages.length ? messages.map((message, index) => {
        const role = message.role === "user" ? "你" : message.role === "assistant" ? "Hanako" : (message.role || "系统");
        return `<article class="message-row ${message.role === "user" ? "from-user" : "from-agent"}"><header><b>${esc(role)}</b><small>#${index + 1} ${esc(fmtTime(message.created_at))}</small></header><div>${esc(message.content || "(空消息)")}</div></article>`;
      }).join("") : '<div class="empty">这段会话尚未同步消息</div>'}</div>`;
  } catch(e) {
    $("#modal-body").innerHTML = `<div class="empty">读取失败：${esc(e.message || "未知错误")}</div>`;
  }
};

/* B. 手动摄入：调 /api/starmap/ingest */
function bindOverviewActions() {
  const exploreAll = $("#btn-explore-all");
  if (exploreAll && !exploreAll.dataset.bound) {
    exploreAll.dataset.bound = "1";
    exploreAll.onclick = async () => {
      const old = exploreAll.textContent; exploreAll.disabled = true; exploreAll.textContent = "正在探索 Hanako…";
      try {
        await pluginSync({ action: "backfill" });
        let finished = false;
        for (let attempt = 0; attempt < 900; attempt += 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const current = await pluginSync({ action: "status" });
          const progress = current.status?.backfill || {};
          if (progress.running) {
            exploreAll.textContent = `正在读取 ${progress.completed || 0}/${progress.total || "…"}`;
            continue;
          }
          finished = true;
          exploreAll.textContent = `探索完成 · 同步 ${progress.synced || 0} · 失败 ${progress.failed || 0}`;
          break;
        }
        if (!finished) throw new Error("探索仍在后台运行，请稍后刷新查看");
        toast("探索同步完成，今日观测已更新");
        await new Promise(resolve => setTimeout(resolve, 900));
        await renderers.overview();
      } catch (error) {
        toast(error.message || "探索同步失败", true);
        exploreAll.disabled = false; exploreAll.textContent = old;
      }
    };
  }
  const ingestBtn = $("#btn-ingest");
  if (ingestBtn && !ingestBtn.dataset.bound) {
    ingestBtn.dataset.bound = "1";
    ingestBtn.onclick = async () => {
      const text = $("#ingest-text").value;
      const title = $("#ingest-title").value;
      if (!text.trim()) { toast("请输入内容"); return; }
      try {
        await api("/api/starmap/ingest", { text, title: title || undefined });
        toast("已采集，等待审核");
        $("#ingest-text").value = "";
        $("#ingest-title").value = "";
        renderers.audit();
        renderers.overview();
      } catch(e) { toast("采集失败：" + (e.message || "")); }
    };
  }
  const addProvBtn = $("#btn-add-provider");
  if (addProvBtn && !addProvBtn.dataset.bound) {
    addProvBtn.dataset.bound = "1";
    addProvBtn.onclick = openAddProviderModal;
  }
}

/* E. 提供商(API Key)配置：GET/POST /api/starmap/providers */
let PROVIDER_PRESETS = [
  { id: "openai", label: "OpenAI" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "mimo", label: "Mimo" },
  { id: "custom", label: "Custom" },
];

async function loadProviders() {
  const list = $("#prov-list");
  if (!list) return;
  try {
    const r = await api("/api/starmap/providers");
    if (r.presets && r.presets.length) PROVIDER_PRESETS = r.presets;
    const provs = r.providers || [];
    list.innerHTML = provs.length ? provs.map(p => `
      <div class="card" style="padding:8px 10px;margin-bottom:6px">
        <div class="card-head">
          <span class="card-type">${esc(p.name || "")}</span>
          <span class="card-time">${esc(p.type || "")} · ${p.has_api_key ? "已配置 Key" : "未配置 Key"}</span>
        </div>
        <div class="card-body" style="font-size:0.74rem">${esc(p.base_url || "")}${p.model ? (" / " + esc(p.model)) : ""}</div>
        <div class="card-actions">
          ${p.id ? `<button class="btn small" onclick="window._setProviderRole('${esc(p.id)}')">设为 light</button>` : ""}
          ${p.id ? `<button class="btn danger small" onclick="window._delProvider('${esc(p.id)}')">删除</button>` : ""}
        </div>
      </div>`).join("")
      : '<div class="empty" style="padding:8px">暂无提供商。分类/总结在离线模式下也可使用。</div>';
  } catch(e) {
    list.innerHTML = '<div class="empty">加载提供商失败</div>';
  }
}

function openAddProviderModal() {
  const opts = PROVIDER_PRESETS.map(p => `<option value="${esc(p.id)}">${esc(p.label || p.id)}</option>`).join("");
  openModal("添加提供商",
    `<div class="form-row"><label>名称</label><input id="prov-name" class="inp" placeholder="如：我的 OpenAI"></div>
     <div class="form-row"><label>类型</label><select id="prov-type" class="inp">${opts}</select></div>
     <div class="form-row"><label>Base URL</label><input id="prov-url" class="inp" placeholder="https://api.openai.com/v1"></div>
     <div class="form-row"><label>API Key</label><input id="prov-key" class="inp" type="password" placeholder="sk-..."></div>
     <div class="form-row"><label>模型</label><input id="prov-model" class="inp" placeholder="gpt-4o-mini"></div>
     <button class="btn primary" id="prov-add">添加</button>`);
  setTimeout(() => {
    $("#prov-add").onclick = async () => {
      const name = $("#prov-name").value;
      const type = $("#prov-type").value;
      const base_url = $("#prov-url").value;
      const api_key = $("#prov-key").value;
      const model = $("#prov-model").value;
      if (!name.trim()) { toast("请填写名称"); return; }
      try {
        await api("/api/starmap/providers", { action: "add", provider: { name, type, base_url, api_key, model } });
        toast("已添加提供商");
        $("#modal").setAttribute("hidden", "");
        loadProviders();
      } catch(e) { toast("添加失败：" + (e.message || "")); }
    };
  }, 50);
}

window._setProviderRole = async (id) => {
  try {
    await api("/api/starmap/providers", { action: "set_role", role: "light", id });
    toast("已设为 light 角色");
    loadProviders();
  } catch(e) { toast("设置失败：" + (e.message || "")); }
};

window._delProvider = async (id) => {
  if (!(await confirmAction("删除提供商", "删除该提供商配置？", "删除"))) return;
  try {
    await api("/api/starmap/providers", { action: "delete", id });
    toast("已删除");
    loadProviders();
  } catch(e) { toast("删除失败：" + (e.message || "")); }
};

/* ======== 审核 ======== */
let projectCandidates = [];
renderers.audit = async () => {
  try {
    const [r, projects] = await Promise.all([api("/api/starmap/conversations?limit=100"), api("/api/starmap/projects")]);
    projectCandidates = projects.items || [];
    const items = (r.items || []).filter(s => (s.pending_count || 0) > 0 ||
      (!s.project_id && (s.project_suggestion?.project_id || s.project_suggestion?.should_create_project) && s.project_suggestion?.status === "pending"));
    const total = items.reduce((s,i) => s + (i.pending_count||0), 0);
    $("#au-metrics").innerHTML = `<div class="metric"><div class="value">${total}</div><div class="label">待审核</div></div>`;
    if (!items.length) { $("#au-list").innerHTML = '<div class="empty">没有待审核内容，已经处理完毕</div>'; return; }
    $("#au-list").innerHTML = items.map(s => `
      <div class="card" data-sid="${esc(s.session_id)}" style="cursor:pointer">
        <div class="card-head">
          <span class="card-type">${esc(s.status||"")}</span>
          <span class="card-time" data-audit-count>${(s.pending_count||0)} 项待审 · ${s.message_count||0} 条消息</span>
        </div>
        <div class="card-title">${esc(s.title||"未命名")}</div>
      </div>
    `).join("");
    // 点击对话在下方展开卡片（内联）
    $("#au-list").querySelectorAll(".card").forEach(el => {
      el.onclick = async () => {
        const sid = el.dataset.sid;
        const existing = el.nextElementSibling;
        if (existing && existing.classList.contains("au-cards-area")) {
          existing.remove();
          el.classList.remove("selected");
          return;
        }
        // 收起其他展开
        $$(".au-cards-area").forEach(a => a.remove());
        $$(".card.selected").forEach(c => c.classList.remove("selected"));
        el.classList.add("selected");
        const area = document.createElement("div");
        area.className = "au-cards-area";
        area.innerHTML = '<div class="empty" style="padding:8px 0;text-align:left;font-size:0.82rem">加载中…</div>';
        el.after(area);
        try {
          const detail = await api("/api/starmap/conversations/session?id="+encodeURIComponent(sid));
          const artifacts = (detail.artifacts || []).filter(item => item.status === "pending_review");
          let html = renderConversationSummary(detail.session || {});
          if (!artifacts.length) { area.innerHTML = html + '<div class="empty" style="padding:8px 0">暂无可审核卡片</div>'; return; }
          html += artifacts.map(a => renderArtifact(a, sid)).join("");
          area.innerHTML = html;
        } catch(e) { area.innerHTML = '<div class="empty">加载失败</div>'; }
      };
    });
  } catch(e) { toast("加载失败"); }
};

function renderConversationSummary(session) {
  const s = session.conversation_summary || {};
  const checkpoint = session.checkpoint || session.conversation_checkpoint || null;
  const extraction = session.extraction_status;
  if (!s.one_liner && !checkpoint && !session.project_suggestion && !session.project_id && extraction !== "failed" && extraction !== "pending_ai") return "";
  const statusText = extraction === "failed" ? `AI 提炼失败：${session.extraction_error || "等待下一轮重试"}`
    : extraction === "pending_ai" ? "原文已保存，等待 Hanako AI 提炼" : "";
  const unresolved = (s.unresolved || []).map(item => `<li>${esc(item)}</li>`).join("");
  return `${renderProjectSuggestion(session)}<div class="panel" style="margin:8px 0 12px">
    <div class="panel-title">${esc(STAGE_LABELS[s.stage] || "会话进度")}</div>
    ${s.one_liner ? `<div class="card-body">${esc(s.one_liner)}</div>` : ""}
    ${unresolved ? `<div class="card-time" style="margin-top:8px">未解决问题</div><ul>${unresolved}</ul>` : ""}
    ${s.next_step ? `<div class="card-time">下一步：${esc(s.next_step)}</div>` : ""}
    ${s.recommendation ? `<div class="card-time">建议：${esc(RECOMMENDATION_LABELS[s.recommendation] || s.recommendation)}</div>` : ""}
    ${statusText ? `<div class="card-time">${esc(statusText)}</div>` : ""}
    ${renderCheckpoint(checkpoint)}
  </div>`;
}

function renderProjectSuggestion(session) {
  const suggestion = session.project_suggestion || {};
  const confirmed = session.project_id;
  const projectName = id => (projectCandidates.find(p => p.id === id) || {}).name || id || "";
  if (confirmed) return `<div class="panel project-suggestion confirmed"><div class="card-head"><span class="panel-title">已归入项目</span><span class="card-type">用户已确认</span></div><div class="card-title">${esc(projectName(confirmed))}</div><button class="btn small" onclick="window._chooseProject('${esc(session.session_id)}')">更改项目</button></div>`;
  if (!suggestion.project_id && !suggestion.should_create_project) return "";
  if (suggestion.status && suggestion.status !== "pending") return suggestion.status === "dismissed" ? `<div class="panel project-suggestion"><span class="card-time">这段对话已暂不归类</span><button class="btn small" onclick="window._chooseProject('${esc(session.session_id)}')">重新选择项目</button></div>` : "";
  const confidence = Math.round(Number(suggestion.confidence || 0) * 100);
  const level = confidence >= 85 ? "高度匹配" : confidence >= 60 ? "建议确认" : "归属不确定";
  const target = suggestion.should_create_project ? `建议新建：${suggestion.suggested_name || "新项目"}` : `建议归入：${projectName(suggestion.project_id)}`;
  return `<div class="panel project-suggestion"><div class="card-head"><span class="panel-title">AI 项目归属建议</span><span class="card-type">${level} · ${confidence}%</span></div><div class="card-title">${esc(target)}</div><div class="card-body">${esc(suggestion.reason || "")}</div><div class="card-actions">${suggestion.should_create_project ? `<button class="btn primary small" onclick="window._createSuggestedProject('${esc(session.session_id)}')">创建并归入</button>` : `<button class="btn primary small" onclick="window._resolveProjectSuggestion('${esc(session.session_id)}','${esc(suggestion.project_id)}')">确认归入</button>`}<button class="btn small" onclick="window._chooseProject('${esc(session.session_id)}')">选择其他项目</button><button class="btn small" onclick="window._dismissProjectSuggestion('${esc(session.session_id)}')">暂不归类</button></div></div>`;
}

window._resolveProjectSuggestion = async (sessionId, projectId) => { try { await api("/api/starmap/projects", {action:"resolve_suggestion", session_id:sessionId, project_id:projectId}); toast("已确认项目归属"); renderers.audit(); } catch(e) { toast("确认失败：" + e.message); } };
window._dismissProjectSuggestion = async sessionId => { try { await api("/api/starmap/projects", {action:"resolve_suggestion", session_id:sessionId, resolution:"dismissed"}); toast("已暂不归类"); renderers.audit(); } catch(e) { toast("操作失败：" + e.message); } };
window._chooseProject = sessionId => {
  const options = projectCandidates.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
  openModal("选择项目", `<div class="form-row"><label>归入项目</label><select class="inp" id="suggestion-project"><option value="">请选择…</option>${options}</select></div><button class="btn primary" id="suggestion-confirm" ${options ? "" : "disabled"}>确认归入</button>`);
  setTimeout(() => { $("#suggestion-confirm").onclick = async () => { const id = $("#suggestion-project").value; if (!id) return toast("请选择项目"); await window._resolveProjectSuggestion(sessionId, id); $("#modal").setAttribute("hidden", ""); }; }, 0);
};
window._createSuggestedProject = async sessionId => {
  let name = "新项目";
  try { const detail = await api("/api/starmap/conversations/session?id=" + encodeURIComponent(sessionId)); name = detail.session?.project_suggestion?.suggested_name || name; } catch(e) {}
  openModal("创建建议项目", `<div class="form-row"><label>项目名称</label><input class="inp" id="suggested-project-name" value="${esc(name)}"></div><div class="form-row"><label>项目目标</label><textarea class="inp" id="suggested-project-goal" rows="3" placeholder="这个项目最终要实现什么？"></textarea></div><button class="btn primary" id="suggested-project-create">创建并归入</button>`);
  setTimeout(() => { $("#suggested-project-create").onclick = async () => { try { const created = await api("/api/starmap/projects", {action:"create", name:$("#suggested-project-name").value, goal:$("#suggested-project-goal").value}); await api("/api/starmap/projects", {action:"resolve_suggestion", session_id:sessionId, project_id:created.project.id}); $("#modal").setAttribute("hidden", ""); toast("项目已创建并完成归属"); renderers.audit(); } catch(e) { toast("创建失败：" + e.message); } }; }, 0);
};

function checkpointItems(value) {
  const formatItem = item => {
    if (item && typeof item === "object" && (item.attempt || item.reason || item.lesson)) {
      return `尝试：${item.attempt || "未说明"}；原因：${item.reason || "未说明"}；经验：${item.lesson || "未说明"}`;
    }
    return item && typeof item === "object" ? JSON.stringify(item) : item;
  };
  if (Array.isArray(value)) return value.filter(Boolean).map(formatItem);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => {
      const keyLabel = ({ files:"文件", services:"服务", versions:"版本", tests:"测试" })[key] || key;
      if (Array.isArray(item)) return item.filter(Boolean).map(v => `${keyLabel}：${v}`);
      if (item && typeof item === "object") return `${key}：${JSON.stringify(item)}`;
      return item === undefined || item === null || item === "" ? [] : `${keyLabel}：${item}`;
    });
  }
  return value ? [value] : [];
}

function checkpointSection(label, value) {
  const items = checkpointItems(value);
  if (!items.length) return "";
  return `<div style="margin-top:8px">
    <div class="card-time">${esc(label)}</div>
    <ul>${items.map(item => `<li>${esc(item)}</li>`).join("")}</ul>
  </div>`;
}

function renderCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== "object") return "";
  const covered = Array.isArray(checkpoint.covered_message_ids)
    ? checkpoint.covered_message_ids.length
    : Number(checkpoint.covered_message_count || checkpoint.covered_count || 0);
  const version = checkpoint.version ?? checkpoint.checkpoint_version ?? 1;
  const failed = checkpoint.status === "failed" || checkpoint.checkpoint_status === "failed" || checkpoint.error || checkpoint.last_error;
  const failedText = checkpoint.error || checkpoint.last_error || "本次检查点生成失败，覆盖进度未推进，可重试";
  return `<details class="content-details checkpoint-details">
    <summary><span>完整项目检查点 v${esc(version)}</span><small>覆盖 ${esc(covered)} 条消息</small></summary>
    <div class="details-body"><div class="card-head">
      <span class="card-type">增量检查点 v${esc(version)}</span>
      <span class="card-time">已覆盖 ${esc(covered)} 条消息${checkpoint.through_source_id ? ` · 至 ${esc(checkpoint.through_source_id)}` : ""}</span>
    </div>
    ${failed ? `<div class="card-time" style="color:var(--danger,#8b3a3a)">检查点失败：${esc(failedText)}</div>` : ""}
    ${checkpointSection("目标", checkpoint.goal || checkpoint.goals)}
    ${checkpointSection("已完成", checkpoint.completed)}
    ${checkpointSection("当前文件 / 系统状态", checkpoint.system_state)}
    ${checkpointSection("已确认决策", checkpoint.decisions)}
    ${checkpointSection("失败方案及原因", checkpoint.failed_attempts)}
    ${checkpointSection("未解决问题", checkpoint.unresolved)}
    ${checkpointSection("下一步", checkpoint.next_steps || checkpoint.next_step)}</div>
  </details>`;
}

const TYPE_LABELS = { knowledge:"知识", decision:"决策", action:"行动", question:"问题", goal:"目标", profile:"画像", reasoning_process:"推理", reasoned_content:"结论", reasoning_summary:"完整思考总结" };
const TYPE_COLORS = { knowledge:"#537D96", decision:"#456A80", action:"#7BAE7F", question:"#8E9196", goal:"#6B6F73", profile:"#8B3A3A", reasoning_process:"#8E9196", reasoned_content:"#537D96" };

function renderArtifact(a, sid) {
  const type = a.type || "knowledge";
  const tl = TYPE_LABELS[type] || type;
  const content = (a.content || "").slice(0, 600);
  const evidence = (a.evidence || []).length ? `引用 ${a.evidence.length} 条消息` : "";
  return `<div class="card artifact-review-card" data-id="${esc(a.id)}" data-sid="${esc(sid||"")}" data-type="${esc(type)}" data-title="${esc(a.title||"")}" data-content="${esc(a.content||"")}" data-domain="${esc(a.domain||"综合")}">
    <div class="card-head">
      <span class="card-type">${esc(tl)}</span>
      <span><span class="card-time">${a.confidence ? (Math.round(a.confidence*100)+"%") : ""}</span><button class="btn danger small" style="margin-left:8px" onclick="window._rejectArtifact('${esc(a.id)}')">删除这张</button></span>
    </div>
    <div class="card-title">${esc(a.title||"(无标题)")}</div>
    <div class="card-body clamp-text">${esc(content)}</div>
    ${(a.content || "").length > 180 ? `<details class="inline-details"><summary>展开完整内容</summary><div>${esc(a.content || "")}</div></details>` : ""}
    ${evidence ? `<div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px">${esc(evidence)}</div>` : ""}
    <div class="card-actions">
      <button class="btn primary small" onclick="window._saveArtifact('${esc(a.id)}')">保存</button>
    </div>
  </div>`;
}

function finishAuditCard(card) {
  const area = card.closest(".au-cards-area");
  const sessionCard = area?.previousElementSibling;
  card.remove();
  const remaining = area ? area.querySelectorAll(".artifact-review-card").length : 0;
  const metric = $("#au-metrics .metric .value");
  if (metric) metric.textContent = String(Math.max(0, Number(metric.textContent || 0) - 1));
  const count = sessionCard?.querySelector("[data-audit-count]");
  if (count) {
    const messages = String(count.textContent || "").split("·").slice(1).join("·").trim();
    count.textContent = `${remaining} 项待审${messages ? ` · ${messages}` : ""}`;
  }
  if (!remaining && area) {
    area.innerHTML = '<div class="empty audit-session-complete">这段对话的待审核卡片已经处理完毕；离开本页后会从待审核列表移除。</div>';
    sessionCard?.classList.add("audit-complete");
  }
}

// A. 审核确认：调用 /api/starmap/conversations/review (action=confirm)，可编辑 title/content/domain/tags。
// F. 不提供"目标地"下拉，仅保留可编辑的标题/领域/内容/标签（两类卡片都落库到知识）。
window._saveArtifact = async (id) => {
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (!card) return;
  const sid = card.dataset.sid;
  const title = card.dataset.title;
  const content = card.dataset.content;
  const domain = card.dataset.domain;
  openModal("确认卡片",
    `<div class="form-row"><label>标题</label><input id="ar-title" class="inp" value="${esc(title)}"></div>
     <div class="form-row"><label>领域</label><input id="ar-domain" class="inp" value="${esc(domain)}"></div>
     <div class="form-row"><label>标签（逗号分隔）</label><input id="ar-tags" class="inp" placeholder="如：项目, 灵感"></div>
     <div class="form-row"><label>内容</label><textarea id="ar-content" class="inp" rows="6">${esc(content)}</textarea></div>
     <button class="btn primary" id="ar-confirm">确认保存</button>`);
  setTimeout(() => {
    $("#ar-confirm").onclick = async () => {
      const dtitle = $("#ar-title").value;
      const dcontent = $("#ar-content").value;
      const ddomain = $("#ar-domain").value;
      const dtags = $("#ar-tags").value.split(",").map(s => s.trim()).filter(Boolean);
      try {
        const r = await api("/api/starmap/conversations/review", {
          session_id: sid,
          decisions: [{ artifact_id: id, action: "confirm", title: dtitle, content: dcontent, domain: ddomain, tags: dtags }]
        });
        toast("已确认并存入知识库");
        $("#modal").setAttribute("hidden", "");
        if (r.changed) finishAuditCard(card);
        renderers.overview();
      } catch(e) { toast("确认失败：" + (e.message || "")); }
    };
  }, 50);
};

// 驳回：调用 review (action=reject)
window._rejectArtifact = async (id) => {
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (!card) return;
  const sid = card.dataset.sid;
  const area = card.closest(".au-cards-area");
  const isLast = (area?.querySelectorAll(".artifact-review-card").length || 0) === 1;
  const message = isLast
    ? "只删除当前这张卡片。这是该对话最后一张待审核卡，删除后该对话会离开待审核列表；已发布知识和原对话不会删除。"
    : "只删除当前这张待审核卡片；同一对话的其他卡片、已发布知识和原对话不会删除。";
  if (!(await confirmAction("删除这张待审核卡", message, "删除这张"))) return;
  try {
    await api("/api/starmap/conversations/review", { session_id: sid, decisions: [{ artifact_id: id, action: "reject" }] });
    toast(isLast ? "已删除最后一张待审核卡；本会话审核完成" : "已删除这张待审核卡");
    finishAuditCard(card);
    renderers.overview();
  } catch(e) { toast("删除失败：" + (e.message || "")); }
};

/* ======== 知识库 ======== */
let knowView = "list";
let knowQuery = "";
renderers.knowledge = async () => {
  try {
    if (knowQuery.trim()) {
      // C. 搜索：调 /api/starmap/search，渲染标题/领域(category)/片段(text)
      const r = await api("/api/starmap/search?q=" + encodeURIComponent(knowQuery.trim()) + "&limit=10");
      const results = r.results || [];
      if (!results.length) {
        $("#know-body").innerHTML = '<div class="empty">没有匹配的结果</div>';
        return;
      }
      $("#know-body").innerHTML = `<div class="card-list">${results.map(res => `
        <div class="card">
          <div class="card-head">
            <span class="card-type">${esc(res.category || "")}</span>
            <span class="card-time">${res.rerank_score != null ? ("相关度 " + Math.round(res.rerank_score * 100) + "%") : ""}</span>
          </div>
          <div class="card-title">${esc(res.title || "(无标题)")}</div>
          <div class="card-body">${esc((res.text || "").slice(0, 300))}</div>
          ${res.citation ? `<div style="font-size:0.7rem;color:var(--text-muted);margin-top:4px">${esc(res.citation)}</div>` : ""}
        </div>`).join("")}</div>`;
      return;
    }
    const r = await api("/api/starmap/knowledge");
    const notes = r.notes || [];
    if (!notes.length) {
      $("#know-body").innerHTML = '<div class="empty">还没有保存的卡片。去审核页确认卡片后会自动出现在这里。</div>';
      return;
    }
    renderKnowList(notes, knowView);
  } catch(e) { toast("加载失败"); }
};

// 搜索框：空时显示全部笔记（现有行为），输入时 300ms 防抖调 search
const knowSearchEl = $("#know-search");
if (knowSearchEl) {
  knowSearchEl.oninput = () => {
    knowQuery = knowSearchEl.value;
    clearTimeout(knowSearchEl._t);
    knowSearchEl._t = setTimeout(() => renderers.knowledge(), 300);
  };
}

function renderKnowList(notes, view) {
  const items = notes.map(n => `
    <div class="card" data-nid="${esc(n.id)}">
      <div class="card-head">
        <span class="card-type">${esc(TYPE_LABELS[n.kind]||n.kind||"知识")}</span>
        <span style="font-size:0.68rem;color:var(--text-muted)">${esc(n.domain||"")}</span>
      </div>
      <div class="card-title">${esc(n.title||"(无标题)")}</div>
      <div class="card-body clamp-text">${esc((n.content||"").slice(0,300))}</div>
      ${(n.content || "").length > 180 ? `<details class="inline-details"><summary>展开完整内容</summary><div>${esc(n.content || "")}</div></details>` : ""}
      <div style="display:flex;gap:4px;margin-top:6px">
        <button class="btn small" onclick="window._editNote('${esc(n.id)}')">编辑</button>
        <button class="btn danger small" onclick="window._deleteNote('${esc(n.id)}')">删除</button>
      </div>
    </div>
  `).join("");
  $("#know-body").innerHTML = view === "grid"
    ? `<div class="card-grid">${items}</div>`
    : `<div class="card-list">${items}</div>`;
}

$("#btn-add-note").onclick = () => {
  openModal("新建笔记",
    `<label style="display:flex;flex-direction:column;gap:4px;font-size:0.78rem;color:var(--text-muted);margin-bottom:8px">
       标题<input type="text" id="note-title" style="font-family:var(--serif);font-size:0.85rem;padding:6px 8px;border:0.5px solid var(--border);border-radius:var(--radius);background:transparent;color:var(--text)">
     </label>
     <label style="display:flex;flex-direction:column;gap:4px;font-size:0.78rem;color:var(--text-muted);margin-bottom:8px">
       内容<textarea id="note-content" rows="6" style="font-family:var(--serif);font-size:0.85rem;padding:6px 8px;border:0.5px solid var(--border);border-radius:var(--radius);background:transparent;color:var(--text);resize:vertical"></textarea>
     </label>
     <button class="btn primary" id="note-save" style="margin-top:4px">保存</button>`,
  () => {}
  );
  // 延迟绑定确保 DOM 存在
  setTimeout(() => {
    $("#note-save").onclick = async () => {
      const title = $("#note-title").value;
      const content = $("#note-content").value;
      if (!content.trim()) { toast("内容不能为空"); return; }
      try {
        await api("/api/starmap/knowledge/note", { action:"add", title:title||"(无标题)", content });
        toast("已保存");
        $("#modal").setAttribute("hidden","");
        renderers.knowledge();
      } catch(e) { toast("保存失败"); }
    };
  }, 50);
};

window._editNote = async (id) => {
  try {
    const r = await api("/api/starmap/knowledge/note?id="+encodeURIComponent(id));
    if (!r.ok) { toast("加载失败"); return; }
    openModal("编辑笔记",
      `<label style="display:flex;flex-direction:column;gap:4px;font-size:0.78rem;color:var(--text-muted);margin-bottom:8px">
         标题<input type="text" id="ne-title" value="${esc(r.title||"")}" style="font-family:var(--serif);font-size:0.85rem;padding:6px 8px;border:0.5px solid var(--border);border-radius:var(--radius);background:transparent;color:var(--text)">
       </label>
       <label style="display:flex;flex-direction:column;gap:4px;font-size:0.78rem;color:var(--text-muted);margin-bottom:8px">
         内容<textarea id="ne-content" rows="6" style="font-family:var(--serif);font-size:0.85rem;padding:6px 8px;border:0.5px solid var(--border);border-radius:var(--radius);background:transparent;color:var(--text);resize:vertical">${esc(r.content||"")}</textarea>
       </label>
       <label style="display:flex;flex-direction:column;gap:4px;font-size:0.78rem;color:var(--text-muted);margin-bottom:8px">
         领域<input type="text" id="ne-domain" value="${esc(r.domain||"综合")}" style="font-family:var(--serif);font-size:0.85rem;padding:6px 8px;border:0.5px solid var(--border);border-radius:var(--radius);background:transparent;color:var(--text)">
       </label>
       <button class="btn primary" id="ne-save">保存</button>`);
    setTimeout(() => {
      $("#ne-save").onclick = async () => {
        try {
          await api("/api/starmap/knowledge/note", { action:"edit", id,
            title:$("#ne-title").value, content:$("#ne-content").value, domain:$("#ne-domain").value });
          toast("已保存");
          $("#modal").setAttribute("hidden","");
          renderers.knowledge();
        } catch(e) { toast("保存失败"); }
      };
    }, 50);
  } catch(e) { toast("加载失败"); }
};

window._deleteNote = async (id) => {
  if (!(await confirmAction("删除知识", "这条知识会进入废纸篓，可以恢复。", "移入废纸篓"))) return;
  try {
    await api("/api/starmap/knowledge/note", { action:"delete", id });
    toast("已移入废纸篓");
    renderers.knowledge();
  } catch(e) { toast("删除失败"); }
};

/* ======== 项目共享记忆 ======== */
let selectedProjectId = "";
renderers.projects = async () => {
  try {
    const r = await api("/api/starmap/projects");
    const items = r.items || [];
    const layout = document.querySelector(".project-layout");
    if (layout) layout.classList.toggle("is-empty", !items.length);
    $("#project-list").innerHTML = items.length ? items.map(p => `
      <button class="card project-card ${p.id === selectedProjectId ? "selected" : ""}" data-project-id="${esc(p.id)}" onclick="window._openProject('${esc(p.id)}')">
        <div class="card-head"><span class="card-type">${esc(STAGE_LABELS[p.stage] || p.stage || "探索中")}</span><span class="card-time">${p.session_count || 0} 个任务</span></div>
        <div class="card-title">${esc(p.name)}</div><div class="card-body">${esc(p.goal || "尚未填写项目目标")}</div>
        <div class="card-time" style="margin-top:7px">${p.note_count || 0} 条确认知识 · ${p.unresolved_count || 0} 个未解决问题</div>
      </button>`).join("") : '<div class="empty project-empty"><b>从一件正在做的事开始</b><span>例如“写论文”“开发星图”“装修新家”。先点右上角「新建项目」，之后把相关 Hanako 对话归进来。</span><button class="btn primary" onclick="document.getElementById(\'btn-add-project\').click()">新建第一个项目</button></div>';
    if (selectedProjectId && items.some(p => p.id === selectedProjectId)) await window._openProject(selectedProjectId);
  } catch(e) { toast("项目加载失败：" + e.message); }
};

function memorySection(title, values) {
  if (!values || !values.length) return "";
  return `<section class="memory-section"><h4>${esc(title)}</h4><ul>${values.map(v => `<li>${esc(v)}</li>`).join("")}</ul></section>`;
}

window._openProject = async id => {
  selectedProjectId = id;
  try {
    const [detail, conversations] = await Promise.all([api("/api/starmap/projects/detail?id=" + encodeURIComponent(id)), api("/api/starmap/conversations?limit=200")]);
    const p = detail.project, m = p.memory || {}, assigned = new Set(p.session_ids || []);
    const options = (conversations.items || []).filter(s => !assigned.has(s.session_id)).map(s => `<option value="${esc(s.session_id)}">${esc(s.title || s.session_id)}</option>`).join("");
    const assignedRows = (conversations.items || []).filter(s => assigned.has(s.session_id)).map(s => `<div class="linked-session"><span><b>${esc(s.title || s.session_id)}</b><small>${s.confirmed_count || 0} 条已确认 · ${s.pending_count || 0} 条待审核</small></span><button class="btn danger small" onclick="window._unassignProjectSession('${esc(id)}','${esc(s.session_id)}')">移出项目</button></div>`).join("");
    $("#project-detail").innerHTML = `<div class="panel project-memory">
      <div class="card-head"><div><div class="card-title">${esc(p.name)}</div><div class="card-body">${esc(p.goal || "尚未填写项目目标")}</div></div><div><span class="card-type">记忆 v${p.memory_version || 1}</span><button class="btn danger small" style="margin-left:6px" onclick="window._deleteProject('${esc(id)}','${esc(p.name)}')">删除项目</button></div></div>
      <div class="project-stats"><span><b>${assigned.size}</b>关联任务</span><span><b>${(m.confirmed_notes || []).length}</b>确认知识</span><span><b>${(m.unresolved || []).length}</b>未解决</span></div>
      <div class="project-actions"><select class="inp" id="project-session-select"><option value="">选择要归入的对话…</option>${options}</select><button class="btn small" id="btn-assign-session" ${options ? "" : "disabled"}>归入项目</button><button class="btn primary small" onclick="window._makeCapsule('${esc(id)}')">生成上下文胶囊</button></div>
      <div class="project-tabs"><button class="active" data-project-tab="progress">进度</button><button data-project-tab="decisions">决策</button><button data-project-tab="issues">问题</button><button data-project-tab="knowledge">知识</button><button data-project-tab="tasks">关联任务</button></div>
      <div class="project-pane active" data-project-pane="progress"><div class="memory-grid">${memorySection("已完成", m.completed) || '<div class="empty">暂无已完成事项</div>'}${memorySection("下一步", m.next_steps) || '<div class="empty">暂无下一步</div>'}</div></div>
      <div class="project-pane" data-project-pane="decisions"><div class="memory-grid">${memorySection("已确认决策", m.decisions) || '<div class="empty">暂无决策</div>'}${memorySection("失败方案及原因", m.failed_attempts) || '<div class="empty">暂无失败方案</div>'}</div></div>
      <div class="project-pane" data-project-pane="issues">${memorySection("未解决问题", m.unresolved) || '<div class="empty">暂无未解决问题</div>'}</div>
      <div class="project-pane" data-project-pane="knowledge"><section class="memory-section"><h4>已确认知识</h4>${(m.confirmed_notes || []).length ? m.confirmed_notes.map(n => `<div class="memory-note"><div><b>${esc(n.title || "未命名")}</b><p class="clamp-text">${esc(n.content || "")}</p><small>${esc(n.domain || "综合")} · ${esc(TYPE_LABELS[n.kind] || n.kind || "知识")}</small></div><button class="btn danger small" onclick="window._deleteProjectNote('${esc(n.id)}')">删除</button></div>`).join("") : '<div class="empty">关联任务中还没有审核确认的知识</div>'}</section></div>
      <div class="project-pane" data-project-pane="tasks"><section class="memory-section"><h4>关联任务</h4>${assignedRows || '<div class="empty">还没有关联任务</div>'}</section></div>
    </div>`;
    const assign = $("#btn-assign-session");
    if (assign) assign.onclick = async () => { const sid = $("#project-session-select").value; if (!sid) return toast("请选择一段对话"); try { await api("/api/starmap/projects", {action:"assign_session", project_id:id, session_id:sid}); toast("已归入项目并更新共享记忆"); await renderers.projects(); } catch(e) { toast("归入失败：" + e.message); } };
    $("#project-detail").querySelectorAll("[data-project-tab]").forEach(button => { button.onclick = () => {
      $("#project-detail").querySelectorAll("[data-project-tab]").forEach(item => item.classList.toggle("active", item === button));
      $("#project-detail").querySelectorAll("[data-project-pane]").forEach(pane => pane.classList.toggle("active", pane.dataset.projectPane === button.dataset.projectTab));
    }; });
    $$(".project-card").forEach(card => card.classList.toggle("selected", card.dataset.projectId === id));
  } catch(e) { toast("项目详情加载失败：" + e.message); }
};

window._unassignProjectSession = async (projectId, sessionId) => {
  if (!(await confirmAction("移出项目", "将这段对话移出项目？已确认知识仍保留在知识星库。", "确认移出"))) return;
  try { await api("/api/starmap/projects", {action:"unassign_session", project_id:projectId, session_id:sessionId}); toast("已移出项目，共享记忆已更新"); await renderers.projects(); }
  catch(e) { toast("移出失败：" + e.message); }
};
window._deleteProjectNote = async noteId => {
  if (!(await confirmAction("删除共享知识", "它会从知识星库和项目记忆中移除，并进入废纸篓。", "移入废纸篓"))) return;
  try { await api("/api/starmap/knowledge/note", {action:"delete", id:noteId}); toast("已移入废纸篓"); await renderers.projects(); }
  catch(e) { toast("删除失败：" + e.message); }
};
window._deleteProject = async (projectId, name) => {
  if (!(await confirmAction("删除项目", `删除项目“${name}”？关联对话和知识不会被永久删除。`, "删除项目"))) return;
  try { await api("/api/starmap/projects", {action:"delete", project_id:projectId}); selectedProjectId = ""; $("#project-detail").innerHTML = '<div class="empty">项目已删除</div>'; toast("项目已删除"); await renderers.projects(); }
  catch(e) { toast("删除失败：" + e.message); }
};

window._makeCapsule = id => {
  openModal("生成上下文胶囊", `<div class="form-row"><label>新任务准备做什么？</label><textarea class="inp" id="capsule-question" rows="3" placeholder="例如：继续开发跨任务上下文注入"></textarea></div><button class="btn primary" id="capsule-generate">生成</button><div id="capsule-result"></div>`);
  setTimeout(() => { $("#capsule-generate").onclick = async () => { try { const q = $("#capsule-question").value; const r = await api("/api/starmap/projects/capsule?id=" + encodeURIComponent(id) + "&question=" + encodeURIComponent(q)); $("#capsule-result").innerHTML = `<div class="card-time" style="margin:12px 0 5px">约 ${r.estimated_tokens} Token · ${r.source_count} 个来源 · 记忆 v${r.memory_version}</div><textarea class="inp capsule-output" rows="16" readonly>${esc(r.text)}</textarea><button class="btn primary" id="capsule-copy" style="margin-top:8px">复制上下文</button>`; $("#capsule-copy").onclick = async () => { await navigator.clipboard.writeText(r.text); toast("上下文胶囊已复制"); }; } catch(e) { toast("生成失败：" + e.message); } }; }, 0);
};

const addProjectBtn = $("#btn-add-project");
if (addProjectBtn) addProjectBtn.onclick = () => {
  openModal("新建共享项目", `<div class="form-row"><label>项目名称</label><input class="inp" id="project-name" placeholder="例如：星图计划"></div><div class="form-row"><label>项目目标</label><textarea class="inp" id="project-goal" rows="4" placeholder="这个项目最终要实现什么？"></textarea></div><button class="btn primary" id="project-create">创建项目</button>`);
  setTimeout(() => { $("#project-create").onclick = async () => { try { const r = await api("/api/starmap/projects", {action:"create", name:$("#project-name").value, goal:$("#project-goal").value}); selectedProjectId = r.project.id; $("#modal").setAttribute("hidden", ""); toast("项目已创建"); await renderers.projects(); } catch(e) { toast("创建失败：" + e.message); } }; }, 0);
};

/* ======== 复盘 ======== */
function _metric(label, value){
  return `<div class="metric"><div class="value">${value}</div><div class="label">${label}</div></div>`;
}
let reviewPeriodDays = 7;
let reviewHasStarted = false;
renderers.review = async () => {
  const page = document.getElementById('page-review');
  const periodName = reviewPeriodDays === 30 ? "月复盘" : "周复盘";
  if (!reviewHasStarted) {
    page.innerHTML = `<div class="review-period-tabs">
      <button class="btn ${reviewPeriodDays === 7 ? "primary" : ""}" data-review-days="7">周复盘</button>
      <button class="btn ${reviewPeriodDays === 30 ? "primary" : ""}" data-review-days="30">月复盘</button>
    </div><section class="recap-start"><span class="recap-orbit">◎</span><h3>准备开始${periodName}</h3><p>汇总最近 ${reviewPeriodDays} 天已经审核确认的内容，看看这段时间沉淀了哪些知识、形成了哪些技能。</p><button class="btn primary" id="btn-start-review">开始${periodName}</button></section>`;
    page.querySelectorAll("[data-review-days]").forEach(button => { button.onclick = () => {
      reviewPeriodDays = Number(button.dataset.reviewDays); reviewHasStarted = false; renderers.review();
    }; });
    $("#btn-start-review").onclick = () => { reviewHasStarted = true; page.innerHTML = '<div class="empty">正在整理复盘内容…</div>'; renderers.review(); };
    return;
  }
  try {
    const r = await api("/api/starmap/recap?days=" + reviewPeriodDays);
    const period = r.period_days || 7;
    const byDomain = (r.by_domain || []).map(b =>
      `<div class="card"><div class="card-title">${esc(b.domain)}</div><div class="card-time">${b.count} 条</div></div>`
    ).join("");
    const recapCards = items => (items || []).map(n => `
      <div class="card">
        <div class="card-head"><span class="card-type">${esc(n.domain || "综合")}</span><span class="card-time">${fmtDate(n.ts || n.created_at)}</span></div>
        <div class="card-title">${esc(n.title || "")}</div>
        <div class="card-body">${esc(n.text || n.content || "")}</div>
      </div>`).join("");
    const knowledge = recapCards(r.knowledge);
    const skills = recapCards(r.skills);
    page.innerHTML = `
      <div class="review-period-tabs">
        <button class="btn ${reviewPeriodDays === 7 ? "primary" : ""}" data-review-days="7">周复盘</button>
        <button class="btn ${reviewPeriodDays === 30 ? "primary" : ""}" data-review-days="30">月复盘</button>
        <button class="btn" id="btn-refresh-review">重新复盘</button>
      </div>
      <div class="metrics review-metrics">${_metric("复盘周期", period + "天")}${_metric("新增沉淀", r.period_notes || 0)}${_metric("知识", (r.knowledge || []).length)}${_metric("技能", (r.skills || []).length)}</div>
      <section class="recap-section"><div class="panel-title">这段时间学到的知识</div><div class="card-list">${knowledge || '<div class="empty">这段时间还没有审核确认的知识</div>'}</div></section>
      <section class="recap-section"><div class="panel-title">这段时间形成的技能</div><div class="card-list">${skills || '<div class="empty">这段时间还没有审核确认的行动方法或思考技能</div>'}</div></section>
      <section class="recap-section"><div class="panel-title">知识领域分布</div><div class="card-grid">${byDomain || '<div class="empty">暂无领域数据</div>'}</div></section>
    `;
    page.querySelectorAll("[data-review-days]").forEach(button => { button.onclick = () => {
      reviewPeriodDays = Number(button.dataset.reviewDays); reviewHasStarted = false; renderers.review();
    }; });
    $("#btn-refresh-review").onclick = () => { reviewHasStarted = true; renderers.review(); };
  } catch(e) {
    page.innerHTML = '<div class="empty">加载失败: ' + e.message + '</div>';
  }
};

/* ======== 废纸篓 ======== */
renderers.trash = async () => {
  try {
    const r = await api("/api/starmap/trash");
    const items = r.items || [];
    if (!items.length) { $("#trash-list").innerHTML = '<div class="empty">废纸篓是空的</div>'; return; }
    $("#trash-list").innerHTML = items.map(it => `
      <div class="card">
        <div class="card-head">
          <span class="card-type">${esc(it.zone||"")}</span>
          <span class="card-time">${fmtDate(it.deleted_at)}</span>
        </div>
        <div class="card-title">${esc(it.label||"(无标题)")}</div>
        <div class="card-actions">
          <button class="btn small" onclick="window._restoreTrash('${esc(it.trash_id)}')">恢复</button>
          <button class="btn danger small" onclick="window._purgeTrash('${esc(it.trash_id)}')">永久删除</button>
        </div>
      </div>
    `).join("");
  } catch(e) { toast("加载失败"); }
};

window._restoreTrash = async (id) => {
  try { await api("/api/starmap/trash/restore", { trash_id: id }); toast("已恢复"); renderers.trash(); }
  catch(e) { toast("恢复失败"); }
};
window._purgeTrash = async (id) => {
  if (!(await confirmAction("永久删除", "永久删除后无法恢复。", "永久删除"))) return;
  try { await api("/api/starmap/trash/purge", { trash_id: id }); toast("已删除"); renderers.trash(); }
  catch(e) { toast("删除失败"); }
};

/* 视图切换绑定 */
document.addEventListener("click", e => {
  const btn = e.target.closest(".view-btn");
  if (!btn || !btn.closest("#know-body")?.previousElementSibling) return;
  knowView = btn.dataset.view;
  btn.parentElement.querySelectorAll(".view-btn").forEach(b => b.classList.toggle("active", b === btn));
  renderers.knowledge();
});

/* 启动 */
showPage("overview");

})();
