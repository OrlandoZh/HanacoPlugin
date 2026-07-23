/**
 * tests/viewer-wrapper.test.js — UA Viewer HTML wrapper / fetch shim 静态测试
 *
 * 不依赖 Hono 或运行中的 Hana 宿主，仅验证 routes/viewer.js 中的
 * rewriteUaHtml 与 buildFetchShim 行为。
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import registerViewerRoutes, {
  rewriteUaHtml, buildFetchShim, frameErrorHtml, renderFrameError,
  scriptSafeJson, inlineStyleText, inlineScriptText, serveUaViewerAsset,
  renderEmbeddedViewerHtml, ALLOWED_BUNDLES,
} from "../routes/viewer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UA_INDEX_PATH = path.resolve(__dirname, "..", "assets", "ua", "viewer", "index.html");
const MANIFEST_PATH = path.resolve(__dirname, "..", "assets", "ua", "viewer", "manifest.json");
const UPSTREAM_PATH = path.resolve(__dirname, "..", "third_party", "understand-anything", "UPSTREAM.json");
const EMBEDDED_MANIFEST_PATH = path.resolve(__dirname, "..", "assets", "ua", "embedded", "manifest.json");
const EMBEDDED_DIR = path.dirname(EMBEDDED_MANIFEST_PATH);
const APP_CSS_PATH = path.resolve(__dirname, "..", "assets", "app.css");
const APP_JS_PATH = path.resolve(__dirname, "..", "assets", "app.js");
const HANA_OVERLAY_CSS_PATH = path.resolve(__dirname, "..", "assets", "ua", "hana-overlay.css");
const HANA_OVERLAY_JS_PATH = path.resolve(__dirname, "..", "assets", "ua", "hana-overlay.js");

const SAMPLE_INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>Understand Anything</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter&display=swap" rel="stylesheet" />
    <script type="module" crossorigin src="/assets/index-ABC.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/react-vendor-XYZ.js">
    <link rel="stylesheet" crossorigin href="/assets/xyflow-123.css">
    <link rel="stylesheet" crossorigin href="/assets/index-456.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

const ASSET_BASE = "/api/plugins/hana-code-atlas/assets/ua/viewer";

describe("rewriteUaHtml", () => {
  it("rewrites script src and modulepreload href to plugin asset route", () => {
    const out = rewriteUaHtml(SAMPLE_INDEX, ASSET_BASE);
    assert.match(out, /src="\/api\/plugins\/hana-code-atlas\/assets\/ua\/viewer\/assets\/index-ABC\.js"/);
    assert.match(out, /href="\/api\/plugins\/hana-code-atlas\/assets\/ua\/viewer\/assets\/react-vendor-XYZ\.js"/);
  });

  it("rewrites stylesheet href to plugin asset route", () => {
    const out = rewriteUaHtml(SAMPLE_INDEX, ASSET_BASE);
    assert.match(out, /href="\/api\/plugins\/hana-code-atlas\/assets\/ua\/viewer\/assets\/xyflow-123\.css"/);
    assert.match(out, /href="\/api\/plugins\/hana-code-atlas\/assets\/ua\/viewer\/assets\/index-456\.css"/);
  });

  it("removes favicon references", () => {
    const out = rewriteUaHtml(SAMPLE_INDEX, ASSET_BASE);
    assert.doesNotMatch(out, /<link[^>]*rel=["']icon["'][^>]*>/i);
    assert.doesNotMatch(out, /favicon/);
  });

  it("removes Google Fonts links", () => {
    const out = rewriteUaHtml(SAMPLE_INDEX, ASSET_BASE);
    assert.doesNotMatch(out, /fonts\.googleapis\.com/);
    assert.doesNotMatch(out, /fonts\.gstatic\.com/);
  });

  it("removes preconnect links", () => {
    const out = rewriteUaHtml(SAMPLE_INDEX, ASSET_BASE);
    assert.doesNotMatch(out, /rel=["']preconnect["']/i);
  });

  it("does not rewrite unrelated anchors", () => {
    const html = `<a href="/some-other/path">link</a>`;
    const out = rewriteUaHtml(html, ASSET_BASE);
    assert.match(out, /href="\/some-other\/path"/);
  });

  it("produces deterministic output for the real locked dist", () => {
    const html = readFileSync(UA_INDEX_PATH, "utf-8");
    const out1 = rewriteUaHtml(html, ASSET_BASE);
    const out2 = rewriteUaHtml(html, ASSET_BASE);
    assert.equal(out1, out2);
    assert.doesNotMatch(out1, /fonts\.googleapis\.com/);
    assert.doesNotMatch(out1, /fonts\.gstatic\.com/);
    assert.doesNotMatch(out1, /<link[^>]*rel=["']icon["'][^>]*>/i);
    assert.match(out1, /src="\/api\/plugins\/hana-code-atlas\/assets\/ua\/viewer\/assets\/index-[^"]+\.js"/);
  });
});

describe("buildFetchShim", () => {
  it("contains the pluginId, projectId and bundle constants", () => {
    const shim = buildFetchShim({ pluginId: "p", projectId: "/proj", bundle: "architecture", surfaceSession: "s" });
    assert.match(shim, /"p"/);
    assert.match(shim, /"\/proj"/);
    assert.match(shim, /"architecture"/);
  });

  it("seeds sessionStorage token key to skip UA TokenGate", () => {
    const shim = buildFetchShim({ pluginId: "p", projectId: "/proj", bundle: "full", surfaceSession: "tok" });
    assert.match(shim, /sessionStorage\.setItem\("understand-anything-token"/);
  });

  it("seeds localStorage onboarding dismissal key", () => {
    const shim = buildFetchShim({ pluginId: "p", projectId: "/proj", bundle: "full", surfaceSession: "tok" });
    assert.match(shim, /localStorage\.setItem\("ua-onboarding-dismissed-v1"/);
  });

  it("lists all allowlisted UA data request file names", () => {
    const shim = buildFetchShim({ pluginId: "p", projectId: "/proj", bundle: "full", surfaceSession: "tok" });
    for (const name of [
      "knowledge-graph.json", "config.json", "meta.json", "domain-graph.json",
      "diff-overlay.json", "semantic-meta.json", "overview-meta.json",
      "source-preview-meta.json", "file-content.json",
    ]) {
      assert.match(shim, new RegExp(`"${name}"`));
    }
  });

  it("maps explicit Hana dark and light themes to UA theme presets", () => {
    const dark = buildFetchShim({ pluginId: "p", projectId: "proj", bundle: "full", surfaceSession: "", theme: "dark" });
    const light = buildFetchShim({ pluginId: "p", projectId: "proj", bundle: "full", surfaceSession: "", theme: "light" });
    assert.match(dark, /const hanaTheme = "dark"/);
    assert.match(dark, /presetId: "dark-gold"/);
    assert.match(light, /const hanaTheme = "light"/);
    assert.match(light, /presetId: "light-minimal"/);
  });

  it("uses the parent Hana API bridge and reads the runtime surface session from the parent URL", () => {
    const shim = buildFetchShim({ pluginId: "hana-code-atlas", projectId: "proj123", bundle: "full", surfaceSession: "" });
    assert.match(shim, /parent\.hana\?\.api/);
    assert.match(shim, /parent\.location\.search/);
    assert.match(shim, /parentHanaApi\.fetch\(routePath, init\)/);
    assert.match(shim, /pathname\.startsWith\("\/assets\/"\)/);
    assert.match(shim, /vite:preloadError/);
    assert.doesNotMatch(shim, /viewerAssetBase/);
  });

  it("rewrites knowledge-graph.json through the plugin API bridge with projectId and bundle", () => {
    const shim = buildFetchShim({ pluginId: "p", projectId: "proj123", bundle: "architecture", surfaceSession: "tok" });
    assert.match(shim, /pluginFetch\(\`api\/ua\/\$\{encodeURIComponent\(fileName\)\}\?\$\{query\}\`, init\)/);
    assert.match(shim, /new URLSearchParams\(\{ projectId, bundle \}\)/);
    assert.doesNotMatch(shim, /projectRoot/);
  });

  it("rewrites file-content.json through the plugin API bridge", () => {
    const shim = buildFetchShim({ pluginId: "p", projectId: "proj123", bundle: "full", surfaceSession: "tok" });
    assert.match(shim, /pluginFetch\(\`api\/source\?\$\{query\}\`, init\)/);
    assert.match(shim, /path: parsed\.searchParams\.get\("path"\)/);
    assert.doesNotMatch(shim, /projectRoot/);
  });

  it("forces the embedded Viewer config to Simplified Chinese without rebuilding bundles", () => {
    const shim = buildFetchShim({ pluginId: "p", projectId: "proj123", bundle: "full", surfaceSession: "tok" });
    assert.match(shim, /fileName === "config\.json"/);
    assert.match(shim, /outputLanguage: "zh"/);
    assert.match(shim, /headers\.delete\("content-length"\)/);
    assert.match(shim, /new Response\(JSON\.stringify/);
  });

  it("adds X-Hana-Plugin-Surface-Session header when surfaceSession is present", () => {
    const shim = buildFetchShim({ pluginId: "p", projectId: "/proj", bundle: "full", surfaceSession: "tok" });
    assert.match(shim, /"X-Hana-Plugin-Surface-Session"/);
    assert.match(shim, /headers\.set\("X-Hana-Plugin-Surface-Session", surfaceSession\)/);
  });

  it("does not fail when surfaceSession is empty", () => {
    const shim = buildFetchShim({ pluginId: "p", projectId: "proj123", bundle: "full", surfaceSession: "" });
    // Should still contain the shim body and skip only the header branch.
    assert.match(shim, /"X-Hana-Plugin-Surface-Session"/);
  });
});

describe("frameErrorHtml", () => {
  it("renders a 400 Bad Request page", () => {
    const html = frameErrorHtml("projectId_required", 400);
    assert.match(html, /Bad Request/);
    assert.match(html, /projectId_required/);
  });

  it("renders a 500 Viewer Load Error page", () => {
    const html = frameErrorHtml("ua_index_not_found", 500);
    assert.match(html, /Viewer Load Error/);
    assert.match(html, /ua_index_not_found/);
  });
});

describe("renderFrameError", () => {
  function makeContext() {
    let capturedHtml = null;
    let capturedStatus = null;
    return {
      html: (content, code) => {
        capturedHtml = content;
        capturedStatus = code;
        return { html: capturedHtml, status: capturedStatus };
      },
      getHtml: () => capturedHtml,
      getStatus: () => capturedStatus,
    };
  }

  it("returns HTTP 400 for projectId_required", () => {
    const c = makeContext();
    renderFrameError(c, "projectId_required", 400);
    assert.equal(c.getStatus(), 400);
    assert.match(c.getHtml(), /Bad Request/);
  });

  it("returns HTTP 500 for ua_index_not_found", () => {
    const c = makeContext();
    renderFrameError(c, "ua_index_not_found", 500);
    assert.equal(c.getStatus(), 500);
    assert.match(c.getHtml(), /Viewer Load Error/);
  });
});

describe("registered viewer routes", () => {
  function setupRoutes() {
    const handlers = new Map();
    const app = {
      get(route, handler) {
        handlers.set(route, handler);
      },
    };
    const ctx = {
      pluginId: "hana-code-atlas",
      config: { get: async () => "/usr/bin/false" },
      log: { error() {} },
    };
    registerViewerRoutes(app, ctx);
    return handlers;
  }

  function makeContext(query = {}) {
    return {
      req: { query: (key) => query[key] },
      html(content, status = 200) {
        assert.equal(typeof content, "string", "route must not pass a Promise to c.html");
        return { html: content, status };
      },
    };
  }

  it("returns a self-contained shell that does not depend on protected app assets", async () => {
    const handlers = setupRoutes();
    const result = await handlers.get("/viewer")(makeContext({ "hana-theme": "dark" }));
    assert.equal(result.status, 200);
    assert.match(result.html, /window\.__CODE_ATLAS__/);
    assert.match(result.html, /assets\/app\.js — Hana Code Atlas/);
    assert.match(result.html, /assets\/app\.css — Hana Code Atlas/);
    assert.doesNotMatch(result.html, /<script[^>]+src="[^"]*\/assets\/app\.js/);
    assert.doesNotMatch(result.html, /<link[^>]+href="[^"]*\/assets\/app\.css/);
  });

  it("returns a self-contained frame with embedded Viewer JS and CSS", async () => {
    const handlers = setupRoutes();
    const result = await handlers.get("/frame")(makeContext({
      projectId: "15a09923674479e2",
      bundle: "full",
    }));
    assert.equal(result.status, 200);
    assert.ok(result.html.length > 2_000_000, "embedded frame should contain the bundled Viewer");
    assert.match(result.html, /const projectId = "15a09923674479e2"/);
    assert.match(result.html, /<style>/);
    assert.match(result.html, /<script type="module">/);
    assert.match(result.html, /outputLanguage: "zh"/);
    assert.match(result.html, /hca-farm-toolbar/);
    assert.match(result.html, /Pixelarticons by Gerrit Halfmann/);
    assert.match(result.html, /<html lang="zh-CN">/);
    assert.doesNotMatch(result.html, /<script[^>]+src=/);
    assert.doesNotMatch(result.html, /<link[^>]+rel="stylesheet"/);
  });

  it("registers the locked Viewer asset route", () => {
    const handlers = setupRoutes();
    assert.equal(typeof handlers.get("/assets/ua/viewer/*"), "function");
  });
});

describe("serveUaViewerAsset", () => {
  function makeAssetContext(assetPath) {
    const headers = new Map();
    return {
      req: { path: `/assets/ua/viewer/${assetPath}` },
      header: (key, value) => headers.set(key.toLowerCase(), value),
      body: (content) => ({ status: 200, content, headers }),
      json: (content, status = 200) => ({ status, content, headers }),
    };
  }

  it("serves a manifest-locked JavaScript asset with immutable caching", async () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    const asset = manifest.files.find((file) => file.path.endsWith(".js"));
    assert.ok(asset, "locked Viewer manifest must contain a JavaScript asset");
    const result = await serveUaViewerAsset(makeAssetContext(asset.path));
    assert.equal(result.status, 200);
    assert.equal(result.content.length, asset.sizeBytes);
    assert.equal(result.headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.equal(result.headers.get("cache-control"), "public, max-age=31536000, immutable");
  });

  it("rejects traversal and files outside the locked manifest", async () => {
    const traversal = await serveUaViewerAsset(makeAssetContext("../manifest.json"));
    assert.equal(traversal.status, 400);
    assert.equal(traversal.content.error, "viewer_asset_path_invalid");

    const unknown = await serveUaViewerAsset(makeAssetContext("assets/not-locked.js"));
    assert.equal(unknown.status, 404);
    assert.equal(unknown.content.error, "viewer_asset_not_found");
  });
});

describe("ALLOWED_BUNDLES", () => {
  it("allows full and architecture", () => {
    assert.ok(ALLOWED_BUNDLES.has("full"));
    assert.ok(ALLOWED_BUNDLES.has("architecture"));
  });

  it("rejects other values", () => {
    assert.ok(!ALLOWED_BUNDLES.has(""));
    assert.ok(!ALLOWED_BUNDLES.has("full-architecture"));
    assert.ok(!ALLOWED_BUNDLES.has("ARCHITECTURE"));
  });
});

describe("inline shell assets", () => {
  it("prevents style and script end tags from breaking the shell", () => {
    assert.equal(inlineStyleText("a</STYLE>b"), "a<\\/style>b");
    assert.equal(inlineScriptText("a</SCRIPT>b"), "a<\\/script>b");
  });

  it("renders embedded Viewer assets without external script or stylesheet requests", () => {
    const html = renderEmbeddedViewerHtml({
      viewerCss: "body{color:red}</style><style>bad",
      viewerJs: "console.log(1)</script><script>bad",
      overlayCss: ".farm{color:green}</style><style>bad",
      overlayJs: "window.overlayReady=true</script><script>bad",
      shim: "<script>window.shimReady=true</script>",
    });
    assert.match(html, /window\.shimReady=true/);
    assert.match(html, /window\.overlayReady=true/);
    assert.match(html, /\.farm\{color:green\}/);
    assert.doesNotMatch(html, /<script[^>]+src=/);
    assert.doesNotMatch(html, /<link[^>]+stylesheet/);
    assert.doesNotMatch(html, /<\/style><style>bad/);
    assert.doesNotMatch(html, /<\/script><script>bad/);
  });
});

describe("scriptSafeJson", () => {
  it("escapes < and > to unicode escapes", () => {
    const out = scriptSafeJson("a <script> alert(1) </script> b");
    assert.ok(!out.includes("<"));
    assert.ok(!out.includes(">"));
    assert.ok(out.includes("\\u003c"));
    assert.ok(out.includes("\\u003e"));
  });

  it("does not alter safe strings", () => {
    assert.equal(scriptSafeJson("hello"), '"hello"');
  });

  it("keeps round-trip equality after JSON.parse", () => {
    const malicious = `</script><script>alert('xss')</script>`;
    const out = scriptSafeJson(malicious);
    assert.equal(JSON.parse(out), malicious);
  });

  it("escapes JavaScript line and paragraph separators", () => {
    const value = "before\u2028middle\u2029after";
    const out = scriptSafeJson(value);
    assert.ok(!out.includes("\u2028"));
    assert.ok(!out.includes("\u2029"));
    assert.match(out, /\\u2028/);
    assert.match(out, /\\u2029/);
    assert.equal(JSON.parse(out), value);
  });
});

describe("buildFetchShim script safety", () => {
  it("escapes malicious values so they cannot close the shim script tag", () => {
    const malicious = "</script><script>alert(1)</script>";
    const shim = buildFetchShim({
      pluginId: "p",
      projectId: malicious,
      bundle: "architecture",
      surfaceSession: "<token>&\"",
    });
    // The raw malicious sequence must not appear inside the generated script.
    assert.ok(!shim.includes(malicious), "raw malicious sequence must not be present");
    // It must be represented as unicode escapes.
    assert.ok(shim.includes("\\u003c/script\\u003e"));
    // And must round-trip through JSON.parse.
    const pluginIdMatch = shim.match(/const projectId = "(.*?)";/);
    assert.ok(pluginIdMatch, "projectId assignment should be findable");
    assert.equal(JSON.parse('"' + pluginIdMatch[1] + '"'), malicious);
  });
});

describe("renderShell bootData", () => {
  it("boot script does not contain raw script tags", () => {
    // We verify the helper used for bootData is scriptSafeJson by inspecting
    // its output directly. The actual renderShell requires a Hono context.
    const bootData = {
      pluginId: "hana-code-atlas",
      cbmStatus: { error: "cbm<error>" },
      pythonStatus: { version: "3.11</script>" },
    };
    const out = scriptSafeJson(bootData);
    assert.ok(!out.includes("<"));
    assert.ok(!out.includes(">"));
    assert.ok(out.includes("\\u003c"));
    assert.equal(JSON.parse(out).pythonStatus.version, "3.11</script>");
  });
});

describe("app.js build controls", () => {
  const appJs = readFileSync(APP_JS_PATH, "utf-8");

  it("guards build start and project switching while a task is active", () => {
    assert.match(appJs, /state\.taskId \|\| state\.buildStarting/);
    assert.match(appJs, /els\.projectSelect\.disabled = active/);
  });

  it("keeps polling cancelling tasks until the backend reaches a terminal state", () => {
    assert.match(appJs, /status === "cancelling"/);
    assert.match(appJs, /等待进程退出/);
    assert.match(appJs, /state\.cancelRequested/);
  });

  it("clears task timers and exposes aria-busy", () => {
    assert.match(appJs, /clearTimeout\(state\.pollTimer\)/);
    assert.match(appJs, /setAttribute\("aria-busy", String\(busy\)\)/);
  });

  it("renders a searchable indexed-project table and absolute-path onboarding controls", () => {
    assert.match(appJs, /id="ca-candidate-search"/);
    assert.match(appJs, /id="ca-candidate-table-body"/);
    assert.match(appJs, /搜索项目名、cbm 标识或路径/);
    assert.match(appJs, /项目根目录绝对路径/);
    assert.match(appJs, /\/api\/project-candidates/);
    assert.match(appJs, /添加第一个代码项目/);
    assert.match(appJs, /function candidateMatches/);
    assert.match(appJs, /candidate\.nodes/);
    assert.match(appJs, /candidate\.edges/);
    assert.match(appJs, /action\.dataset\.action = registered \? "open" : "choose"/);
    assert.match(appJs, /MCP connector/);
    assert.doesNotMatch(appJs, /ca-candidate-select/);
  });

  it("diagnoses non-JSON host responses instead of exposing Response.json parser errors", () => {
    assert.match(appJs, /async function readJsonResponse/);
    assert.match(appJs, /返回非 JSON/);
    assert.match(appJs, /HTTP \$\{res\.status\}/);
    assert.doesNotMatch(appJs, /await res\.json\(/);
  });

  it("signals ready before starting asynchronous data loading", () => {
    assert.ok(appJs.lastIndexOf("postReady();") < appJs.lastIndexOf("refreshAll();"));
  });

  it("refreshes registered projects before rendering candidate registration states", () => {
    assert.match(appJs, /async function refreshAll\(\) \{\s+await refreshProjects\(\);\s+await refreshCandidates\(\);/);
    assert.match(appJs, /registeredByRoot = new Map/);
    assert.match(appJs, /els\.candidateSearch\.addEventListener\("input", renderCandidateTable\)/);
  });

  it("disables unavailable Architecture and falls back to Full without a false active state", () => {
    assert.match(appJs, /requestedBundle === "architecture" && !data\.hasArchitecture && data\.hasFull/);
    assert.match(appJs, /updateBundleSelection\("full"\)/);
    assert.match(appJs, /尚无可用 Architecture，已显示 Full 图谱/);
    assert.match(appJs, /els\.bundleArch\.disabled = !hasArchitecture/);
    assert.match(appJs, /生成、审查并采用语义草稿/);
    assert.match(appJs, /state\.selectedProjectId !== projectId \|\| state\.bundle !== requestedBundle/);
  });

  it("surfaces provider discovery failures instead of silently showing empty selectors", () => {
    assert.match(appJs, /architectureProviderError/);
    assert.match(appJs, /Provider 读取失败/);
    assert.match(appJs, /Hana 未返回可用的 chat Provider/);
    assert.match(appJs, /renderArchitectureState\(state\.architectureState\)/);
  });

  it("renders backend-driven Architecture stage progress without synthetic increments", () => {
    assert.match(appJs, /id="ca-architecture-progress"/);
    assert.match(appJs, /id="ca-progress-bar" max="100"/);
    assert.match(appJs, /task\.progress \?\? fallback\[task\.status\]/);
    assert.match(appJs, /模型生成（等待 Provider 响应）/);
    assert.match(appJs, /AI 独立复审（等待 Provider 响应）/);
    assert.match(appJs, /aria-valuetext/);
    assert.doesNotMatch(appJs, /setInterval\(/);
  });

  it("renders linked Provider/model dropdowns with explicit custom-ID fallback", () => {
    assert.match(appJs, /<select id="ca-provider-select">/);
    assert.match(appJs, /<select id="ca-model-select">/);
    assert.match(appJs, /<select id="ca-review-provider-select">/);
    assert.match(appJs, /<select id="ca-review-model-select">/);
    assert.match(appJs, /provider\.id} \(\$\{provider\.models\?\.length \|\| 0}\)/);
    assert.match(appJs, /id="ca-generator-custom-toggle"/);
    assert.match(appJs, /id="ca-review-custom-toggle"/);
    assert.match(appJs, /function readModelChoice/);
    assert.match(appJs, /需要同时填写 Provider ID 和模型 ID/);
  });

  it("requires an independently bound AI review before human adoption", () => {
    assert.match(appJs, /reviewerProviderId: reviewerChoice\.providerId/);
    assert.match(appJs, /reviewerModel: reviewerChoice\.model/);
    assert.match(appJs, /"committing_draft", "reviewing", "committing_review"/);
    assert.match(appJs, /const reviewStage = data\.status === "reviewing" \|\| data\.status === "committing_review"/);
    assert.match(appJs, /\/api\/architecture\/review/);
    assert.match(appJs, /id="ca-architecture-next"/);
    assert.match(appJs, /data-action="generate"/);
    assert.match(appJs, /data\?\.activeTask/);
    assert.match(appJs, /className = "ca-review-evidence"/);
    assert.match(appJs, /!hasReview/);
    assert.match(appJs, /expectedReviewSha256/);
    assert.match(appJs, /AI 独立复审/);
    assert.match(appJs, /我已阅读 AI 复审意见/);
    assert.match(appJs, /明确决定覆盖其拒绝建议/);
  });

  it("presents one state-driven Architecture action and chains adoption to rebuild", () => {
    assert.match(appJs, /aria-label="Architecture 生成流程"/);
    assert.match(appJs, /function renderWorkflowSteps/);
    assert.match(appJs, /function configureArchitectureNext/);
    assert.match(appJs, /生成并复审语义草稿/);
    assert.match(appJs, /仅重试 AI 复审/);
    assert.match(appJs, /审查并确认采用/);
    assert.match(appJs, /重新构建 Architecture/);
    assert.match(appJs, /采用并开始重建/);
    assert.match(appJs, /startBuild\(\{ openArchitectureWhenReady: true \}\)/);
    assert.match(appJs, /updateBundleSelection\("architecture", true\)/);
    assert.match(appJs, /id="ca-architecture-advanced"/);
    assert.match(appJs, /id="ca-regenerate-architecture"/);
  });

  it("loads the self-contained frame through authenticated API fetch and srcdoc", () => {
    assert.match(appJs, /await apiFetch\(`\/frame\?\$\{params\.toString\(\)\}`\)/);
    assert.match(appJs, /els\.frame\.srcdoc = html/);
    assert.match(appJs, /frameLoadSequence/);
    assert.doesNotMatch(appJs, /els\.frame\.setAttribute\("src"/);
  });

  it("prefers the Hana API bridge and surfaces nested Viewer runtime failures", () => {
    assert.match(appJs, /window\.hana\?\.api/);
    assert.match(appJs, /hostHanaApi\.fetch\(clean, init\)/);
    assert.match(appJs, /hana\.code-atlas\.viewer/);
    assert.match(appJs, /Viewer 运行失败/);
  });
});

describe("Hana Viewer localization and pixel-farm overlay", () => {
  const overlayCss = readFileSync(HANA_OVERLAY_CSS_PATH, "utf-8");
  const overlayJs = readFileSync(HANA_OVERLAY_JS_PATH, "utf-8");

  it("uses fixed daytime farm tokens without gradients, animation or non-zero letter spacing", () => {
    assert.match(overlayCss, /--hca-farm-wood-light: #f2d69a/);
    assert.match(overlayCss, /--hca-farm-leaf: #5f7d3c/);
    assert.doesNotMatch(overlayCss, /gradient\(/i);
    assert.doesNotMatch(overlayCss, /animation\s*:/i);
    assert.doesNotMatch(overlayCss, /letter-spacing\s*:/i);
  });

  it("decorates stable Chinese controls with accessible MIT-licensed pixel icons", () => {
    for (const label of [
      "高层次架构视图",
      "完整仪表盘与导览学习",
      "代码聚焦与对话",
      "仅文件 — 架构级依赖（快速）",
      "文件 + 类 — 代码结构及继承关系",
      "查找节点间路径 (P)",
    ]) {
      assert.ok(overlayJs.includes(label), `missing localized control target: ${label}`);
    }
    assert.match(overlayJs, /Pixelarticons by Gerrit Halfmann \(MIT\)/);
    assert.match(overlayJs, /aria-hidden/);
    assert.match(overlayJs, /focusable/);
    assert.match(overlayJs, /MutationObserver/);
    assert.match(overlayJs, /record\.addedNodes\.length > 0/);
    assert.match(overlayJs, /characterData: true/);
    assert.match(overlayJs, /document\.addEventListener\("click"/);
    assert.match(overlayJs, /\[50, 250, 750\]/);
    assert.match(overlayJs, /setTimeout\(decorate, delay\)/);
    assert.ok(overlayJs.includes('["Dependency Path Finder", "依赖路径查找"]'));
    assert.ok(overlayJs.includes('["Find Path", "查找路径"]'));
    assert.match(overlayJs, /aria-label", "关闭依赖路径查找/);
    assert.doesNotMatch(overlayJs, /\bfetch\s*\(/);
    assert.doesNotMatch(overlayJs, /setAttribute\("(?:src|href)"/);
  });
});

describe("app.css constraints", () => {
  const css = readFileSync(APP_CSS_PATH, "utf-8");

  it("has no non-zero letter-spacing", () => {
    const matches = css.match(/letter-spacing:\s*[^;0\s][^;]*;/g) || [];
    for (const m of matches) {
      const value = m.replace(/letter-spacing:\s*/, "").replace(";", "").trim();
      assert.equal(value, "0", `unexpected letter-spacing: ${m}`);
    }
  });

  it("supports explicit dark and light themes via data-hana-theme", () => {
    assert.match(css, /\[data-hana-theme="dark"\]/);
    assert.match(css, /\[data-hana-theme="light"\]/);
  });

  it("keeps the searchable index table bounded and readable", () => {
    assert.match(css, /\.ca-index-table-wrap\s*\{[^}]*max-height:\s*20rem/s);
    assert.match(css, /\.ca-index-table\s*\{[^}]*table-layout:\s*fixed/s);
    assert.match(css, /grid-template-columns:\s*clamp\(340px, 24vw, 420px\)/);
    assert.match(css, /\.ca-index-path\s*\{[^}]*text-overflow:\s*ellipsis/s);
  });

  it("does not let the placeholder display rule override its hidden state", () => {
    assert.match(css, /\.ca-placeholder\[hidden\]\s*\{[^}]*display:\s*none/s);
  });

  it("styles the native progress element without animation", () => {
    assert.match(css, /\.ca-architecture-progress progress/);
    assert.match(css, /::-webkit-progress-value/);
    assert.match(css, /::-moz-progress-bar/);
    assert.doesNotMatch(css, /animation\s*:/i);
  });

  it("keeps the four-step workflow compact and hides inactive recovery actions", () => {
    assert.match(css, /\.ca-workflow-steps\s*\{[^}]*grid-template-columns:\s*repeat\(4,/s);
    assert.match(css, /\.ca-workflow-steps li\.current/);
    assert.match(css, /\.ca-workflow-steps li\.done/);
    assert.match(css, /\.ca-workflow-actions button\[hidden\]/);
    assert.match(css, /\.ca-advanced-actions\[hidden\]/);
  });

  it("keeps review actions reachable when findings or JSON overflow", () => {
    assert.match(css, /\.ca-modal\s*\{[^}]*overflow-y:\s*auto/s);
    assert.match(css, /@media \(max-width: 720px\)[\s\S]*\.ca-modal-actions\s*\{[^}]*position:\s*sticky/s);
  });
});

describe("asset manifest", () => {
  it("locks the derived embedded Viewer files to the source asset set", () => {
    const source = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    const embedded = JSON.parse(readFileSync(EMBEDDED_MANIFEST_PATH, "utf-8"));
    assert.equal(embedded.source.assetSetSha256, source.assetSetSha256);
    for (const file of embedded.files) {
      const bytes = readFileSync(path.join(EMBEDDED_DIR, file.path));
      assert.equal(bytes.length, file.sizeBytes);
      assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), file.sha256);
    }
  });

  it("excludes manifest.json itself from the file list", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    const paths = manifest.files.map((f) => f.path);
    assert.ok(!paths.includes("manifest.json"), "manifest.json should not list itself");
    assert.equal(manifest.fileCount, paths.length);
  });

  it("has a deterministic assetSetSha256 over sorted path|size|sha256", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    const computed = manifest.files
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((f) => `${f.path}|${f.sizeBytes}|${f.sha256}`)
      .join("\n") + "\n";
    const expected = crypto.createHash("sha256").update(computed).digest("hex");
    assert.equal(manifest.assetSetSha256, expected);
  });

  it("matches UPSTREAM.json distSha256", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    const upstream = JSON.parse(readFileSync(UPSTREAM_PATH, "utf-8"));
    assert.equal(manifest.assetSetSha256, upstream.distSha256);
  });
});
