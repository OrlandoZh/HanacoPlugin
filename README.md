# HanacoPlugin

自用 OpenHanako 扩展仓库，用来集中维护我创建和整理的 skills、plugins，以及它们依赖的可复用参考实现。

当前仓库重点收纳 Obsidian + LLM Wiki 工作流：

- `skills/obsidian-wiki-manager`：Obsidian wiki 总控 skill，统一调度 vault 写入、CLI 查询、Markdown、Canvas、Bases、LLM Wiki 初始化/ingest/query/graph 等能力。
- `plugins/llm-wiki-viewer`：OpenHanako 插件，用于在 OpenHanako 页面内生成和查看 LLM Wiki 交互式知识图谱。

## 目录结构

```text
HanacoPlugin/
├── skills/
│   └── obsidian-wiki-manager/
└── plugins/
    └── llm-wiki-viewer/
```

## 使用方式

安装到本机 OpenHanako 时，可以把目录复制或同步到对应位置：

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

`llm-wiki-viewer` 当前收口到 v1.14 只读预检与参考回归补齐版。它不运行上游安装脚本，也不把 ingest、query、digest、delete、crystallize 做成插件 GUI；这些内容生成工作流仍由 skill/agent 主导。插件侧只提供可验证的辅助能力：

- `wiki/graph-data.json`
- `wiki/knowledge-graph.html`
- wiki root 状态、lint、source coverage、source signal eligibility、runtime context、source registry、adapter status、diagnostics
- 删除预检、lint-fix 预览、source page 写入契约预检、链接诊断、graph `source_path` 诊断、graph contract 诊断、维护诊断、source registry get/match、adapter classify、cache status、Step 1 JSON validation
- `purpose.md`、Mermaid 图谱状态、source image、source/cache contract 等只读诊断
- Hana Agent 入口：列出 agent/session，并通过 `session:send` 把任务投递到已有会话
- 保守初始化：只初始化不存在路径或空目录，不覆盖已有资料

然后在 OpenHanako 插件页面中托管并展示图谱。

参考项目路径以仓库根目录的 `reference/llm-wiki-skill-main` 为准；插件测试会迁移其中对 Hana 集成有价值且无外部依赖的回归契约。

## v1.14 验收清单

- 在 `plugins/llm-wiki-viewer` 运行 `npm test`，要求 Node 内置测试全绿。
- 测试套件会在存在 `reference/openhanako-main` 时用 OpenHanako `PluginManager` 做宿主 loader smoke，验证 `/viewer` 和全部 Agent tools 可被发现。
- 在 Hana 里打开 `/viewer`，输入真实 wikiRoot 后确认状态、图谱 iframe、build、lint、source coverage、diagnostics、安全诊断、来源诊断和删除预检都可用。
- 确认 Agent 工具列表能发现 24 个 `llm-wiki-viewer_llm_wiki_*` tools，包括 lint-fix preview、source page contract preview、source signal eligibility、runtime context、maintenance diagnostics、source lookup/match、adapter classify、cache status 和 Step 1 validation。
- 确认 `/api/diagnostics` 包含 graph contract summary，并能看到 graph-data、HTML、source_path、断链、长标签、孤立节点和来源覆盖摘要。
- 确认 `/api/maintenance-diagnostics` 能只读报告孤儿来源、孤儿 raw、source_path/raw 问题、陈旧 cache、source frontmatter、缺来源信号、query/digest 索引缺口、重复标题和 `purpose.md` 提示。
- 确认 `/api/source-signal-eligibility` 与 `/api/runtime-context` 能只读报告来源信号可用性和 skill 布局状态。
- 确认 `/api/lint-fix-preview` 与 `/api/source-page-contract-preview` 只返回预检结果，不修改 wiki 内容。
- 确认 Agent 工作流只能投递到已有 Hana session；OpenHanako plugin bus 当前稳定公开的是 `agent:list`、`session:list`、`session:send` 等已有会话能力。
- 确认 Agent 投递输出包含任务类型、目标会话、接收状态、下一步提示和完整 Prompt；`复制 Prompt` 可用于 bus 忙或不可用时的手动兜底。
- 点击图谱节点时，`source_path` 应经 `/wiki-file/*` 打开对应 Markdown。

## 开源项目致谢

本仓库基于多个开源项目和社区实现整理而来，感谢：

- [liliMozi/openhanako](https://github.com/liliMozi/openhanako/releases)：提供 OpenHanako 的 skill、plugin、页面和工具调用运行环境，也是本仓库集成工作的主要宿主。
- [sdyckjq-lab/llm-wiki-skill](https://github.com/sdyckjq-lab/llm-wiki-skill)：LLM Wiki 方法论、脚本、模板和图谱生成主线。
- [Andrej Karpathy 的 llm-wiki 方法论](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)：知识库持续编译和维护思路来源。
- Obsidian 社区生态：CLI、Markdown、Canvas、Bases 等工作流参考。
- `baoyu-url-to-markdown`、`youtube-transcript` 等内容提取相关 skill / 工具。
- D3、Rough.js、Marked、DOMPurify：LLM Wiki 图谱页面使用的前端渲染与安全处理依赖。

这些项目让个人知识库可以从“保存材料”进一步变成“持续生长的可查询 wiki”。本仓库主要维护 OpenHanako 侧的集成方式与个人工作流适配。
