import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHandoffPrompt,
  buildWorkerLifecycle
} from "../lib/worker-lifecycle.js";

test("worker lifecycle maps context pressure to watch, handoff, and renew states", () => {
  let lifecycle = buildWorkerLifecycle({
    assignment: { id: "a1", sessionPath: "/sessions/a1.jsonl" },
    usage: { summary: { totalTokens: 260000 } }
  });
  assert.equal(lifecycle.state, "watch");
  assert.equal(lifecycle.recommendedAction, "monitor-context");
  assert.equal(lifecycle.canRequestHandoff, true);

  lifecycle = buildWorkerLifecycle({
    assignment: { id: "a1", sessionPath: "/sessions/a1.jsonl" },
    usage: { summary: { totalTokens: 410000 } }
  });
  assert.equal(lifecycle.state, "handoff_required");
  assert.equal(lifecycle.recommendedAction, "request-handoff");

  lifecycle = buildWorkerLifecycle({
    assignment: { id: "a1", sessionPath: "/sessions/a1.jsonl" },
    usage: { summary: { totalTokens: 520000 } },
    checkpoints: [{ state: "HANDOFF", createdAt: "2026-01-01T00:00:00.000Z" }]
  });
  assert.equal(lifecycle.state, "renew_required");
  assert.equal(lifecycle.canRenew, true);
  assert.equal(lifecycle.lastHandoffAt, "2026-01-01T00:00:00.000Z");
});

test("handoff prompt uses strict Swarm2 lifecycle checkpoint contract", () => {
  const lifecycle = buildWorkerLifecycle({
    worker: { id: "worker-1", name: "Builder" },
    assignment: { id: "a1", label: "Build", task: "Ship UI", sessionPath: "/sessions/a1.jsonl" },
    usage: { summary: { totalTokens: 410000 } }
  });
  const prompt = buildHandoffPrompt({
    worker: { id: "worker-1", name: "Builder" },
    assignment: { id: "a1", label: "Build", task: "Ship UI" },
    lifecycle
  });
  assert.match(prompt, /STATE: HANDOFF/);
  assert.match(prompt, /FILES_CHANGED:/);
  assert.match(prompt, /COMMANDS_RUN:/);
  assert.match(prompt, /NEXT_ACTION:/);
  assert.match(prompt, /Context tokens: 410000/);
});
