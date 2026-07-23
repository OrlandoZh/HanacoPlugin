import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { CORE_VERSION, PLUGIN_VERSION } from "../lib/mcp-client.js";
import { execute as executeStatusTool } from "../tools/browser_bridge_status.js";

const packageMetadata = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

// Bundled metadata may be absent in a fresh clone without `npm run sync:bridge`.
// When present, CORE_VERSION must match; when absent, it must be "unavailable".
const bundledMetadataPath = new URL("../vendor/browser-bridge/BUNDLED_VERSION.json", import.meta.url);
const bundledMetadataExists = fs.existsSync(bundledMetadataPath);
const bundledMetadata = bundledMetadataExists
  ? JSON.parse(fs.readFileSync(bundledMetadataPath, "utf8"))
  : null;

test("runtime versions are sourced from package and bundled core metadata", async () => {
  assert.equal(PLUGIN_VERSION, packageMetadata.version);

  if (bundledMetadataExists) {
    assert.equal(CORE_VERSION, bundledMetadata.version);
  } else {
    assert.equal(CORE_VERSION, "unavailable");
  }

  const result = await executeStatusTool({}, {
    config: {
      connectionMode: "dedicated",
      cdpHost: "127.0.0.1",
      cdpPort: 1,
      autoStartChrome: false,
    },
  });

  assert.equal(result.details.pluginVersion, packageMetadata.version);
  if (bundledMetadataExists) {
    assert.equal(result.details.coreVersion, bundledMetadata.version);
  } else {
    assert.equal(result.details.coreVersion, "unavailable");
  }
  const exposed = JSON.parse(result.content[0].text.slice("Browser Bridge\n".length));
  assert.equal(exposed.pluginVersion, packageMetadata.version);
  if (bundledMetadataExists) {
    assert.equal(exposed.coreVersion, bundledMetadata.version);
  } else {
    assert.equal(exposed.coreVersion, "unavailable");
  }
});
