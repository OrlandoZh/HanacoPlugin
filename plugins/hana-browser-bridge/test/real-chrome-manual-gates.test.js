import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import {
  captureSnapshot,
  classifyProbeError,
  classifyUnexpectedResponse,
  endpointFingerprint,
  parseDevToolsActivePort,
} from "../scripts/real-chrome-manual-gates.mjs";

const SECRET_PATH = "/devtools/browser/01234567-89ab-cdef-0123-456789abcdef";

test("manual gate parser is strict and fingerprint never echoes endpoint material", () => {
  const parsed = parseDevToolsActivePort(`43123\n${SECRET_PATH}\n`);
  assert.deepEqual(parsed, { port: 43123, browserPath: SECRET_PATH });
  const fingerprint = endpointFingerprint(parsed);
  assert.match(fingerprint, /^[0-9a-f]{16}$/);
  assert.doesNotMatch(fingerprint, /43123|01234567|devtools/);
  assert.throws(() => parseDevToolsActivePort(`43123\n/devtools/page/x\n`), /browser path/);
  assert.throws(() => parseDevToolsActivePort(`43123\n${SECRET_PATH}\nextra\n`), /format/);
});

test("snapshot output contains only a fingerprint and health flags", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hana-real-gate-test-"));
  try {
    fs.writeFileSync(path.join(dir, "DevToolsActivePort"), `43123\n${SECRET_PATH}\n`);
    const snapshot = await captureSnapshot(dir);
    const serialized = JSON.stringify(snapshot);
    assert.equal(snapshot.endpointValid, true);
    assert.match(snapshot.endpointFingerprint, /^[0-9a-f]{16}$/);
    assert.doesNotMatch(serialized, /43123|01234567|devtools\/browser|sessionId|webSocketDebuggerUrl/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test("authorization probe only treats explicit 401/403-style rejection as Deny", () => {
  assert.deepEqual(classifyUnexpectedResponse(403, "deny"), {
    observed: "deny", passed: true, responseClass: "HTTP_403",
  });
  assert.deepEqual(classifyUnexpectedResponse(500, "deny"), {
    observed: "connection-error", passed: false, responseClass: "HTTP_500",
  });
  assert.deepEqual(classifyProbeError("Unexpected server response: 403", "deny"), {
    observed: "deny", passed: true,
  });
  assert.deepEqual(classifyProbeError("connect ECONNREFUSED 127.0.0.1", "deny"), {
    observed: "connection-error", passed: false,
  });
});


test("CLI failures redact filesystem paths and endpoint details", () => {
  const script = path.resolve("scripts/real-chrome-manual-gates.mjs");
  const result = spawnSync(process.execPath, [script, "compare", "--before", "/definitely/not/present.json"], {
    cwd: path.resolve("."),
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stderr.trim()), { ok: false, errorClass: "MANUAL_GATE_ERROR" });
  assert.doesNotMatch(result.stderr, /definitely|\/Users\/|devtools\/browser|sessionId|wss?:\/\//i);
});
