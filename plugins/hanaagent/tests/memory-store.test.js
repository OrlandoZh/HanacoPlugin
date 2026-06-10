import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  deleteLocalMemory,
  listLocalMemory,
  readLocalMemory,
  searchLocalMemory,
  writeLocalMemory
} from "../lib/memory-store.js";

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-memory-"));
}

test("local memory store writes, lists, reads, searches, and deletes markdown entries", () => {
  const dataDir = tempDataDir();
  const written = writeLocalMemory(dataDir, {
    title: "Project Memory",
    summary: "Important note",
    content: "Remember the conductor checkpoint contract.\nSecond line."
  });

  assert.equal(written.ok, true);
  assert.equal(written.entry.title, "Project Memory");
  assert.match(written.entry.content, /checkpoint contract/);

  const listed = listLocalMemory(dataDir, { query: "important" });
  assert.equal(listed.ok, true);
  assert.equal(listed.entries.length, 1);

  const read = readLocalMemory(dataDir, written.entry.memoryId);
  assert.equal(read.ok, true);
  assert.equal(read.entry.memoryId, written.entry.memoryId);

  const searched = searchLocalMemory(dataDir, { query: "checkpoint" });
  assert.equal(searched.ok, true);
  assert.equal(searched.matches[0].line, 1);

  const deleted = deleteLocalMemory(dataDir, written.entry.memoryId);
  assert.equal(deleted.ok, true);
  assert.equal(listLocalMemory(dataDir).entries.length, 0);
});

test("local memory ids are path safe", () => {
  const dataDir = tempDataDir();
  const written = writeLocalMemory(dataDir, {
    memoryId: "../Unsafe Memory.md",
    content: "safe"
  });

  assert.equal(written.ok, true);
  assert.equal(written.entry.memoryId, "unsafe-memory");
  assert.equal(fs.existsSync(path.join(dataDir, "memory", "unsafe-memory.md")), true);
  assert.equal(fs.existsSync(path.join(dataDir, "Unsafe Memory.md")), false);
});
