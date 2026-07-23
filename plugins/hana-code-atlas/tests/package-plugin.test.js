/**
 * tests/package-plugin.test.js
 *
 * 针对 scripts/package-plugin.mjs 的纯 helper 和包内容校验测试。
 * 不产生正式 zip（main() 仅在 direct execution 时运行）。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PackError,
  DEFAULT_SOURCE_DATE_EPOCH,
  INCLUDE_TOP_LEVEL,
  REQUIRED_PATHS,
  normalizeRelPath,
  isAllowlisted,
  isExcluded,
  shouldPackage,
  computeAssetSetSha256,
  resolveSourceDateEpoch,
  checkZipEntryNames,
  findSymlinkEntriesFromZipinfo,
  validateRequiredFiles,
  validateAssetManifest,
  validateEmbeddedViewer,
  validateUpstreamPatches,
  validateForPackaging,
} from "../scripts/package-plugin.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..");

// ─── normalizeRelPath ──────────────────────────────────

describe("normalizeRelPath", () => {
  it("strips leading ./", () => {
    assert.equal(normalizeRelPath("./manifest.json"), "manifest.json");
    assert.equal(normalizeRelPath("./assets/app.css"), "assets/app.css");
  });
  it("strips leading /", () => {
    assert.equal(normalizeRelPath("/manifest.json"), "manifest.json");
  });
  it("strips trailing /", () => {
    assert.equal(normalizeRelPath("assets/"), "assets");
  });
  it("converts backslashes to forward slashes", () => {
    assert.equal(normalizeRelPath("assets\\app.css"), "assets/app.css");
  });
  it("passes through clean paths", () => {
    assert.equal(normalizeRelPath("lib/core.js"), "lib/core.js");
  });
});

// ─── isAllowlisted ─────────────────────────────────────

describe("isAllowlisted", () => {
  it("allows top-level files", () => {
    assert.equal(isAllowlisted("manifest.json"), true);
    assert.equal(isAllowlisted("index.js"), true);
    assert.equal(isAllowlisted("README.md"), true);
    assert.equal(isAllowlisted("package.json"), true);
  });
  it("allows files inside allowlisted dirs", () => {
    assert.equal(isAllowlisted("assets/app.css"), true);
    assert.equal(isAllowlisted("assets/ua/viewer/manifest.json"), true);
    assert.equal(isAllowlisted("assets/ua/embedded/viewer.js"), true);
    assert.equal(isAllowlisted("assets/ua/hana-overlay.js"), true);
    assert.equal(isAllowlisted("third_party/pixelarticons/LICENSE"), true);
    assert.equal(isAllowlisted("lib/core.js"), true);
    assert.equal(isAllowlisted("routes/viewer.js"), true);
    assert.equal(isAllowlisted("tools/build.js"), true);
    assert.equal(isAllowlisted("pipeline/adapter.py"), true);
    assert.equal(isAllowlisted("third_party/understand-anything/UPSTREAM.json"), true);
    assert.equal(isAllowlisted("docs/DESIGN.md"), true);
  });
  it("rejects non-allowlisted top-level paths", () => {
    assert.equal(isAllowlisted("scripts/package-plugin.mjs"), false);
    assert.equal(isAllowlisted("tests/core.test.js"), false);
    assert.equal(isAllowlisted("dist/hana-code-atlas-0.1.6.zip"), false);
    assert.equal(isAllowlisted(".git/config"), false);
    assert.equal(isAllowlisted("random-file.txt"), false);
  });
  it("handles ./ prefix", () => {
    assert.equal(isAllowlisted("./manifest.json"), true);
    assert.equal(isAllowlisted("./assets/app.css"), true);
  });
  it("rejects empty path", () => {
    assert.equal(isAllowlisted(""), false);
    assert.equal(isAllowlisted("./"), false);
  });
});

// ─── isExcluded ────────────────────────────────────────

describe("isExcluded", () => {
  it("excludes __pycache__ dirs and *.pyc", () => {
    assert.equal(isExcluded("pipeline/__pycache__/adapter.cpython-311.pyc"), true);
    assert.equal(isExcluded("pipeline/foo.pyc"), true);
  });
  it("excludes .pytest_cache and hidden caches", () => {
    assert.equal(isExcluded("pipeline/.pytest_cache/v/cache/lastfailed"), true);
    assert.equal(isExcluded(".git/HEAD"), true);
    assert.equal(isExcluded(".DS_Store"), true);
  });
  it("excludes tests dir and test files", () => {
    assert.equal(isExcluded("tests/core.test.js"), true);
    assert.equal(isExcluded("pipeline/test_cbm2ua.py"), true);
    assert.equal(isExcluded("pipeline/test_hana_adapter.py"), true);
    assert.equal(isExcluded("lib/something.test.js"), true);
    assert.equal(isExcluded("lib/something.spec.mjs"), true);
  });
  it("excludes dist and node_modules", () => {
    assert.equal(isExcluded("dist/hana-code-atlas-0.1.6.zip"), true);
    assert.equal(isExcluded("node_modules/foo/index.js"), true);
  });
  it("does not exclude normal production files", () => {
    assert.equal(isExcluded("manifest.json"), false);
    assert.equal(isExcluded("assets/app.css"), false);
    assert.equal(isExcluded("lib/core.js"), false);
    assert.equal(isExcluded("pipeline/adapter.py"), false);
    assert.equal(isExcluded("pipeline/profiles/hermes-workspace.zh.json"), false);
    assert.equal(isExcluded("third_party/understand-anything/UPSTREAM.json"), false);
    assert.equal(isExcluded("third_party/pixelarticons/LICENSE"), false);
    assert.equal(isExcluded("docs/DESIGN.md"), false);
  });
});

// ─── shouldPackage ─────────────────────────────────────

describe("shouldPackage", () => {
  it("includes normal production files", () => {
    assert.equal(shouldPackage("manifest.json"), true);
    assert.equal(shouldPackage("assets/ua/viewer/index.html"), true);
    assert.equal(shouldPackage("pipeline/pipeline.py"), true);
  });
  it("excludes test files even inside allowlisted dirs", () => {
    assert.equal(shouldPackage("pipeline/test_cbm2ua.py"), false);
    assert.equal(shouldPackage("pipeline/__pycache__/adapter.pyc"), false);
  });
  it("excludes non-allowlisted top-level", () => {
    assert.equal(shouldPackage("scripts/pack-ua-assets.mjs"), false);
    assert.equal(shouldPackage("tests/core.test.js"), false);
  });
});

// ─── computeAssetSetSha256 ─────────────────────────────

describe("computeAssetSetSha256", () => {
  it("is deterministic regardless of input order", () => {
    const entries = [
      { path: "b.txt", sizeBytes: 3, sha256: "bbb" },
      { path: "a.txt", sizeBytes: 3, sha256: "aaa" },
      { path: "c.txt", sizeBytes: 3, sha256: "ccc" },
    ];
    const shuffled = [entries[2], entries[0], entries[1]];
    assert.equal(computeAssetSetSha256(entries), computeAssetSetSha256(shuffled));
  });
  it("produces a known value for a fixed input", () => {
    const entries = [{ path: "index.html", sizeBytes: 5, sha256: "abc123" }];
    // 手工计算：crypto.createHash('sha256').update('index.html|5|abc123\n').digest('hex')
    const expected = "0c123c66896fdffc9d8e6ec798ceb8073363923e3846c0e4eddcd4781d401589";
    assert.equal(computeAssetSetSha256(entries), expected);
  });
  it("uses sizeBytes field name (not size)", () => {
    // 确保使用 sizeBytes，与 pack-ua-assets.mjs 约定一致
    const withSizeBytes = [{ path: "f", sizeBytes: 10, sha256: "x" }];
    const withSize = [{ path: "f", size: 10, sha256: "x" }];
    assert.notEqual(computeAssetSetSha256(withSizeBytes), computeAssetSetSha256(withSize));
  });
});

// ─── resolveSourceDateEpoch ────────────────────────────

describe("resolveSourceDateEpoch", () => {
  it("returns default when env not set", () => {
    assert.equal(resolveSourceDateEpoch({}), DEFAULT_SOURCE_DATE_EPOCH);
    assert.equal(resolveSourceDateEpoch({ SOURCE_DATE_EPOCH: "" }), DEFAULT_SOURCE_DATE_EPOCH);
    assert.equal(DEFAULT_SOURCE_DATE_EPOCH, 946684800);
  });
  it("uses env override when set", () => {
    assert.equal(resolveSourceDateEpoch({ SOURCE_DATE_EPOCH: "1609459200" }), 1609459200);
    assert.equal(resolveSourceDateEpoch({ SOURCE_DATE_EPOCH: "0" }), 0);
  });
  it("throws on invalid env value", () => {
    assert.throws(() => resolveSourceDateEpoch({ SOURCE_DATE_EPOCH: "abc" }), PackError);
    assert.throws(() => resolveSourceDateEpoch({ SOURCE_DATE_EPOCH: "-1" }), PackError);
    assert.throws(() => resolveSourceDateEpoch({ SOURCE_DATE_EPOCH: "1.5" }), PackError);
  });
});

// ─── checkZipEntryNames ────────────────────────────────

describe("checkZipEntryNames", () => {
  it("passes for clean entries with manifest at root", () => {
    const entries = ["manifest.json", "index.js", "assets/app.css", "lib/core.js"];
    assert.deepEqual(checkZipEntryNames(entries), []);
  });
  it("detects absolute paths", () => {
    const v = checkZipEntryNames(["manifest.json", "/etc/passwd"]);
    assert.ok(v.some((s) => s.includes("absolute")));
  });
  it("detects path traversal", () => {
    const v = checkZipEntryNames(["manifest.json", "../secret.txt"]);
    assert.ok(v.some((s) => s.includes("traversal")));
  });
  it("detects backslash", () => {
    const v = checkZipEntryNames(["manifest.json", "assets\\app.css"]);
    assert.ok(v.some((s) => s.includes("backslash")));
  });
  it("detects excluded entries", () => {
    const v = checkZipEntryNames(["manifest.json", "tests/core.test.js"]);
    assert.ok(v.some((s) => s.includes("excluded")));
  });
  it("detects non-allowlisted entries", () => {
    const v = checkZipEntryNames(["manifest.json", "scripts/foo.mjs"]);
    assert.ok(v.some((s) => s.includes("non-allowlisted")));
  });
  it("detects missing manifest at root", () => {
    const v = checkZipEntryNames(["index.js", "assets/app.css"]);
    assert.ok(v.some((s) => s.includes("manifest.json not found")));
  });
  it("ignores empty lines", () => {
    const v = checkZipEntryNames(["manifest.json", "", "  ", "index.js"]);
    assert.deepEqual(v, []);
  });
});

// ─── findSymlinkEntriesFromZipinfo ─────────────────────

describe("findSymlinkEntriesFromZipinfo", () => {
  const sample = `Archive:  test.zip
Zip file size: 336 bytes, number of entries: 3
-rw-r--r--  3.0 unx        6 t- stor 00-Jan-01 00:00  manifest.json
lrwxrwxrwx  3.0 unx        6 t- stor 00-Jan-01 00:00  evil-link
-rw-r--r--  3.0 unx        4 t- stor 00-Jan-01 00:00  index.js
3 files, 16 bytes uncompressed, 16 bytes compressed:  0.0%`;

  it("finds symlink entries", () => {
    const syms = findSymlinkEntriesFromZipinfo(sample);
    assert.deepEqual(syms, ["evil-link"]);
  });
  it("returns empty when no symlinks", () => {
    const clean = sample.replace("lrwxrwxrwx", "-rw-r--r--").replace("evil-link", "ok.txt");
    assert.deepEqual(findSymlinkEntriesFromZipinfo(clean), []);
  });
  it("handles empty input", () => {
    assert.deepEqual(findSymlinkEntriesFromZipinfo(""), []);
  });
});

// ─── PackError ─────────────────────────────────────────

describe("PackError", () => {
  it("formats issues list", () => {
    const err = new PackError("failed", ["issue1", "issue2"]);
    assert.ok(err.message.includes("failed"));
    assert.ok(err.message.includes("issue1"));
    assert.ok(err.message.includes("issue2"));
    assert.deepEqual(err.issues, ["issue1", "issue2"]);
    assert.equal(err.name, "PackError");
  });
  it("works without issues", () => {
    const err = new PackError("simple");
    assert.equal(err.message, "simple");
    assert.deepEqual(err.issues, []);
  });
});

// ─── 包内容集成校验（对真实插件根，不产生 zip）─────────

describe("real plugin root validation", () => {
  it("required files all present", () => {
    const issues = validateRequiredFiles(PLUGIN_ROOT);
    assert.deepEqual(issues, [], `Missing required paths: ${issues.join(", ")}`);
  });

  it("asset manifest three-way consistent (disk ↔ manifest ↔ UPSTREAM)", () => {
    const issues = validateAssetManifest(PLUGIN_ROOT);
    assert.deepEqual(issues, [], `Asset manifest issues: ${issues.join(", ")}`);
  });

  it("embedded Viewer matches its locked source asset set and file hashes", () => {
    const issues = validateEmbeddedViewer(PLUGIN_ROOT);
    assert.deepEqual(issues, [], `Embedded Viewer issues: ${issues.join(", ")}`);
  });

  it("UPSTREAM patches valid (human-layout SHA matches, adapter superseded, no TBD)", () => {
    const issues = validateUpstreamPatches(PLUGIN_ROOT);
    assert.deepEqual(issues, [], `UPSTREAM patch issues: ${issues.join(", ")}`);
  });

  it("full validateForPackaging passes without throwing", () => {
    assert.doesNotThrow(() => validateForPackaging(PLUGIN_ROOT));
  });
});

// ─── allowlist / required 常量完整性 ──────────────────

describe("constants integrity", () => {
  it("INCLUDE_TOP_LEVEL covers all required top-level entries", () => {
    // 每个必需路径要么是 allowlist 中的文件，要么在 allowlist 目录下
    for (const req of REQUIRED_PATHS) {
      assert.ok(
        isAllowlisted(req),
        `REQUIRED_PATHS entry "${req}" is not covered by allowlist`,
      );
    }
  });
  it("docs is in allowlist (optional include)", () => {
    assert.ok(INCLUDE_TOP_LEVEL.some((e) => e === "docs/"));
  });
  it("scripts is NOT in allowlist", () => {
    assert.ok(!INCLUDE_TOP_LEVEL.some((e) => e.startsWith("scripts")));
  });
  it("tests is NOT in allowlist", () => {
    assert.ok(!INCLUDE_TOP_LEVEL.some((e) => e.startsWith("tests")));
  });
});
