# Hana Code Atlas Validation Record

Date: 2026-07-20  
Plugin: `hana-code-atlas` 0.2.5  
Host: HanaAgent 0.407.15 compatibility baseline; 0.412.7 installed-shell regression baseline, macOS  
Dependencies: codebase-memory-mcp 0.9.0, Python 3.14  
Reference projects: camofox-browser, ai4paper, Hermes Workspace

## 0.2.5 cbm 0.9.0 Relationship and Provenance Gate

Date: 2026-07-23  
Source build: BetterAddon, temporary output `<temporary-output>`  
Test baseline: Python 86/86, Node 232/232

### Relationship evidence

- A full cbm CLI edge query returned 27,894 rows and exposed the previously schema-only relationships.
- `TESTS_FILE` endpoint direction is `test File → production File`; the adapter now reverses it to UA `tested_by` (`production → test`).
- `LISTENS_ON` endpoint direction is `File → Channel`; the adapter maps it directly to UA `subscribes` without reversal.
- `FILE_CHANGES_WITH` remains unmapped. It is historical co-change coupling, and the BetterAddon sample is dominated by documentation/audit evidence pairs rather than static code dependencies.
- Final Full graph: 5,719 nodes, 21,028 edges, 1 `tested_by`, 4 `subscribes`, 12 layers and a 10-step tour. The production source of the native `tested_by` edge carries the `tested` tag.
- `build-meta.json` now records `cbmVersion`; version probing accepts plain, `v`-prefixed, prerelease and build-metadata versions, and degrades to `unknown` instead of blocking a build.
- Batch node/edge queries now preflight the schema's raw row total, including skipped labels and unmapped edge types. Repositories above the cbm 100k query ceiling fail before querying with raw and retained counts, rather than later reporting a misleading schema count mismatch.

### Registry provenance observation

The Hana MCP connector schema reported 28 `FILE_CHANGES_WITH` edges, while the explicitly selected CLI registry used by the source build reported 36. This is evidence that registry/cache selection affects graph statistics, not evidence of cbm nondeterminism. Build comparison must bind the cbm project, cbm version and selected cache source.

### Reference-pool governance

- `reference-dependencies.schema.json` now formally covers `indexNotes`, `materializationNotes` and strict `indexStatus` shapes; unknown fields remain rejected by `additionalProperties: false`.
- `verify.mjs` executes Draft 2020-12 validation with Ajv before business checks. A negative mutation probe confirmed that an unknown reference field is rejected.
- `mani.yaml` now covers all 20 manifest references; both `npm run verify` and `npm run mani:check` pass.
- `refctl graph-index` uses cbm 0.9.0 flag-style arguments, passes explicit mode and `persistence=true`, and pins `CBM_CACHE_DIR` to the reference-pool cache.
- Firefox and other sharded references reject monolithic indexing before any cbm process starts; non-code references are also rejected. Full-pool graph-index performs this preflight before the first write.

### Plugin artifact

The current release hash is stored only in `dist/hana-code-atlas-0.2.5.zip.sha256` to avoid embedding a self-referential hash in a document that is itself packaged. Two consecutive packages must be byte-identical; the SHA sidecar check and `unzip -t` must pass from `dist/`.

## 0.2.5 File-Level Edge Projection and Layer Membership Gate

Date: 2026-07-22  
Build verified: `20260722T183622Z-62b7a14d` (ai4paper, projectId `<project-id>`)  
Test baseline: Python 52/52, Node 232/232

### Root cause

UA Viewer's `detailLevel=file` mode shows only file-type nodes, but cbm edges are function-to-function. Without file-to-file edges, containers in layer-detail had zero inter-container edges, producing unreadable scattered blocks. Additionally, `enhance.py` assigned all node types (functions, modules, classes) to layers, causing the file view to show 1000+ nodes instead of ~40 files, which defeated container derivation and produced anonymous Louvain clusters.

### Changes

**`pipeline/adapter.py`**:
- Added `derive_file_level_edges()` function: projects behavioral edges (calls, writes_to, imports, routes, reads_from, transforms, configures, publishes) to file-level via contains-edge ownership mapping. Weight is uniform 1.0.
- Added isolated-file fallback: for files with zero behavioral edges, projects `related` (USAGE) edges as weak links.
- Removed `math` import (no longer needed after weight simplification).

**`pipeline/enhance.py`**:
- Layer membership restricted to `type == "file"` nodes only. Functions/classes are reached via contains-edge expansion in UA Viewer's `detailLevel=class` mode.
- Added `derive_cluster_name_hints()`: groups files by filename prefix (first token before `-` or `_`) and injects `clusterNameHints` field into each layer. Multi-file groups get capitalized prefix name; single files get filename stem.
- Fallback layer and strict-mode check now only consider file nodes.

**`pipeline/test_cbm2ua.py`**:
- 20 new tests: 9 file-level edge projection (existence, weight range, aggregation, dedup, self-loop filter, publishes, no-contains safety, mutation safety, mixed types)
- 4 file-only layer membership (nodeIds contain only files, strict rejects function-only layers, fallback collects only files, strict ignores unassigned non-file nodes)
- 7 improvement tests (clusterNameHints grouping/injection/empty-layer/no-shared-token, related fallback with/without edges, weight assertion update)

**`overlay.json` (ai4paper project data)**:
- `layer-core` (41 files all in `chrome/content/scripts/core/`) split into 10 functional sublayers: tag-topic(5), pdf(2), sync(5), storage(3), metadata(3), refs(3), tracking(3), content(3), core-system(6), core-features(8).
- Macro domains expanded from 1 `macro-core` to 3: `macro-data`, `macro-content`, `macro-core-infra`.

### Verified data (build 20260722T183622Z-62b7a14d)

| Metric | Before fix | After fix | After improvements |
|--------|-----------|-----------|-------------------|
| Layers | 6 | 6 | 15 |
| Core layer nodes | 1064 mixed | 41 file | 41 file (split to 10 sublayers) |
| File-to-file edges | 0 | 384 | 403 (384 behavioral + 19 related fallback) |
| Connected files | 0/41 | 33/41 | 146/174 |
| clusterNameHints | none | none | all layers injected |
| Directory-grouped layers | 0 | 0 | 3 (translation, UI, foundation) |
| Full bundle validate | - | 0 issues | 0 issues |

### Container derivation simulation (label propagation approximation)

- 3 layers use directory grouping (named containers): translation(2 containers), UI(6), foundation(8)
- 12 layers trigger Louvain but now have real edges for community detection
- Largest meaningful community: AI layer (43 files, 78 edges) produces 9 communities including a 28-file agent/chat cluster and an 8-file UI cluster

### Residual limitations

1. **clusterNameHints not consumed by UA Viewer**: The field is injected at pipeline level, but UA Viewer's Louvain runs client-side and does not read this field. Container names remain `Cluster A/B/C` in the browser. The real improvement comes from overlay splitting (fewer files per layer) and file-to-file edges (meaningful community structure).
2. **5 isolated files have zero edges**: `pref-migrator.js`, `prefs.js`, `research-tracker.js`, `tag-organizer.js`, `refs/verify.js` have zero behavioral and zero `related` edges in the cbm graph. The fallback mechanism is correct but cannot produce edges for these specific files.
3. **Browser visual verification pending**: Surface session tokens invalidated on Hana restart. Data-level verification (graph structure, edge counts, container simulation) is complete.

### Plugin artifact

```
Version: 0.2.5
SHA-256: 3b50d84f5152ca8a02c4cca7154c4f066e74513edfab8889ca9f82dfc91c3e1f
Size: 1,709,759 bytes
```

## 0.2.5 Architecture Workflow Gate

- The control page exposes generation, independent review, human confirmation and immutable rebuild as four explicit steps with one state-driven primary action.
- The normal action sequence is generate/review, retry review when necessary, inspect and adopt, rebuild, then open Architecture. Regeneration remains in the advanced recovery section.
- Human confirmation still calls the double-SHA adopt endpoint first. Only a successful adopt response starts the existing build endpoint; a build-start failure keeps the adopted overlay and exposes rebuild recovery.
- A successful requested rebuild refreshes project metadata and switches to Architecture only when the promoted project reports `hasArchitecture=true`.
- Regression checks cover step state, dynamic action labels, advanced-action hiding, adopt-to-build chaining and guarded post-build switching.

## 0.2.5 Workflow Simplification Gate

- Merged the standalone build panel into the bundle-switch panel; the build section is now contextually hidden when the architecture workflow owns the next action and shown only for Full-only initial builds, architecture-ready rebuilds, or active builds.
- Wrapped the LLM provider/model selectors in a `<details>` element that auto-expands when model selection is needed (no draft, idle) and auto-collapses when the draft is adopted or architecture is ready.
- Added an elapsed-time indicator below the progress bar that shows "已等待 Xs / 上限 180s" during `generating` and `reviewing` states, updating once per second and clearing on state exit.
- Added a green "Architecture 已就绪" success banner between the workflow steps and the progress bar, visible only when architecture is fully ready.
- The build button label is now contextual: "构建 Full 图谱" for initial Full builds, "重新构建" after architecture is ready.
- Current gates: Node 232/232 across 65 suites; Python 32/32; syntax, Python compile and whitespace checks pass.

## 0.2.4 Architecture Progress Gate

- Public Architecture tasks now include a monotonic `progress` field derived from the backend state machine rather than elapsed time.
- Full generation checkpoints: preparing 5%, generating 20%, validating 45%, committing draft 55%, reviewing 65%, committing review 90%, completed 100%.
- Review-only checkpoints: preparing 10%, reviewing 25%, committing review 90%, completed 100%.
- Failure, review failure, cancellation and cancelling preserve the latest completed checkpoint; only `completed` reaches 100%.
- The control page uses a native `<progress>` element plus visible stage and percentage labels. Active-task refresh recovery reads the same backend field. Provider-wait stages explicitly say they are waiting for a response and do not use synthetic interval increments.
- Regression tests pause mock generation and review requests, observe 20% and 65% while each request is blocked, then verify 100% only after both complete.
- Browser acceptance over the extracted release package restored an injected `reviewing / 65%` active task: the progress group was visible, label was `AI 独立复审（等待 Provider 响应）`, native progress value/max were 65/100, `aria-valuetext` included stage and percent, controls were locked, and horizontal overflow was zero.
- Current gates: Node 230/230 across 65 suites; Python 32/32; syntax, Python compile and whitespace checks pass.

## 0.2.3 Provider Dropdown and Reload Gate

- Primary interaction is restored to linked Provider/model `<select>` controls for generation and independent review. Provider options show their chat-model counts; changing Provider rebuilds the corresponding model list.
- Manual IDs remain available behind explicit per-role checkboxes and require a complete Provider/model pair, so fallback data cannot silently override a visible dropdown choice.
- The live Hana log at 18:17:06 recorded `route "architecture.js" in "hana-code-atlas" failed to load: The requested module '../lib/architecture-generator.js' does not provide an export named 'startArchitectureReview'`. This identifies a stale ESM dependency during plugin hot reload, not an empty Provider registry.
- Runtime routes and lifecycle import `architecture-generator-v2.js`; `architecture-generator.js` is a compatibility re-export. This avoids the observed stale pre-review generator export.
- A later in-process 0.2.3 reload at 19:15:29 reached the versioned generator but failed on a stale transitive `architecture-overlay.js` export (`stableOverlayHash`). This confirms that HanaAgent 0.412.7 plugin reload does not invalidate the full ESM dependency graph; a complete process restart remains mandatory after upgrade.
- An isolated PluginManager smoke over the packaged plugin and the installed Hana ProviderRegistry returned HTTP 200 with 28 chat models grouped into 8 Providers.
- Browser acceptance over that extracted package rendered four enabled native selects. Both Provider selects contained 8 Providers plus their inherited empty option; selecting `deepseek (2)` reduced the generation-model selector to exactly `deepseek-v4-pro` and `deepseek-v4-flash`. Custom fields were hidden until the explicit checkbox was enabled, the normal selects then locked, and page horizontal overflow remained zero.
- 0.2.3 baseline gates: Node 227/227 across 65 suites; Python 32/32; syntax, Python compile and whitespace checks passed.
- Upgrade acceptance requires a complete Hana restart so the route registry and all prior ESM modules are discarded.

## 0.2.2 Provider Discovery Permission Gate

The installed 0.2.1 control page exposed enabled Provider selectors but only the `自动选择` / `同生成模型` placeholder options. The host model catalog was populated, so this was not a user configuration failure.

- Compatibility gap: the manifest omitted `provider.read` and `provider.credentials.read` even though the plugin uses the stable Provider discovery and call-time credential bus contracts. The full-access host path may expose the raw bus, so the omission alone is not claimed as the only possible runtime cause of an empty result.
- Contract fix: the manifest now declares both Provider capabilities, matching the established Hana integration used by `paper2gal`.
- Registry evidence: the installed Hana registry returns 28 chat models across 8 configured Providers, proving the empty UI was not caused by a genuinely empty catalog.
- UI hardening: a failed or empty discovery result is shown explicitly instead of becoming indistinguishable empty selectors. The four Provider/model controls are editable datalist comboboxes, so a complete manual pair can proceed to call-time Hana credential validation even if enumeration is unavailable.
- Regression coverage reads the production manifest, requires both Provider capabilities, requires the visible error/manual-entry UI, and proves an explicit generator/reviewer pair completes when discovery raises `NO_HANDLER`.
- 0.2.2 baseline gates: Node 225/225 across 65 suites; Python 32/32; syntax, Python compile and whitespace checks passed.
- Architecture generation, independent review, adoption and bundle semantics are unchanged from 0.2.1.

## 0.2.1 Independent LLM Review Gate

Architecture generation now includes a second, independently selectable reviewer model before human adoption:

- Hana PluginManager 0.412.7 loaded the source plugin as `0.2.1` and auto-discovered the updated Architecture route.
- A real route run over the current camofox Full Bundle sent a bounded 40,181-character context to `generator-provider/generator-model`, then sent the validated draft and the same bounded structural context to `review-provider/review-model`.
- The reviewer returned `revise` at 87% confidence with one grounded finding and one grounded missing area. The report was persisted separately from the overlay and bound to draft SHA-256, source Full build, reviewer identity, prompt SHA-256 and report SHA-256.
- `overlay.json` remained absent after both LLM calls. Adoption with an incorrect review SHA returned `architecture_review_changed`; adoption with both exact hashes succeeded even though the advisory verdict was `revise`, proving the human gate does not delegate authority to the reviewer.
- The adopted overlay produced a real camofox Architecture build `20260720T082709Z-2f729e01`: 23 nodes, 23 edges, 3 macro layers and zero dangling edges.
- Browser acceptance under the strict surface-token proxy verified separate generator/reviewer selectors, `reviewing` progress, the `revise · 87%` state, reviewer identity and both hashes, three individually rendered evidence paths, a positive observation, background `inert` and checkbox-gated adoption. Expanding the real overlay and then injecting a 600-line adversarial JSON body produced an internally scrollable 12,795-pixel preformatted region while modal actions remained visible and page overflow stayed zero.
- Failure and cancellation tests prove that invalid reviewer output preserves the deterministic draft without creating a review, review-only retry can complete without regenerating the overlay, cancellation during either LLM request cannot be overwritten by late completion, and short atomic draft/report commit states reject cancellation.
- 0.2.1 baseline tests: Node 222/222 across 65 suites; Python 32/32. Syntax, Python compile and whitespace checks passed.

Security boundary evidence:

- generation and review use the same bounded response, timeout, cancellation and no-redirect controls, but may use different Hana Providers/models;
- report schema rejects unknown executable/control fields, fabricated paths, unknown layer IDs and ungrounded findings;
- a new draft invalidates the previous report;
- adoption verifies the exact draft hash, report hash and unchanged source Full build, while ignoring reviewer verdict for authorization; verdict stays in the review report and is not copied into project approval metadata;
- Node and Python use the same compact, recursively key-sorted UTF-8 JSON SHA contract, and project metadata records the actual adopted overlay hash rather than the pre-adoption draft hash;
- global Architecture generation/review concurrency is capped at four projects.

## 0.2.0 Architecture Generation Gate

The Full-only UX gap is closed with an explicit, review-gated semantic workflow:

- Hana PluginManager 0.412.7 loaded the source plugin as `0.2.0`; the auto-discovered Architecture route returned the mock chat provider.
- A real PluginManager route run over the existing camofox Full Bundle sent a bounded 40,140-character context to a mock Hana Provider, produced a validated draft, proved `overlay.json` absent before adoption, then adopted only the reviewed SHA-256.
- A second isolated camofox build consumed the adopted overlay and completed with Full + Architecture: 11 Architecture nodes, 10 edges, 2 macro layers, and zero dangling edges.
- Browser acceptance under the strict surface-token proxy verified: Full-only Architecture disabled with no false active state; mock provider/model selectors; review dialog with 3 semantic layers, 2 macro domains, 3 path evidence records, hash summary, explicit checkbox, disabled adopt button until confirmation, Escape close and focus restore; no outer or inner overflow.
- Browser acceptance over the isolated Architecture build rendered `camofox-browser · 架构总览`, two React Flow macro-layer nodes, Chinese navigation, no external Viewer resources, and exact viewport dimensions without overflow.
- Node tests: 209/209 across 63 suites. Python tests: 31/31.
- Final package: 63 entries; two consecutive builds were byte-identical. Final size and SHA-256 are recorded in the generated sidecar and final delivery report; `unzip -t` and sidecar verification passed.
- Extracted-package PluginManager acceptance: `loaded` 0.2.0, manifest/package versions equal, Architecture provider and state routes returned 200, self-contained frame returned 200 with no external script/stylesheet, and camofox Full remained 906 nodes / 2,195 edges.
- Independent reviews found no blocking issue. Their actionable findings were fixed: source-build TOCTOU on adoption, per-build immutable overlay input snapshot, unreadable Full graph error handling, cross-project task read/cancel binding, build/generation mutual exclusion, adopted-draft review leakage, modal focus containment, and graph structural validation before promotion.

Security boundary evidence:

- repository excerpts are explicitly untrusted prompt data; model output cannot invoke tools;
- context is capped, response bodies are capped at 256 KiB, requests have timeout/cancellation and reject redirects;
- Hana credentials are requested only at call time and are not persisted, returned, or logged;
- model output remains `overlay-draft.json`; adoption requires the exact reviewed SHA-256 and unchanged source Full build;
- deterministic validation covers schema, known paths, pattern matches, duplicate layer ownership, macro coverage, and evidence for every layer.

## Result

Implementation gate: PASS  
Packaging gate: PASS; reproducible SHA is recorded in the generated sidecar  
Independent review/reality gate: PASS

This record separates deterministic test evidence from acceptance observations. cbm remains the structural fact source; generated UA bundles are derived artifacts.

## Automated Gates

| Gate | Command | Result |
|---|---|---|
| Node | `npm test` | 230/230 |
| Python | `npm run test:python` | 32/32 |
| Syntax | `node --check` over lifecycle/lib/routes/tools/scripts/tests | PASS |
| Python compile | `python3 -m py_compile pipeline/*.py` | PASS |
| Whitespace | `git diff --check -- plugins/hana-code-atlas` | PASS |
| UI style | starmap-inspired token pass, light/dark computed-style smoke check, no overflow | PASS |
| Viewer asset set | disk entries ↔ manifest ↔ UPSTREAM hash | PASS, 18 files |
| Embedded Viewer | source asset-set ↔ derived manifest ↔ JS/CSS size and hash | PASS |
| Human Layout patch | disk SHA ↔ UPSTREAM | PASS, `4db4e22a717126cc16169c8af9f0b63e0d3da8fb846d8356019c3ba2a2fbdc58` |

The release zip SHA is intentionally kept in `dist/hana-code-atlas-0.2.5.zip.sha256` rather than embedded in the zip itself.

## PluginManager E2E

The plugin was copied to an isolated community-plugin directory and loaded through the actual OpenHanako PluginManager used for Hana compatibility testing.

Verified:

- status `loaded`, trust `full-access`;
- automatic discovery of three route modules and four Agent tools;
- configuration schema and page contribution loaded;
- lifecycle `onload` executed;
- valid `code_atlas_project add` registered Hermes and matched its cbm project through configured `CBM_CACHE_DIR`;
- `code_atlas_status`, `code_atlas_validate` and `code_atlas_build` executed with valid inputs;
- build task reached `completed` through `/api/tasks/:taskId`;
- Full graph, source API, frame wrapper and status route returned HTTP 200;
- a second build atomically moved the first build to `previousBuildId`.

Final promotion observed:

```json
{
  "buildId": "20260719T121309Z-4b332fbd",
  "previousBuildId": "20260719T120137Z-ff6edee4"
}
```

No `hana_adapter.py` or `codebase-memory-mcp cli` process remained after completion.

## Real Hermes Build

Registration:

- opaque projectId: `<project-id>`;
- cbm project matched by `root_path`;
- configured cbm cache: true;
- repository overlay: true.

Bundle evidence:

| Metric | Full | Architecture |
|---|---:|---:|
| Nodes | 8,864 | 39 |
| Edges | 20,604 | 41 |
| Layers | 11 | 6 |
| Tour steps | 8 | 6 |
| `validateBundle` | PASS | PASS |

Build metadata preserved:

- pipeline version `0.2.0`;
- Git commit `d04e1f3601cf36dba8763dd8bde717ae6259882c`;
- overlay SHA-256 `ebad106b3d223237319c6ba209fd6529e8f85f915dfa5d1f76a30a2ac20e22f6`;
- Full and Architecture counts;
- promotion timestamp and build identity.

Source snapshot:

- 956 files registered and copied;
- 8,249,474 bytes materialized;
- sampled `src/screens/gateway/components/run-console.tsx` matched metadata and disk size.

## Browser Acceptance

An isolated local host mounted the real PluginManager route app and the same Hana asset URL shape.

Verified in headless Chromium:

- dark control page loaded with dependency state;
- project selection created the expected Architecture frame;
- Architecture rendered six Human Layout domains and the six-step Chinese tour;
- Full rendered the 11-layer overview over the 8,864-node graph;
- Vite lazy CSS/module preload URLs resolved through the plugin asset route;
- all 18 locked Viewer files returned HTTP 200 with manifest-matching byte lengths;
- fuzzy search for `run-console` returned seven results;
- Path Finder opened and exposed source/target selectors;
- selecting `src/screens/gateway/components/run-console.tsx` and “打开代码” fetched `/api/source`;
- the code viewer rendered lines 1–1048 from the materialized snapshot.

The acceptance run initially exposed blank frames caused by async Hono wiring and Vite `/assets/*` preloads. Both were fixed before this PASS result and covered by wrapper route tests.

A later real install against HanaAgent 0.412.7 exposed a separate blank control-shell regression: the authenticated `/viewer` HTML loaded, but its external `app.js` and `app.css` requests could be rejected with `403 missing_credential` before `hana.ready` was sent. The control CSS and JS are now inlined into the authenticated shell response, while the source files remain separately testable and package-validated. A 0.412.7-shaped browser check verified:

- no external `/assets/app.js` or `/assets/app.css` resource request;
- the usable shell exists before `hana.ready` is sent;
- an empty dataDir renders the registration UI rather than a blank surface;
- the configured cbm registry returned 57 accessible candidate roots in 889 ms;
- selecting a candidate filled the absolute-path field and moved focus there;
- the starmap-inspired forest/paper/gold control surface rendered with explicit light and dark theme overrides;
- the rendered shell had no horizontal or vertical overflow in the desktop smoke viewport;
- no horizontal or vertical viewport overflow at 2300 × 1259.

The indexed-project regression was then reproduced from the live 0.412.7 log. During plugin hot update, `routes/api.js` was fresh-imported but its transitive `lib/projects.js` dependency remained cached from the previous package and did not export `listCbmProjects`. The whole API route module therefore failed to load. `/api/projects` fell through to plain-text `404 Not Found`; `Response.json()` parsed the leading `404` and failed on the fourth character, producing `Unexpected non-whitespace character after JSON at position 4`.

The final fix and acceptance evidence:

- cbm registry discovery moved behind the versioned `lib/cbm-registry-v1.js` import boundary;
- runtime resolution precedence is plugin config → process environment → Hana MCP connector → cbm default;
- the real Hana MCP connector config resolved the reference-pool cache without duplicate manual configuration;
- raw-text-first response parsing now reports HTTP status, content type and a bounded body preview for non-JSON responses;
- extracted-zip PluginManager returned `200 application/json` for `/api/projects` and `/api/project-candidates`;
- the candidate response contained 57 projects from the reference-pool registry;
- the candidate control is a bounded searchable table with project, node/edge scale, path, registration state and row action;
- two-term search `hermes workspace` matched 1 of 57 projects across name/cbm-id/path fields;
- choosing the result filled the Hermes absolute path and focused the path input;
- after isolated registration, the row changed to `已注册` with an `打开` action that selected the registered project;
- a Full-only ai4paper build reported `hasArchitecture: false` and `hasFull: true`; the control surface automatically selected Full and explained that no Architecture overlay was available;
- an extracted-package run through Hana's real `createPluginProxyRoute()` found that rewritten Viewer JS/CSS URLs returned 404 because the plugin had not registered a static asset handler; the earlier wrapper check had validated URL rewriting but not the routed response;
- after adding the manifest-allowlisted `/assets/ua/viewer/*` route, all 18 locked files returned 200 with exact byte lengths, unknown files returned 404, and traversal attempts returned 400;
- the real ai4paper frame mounted the UA React root, rendered SVG/React Flow nodes, and exposed `Overview`, `Learn`, `Deep Dive`, `Files`, and `Classes` controls;
- the control placeholder has an explicit `[hidden]` rule, so a ready Full frame is not obscured by the initial “add project” state;
- the 2300px desktop viewport used a 420px sidebar, kept the table free of horizontal overflow and left the graph area independent.

A live 0.1.4 run then exposed the remaining host-boundary defect: the control page and Full status loaded, but the nested Viewer iframe showed only the outer `#f6f3d8` background. Cross-agent review and direct Bundle inspection ruled out data corruption and ELK scale: camofox's current Full graph has 906 nodes, 2,195 edges, no duplicate IDs and no broken endpoints, and rendered successfully through the unauthenticated isolation proxy. The difference was the formal Hana surface boundary: the nested document and its JS/CSS used hard-coded plugin URLs outside the parent page's authenticated `hana.api` flow.

The 0.1.5 fix and strict acceptance evidence:

- the locked 18-file Viewer set remains unchanged and keeps its original asset-set hash;
- esbuild 0.27.4 produces a derived single-file module plus concatenated locked CSS, recorded in `assets/ua/embedded/manifest.json` with source hash, options, sizes and output hashes;
- `/frame` returns self-contained HTML with inline Viewer JS/CSS and no external script or stylesheet tags;
- the control page fetches `/frame` through the Hana API bridge (surface-header fallback) and assigns it to `iframe.srcdoc`;
- the srcdoc shim reads the runtime surface session from its parent and uses `parent.hana.api.fetch` when available;
- redundant Vite preload hints are suppressed because their chunks and styles are already embedded;
- an authentication-enforcing proxy accepted only the correct surface token and stripped it before plugin routes, matching Hana 0.412.7 behavior;
- under that proxy, ai4paper and camofox both mounted the UA React root, exposed `Overview`, and rendered 3 and 10 React Flow layer nodes respectively;
- browser resource timing recorded no `/assets/*` request from either embedded frame.

The 0.1.6 localization and pixel-farm UI acceptance evidence:

- the wrapper rewrites only the successful `config.json` response to `outputLanguage: "zh"`, activating UA 2.9.0's existing Simplified Chinese locale without rebuilding existing project Bundles;
- `assets/ua/hana-overlay.js` decorates only stable Chinese navigation controls and preserves their original text, click handlers, title tooltips and React state;
- fixed daytime wood, leaf and wheat colors are isolated to the enhanced toolbar/action classes and add no animation, gradient, external resource or non-zero letter spacing;
- six offline Pixelarticons paths are used at 16px with `aria-hidden` and `focusable="false"`; the MIT license is packaged at `third_party/pixelarticons/LICENSE`;
- the plugin page contribution uses the same pixel-house icon language;
- browser acceptance verifies the Chinese controls, pixel SVG count, active-state contrast, graph rendering and absence of external resources.

## Packaging Contract

`npm run pack:plugin` enforces:

- explicit top-level allowlist;
- exclusion of tests, scripts, caches, pyc, dist, node_modules, hidden files and symlinks;
- Viewer asset manifest and patch hash verification;
- fixed `SOURCE_DATE_EPOCH`, sorted file list and `zip -X`;
- safe zip entry names and root `manifest.json`;
- SHA-256 sidecar.

Release acceptance requires two consecutive builds with identical SHA-256, PluginManager load from the extracted zip, and sidecar verification. The current Architecture-generation package entry count, size, and SHA-256 remain recorded only in the generated sidecar and final acceptance output to avoid embedding a self-referential package hash.

## Independent Review

- Quality review: `0 Blocking / 0 High`. Active-build deletion and pre-spawn cancellation findings were fixed, tested and closed on short re-review.
- Viewer review: `0 Blocking / 0 High`. Metadata routing, UI build guards, project-switch locking, cancelling-state polling, message wrapping, accessibility busy state and Hana/UA theme synchronization were fixed and re-reviewed.
- Post-install blank-shell/path-selection short review: `0 Blocking / 0 High / 0 Medium` after sequential refresh and candidate reset follow-ups were closed on re-review.
- Indexed-project final review: `0 Blocking / 0 High`; the actionable cache-precedence Medium was fixed by validating environment input only when it is selected, with explicit process-env and precedence tests. Binary/cache provenance is now reported separately and all five hot-reloaded consumers are guarded by versioned-import tests.
- Reality review: all source-level claims passed. Its initial PARTIAL status was caused only by read-only execution limits; the parent validation session independently ran the required test, SHA, unzip, reproducibility and extracted-zip PluginManager checks.
- `0.2.1` architecture review: no Blocking findings. The two P1 findings were closed by removing verdict from project metadata/adopt responses and adding a review-only retry route. The review-write cancellation race was closed with explicit non-cancellable atomic commit states.
- `0.2.1` quality review: no Blocking/P1 findings. Its adopted-overlay/cross-language SHA P2 was fixed with the shared canonical hash contract and an actual adopted-file hash assertion. The post-write cancellation P2 was fixed by the commit-state boundary.
- `0.2.1` frontend review: no Blocking findings after modal scrolling, sticky actions and reviewer-progress fixes. Follow-up active-task cancellation recovery, retry UX and per-path evidence rendering were also closed.
- Accepted boundary: validation/promotion filesystem promises are not user-cancellable and have no separate timer. See Residual Boundaries below.

## Residual Boundaries

- No Windows real-machine cancellation test.
- No persisted recovery of tasks interrupted by Hana process termination.
- Validation/promotion uses local plugin-data filesystem promises. These states reject user cancellation and have no separate deadline because JavaScript cannot safely abort an in-flight rename/copy without risking a late pointer switch; a stalled filesystem requires host/process recovery.
- Automated acceptance used local mock Hana Providers so credentials were never exposed to test scripts. A real externally configured Provider still requires the user to trigger generation from the live plugin UI.
- LLM generation and review can establish grounded consistency, not semantic certainty; human adoption remains mandatory even when the advisory verdict is `pass`.
- Hana 0.412.7 MCP auto-discovery currently relies on the sibling `plugin-data/mcp/config.json` layout. If the host moves that file, discovery safely falls back to process/plugin configuration or cbm defaults and exposes the selected source in the UI; the host does not currently provide a public connector-discovery capability.
- A task stuck indefinitely in backend `cancelling` keeps the page polling once per second until it reaches a terminal state or the page closes. Stopping early would lose task tracking and incorrectly re-enable conflicting controls, so this remains coupled to backend process termination.
- No external publication/install into the user's live Hana profile was performed during isolated acceptance.
