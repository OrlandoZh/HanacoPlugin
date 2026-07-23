# Hana Code Atlas Initial Prototype Audit

Date: 2026-07-19  
Scope: `plugins/hana-code-atlas/` only  
Status: Closed for MVP implementation; final independent review still applies  
Evidence: [VALIDATION.md](VALIDATION.md)

## Initial Conclusion

The prototype direction was valid but not runnable end to end. The original audit found seven Blocking, seven High and seven Medium implementation gaps. All Blocking and High findings below have been remediated and exercised through tests or real-host E2E validation.

## Blocking Closure

| Initial finding | Resolution | Evidence |
|---|---|---|
| New projects could not enter the allowlist | HTTP and Agent registration now share `registerProject()`; explicit registration creates the plugin allowlist | Project tests and valid `code_atlas_project add` PluginManager smoke |
| Python/storage output layouts disagreed | Staging contract is `full/` plus optional `architecture/` | Python 31/31 and real Hermes promotion |
| Source preview layout/metadata disagreed | Files materialize under `source-preview/`; metadata contains the registered `files[]` list | 956 Hermes snapshots; browser source preview loaded 1,048 lines |
| Completed builds were not promoted | Build state machine validates and promotes automatically before `completed` | Real current/previous E2E |
| Viewer/control assets were absent | Control UI and locked 18-file UA dist are embedded | Asset-set validation and browser render |
| Hana adapter patch was a placeholder | Superseded by HTML wrapper/fetch/asset-preload shim; historical patch is marked `superseded` | Wrapper tests and real browser lazy-load validation |
| HTTP and Agent registration differed | Both call the same library implementation | Loader/tool E2E |

## High Closure

| Initial finding | Resolution |
|---|---|
| Promotion could leave no current bundle | Immutable builds plus atomic `current.json` pointer |
| Adapter spawned a second Python pipeline | `hana_adapter.py` imports and runs pipeline modules in-process |
| Timeouts were conflated | Separate bounded pipeline and cbm timeouts |
| Cancellation could orphan cbm children | Detached POSIX process group, SIGTERM/SIGKILL grace, idempotent cleanup |
| cbm project name was guessed from path | `cli list_projects` matching by real `root_path`, with explicit `CBM_CACHE_DIR` support |
| Logs exposed project roots | Bounded log tail with root redaction |
| Browser repeatedly accepted absolute roots | Opaque 16-hex `projectId` required after registration |

## Medium Closure

- Build no longer accepts an ignored bundle selector; one build deterministically produces Full and optional Architecture.
- Project identity and path helpers are centralized.
- `build-meta.json` records cbm project, pipeline version, Git SHA, overlay hash and graph counts.
- Overlay realpaths are constrained or copied from trusted plugin profiles.
- Viewer packing clears stale output and validates the complete asset set.
- README now matches the implementation and install process.
- Tests cover projects, storage, task lifecycle, wrapper routes, assets, packaging and Python output contracts.

## Host-Contract Corrections

Two early observations were rejected after inspecting the HanaAgent 0.407.15 runtime bundle:

- `index.js` must not manually register routes/tools/assets. PluginManager discovers `routes/*.js` and `tools/*.js`; the host owns `/assets/*`.
- The plugin must not verify `pluginSurfaceSession`. Hana authenticates and strips the credential before proxying. Nested frame requests still attach the session header when one is available.

## Findings Added During Acceptance

Acceptance and post-install testing found and fixed five issues not present in the first prototype audit:

1. cbm registry selection is controlled by `CBM_CACHE_DIR`; assuming a global registry prevented Hermes discovery outside the connector environment.
2. `/viewer` and `/frame` passed async renderer Promises through the wrong Hono response path, returning an empty/invalid frame.
3. UA's Vite runtime emitted absolute `/assets/*` lazy-preload URLs. The frame shim now rewrites `HTMLLinkElement.href` assignments to the Hana plugin asset route before the main module runs.
4. A real Hana 0.412.7 install could authenticate `/viewer` while rejecting its nested control JS/CSS with `403 missing_credential`, preventing `hana.ready` and leaving the iframe blank. The small control assets are now safely inlined into the authenticated shell.
5. The empty registry state exposed only a manual text field. The control page now lists accessible cbm-indexed roots as registration candidates while retaining absolute-path input as the fallback.

All five have regression coverage or browser/runtime evidence recorded in `VALIDATION.md`.

## Residual Risk

- Windows process-tree cancellation has code fallback but no real-machine evidence.
- Task persistence and interrupted-build recovery are outside MVP.
- Architecture quality for repositories without a maintained overlay remains structural rather than semantic.
- Final release still depends on the independent quality/reality gate documented in `VALIDATION.md`.
