# Build Understand-Anything Viewer for Hana Code Atlas

## Prerequisites

- Node ≥18
- Git
- curl/wget

## Steps

```bash
# 1. Clone upstream at locked commit
git clone https://github.com/Egonex-AI/Understand-Anything.git /tmp/ua-build
cd /tmp/ua-build
git checkout f08763d11d0202a8a8f52b5dedda6d1b2e2ebac8

# 2. Apply Human Layout patch
git apply /path/to/hana-code-atlas/third_party/understand-anything/human-layout.patch

# 3. Build (do NOT apply hana-plugin-adapter.patch; it is superseded)
cd understand-anything-plugin
npm install
npm run build --workspace=packages/dashboard

# 4. Pack dist into the plugin as assets/ua/viewer (NOT dist/)
node /path/to/hana-code-atlas/scripts/pack-ua-assets.mjs /tmp/ua-build

# 5. Verify SHA-256 matches UPSTREAM.json
sha256sum /path/to/hana-code-atlas/assets/ua/viewer/index.html
```

## Hana Plugin Integration

The standalone `hana-plugin-adapter.patch` is **superseded**. Runtime integration is now handled by:

- `routes/viewer.js` `/frame?projectId=&bundle=` endpoint:
  1. Reads the locked Human Layout `index.html` from `assets/ua/viewer/index.html`.
  2. Removes external Google Fonts `<link>` tags and favicon references.
  3. Rewrites `/assets/*` and `/favicon.*` URLs to the Hana plugin asset route `/api/plugins/:pluginId/assets/ua/viewer/*`.
  4. Injects a fetch shim before the UA module that:
     - Seeds `sessionStorage["understand-anything-token"]` and `localStorage["ua-onboarding-dismissed-v1"]` to skip the UA TokenGate and onboarding overlay.
     - Intercepts only the six UA data requests and rewrites them to the plugin API:
       - `/knowledge-graph.json` → `/api/plugins/:pluginId/api/ua/knowledge-graph.json`
       - `/config.json` → `/api/plugins/:pluginId/api/ua/config.json`
       - `/meta.json` → `/api/plugins/:pluginId/api/ua/meta.json`
       - `/domain-graph.json` → `/api/plugins/:pluginId/api/ua/domain-graph.json`
       - `/diff-overlay.json` → `/api/plugins/:pluginId/api/ua/diff-overlay.json`
       - `/file-content.json` → `/api/plugins/:pluginId/api/source`
     - Adds the `X-Hana-Plugin-Surface-Session` header to each rewritten request.
     - Preserves `projectId` and `bundle` as query parameters on every rewritten request.

- `assets/app.js` control page:
  - Reads `pluginSurfaceSession` from the URL and uses the same header helper for all plugin API calls.
  - Sends the Hana `hana.ready` postMessage to the host.
  - Provides project selection, registration, dependency status, Architecture/Full bundle switching, and build/cancel controls.

## Cleaning Up

```bash
rm -rf /tmp/ua-build
```
