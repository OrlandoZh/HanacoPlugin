import assert from "node:assert/strict";
import test from "node:test";
import {
  buildToolTrace,
  traceFromEvent,
  traceFromMessage
} from "../lib/tool-trace.js";

test("tool trace extracts tool calls, commands, files, and checkpoint status from history", () => {
  const message = {
    id: "msg-1",
    role: "assistant",
    text: [
      "STATE: DONE",
      "FILES_CHANGED: plugins/hanaagent/routes/workbench.js, plugins/hanaagent/lib/tool-trace.js",
      "COMMANDS_RUN: npm test",
      "RESULT: tool trace rendered",
      "BLOCKER: none",
      "NEXT_ACTION: review"
    ].join("\n"),
    createdAt: "2026-01-01T00:00:00.000Z",
    raw: {
      toolCalls: [{ name: "apply_patch", arguments: { file: "workbench.js" }, status: "ok" }]
    }
  };

  const items = traceFromMessage(message);
  assert.equal(items.some((item) => item.kind === "tool" && item.title === "apply_patch"), true);
  assert.equal(items.some((item) => item.kind === "command" && item.title === "npm test"), true);
  assert.equal(items.some((item) => item.kind === "file" && item.title.includes("workbench.js")), true);
  assert.equal(items.some((item) => item.kind === "checkpoint" && item.status === "DONE"), true);
});

test("tool trace extracts live tool and error events", () => {
  const tool = traceFromEvent({
    type: "tool_call",
    sessionPath: "/sessions/primary.jsonl",
    event: { toolName: "terminal.write", input: { command: "npm test" }, status: "running" },
    at: "2026-01-01T00:01:00.000Z"
  });
  assert.equal(tool.kind, "tool");
  assert.equal(tool.title, "terminal.write");

  const error = traceFromEvent({
    type: "error",
    event: { error: "boom" },
    at: "2026-01-01T00:02:00.000Z"
  });
  assert.equal(error.kind, "error");
});

test("tool trace extracts Claude content blocks, tool results, shell commands, and mentioned files", () => {
  const items = traceFromMessage({
    id: "msg-blocks",
    role: "assistant",
    content: [
      { type: "text", text: "Run: `npm test`\nChanged plugins/hanaagent/lib/tool-trace.js" },
      { type: "tool_use", name: "shell", input: { command: "npm test" } },
      { type: "tool_result", tool_use_id: "toolu_1", content: "88 passed" }
    ],
    createdAt: "2026-01-01T00:03:00.000Z"
  });

  assert.equal(items.some((item) => item.kind === "tool" && item.title === "shell"), true);
  assert.equal(items.some((item) => item.kind === "tool-result" && item.title === "toolu_1"), true);
  assert.equal(items.some((item) => item.kind === "command" && item.title === "npm test"), true);
  assert.equal(items.some((item) => item.kind === "file" && item.title === "plugins/hanaagent/lib/tool-trace.js"), true);
});

test("tool trace extracts OpenAI tool_calls even without message text", () => {
  const trace = buildToolTrace({
    messages: [{
      id: "msg-openai-tool",
      role: "assistant",
      text: "",
      raw: {
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "workspace.write", arguments: "{\"path\":\"README.md\"}" }
        }]
      }
    }]
  });

  assert.equal(trace.summary.tool, 1);
  assert.equal(trace.items[0].title, "workspace.write");
  assert.match(trace.items[0].detail, /README\.md/);
});

test("tool trace summary counts extracted items", () => {
  const trace = buildToolTrace({
    messages: [
      {
        id: "msg-1",
        text: "COMMANDS_RUN: npm test\nRESULT: ok",
        raw: { tool_calls: [{ function: { name: "shell" }, arguments: "npm test" }] }
      }
    ],
    events: [{ type: "turn_end", sessionPath: "/sessions/primary.jsonl" }]
  });
  assert.equal(trace.ok, true);
  assert.equal(trace.summary.tool, 1);
  assert.equal(trace.summary.command, 1);
  assert.equal(trace.summary.turn, 1);
});
