import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveBridgeSource } from "../scripts/resolve-bridge-source.mjs";

function fakeBridge(root) {
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.mkdirSync(path.join(root, "tools"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "browser-bridge" }));
  fs.writeFileSync(path.join(root, "scripts/start-mcp-server-stdio.mjs"), "");
}

test("resolveBridgeSource prefers an explicit CLI path", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hana-bb-resolve-"));
  const bridge = path.join(temp, "bridge");
  const plugin = path.join(temp, "plugin");
  fakeBridge(bridge);
  fs.mkdirSync(plugin);
  assert.equal(resolveBridgeSource(plugin, ["--bridge-dir", bridge], {}), bridge);
  fs.rmSync(temp, { recursive: true, force: true });
});

test("resolveBridgeSource accepts BROWSER_BRIDGE_DIR and explains missing sources", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hana-bb-resolve-"));
  const bridge = path.join(temp, "bridge");
  const plugin = path.join(temp, "plugin");
  fakeBridge(bridge);
  fs.mkdirSync(plugin);
  assert.equal(resolveBridgeSource(plugin, [], { BROWSER_BRIDGE_DIR: bridge }), bridge);
  assert.throws(() => resolveBridgeSource(plugin, [], {}), /Cannot locate the browser-bridge source repository/);
  fs.rmSync(temp, { recursive: true, force: true });
});
