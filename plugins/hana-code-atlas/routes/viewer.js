/**
 * routes/viewer.js — Hana Code Atlas 控制台与 UA Viewer 嵌入 wrapper
 *
 * 提供：
 *   GET /viewer                    原生插件控制页面（assets/app.js + app.css）
 *   GET /frame                     自包含 Understand-Anything Viewer HTML
 *   GET /assets/ua/viewer/*        锁定版 Viewer 静态资源兼容路由
 *
 * /frame 内联由锁定 Human Layout dist 派生的单文件 JS/CSS，避免嵌套 iframe
 * 再次请求受 Hana surface 鉴权保护的脚本与样式。fetch shim 将 UA 数据请求
 * 转发到本插件 API，同时用 sessionStorage 跳过 UA TokenGate。
 */

import path from "node:path";
import fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  readConfig, detectCbmBinary, detectPythonBinary,
} from "../lib/core.js";
import { resolveCbmRuntime } from "../lib/cbm-registry-v1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.resolve(__dirname, "..", "assets");
const APP_CSS_PATH = path.join(ASSETS_DIR, "app.css");
const APP_JS_PATH = path.join(ASSETS_DIR, "app.js");
const UA_VIEWER_DIR = path.join(ASSETS_DIR, "ua", "viewer");
const UA_VIEWER_MANIFEST_PATH = path.join(UA_VIEWER_DIR, "manifest.json");
const UA_EMBEDDED_DIR = path.join(ASSETS_DIR, "ua", "embedded");
const UA_EMBEDDED_JS_PATH = path.join(UA_EMBEDDED_DIR, "viewer.js");
const UA_EMBEDDED_CSS_PATH = path.join(UA_EMBEDDED_DIR, "viewer.css");
const UA_HANA_OVERLAY_JS_PATH = path.join(ASSETS_DIR, "ua", "hana-overlay.js");
const UA_HANA_OVERLAY_CSS_PATH = path.join(ASSETS_DIR, "ua", "hana-overlay.css");

const UA_ASSET_CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
]);

let uaViewerAssetPathsPromise = null;
let embeddedViewerPromise = null;

async function getEmbeddedViewer() {
  if (!embeddedViewerPromise) {
    embeddedViewerPromise = Promise.all([
      fsp.readFile(UA_EMBEDDED_JS_PATH, "utf-8"),
      fsp.readFile(UA_EMBEDDED_CSS_PATH, "utf-8"),
      fsp.readFile(UA_HANA_OVERLAY_JS_PATH, "utf-8"),
      fsp.readFile(UA_HANA_OVERLAY_CSS_PATH, "utf-8"),
    ]).then(([js, css, overlayJs, overlayCss]) => ({ js, css, overlayJs, overlayCss }));
  }
  return embeddedViewerPromise;
}

async function getUaViewerAssetPaths() {
  if (!uaViewerAssetPathsPromise) {
    uaViewerAssetPathsPromise = fsp.readFile(UA_VIEWER_MANIFEST_PATH, "utf-8")
      .then((text) => JSON.parse(text))
      .then((manifest) => new Set((manifest.files || []).map((file) => String(file.path || ""))));
  }
  return uaViewerAssetPathsPromise;
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/'/g, "&#39;");
}

export function scriptSafeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function inlineStyleText(value) {
  return String(value).replace(/<\/style/gi, "<\\/style");
}

export function inlineScriptText(value) {
  return String(value).replace(/<\/script/gi, "<\\/script");
}

export default function registerViewerRoutes(app, ctx) {
  app.get("/viewer", async (c) => c.html(await renderShell(c, ctx)));
  app.get("/frame", (c) => renderFrame(c, ctx));
  app.get("/assets/ua/viewer/*", serveUaViewerAsset);
}

export async function serveUaViewerAsset(c) {
  const routePrefix = "/assets/ua/viewer/";
  const requestPath = String(c.req.path || "");
  if (!requestPath.startsWith(routePrefix)) {
    return c.json({ error: "viewer_asset_path_invalid" }, 400);
  }

  let relativePath;
  try {
    relativePath = decodeURIComponent(requestPath.slice(routePrefix.length)).replace(/^\/+/, "");
  } catch {
    return c.json({ error: "viewer_asset_path_invalid" }, 400);
  }

  const segments = relativePath.split("/");
  if (!relativePath || relativePath.includes("\\") || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return c.json({ error: "viewer_asset_path_invalid" }, 400);
  }

  const allowedPaths = await getUaViewerAssetPaths();
  if (!allowedPaths.has(relativePath)) {
    return c.json({ error: "viewer_asset_not_found" }, 404);
  }

  let content;
  try {
    content = await fsp.readFile(path.join(UA_VIEWER_DIR, ...segments));
  } catch {
    return c.json({ error: "viewer_asset_not_found" }, 404);
  }

  c.header("Content-Type", UA_ASSET_CONTENT_TYPES.get(path.extname(relativePath).toLowerCase()) || "application/octet-stream");
  c.header("Cache-Control", relativePath.startsWith("assets/")
    ? "public, max-age=31536000, immutable"
    : "public, max-age=300");
  return c.body(content);
}

export function rewriteUaHtml(html, assetBase) {
  return html
    // 移除 favicon
    .replace(/<link[^>]*rel=["']icon["'][^>]*>/gi, "")
    .replace(/<link[^>]*rel=["']shortcut icon["'][^>]*>/gi, "")
    // 移除 Google Fonts 与预连接
    .replace(/<link[^>]*href=["']https:\/\/fonts\.googleapis\.com\/[^"']*["'][^>]*>/gi, "")
    .replace(/<link[^>]*href=["']https:\/\/fonts\.gstatic\.com\/[^"']*["'][^>]*>/gi, "")
    .replace(/<link[^>]*rel=["']preconnect["'][^>]*>/gi, "")
    // 重写静态资源到插件 asset 路由
    .replace(/href=["']\/assets\//g, `href="${assetBase}/assets/`)
    .replace(/src=["']\/assets\//g, `src="${assetBase}/assets/`)
    .replace(/href=["']\/favicon\.svg["']/g, `href="${assetBase}/favicon.svg"`)
    .replace(/href=["']\/favicon\.ico["']/g, `href="${assetBase}/favicon.ico"`);
}

async function renderShell(c, ctx) {
  const hanaCss = c.req.query("hana-css") || "";
  const theme = c.req.query("hana-theme") || "inherit";
  const assetBase = `/api/plugins/${encodeURIComponent(ctx.pluginId)}/assets`;

  const [cbmRuntime, pythonBinary, appCss, appJs] = await Promise.all([
    resolveCbmRuntime(ctx),
    readConfig(ctx, "pythonBinary", "python3"),
    fsp.readFile(APP_CSS_PATH, "utf-8"),
    fsp.readFile(APP_JS_PATH, "utf-8"),
  ]);
  const [cbmStatus, pythonStatus] = await Promise.all([
    cbmRuntime.ok
      ? detectCbmBinary(cbmRuntime.binary)
      : Promise.resolve({ ok: false, error: cbmRuntime.error }),
    detectPythonBinary(pythonBinary),
  ]);
  // 项目列表由前端通过 /api/projects 动态获取

  const bootData = {
    pluginId: ctx.pluginId,
    assetBase,
    theme,
    cbmRegistry: {
      source: cbmRuntime.source,
      binarySource: cbmRuntime.binarySource,
      cacheDir: cbmRuntime.cacheDir || null,
    },
    cbmStatus: {
      ok: cbmStatus.ok,
      version: cbmStatus.version || null,
      error: cbmStatus.error || null,
    },
    pythonStatus: {
      ok: pythonStatus.ok,
      version: pythonStatus.version || null,
      error: pythonStatus.error || null,
    },
  };

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hana Code Atlas</title>
  ${hanaCss ? `<link rel="stylesheet" href="${escapeAttr(hanaCss)}">` : ""}
  <style>${inlineStyleText(appCss)}</style>
</head>
<body data-hana-theme="${escapeAttr(theme)}">
  <div id="root"></div>
  <script>
    window.__CODE_ATLAS__ = ${scriptSafeJson(bootData)};
  </script>
  <script>${inlineScriptText(appJs)}</script>
</body>
</html>`;
}

export const ALLOWED_BUNDLES = new Set(["architecture", "full"]);

async function renderFrame(c, ctx) {
  const projectId = c.req.query("projectId") || "";
  const bundle = c.req.query("bundle") || "architecture";
  const surfaceSession = c.req.query("pluginSurfaceSession") || "";
  const theme = c.req.query("hana-theme") || "inherit";
  const pluginId = ctx.pluginId;

  if (!projectId) {
    return renderFrameError(c, "projectId_required", 400);
  }

  if (!ALLOWED_BUNDLES.has(bundle)) {
    return renderFrameError(c, `bundle_invalid: ${bundle}`, 400);
  }

  let embedded;
  try {
    embedded = await getEmbeddedViewer();
  } catch (err) {
    ctx.log?.error?.(`[viewer] failed to read embedded UA assets: ${err.message}`);
    return renderFrameError(c, `ua_embedded_assets_not_found: ${err.message}`, 500);
  }

  const shim = buildFetchShim({ pluginId, projectId, bundle, surfaceSession, theme });
  return c.html(renderEmbeddedViewerHtml({
    viewerCss: embedded.css,
    viewerJs: embedded.js,
    overlayCss: embedded.overlayCss,
    overlayJs: embedded.overlayJs,
    shim,
  }));
}

export function renderEmbeddedViewerHtml({ viewerCss, viewerJs, overlayCss = "", overlayJs = "", shim }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hana Code Atlas</title>
  <style>${inlineStyleText(viewerCss)}</style>
  <style>${inlineStyleText(overlayCss)}</style>
</head>
<body>
  <div id="root"></div>
  ${shim}
  <script>${inlineScriptText(overlayJs)}</script>
  <script type="module">${inlineScriptText(viewerJs)}</script>
</body>
</html>`;
}

export function frameErrorHtml(message, status) {
  const title = status >= 500 ? "Viewer Load Error" : "Bad Request";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 2rem; color: #c00; }
    pre { background: #f6f6f6; padding: 1rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <pre>${escapeHtml(message)}</pre>
</body>
</html>`;
}

export function renderFrameError(c, message, status) {
  return c.html(frameErrorHtml(message, status), status);
}

export function buildFetchShim({ pluginId, projectId, bundle, surfaceSession, theme = "inherit" }) {
  return `<script>
(function () {
  const pluginId = ${scriptSafeJson(pluginId)};
  const projectId = ${scriptSafeJson(projectId)};
  const bundle = ${scriptSafeJson(bundle)};
  const serverSurfaceSession = ${scriptSafeJson(surfaceSession)};
  const hanaTheme = ${scriptSafeJson(theme)};
  let surfaceSession = serverSurfaceSession;

  // srcdoc inherits the control page origin but not its URL. Read the surface
  // session from the parent at runtime; Hana strips credentials before routes.
  try {
    surfaceSession = new URLSearchParams(parent.location.search).get("pluginSurfaceSession") || surfaceSession;
  } catch (_) {}

  // 跳过 UA TokenGate（会话级）与 Onboarding（本地存储级）。
  // Explicit Hana themes override UA's persisted theme for frame consistency.
  try {
    sessionStorage.setItem("understand-anything-token", surfaceSession || "hana");
    localStorage.setItem("ua-onboarding-dismissed-v1", "1");
    if (hanaTheme === "dark") {
      localStorage.setItem("ua-theme", JSON.stringify({ presetId: "dark-gold", accentId: "gold" }));
    } else if (hanaTheme === "light") {
      localStorage.setItem("ua-theme", JSON.stringify({ presetId: "light-minimal", accentId: "indigo" }));
    }
  } catch (_) {}

  if (!pluginId || !projectId) return;

  // The original Vite runtime still emits preload hints for chunks that are
  // already present in the embedded bundle. Suppress those redundant network
  // requests; concatenated viewer.css already contains both locked stylesheets.
  try {
    const appendChild = document.head.appendChild.bind(document.head);
    document.head.appendChild = function (node) {
      if (node instanceof HTMLLinkElement) {
        const pathname = new URL(node.href, parent.location.href).pathname;
        if (pathname.startsWith("/assets/")) {
          if (node.rel === "stylesheet") queueMicrotask(() => node.dispatchEvent(new Event("load")));
          return node;
        }
      }
      return appendChild(node);
    };
    window.addEventListener("vite:preloadError", (event) => event.preventDefault());
  } catch (_) {}

  const dataFiles = new Set([
    "knowledge-graph.json",
    "config.json",
    "meta.json",
    "domain-graph.json",
    "diff-overlay.json",
    "semantic-meta.json",
    "overview-meta.json",
    "source-preview-meta.json",
  ]);

  const origFetch = window.fetch.bind(window);
  const parentHanaApi = (() => {
    try {
      return parent.hana?.api || null;
    } catch (_) {
      return null;
    }
  })();

  function pluginFetch(routePath, init) {
    if (typeof parentHanaApi?.fetch === "function") {
      return parentHanaApi.fetch(routePath, init);
    }

    const base = new URL(\`/api/plugins/\${encodeURIComponent(pluginId)}/\`, parent.location.origin);
    const target = new URL(routePath, base);
    const headers = new Headers(init?.headers || {});
    if (surfaceSession) headers.set("X-Hana-Plugin-Surface-Session", surfaceSession);
    return origFetch(target.toString(), { ...init, headers });
  }

  function reportViewerError(kind, detail) {
    try {
      parent.postMessage({
        protocol: "hana.code-atlas.viewer",
        version: 1,
        type: kind,
        detail: String(detail || "unknown viewer error").slice(0, 500),
      }, "*");
    } catch (_) {}
  }

  window.addEventListener("error", (event) => {
    if (event.target instanceof HTMLLinkElement) return;
    reportViewerError("viewer.error", event.error?.message || event.message || event.target?.src || event.target?.href);
  }, true);
  window.addEventListener("unhandledrejection", (event) => {
    reportViewerError("viewer.unhandledrejection", event.reason?.message || event.reason);
  });

  window.fetch = function (input, init) {
    let url;
    if (input instanceof Request) url = input.url;
    else url = String(input);

    try {
      const parsed = new URL(url, parent.location.href);
      const fileName = parsed.pathname.split("/").pop() || "";

      if (dataFiles.has(fileName)) {
        const query = new URLSearchParams({ projectId, bundle });
        const responsePromise = pluginFetch(\`api/ua/\${encodeURIComponent(fileName)}?\${query}\`, init);

        // UA 2.9.0 already ships a complete Simplified Chinese locale. Force
        // only the Viewer language here so existing bundles need no rebuild.
        if (fileName === "config.json") {
          return responsePromise.then(async (response) => {
            if (!response.ok) return response;
            const config = await response.json();
            const headers = new Headers(response.headers);
            headers.delete("content-length");
            headers.set("content-type", "application/json; charset=utf-8");
            return new Response(JSON.stringify({ ...config, outputLanguage: "zh" }), {
              status: response.status,
              statusText: response.statusText,
              headers,
            });
          });
        }

        return responsePromise;
      }

      if (fileName === "file-content.json") {
        const query = new URLSearchParams({
          projectId,
          bundle,
          path: parsed.searchParams.get("path") || "",
        });
        return pluginFetch(\`api/source?\${query}\`, init);
      }
    } catch (err) {
      reportViewerError("viewer.fetch-rewrite-error", err?.message || err);
    }

    return origFetch(input, init);
  };
})();
</script>`;
}
