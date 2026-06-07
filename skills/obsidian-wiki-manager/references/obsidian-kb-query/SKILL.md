---
name: obsidian-kb-query
description: >
  Query the local Obsidian learning knowledge-base snapshot. Use only when the
  user explicitly asks to query the Obsidian knowledge base, Obsidian learned
  content, Obsidian knowledge highlights, or similar stored Obsidian learning
  material.
---

# Obsidian KB Query

Obsidian 知识库查询技能。仅在用户明确要求查询 Obsidian 知识库时激活，检索已积累的 Obsidian 使用知识。

## Description

查询 Obsidian 专题知识库快照中的已积累知识。默认建议放在 `~/.hanako/knowledge/hanaagent-learning-kb/obsidian/obsidian-learning.md`，也可以按自己的 Hana/OpenHanaco 目录结构调整。**触发条件**：用户明确提到"Obsidian 知识库"、"查询 Obsidian 知识"、"Obsidian 已学内容"、"Obsidian 知识精华"等关键词。**不触发**：仅提到 Obsidian 本身或一般性问题不触发，需明确指向知识库查询意图。

## Instructions

### 执行步骤

1. 读取知识库文件：`~/.hanako/knowledge/hanaagent-learning-kb/obsidian/obsidian-learning.md`，或你在本机配置的等效路径
2. 优先读取以下章节：
   - `## Agent 快速读取说明`
   - `## 已读文章` - 确认已学习的内容
   - `## 知识精华` - 提取核心知识
   - `## 技术日志` - 查看已知问题
3. 基于知识库内容回答用户问题
4. 如果知识库中没有相关信息，可补充说明

### 知识库结构

```
~/.hanako/knowledge/hanaagent-learning-kb/obsidian/obsidian-learning.md
├── Agent 快速读取说明
├── 已读文章
├── 最近学习简报
├── 知识精华
│   ├── Vault 结构设计
│   ├── 双链、标签、属性与检索
│   ├── Daily Notes 与模板
│   ├── Tasks / Dataview / Bases
│   ├── 同步与移动端
│   ├── 插件兼容与性能优化
│   ├── 知识管理工作流
│   └── 常见报错与排障
├── 技术日志
└── 复习整合笔记
```

### 注意事项

- 这是迁入 HanaAgent 的知识库快照；不要假设它会自动增量更新
- 如发现知识库信息过时或不完整，可建议用户在 HanaAgent 中建立新的更新流程
- 不要在知识库内容之外编造 Obsidian 相关信息
