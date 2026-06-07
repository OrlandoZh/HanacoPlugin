# LLM Wiki Viewer Capability Matrix

| Reference capability | Skill coverage | Plugin coverage | Notes |
|---|---|---|---|
| init | Covered | Covered | Plugin wraps `init-wiki.sh`; English seed localization is handled after init. |
| ingest | Covered by agent workflow | Not pluginized | Agent-led because it requires extraction, privacy confirmation, and content synthesis. |
| batch-ingest | Covered by agent workflow | Not pluginized | Agent-led for the same reason as ingest. |
| query | Covered by agent workflow | Not pluginized | Requires reading and reasoning over wiki content. |
| digest | Covered by agent workflow | Not pluginized | Requires long-form synthesis. |
| lint | Covered | Covered | Plugin wraps `lint-runner.sh`. |
| lint-fix | Covered | Preview since v1.11 | Plugin wraps `lint-fix.sh --dry-run`; actual fixes stay agent/skill-led. |
| source signal coverage | Covered | Covered in v1.1 | Plugin wraps `source-signal-coverage.js` and parses JSON output when available. |
| source signal eligibility | Covered | Covered in v1.10 | Plugin scans wiki page frontmatter and reports whether source signals are available for applicable page types. |
| runtime context status | Covered by shared scripts | Covered in v1.10 | Plugin reports skill layout, runtime-context script presence, and optional adapter root status read-only. |
| source registry | Covered | Covered in v1.2 | Plugin wraps `source-registry.sh list` and parses TSV into structured source definitions. |
| source registry get/match | Covered | Covered in v1.4 | Plugin wraps `get`, `match-url`, and `match-file` for agent diagnostics. |
| adapter status | Covered | Covered in v1.2 | Plugin wraps `adapter-state.sh summary-human` and `check`; it does not install or repair adapters. |
| adapter classify-run | Covered | Covered in v1.5 | Plugin wraps `adapter-state.sh classify-run` for result diagnosis only. |
| diagnostics | Covered by scripts/workflow | Covered in v1.2 | Plugin aggregates status, wiki counts, source coverage, registry counts, and adapter summary. |
| Agent context startup | Covered by SessionStart hook/workflow context | Covered in v1.13 | Plugin sends the current `wikiRoot`, `purpose.md`, `.wiki-schema.md`, and `index.md` context to an existing Hana session via `session:send`; it does not create sessions or run a background agent. |
| graph contract diagnostics | Covered by graph/lint expectations | Covered in v1.8 | Plugin summarizes graph-data, HTML, source_path, links, long labels, isolated nodes, and source overlap signals read-only. |
| maintenance diagnostics | Covered by workflow expectations | Covered in v1.9; expanded in v1.13 | Plugin checks orphan sources/raw files, missing `source_path`, broken raw files, stale cache entries, missing source signals, query/digest index gaps, duplicate titles, and `purpose.md` quality hints read-only. |
| purpose.md visibility | Covered | Covered in v1.7 | Plugin reports `purpose.md` status and includes a purpose summary in diagnostics. |
| status | Covered by workflow instructions | Covered | Plugin reports root, schema, wiki, graph, Mermaid graph, purpose, cache, and skill state. |
| graph | Covered | Covered | Plugin builds and serves graph HTML inside Hana. |
| Mermaid graph status | Covered | Covered in v1.7 | Plugin checks `wiki/knowledge-graph.md` existence but does not generate it. |
| delete | Covered by helper/workflow | Dry-run only in v1.3 | Plugin lists references via `delete-helper.sh scan-refs`; actual deletion stays agent/skill-led. |
| link diagnostics | Covered by workflow expectations | Covered in v1.3 | Plugin scans Markdown links for broken links, orphan pages, and duplicate titles. |
| graph source_path diagnostics | Covered by graph contract | Covered in v1.3 | Plugin checks graph-data nodes for missing or unopenable source paths. |
| source image diagnostics | Covered by lint/workflow expectations | Covered in v1.7 | Plugin checks `images` / `image_paths` consistency and missing local image assets. |
| source/cache contract diagnostics | Covered by cache/source contract | Covered in v1.7 | Plugin checks source `source_path`, raw files, and cache source_page links read-only. |
| create source page contract | Covered | Preview since v1.11 | Plugin validates raw/content/output/cache preconditions without writing source pages or updating cache. |
| cache check | Covered | Covered in v1.5 | Plugin performs a read-only cache status check; it does not repair, update, or invalidate cache entries. |
| validate Step 1 JSON | Covered | Covered in v1.5 | Plugin wraps `validate-step1.sh` for agent workflow preflight. |
| crystallize | Covered by agent workflow | Not pluginized | Agent-led conversation synthesis. |
| optional URL adapters | Partially covered | Diagnostic only | Plugin reports adapter state but does not install, repair, or run extraction adapters. |
| upstream regression tests | Present in reference | Expanded through v1.13 | Plugin uses Node smoke tests plus selected graph HTML, graph failure, source signal, preview, adapter, and validation regression contracts. |
| upstream installer/docs assets | Reference only | Not copied | Hana integration avoids upstream installer execution. |
