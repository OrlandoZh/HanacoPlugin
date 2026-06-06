---
name: obsidian-wiki-manager
description: Manage and organize the user's Obsidian wiki/vault and LLM Wiki knowledge bases. Use when the user asks to save, record, write, search, read, restructure, tag, link, refactor, summarize, organize, query, initialize or ingest into a wiki, create Bases, create or interpret Canvas, generate a knowledge graph, or otherwise operate on their Obsidian knowledge base. Coordinates Obsidian CLI, Markdown, vault writing, Bases, Canvas reading/creation, LLM Wiki workflows, and the local Obsidian learning KB.
---

# Obsidian Wiki Manager

Hana entrypoint for Obsidian wiki and vault work. Use this as the single orchestration skill; load the original skills under `references/` only when their details are needed.

## Vault

- Vault name: configure this for your local Obsidian vault, for example `computer science`.
- Vault path: configure this for your local Obsidian vault, for example `~/Documents/computer science`.
- Prefer the `obsidian` CLI for vault operations when Obsidian is running.
- Use `silent` when creating notes unless the user asks to open them.
- Confirm before overwriting or bulk-editing existing notes.

## Intent Routing

Classify the user's request first, then load only the matching reference:

| Request | Primary reference |
|---|---|
| Save, record, write, append, add to knowledge base | `references/obsidian-vault-writer/SKILL.md` |
| Read/search/manage notes, tags, backlinks, tasks, properties, daily notes | `references/obsidian-cli/SKILL.md` |
| Format or edit Obsidian Markdown, wikilinks, frontmatter, tags, embeds, callouts | `references/obsidian-markdown/SKILL.md` |
| Create or edit `.base` database views | `references/obsidian-bases/SKILL.md` |
| Interpret an existing Canvas, extract tasks, infer structure or intent | `references/obsidian-canvas-reader/SKILL.md` |
| Create a polished Obsidian Canvas/mind map/spatial note | `references/obsidian-canvas-creator/SKILL.md` |
| Low-level `.canvas` node/edge/group JSON editing | `references/json-canvas/SKILL.md` |
| Query the local Obsidian learning KB snapshot | `references/obsidian-kb-query/SKILL.md` |
| Initialize an LLM Wiki, ingest sources, batch-ingest, query/digest, lint/status, crystallize, or build a knowledge graph | `references/llm-wiki/SKILL.md` |

## Workflow

1. Identify whether the task is query-only, write/edit, visual/canvas, Bases, or learning-KB lookup.
2. Load the smallest relevant reference file. Do not bulk-load all references.
3. For write/edit tasks, check whether the target note already exists when practical.
4. Use Obsidian-native syntax: wikilinks for internal links, frontmatter/properties for metadata, and stable tags.
5. For generated notes, include enough structure for later retrieval: title, date when useful, tags/status where appropriate, and links to related notes.
6. For LLM Wiki work, load `references/llm-wiki/SKILL.md` and use its scripts/templates from `references/llm-wiki/`; do not run its upstream installer.
7. For Canvas output, prefer `obsidian-canvas-creator`; use `json-canvas` only for low-level repairs or precise edits.
8. Report the changed file paths and the action taken.

## LLM Wiki Boundary

Use LLM Wiki for compiled knowledge-base workflows: `init`, `ingest`, `batch-ingest`, `query`, `digest`, `lint`, `status`, `graph`, `delete`, and `crystallize`.

Do not use LLM Wiki merely because the user says "save this note" or "format this Obsidian note"; those remain ordinary Obsidian vault operations.

The integrated upstream assets live at `references/llm-wiki/`:

- `SKILL.md`: workflow router and detailed procedures
- `scripts/`: init, cache, lint, source registry, graph data, and graph HTML helpers
- `templates/`: entity/topic/source/synthesis/query/schema and graph templates
- `deps/`: local browser assets for the graph HTML renderer

Do not execute `install.sh`; it is intentionally not part of this integration path. Optional URL adapters are only used when already available or when the user explicitly asks to configure them.

For graph viewing inside Hana, use the `llm-wiki-viewer` plugin when available; it builds `wiki/graph-data.json`, generates `wiki/knowledge-graph.html`, and serves it in a Hana page.

## Safety

- Do not invent vault content. Read/search before claiming a note exists.
- Do not overwrite existing notes without explicit confirmation.
- For broad reorganizations, propose a small batch plan and apply changes incrementally.
- If Obsidian CLI is unavailable or Obsidian is not running, fall back to direct filesystem reads/writes only when the requested operation is still safe and clear.
