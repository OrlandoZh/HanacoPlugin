import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyIntegrationAction, buildIntegrationCatalog } from "../lib/integration-catalog.js";

function makeCtx() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hanaagent-integrations-"));
  const pluginDir = path.resolve(dataDir, "..", "..", "plugins", "sample-plugin");
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "manifest.json"), JSON.stringify({
    id: "sample-plugin",
    name: "Sample Plugin",
    version: "1.0.0",
    trust: "restricted",
    description: "Sample integration"
  }), "utf8");
  return {
    dataDir,
    config: {
      get(key) {
        if (key === "mcp") {
          return {
            enabled: true,
            connectors: [{ id: "local-files", name: "Local Files", command: "node", tools: [{ name: "read" }], authType: "none" }]
          };
        }
        return null;
      }
    },
    bus: {
      actions: [],
      updates: [],
      listCapabilities() {
        return [{ type: "agent:skills", available: true }, { type: "agent:update-config", available: true }, { type: "mcp:settings-action", available: true }];
      },
      async request(type, payload) {
        if (type === "agent:skills") return { skills: [{ id: "review", name: "Review", description: "Review work", enabled: true }] };
        if (type === "mcp:settings-action") {
          this.actions.push(payload);
          return { settingsUpdate: { status: "applied", action: payload.action } };
        }
        if (type === "agent:config") return { config: { skills: { enabled: ["review"] } } };
        if (type === "agent:update-config") {
          this.updates.push(payload);
          return { config: { skills: payload.partial.skills } };
        }
        throw new Error(`unexpected ${type}`);
      }
    }
  };
}

test("integration catalog aggregates mcp connectors, skills, plugins, and bus capabilities", async () => {
  const ctx = makeCtx();
  const catalog = await buildIntegrationCatalog(ctx, { agentId: "primary" });

  assert.equal(catalog.ok, true);
  assert.equal(catalog.items.some((item) => item.id === "mcp:local-files"), true);
  assert.equal(catalog.items.some((item) => item.id === "skill:review"), true);
  assert.equal(catalog.items.some((item) => item.id === "plugin:sample-plugin"), true);
  assert.equal(catalog.items.some((item) => item.id === "capability:agent:skills"), true);
  assert.equal(catalog.health.mcpConnectors, 1);
  assert.equal(catalog.health.skills, 1);
  const mcp = catalog.items.find((item) => item.id === "mcp:local-files");
  assert.equal(mcp.actions.some((action) => action.id === "mcp.connector.start"), true);
  const skill = catalog.items.find((item) => item.id === "skill:review");
  assert.equal(skill.actions.some((action) => action.id === "skill.toggle"), true);
});

test("integration action proxies allowlisted mcp settings actions and rejects unsupported actions", async () => {
  const ctx = makeCtx();
  let result = await applyIntegrationAction(ctx, { action: "mcp.global.enabled", payload: { enabled: true }, agentId: "primary" });
  assert.equal(result.ok, true);
  assert.equal(ctx.bus.actions[0].action, "mcp.global.enabled");

  result = await applyIntegrationAction(ctx, { action: "mcp.connector.remove", payload: { connectorId: "local-files" }, agentId: "primary" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "unsupported_action");

  result = await applyIntegrationAction(ctx, { action: "skill.install", payload: {} });
  assert.equal(result.ok, false);
  assert.equal(result.error, "unsupported_action");
});

test("integration action toggles agent skills through agent config updates", async () => {
  const ctx = makeCtx();
  const result = await applyIntegrationAction(ctx, {
    action: "skill.toggle",
    agentId: "primary",
    payload: { skillId: "review", enabled: false }
  });

  assert.equal(result.ok, true);
  assert.equal(ctx.bus.updates.length, 1);
  assert.deepEqual(ctx.bus.updates[0].partial.skills.enabled, []);
  assert.equal(result.settingsUpdate.action, "skill.toggle");
});
