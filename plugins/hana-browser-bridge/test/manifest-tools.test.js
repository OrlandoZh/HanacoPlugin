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

test("manifest is full-access, workflow-only, and has maintenance UI", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, "manifest.json"), "utf8"));
  assert.equal(manifest.id, "hana-browser-bridge");
  assert.equal(manifest.trust, "full-access");
  assert.deepEqual(manifest.contributes.configuration.properties.toolProfile.enum, ["workflow"]);
  assert.equal(manifest.contributes.page.route, "/page");
});

test("all workflow adapters are generated and side effects require review", async () => {
  for (const name of expectedWorkflow) {
    const file = path.join(pluginDir, "tools", `${name}.js`);
    assert.equal(fs.existsSync(file), true, file);
    const mod = await import(pathToFileURL(file));
    assert.equal(mod.name, name);
    assert.equal(typeof mod.execute, "function");
    assert.ok(mod.parameters && typeof mod.parameters === "object");
    if (["browser_health", "browser_list_tabs", "browser_read_counters"].includes(name)) {
      assert.equal(mod.sessionPermission.readOnly, true);
    } else {
      assert.equal(mod.sessionPermission.kind, "external_side_effect");
      assert.equal(mod.sessionPermission.auto, "review");
    }
  }
});

test("bundled bridge metadata matches package and records a commit", () => {
  const metadata = JSON.parse(fs.readFileSync(path.join(pluginDir, "vendor/browser-bridge/BUNDLED_VERSION.json"), "utf8"));
  assert.equal(metadata.name, "browser-bridge");
  assert.equal(metadata.version, "3.0.0");
  assert.match(metadata.commit, /^[0-9a-f]{40}$/);
});
