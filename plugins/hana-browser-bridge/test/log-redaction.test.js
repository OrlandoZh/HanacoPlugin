import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeError } from "../lib/mcp-client.js";

test("MCP error sanitization removes browser endpoints and sensitive headers", () => {
  const input = "open ws://127.0.0.1:54061/devtools/browser/abc-123 failed Authorization: Bearer secret Cookie=session=secret /devtools/browser/deadbeef";
  const output = sanitizeError(input);
  assert.doesNotMatch(output, /abc-123|deadbeef|Bearer secret|session=secret/);
  assert.match(output, /redacted-browser-endpoint|\/devtools\/browser\/\[redacted\]/);
  assert.match(output, /Authorization=\[redacted\]/i);
  assert.match(output, /Cookie=\[redacted\]/i);
});
