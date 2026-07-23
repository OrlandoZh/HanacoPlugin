import {
  abortSession,
  cancelHostTask,
  closeTerminal,
  completeHostTask,
  createSession,
  dispatchMission,
  failHostTask,
  findSessionCheckpoints,
  forkSession,
  getAgentConfig,
  getBlueprint,
  getContextUsage,
  getParityMatrix,
  getSessionHistory,
  getSessionStatus,
  listAgentSkills,
  listAgents,
  listAgentProfileOverrides,
  listDeferredTasks,
  listHostCheckpoints,
  listHostTasks,
  listMemoryEntries,
  listSessions,
  listTerminals,
  listUsage,
  queryDeferredTask,
  queryHostTask,
  readMemoryEntry,
  readTerminal,
  registerHostTask,
  removeHostTask,
  restoreHostCheckpoint,
  revertSessionTurn,
  sendSessionMessage,
  startTerminal,
  updateAgentConfig,
  updateHostTask,
  writeTerminal,
  buildSessionTitleSuggestion
} from "../lib/hanaagent-core.js"
import {
  deleteAgentProfile,
  getAgentProfile,
  listAgentProfiles,
  saveAgentProfile
} from "../lib/agent-profile-store.js"
import {
  deleteLocalMemory,
  listLocalMemory,
  readLocalMemory,
  searchLocalMemory,
  writeLocalMemory
} from "../lib/memory-store.js"
import {
  listHandoffs,
  readHandoff
} from "../lib/handoff-store.js"
import {
  listTasks
} from "../lib/task-store.js"
import {
  listRunRecords
} from "../lib/run-store.js"
import {
  listMissions
} from "../lib/mission-store.js"
import {
  listJobs
} from "../lib/job-store.js"
import {
  activityTimestamp,
  cleanString,
  clampRouteNumber,
  clipForEvent,
  escapeHtmlText,
  exportDisplayLabel,
  normalizeCalendarTimezone,
  normalizePinnedSessions,
  normalizeSessionAliases,
  normalizeSessionTombstones,
  readJson
} from "./workbench-utils.js"
import { buildSwarmRuntimeCompat } from "./workbench-routes-swarm.js"

// Cross-module dependencies — assigned in registerSessionRoutes from workbench.js
let buildOverview = null

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function parseListParam(value) {
  const text = cleanString(value)
  if (!text) return []
  return text.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)
}

// ---------------------------------------------------------------------------
// Event stream functions
// ---------------------------------------------------------------------------

export function streamSessionEvents(c, ctx, input = {}) {
  const sessionPath = cleanString(input.sessionPath)
  if (!sessionPath) return c.json({ ok: false, error: "sessionPath_required" }, 422)
  if (typeof ctx?.bus?.subscribe !== "function") return c.json({ ok: false, error: "hana_bus_subscribe_unavailable" }, 503)

  const encoder = new TextEncoder()
  const types = cleanString(input.types)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  let unsubscribe = null
  let heartbeat = null
  const stream = new ReadableStream({
    start(controller) {
      const send = (event, payload = {}) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload).replace(/\n/g, "\\n")}\n\n`))
      }
      send("session-event", {
        type: "connected",
        sessionPath,
        at: new Date().toISOString()
      })
      unsubscribe = ctx.bus.subscribe((event, eventSessionPath) => {
        send("session-event", normalizeBusEvent(event, eventSessionPath || sessionPath))
      }, {
        sessionPath,
        ...(types.length ? { types } : {})
      })
      heartbeat = setInterval(() => {
        send("session-event", { type: "heartbeat", sessionPath, at: new Date().toISOString() })
      }, 15000)
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat)
      if (typeof unsubscribe === "function") unsubscribe()
    }
  })
  c.header("content-type", "text/event-stream; charset=utf-8")
  c.header("cache-control", "no-cache, no-transform")
  c.header("connection", "keep-alive")
  return c.body(stream)
}

function normalizeBusEvent(event, sessionPath) {
  const value = event && typeof event === "object" ? event : { type: "event", value: event }
  const type = cleanString(value.type) || "event"
  const text = typeof value.text === "string"
    ? value.text
    : typeof value.content === "string"
      ? value.content
      : typeof value.message === "string"
        ? value.message
        : ""
  return {
    type,
    sessionPath,
    at: new Date().toISOString(),
    ...(typeof value.delta === "string" ? { delta: value.delta } : {}),
    ...(text ? { text } : {}),
    ...(typeof value.message === "string" ? { message: value.message } : {}),
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    event: safeEventPayload(value)
  }
}

function safeEventPayload(event) {
  try {
    return JSON.parse(JSON.stringify(event))
  } catch {
    return { type: cleanString(event?.type) || "event" }
  }
}

// ---------------------------------------------------------------------------
// Session export functions
// ---------------------------------------------------------------------------

function buildSessionExport(input = {}) {
  const sessionPath = cleanString(input.sessionPath)
  const messages = Array.isArray(input.messages) ? input.messages : []
  const toolTrace = input.toolTrace || { items: [], summary: {} }
  const requested = cleanString(input.format).toLowerCase()
  const format = ["markdown", "json", "text", "html", "csv", "zip"].includes(requested) ? requested : "markdown"
  const basename = safeDownloadStem(sessionPath || "session")
  if (format === "zip") {
    const markdown = buildSessionExport({ sessionPath, format: "markdown", messages, toolTrace })
    const json = buildSessionExport({ sessionPath, format: "json", messages, toolTrace })
    const text = buildSessionExport({ sessionPath, format: "text", messages, toolTrace })
    const html = buildSessionExport({ sessionPath, format: "html", messages, toolTrace })
    const csv = buildSessionExport({ sessionPath, format: "csv", messages, toolTrace })
    const exportedAt = new Date().toISOString()
    return {
      filename: `${basename}.zip`,
      contentType: "application/zip",
      binary: true,
      body: buildZipArchive([
        { name: "manifest.json", content: JSON.stringify({ ok: true, kind: "hanaagent-session-export", exportedAt, sessionPath, messageCount: messages.length, files: ["session.md", "session.html", "session.csv", "session.json", "session.txt", "tool-trace.json"] }, null, 2) + "\n" },
        { name: "session.md", content: markdown.body },
        { name: "session.html", content: html.body },
        { name: "session.csv", content: csv.body },
        { name: "session.json", content: json.body },
        { name: "session.txt", content: text.body },
        { name: "tool-trace.json", content: JSON.stringify(toolTrace || { items: [], summary: {} }, null, 2) + "\n" }
      ])
    }
  }
  if (format === "json") {
    return {
      filename: `${basename}.json`,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        ok: true,
        exportedAt: new Date().toISOString(),
        sessionPath,
        messageCount: messages.length,
        toolTrace,
        messages
      }, null, 2)
    }
  }
  if (format === "text") {
    return {
      filename: `${basename}.txt`,
      contentType: "text/plain; charset=utf-8",
      body: [
        `HanaAgent Session Export`,
        `Session: ${sessionPath || "-"}`,
        `Messages: ${messages.length}`,
        "",
        ...messages.map((message, index) => [
          `--- ${index + 1}. ${exportDisplayLabel(message.role || "message")} ${message.createdAt || ""}`.trim(),
          message.text || message.content || ""
        ].join("\n"))
      ].join("\n")
    }
  }
  if (format === "html") {
    const traceItems = Array.isArray(toolTrace.items) ? toolTrace.items : []
    const exportedAt = new Date().toISOString()
    return {
      filename: `${basename}.html`,
      contentType: "text/html; charset=utf-8",
      body: [
        "<!doctype html>",
        '<html lang="zh-CN">',
        "<head>",
        '<meta charset="utf-8" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1" />',
        `<title>${escapeHtmlText(sessionPath || "HanaAgent Session Export")}</title>`,
        "<style>",
        "body{margin:0;background:#f6f7f9;color:#171717;font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
        "main{max-width:980px;margin:0 auto;padding:28px 18px 48px}",
        "header{margin-bottom:18px}",
        "h1{font-size:24px;margin:0 0 8px}",
        ".meta{color:#666;font-size:13px}",
        ".message,.trace{background:white;border:1px solid #ddd;border-radius:8px;margin:12px 0;padding:14px}",
        ".role{font-weight:700;text-transform:uppercase;font-size:12px;color:#2557b7}",
        ".time{color:#777;font-size:12px;margin-left:8px}",
        "pre{white-space:pre-wrap;word-break:break-word;margin:10px 0 0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}",
        "</style>",
        "</head>",
        "<body>",
        "<main>",
        "<header>",
        "<h1>HanaAgent Session Export</h1>",
        `<div class="meta">Session: ${escapeHtmlText(sessionPath || "-")} · Exported: ${escapeHtmlText(exportedAt)} · Messages: ${messages.length} · Tool trace items: ${traceItems.length}</div>`,
        "</header>",
        "<section>",
        "<h2>Messages</h2>",
        ...messages.map((message, index) => [
          '<article class="message">',
          `<div><span class="role">${escapeHtmlText(exportDisplayLabel(message.role || "message"))}</span><span class="time">${escapeHtmlText(message.createdAt || "")}</span></div>`,
          `<pre>${escapeHtmlText(formatMessageText(message) || "_empty_")}</pre>`,
          "</article>"
        ].join("")),
        "</section>",
        traceItems.length ? "<section><h2>Tool Trace</h2>" : "",
        ...traceItems.map((item) => [
          '<article class="trace">',
          `<div><span class="role">${escapeHtmlText(exportDisplayLabel(item.kind || "event"))}</span><span class="time">${escapeHtmlText(exportDisplayLabel(item.status || ""))}</span></div>`,
          `<pre>${escapeHtmlText([item.title || "-", item.detail || ""].filter(Boolean).join(": "))}</pre>`,
          "</article>"
        ].join("")),
        traceItems.length ? "</section>" : "",
        "</main>",
        "</body>",
        "</html>"
      ].join("\n")
    }
  }
  if (format === "csv") {
    return {
      filename: `${basename}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: [
        ["index", "role", "createdAt", "id", "text"].map(csvCell).join(","),
        ...messages.map((message, index) => [
          index + 1,
          message.role || "message",
          message.createdAt || "",
          message.id || "",
          formatMessageText(message)
        ].map(csvCell).join(","))
      ].join("\n") + "\n"
    }
  }
  const traceItems = Array.isArray(toolTrace.items) ? toolTrace.items : []
  return {
    filename: `${basename}.md`,
    contentType: "text/markdown; charset=utf-8",
    body: [
      "# HanaAgent Session Export",
      "",
      `- Session: ${sessionPath || "-"}`,
      `- Exported: ${new Date().toISOString()}`,
      `- Messages: ${messages.length}`,
      `- Tool trace items: ${traceItems.length}`,
      "",
      "## Messages",
      "",
      ...messages.map((message, index) => [
        `### ${index + 1}. ${exportDisplayLabel(message.role || "message")}`,
        "",
        message.createdAt ? `_${message.createdAt}_\n` : "",
        formatMessageText(message) || "_empty_",
        ""
      ].join("\n")),
      traceItems.length ? "## Tool Trace" : "",
      traceItems.length ? "" : "",
      ...traceItems.map((item) => `- **${exportDisplayLabel(item.kind || "event")}** ${item.title || "-"}${item.status ? ` / ${exportDisplayLabel(item.status)}` : ""}${item.detail ? `: ${item.detail}` : ""}`)
    ].filter((line, index, lines) => line || lines[index - 1]).join("\n")
  }
}

function buildSessionBatchExport(input = {}) {
  const sessions = Array.isArray(input.sessions) ? input.sessions : []
  const requested = cleanString(input.format).toLowerCase()
  const format = ["markdown", "json", "text", "html", "csv", "zip"].includes(requested) ? requested : "markdown"
  const mode = cleanString(input.mode) || "selected"
  const exportedAt = new Date().toISOString()
  if (format === "zip") {
    const files = [
      {
        name: "manifest.json",
        content: JSON.stringify({
          ok: true,
          kind: "hanaagent-session-batch-export",
          mode,
          exportedAt,
          sessionCount: sessions.length,
          sessions: sessions.map((item, index) => ({
            index: index + 1,
            ok: item.ok,
            sessionPath: item.sessionPath,
            title: item.title,
            pinned: item.pinned,
            error: item.history?.error || ""
          }))
        }, null, 2) + "\n"
      },
      {
        name: "batch.md",
        content: buildSessionBatchExport({ mode, format: "markdown", sessions }).body
      },
      {
        name: "batch.json",
        content: buildSessionBatchExport({ mode, format: "json", sessions }).body
      },
      {
        name: "batch.html",
        content: buildSessionBatchExport({ mode, format: "html", sessions }).body
      },
      {
        name: "batch.csv",
        content: buildSessionBatchExport({ mode, format: "csv", sessions }).body
      }
    ]
    sessions.forEach((item, index) => {
      const dir = `${String(index + 1).padStart(2, "0")}-${safeZipPathStem(item.title || item.sessionPath || "session")}`
      if (!item.ok) {
        files.push({ name: `${dir}/error.txt`, content: item.history?.error || "export_failed" })
        return
      }
      const markdown = buildSessionExport({
        sessionPath: item.sessionPath,
        format: "markdown",
        messages: item.history?.messages || [],
        toolTrace: item.history?.toolTrace || null
      })
      const json = buildSessionExport({
        sessionPath: item.sessionPath,
        format: "json",
        messages: item.history?.messages || [],
        toolTrace: item.history?.toolTrace || null
      })
      const text = buildSessionExport({
        sessionPath: item.sessionPath,
        format: "text",
        messages: item.history?.messages || [],
        toolTrace: item.history?.toolTrace || null
      })
      const html = buildSessionExport({
        sessionPath: item.sessionPath,
        format: "html",
        messages: item.history?.messages || [],
        toolTrace: item.history?.toolTrace || null
      })
      const csv = buildSessionExport({
        sessionPath: item.sessionPath,
        format: "csv",
        messages: item.history?.messages || [],
        toolTrace: item.history?.toolTrace || null
      })
      files.push(
        { name: `${dir}/session.md`, content: markdown.body },
        { name: `${dir}/session.html`, content: html.body },
        { name: `${dir}/session.csv`, content: csv.body },
        { name: `${dir}/session.json`, content: json.body },
        { name: `${dir}/session.txt`, content: text.body },
        { name: `${dir}/tool-trace.json`, content: JSON.stringify(item.history?.toolTrace || { items: [], summary: {} }, null, 2) + "\n" }
      )
    })
    return {
      filename: `hanaagent-session-batch-${mode}.zip`,
      contentType: "application/zip",
      binary: true,
      body: buildZipArchive(files)
    }
  }
  if (format === "json") {
    return {
      filename: `hanaagent-session-batch-${mode}.json`,
      contentType: "application/json; charset=utf-8",
      body: JSON.stringify({
        ok: true,
        mode,
        exportedAt,
        sessionCount: sessions.length,
        sessions: sessions.map((item) => ({
          ok: item.ok,
          sessionPath: item.sessionPath,
          title: item.title,
          pinned: item.pinned,
          error: item.history?.error || "",
          messageCount: item.history?.messages?.length || 0,
          toolTrace: item.history?.toolTrace || null,
          messages: item.history?.messages || []
        }))
      }, null, 2)
    }
  }
  if (format === "text") {
    return {
      filename: `hanaagent-session-batch-${mode}.txt`,
      contentType: "text/plain; charset=utf-8",
      body: [
        "HanaAgent Session Batch Export",
        `Mode: ${exportDisplayLabel(mode)}`,
        `Exported: ${exportedAt}`,
        `Sessions: ${sessions.length}`,
        "",
        ...sessions.map((item, index) => [
          `===== ${index + 1}. ${item.title || item.sessionPath} =====`,
          `Session: ${item.sessionPath}`,
          item.ok ? (item.exported?.body || "") : `ERROR: ${item.history?.error || "export_failed"}`
        ].join("\n"))
      ].join("\n")
    }
  }
  if (format === "html") {
    return {
      filename: `hanaagent-session-batch-${mode}.html`,
      contentType: "text/html; charset=utf-8",
      body: [
        "<!doctype html>",
        '<html lang="zh-CN">',
        "<head>",
        '<meta charset="utf-8" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1" />',
        "<title>HanaAgent Session Batch Export</title>",
        "<style>",
        "body{margin:0;background:#f6f7f9;color:#171717;font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
        "main{max-width:1060px;margin:0 auto;padding:28px 18px 48px}",
        "section{background:white;border:1px solid #ddd;border-radius:8px;margin:14px 0;padding:16px}",
        ".meta{color:#666;font-size:13px}",
        "pre{white-space:pre-wrap;word-break:break-word;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}",
        "</style>",
        "</head>",
        "<body>",
        "<main>",
        "<h1>HanaAgent Session Batch Export</h1>",
        `<div class="meta">Mode: ${escapeHtmlText(exportDisplayLabel(mode))} · Exported: ${escapeHtmlText(exportedAt)} · Sessions: ${sessions.length}</div>`,
        ...sessions.map((item, index) => [
          "<section>",
          `<h2>${index + 1}. ${escapeHtmlText(item.title || item.sessionPath || "session")}</h2>`,
          `<div class="meta">Session: ${escapeHtmlText(item.sessionPath || "-")} · Pinned: ${item.pinned ? "yes" : "no"} · Status: ${item.ok ? "ok" : "failed"}</div>`,
          item.ok
            ? `<pre>${escapeHtmlText((item.exported?.body || "").slice(0, 200000) || "_empty export_")}</pre>`
            : `<pre>ERROR: ${escapeHtmlText(item.history?.error || "export_failed")}</pre>`,
          "</section>"
        ].join("\n")),
        "</main>",
        "</body>",
        "</html>"
      ].join("\n")
    }
  }
  if (format === "csv") {
    return {
      filename: `hanaagent-session-batch-${mode}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: [
        ["sessionIndex", "sessionPath", "title", "pinned", "messageIndex", "role", "createdAt", "id", "text"].map(csvCell).join(","),
        ...sessions.flatMap((item, sessionIndex) => {
          if (!item.ok) {
            return [[sessionIndex + 1, item.sessionPath || "", item.title || "", item.pinned ? "yes" : "no", "", "error", "", "", item.history?.error || "export_failed"].map(csvCell).join(",")]
          }
          const messages = item.history?.messages || []
          if (!messages.length) return [[sessionIndex + 1, item.sessionPath || "", item.title || "", item.pinned ? "yes" : "no", "", "", "", "", ""].map(csvCell).join(",")]
          return messages.map((message, messageIndex) => [
            sessionIndex + 1,
            item.sessionPath || "",
            item.title || "",
            item.pinned ? "yes" : "no",
            messageIndex + 1,
            message.role || "message",
            message.createdAt || "",
            message.id || "",
            formatMessageText(message)
          ].map(csvCell).join(","))
        })
      ].join("\n") + "\n"
    }
  }
  return {
    filename: `hanaagent-session-batch-${mode}.md`,
    contentType: "text/markdown; charset=utf-8",
    body: [
      "# HanaAgent Session Batch Export",
      "",
      `- Mode: ${exportDisplayLabel(mode)}`,
      `- Exported: ${exportedAt}`,
      `- Sessions: ${sessions.length}`,
      "",
      ...sessions.map((item, index) => [
        `## ${index + 1}. ${item.title || item.sessionPath}`,
        "",
        `- Session: ${item.sessionPath}`,
        `- Pinned: ${item.pinned ? "yes" : "no"}`,
        `- Status: ${item.ok ? "ok" : "failed"}`,
        "",
        item.ok ? (item.exported?.body || "_empty export_") : `> Export failed: ${item.history?.error || "unknown"}`
      ].join("\n"))
    ].join("\n")
  }
}


function formatMessageText(message) {
  if (!message || typeof message !== "object") return ""
  if (typeof message.text === "string") return message.text
  if (typeof message.content === "string") return message.content
  if (Array.isArray(message.content)) {
    return message.content.map((part) => {
      if (typeof part === "string") return part
      if (typeof part?.text === "string") return part.text
      if (typeof part?.content === "string") return part.content
      return JSON.stringify(part)
    }).filter(Boolean).join("\n")
  }
  return ""
}

function csvCell(value) {
  const text = String(value ?? "")
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function safeDownloadStem(value) {
  return cleanString(String(value || "").split(/[\\/]/).filter(Boolean).pop() || "session")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[\r\n"]/g, "_")
    .replace(/[^\w .@()-]+/g, "_")
    .slice(0, 100) || "session"
}

function safeZipPathStem(value) {
  return cleanString(value || "session")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[\\/]+/g, "_")
    .replace(/[\r\n"]/g, "_")
    .replace(/[^\w .@()-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "session"
}

function buildZipArchive(entries = []) {
  const files = []
  const central = []
  let offset = 0
  for (const entry of entries) {
    const name = safeZipEntryName(entry.name)
    if (!name) continue
    const data = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(String(entry.content ?? ""), "utf8")
    const nameBuffer = Buffer.from(name, "utf8")
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    local.writeUInt16LE(0, 28)
    files.push(local, nameBuffer, data)

    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE(20, 4)
    directory.writeUInt16LE(20, 6)
    directory.writeUInt16LE(0x0800, 8)
    directory.writeUInt16LE(0, 10)
    directory.writeUInt16LE(0, 12)
    directory.writeUInt16LE(0, 14)
    directory.writeUInt32LE(crc, 16)
    directory.writeUInt32LE(data.length, 20)
    directory.writeUInt32LE(data.length, 24)
    directory.writeUInt16LE(nameBuffer.length, 28)
    directory.writeUInt16LE(0, 30)
    directory.writeUInt16LE(0, 32)
    directory.writeUInt16LE(0, 34)
    directory.writeUInt16LE(0, 36)
    directory.writeUInt32LE(0, 38)
    directory.writeUInt32LE(offset, 42)
    central.push(directory, nameBuffer)
    offset += local.length + nameBuffer.length + data.length
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(central.length / 2, 8)
  end.writeUInt16LE(central.length / 2, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...files, ...central, end])
}

function safeZipEntryName(value) {
  const parts = String(value || "")
    .split("/")
    .map((part) => cleanString(part).replace(/[\\:\0\r\n]+/g, "_").replace(/^\.+$/g, "_").slice(0, 120))
    .filter(Boolean)
  return parts.join("/").replace(/^\/+/, "")
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

const CRC32_TABLE = (() => {
  const table = []
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

// ---------------------------------------------------------------------------
// Agenda / Calendar functions
// ---------------------------------------------------------------------------

async function buildAgendaSnapshot(ctx, input = {}) {
  const now = parseRouteDate(input.now) || new Date()
  const nowTs = now.getTime()
  const horizonHours = clampRouteNumber(input.horizonHours, 1, 168, 24)
  const horizonTs = nowTs + horizonHours * 60 * 60 * 1000
  const missions = listMissions(ctx.dataDir, { includeArchived: true })
  const tasks = listTasks(ctx.dataDir, { includeDone: true })
  const jobs = listJobs(ctx.dataDir)
  const runRecords = listRunRecords(ctx.dataDir)
  const agents = await safeAgendaAgents(ctx)
  const activeMissions = missions
    .filter((mission) => !["complete", "completed", "done", "cancelled", "failed"].includes(cleanString(mission.state).toLowerCase()))
    .map(agendaMission)
    .sort((a, b) => b.startedAt - a.startedAt)
  const attention = [
    ...activeMissions.filter((mission) => ["needs_input", "failed", "blocked"].includes(mission.status)).map((mission) => ({
      id: mission.id,
      title: mission.title,
      type: "mission",
      status: mission.status,
      at: mission.startedAt,
      missionId: mission.id
    })),
    ...runRecords.filter((record) => record.type === "approval" && record.state === "pending").map((record) => ({
      id: record.id,
      title: record.title || "需要审批",
      type: "approval",
      status: "pending",
      at: activityTimestamp(record.createdAt || record.updatedAt),
      missionId: record.missionId,
      assignmentId: record.assignmentId
    })),
    ...runRecords.filter((record) => isFailureState(record.state) || /fail|error|blocked/i.test(record.title || "")).map((record) => ({
      id: record.id,
      title: record.title || record.type,
      type: "run",
      status: "failed",
      at: activityTimestamp(record.updatedAt || record.createdAt),
      missionId: record.missionId,
      assignmentId: record.assignmentId
    }))
  ].filter((item) => item.at).sort((a, b) => b.at - a.at).slice(0, 20)
  const tasksDueToday = tasks
    .filter((task) => task.dueDate && isSameLocalDay(parseRouteDate(task.dueDate), now) && !["done", "complete", "completed"].includes(cleanString(task.column || task.status).toLowerCase()))
    .sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority) || String(a.title).localeCompare(String(b.title)))
    .slice(0, 30)
    .map(agendaTask)
  const upcomingJobs = jobs
    .filter((job) => job.status !== "paused" && activityTimestamp(job.nextRunAt) >= nowTs && activityTimestamp(job.nextRunAt) <= horizonTs)
    .sort((a, b) => activityTimestamp(a.nextRunAt) - activityTimestamp(b.nextRunAt))
    .slice(0, 30)
    .map(agendaJob)
  const recentCompletions = [
    ...missions.filter((mission) => ["complete", "completed", "done", "failed"].includes(cleanString(mission.state).toLowerCase())).map((mission) => ({
      id: mission.id,
      title: mission.title || mission.goal || mission.id,
      completedAt: activityTimestamp(mission.completedAt || mission.updatedAt || mission.createdAt),
      status: isFailureState(mission.state) ? "failed" : "complete",
      type: "mission",
      missionId: mission.id
    })),
    ...runRecords.filter((record) => ["approved", "denied", "captured", "materialized"].includes(cleanString(record.state).toLowerCase())).map((record) => ({
      id: record.id,
      title: record.title || record.type,
      completedAt: activityTimestamp(record.resolvedAt || record.updatedAt || record.createdAt),
      status: isFailureState(record.state) || record.state === "denied" ? "failed" : "complete",
      type: "run",
      missionId: record.missionId,
      assignmentId: record.assignmentId
    }))
  ].filter((item) => item.completedAt).sort((a, b) => b.completedAt - a.completedAt).slice(0, 20)
  const agentStatuses = buildAgendaAgentStatuses(agents, missions)
  return {
    ok: true,
    greeting: agendaGreeting(now),
    now: now.toISOString(),
    horizonHours,
    sections: {
      attention,
      activeMissions,
      tasksDueToday,
      upcomingJobs,
      recentCompletions,
      agentStatuses
    },
    summary: {
      attention: attention.length,
      active: activeMissions.filter((mission) => mission.status === "running").length,
      tasksDueToday: tasksDueToday.length,
      upcoming: upcomingJobs.length,
      completed: recentCompletions.length,
      agents: agentStatuses.length,
      activeAgents: agentStatuses.filter((agent) => agent.status === "active").length
    },
    mode: "openhanako-plugin",
    source: "hanaagent-agenda"
  }
}

async function buildCalendarSnapshot(ctx, input = {}) {
  const now = new Date()
  const start = parseRouteDate(input.start) || startOfLocalDay(now)
  const mode = cleanString(input.mode) || "week"
  const defaultEnd = mode === "day" ? addDays(start, 1) : mode === "month" ? addDays(start, 35) : addDays(start, 7)
  const end = parseRouteDate(input.end) || defaultEnd
  const timezone = normalizeCalendarTimezone(input.timezone)
  const missions = listMissions(ctx.dataDir, { includeArchived: true })
  const tasks = listTasks(ctx.dataDir, { includeDone: true })
  const jobs = listJobs(ctx.dataDir)
  const runRecords = listRunRecords(ctx.dataDir)
  const events = []
  for (const mission of missions) {
    const at = activityTimestamp(mission.startedAt || mission.createdAt)
    pushCalendarEvent(events, {
      type: "mission",
      id: mission.id,
      title: mission.title || mission.goal || mission.id,
      date: at,
      status: missionCalendarStatus(mission.state),
      missionId: mission.id,
      detail: mission.goal || ""
    }, start, end, timezone)
  }
  for (const job of jobs) {
    pushCalendarJobEvents(events, job, start, end, timezone)
  }
  for (const task of tasks) {
    const at = activityTimestamp(task.dueDate)
    pushCalendarEvent(events, {
      type: "task",
      id: task.id,
      title: task.title || task.id,
      date: at,
      status: task.column || task.status || "backlog",
      priority: task.priority,
      missionId: task.missionId,
      assignmentId: task.assignmentId,
      sessionPath: task.sessionPath,
      detail: task.description || ""
    }, start, end, timezone)
  }
  for (const record of runRecords.filter((item) => item.type === "approval" && item.state === "pending")) {
    const explicitDueAt = activityTimestamp(record.meta?.dueAt || record.meta?.deadline || record.meta?.dueDate)
    const at = explicitDueAt || start.getTime()
    pushCalendarEvent(events, {
      type: "approval",
      id: record.id,
      title: record.title || "需要审批",
      date: at,
      status: "pending",
      missionId: record.missionId,
      assignmentId: record.assignmentId,
      sessionPath: record.sessionPath,
      detail: record.summary || ""
    }, start, end, timezone)
  }
  events.sort((a, b) => activityTimestamp(a.date) - activityTimestamp(b.date) || String(a.title).localeCompare(String(b.title)))
  return {
    ok: true,
    mode,
    timezone,
    range: { start: start.toISOString(), end: end.toISOString() },
    events,
    eventsByDay: groupCalendarEventsByDay(events, timezone),
    summary: summarizeCalendarEvents(events),
    source: "hanaagent-calendar"
  }
}

function agendaMission(mission = {}) {
  const assignments = Array.isArray(mission.assignments) ? mission.assignments : []
  const blocked = assignments.some((assignment) => cleanString(assignment.state).toLowerCase() === "blocked")
  return {
    id: mission.id,
    title: mission.title || mission.goal || mission.id,
    status: blocked ? "blocked" : missionAgendaStatus(mission.state || mission.phase),
    agents: new Set(assignments.map((assignment) => assignment.agentId || assignment.id).filter(Boolean)).size || assignments.length,
    startedAt: activityTimestamp(mission.startedAt || mission.createdAt || mission.updatedAt),
    missionId: mission.id
  }
}

function agendaTask(task = {}) {
  return {
    id: task.id,
    title: task.title || task.id,
    status: task.column || task.status || "backlog",
    priority: task.priority || "medium",
    dueDate: task.dueDate,
    assignedAgent: task.assignee || task.agentId || "",
    missionId: task.missionId,
    assignmentId: task.assignmentId
  }
}

function agendaJob(job = {}) {
  return {
    id: job.id,
    name: job.title || job.name || job.id,
    nextRunAt: activityTimestamp(job.nextRunAt),
    schedule: job.schedule || "manual",
    status: job.status || "enabled",
    type: job.type || ""
  }
}

async function safeAgendaAgents(ctx) {
  try {
    const result = await listAgents(ctx)
    return Array.isArray(result.agents) ? result.agents : []
  } catch {
    return []
  }
}

function buildAgendaAgentStatuses(agents = [], missions = []) {
  const activeAgentIds = new Set()
  for (const mission of missions) {
    if (!["running", "active", "preview"].includes(cleanString(mission.state || mission.phase).toLowerCase())) continue
    for (const assignment of Array.isArray(mission.assignments) ? mission.assignments : []) {
      if (["running", "checkpointed", "review"].includes(cleanString(assignment.state).toLowerCase()) && assignment.agentId) activeAgentIds.add(assignment.agentId)
    }
  }
  return agents.map((agent, index) => ({
    id: cleanString(agent.id) || `agent-${index + 1}`,
    name: cleanString(agent.name || agent.id) || `Agent ${index + 1}`,
    status: activeAgentIds.has(agent.id) ? "active" : "idle"
  }))
}

function pushCalendarEvent(events, event, start, end, timezone = "local") {
  const timestamp = Number(event.date || 0)
  if (!timestamp) return
  if (timestamp < start.getTime() || timestamp >= end.getTime()) return
  events.push({
    ...event,
    key: `${event.type}:${event.id}:${timestamp}`,
    date: new Date(timestamp).toISOString(),
    dayKey: calendarDayKeyForTimestamp(timestamp, timezone),
    localTime: calendarLocalTimeForTimestamp(timestamp, timezone),
    timezone
  })
}

function pushCalendarJobEvents(events, job = {}, start, end, timezone = "local") {
  if (!job || ["paused", "disabled"].includes(cleanString(job.status).toLowerCase())) return
  const occurrences = expandCalendarJobOccurrences(job, start, end, timezone)
  for (const at of occurrences) {
    pushCalendarEvent(events, {
      type: "job",
      id: job.id,
      title: job.title || job.name || job.id,
      date: at,
      status: job.status || "enabled",
      schedule: job.schedule,
      detail: job.type || ""
    }, start, end, timezone)
  }
}

function expandCalendarJobOccurrences(job = {}, start, end, timezone = "local") {
  const nextRunAt = activityTimestamp(job.nextRunAt)
  const schedule = parseCalendarJobSchedule(job.schedule, nextRunAt || start.getTime(), timezone)
  if (!schedule) return nextRunAt ? [nextRunAt] : []
  const output = []
  let dayParts = calendarPartsForTimestamp(start.getTime(), timezone)
  let dayStart = calendarZonedTimestamp(dayParts.year, dayParts.month, dayParts.day, 0, 0, timezone)
  for (let guard = 0; guard < 400 && dayStart < end.getTime(); guard += 1) {
    dayParts = calendarPartsForTimestamp(dayStart, timezone)
    let include = false
    if (schedule.kind === "daily") include = true
    if (schedule.kind === "weekly") include = schedule.weekdays.includes(dayParts.weekday)
    if (schedule.kind === "monthly") include = schedule.monthDays.includes(dayParts.day)
    if (include) {
      for (const hour of schedule.hours) {
        for (const minute of schedule.minutes) {
          const timestamp = calendarZonedTimestamp(dayParts.year, dayParts.month, dayParts.day, hour, minute, timezone)
          if (timestamp >= start.getTime() && timestamp < end.getTime()) output.push(timestamp)
        }
      }
    }
    const nextParts = calendarAddLocalDays(dayParts, 1)
    const nextDayStart = calendarZonedTimestamp(nextParts.year, nextParts.month, nextParts.day, 0, 0, timezone)
    if (nextDayStart <= dayStart) break
    dayStart = nextDayStart
  }
  if (!output.length && nextRunAt) output.push(nextRunAt)
  return [...new Set(output)].sort((a, b) => a - b)
}

function parseCalendarJobSchedule(value, fallbackTimestamp, timezone = "local") {
  const expression = cleanScheduleExpression(value)
  if (!expression || expression === "manual") return null
  const fallbackDate = new Date(Number(fallbackTimestamp) || Date.now())
  const fallbackParts = calendarPartsForTimestamp(fallbackDate.getTime(), timezone)
  const fallbackTime = parseCalendarHourMinute(expression, fallbackParts)
  const parts = expression.trim().split(/\s+/)
  if (parts.length >= 5) {
    const minutes = parseCalendarCronField(parts[0], 0, 59, fallbackTime.minute)
    const hours = parseCalendarCronField(parts[1], 0, 23, fallbackTime.hour)
    const dayOfMonth = parts[2]
    const dayOfWeek = parts[4]
    if (dayOfWeek !== "*" && dayOfWeek !== "?") {
      const weekdays = parseCalendarWeekdays(dayOfWeek)
      return {
        kind: "weekly",
        hour: hours[0],
        minute: minutes[0],
        hours,
        minutes,
        weekdays: weekdays.length ? weekdays : [fallbackParts.weekday],
        monthDay: fallbackParts.day,
        monthDays: [fallbackParts.day]
      }
    }
    if (dayOfMonth !== "*" && dayOfMonth !== "?") {
      const monthDays = parseCalendarCronField(dayOfMonth, 1, 31, fallbackParts.day)
      return {
        kind: "monthly",
        hour: hours[0],
        minute: minutes[0],
        hours,
        minutes,
        weekdays: [],
        monthDay: monthDays[0],
        monthDays
      }
    }
    return {
      kind: "daily",
      hour: hours[0],
      minute: minutes[0],
      hours,
      minutes,
      weekdays: [],
      monthDay: fallbackParts.day,
      monthDays: [fallbackParts.day]
    }
  }
  const text = expression.toLowerCase()
  const weekdays = calendarNamedWeekdays(text)
  if (weekdays.length || text.includes("weekly") || text.includes("every week")) {
    return {
      kind: "weekly",
      hour: fallbackTime.hour,
      minute: fallbackTime.minute,
      hours: [fallbackTime.hour],
      minutes: [fallbackTime.minute],
      weekdays: weekdays.length ? weekdays : [fallbackParts.weekday],
      monthDay: fallbackParts.day,
      monthDays: [fallbackParts.day]
    }
  }
  if (text.includes("monthly") || text.includes("every month")) {
    const dayMatch = text.match(/\b([12]?\d|3[01])(?:st|nd|rd|th)?\b/)
    const monthDay = dayMatch ? Number(dayMatch[1]) : fallbackParts.day
    return {
      kind: "monthly",
      hour: fallbackTime.hour,
      minute: fallbackTime.minute,
      hours: [fallbackTime.hour],
      minutes: [fallbackTime.minute],
      weekdays: [],
      monthDay,
      monthDays: [monthDay]
    }
  }
  return {
    kind: "daily",
    hour: fallbackTime.hour,
    minute: fallbackTime.minute,
    hours: [fallbackTime.hour],
    minutes: [fallbackTime.minute],
    weekdays: [],
    monthDay: fallbackParts.day,
    monthDays: [fallbackParts.day]
  }
}

function cleanScheduleExpression(value) {
  if (value && typeof value === "object") return cleanString(value.expression || value.cron || value.schedule)
  return cleanString(value)
}

function parseCalendarHourMinute(expression, fallbackDate) {
  const match = cleanString(expression).toLowerCase().match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/)
  if (!match) return { hour: Number(fallbackDate.hour) || 0, minute: Number(fallbackDate.minute) || 0 }
  let hour = Number(match[1])
  const minute = Number(match[2] || "0")
  const meridiem = match[3]
  if (meridiem === "pm" && hour < 12) hour += 12
  if (meridiem === "am" && hour === 12) hour = 0
  return {
    hour: clampCalendarTime(hour, 0, 23),
    minute: clampCalendarTime(minute, 0, 59)
  }
}

function parseCalendarWeekdays(value) {
  const weekdays = new Set()
  for (const part of cleanString(value).split(",").map((item) => item.trim()).filter(Boolean)) {
    const numeric = parseCalendarCronField(part, 0, 7, null)
    if (numeric.length) {
      for (const num of numeric) weekdays.add(num === 7 ? 0 : num)
      continue
    }
    const range = parseCalendarWeekdayRange(part)
    if (range.length) {
      for (const day of range) weekdays.add(day)
      continue
    }
    const named = calendarWeekdayNumber(part)
    if (named !== null) weekdays.add(named)
  }
  return [...weekdays]
}

function parseCalendarCronField(value, min, max, fallback) {
  const text = cleanString(value)
  if (!text || text === "?") return fallback === null || fallback === undefined ? [] : [clampCalendarTime(fallback, min, max)]
  const values = new Set()
  for (const rawPart of text.split(",").map((part) => part.trim()).filter(Boolean)) {
    const [baseRaw, stepRaw] = rawPart.split("/")
    const step = Math.max(1, Number(stepRaw || 1) || 1)
    const base = baseRaw || "*"
    let start = min
    let end = max
    if (base !== "*") {
      const rangeParts = base.split("-")
      if (rangeParts.length === 2) {
        start = calendarFieldTokenNumber(rangeParts[0], min, max)
        end = calendarFieldTokenNumber(rangeParts[1], min, max)
      } else {
        start = calendarFieldTokenNumber(base, min, max)
        end = start
      }
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue
    if (start > end) [start, end] = [end, start]
    for (let current = start; current <= end; current += step) {
      if (current >= min && current <= max) values.add(current)
    }
  }
  return [...values].sort((a, b) => a - b)
}

function calendarFieldTokenNumber(value, min, max) {
  const text = cleanString(value)
  if (/^\d+$/.test(text)) return clampCalendarTime(Number(text), min, max)
  const weekday = calendarWeekdayNumber(text)
  if (weekday !== null) return clampCalendarTime(weekday, min, max)
  return Number.NaN
}

function parseCalendarWeekdayRange(value) {
  const text = cleanString(value)
  const [left, right] = text.split("-")
  if (!left || !right) return []
  const start = calendarWeekdayNumber(left)
  const end = calendarWeekdayNumber(right)
  if (start === null || end === null) return []
  const days = []
  let current = start
  for (let count = 0; count < 7; count += 1) {
    days.push(current)
    if (current === end) break
    current = (current + 1) % 7
  }
  return days
}

function calendarNamedWeekdays(text) {
  const weekdays = new Set()
  const lower = cleanString(text).toLowerCase()
  for (const name of ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sun", "mon", "tue", "wed", "thu", "fri", "sat"]) {
    if (!new RegExp(`\\b${name}\\b`).test(lower)) continue
    const value = calendarWeekdayNumber(name)
    if (value !== null) weekdays.add(value)
  }
  return [...weekdays]
}

function calendarWeekdayNumber(value) {
  const key = cleanString(value).toLowerCase().slice(0, 3)
  const map = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null
}

function clampCalendarTime(value, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return min
  return Math.max(min, Math.min(max, Math.trunc(number)))
}


function calendarPartsForTimestamp(timestamp, timezone = "local") {
  const date = new Date(Number(timestamp) || Date.now())
  if (timezone === "UTC") {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
      weekday: date.getUTCDay()
    }
  }
  if (timezone === "local") {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
      weekday: date.getDay()
    }
  }
  const formatter = calendarTimeFormatter(timezone)
  const parts = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") parts[part.type] = part.value
  }
  const year = Number(parts.year)
  const month = Number(parts.month)
  const day = Number(parts.day)
  const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour)
  const minute = Number(parts.minute)
  const second = Number(parts.second)
  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  }
}

function calendarTimeFormatter(timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23"
  })
}

function calendarZonedTimestamp(year, month, day, hour, minute, timezone = "local") {
  if (timezone === "UTC") return Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  if (timezone === "local") return new Date(year, month - 1, day, hour, minute, 0, 0).getTime()
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  let offset = calendarTimezoneOffsetMs(utcGuess, timezone)
  let candidate = utcGuess - offset
  offset = calendarTimezoneOffsetMs(candidate, timezone)
  candidate = utcGuess - offset
  return candidate
}

function calendarTimezoneOffsetMs(timestamp, timezone) {
  const parts = calendarPartsForTimestamp(timestamp, timezone)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0, 0)
  return asUtc - timestamp
}

function calendarAddLocalDays(parts, days) {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0, 0))
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate()
  }
}

function calendarDayKeyForTimestamp(timestamp, timezone = "local") {
  const parts = calendarPartsForTimestamp(timestamp, timezone)
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0")
  ].join("-")
}

function calendarLocalTimeForTimestamp(timestamp, timezone = "local") {
  const parts = calendarPartsForTimestamp(timestamp, timezone)
  return `${calendarDayKeyForTimestamp(timestamp, timezone)} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`
}

function groupCalendarEventsByDay(events = [], timezone = "local") {
  const grouped = {}
  for (const event of events) {
    const timestamp = activityTimestamp(event.date)
    const day = cleanString(event.dayKey) || (timestamp ? calendarDayKeyForTimestamp(timestamp, timezone) : "unknown")
    if (!grouped[day]) grouped[day] = []
    grouped[day].push(event)
  }
  return grouped
}

function summarizeCalendarEvents(events = []) {
  const summary = { total: events.length, missions: 0, jobs: 0, tasks: 0, approvals: 0 }
  for (const event of events) {
    if (event.type === "mission") summary.missions += 1
    if (event.type === "job") summary.jobs += 1
    if (event.type === "task") summary.tasks += 1
    if (event.type === "approval") summary.approvals += 1
  }
  return summary
}

function missionAgendaStatus(value) {
  const text = cleanString(value).toLowerCase()
  if (["complete", "completed", "done"].includes(text)) return "complete"
  if (["failed", "error", "cancelled"].includes(text)) return "failed"
  if (["blocked", "needs_input", "needs-input"].includes(text)) return "needs_input"
  return "running"
}

function missionCalendarStatus(value) {
  const status = missionAgendaStatus(value)
  if (status === "needs_input") return "running"
  return status
}

function isFailureState(value) {
  const text = cleanString(value).toLowerCase()
  return ["failed", "error", "cancelled", "blocked"].includes(text)
}

function agendaGreeting(date) {
  const hour = date.getHours()
  if (hour < 12) return "早上好"
  if (hour < 18) return "下午好"
  return "晚上好"
}

function priorityWeight(value) {
  const text = cleanString(value).toLowerCase()
  if (text === "critical") return 5
  if (text === "urgent") return 4
  if (text === "high") return 3
  if (text === "medium" || text === "normal") return 2
  if (text === "low") return 1
  return 0
}

function parseRouteDate(value) {
  const text = cleanString(value)
  if (!text) return null
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function isSameLocalDay(a, b) {
  if (!a || !b) return false
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// ---------------------------------------------------------------------------
// Hermes compat functions
// ---------------------------------------------------------------------------

async function buildHermesProfilesListCompat(ctx) {
  const agents = await listAgents(ctx)
  const overrides = listAgentProfiles(ctx.dataDir)
  const activeProfile = cleanString(ctx.config?.getAll?.().defaultAgentId) || agents.agents?.[0]?.id || "default"
  const hostProfiles = (agents.agents || []).map((agent) => {
    const override = overrides.find((item) => item.agentId === agent.id)
    return hermesProfileShape({
      agentId: agent.id,
      name: override?.name || agent.name || agent.id,
      partial: override?.partial || {},
      source: override ? "hanaagent-override" : "openhanako-agent",
      updatedAt: override?.updatedAt || ""
    })
  })
  const localOnly = overrides
    .filter((profile) => !hostProfiles.some((item) => item.name === profile.agentId))
    .map(hermesProfileShape)
  return {
    ok: true,
    profiles: [...hostProfiles, ...localOnly],
    activeProfile,
    mode: "openhanako-plugin",
    source: "hanaagent-agent-profiles"
  }
}

async function buildHermesProfileReadCompat(ctx, input = {}) {
  const name = cleanString(input.name) || "default"
  const profiles = await buildHermesProfilesListCompat(ctx)
  const profile = profiles.profiles.find((item) => item.name === name || item.agentId === name) || profiles.profiles[0] || hermesProfileShape({ agentId: name, name })
  return {
    ok: Boolean(profile),
    profile,
    mode: "openhanako-plugin",
    source: "hanaagent-agent-profiles"
  }
}

async function buildHermesProfileCreateCompat(ctx, input = {}) {
  const name = cleanString(input.name || input.agentId || input.profileId)
  if (!name) return { ok: false, error: "name_required" }
  const cloneFrom = cleanString(input.cloneFrom)
  const clone = cloneFrom ? getAgentProfile(ctx.dataDir, cloneFrom) : null
  const result = saveAgentProfile(ctx.dataDir, {
    agentId: name,
    name,
    partial: {
      ...(clone?.partial || {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.provider ? { provider: input.provider } : {})
    },
    source: "hanaagent-profiles-create"
  })
  return { ok: result.ok, profile: hermesProfileShape(result.profile), error: result.error }
}

async function buildHermesProfileUpdateCompat(ctx, input = {}) {
  const name = cleanString(input.name || input.agentId || input.profileId)
  if (!name) return { ok: false, error: "name_required" }
  const patch = input.patch && typeof input.patch === "object" ? input.patch : input
  const result = saveAgentProfile(ctx.dataDir, {
    agentId: name,
    name: cleanString(patch.name) || name,
    partial: patch,
    source: "hanaagent-profiles-update"
  })
  return { ok: result.ok, profile: hermesProfileShape(result.profile), error: result.error }
}

async function buildHermesProfileRenameCompat(ctx, input = {}) {
  const from = cleanString(input.from || input.oldName || input.name || input.agentId)
  const to = cleanString(input.to || input.newName)
  if (!from || !to) return { ok: false, error: "from_to_required" }
  const current = getAgentProfile(ctx.dataDir, from)
  const created = saveAgentProfile(ctx.dataDir, {
    agentId: to,
    name: to,
    partial: current?.partial || {},
    source: "hanaagent-profiles-rename"
  })
  if (current) deleteAgentProfile(ctx.dataDir, from)
  return { ok: created.ok, profile: hermesProfileShape(created.profile), renamedFrom: from, renamedTo: to, error: created.error }
}

function hermesProfileShape(profile = {}) {
  const agentId = cleanString(profile.agentId || profile.name) || "default"
  const partial = profile.partial || profile.config || {}
  return {
    name: cleanString(profile.name) || agentId,
    agentId,
    label: cleanString(profile.name) || agentId,
    config: partial,
    model: cleanString(partial.model || partial.models?.chat),
    provider: cleanString(partial.provider),
    source: cleanString(profile.source) || "hanaagent",
    updatedAt: cleanString(profile.updatedAt),
    path: `openhanako://profiles/${encodeURIComponent(agentId)}`
  }
}

async function buildHermesMemoryListCompat(ctx, input = {}) {
  const [hostResult, localResult, handoffResult] = await Promise.all([
    listMemoryEntries(ctx, input),
    Promise.resolve(listLocalMemory(ctx.dataDir, input)),
    Promise.resolve(listHandoffs(ctx.dataDir, input))
  ])
  const memories = [
    ...(handoffResult.handoffs || []).map((entry) => ({ ...entry, id: `handoff-${entry.workerId || entry.id}`, memoryId: `handoff-${entry.workerId || entry.id}` })),
    ...(localResult.entries || []),
    ...(hostResult.entries || [])
  ]
  return {
    ok: Boolean(hostResult.ok || localResult.ok),
    memories,
    entries: memories,
    source: hostResult.ok ? "openhanako-memory+hanaagent-local" : "hanaagent-local-memory",
    errors: [hostResult.ok ? "" : hostResult.error, localResult.ok ? "" : localResult.error].filter(Boolean)
  }
}

async function buildHermesMemoryReadCompat(ctx, input = {}) {
  const memoryId = cleanString(input.memoryId)
  if (!memoryId) return { ok: false, error: "memoryId_required" }
  if (memoryId.startsWith("handoff-")) {
    const handoff = readHandoff(ctx.dataDir, memoryId.replace(/^handoff-/, ""))
    if (handoff.ok) return { ok: true, memory: handoff.handoff, entry: handoff.handoff, source: "hanaagent-handoff" }
  }
  const local = readLocalMemory(ctx.dataDir, memoryId)
  if (local.ok) return { ok: true, memory: local.entry, entry: local.entry, source: "hanaagent-local-memory" }
  const host = await readMemoryEntry(ctx, input)
  return {
    ok: host.ok,
    memory: host.entry || null,
    entry: host.entry || null,
    source: host.ok ? "openhanako-memory" : "unavailable",
    error: host.error
  }
}

function buildHermesKnowledgeConfigCompat(ctx) {
  const config = ctx.config?.getAll?.() || {}
  return {
    ok: true,
    config: {
      source: cleanString(config.knowledgeSource) || "hanaagent-memory"
    },
    mode: "openhanako-plugin"
  }
}

async function buildHermesKnowledgeListCompat(ctx, input = {}) {
  const memory = await buildHermesMemoryListCompat(ctx, input)
  const pages = (memory.entries || []).map(memoryEntryToKnowledgePage)
  return {
    ok: memory.ok,
    pages,
    exists: true,
    source: "hanaagent-memory",
    errors: memory.errors || []
  }
}

async function buildHermesKnowledgeSearchCompat(ctx, input = {}) {
  const query = cleanString(input.query)
  const list = await buildHermesKnowledgeListCompat(ctx, input)
  const lower = query.toLowerCase()
  const results = (list.pages || []).filter((page) => !lower || [page.title, page.summary, page.path].some((value) => String(value || "").toLowerCase().includes(lower)))
  return {
    ok: true,
    results,
    query,
    source: "hanaagent-memory"
  }
}

async function buildHermesKnowledgeReadCompat(ctx, input = {}) {
  const id = cleanString(input.path).replace(/^memory\//, "").replace(/\.md$/i, "")
  const memory = await buildHermesMemoryReadCompat(ctx, { memoryId: id })
  if (!memory.ok) return { ok: false, error: memory.error || "knowledge_page_not_found" }
  const page = memoryEntryToKnowledgePage(memory.entry || memory.memory || {})
  return {
    ok: true,
    page,
    content: memory.entry?.content || memory.memory?.content || memory.entry?.summary || "",
    backlinks: [],
    source: "hanaagent-memory"
  }
}

async function buildHermesKnowledgeGraphCompat(ctx) {
  const list = await buildHermesKnowledgeListCompat(ctx, {})
  return {
    ok: true,
    nodes: (list.pages || []).map((page) => ({ id: page.path, label: page.title, type: "memory" })),
    edges: [],
    source: "hanaagent-memory"
  }
}

function memoryEntryToKnowledgePage(entry = {}) {
  const id = cleanString(entry.memoryId || entry.id || entry.workerId || entry.title) || "memory"
  return {
    id,
    path: cleanString(entry.path) || `memory/${id}.md`,
    title: cleanString(entry.title || entry.label) || id,
    summary: cleanString(entry.summary || entry.content).slice(0, 240),
    updatedAt: cleanString(entry.updatedAt || entry.createdAt),
    source: cleanString(entry.source) || "hanaagent-memory",
    tags: Array.isArray(entry.tags) ? entry.tags : []
  }
}

function buildHermesHistoryCompat(result = {}, sessionKey = "") {
  return {
    ok: result.ok,
    messages: result.messages || [],
    sessionKey: cleanString(sessionKey) || result.sessionPath || "",
    sessionPath: result.sessionPath || cleanString(sessionKey),
    source: result.ok ? "openhanako-session" : "unavailable",
    toolTrace: result.toolTrace || null,
    error: result.error
  }
}

async function handleHermesSendCompat(ctx, body = {}) {
  const sessionPath = cleanString(body.sessionPath || body.sessionKey || body.key)
  const text = cleanString(body.message || body.text || body.prompt || body.input)
  const result = await sendSessionMessage(ctx, { sessionPath, text })
  return {
    ok: result.ok,
    accepted: result.accepted,
    sessionKey: cleanString(body.sessionKey || body.key) || sessionPath,
    sessionPath,
    message: text,
    mode: "openhanako-session",
    result,
    error: result.error
  }
}

async function streamHermesSendCompat(c, ctx, body = {}) {
  const sent = await handleHermesSendCompat(ctx, body)
  const events = [
    ["open", { ok: true, mode: "openhanako-session", sessionPath: sent.sessionPath }],
    ["message", sent],
    ["done", { ok: sent.ok, accepted: sent.accepted, sessionPath: sent.sessionPath, error: sent.error }]
  ]
  c.header("content-type", "text/event-stream")
  c.header("cache-control", "no-cache")
  c.header("connection", "keep-alive")
  const status = sent.ok ? 200 : sent.error === "sessionPath_required" || sent.error === "message_required" ? 400 : 503
  return c.body(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""), status)
}

function streamHermesEvents(c, ctx, input = {}) {
  const sessionPath = cleanString(input.sessionPath)
  if (sessionPath) return streamSessionEvents(c, ctx, { sessionPath })
  const payload = {
    type: "heartbeat",
    at: new Date().toISOString(),
    pluginId: ctx.pluginId || "hanaagent",
    mode: "openhanako-plugin",
    source: "hanaagent-events"
  }
  c.header("content-type", "text/event-stream")
  c.header("cache-control", "no-cache")
  c.header("connection", "keep-alive")
  return c.body(`event: heartbeat\ndata: ${JSON.stringify(payload)}\n\n`)
}

function buildHermesStartCompat(ctx, action) {
  return {
    ok: true,
    action,
    status: "host-managed",
    mode: "openhanako-plugin",
    pluginId: ctx.pluginId || "hanaagent",
    message: "HanaAgent 已在 OpenHanako 内运行；智能体进程启动由宿主管理。",
    source: "hanaagent-openhanako-runtime"
  }
}

function buildHermesUpdateCompat(ctx) {
  return {
    ok: true,
    checkedAt: Date.now(),
    app: {
      name: "HanaAgent Workbench",
      version: "0.1.0",
      branch: null,
      currentHead: null,
      dirty: null,
      pluginId: ctx.pluginId || "hanaagent"
    },
    remotes: [],
    updateAvailable: false,
    manualConfirmRequired: true,
    mode: "openhanako-plugin",
    note: "插件更新由 OpenHanako 插件安装流程或本地开发副本处理，不通过 Hermes Git 远程仓库。"
  }
}

async function buildHermesCrewStatusCompat(ctx) {
  const overview = await buildOverview(ctx)
  const runtime = buildSwarmRuntimeCompat(overview, {})
  const crews = runtime.entries.map((entry) => ({
    id: entry.workerId,
    displayName: entry.name || entry.workerId,
    humanLabel: `${entry.workerId} - ${entry.role || "Worker"}`,
    role: entry.role || "Worker",
    specialty: entry.specialty || entry.lane || "",
    mission: entry.currentTask || "",
    skills: entry.skills || [],
    capabilities: entry.capabilities || [],
    profilePath: entry.profile || null,
    gateway: {
      state: entry.state || "unknown",
      alive: entry.alive !== false,
      sessionPath: entry.boundary?.sessionPath || ""
    },
    stats: {
      sessionCount: entry.boundary?.sessionPath ? 1 : 0,
      messageCount: entry.chat?.messageCount || 0,
      toolCallCount: entry.toolCalls || 0,
      totalTokens: entry.contextTokens || 0,
      estimatedCostUsd: entry.costUsd || null
    }
  }))
  return {
    ok: true,
    checkedAt: Date.now(),
    crews,
    crew: crews,
    mode: "openhanako-plugin",
    source: "hanaagent-swarm-runtime"
  }
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerSessionRoutes(app, ctx, deps = {}) {
  if (deps.buildOverview) buildOverview = deps.buildOverview

  app.get("/api/agenda", async (c) => {
    return c.json(await buildAgendaSnapshot(ctx, {
      now: c.req.query("now") || "",
      horizonHours: c.req.query("horizonHours") || ""
    }))
  })

  app.get("/api/calendar", async (c) => {
    const config = ctx.config?.getAll?.() || {}
    return c.json(await buildCalendarSnapshot(ctx, {
      start: c.req.query("start") || "",
      end: c.req.query("end") || "",
      mode: c.req.query("mode") || "",
      timezone: c.req.query("timezone") || config.workbenchSettings?.calendarTimezone || ""
    }))
  })

  app.get("/api/history", async (c) => {
    const result = await getSessionHistory(ctx, {
      sessionPath: c.req.query("sessionPath") || c.req.query("sessionKey") || c.req.query("key") || "",
      limit: c.req.query("limit") || ""
    })
    return c.json(buildHermesHistoryCompat(result, c.req.query("sessionKey") || c.req.query("key") || ""), result.ok ? 200 : result.error === "sessionPath_required" ? 422 : 503)
  })

  app.get("/api/events", (c) => {
    return streamHermesEvents(c, ctx, {
      sessionPath: c.req.query("sessionPath") || c.req.query("sessionKey") || c.req.query("key") || ""
    })
  })

  app.get("/api/chat-events", (c) => {
    return streamHermesEvents(c, ctx, {
      sessionPath: c.req.query("sessionPath") || c.req.query("sessionKey") || c.req.query("key") || ""
    })
  })

  app.post("/api/send", async (c) => {
    const result = await handleHermesSendCompat(ctx, await readJson(c))
    return c.json(result, result.ok ? 200 : result.error === "sessionPath_required" || result.error === "message_required" ? 400 : 503)
  })

  app.post("/api/send-stream", async (c) => {
    return streamHermesSendCompat(c, ctx, await readJson(c))
  })

  app.post("/api/start-agent", (c) => {
    return c.json(buildHermesStartCompat(ctx, "start-agent"), 202)
  })

  app.post("/api/start-claude", (c) => {
    return c.json(buildHermesStartCompat(ctx, "start-claude"), 202)
  })

  app.get("/api/claude-update", (c) => {
    return c.json(buildHermesUpdateCompat(ctx))
  })

  app.get("/api/update/status", (c) => {
    return c.json(buildHermesUpdateCompat(ctx))
  })

  app.post("/api/update/agent", (c) => {
    return c.json({
      ...buildHermesUpdateCompat(ctx),
      target: "agent",
      status: "host-managed",
      message: "智能体更新由 OpenHanako 或已安装的模型服务商运行时管理。"
    }, 202)
  })

  app.post("/api/update/workspace", (c) => {
    return c.json({
      ...buildHermesUpdateCompat(ctx),
      target: "workspace",
      status: "host-managed",
      message: "HanaAgent 插件更新通过 OpenHanako 插件安装流程执行。"
    }, 202)
  })

  app.get("/api/crew-status", async (c) => {
    return c.json(await buildHermesCrewStatusCompat(ctx))
  })

  app.get("/api/blueprint", (c) => {
    return c.json({ ok: true, blueprint: getBlueprint() })
  })

  app.get("/api/parity", (c) => {
    return c.json({ ok: true, parity: getParityMatrix() })
  })

  app.get("/api/agents", async (c) => {
    const result = await listAgents(ctx)
    return c.json(result, result.ok ? 200 : 503)
  })

  app.get("/api/agents/:agentId/config", async (c) => {
    const result = await getAgentConfig(ctx, { agentId: c.req.param("agentId") })
    return c.json(result, result.ok ? 200 : result.error === "agentId_required" ? 422 : 503)
  })

  app.patch("/api/agents/:agentId/config", async (c) => {
    const result = await updateAgentConfig(ctx, { ...(await readJson(c)), agentId: c.req.param("agentId") })
    return c.json(result, result.ok ? 200 : result.error === "agentId_required" ? 422 : 503)
  })

  app.get("/api/agent-profiles", (c) => {
    return c.json(listAgentProfileOverrides(ctx))
  })

  app.delete("/api/agent-profiles/:agentId", (c) => {
    const result = deleteAgentProfileOverride(ctx, { agentId: c.req.param("agentId") })
    return c.json(result, result.ok ? 200 : result.error === "profile_not_found" ? 404 : 422)
  })

  app.get("/api/profiles/list", async (c) => {
    return c.json(await buildHermesProfilesListCompat(ctx))
  })

  app.get("/api/profiles/read", async (c) => {
    const result = await buildHermesProfileReadCompat(ctx, {
      name: c.req.query("name") || c.req.query("agentId") || "default"
    })
    return c.json(result, result.profile ? 200 : 404)
  })

  app.post("/api/profiles/create", async (c) => {
    const result = await buildHermesProfileCreateCompat(ctx, await readJson(c))
    return c.json(result, result.ok ? 200 : 422)
  })

  app.post("/api/profiles/update", async (c) => {
    const result = await buildHermesProfileUpdateCompat(ctx, await readJson(c))
    return c.json(result, result.ok ? 200 : 422)
  })

  app.post("/api/profiles/rename", async (c) => {
    const result = await buildHermesProfileRenameCompat(ctx, await readJson(c))
    return c.json(result, result.ok ? 200 : 422)
  })

  app.post("/api/profiles/delete", async (c) => {
    const body = await readJson(c)
    const result = deleteAgentProfile(ctx.dataDir, cleanString(body.name || body.agentId || body.profileId))
    return c.json({ ok: result.ok, deleted: result.agentId, error: result.error }, result.ok ? 200 : result.error === "profile_not_found" ? 404 : 422)
  })

  app.post("/api/profiles/activate", async (c) => {
    const body = await readJson(c)
    const name = cleanString(body.name || body.agentId || body.profileId)
    if (!name) return c.json({ ok: false, error: "name_required" }, 422)
    ctx.config?.setMany?.({ defaultAgentId: name })
    return c.json({ ok: true, activeProfile: name, mode: "openhanako-plugin" })
  })

  app.get("/api/agents/:agentId/skills", async (c) => {
    const result = await listAgentSkills(ctx, { agentId: c.req.param("agentId") })
    return c.json(result, result.ok ? 200 : result.error === "agentId_required" ? 422 : 503)
  })

  app.get("/api/agent-skills", async (c) => {
    const result = await listAgentSkills(ctx, { agentId: c.req.query("agentId") || "" })
    return c.json(result, result.ok ? 200 : result.error === "agentId_required" ? 422 : 503)
  })

  app.get("/api/sessions", async (c) => {
    const result = await listSessions(ctx, { agentId: c.req.query("agentId") || "" })
    return c.json(result, result.ok ? 200 : 503)
  })

  app.post("/api/sessions", async (c) => {
    const result = await createSession(ctx, await readJson(c))
    return c.json(result, result.ok ? 200 : 503)
  })

  app.post("/api/sessions/send", async (c) => {
    const body = await readJson(c)
    const sessionPath = cleanString(body.sessionPath || body.sessionKey || body.key || body.friendlyId)
    const result = await sendSessionMessage(ctx, {
      sessionPath,
      text: body.message || body.text || body.prompt
    })
    return c.json({
      ok: result.ok,
      sessionKey: sessionPath,
      sessionPath,
      runId: result.runId || result.requestId || "",
      result,
      error: result.error
    }, result.ok ? 200 : result.error === "message_required" || result.error === "sessionPath_required" ? 400 : 503)
  })

  app.get("/api/sessions/:sessionKey/status", async (c) => {
    const sessionPath = decodeURIComponent(c.req.param("sessionKey") || "")
    const result = await getSessionStatus(ctx, { sessionPath })
    return c.json({
      ok: result.ok,
      sessionKey: sessionPath,
      sessionPath,
      status: result.status?.state || result.status?.status || "unknown",
      payload: result.status || null,
      error: result.error
    }, result.ok ? 200 : result.error === "sessionPath_required" ? 400 : 503)
  })

  app.get("/api/sessions/$sessionKey/status", async (c) => {
    const sessionPath = cleanString(c.req.query("sessionPath") || c.req.query("sessionKey") || "")
    const result = sessionPath
      ? await getSessionStatus(ctx, { sessionPath })
      : { ok: false, error: "sessionKey_required" }
    return c.json({
      ok: result.ok,
      sessionKey: sessionPath || "$sessionKey",
      sessionPath,
      status: result.status?.state || result.status?.status || "unknown",
      payload: result.status || null,
      error: result.error
    }, result.ok ? 200 : 400)
  })

  app.get("/api/sessions/:sessionKey/active-run", async (c) => {
    const sessionPath = decodeURIComponent(c.req.param("sessionKey") || "")
    const tasks = listTasks(ctx.dataDir, { includeDone: false }).filter((task) => task.sessionPath === sessionPath)
    const runRecords = listRunRecords(ctx.dataDir, { sessionPath }).filter((record) => record.state !== "done" && record.state !== "approved" && record.state !== "denied")
    return c.json({
      ok: true,
      sessionKey: sessionPath,
      sessionPath,
      run: tasks[0] || runRecords[0] || null,
      tasks,
      runRecords,
      source: "hanaagent-session-runtime"
    })
  })

  app.get("/api/sessions/$sessionKey/active-run", async (c) => {
    const sessionPath = cleanString(c.req.query("sessionPath") || c.req.query("sessionKey") || "")
    const tasks = sessionPath ? listTasks(ctx.dataDir, { includeDone: false }).filter((task) => task.sessionPath === sessionPath) : []
    const runRecords = sessionPath ? listRunRecords(ctx.dataDir, { sessionPath }).filter((record) => record.state !== "done" && record.state !== "approved" && record.state !== "denied") : []
    return c.json({
      ok: Boolean(sessionPath),
      sessionKey: sessionPath || "$sessionKey",
      sessionPath,
      run: tasks[0] || runRecords[0] || null,
      tasks,
      runRecords,
      source: "hanaagent-session-runtime",
      error: sessionPath ? undefined : "sessionKey_required"
    }, sessionPath ? 200 : 400)
  })

  app.get("/api/session-status", async (c) => {
    const sessionPath = c.req.query("sessionPath") || c.req.query("sessionKey") || c.req.query("key") || ""
    const result = await getSessionStatus(ctx, { sessionPath })
    if (c.req.query("sessionKey") || c.req.query("key")) {
      return c.json({
        ok: result.ok,
        payload: {
          status: result.status?.state || result.status?.status || "unknown",
          sessionKey: c.req.query("sessionKey") || c.req.query("key") || sessionPath,
          sessionPath,
          sessionLabel: result.status?.title || "",
          model: result.status?.model || "",
          modelProvider: result.status?.provider || "",
          inputTokens: result.status?.usage?.input || 0,
          outputTokens: result.status?.usage?.output || 0,
          totalTokens: result.status?.usage?.total || 0,
          sessions: []
        },
        status: result.status,
        error: result.error
      }, result.ok ? 200 : result.error === "sessionPath_required" ? 422 : 503)
    }
    return c.json(result, result.ok ? 200 : result.error === "sessionPath_required" ? 422 : 503)
  })

  app.get("/api/usage", async (c) => {
    const result = await listUsage(ctx, {
      sessionPath: c.req.query("sessionPath") || "",
      agentId: c.req.query("agentId") || "",
      provider: c.req.query("provider") || "",
      modelId: c.req.query("modelId") || "",
      since: c.req.query("since") || "",
      until: c.req.query("until") || "",
      limit: c.req.query("limit") || ""
    })
    return c.json(result, result.ok ? 200 : 503)
  })

  app.get("/api/context-usage", async (c) => {
    const result = await getContextUsage(ctx, {
      sessionPath: c.req.query("sessionPath") || "",
      agentId: c.req.query("agentId") || "",
      modelId: c.req.query("modelId") || c.req.query("model") || "",
      provider: c.req.query("provider") || "",
      maxContextTokens: c.req.query("maxContextTokens") || c.req.query("contextWindow") || "",
      historyLimit: c.req.query("historyLimit") || c.req.query("limit") || "",
      usageLimit: c.req.query("usageLimit") || "",
      modelMetadata: ctx.config?.getAll?.().modelMetadata || []
    })
    return c.json(result, result.ok ? 200 : result.error === "sessionPath_required" ? 422 : 503)
  })

  app.get("/api/memory", async (c) => {
    const input = {
      agentId: c.req.query("agentId") || "",
      sessionPath: c.req.query("sessionPath") || "",
      query: c.req.query("query") || "",
      kind: c.req.query("kind") || "",
      limit: c.req.query("limit") || ""
    }
    const [hostResult, localResult, handoffResult] = await Promise.all([
      listMemoryEntries(ctx, input),
      Promise.resolve(listLocalMemory(ctx.dataDir, input)),
      Promise.resolve(listHandoffs(ctx.dataDir, input))
    ])
    const entries = [
      ...(handoffResult.handoffs || []),
      ...(localResult.entries || []),
      ...(hostResult.entries || [])
    ]
    return c.json({
      ok: Boolean(hostResult.ok || localResult.ok),
      entries,
      handoffs: handoffResult,
      local: localResult,
      host: hostResult,
      errors: [hostResult.ok ? "" : hostResult.error, localResult.ok ? "" : localResult.error].filter(Boolean)
    }, hostResult.ok || localResult.ok ? 200 : 503)
  })

  app.get("/api/memory/search", (c) => {
    const result = searchLocalMemory(ctx.dataDir, {
      query: c.req.query("query") || "",
      limit: c.req.query("limit") || ""
    })
    return c.json(result)
  })

  app.get("/api/memory/list", async (c) => {
    const result = await buildHermesMemoryListCompat(ctx, {
      agentId: c.req.query("agentId") || "",
      sessionPath: c.req.query("sessionPath") || "",
      query: c.req.query("query") || c.req.query("q") || "",
      limit: c.req.query("limit") || ""
    })
    return c.json(result)
  })

  app.get("/api/memory/read", async (c) => {
    const result = await buildHermesMemoryReadCompat(ctx, {
      memoryId: c.req.query("memoryId") || c.req.query("id") || c.req.query("path") || "",
      agentId: c.req.query("agentId") || "",
      sessionPath: c.req.query("sessionPath") || ""
    })
    return c.json(result, result.ok ? 200 : result.error === "memory_not_found" || result.error === "memoryId_required" ? 404 : 503)
  })

  app.post("/api/memory/write", async (c) => {
    const result = writeLocalMemory(ctx.dataDir, await readJson(c))
    return c.json(result, result.ok ? 200 : result.error === "memory_too_large" ? 413 : 422)
  })

  app.get("/api/knowledge/config", (c) => {
    return c.json(buildHermesKnowledgeConfigCompat(ctx))
  })

  app.post("/api/knowledge/config", async (c) => {
    const current = ctx.config?.getAll?.() || {}
    const body = await readJson(c)
    const source = cleanString(body.source) || current.knowledgeSource || "hanaagent-memory"
    ctx.config?.setMany?.({ knowledgeSource: source })
    return c.json(buildHermesKnowledgeConfigCompat(ctx))
  })

  app.get("/api/knowledge/list", async (c) => {
    return c.json(await buildHermesKnowledgeListCompat(ctx, {
      query: c.req.query("query") || c.req.query("q") || "",
      limit: c.req.query("limit") || ""
    }))
  })

  app.get("/api/knowledge/search", async (c) => {
    const result = await buildHermesKnowledgeSearchCompat(ctx, {
      query: c.req.query("q") || c.req.query("query") || "",
      limit: c.req.query("limit") || ""
    })
    return c.json(result)
  })

  app.get("/api/knowledge/read", async (c) => {
    const result = await buildHermesKnowledgeReadCompat(ctx, {
      path: c.req.query("path") || c.req.query("id") || c.req.query("memoryId") || ""
    })
    return c.json(result, result.page ? 200 : 404)
  })

  app.get("/api/knowledge/graph", async (c) => {
    return c.json(await buildHermesKnowledgeGraphCompat(ctx))
  })

  app.post("/api/knowledge/sync", async (c) => {
    return c.json({
      ok: true,
      synced: true,
      mode: "openhanako-plugin",
      source: "hanaagent-memory",
      result: await buildHermesKnowledgeListCompat(ctx, await readJson(c))
    })
  })

  app.post("/api/memory", async (c) => {
    const result = writeLocalMemory(ctx.dataDir, await readJson(c))
    return c.json(result, result.ok ? 200 : result.error === "memory_too_large" ? 413 : 422)
  })

  app.get("/api/memory/:memoryId", async (c) => {
    const memoryId = c.req.param("memoryId")
    if (memoryId.startsWith("handoff-")) {
      const handoff = readHandoff(ctx.dataDir, memoryId.replace(/^handoff-/, ""))
      if (handoff.ok) return c.json({ ok: true, memoryId, entry: handoff.handoff })
    }
    const local = readLocalMemory(ctx.dataDir, c.req.param("memoryId"))
    if (local.ok) return c.json(local)
    const result = await readMemoryEntry(ctx, {
      memoryId: c.req.param("memoryId"),
      agentId: c.req.query("agentId") || "",
      sessionPath: c.req.query("sessionPath") || ""
    })
    return c.json(result, result.ok ? 200 : result.error === "memoryId_required" ? 422 : 503)
  })

  app.patch("/api/memory/:memoryId", async (c) => {
    const body = await readJson(c)
    const result = writeLocalMemory(ctx.dataDir, { ...body, memoryId: c.req.param("memoryId") })
    return c.json(result, result.ok ? 200 : result.error === "memory_too_large" ? 413 : 422)
  })

  app.delete("/api/memory/:memoryId", (c) => {
    const result = deleteLocalMemory(ctx.dataDir, c.req.param("memoryId"))
    return c.json(result, result.ok ? 200 : result.error === "memory_not_found" ? 404 : 422)
  })

  app.get("/api/host-checkpoints", async (c) => {
    const sessionPath = c.req.query("sessionPath") || ""
    const result = sessionPath
      ? await findSessionCheckpoints(ctx, {
        sessionPath,
        sinceTs: c.req.query("sinceTs") || c.req.query("since") || ""
      })
      : await listHostCheckpoints(ctx, {})
    return c.json(result, result.ok ? 200 : result.error === "sessionPath_required" ? 422 : 503)
  })

  app.post("/api/host-checkpoints/:checkpointId/restore", async (c) => {
    const body = await readJson(c)
    const result = await restoreHostCheckpoint(ctx, {
      ...body,
      checkpointId: c.req.param("checkpointId")
    })
    return c.json(result, result.ok ? 200 : result.error === "checkpointId_required" ? 422 : 503)
  })

  app.get("/api/host-tasks", async (c) => {
    const result = await listHostTasks(ctx, {
      pluginId: c.req.query("pluginId") || "",
      type: c.req.query("type") || "",
      status: c.req.query("status") || "",
      agentId: c.req.query("agentId") || "",
      parentSessionPath: c.req.query("parentSessionPath") || c.req.query("sessionPath") || ""
    })
    return c.json(result, result.ok ? 200 : 503)
  })

  app.post("/api/host-tasks", async (c) => {
    const result = await registerHostTask(ctx, await readJson(c))
    return c.json(result, result.ok ? 200 : 503)
  })

  app.get("/api/host-tasks/:taskId", async (c) => {
    const result = await queryHostTask(ctx, { taskId: c.req.param("taskId") })
    return c.json(result, result.ok ? 200 : result.error === "taskId_required" ? 422 : 503)
  })

  app.post("/api/host-tasks/:taskId/update", async (c) => {
    const result = await updateHostTask(ctx, { ...(await readJson(c)), taskId: c.req.param("taskId") })
    return c.json(result, result.ok ? 200 : result.error === "taskId_required" ? 422 : 503)
  })

  app.post("/api/host-tasks/:taskId/complete", async (c) => {
    const result = await completeHostTask(ctx, { ...(await readJson(c)), taskId: c.req.param("taskId") })
    return c.json(result, result.ok ? 200 : result.error === "taskId_required" ? 422 : 503)
  })

  app.post("/api/host-tasks/:taskId/fail", async (c) => {
    const result = await failHostTask(ctx, { ...(await readJson(c)), taskId: c.req.param("taskId") })
    return c.json(result, result.ok ? 200 : result.error === "taskId_required" ? 422 : 503)
  })

  app.post("/api/host-tasks/:taskId/cancel", async (c) => {
    const result = await cancelHostTask(ctx, { ...(await readJson(c)), taskId: c.req.param("taskId") })
    return c.json(result, result.ok ? 200 : result.error === "taskId_required" ? 422 : 503)
  })

  app.delete("/api/host-tasks/:taskId", async (c) => {
    const result = await removeHostTask(ctx, { taskId: c.req.param("taskId") })
    return c.json(result, result.ok ? 200 : result.error === "taskId_required" ? 422 : 503)
  })

  app.get("/api/deferred-tasks", async (c) => {
    const result = await listDeferredTasks(ctx, { sessionPath: c.req.query("sessionPath") || "" })
    return c.json(result, result.ok ? 200 : 503)
  })

  app.get("/api/deferred-tasks/:taskId", async (c) => {
    const result = await queryDeferredTask(ctx, { taskId: c.req.param("taskId") })
    return c.json(result, result.ok ? 200 : result.error === "taskId_required" ? 422 : 503)
  })

  app.post("/api/dispatch", async (c) => {
    const result = await dispatchMission(ctx, await readJson(c))
    return c.json(result, result.ok ? 200 : result.error === "mission_required" || result.error === "sessionPath_required" ? 422 : 503)
  })

  app.get("/api/session-history", async (c) => {
    const result = await getSessionHistory(ctx, {
      sessionPath: c.req.query("sessionPath") || c.req.query("key") || c.req.query("sessionKey") || "",
      limit: c.req.query("limit") || ""
    })
    const sessionKey = c.req.query("key") || c.req.query("sessionKey") || ""
    if (sessionKey) {
      return c.json({
        ok: result.ok,
        messages: result.messages || [],
        sessionKey,
        sessionPath: result.sessionPath || sessionKey,
        source: result.ok ? "openhanako-session" : "unavailable",
        error: result.error,
        toolTrace: result.toolTrace || null
      }, result.ok ? 200 : result.error === "sessionPath_required" ? 422 : 503)
    }
    return c.json(result, result.ok ? 200 : result.error === "sessionPath_required" ? 422 : 503)
  })

  app.post("/api/session-send", async (c) => {
    const body = await readJson(c)
    const sessionPath = cleanString(body.sessionPath || body.sessionKey || body.key)
    const text = cleanString(body.text || body.message || body.prompt)
    const result = await sendSessionMessage(ctx, { sessionPath, text })
    return c.json({
      ok: result.ok,
      sessionKey: cleanString(body.sessionKey || body.key) || sessionPath,
      sessionPath,
      queued: result.ok,
      accepted: result.accepted,
      result,
      error: result.error
    }, result.ok ? 200 : result.error === "sessionPath_required" || result.error === "message_required" ? 400 : 503)
  })

  app.get("/api/session-export", async (c) => {
    const sessionPath = c.req.query("sessionPath") || ""
    const format = cleanString(c.req.query("format") || "markdown").toLowerCase()
    const result = await getSessionHistory(ctx, {
      sessionPath,
      limit: c.req.query("limit") || 500
    })
    if (!result.ok) return c.json(result, result.error === "sessionPath_required" ? 422 : 503)
    const exported = buildSessionExport({
      sessionPath,
      format,
      messages: result.messages || [],
      toolTrace: result.toolTrace || null
    })
    c.header("content-type", exported.contentType)
    c.header("content-disposition", `attachment; filename="${exported.filename}"`)
    return c.body(exported.body, 200, exported.binary ? { "content-length": String(exported.body.length) } : {})
  })

  app.get("/api/session-export/batch", async (c) => {
    const format = cleanString(c.req.query("format") || "markdown").toLowerCase()
    const mode = cleanString(c.req.query("mode") || "selected").toLowerCase()
    const limit = c.req.query("limit") || 500
    const config = ctx.config.getAll()
    const fromQuery = parseListParam(c.req.query("sessionPaths") || c.req.query("sessionPath") || "")
    const pinned = normalizePinnedSessions(config.pinnedSessions || [])
    const sessionPaths = mode === "pinned"
      ? pinned.map((item) => item.sessionPath)
      : fromQuery
    const unique = [...new Set(sessionPaths.map(cleanString).filter(Boolean))].slice(0, 20)
    if (!unique.length) return c.json({ ok: false, error: "sessionPaths_required", mode, sessions: [] }, 422)
    const results = []
    for (const sessionPath of unique) {
      const history = await getSessionHistory(ctx, { sessionPath, limit })
      const pinnedMeta = pinned.find((item) => item.sessionPath === sessionPath) || null
      results.push({
        ok: history.ok,
        sessionPath,
        title: pinnedMeta?.title || sessionPath.split("/").pop() || sessionPath,
        pinned: Boolean(pinnedMeta),
        history,
        exported: history.ok
          ? buildSessionExport({
            sessionPath,
            format: "markdown",
            messages: history.messages || [],
            toolTrace: history.toolTrace || null
          })
          : null
      })
    }
    const exported = buildSessionBatchExport({ mode, format, sessions: results })
    c.header("content-type", exported.contentType)
    c.header("content-disposition", `attachment; filename="${exported.filename}"`)
    return c.body(exported.body, 200, exported.binary ? { "content-length": String(exported.body.length) } : {})
  })

  app.post("/api/session-fork", async (c) => {
    const result = await forkSession(ctx, await readJson(c))
    const status = result.ok
      ? 200
      : result.error === "sessionPath_required"
        ? 422
        : result.mode === "prompt-ready"
          ? 503
          : 503
    return c.json(result, status)
  })

  app.post("/api/session-title", async (c) => {
    const body = await readJson(c)
    const sessionPath = cleanString(body.sessionPath)
    if (!sessionPath) return c.json({ ok: false, error: "sessionPath_required" }, 422)
    const result = await getSessionHistory(ctx, {
      sessionPath,
      limit: body.limit || 80
    })
    if (!result.ok) return c.json(result, result.error === "sessionPath_required" ? 422 : 503)
    const sessions = await listSessions(ctx, { agentId: cleanString(body.agentId) })
    const current = (sessions.sessions || []).find((session) => session.path === sessionPath) || {}
    return c.json(buildSessionTitleSuggestion({
      sessionPath,
      currentTitle: body.currentTitle || current.title || "",
      messages: result.messages || []
    }))
  })

  app.post("/api/session-aliases", async (c) => {
    const body = await readJson(c)
    const sessionPath = cleanString(body.sessionPath || body.path)
    const title = cleanString(body.title || body.name)
    if (!sessionPath) return c.json({ ok: false, error: "sessionPath_required" }, 422)
    if (!title) return c.json({ ok: false, error: "title_required" }, 422)
    const config = ctx.config.getAll()
    const sessionAliases = normalizeSessionAliases([
      {
        sessionPath,
        title,
        source: "hanaagent-workbench",
        updatedAt: new Date().toISOString()
      },
      ...(Array.isArray(config.sessionAliases) ? config.sessionAliases : []).filter((item) => cleanString(item?.sessionPath || item?.path) !== sessionPath)
    ])
    ctx.config.setMany({ sessionAliases })
    return c.json({ ok: true, alias: sessionAliases.find((item) => item.sessionPath === sessionPath) || null, sessionAliases, config: ctx.config.getAll() })
  })

  app.delete("/api/session-aliases", async (c) => {
    const body = await readJson(c)
    const sessionPath = cleanString(body.sessionPath || body.path)
    if (!sessionPath) return c.json({ ok: false, error: "sessionPath_required" }, 422)
    const config = ctx.config.getAll()
    const sessionAliases = normalizeSessionAliases(config.sessionAliases || []).filter((item) => item.sessionPath !== sessionPath)
    ctx.config.setMany({ sessionAliases })
    return c.json({ ok: true, removed: sessionPath, sessionAliases, config: ctx.config.getAll() })
  })

  app.post("/api/session-tombstones", async (c) => {
    const body = await readJson(c)
    const sessionPath = cleanString(body.sessionPath || body.path)
    if (!sessionPath) return c.json({ ok: false, error: "sessionPath_required" }, 422)
    const config = ctx.config.getAll()
    const sessionTombstones = normalizeSessionTombstones([
      {
        sessionPath,
        title: cleanString(body.title || body.name),
        agentId: cleanString(body.agentId),
        deletedAt: new Date().toISOString(),
        reason: cleanString(body.reason) || "hidden-from-hanaagent-workbench"
      },
      ...(Array.isArray(config.sessionTombstones) ? config.sessionTombstones : []).filter((item) => cleanString(item?.sessionPath || item?.path) !== sessionPath)
    ])
    const pinnedSessions = normalizePinnedSessions(config.pinnedSessions || []).filter((item) => item.sessionPath !== sessionPath)
    const sessionAliases = normalizeSessionAliases(config.sessionAliases || []).filter((item) => item.sessionPath !== sessionPath)
    const patch = { sessionTombstones, pinnedSessions, sessionAliases }
    if (cleanString(config.defaultSessionPath) === sessionPath) patch.defaultSessionPath = ""
    ctx.config.setMany(patch)
    return c.json({ ok: true, tombstone: sessionTombstones.find((item) => item.sessionPath === sessionPath) || null, sessionTombstones, config: ctx.config.getAll() })
  })

  app.delete("/api/session-tombstones", async (c) => {
    const body = await readJson(c)
    const sessionPath = cleanString(body.sessionPath || body.path)
    if (!sessionPath) return c.json({ ok: false, error: "sessionPath_required" }, 422)
    const config = ctx.config.getAll()
    const sessionTombstones = normalizeSessionTombstones(config.sessionTombstones || []).filter((item) => item.sessionPath !== sessionPath)
    ctx.config.setMany({ sessionTombstones })
    return c.json({ ok: true, restored: sessionPath, sessionTombstones, config: ctx.config.getAll() })
  })

  app.get("/api/session-events", (c) => {
    return streamSessionEvents(c, ctx, {
      sessionPath: c.req.query("sessionPath") || "",
      types: c.req.query("types") || ""
    })
  })

  app.post("/api/session-abort", async (c) => {
    const result = await abortSession(ctx, await readJson(c))
    return c.json(result, result.ok ? 200 : result.error === "sessionPath_required" ? 422 : 503)
  })

  app.post("/api/session-revert-turn", async (c) => {
    const result = await revertSessionTurn(ctx, await readJson(c))
    return c.json(result, result.ok ? 200 : result.error === "sessionPath_required" ? 422 : 503)
  })

  app.get("/api/terminals", async (c) => {
    const result = await listTerminals(ctx, { sessionPath: c.req.query("sessionPath") || "" })
    return c.json(result, result.ok ? 200 : result.error === "sessionPath_required" ? 422 : 503)
  })

  app.post("/api/terminals", async (c) => {
    const result = await startTerminal(ctx, await readJson(c))
    return c.json(result, result.ok ? 200 : result.error === "sessionPath_required" || result.error === "cwd_required" ? 422 : 503)
  })

  app.get("/api/terminals/:terminalId/read", async (c) => {
    const result = await readTerminal(ctx, {
      sessionPath: c.req.query("sessionPath") || "",
      terminalId: c.req.param("terminalId"),
      sinceSeq: c.req.query("sinceSeq") || ""
    })
    return c.json(result, result.ok ? 200 : result.error === "sessionPath_required" || result.error === "terminalId_required" ? 422 : 503)
  })

  app.post("/api/terminals/:terminalId/write", async (c) => {
    const body = await readJson(c)
    const result = await writeTerminal(ctx, {
      ...body,
      terminalId: c.req.param("terminalId")
    })
    return c.json(result, result.ok ? 200 : result.error === "sessionPath_required" || result.error === "terminalId_required" || result.error === "chars_required" ? 422 : 503)
  })

  app.post("/api/terminals/:terminalId/close", async (c) => {
    const body = await readJson(c)
    const result = await closeTerminal(ctx, {
      ...body,
      terminalId: c.req.param("terminalId")
    })
    return c.json(result, result.ok ? 200 : result.error === "sessionPath_required" || result.error === "terminalId_required" ? 422 : 503)
  })

  app.post("/api/terminal-stream", async (c) => {
    const body = await readJson(c)
    const sessionPath = cleanString(body.sessionPath || body.sessionKey || body.key || body.sessionId)
    const result = await startTerminal(ctx, {
      sessionPath,
      cwd: body.cwd || ".",
      command: Array.isArray(body.command) ? body.command.join(" ") : body.command,
      label: body.label || "Hermes Terminal",
      cols: body.cols,
      rows: body.rows
    })
    if (!result.ok) {
      return c.json({ ok: false, error: result.error, result }, result.error === "sessionPath_required" || result.error === "cwd_required" ? 400 : 503)
    }
    const terminalId = result.terminal?.terminalId || result.terminalId || "terminal"
    const read = await readTerminal(ctx, { sessionPath, terminalId, sinceSeq: 0 })
    const events = [
      ["session", { sessionId: terminalId, terminalId, sessionPath, reattach: false, source: "openhanako-terminal" }],
      ["data", { output: read.output || "", seq: read.seq || 0, terminalId, sessionPath }],
      ["close", { sessionId: terminalId, terminalId, sessionPath, openhanakoManaged: true }]
    ]
    c.header("content-type", "text/event-stream")
    c.header("cache-control", "no-cache")
    c.header("connection", "keep-alive")
    return c.body(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""))
  })

  app.post("/api/terminal-input", async (c) => {
    const body = await readJson(c)
    const result = await writeTerminal(ctx, {
      sessionPath: body.sessionPath || body.sessionKey || body.key || body.sessionId,
      terminalId: body.terminalId || body.sessionId,
      chars: typeof body.chars === "string" ? body.chars : body.data
    })
    return c.json({ ok: result.ok, result, error: result.error }, result.ok ? 200 : result.error === "sessionPath_required" || result.error === "terminalId_required" || result.error === "chars_required" ? 400 : 503)
  })

  app.post("/api/terminal-resize", async (c) => {
    const body = await readJson(c)
    const terminalId = cleanString(body.terminalId || body.sessionId)
    if (!terminalId) return c.json({ ok: false, error: "sessionId required" }, 400)
    return c.json({
      ok: true,
      sessionId: terminalId,
      terminalId,
      cols: clampRouteNumber(body.cols, 20, 500, 80),
      rows: clampRouteNumber(body.rows, 5, 300, 24),
      acknowledged: true,
      source: "openhanako-terminal"
    })
  })

  app.post("/api/terminal-close", async (c) => {
    const body = await readJson(c)
    const result = await closeTerminal(ctx, {
      sessionPath: body.sessionPath || body.sessionKey || body.key || body.sessionId,
      terminalId: body.terminalId || body.sessionId
    })
    return c.json({ ok: result.ok, result, error: result.error }, result.ok ? 200 : result.error === "sessionPath_required" || result.error === "terminalId_required" ? 400 : 503)
  })
}
