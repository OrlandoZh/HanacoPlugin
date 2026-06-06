# LLM Wiki Viewer

Hana plugin for an integrated `llm-wiki` skill. This v1 is a reliable helper console, not a full llm-wiki GUI.

## What It Does

- Builds `wiki/graph-data.json` and `wiki/knowledge-graph.html`.
- Serves the graph inside Hana and rewrites node source links to open local Markdown through plugin routes.
- Reports llm-wiki root status.
- Runs the mechanical lint report.
- Initializes a Chinese or English llm-wiki root.
- Runs source signal coverage diagnostics.

Content-heavy workflows such as ingest, query, digest, delete, and crystallize remain agent/skill-led. The plugin provides script-backed tools and a lightweight console for those workflows to lean on.

`llm_wiki_init` is intentionally conservative: it only initializes a missing path or an empty directory. It returns `already_initialized` when `.wiki-schema.md` already exists and `target_not_empty` when the target contains unrelated files.

## Tools

- `llm_wiki_status({ wikiRoot })`
- `llm_wiki_init({ wikiRoot, topic, language })`
- `llm_wiki_lint({ wikiRoot })`
- `llm_wiki_build_graph({ wikiRoot })`
- `llm_wiki_source_coverage({ wikiRoot })`

Each tool returns `content` plus a structured `details` object with `ok`, `wikiRoot`, `stdout`, `stderr`, `code`, `error`, and `status` where relevant.

In Hana's model-visible tool list these are prefixed by the plugin id, for example `llm-wiki-viewer_llm_wiki_status`. Plugin action calls and dev tool invocation still use the unprefixed action ids listed above.

## Page

The contributed page is `/viewer`. It keeps the graph as the main view and adds:

- wikiRoot input
- status summary
- graph build/refresh
- lint output
- source coverage output
- init controls
- latest stdout/stderr log

## Configuration

`defaultWikiRoot` may point to an initialized llm-wiki root containing `.wiki-schema.md` and `wiki/`.

This Hana integration does not run upstream `install.sh` or `setup.sh`. Optional URL extraction adapters should be handled by the skill/agent workflow or configured externally.

## Manual Acceptance

- Open `/viewer` in Hana with a real `wikiRoot`.
- Confirm the `open-viewer` dev scenario opens the contributed page.
- Confirm `llm-wiki-viewer_llm_wiki_status`, `llm-wiki-viewer_llm_wiki_init`, `llm-wiki-viewer_llm_wiki_lint`, `llm-wiki-viewer_llm_wiki_build_graph`, and `llm-wiki-viewer_llm_wiki_source_coverage` are discoverable by the Hana agent.
- Confirm build refreshes the iframe graph and graph node source links open Markdown through `/wiki-file/*`.
- Confirm non-wiki roots disable build/lint/coverage and keep init available.
