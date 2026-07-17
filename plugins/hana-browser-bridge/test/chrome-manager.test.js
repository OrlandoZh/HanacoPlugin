import test from "node:test";
import assert from "node:assert/strict";
import { parseDevToolsActivePort } from "../lib/chrome-manager.js";

test("DevToolsActivePort parser accepts a loopback browser WebSocket descriptor", () => {
  assert.deepEqual(
    parseDevToolsActivePort("54061\n/devtools/browser/abc-123_DEF\n"),
    { port: 54061, wsPath: "/devtools/browser/abc-123_DEF" },
  );
});

test("DevToolsActivePort parser rejects malformed or non-browser paths", () => {
  assert.throws(() => parseDevToolsActivePort("0\n/devtools/browser/x\n"), /Invalid DevToolsActivePort port/);
  assert.throws(() => parseDevToolsActivePort("9222\n/devtools/page/x\n"), /Invalid DevToolsActivePort browser path/);
  assert.throws(() => parseDevToolsActivePort("9222\nws://remote/devtools/browser/x\n"), /Invalid DevToolsActivePort browser path/);
});
