# Wiki Schema（知识库配置规范）

> 这个文件告诉 AI 如何维护你的知识库。你和 AI 可以一起调整它。

## 知识库信息

- 主题：{{TOPIC}}
- 创建日期：{{DATE}}
- 语言：{{LANGUAGE}}
- 版本：1.1

## 目录结构

```
{{WIKI_ROOT}}/
├── raw/                    # 原始素材（AI 只读，不会修改）
│   ├── articles/           # 网页文章
│   ├── tweets/             # X/Twitter 内容
│   ├── wechat/             # 微信公众号文章
│   ├── xiaohongshu/        # 小红书内容
│   ├── zhihu/              # 知乎内容
│   ├── pdfs/               # PDF 文件
│   ├── notes/              # 手写笔记
│   └── assets/             # 图片等附件
├── wiki/                   # 知识库主体（AI 写，你看）
│   ├── entities/           # 实体页（人物、组织、概念）
│   ├── topics/             # 主题页（研究主题、知识领域）
│   ├── sources/            # 素材摘要页（每个素材一篇摘要）
│   ├── comparisons/        # 对比分析页
│   └── synthesis/          # 综合分析页
├── index.md                # 内容索引（目录）
├── log.md                  # 操作日志（时间线）
└── .wiki-schema.md         # 本文件（配置规范）
```

## 页面命名规范

- 实体页：`wiki/entities/{名称}.md`
  - 例：`wiki/entities/知识构建.md`、`wiki/entities/Transformer.md`
- 主题页：`wiki/topics/{主题名}.md`
  - 例：`wiki/topics/AI编程工具.md`、`wiki/topics/大语言模型.md`
- 素材摘要：`wiki/sources/{日期}-{短标题}.md`
  - 例：`wiki/sources/2026-04-05-karpathy-llm-wiki.md`
- 对比分析：`wiki/comparisons/{对比主题}.md`
  - 例：`wiki/comparisons/工具选型.md`
- 综合分析：`wiki/synthesis/{分析主题}.md`
  - 例：`wiki/synthesis/AI工具选型建议.md`

## 交叉引用规范

- 页面间使用 `[[页面名]]` 语法（Obsidian 兼容的双向链接）
- 素材引用格式：`[来源: 素材标题](../sources/xxx.md)`
- 每个页面底部维护"相关页面"列表

## 页面格式规范

每个 wiki 页面应包含：

```markdown
---
tags: [标签1, 标签2]
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources: [关联素材列表]
# ── 生命周期（以下字段由 ingest/lint 自动维护，手动修改后下次 lint 会覆盖）──
confidence_score:    # null = 未评分；0.0-1.0 的浮点数
last_confirmed:      # null = 从未确认；YYYY-MM-DD
evidence_count: 0    # 支持此页内容的来源数量
contradicted_by: []  # 与本页矛盾的其他页面
supersedes: []       # 本页取代的旧页面（wikilink 列表）
superseded_by: null  # 取代本页的新页面（wikilink，null = 活跃）
retention_class:     # stable | active | fading | stale | archived
---

# 页面标题

> 一句话摘要

## 正文内容

...

## 相关页面

- [[另一个页面]]
- [[又一个页面]]
```

## Ingest（消化素材）规则

### 分级处理

根据素材长度和信息密度自动分级：

**完整处理**（素材 > 1000 字）：
1. 每个新素材**必须**生成摘要页（`wiki/sources/` 下）
2. 从素材中提取 3-5 个关键概念
3. 检查是否需要创建新的实体页（`wiki/entities/`）
4. 检查是否需要创建或更新主题页（`wiki/topics/`）
5. 更新 `index.md`（添加新条目）
6. 更新 `log.md`（记录操作）
7. 更新 `overview.md`（如果知识库全貌有变化）

**简化处理**（素材 < 1000 字，如短推文、小红书笔记）：
1. 生成摘要页（`wiki/sources/` 下）
2. 提取 1-3 个关键概念
3. 如果关键概念已有实体页，追加信息；如果没有，在摘要页中标记 `[待创建]`
4. 更新 `index.md` 和 `log.md`
5. 跳过主题页和 overview 更新

### 来源边界

这套边界和安装输出、状态说明、回归测试保持一致。

| 分类 | 当前来源 | 处理原则 |
|------|----------|----------|
| 核心主线 | `PDF / 本地 PDF`、`Markdown/文本/HTML`、`纯文本粘贴` | 不依赖外挂，直接进入主线 |
| 可选外挂 | `网页文章`、`X/Twitter`、`微信公众号`、`YouTube`、`知乎` | 先自动提取；失败时退回手动入口 |
| 手动入口 | `小红书` | 只接受用户手动粘贴 |

### 素材类型路由

| 来源 | raw 目录 | 提取方式 |
|------|----------|----------|
| 网页文章 | `raw/articles/` | baoyu-url-to-markdown skill |
| X/Twitter | `raw/tweets/` | baoyu-url-to-markdown skill（需 Chrome 登录） |
| 微信公众号 | `raw/wechat/` | wechat-article-to-markdown |
| YouTube | `raw/articles/` | youtube-transcript skill |
| 小红书 | `raw/xiaohongshu/` | 用户手动粘贴内容 |
| 知乎 | `raw/zhihu/` | 用户手动粘贴内容 或 baoyu-url-to-markdown skill |
| PDF / 本地 PDF | `raw/pdfs/` | 直接读取 |
| Markdown/文本/HTML | `raw/notes/` | 直接读取 |
| 纯文本粘贴 | `raw/notes/` | 直接使用 |

## 别名词表（Alias Table）

用于 query 和 digest 时自动展开搜索。搜索任意一个词，会同时搜索同一行的所有别名。
AI 在 ingest 时如果发现新的同义词关系，可以建议用户添加。

格式：每行一组同义词，用 `=` 分隔。

```
LLM = 大语言模型 = 大模型 = Large Language Model
RAG = 检索增强生成 = Retrieval Augmented Generation
fine-tuning = 微调 = 精调
prompt engineering = 提示工程 = 提示词工程
```

维护原则：
- 只收录在你的知识库里**实际出现过**的同义词，不要预填一堆用不到的
- 每组控制在 5 个以内，太多说明概念本身需要拆分
- 中英文混用时把最常用的放第一个
- ingest 发现新的同义词关系时，AI 应主动建议添加到此表

## Query（查询）规则

1. 先读 `index.md`，定位相关条目
2. 用 Grep 在 `wiki/` 下搜索关键词
3. 阅读相关页面后综合回答
4. 回答中标注来源页面（引用链接）
5. 有价值的分析建议保存为新的 wiki 页面

## Lint（健康检查）规则

1. 检查范围：随机抽查 10 个页面 + 最近更新的 10 个页面
2. 检查项：
   - 页面间矛盾（不同页面说法不一致）
   - 孤立页面（没有其他页面链接到它）
   - 缺失概念页（被 `[[某概念]]` 链接但实际不存在）
   - 缺少交叉引用（相关页面之间没有互相链接）
   - index 一致性（index.md 记录与实际文件是否对应）
3. 输出中文报告，对每个问题给出修复建议
4. 如果发现问题，询问用户是否自动修复

## 关系类型词汇表

这张表定义图谱中可用的关系类型。ingest 时 Step 1 JSON 的 `connections[].type` 会被持久化到页面，
build-graph-data.sh 会解析这些注释生成带类型的图谱边。

| 类型关键词 | 含义 | HTML 注释写法 |
|-----------|------|-------------|
| 实现       | A 是 B 的具体实现 | `<!-- relation: 实现 -->` |
| 依赖       | A 依赖 B 才能工作 | `<!-- relation: 依赖 -->` |
| 对比       | A 与 B 是同类可以比较 | `<!-- relation: 对比 -->` |
| 矛盾       | A 与 B 存在观点冲突 | `<!-- relation: 矛盾 -->` |
| 衍生       | A 从 B 演化而来 | `<!-- relation: 衍生 -->` |
| 取代       | A 取代了过时的 B | `<!-- relation: 取代 -->` |

### 关系标注格式

在 `## 相关页面` 区域，把关系注释和 wikilink 放在同一行：

```markdown
## 相关页面

<!-- relation: 实现 --><!-- confidence: INFERRED --> [[Zotero]]
<!-- relation: 对比 --><!-- confidence: EXTRACTED --> [[Obsidian]]
- [[其他页面]]
```

规则：
- 只给最重要的关系打标，不确定的保持普通 wikilink（默认 EXTRACTED）
- `<!-- relation: TYPE -->` 和 `<!-- confidence: LEVEL -->` 可以同时出现在一行
- 如果同一行有多个 wikilink，注释应用于该行所有 wikilink
- 普通的 `[[页面名]]` 不带注释时，默认 type=EXTRACTED

## 生命周期规则

### 置信度评分映射

Step 1 JSON 的 confidence 标注映射到 frontmatter 的 `confidence_score`：

| confidence 标注 | confidence_score | 含义 |
|----------------|-----------------|------|
| EXTRACTED | 0.70 | 从原文直接提取，字面可找到 |
| INFERRED | 0.50 | 从多处原文推断得出 |
| AMBIGUOUS | 0.30 | 原文说法不清晰或有歧义 |
| UNVERIFIED | 0.20 | 来自背景知识，原文无证据 |
| VERIFIED | 0.90 | 人工确认过的内容 |

### Retention Class 计算规则

lint 时自动计算（手动设置的值会被覆盖，除非设为 `archived`）：

| 条件 | retention_class | 含义 |
|------|----------------|------|
| superseded_by 非空 | archived | 已被取代 |
| confidence_score ≥ 0.7 且 last_confirmed < 180天 | stable | 高置信，近期确认 |
| confidence_score ≥ 0.5 且 last_confirmed < 90天 | active | 中等置信，活跃 |
> 按从上到下顺序匹配，首个命中条件生效；更严重的状态排列在前。

| last_confirmed > 365天 或 confidence_score < 0.3 | stale | 已过时，建议归档或更新 |
| last_confirmed > 180天 或 confidence_score < 0.5 | fading | 开始过时，需要复核 |

### Supersession 规则

当新信息覆盖或否定旧信息时：
1. 在旧页面 frontmatter 设置 `superseded_by: [[新页面名]]`
2. 在新页面 frontmatter 的 `supersedes: []` 列表里加入旧页面
3. 旧页面的 `retention_class` 自动变为 `archived`
4. 如果是矛盾而非完全取代，使用 `contradicted_by` 而非 `superseded_by`
5. Supersession 链不应超过 3 层；超过时考虑合并

### Ingest 生命周期写入规则

ingest 时对每个新建或更新的页面：
1. 从 Step 1 JSON 的 entities/topics/connections 提取 confidence 标注
2. 映射到 `confidence_score`（见映射表）
3. 设置 `last_confirmed` 为当前日期
4. 设置 `evidence_count` 为 Step 1 JSON 中支持此页的来源数
5. 检查 `contradictions` 字段，如果有矛盾，填充 `contradicted_by`
6. 从 Step 1 JSON 的 `connections[].type` 提取关系类型，用 `<!-- relation: TYPE -->` 注释写入相关页面区域
7. 对已有页面更新时：如果新信息与新于已有信息且内容有变更，递增 `evidence_count` 并更新 `last_confirmed`

### Lint 生命周期检查项

lint 时额外检查：
- `confidence_score` 为 null 的页面（未评分）
- `confidence_score < 0.5` 的页面（低置信度，需复核）
- `last_confirmed` 超过 180 天的页面（可能过时）
- `contradicted_by` 非空但未设置 `superseded_by` 的页面（矛盾未解决）
- `superseded_by` 非空但 `retention_class` 不是 `archived` 的页面（状态不一致）
- `evidence_count = 0` 的页面（无证据支撑）
- 输出 retention class 分布统计
