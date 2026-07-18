import test from "node:test";
import assert from "node:assert/strict";
import {
  ExistingChromeConnectGuard,
  classifyBrowserConnectFailure,
} from "../lib/existing-chrome-connect-guard.js";

test("classifies only safe existing-Chrome connection failure enums", () => {
  assert.equal(classifyBrowserConnectFailure({
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: "Chrome user denied the browser connection" }) }],
  }), "consent-denied");
  assert.equal(classifyBrowserConnectFailure({
    isError: true,
    content: [{ type: "text", text: "Error: Unable to connect to Chrome DevTools WebSocket" }],
  }), "connection-failed");
  assert.equal(classifyBrowserConnectFailure({ content: [{ type: "text", text: '{"ok":false,"error":"NO_SESSION"}' }] }), null);
  for (const text of [
    "ENDPOINT_MISSING",
    "DevToolsActivePort was not found",
    "Unable to enable Chrome target discovery",
    "Bridge is not connected",
    "WebSocket timed out",
    "EXPLICIT_RECONNECT_REQUIRED",
    "Existing Chrome reconnect requires a reviewed bridge restart",
  ]) {
    assert.equal(classifyBrowserConnectFailure({ isError: true, content: [{ type: "text", text }] }), "connection-failed");
  }
  assert.equal(classifyBrowserConnectFailure({ isError: true, content: [] }), "connection-failed");
  for (const text of ["HTTP 403", "Chrome user denied the browser connection", "EXPLICIT_RECONNECT_REQUIRED"]) {
    assert.equal(classifyBrowserConnectFailure({
      content: [{ type: "text", text: JSON.stringify({ ok: true, result: { pageText: text } }) }],
    }), null, "successful page data must never trip the connection latch");
  }
  assert.equal(classifyBrowserConnectFailure(new Error("transport closed"), { thrown: true }), "connection-failed");
});

test("one reviewed attempt is allowed and a failed result blocks subsequent tool calls", async () => {
  const guard = new ExistingChromeConnectGuard();
  const key = "profile-default";
  let calls = 0;
  guard.reviewedStart(key);

  const denied = await guard.invoke(key, async () => {
    calls += 1;
    return { content: [{ type: "text", text: '{"ok":false,"error":"Chrome user denied the browser connection"}' }] };
  });
  assert.equal(calls, 1);
  assert.match(denied.content[0].text, /denied/);
  assert.deepEqual(guard.status(key), {
    retryBlocked: true,
    retryBlockReason: "consent-denied",
    attemptInFlight: false,
    browserConnected: false,
  });

  await assert.rejects(
    guard.invoke(key, async () => { calls += 1; return {}; }),
    /BROWSER_CONNECT_REVIEW_REQUIRED/,
  );
  assert.equal(calls, 1, "blocked calls must not reach client.callTool");
});

test("reviewed start clears the latch and grants exactly one new attempt", async () => {
  const guard = new ExistingChromeConnectGuard();
  const key = "profile-default";
  let calls = 0;
  guard.reviewedStart(key);
  await guard.invoke(key, async () => {
    calls += 1;
    throw new Error("transport closed");
  }).catch(() => {});

  guard.reviewedStart(key);
  const result = await guard.invoke(key, async () => {
    calls += 1;
    return { content: [{ type: "text", text: '{"ok":true,"tabs":[]}' }] };
  });
  assert.equal(calls, 2);
  assert.match(result.content[0].text, /"ok":true/);
  assert.deepEqual(guard.status(key), {
    retryBlocked: false,
    retryBlockReason: null,
    attemptInFlight: false,
    browserConnected: true,
  });

  await guard.invoke(key, async () => {
    calls += 1;
    return { content: [{ type: "text", text: '{"ok":true}' }] };
  });
  assert.equal(calls, 3, "successful calls share the established browser connection");
});

test("concurrent calls cannot create duplicate Chrome authorization prompts", async () => {
  const guard = new ExistingChromeConnectGuard();
  const key = "profile-default";
  let release;
  let calls = 0;
  guard.reviewedStart(key);

  const first = guard.invoke(key, async () => {
    calls += 1;
    await new Promise((resolve) => { release = resolve; });
    return { content: [{ type: "text", text: '{"ok":true}' }] };
  });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    guard.invoke(key, async () => { calls += 1; return {}; }),
    /BROWSER_CONNECT_ATTEMPT_IN_PROGRESS/,
  );
  assert.equal(calls, 1);
  release();
  await first;
});

test("clear removes blocked state for shutdown and emergency detach", async () => {
  const guard = new ExistingChromeConnectGuard();
  const key = "profile-default";
  guard.reviewedStart(key);
  await guard.invoke(key, async () => {
    throw new Error("transport closed");
  }).catch(() => {});
  assert.equal(guard.status(key).retryBlocked, true);
  guard.clear();
  assert.deepEqual(guard.status(key), {
    retryBlocked: false,
    retryBlockReason: null,
    attemptInFlight: false,
    browserConnected: false,
  });
});
