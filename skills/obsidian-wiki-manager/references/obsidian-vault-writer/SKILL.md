---
name: obsidian-vault-writer
description: >
  Write knowledge and information to Obsidian vault. Use when user EXPLICITLY
  requests to save, record, write, or store knowledge/notes/information in their
  Obsidian vault. Trigger phrases include "记录到笔记库", "保存到Obsidian",
  "写入笔记", "添加到我的知识库", "帮我记录这个", "记下来".
---

# Obsidian Vault Writer

Write knowledge and information to the user's Obsidian vault by orchestrating other Obsidian skills.

## Vault Path

Configure the vault path for your local environment before use, for example:

`~/Documents/computer science`

## Workflow

### Step 1: Understand the Content

Before writing, understand what the user wants to record:
- What is the main topic/subject?
- What format suits best? (note, canvas, daily note, etc.)
- What properties/metadata should be included?
- Where should it be stored? (folder, specific file)

### Step 2: Determine Storage Strategy

| Content Type | Best Approach |
|--------------|---------------|
| General knowledge/concepts | New note in appropriate folder |
| Quick capture/daily log | Append to daily note |
| Visual/relational content | Canvas file |
| Reference with metadata | Note with frontmatter properties |
| Web content | Use `defuddle` first, then save |

### Step 3: Invoke Appropriate Skills

This skill coordinates with:

1. **obsidian-cli** - For creating, reading, appending notes via CLI
   ```
   Use for: Creating notes, appending content, searching, daily notes, properties
   ```

2. **obsidian-markdown** - For proper Obsidian Markdown syntax
   ```
   Use for: Wikilinks, callouts, frontmatter, tags, embeds, formatting
   ```

3. **json-canvas** - For Canvas files (.canvas)
   ```
   Use for: Mind maps, flowcharts, visual canvases
   ```

4. **obsidian-bases** - For database views (.base)
   ```
   Use for: Creating filtered views of notes
   ```

5. **defuddle** - For web content extraction
   ```
   Use for: Converting web pages to clean markdown before saving
   ```

## Common Patterns

### Create a New Note

```bash
# Using obsidian-cli
obsidian vault="<your vault name>" create name="Note Name" content="# Title\n\nContent here." silent
```

### Append to Daily Note

```bash
obsidian vault="<your vault name>" daily:append content="## Topic\n\nContent here."
```

### Create Note with Properties

Use `obsidian-markdown` skill to format frontmatter, then save:

```markdown
---
title: Note Title
date: 2024-01-15
tags:
  - topic
  - category
---

# Note Title

Content with [[wikilinks]] and > [!note] callouts.
```

### Save Web Content

1. Use `defuddle` to extract clean content
2. Process and enhance with `obsidian-markdown`
3. Save using `obsidian-cli`

## Folder Structure Reference

Based on the vault structure:
- `000 开发项目/` - Development projects
- `001 常用工具/` - Common tools
- `assets/` - Images and attachments

Always ask which folder is appropriate if unclear.

## Best Practices

1. **Always use `silent` flag** when creating notes to prevent auto-opening
2. **Add meaningful frontmatter** for searchability (tags, date, status)
3. **Use wikilinks** `[[Note Name]]` to connect related notes
4. **Add callouts** for important information that needs highlighting
5. **Confirm with user** before overwriting existing files

## Example Usage

User: "帮我记录一下React Hooks的知识点"

Agent should:
1. Invoke `obsidian-markdown` skill to format content properly
2. Create note structure with appropriate frontmatter
3. Use `obsidian-cli` to create the note in appropriate folder
4. Confirm completion

```bash
obsidian create path="001 常用工具/React Hooks.md" content="---\ntitle: React Hooks\ntags:\n  - react\n  - frontend\ndate: $(date +%Y-%m-%d)\n---\n\n# React Hooks\n\n## useState\n\n..." silent
```
