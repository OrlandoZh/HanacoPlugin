import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const pluginDir = path.resolve(new URL("..", import.meta.url).pathname);
const expectedWorkflow = [
  "browser_action", "browser_attach_tab", "browser_detach_tab", "browser_detect_modals",
  "browser_dom", "browser_eval", "browser_health", "browser_import_batch", "browser_list_tabs",
  "browser_navigate", "browser_new_tab", "browser_press_key", "browser_read_counters",
  "browser_type_sequence", "browser_type_text",
];
const requiredByTool = new Map([
  ["browser_action", ["targetId", "action", "selector"]],
  ["browser_attach_tab", ["targetId"]],
  ["browser_detach_tab", ["targetId"]],
  ["browser_detect_modals", ["targetId"]],
  ["browser_dom", ["targetId", "expression"]],
  ["browser_eval", ["targetId", "expression"]],
  ["browser_import_batch", ["targetId", "selector", "codes"]],
  ["browser_navigate", ["targetId", "url"]],
  ["browser_press_key", ["targetId", "key"]],
  ["browser_read_counters", ["targetId"]],
  ["browser_type_sequence", ["targetId", "selector", "texts"]],
  ["browser_type_text", ["targetId", "selector", "value"]],
]);

test("manifest is full-access, workflow-only, and has maintenance UI", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "manifest.json"), "utf8"));
  assert.equal(manifest.id, "hana-browser-bridge");
  assert.equal(manifest.trust, "full-access");
  assert.deepEqual(manifest.contributes.configuration.properties.toolProfile.enum, ["workflow"]);
  assert.deepEqual(manifest.contributes.configuration.properties.connectionMode.enum, ["dedicated", "existing-chrome"]);
  assert.deepEqual(manifest.contributes.configuration.properties.existingChromeChannel.enum, ["stable", "beta", "dev", "canary"]);
  assert.deepEqual(manifest.contributes.configuration.properties.existingChromeRequireExplicitStart.enum, [true]);
  assert.equal(manifest.contributes.page.route, "/page");
  assert.deepEqual(manifest.ui.hostCapabilities, ["clipboard.writeText"]);
  const panel = fs.readFileSync(path.join(pluginDir, "assets/panel.js"), "utf8");
  assert.doesNotMatch(panel, /toast\.show/);
});

test("all workflow adapters are generated and side effects require review", async () => {
  for (const name of expectedWorkflow) {
    const file = path.join(pluginDir, "tools", `${name}.js`);
    assert.equal(fs.existsSync(file), true, file);
    const mod = await import(pathToFileURL(file));
    assert.equal(mod.name, name);
    assert.equal(typeof mod.execute, "function");
    assert.equal(mod.parameters?.type, "object");
    assert.ok(mod.parameters?.properties && typeof mod.parameters.properties === "object");
    assert.deepEqual(mod.parameters.required, requiredByTool.get(name) || []);
    assert.equal(mod.parameters.additionalProperties, false);
    if (["browser_health", "browser_list_tabs", "browser_read_counters"].includes(name)) {
      assert.equal(mod.sessionPermission.readOnly, true);
    } else {
      assert.equal(mod.sessionPermission.kind, "external_side_effect");
      assert.equal(mod.sessionPermission.auto, "review");
    }
  }
});

test("emergency detach is a reviewed management action", async () => {
  const file = path.join(pluginDir, "tools", "browser_emergency_detach.js");
  assert.equal(fs.existsSync(file), true);
  const mod = await import(pathToFileURL(file));
  assert.equal(mod.name, "browser_emergency_detach");
  assert.equal(mod.sessionPermission.kind, "external_side_effect");
  assert.equal(mod.sessionPermission.auto, "review");
  assert.deepEqual(mod.parameters.required, []);
});

test("bundled bridge metadata matches package and records a commit", () => {
  const metadata = JSON.parse(fs.readFileSync(path.join(pluginDir, "vendor/browser-bridge/BUNDLED_VERSION.json"), "utf8"));
  assert.equal(metadata.name, "browser-bridge");
  assert.equal(metadata.version, "3.1.3");
  assert.match(metadata.commit, /^[0-9a-f]{40}$/);
  assert.equal(typeof metadata.dirty, "boolean");
});
