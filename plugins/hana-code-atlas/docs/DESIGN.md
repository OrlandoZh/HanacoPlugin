# Hana Code Atlas MVP Design

Status: Implemented; 0.2.5 state-driven Architecture workflow over the 0.2.4 stage progress
Date: 2026-07-20
Applies to: HanaAgent 0.407.15+, codebase-memory-mcp 0.8.1, Understand Anything Viewer 2.9.0
Evidence: `docs/VALIDATION.md`

## 1. Goal

Package the proven cbm -> cbm2ua -> patched UA Viewer workflow as a native HanaAgent full-access plugin. The plugin owns project registration, deterministic bundle generation, immutable build storage, source-preview snapshots, and the embedded viewer. It does not run an independent UA HTTP process and does not bundle the closed-source cbm binary.

## 2. Host Contract

HanaAgent PluginManager provides these contracts:

- `tools/*.js` and `routes/*.js` are discovered automatically.
- `index.js` owns lifecycle only. It initializes `ctx.dataDir` and cancels running builds on unload.
- Static files under `assets/` are exposed by the host at `/api/plugins/:pluginId/assets/*` with realpath containment and extension allowlisting. The small control-page CSS/JS are inlined into `/viewer` because Hana 0.412.7 may strip a surface credential before the plugin renders HTML without minting an asset cookie for its nested requests; the locked UA dist remains on the host asset route.
- `pluginSurfaceSession` is authenticated by the Hana host before the request reaches the plugin Hono app. The host removes the credential header/query before proxying. The plugin must not implement a second token verifier.
- Plugin frontend fetches still attach `X-Hana-Plugin-Surface-Session`; this is consumed by the host authentication layer.

## 3. Components

| Component | Responsibility |
|---|---|
| `index.js` | Create dataDir; cancel and clear running tasks on unload |
| `lib/projects.js` | Register/list/resolve projects; realpath matching and accessible cbm registry candidates |
| `lib/build-manager.js` | Single-flight task state machine, process-tree cancellation, validation, automatic promotion |
| `lib/storage.js` | Immutable builds, atomic current pointer, retention, source snapshot reads |
| `routes/viewer.js` | Hana control page and UA frame HTML wrapper |
| `routes/api.js` | Project, status, graph and source-preview APIs |
| `routes/build.js` | Build/task/cancel APIs |
| `pipeline/*.py` | Deterministic cbm -> UA conversion and optional semantic/architecture projection |
| `lib/architecture-context.js` | Bounded, read-only context projection from the current Full Bundle |
| `lib/llm-client.js` | Hana Provider discovery, credential use, bounded non-streaming request |
| `lib/architecture-overlay.js` | Draft validation, provenance, dual-hash atomic adoption |
| `lib/architecture-review.js` | Independent review prompt, grounded report validation, provenance and hashing |
| `lib/architecture-generator.js` | In-process generation/review task lifecycle, timeout and cancellation |
| `routes/architecture.js` | Provider, draft, generation task and adoption APIs |
| `assets/app.*` | Native plugin control surface and human review dialog |
| `assets/ua/viewer/**` | Locked Human Layout UA Viewer dist |

## 4. Data Layout

```text
ctx.dataDir/
└── projects/
    └── <projectId>/
        ├── project.json
        ├── overlay.json                 # adopted semantic input
        ├── overlay-draft.json           # validated generator output
        ├── overlay-draft-meta.json       # generator provenance and source build binding
        ├── overlay-review.json          # independent reviewer report; never executable
        ├── overlay-review-meta.json     # reviewer identity and report/draft hashes
        ├── current.json                 # atomic pointer
        ├── staging/
        │   └── <taskId>/
        │       ├── full/
        │       │   ├── .ua/*.json
        │       │   └── source-preview/**
        │       └── architecture/        # present only when overlay supports it
        │           ├── .ua/*.json
        │           └── source-preview/**
        └── builds/
            └── <buildId>/
                ├── build-meta.json
                ├── full/**
                └── architecture/**
```

`current.json`:

```json
{
  "buildId": "20260719T120000Z-ab12cd34",
  "previousBuildId": "20260718T230000Z-98ef7654",
  "promotedAt": "2026-07-19T12:00:04Z"
}
```

Promotion is:

1. validate staging bundles and source-preview metadata;
2. rename `staging/<taskId>` to immutable `builds/<buildId>` on the same filesystem;
3. write `current.json.tmp`;
4. rename the pointer file to `current.json` atomically;
5. retain current and previous builds, then delete older builds.

The current viewer never observes a missing current directory.

## 5. Project Identity and Registration

- Browser APIs use opaque `projectId`, not absolute roots.
- `projectId` is a stable SHA-256 prefix of the project realpath.
- `GET /api/project-candidates` lists up to 500 accessible, deduplicated roots from the configured cbm registry; it is discovery only and does not register anything.
- `POST /api/projects` is the only HTTP registration entry. It accepts an absolute root, resolves realpath, verifies a directory, discovers the matching cbm project from `codebase-memory-mcp cli list_projects`, then writes config and `project.json`.
- Agent tool registration calls the same library function.
- Later browser requests resolve `projectId` through the registry and never accept arbitrary filesystem roots.
- A project can be registered without a cbm index, but build is disabled until a matching cbm project exists.
- cbm registry selection is explicit: optional `cbmCacheDir` is passed as `CBM_CACHE_DIR` to both project discovery and the Python/cbm build process. Empty configuration inherits the host environment or cbm default.

## 6. Build State Machine

```text
running -> validating -> promoting -> completed
        -> failed
        -> cancelling -> cancelled
```

Rules:

- one running build globally in MVP;
- one running build per project;
- Python is launched with `spawn`, `shell: false`, a fixed argument list and an outer timeout;
- cbm command timeout is separate from whole-pipeline timeout;
- on POSIX, the Python process is a detached process-group leader; cancel terminates the group, then sends SIGKILL after a grace period;
- completed means the current pointer has already been promoted;
- task logs returned to UI are bounded and redact the project root;
- tasks are pruned after a bounded retention period.

## 7. Pipeline Contract

Before launch, Node snapshots the adopted project-level overlay into `staging/<taskId>/overlay.input.json`; the Python process receives only that immutable task-local path, so registration or later adoption cannot change a running build's semantic input.

Node launches `pipeline/hana_adapter.py` with:

```text
--project-root <registered-realpath>
--cbm-project <name discovered from list_projects>
--output-root <dataDir/project/staging/taskId>
--cbm-binary <configured executable>
[--overlay <trusted plugin data/profile path>]
--materialize-source-preview
```

The adapter performs conversion in-process; it does not spawn `pipeline.py` as a second Python process.

Output:

```text
<output-root>/full/.ua/knowledge-graph.json
<output-root>/full/.ua/config.json
<output-root>/full/.ua/semantic-meta.json
<output-root>/full/.ua/source-preview-meta.json
<output-root>/full/source-preview/**
<output-root>/architecture/.ua/knowledge-graph.json   # overlay only
<output-root>/architecture/.ua/config.json
<output-root>/architecture/.ua/overview-meta.json
<output-root>/architecture/.ua/source-preview-meta.json
<output-root>/architecture/source-preview/**
<output-root>/build-meta.json
```

A repository-specific overlay produces Full + Architecture. Without an overlay, the plugin produces a structurally layered Full bundle only and reports Architecture as unavailable. AI-generated overlays are supported only as explicit drafts. The plugin reuses Hana's stable `provider:models-by-type` and `provider:credentials` bus contracts, sends a bounded projection of the current Full Bundle, and never persists credentials. Generator output is untrusted data and must pass deterministic schema, path, glob ownership, macro coverage, and evidence checks. A separately selected reviewer model then emits a strict, grounded report with `pass`, `revise`, or `reject`; it cannot modify the overlay or trigger tools. The report is bound to `draftSha256`, `sourceBuildId`, reviewer identity, prompt hash, and `reviewReportSha256`. Review failures preserve the validated draft and can be retried independently through the same bounded task manager. Adoption requires both exact hashes and the unchanged source Full build, but reviewer verdict is stored only in the review report and never becomes project approval metadata. The generator and Python pipeline share a compact, recursively key-sorted UTF-8 JSON hash contract; project metadata records the hash of the actual adopted overlay. A new build is still required before Architecture becomes available.

## 8. Viewer Integration

The plugin embeds the existing Human Layout dist without a second source patch.

- `/viewer` renders the native control page.
- `/frame?projectId=&bundle=` reads the locked UA `index.html`, removes external fonts/favicon, rewrites asset paths to the host asset route, and injects a fetch shim before the UA module.
- The shim also rewrites Vite runtime `HTMLLinkElement.href = "/assets/*"` preload assignments to the plugin Viewer asset route. This keeps the audited dist immutable while allowing lazy CSS and chunks to load under Hana's namespaced asset endpoint.
- The shim seeds UA session storage to bypass TokenGate and rewrites only these known requests:
  - `knowledge-graph.json`
  - `config.json`
  - `meta.json`
  - `domain-graph.json`
  - `diff-overlay.json`
  - `file-content.json`
- Rewritten API calls include the host surface-session header.
- Architecture/Full switching reloads the iframe. UA Store hot replacement is outside MVP.

## 9. API Contract

Browser API uses `projectId`:

| Method | Path | Purpose |
|---|---|---|
| GET | `/viewer` | Native plugin page |
| GET | `/frame?projectId&bundle` | Embedded UA frame |
| GET | `/api/projects` | Redacted project summaries |
| POST | `/api/projects` | Register a real project root |
| DELETE | `/api/projects/:projectId` | Remove registry entry, not source files |
| GET | `/api/status?projectId` | Dependencies, bundle state, current metadata |
| POST | `/api/build` | Start build; body `{projectId}` |
| GET | `/api/tasks/:taskId` | Task status and redacted log tail |
| POST | `/api/tasks/:taskId/cancel` | Cancel process tree |
| GET | `/api/architecture/providers` | List configured Hana chat models |
| GET | `/api/architecture?projectId` | Read draft/adoption/task state |
| POST | `/api/architecture/generate` | Start bounded generation, deterministic validation and independent LLM review |
| POST | `/api/architecture/review` | Retry independent review for the current validated draft |
| GET | `/api/architecture/tasks/:taskId` | Read generation/review state without prompt or credentials |
| POST | `/api/architecture/tasks/:taskId/cancel` | Abort the LLM request; short atomic commit states are not cancellable |
| POST | `/api/architecture/adopt` | Adopt only when draft SHA, review SHA and source build all match |
| GET | `/api/ua/:fileName?projectId&bundle` | Allowlisted UA JSON |
| GET | `/api/source?projectId&bundle&path` | Registered source snapshot only |

The Hana host authenticates plugin surface requests. Plugin routes enforce business authorization: registered project ID, allowed bundle enum, allowlisted data file and registered source-preview path.

## 10. MVP vs Phase 2

MVP:

- manual project registration;
- automatic cbm-project matching;
- deterministic build and auto promotion;
- profile overlay support;
- Full viewer for all indexed projects;
- Architecture viewer for projects with compatible overlay;
- source snapshot preview;
- Human Layout dist embedded through wrapper/fetch shim;
- four Agent tools: status, project, build, validate.

Implemented in 0.2.5:

- the control page projects generation, review, human adoption and immutable rebuild as a compact four-step workflow;
- one state-driven primary action advances the normal path, while regeneration and manual build controls remain available for recovery;
- the human confirmation action adopts the exact draft/review SHA pair first, then explicitly starts the existing independent build API;
- build-start failure preserves the adopted overlay and returns the primary action to rebuild; successful rebuild refreshes project state and opens Architecture only when the promoted bundle exists.

Implemented in 0.2.4:

- task responses expose monotonic `progress` values bound to real Architecture state transitions;
- generation checkpoints are 5/20/45/55/65/90/100 percent; review-only checkpoints are 10/25/90/100 percent;
- the control page renders the stage label, percentage and native progress element, and restores it from `activeTask` after refresh;
- no timer increments progress while waiting for Provider responses; failure and cancellation preserve the last reached checkpoint.

Implemented in 0.2.3:

- generation and review use linked Provider/model `<select>` controls as the primary workflow;
- Provider labels include the discovered chat-model count; selecting a Provider narrows its model selector;
- manual Provider/model entry remains available only behind an explicit per-role custom-ID toggle;
- routes and lifecycle import `architecture-generator-v2.js`, while the old path remains a compatibility re-export, avoiding the observed stale pre-review generator export; a full Hana restart remains mandatory because 0.412.7 may also cache transitive plugin modules.

Implemented in 0.2.2:

- manifest declares `provider.read` and `provider.credentials.read` for Hana chat model discovery and call-time credentials;
- provider discovery failures remain visible in the control page instead of becoming an indistinguishable empty selector;
- a complete manually entered pair may proceed to Hana credential validation even when discovery is unavailable.

Implemented in 0.2.1:

- AI-assisted overlay draft generation using Hana provider credentials;
- bounded context, response-size limit, timeout and cancellation;
- deterministic validation followed by an independently selectable reviewer model;
- grounded review report with verdict, confidence, findings, missing areas and path evidence;
- draft/report/source-build hash binding before human adoption;
- honest disabled Architecture state until a valid bundle exists.

Phase 2:

- persistent task history and interrupted-task recovery;
- per-bundle builds and cross-bundle deep links;
- scope-limited builds for graphs over 100,000 rows;
- TypeScript migration of cbm2ua;
- upstream Human Layout PR.

## 11. Quality Gates

- no edits outside `plugins/hana-code-atlas/`;
- Node tests cover registration, path/symlink attacks, task state, cancellation and atomic pointer promotion;
- Python tests cover Full output layout, Architecture output with overlay and source-preview metadata;
- host PluginManager discovers the page, route app and four tools;
- wrapper asset paths and fetch rewrites are deterministic and tested;
- real cbm project build reaches `completed` and current graph API returns JSON;
- browser acceptance verifies control page, Architecture/Full switch, Human Layout behavior, search and source preview;
- independent quality, security and visual reviews report no Blocking/High findings.

Implementation and acceptance evidence is maintained in `docs/VALIDATION.md`; future changes to host contracts, Viewer assets, build state, packaging or validation gates must update this design and that evidence record together.
