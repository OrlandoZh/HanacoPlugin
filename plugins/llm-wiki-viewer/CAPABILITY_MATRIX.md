# LLM Wiki Viewer Capability Matrix

| Reference capability | Skill coverage | Plugin v1 coverage | Notes |
|---|---|---|---|
| init | Covered | Covered | Plugin wraps `init-wiki.sh`; English seed localization is handled after init. |
| ingest | Covered by agent workflow | Not pluginized | Agent-led because it requires extraction, privacy confirmation, and content synthesis. |
| batch-ingest | Covered by agent workflow | Not pluginized | Agent-led for the same reason as ingest. |
| query | Covered by agent workflow | Not pluginized | Requires reading and reasoning over wiki content. |
| digest | Covered by agent workflow | Not pluginized | Requires long-form synthesis. |
| lint | Covered | Covered | Plugin wraps `lint-runner.sh`. |
| source signal coverage | Covered | Covered in v1.1 | Plugin wraps `source-signal-coverage.js` and parses JSON output when available. |
| status | Covered by workflow instructions | Covered | Plugin reports root, schema, wiki, graph, cache, and skill state. |
| graph | Covered | Covered | Plugin builds and serves graph HTML inside Hana. |
| delete | Covered by helper/workflow | Not pluginized | Deferred; deletion needs user confirmation and cache/index handling. |
| crystallize | Covered by agent workflow | Not pluginized | Agent-led conversation synthesis. |
| optional URL adapters | Partially covered | Not pluginized | Plugin does not install or manage upstream optional adapters. |
| upstream regression tests | Present in reference | Minimal v1 tests | Plugin uses Node smoke tests plus script-backed fixture coverage. |
| upstream installer/docs assets | Reference only | Not copied | Hana integration avoids upstream installer execution. |
