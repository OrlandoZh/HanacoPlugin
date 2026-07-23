import assert from "node:assert/strict";
import test from "node:test";
import HanaAgentPlugin from "../index.js";

function makePlugin(workbenchSettings) {
  const writes = [];
  return {
    plugin: Object.assign(Object.create(HanaAgentPlugin.prototype), {
      ctx: {
        config: {
          getAll: () => ({ workbenchSettings }),
          setMany: (values) => writes.push(values)
        },
        log: { info() {} }
      }
    }),
    writes
  };
}

test("legacy Hermes workbench theme migrates to Starmap once", () => {
  const { plugin, writes } = makePlugin({ themePreset: "hermes", theme: "dark", accentColor: "blue" });

  plugin.migrateWorkbenchThemeSettings();

  assert.deepEqual(writes, [{
    workbenchSettings: {
      themePreset: "starmap",
      theme: "light",
      accentColor: "green",
      starmapDefaultApplied: true
    }
  }]);
});

test("explicitly migrated or non-Hermes themes are preserved", () => {
  const migrated = makePlugin({ themePreset: "starmap", theme: "light", accentColor: "green", starmapDefaultApplied: true });
  const custom = makePlugin({ themePreset: "claude-classic", theme: "dark", accentColor: "orange" });

  migrated.plugin.migrateWorkbenchThemeSettings();
  custom.plugin.migrateWorkbenchThemeSettings();

  assert.deepEqual(migrated.writes, []);
  assert.deepEqual(custom.writes, []);
});
