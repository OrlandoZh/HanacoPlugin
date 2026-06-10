import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createWorkspaceDirectory,
  deleteWorkspacePath,
  diffWorkspaceFile,
  listWorkspaceFiles,
  listWorkspaceRoots,
  readWorkspaceFile,
  renameWorkspacePath,
  uploadWorkspaceFile,
  writeWorkspaceFile
} from "../lib/workspace-files.js";

function makeCtx() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-files-"));
  fs.writeFileSync(path.join(dataDir, "note.md"), "# Hello\n", "utf8");
  fs.mkdirSync(path.join(dataDir, "docs"));
  fs.writeFileSync(path.join(dataDir, "docs", "guide.txt"), "Guide\n", "utf8");
  return {
    dataDir,
    config: {
      getAll() {
        return {};
      }
    }
  };
}

test("workspace files list plugin data root and read text files", () => {
  const ctx = makeCtx();
  const roots = listWorkspaceRoots(ctx);
  assert.equal(roots.ok, true);
  assert.equal(roots.roots[0].id, "plugin-data");

  const listing = listWorkspaceFiles(ctx, { rootId: "plugin-data", path: ".", depth: 1 });
  assert.equal(listing.ok, true);
  assert.equal(listing.entries.some((entry) => entry.relativePath === "note.md"), true);

  const file = readWorkspaceFile(ctx, { rootId: "plugin-data", path: "note.md" });
  assert.equal(file.ok, true);
  assert.equal(file.kind, "text");
  assert.equal(file.content, "# Hello\n");
});

test("workspace files write text inside allowed roots only", () => {
  const ctx = makeCtx();
  const written = writeWorkspaceFile(ctx, {
    rootId: "plugin-data",
    path: "docs/new.md",
    content: "Saved\n"
  });
  assert.equal(written.ok, true);
  assert.equal(written.content, "Saved\n");
  assert.equal(fs.readFileSync(path.join(ctx.dataDir, "docs", "new.md"), "utf8"), "Saved\n");

  const escape = writeWorkspaceFile(ctx, {
    rootId: "plugin-data",
    path: "../escape.md",
    content: "nope"
  });
  assert.equal(escape.ok, false);
  assert.equal(escape.error, "path_not_allowed");
});

test("workspace files upload text and image content inside writable roots", () => {
  const ctx = makeCtx();
  const text = uploadWorkspaceFile(ctx, {
    rootId: "plugin-data",
    path: "uploads/note.txt",
    content: Buffer.from("Uploaded text\n", "utf8").toString("base64"),
    encoding: "base64",
    filename: "note.txt"
  });
  assert.equal(text.ok, true);
  assert.equal(text.uploaded, true);
  assert.equal(text.kind, "text");
  assert.equal(text.content, "Uploaded text\n");

  const pngBytes = Buffer.from("89504e470d0a1a0a", "hex");
  const image = uploadWorkspaceFile(ctx, {
    rootId: "plugin-data",
    path: "uploads/pixel.png",
    content: pngBytes.toString("base64"),
    encoding: "base64",
    filename: "pixel.png"
  });
  assert.equal(image.ok, true);
  assert.equal(image.kind, "image");
  assert.equal(image.encoding, "base64");
  assert.equal(Buffer.from(image.content, "base64").equals(pngBytes), true);

  const escape = uploadWorkspaceFile(ctx, {
    rootId: "plugin-data",
    path: "../escape.png",
    content: pngBytes.toString("base64"),
    encoding: "base64"
  });
  assert.equal(escape.ok, false);
  assert.equal(escape.error, "path_not_allowed");
});

test("workspace files produce unified text diffs without writing", () => {
  const ctx = makeCtx();
  const diff = diffWorkspaceFile(ctx, {
    rootId: "plugin-data",
    path: "note.md",
    content: "# Hello\n\nNew line\n"
  });
  assert.equal(diff.ok, true);
  assert.equal(diff.changed, true);
  assert.equal(diff.stats.additions, 2);
  assert.equal(diff.stats.deletions, 0);
  assert.equal(diff.diff.includes("--- a/note.md"), true);
  assert.equal(diff.diff.includes("+New line"), true);
  assert.equal(fs.readFileSync(path.join(ctx.dataDir, "note.md"), "utf8"), "# Hello\n");
});

test("workspace roots can be configured as readonly", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-readonly-"));
  fs.writeFileSync(path.join(root, "readme.md"), "readonly", "utf8");
  const ctx = {
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-data-")),
    config: {
      getAll() {
        return {
          workspaceRoots: [{ id: "repo", label: "Repo", path: root, writable: false }]
        };
      }
    }
  };

  const roots = listWorkspaceRoots(ctx);
  assert.equal(roots.roots.some((item) => item.id === "repo" && item.writable === false), true);
  const read = readWorkspaceFile(ctx, { rootId: "repo", path: "readme.md" });
  assert.equal(read.ok, true);
  const write = writeWorkspaceFile(ctx, { rootId: "repo", path: "readme.md", content: "change" });
  assert.equal(write.ok, false);
  assert.equal(write.error, "root_readonly");
});

test("workspace file operations create directories, rename paths, and delete files", () => {
  const ctx = makeCtx();
  const mkdir = createWorkspaceDirectory(ctx, { rootId: "plugin-data", path: "drafts" });
  assert.equal(mkdir.ok, true);
  assert.equal(fs.existsSync(path.join(ctx.dataDir, "drafts")), true);

  const write = writeWorkspaceFile(ctx, { rootId: "plugin-data", path: "drafts/a.md", content: "A" });
  assert.equal(write.ok, true);

  const renamed = renameWorkspacePath(ctx, {
    rootId: "plugin-data",
    path: "drafts/a.md",
    to: "drafts/b.md"
  });
  assert.equal(renamed.ok, true);
  assert.equal(fs.existsSync(path.join(ctx.dataDir, "drafts", "b.md")), true);
  assert.equal(fs.existsSync(path.join(ctx.dataDir, "drafts", "a.md")), false);

  const deleted = deleteWorkspacePath(ctx, { rootId: "plugin-data", path: "drafts/b.md" });
  assert.equal(deleted.ok, true);
  assert.equal(fs.existsSync(path.join(ctx.dataDir, "drafts", "b.md")), false);
});

test("workspace file operations reject root and traversal mutations", () => {
  const ctx = makeCtx();
  const deleteRoot = deleteWorkspacePath(ctx, { rootId: "plugin-data", path: "." });
  assert.equal(deleteRoot.ok, false);
  assert.equal(deleteRoot.error, "cannot_delete_root");

  const renameRoot = renameWorkspacePath(ctx, { rootId: "plugin-data", path: ".", to: "renamed-root" });
  assert.equal(renameRoot.ok, false);
  assert.equal(renameRoot.error, "cannot_rename_root");

  const mkdirEscape = createWorkspaceDirectory(ctx, { rootId: "plugin-data", path: "../escape" });
  assert.equal(mkdirEscape.ok, false);
  assert.equal(mkdirEscape.error, "path_not_allowed");
});
