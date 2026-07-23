# UA 原生管线与 cbm 适配层结构性差异分析

Status: Reviewed (NEEDS_REVISION → corrections applied)
Date: 2026-07-23
Applies to: adapter.py, enhance.py, UA Viewer 2.9.0, codebase-memory-mcp 0.9.0
Evidence: `docs/VALIDATION.md`, build `20260722T191139Z-b94737c0`
Reviewer: quality-reviewer (顾小准), 2026-07-23

## 1. 背景

Code Atlas 插件通过 `pipeline/adapter.py` 将 cbm (codebase-memory-mcp) 的知识图谱转换为 UA (Understand-Anything) 的 `knowledge-graph.json` 格式。UA 原生管线通过 LLM + AST 分析生成图谱，cbm 适配层通过 Cypher 查询 + 格式映射生成图谱。两者的 schema 差异导致 UA Viewer 部分 功能不可用或体验减损。

## 2. Schema 覆盖度

### 2.1 Node 类型

| 维度 | UA 原生 | cbm 适配 | 状态 |
|------|---------|---------|------|
| 类型总数 | 27 | 6 (function, class, module, file, endpoint, concept) | 差异 |
| 代码类型 | file, function, class, module, concept | ✓ 全覆盖 | 对齐 |
| 非代码类型 | config, document, service, table, endpoint, pipeline, schema, resource | 仅 endpoint | 部分覆盖 |
| 领域/知识/设计类型 | 13 种 | 无 | 不适用（cbm 是代码图谱工具，不产出领域/知识语义）|

### 2.2 Edge 类型

| 维度 | UA 原生 | cbm 适配 | 状态 |
|------|---------|---------|------|
| 类型总数 | 38 | 19 个 cbm 关系映射为 14 个 UA 类型 + 2 类本地投影 | 部分覆盖 |
| 结构边 | imports, exports, contains, inherits, implements | imports, contains, inherits | 部分覆盖 |
| 行为边 | calls, subscribes, publishes, middleware | calls, subscribes (LISTENS_ON), publishes (ASYNC_CALLS) | 部分覆盖 |
| 数据流边 | reads_from, writes_to, transforms, validates | writes_to + reads_from + transforms | 对齐 |
| 依赖边 | depends_on, tested_by, configures | tested_by (TESTS_FILE + 路径补充), configures | 部分覆盖 |
| 语义边 | related, similar_to | related (USAGE/SEMANTICALLY_RELATED), similar_to | 对齐 |

### 2.3 Node 属性

| 属性 | UA 原生 | cbm 适配 | 状态 |
|------|---------|---------|------|
| summary | LLM 生成语义摘要 | docstring 或 `"Type name"` 兜底 | **GAP** |
| tags | LLM 生成语义标签 | 仅 entry-point/exported/tested | **GAP** |
| complexity | LLM 判断 | cbm cyclomatic 映射 | 对齐 |
| lineRange | AST 精确定位 | cbm start_line/end_line | 对齐 |
| languageNotes | LLM 生成 | 缺失 | 次要 |
| domainMeta | LLM 领域分析 | 缺失 | 不适用 |
| knowledgeMeta | LLM 知识分析 | 缺失 | 不适用 |

## 3. 已修复的 gap（3 个）

### 3.1 file→file 边缺失
- **根因**: cbm 只有 function→function 边，UA Viewer 文件模式只显示 file 节点
- **修复**: `derive_file_level_edges()` 通过 contains 边构建 parent_file 映射，投影 8 种行为边到 file 级
- **验证**: 构建产物中 file→file 边 403 条（calls=133, writes_to=249, imports=2, related=19）

### 3.2 layer membership 混合类型
- **根因**: enhance.py 把所有节点类型放进 layer，导致文件模式显示 1000+ 节点
- **修复**: layer 分配限定 `type == "file"`，fallback 和 strict 检查同步调整
- **验证**: 构建产物中 15 个 layer 的 nodeIds 全部为 `file:` 前缀

### 3.3 容器匿名散点
- **根因**: 无 file→file 边 + 一个 layer 含 1000+ 混合节点 → Louvain 产出匿名 Cluster A/B/C
- **修复**: file→file 边投影 + overlay 拆分 + `derive_cluster_name_hints()` 注入
- **验证**: 用户确认容器间有连线

## 4. 待修复的 gap（5 个）

### 4.1 [高] summary 无语义 — 部分修复

**现状**: 大量节点 summary 为 `"Function xxx"` 兜底。构建产物中 grep 命中 100+ 条后截断，实际应有数千条。

**UA 原生**: `llm-analyzer.ts` 的 `buildFileAnalysisPrompt()` 对每个文件调用 LLM 生成 `fileSummary` 和 `functionSummaries`。

**cbm 适配**: `parse_node()` 中 docstring→summary 或 fallback `f"{label} {name}"`。

**审查修正**: ai4paper 项目的 overlay.json 根本没有 `nodeSummaries` 字段，`semantic-meta.json` 显示 `summaryMatches: []`。**这不是覆盖率问题，是未配置问题。**

**已修复**: fallback summary 现在使用 cbm 的 `signature` 和 `parent_class` 属性生成更有信息量的摘要。例如 `"function Model.save — save(): void"` 替代 `"Function save"`。docstring 仍优先，无 docstring 时走结构化 fallback。

**残留**: 语义摘要（如 "Saves model state to database"）仍需 LLM 或 overlay nodeSummaries 配置。结构化 fallback 是确定性的，对所有项目生效。

### 4.2 [高] tags 无语义 — 部分修复

**现状**: 标签仅有 `entry-point`、`exported`、`tested`。ai4paper 项目中 cbm 未检测到测试文件，因此实际只有前两种。

**UA 原生**: LLM 生成语义标签如 `["middleware", "api-handler"]`。

**已修复**: (1) tag 名称 `"test"` → `"tested"` bug 已修正；(2) `parse_node()` 现在从 `signature` 推导 `async`、`callback` 标签，从 `filePath` 推导 `api`、`ui`、`data`、`utility`、`test-file` 标签。

**残留**: 深层语义标签（如 `"middleware"`、`"auth-handler"`）仍需 LLM 或 overlay 配置。结构性标签是确定性的，对所有项目生效。

### 4.3 [中] imports 边极少 — 已修复（映射补全）

**现状**: 构建产物中 `imports` 类型边仅 5 条。

**审查修正**: `CONTAINS_FILE` 已映射到 `contains`，不是映射遺漏。真正原因是 cbm 数据层 IMPORTS 边稀缺。

**调查结论**: cbm 0.9.0 有完整的 IMPORTS 检测能力（BetterAddon 项目有 761 条 IMPORTS 边）。ai4paper 只有 5 条是因为该项目当时不在 cbm 索引中。重新索引后 IMPORTS 边应正常产出。**不需要独立做 import resolution。**

**已修复**: 扩展 `EDGE_TYPE_MAP`，新增 4 个映射：`INHERITS`→`inherits`、`SIMILAR_TO`→`similar_to`、`SEMANTICALLY_RELATED`→`related`、`DECORATES`→`configures`。`RAISES`/`THROWS`/`HAS_BRANCH` 不映射（UA 无对应类型）。

### 4.4 [中] tested_by 缺失 — 已修复

**现状**: 构建产物中 `tested_by` 边 0 条。

**UA 原生**: `merge-batch-graphs.py` 有完整的确定性 `tested_by` linker（两遍扫描：翻转 LLM 反向边 + 路径约定配对）。

**修复**: 原生消费 cbm 0.9.0 的 `TESTS_FILE`，并按真实端点语义把 cbm 的 `test → production` 反转为 UA 的 `production → test`。随后用 `derive_tested_by_edges()` 做确定性补充，支持 JS/TS (`.test.ts`/`.spec.ts`)、Go (`_test.go`)、Python (`test_*.py`/`*_test.py`)、Java/Kotlin (`*Test.java`/`*Tests.java`) 的同级文件、`__tests__/` 出栈和 `tests/` → `src/` 镜像树配对。

**联动完成**: (1) 原生关系优先，路径推断按最终 edge key 去重；(2) 所有最终 `tested_by` source 统一添加 `"tested"` tag；(3) BetterAddon 源码构建产出 1 条 `tested_by`，方向为 `src-ts/runtime/build-profile.ts → build-profile.test.ts`。

### 4.5 [低] tour 为空 — 已修复（半自动生成）

**现状**: 构建产物 `tour: []`，overlay.json 没有 `tour` 字段。

**已修复**: enhance.py 新增 `_auto_generate_tour()` 函数。当 overlay 未配置 tour 时，从 layer 结构自动生成 tour 骨架：按层序遍历，每层选 1 个代表文件（entry-point 优先 > 度数最高 > 首个文件），描述从 layer description + file summary 拼接。最多 10 步。Overlay 手动配置的 tour 优先。

### 4.6 [中] 事件订阅关系 — 已修复

**证据**: BetterAddon cbm 0.9.0 中 `LISTENS_ON` 的真实端点为 `File → Channel`，与 UA 的 `subscribes`（consumer → channel/context）方向一致。

**修复**: `LISTENS_ON`→`subscribes`，不反转端点，不修改 `Channel` 节点类型。BetterAddon 源码构建产出 4 条 `subscribes`。

## 5. 不建议修复的 gap

| gap | 理由 |
|-----|------|
| domainMeta / knowledgeMeta | UA 原生 graph-builder 也不产出，来自 LLM 的 domain/knowledge 分析模式。cbm 是代码图谱工具，不产出这些是合理的范围边界。|
| languageNotes | UA 原生通过 LLM 产出，属于增强信息，不影响导航和结构理解。投入产出比低。|
| frameworks 始终为空 | 影响小，可通过 overlay `project.frameworks` 覆盖。|
| `FILE_CHANGES_WITH` 直接映射为 `related` | 它是历史共变耦合，不是静态依赖；BetterAddon 样本大量集中在文档和审计证据文件，混入普通 `related` 会制造结构噪声。当前保留未映射警告。|
| 边权重统一 1.0 | UA 原生按类型区分（imports=0.7, calls=0.8, contains=1.0），但 UA Viewer 的聚合边 strokeWidth 由 count 决定，weight 仅影响边列表排序。影响极小。|

## 6. 修复优先级与依赖

```
✅ 4.2a tag "test"→"tested"       ← 已完成（一行修正）
✅ 4.4 tested_by linker            ← 已完成（含三路联动）
✅ 4.1 summary 结构化 fallback     ← 已完成（signature + parent_class）
✅ 4.2b tags 结构化推导            ← 已完成（async/api/ui/data/utility）
✅ 4.3 EDGE_TYPE_MAP 扩展          ← 已完成（INHERITS/SIMILAR_TO/SEMANTICALLY_RELATED/DECORATES）
✅ 4.5 tour 半自动生成             ← 已完成（layer 骨架 + 代表文件 + 描述拼接）
✅ 4.6 LISTENS_ON→subscribes        ← 已完成（真实端点验证）
□ 4.1 语义摘要（LLM/overlay）      ← 残留：需 LLM 或逐项目 overlay 配置
□ 4.2 语义标签（LLM/overlay）      ← 残留：同上
```

## 7. 审查记录

| 审查项 | 判定 | 修正 |
|--------|------|------|
| gap 1 (file→file) | CONFIRMED | 无 |
| gap 2 (layer membership) | CONFIRMED | 无 |
| gap 3 (容器散点) | CONFIRMED | 无 |
| gap 4.1 (summary) | CONFIRMED | 事实纠正：overlay 未配置，非覆盖率问题 |
| gap 4.2 (tags) | CONFIRMED | 遗漏发现：tag 名称 "test" vs "tested" 不匹配 bug |
| gap 4.3 (imports) | CONFIRMED | 因果纠正：cbm 数据层稀缺，非映射遗漏 |
| gap 4.4 (tested_by) | CONFIRMED | 联动要求：边 + tag + production tag 三路 |
| gap 4.5 (tour) | CONFIRMED | 无 |
| 不建议修复项 | CONFIRMED | 无 |

**总体审查结论**: NEEDS_REVISION → 修正后 APPROVED。分析可作为修复计划的可靠依据。
