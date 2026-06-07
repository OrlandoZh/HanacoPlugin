# LLM Wiki Viewer

Hana plugin for an integrated `llm-wiki` skill. This v1.10 is a reliable helper and diagnostics console, not a full llm-wiki GUI.

## What It Does

- Builds `wiki/graph-data.json` and `wiki/knowledge-graph.html`.
- Serves the graph inside Hana and rewrites node source links to open local Markdown through plugin routes.
- Reports llm-wiki root status.
- Runs the mechanical lint report.
- Initializes a Chinese or English llm-wiki root.
- Runs source signal coverage and eligibility diagnostics.
- Reports read-only runtime context status for skill layout and optional adapter roots.
- Runs read-only diagnostics for wiki counts, source registry, and optional adapter state.
- Runs safety diagnostics for delete dry-run references, broken/orphan links, and graph `source_path` coverage.
- Provides source registry lookup/match helpers plus low-risk adapter/cache/Step 1 validation diagnostics for agents.
- Can hand knowledge-base generation, update, query, digest, maintenance, and crystallize tasks to a selected Hana Agent session through Hana's native `session:send` bus capability.
- Shows `purpose.md` and Mermaid graph status, plus read-only source image and source/cache contract diagnostics.
- Adds graph contract diagnostics that summarize graph-data, graph HTML, `source_path`, link, long-label, isolated-node, and source overlap signals.
- Adds maintenance diagnostics for orphan sources, missing `source_path`, broken raw files, duplicate titles, and `purpose.md` quality hints.
- Carries selected upstream graph HTML regression contracts into the plugin test suite.

Content-heavy workflows such as ingest, query, digest, delete, and crystallize remain agent/skill-led. The plugin provides script-backed or read-only tools and a lightweight console for those workflows to lean on.

The viewer's `Agent 工作流` panel does not call model providers directly. It reads Hana agents via `agent:list`, reads existing sessions via `session:list`, and sends a structured llm-wiki task prompt to the selected session via `session:send`. Current OpenHanako plugin bus support documents `session:send`, `session:abort`, `session:history`, `session:list`, and `agent:list`; session operations require an explicit existing `sessionPath`, so the plugin asks the user to choose a session instead of creating one implicitly.

Agent handoff prompts ask the selected Hana Agent to prioritize `purpose.md` and to tell the user to click `生成/刷新` after content changes. The plugin still does not perform content generation or maintenance writes itself.

Adapter diagnostics are visibility-only: the plugin does not install adapters, run upstream `install.sh` or `setup.sh`, repair dependencies, or perform automatic extraction.

`llm_wiki_init` is intentionally conservative: it only initializes a missing path or an empty directory. It returns `already_initialized` when `.wiki-schema.md` already exists and `target_not_empty` when the target contains unrelated files.

`llm_wiki_cache_status` is intentionally read-only. It mirrors the cache status calculation without invoking cache repair, update, or invalidate behavior.

## Tools

- `llm_wiki_status({ wikiRoot })`
- `llm_wiki_init({ wikiRoot, topic, language })`
- `llm_wiki_lint({ wikiRoot })`
- `llm_wiki_build_graph({ wikiRoot })`
- `llm_wiki_maintenance_diagnostics({ wikiRoot })`
- `llm_wiki_source_coverage({ wikiRoot })`
- `llm_wiki_source_signal_eligibility({ wikiRoot })`
- `llm_wiki_runtime_context_status({ wikiRoot })`
- `llm_wiki_source_image_diagnostics({ wikiRoot })`
- `llm_wiki_source_contract_diagnostics({ wikiRoot })`
- `llm_wiki_diagnostics({ wikiRoot })`
- `llm_wiki_source_registry({})`
- `llm_wiki_adapter_status({ sourceId })`
- `llm_wiki_delete_dry_run({ wikiRoot, sourceFile })`
- `llm_wiki_link_diagnostics({ wikiRoot })`
- `llm_wiki_graph_source_paths({ wikiRoot })`
- `llm_wiki_source_get({ sourceId })`
- `llm_wiki_source_match_url({ url })`
- `llm_wiki_source_match_file({ filePath })`
- `llm_wiki_adapter_classify({ sourceId, exitCode, outputPath })`
- `llm_wiki_cache_status({ wikiRoot, filePath })`
- `llm_wiki_validate_step1({ jsonFile })`

Each tool returns `content` plus a structured `details` object with `ok`, `wikiRoot`, `stdout`, `stderr`, `code`, `error`, and `status` where relevant.

In Hana's model-visible tool list these are prefixed by the plugin id, for example `llm-wiki-viewer_llm_wiki_status`. Plugin action calls and dev tool invocation still use the unprefixed action ids listed above.

## Page

The contributed page is `/viewer`. It keeps the graph as the main view and adds:

- wikiRoot input with saved-location dropdown
- explicit save-location action for first use and later switching
- status summary
- graph build/refresh
- lint output
- source coverage output
- source signal eligibility and runtime context summaries inside diagnostics output
- diagnostics output
- safety diagnostics and delete dry-run references
- graph contract diagnostics inside the diagnostics output
- source image and source/cache contract diagnostics
- maintenance diagnostics for orphan sources, duplicate titles, raw file issues, and `purpose.md` hints
- init controls
- Agent workflow handoff controls for existing Hana Agent sessions, with Chinese templates for adding sources, querying, deep organization, page updates, crystallization, and maintenance checks
- latest stdout/stderr log

## Configuration

`defaultWikiRoot` may point to an initialized llm-wiki root containing `.wiki-schema.md` and `wiki/`.

`savedWikiRoots` stores recently saved wiki roots for the viewer dropdown. On first use, enter or paste a wiki root path in the top location field and click `生成/刷新`; the plugin safely initializes missing or empty locations before building the graph. Successful init/build actions also save the current location.

This Hana integration does not run upstream `install.sh` or `setup.sh`. Optional URL extraction adapters should be handled by the skill/agent workflow or configured externally.

## Manual Acceptance

- Open `/viewer` in Hana with a real `wikiRoot`.
- Confirm first-use path entry can be saved and later selected from the top location dropdown.
- Confirm the `open-viewer` dev scenario opens the contributed page.
- Confirm all 22 `llm-wiki-viewer_llm_wiki_*` tools are discoverable by the Hana agent, including source signal eligibility, runtime context, maintenance diagnostics, source lookup/match, adapter classify, cache status, and Step 1 validation.
- Confirm `/api/diagnostics` reports wiki counts, source coverage summary, adapter summary, and graph contract summary.
- Confirm `/api/source-signal-eligibility` and `/api/runtime-context` report read-only source signal and skill layout diagnostics.
- Confirm `/api/maintenance-diagnostics` reports orphan sources, source_path/raw issues, duplicate titles, and `purpose.md` hints without mutating wiki content.
- Confirm `/api/link-diagnostics`, `/api/graph-source-paths`, and `/api/delete-dry-run` return readable safety diagnostics and never mutate wiki content.
- Confirm `/api/source-image-diagnostics` and `/api/source-contract-diagnostics` report read-only source issues.
- Confirm `/api/agents`, `/api/sessions`, and `/api/agent-send` can list Hana agents/sessions and hand a llm-wiki task to the chosen session.
- Confirm the plugin test suite includes selected upstream graph HTML contract checks and graph build failure handling.
- Confirm `purpose.md` and Mermaid graph status appear in the viewer status area.
- Confirm build refreshes the iframe graph and graph node source links open Markdown through `/wiki-file/*`.
- Confirm non-wiki roots disable build/lint/coverage and keep init available.
