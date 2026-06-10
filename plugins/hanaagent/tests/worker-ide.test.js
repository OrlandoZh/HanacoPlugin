import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildWorkerIdeSnapshot,
  extractPreviewUrls,
  isEmbeddablePreviewUrl
} from "../lib/worker-ide.js";

test("preview url extraction normalizes local and remote urls", () => {
  const urls = extractPreviewUrls("Preview at http://localhost:5173/app, backup https://example.com/demo.");
  assert.deepEqual(urls, ["http://localhost:5173/app", "https://example.com/demo"]);
  assert.equal(isEmbeddablePreviewUrl("http://localhost:5173/app"), true);
  assert.equal(isEmbeddablePreviewUrl("https://example.com/demo"), true);
  assert.equal(isEmbeddablePreviewUrl("http://example.com/demo"), false);
});

test("worker IDE snapshot aggregates health, queue, chat, files, and actions", () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-worker-ide-repo-"));
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({
    name: "worker-ide-project",
    packageManager: "pnpm@10.0.0",
    scripts: { dev: "vite", test: "node --test", build: "vite build" }
  }, null, 2));
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".git", "HEAD"), "ref: refs/heads/feature/worker-ide\n");
  const snapshot = buildWorkerIdeSnapshot({
    worker: { id: "worker-1", name: "Builder", status: "running" },
    agent: { id: "primary", name: "Primary" },
    assignment: {
      id: "assignment-1",
      label: "Build",
      lane: "build",
      state: "blocked",
      taskId: "task-1",
      sessionPath: "/sessions/primary.jsonl",
      agentId: "primary",
      cwd: repo,
      blocker: "Need approval",
      result: "Preview: http://localhost:5173/app",
      filesChanged: [path.join(repo, "src/app.tsx"), "docs/outside.md"]
    },
    sessions: [{ path: "/sessions/primary.jsonl", title: "Build chat", messageCount: 4 }],
    tasks: [
      { id: "task-1", title: "Current task", column: "running" },
      { id: "task-2", title: "Next task", column: "backlog" },
      { id: "task-3", title: "Done task", column: "done" }
    ],
    checkpoints: [{ state: "BLOCKED", blocker: "Need approval", createdAt: new Date().toISOString(), result: "See http://127.0.0.1:3000" }],
    runRecords: [{ id: "artifact-1", type: "artifact", title: "Artifact", path: path.join(repo, "out.md"), summary: "Preview https://example.com/demo", meta: { filesChanged: [path.join(repo, "src/app.css")] } }],
    hostTasks: [{ taskId: "host-1", status: "running" }],
    deferredTasks: [{ taskId: "deferred-1", status: "pending" }],
    usage: { summary: { totalTokens: 42 } },
    workspaceRoots: [{ id: "repo", label: "Repo", path: repo }],
    terminalAvailable: true
  });

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.health.state, "blocked");
  assert.equal(snapshot.health.blockers.includes("Need approval"), true);
  assert.equal(snapshot.taskQueue.current.id, "task-1");
  assert.equal(snapshot.taskQueue.next.length, 1);
  assert.equal(snapshot.chat.sessions[0].path, "/sessions/primary.jsonl");
  assert.equal(snapshot.files.paths.includes(repo), true);
  assert.equal(snapshot.files.primaryRoot.id, "repo");
  assert.equal(snapshot.files.project.projectName, "worker-ide-project");
  assert.equal(snapshot.files.project.branch, "feature/worker-ide");
  assert.deepEqual(snapshot.files.project.packageScripts.slice(0, 3), ["dev", "test", "build"]);
  assert.equal(snapshot.files.project.packageManager, "pnpm@10.0.0");
  assert.equal(snapshot.files.changedFiles.some((file) => file.relativePath === "src/app.tsx" && file.rootId === "repo"), true);
  assert.equal(snapshot.files.changedFiles.some((file) => file.relativePath === "src/app.css" && file.rootId === "repo"), true);
  assert.equal(snapshot.files.editorActions.some((action) => action.id === "open-changed-file" && action.enabled && action.path === "src/app.tsx"), true);
  assert.equal(snapshot.files.editorActions.some((action) => action.id === "diff-changed-file" && action.enabled), true);
  assert.equal(snapshot.files.editorActions.some((action) => action.id === "save-changed-file" && action.enabled && action.kind === "save"), true);
  assert.equal(snapshot.previews[0].url, "http://localhost:5173/app");
  assert.equal(snapshot.previews[0].embedAllowed, true);
  assert.equal(snapshot.previews[0].recommended, true);
  assert.equal(snapshot.previews.some((preview) => preview.url === "https://example.com/demo"), true);
  assert.equal(snapshot.artifacts.length, 1);
  assert.equal(snapshot.quickActions.some((action) => action.id === "ensure-session" && action.enabled), true);
  assert.equal(snapshot.quickActions.some((action) => action.id === "open-preview" && action.enabled), true);
  assert.equal(snapshot.quickActions.some((action) => action.id === "attach-terminal" && action.enabled), true);
});
