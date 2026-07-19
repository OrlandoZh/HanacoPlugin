import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { CORE_VERSION, PLUGIN_VERSION } from "../lib/mcp-client.js";
import { execute as executeStatusTool } from "../tools/browser_bridge_status.js";

const packageMetadata = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const bundledMetadata = JSON.parse(
  fs.readFileSync(
    new URL("../vendor/browser-bridge/BUNDLED_VERSION.json", import.meta.url),
    "utf8",
  ),
);

test("runtime versions are sourced from package and bundled core metadata", async () => {
  assert.equal(PLUGIN_VERSION, packageMetadata.version);
  assert.equal(CORE_VERSION, bundledMetadata.version);

  const result = await executeStatusTool({}, {
    config: {
      connectionMode: "dedicated",
      cdpHost: "127.0.0.1",
      cdpPort: 1,
      autoStartChrome: false,
    },
  });

  assert.equal(result.details.pluginVersion, packageMetadata.version);
  assert.equal(result.details.coreVersion, bundledMetadata.version);
  const exposed = JSON.parse(result.content[0].text.slice("Browser Bridge\n".length));
  assert.equal(exposed.pluginVersion, packageMetadata.version);
  assert.equal(exposed.coreVersion, bundledMetadata.version);
});
