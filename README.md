# HanacoPlugin

自用 OpenHanaco / Hana 扩展仓库，用来集中维护我创建和整理的 skills、plugins，以及它们依赖的可复用参考实现。

当前仓库重点收纳 Obsidian + LLM Wiki 工作流：

- `skills/obsidian-wiki-manager`：Obsidian wiki 总控 skill，统一调度 vault 写入、CLI 查询、Markdown、Canvas、Bases、LLM Wiki 初始化/ingest/query/graph 等能力。
- `plugins/llm-wiki-viewer`：Hana 插件，用于在 Hana 页面内生成和查看 LLM Wiki 交互式知识图谱。

## 目录结构

```text
HanacoPlugin/
├── skills/
│   └── obsidian-wiki-manager/
└── plugins/
    └── llm-wiki-viewer/
```

## 使用方式

安装到本机 OpenHanaco/Hana 时，可以把目录复制或同步到对应位置：

```bash
mkdir -p ~/.hanako/skills ~/.hanako/plugins
rsync -a skills/obsidian-wiki-manager/ ~/.hanako/skills/obsidian-wiki-manager/
rsync -a plugins/llm-wiki-viewer/ ~/.hanako/plugins/llm-wiki-viewer/
```

然后按自己的环境修改：

- `skills/obsidian-wiki-manager/SKILL.md` 里的 vault 名称与路径示例。
- `plugins/llm-wiki-viewer` 的配置项 `defaultWikiRoot`，或通过环境变量 `LLM_WIKI_DEFAULT_ROOT` 指向默认 wiki 根目录。
- 如 skill 不安装在 `~/.hanako/skills/obsidian-wiki-manager/references/llm-wiki`，可用环境变量 `LLM_WIKI_SKILL_ROOT` 指向 LLM Wiki 参考实现目录。

## 设计说明

`obsidian-wiki-manager` 是一个总控 skill：日常 Obsidian 写入、搜索、Canvas、Bases 等请求由它分流到对应 reference skill；当任务涉及 LLM Wiki 初始化、素材消化、查询、digest、lint、status 或图谱生成时，再进入 `references/llm-wiki`。

`llm-wiki-viewer` 不运行上游安装脚本。它调用已集成的 LLM Wiki graph 脚本生成：

- `wiki/graph-data.json`
- `wiki/knowledge-graph.html`

然后在 Hana 插件页面中托管并展示图谱。

## 开源项目致谢

本仓库基于多个开源项目和社区实现整理而来，感谢：

- [sdyckjq-lab/llm-wiki-skill](https://github.com/sdyckjq-lab/llm-wiki-skill)：LLM Wiki 方法论、脚本、模板和图谱生成主线。
- [Andrej Karpathy 的 llm-wiki 方法论](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)：知识库持续编译和维护思路来源。
- Obsidian 社区生态：CLI、Markdown、Canvas、Bases 等工作流参考。
- `baoyu-url-to-markdown`、`youtube-transcript` 等内容提取相关 skill / 工具。
- D3、Rough.js、Marked、DOMPurify：LLM Wiki 图谱页面使用的前端渲染与安全处理依赖。

这些项目让个人知识库可以从“保存材料”进一步变成“持续生长的可查询 wiki”。本仓库主要维护 OpenHanaco/Hana 侧的集成方式与个人工作流适配。
