const CHECKPOINT_KEYS = ["STATE:", "FILES_CHANGED:", "COMMANDS_RUN:", "RESULT:", "BLOCKER:", "NEXT_ACTION:"];

export function buildToolTrace(input = {}) {
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const events = Array.isArray(input.events) ? input.events : [];
  const items = [];
  for (const message of messages) {
    items.push(...traceFromMessage(message));
  }
  for (const event of events) {
    const item = traceFromEvent(event);
    if (item) items.push(item);
  }
  const deduped = dedupe(items);
  return {
    ok: true,
    items: deduped.sort(compareTraceItems),
    summary: summarizeTrace(deduped)
  };
}

export function traceFromMessage(message = {}) {
  const items = [];
  const raw = message.raw && typeof message.raw === "object" ? message.raw : message;
  const text = clean(message.text || message.message || contentBlocksToText(raw.content) || message.content);
  const at = clean(message.createdAt || message.timestamp || message.at) || new Date().toISOString();
  const sourceId = clean(message.id) || `message-${at}`;
  const toolCalls = [
    ...array(raw.toolCalls),
    ...array(raw.tool_calls),
    ...array(raw.tools),
    ...array(raw.toolResults),
    ...array(raw.tool_results),
    ...toolCallsFromContentBlocks(raw.content)
  ];
  for (const call of toolCalls) {
    const name = clean(call.name || call.toolName || call.function?.name || call.tool_use_id || call.tool_call_id || call.type) || "tool";
    const args = call.arguments || call.args || call.input || call.function?.arguments || call.params || call.content || call.output || call.result || "";
    const kind = isToolResult(call) ? "tool-result" : "tool";
    items.push(traceItem({
      id: `${sourceId}-tool-${items.length}`,
      kind,
      status: clean(call.status || call.state) || "observed",
      title: name,
      detail: stringify(args).slice(0, 500),
      at,
      source: "session-history",
      messageId: sourceId
    }));
  }
  if (looksLikeCheckpoint(text)) {
    items.push(traceItem({
      id: `${sourceId}-checkpoint`,
      kind: "checkpoint",
      status: checkpointStatus(text),
      title: "Checkpoint",
      detail: firstLine(fieldValue(text, "RESULT") || text),
      at,
      source: "session-history",
      messageId: sourceId
    }));
  }
  for (const command of extractListField(text, "COMMANDS_RUN")) {
    items.push(traceItem({
      id: `${sourceId}-command-${command}`,
      kind: "command",
      status: "observed",
      title: command,
      detail: "",
      at,
      source: "session-history",
      messageId: sourceId
    }));
  }
  for (const command of extractShellCommands(text)) {
    items.push(traceItem({
      id: `${sourceId}-command-${command}`,
      kind: "command",
      status: "observed",
      title: command,
      detail: "",
      at,
      source: "session-history",
      messageId: sourceId
    }));
  }
  for (const file of extractListField(text, "FILES_CHANGED")) {
    items.push(traceItem({
      id: `${sourceId}-file-${file}`,
      kind: "file",
      status: "changed",
      title: file,
      detail: "",
      at,
      source: "session-history",
      messageId: sourceId
    }));
  }
  for (const file of extractMentionedFiles(text)) {
    items.push(traceItem({
      id: `${sourceId}-file-${file}`,
      kind: "file",
      status: "referenced",
      title: file,
      detail: "",
      at,
      source: "session-history",
      messageId: sourceId
    }));
  }
  if (/\b(error|failed|exception|traceback)\b/i.test(text)) {
    items.push(traceItem({
      id: `${sourceId}-error`,
      kind: "error",
      status: "error",
      title: "Error signal",
      detail: firstLine(text).slice(0, 500),
      at,
      source: "session-history",
      messageId: sourceId
    }));
  }
  return items;
}

export function traceFromEvent(event = {}) {
  const type = clean(event.type || event.event?.type) || "event";
  const at = clean(event.at || event.timestamp || event.createdAt) || new Date().toISOString();
  const id = clean(event.id) || `${type}-${at}`;
  const payload = event.event && typeof event.event === "object" ? event.event : event;
  const toolName = clean(payload.toolName || payload.name || payload.tool?.name || payload.function?.name);
  if (toolName || type.includes("tool")) {
    return traceItem({
      id,
      kind: "tool",
      status: clean(payload.status || payload.state) || type,
      title: toolName || type,
      detail: stringify(payload.input || payload.arguments || payload.args || payload.result || payload.output || payload).slice(0, 500),
      at,
      source: "session-event",
      sessionPath: clean(event.sessionPath)
    });
  }
  if (type.includes("terminal") || type.includes("command")) {
    return traceItem({
      id,
      kind: "command",
      status: type,
      title: firstLine(event.text || event.message || event.delta || type).slice(0, 160),
      detail: stringify(payload).slice(0, 500),
      at,
      source: "session-event",
      sessionPath: clean(event.sessionPath)
    });
  }
  if (type === "error" || payload.error) {
    return traceItem({
      id,
      kind: "error",
      status: "error",
      title: clean(payload.error || payload.message) || "Error",
      detail: stringify(payload).slice(0, 500),
      at,
      source: "session-event",
      sessionPath: clean(event.sessionPath)
    });
  }
  if (type === "turn_end") {
    return traceItem({
      id,
      kind: "turn",
      status: "done",
      title: "Turn ended",
      detail: clean(event.sessionPath),
      at,
      source: "session-event",
      sessionPath: clean(event.sessionPath)
    });
  }
  return null;
}

function traceItem(input) {
  return {
    id: input.id,
    kind: input.kind || "event",
    status: input.status || "observed",
    title: input.title || "Trace item",
    detail: input.detail || "",
    at: input.at || new Date().toISOString(),
    source: input.source || "unknown",
    sessionPath: input.sessionPath || "",
    messageId: input.messageId || ""
  };
}

function summarizeTrace(items) {
  const summary = { total: items.length, tool: 0, "tool-result": 0, command: 0, file: 0, checkpoint: 0, error: 0, turn: 0 };
  for (const item of items) summary[item.kind] = (summary[item.kind] || 0) + 1;
  return summary;
}

function dedupe(items) {
  const seen = new Set();
  const next = [];
  for (const item of items) {
    const key = item.id || `${item.kind}:${item.at}:${item.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(item);
  }
  return next;
}

function compareTraceItems(a, b) {
  return String(b.at || "").localeCompare(String(a.at || ""));
}

function looksLikeCheckpoint(text) {
  const value = clean(text);
  return CHECKPOINT_KEYS.filter((key) => value.includes(key)).length >= 2;
}

function checkpointStatus(text) {
  return clean(fieldValue(text, "STATE")) || "checkpoint";
}

function fieldValue(text, key) {
  const re = new RegExp(`^${key}:?\\s*(.*)$`, "im");
  const match = clean(text).match(re);
  return match ? clean(match[1]) : "";
}

function extractListField(text, key) {
  const value = fieldValue(text, key);
  if (!value || /^(none|无|n\/a)$/i.test(value)) return [];
  return value.split(/[,;\n]/).map(clean).filter(Boolean).slice(0, 20);
}

function extractShellCommands(text) {
  const commands = [];
  const lines = clean(text).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    const fenceCommand = trimmed.match(/^```(?:bash|sh|zsh|shell|terminal)\s*$/i);
    if (fenceCommand) continue;
    const prompt = trimmed.match(/^(?:[$>]|\w+@\S+[$#])\s+(.+)$/);
    if (prompt?.[1]) commands.push(prompt[1]);
    const inline = trimmed.match(/\b(?:run|ran|command|命令)[:：]\s*`?([^`]+?)`?$/i);
    if (inline?.[1]) commands.push(inline[1]);
  }
  return unique(commands.map(clean).filter(Boolean)).slice(0, 20);
}

function extractMentionedFiles(text) {
  const matches = clean(text).match(/(?:^|[\s("'`])((?:\.{1,2}\/|\/)?(?:[\w.-]+\/)+[\w.-]+\.[a-z0-9]{1,12})(?=$|[\s)"'`,:;])/gim) || [];
  return unique(matches.map((match) => clean(match).replace(/^[\s("'`]+/, "").replace(/[\s)"'`,:;]+$/, "")).filter(Boolean)).slice(0, 30);
}

function firstLine(value) {
  return clean(value).split(/\r?\n/).find((line) => line.trim()) || "";
}

function stringify(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function toolCallsFromContentBlocks(content) {
  if (!Array.isArray(content)) return [];
  return content.filter((part) => {
    const type = clean(part?.type);
    return ["tool_use", "toolCall", "tool_call", "tool_result", "toolResult", "function_call"].includes(type)
      || part?.tool_use_id
      || part?.tool_call_id;
  });
}

function contentBlocksToText(content) {
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    return clean(part?.text || part?.content);
  }).filter(Boolean).join("\n");
}

function isToolResult(call) {
  const type = clean(call?.type);
  return type === "tool_result" || type === "toolResult" || Boolean(call?.tool_use_id || call?.tool_call_id);
}

function unique(values) {
  return [...new Set(values)];
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}
