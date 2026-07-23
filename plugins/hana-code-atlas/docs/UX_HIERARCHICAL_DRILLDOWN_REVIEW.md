# UA 层级下钻与懒加载可读性评估

Status: Reviewed; documentation findings resolved
Date: 2026-07-22
Applies to: `hana-code-atlas` 0.2.5, Understand Anything Viewer 2.9.0 + locked Human Layout patch
Evidence status: Upstream behavior and local patch baseline confirmed; current integration failure mode not yet root-caused
Execution status: Gate A PASS; Gate B PASS (static/runtime-contract evidence); Gate C PARTIAL (isolated browser lacked real Hana plugin surface session); Gate D PARTIAL (error forwarding verified, Stage 2 failure retention/retry not yet proven)
Review: `quality-reviewer`; 0 blocking after resolving 2 medium and 3 low/info documentation findings

## 1. 结论

当前不应新增两个或更多用户可见模式，例如：

```text
Architecture | Domain | Layer | Focus | Full
```

Understand Anything 上游已经实现了针对大图的层级导航、容器聚合、懒展开、聚合边和 Focus mode。当前优先级不是另造 Domain/Layer/Focus 投影体系，而是验证并修复插件对上游 hierarchical drill-down 的接入和实际视觉呈现。

用户截图显示的现象是：进入层级后出现多个缺少名称、数量和连接关系的浅色矩形块。该现象在人类视角下不可读，不能视为有效的渐进披露。截图是否属于 Stage 1、Stage 2 加载中间态，或是 flat-layout 分支、样式/资源加载异常，仍需通过运行时证据确认。

当前应采用的产品底线：

```text
Architecture 总览
  -> 可读的 layer/container 聚合
     -> 按需展开内部节点
        -> Focus / 源码 / 完整证据
```

Full 继续保留为事实源、搜索、Path Finder、影响分析和源码定位入口，但不应承担默认的人类浏览入口。

## 2. 当前事实

### 2.1 插件当前的 Full 图规模

一次当前 live build 的 ai4paper Full 图证据：

```text
nodes: 5,884
edges: 20,159
layers: 6
```

层规模：

```text
核心引擎: 1,064
AI 智能: 558
翻译引擎: 228
MCP 服务器: 82
用户界面: 863
工程基础: 3,089
```

这说明 Full 图的层级信息是存在的，但如果直接将层内全部节点平铺，仍会产生严重认知过载。

### 2.2 当前锁定的 UA 资源

插件锁定 Understand Anything Viewer 2.9.0：

```text
upstream: https://github.com/Egonex-AI/Understand-Anything
version: 2.9.0
tag: v2.9.0
commit: f08763d11d0202a8a8f52b5dedda6d1b2e2ebac8
```

本地锁定基线不是 vanilla v2.9.0，而是 **v2.9.0 + Human Layout patch**。`third_party/understand-anything/UPSTREAM.json` 记录：

```text
upstream commit: f08763d11d0202a8a8f52b5dedda6d1b2e2ebac8
human-layout.patch sha256: 4db4e22a717126cc16169c8af9f0b63e0d3da8fb846d8356019c3ba2a2fbdc58
asset set sha256: ed1318e82bf4e9b9dc2a9086c2826b8e536201296259d6285c25f5270e1f020e
```

锁定 patch 会影响本问题相关的行为：

- 对小于等于 20 个可见节点的 layer 走 compact/flat-layout 分支，不一定生成容器；
- `ContainerNode` 的颜色、背景和焦点样式由 patch 覆盖；
- ELK 布局在小图上使用紧凑配置。

在 patch 源码和构建产物之间必须区分验证方法。构建产物已压缩，不能仅凭源码标识符是否存在判断运行时状态。

上游层级导航相关实现包括：

```text
expandedContainers
containerLayoutCache
drillIntoLayer
layer-detail
breadcrumb
```

因此当前资源并不是只有一张全量平铺图，但必须同时确认 patch 已应用到实际 `assets/ua/viewer` asset set。

## 3. 上游已经提供的解决策略

### 3.1 两级层级导航

上游 PR #44 已将原来的 flat all-nodes-at-once view 改为：

```text
Overview
  -> Layer detail
     -> Focus mode
```

Overview：

- layer 作为聚合节点显示；
- layer 间边聚合并显示计数；
- 点击 layer 进入详情；
- 提供面包屑和返回路径。

Layer detail：

- 显示选定 layer 内的文件节点；
- 通过 portal 节点表达跨层连接；
- 点击 portal 可跳转到其他 layer。

Focus mode：

- 隔离选中节点的一跳邻域；
- 通过边高亮和无关节点淡化减少视觉干扰。

### 3.2 v2.5.0 的容器懒布局

上游 v2.5.0 在 PR #111 中进一步处理大 layer：

- 按目录或社区聚类生成 container；
- Stage 1 只布局 container atom；
- Stage 2 在点击、搜索命中、focus 或放大后懒展开容器内部；
- 跨 container 边聚合为带数量的边；
- 容器展开后恢复内部文件边；
- 容器显示名称和 child count；
- 搜索、diff、focus 状态会在容器上显示视觉标记；
- 容器是可键盘操作的 disclosure button。

上游公开的设计意图是：

```text
可读容器 + 聚合关系
  -> 用户决定是否展开
     -> 展开后显示真实文件和关系
```

不是：

```text
空白占位矩形
  -> 用户无法判断内容和关系
```

### 3.3 当前版本的容器策略

v2.9.0 的 `deriveContainers()` 使用以下策略：

1. 优先按文件路径的第一分歧目录分组；
2. 目录分组过少或某一组占比过高时，回退到 Louvain community；
3. 单节点容器通常被抑制，避免产生无意义的单块；
4. 容器带有 `name`、`nodeIds` 和 `strategy`；
5. Stage 1 由容器 atom 和聚合边组成；
6. Stage 2 按需渲染内部节点。

## 4. 截图问题的用户体验判断

用户提供的截图显示：

- 画布中有多个零散的浅色矩形块；
- 矩形块缺少可辨认的名称和数量；
- 节点之间看不到有意义的关系线；
- 除顶部路径外，用户无法判断当前层内部如何组织。

### 4.1 已确认的判断

该状态不满足可读的渐进披露底线：

1. 容器必须表达自身语义；
2. 容器必须表达规模；
3. 容器间必须保留聚合关系；
4. 加载失败时必须有明确错误和重试入口；
5. 不应把空白占位态长期暴露为最终状态。

### 4.2 尚未确认的根因

不能仅凭截图断言具体根因。待验证假设包括：

- ContainerNode 未被正确注册或渲染；
- container 的 `name` / `childCount` 没有进入实际数据；
- Stage 1 聚合边未进入 React Flow；
- iframe wrapper 或 fetch shim 破坏了 Viewer 的初始状态；
- 正在显示加载中的节点，但加载状态没有被清晰标记；
- 上游资源、数据 schema 或当前 bundle 与预期不匹配；
- Viewer 已进入 layer-detail，但当前 layer 的数据规模或节点类型触发了未覆盖的布局分支。

后续实现前必须用浏览器 DOM、控制台错误、Network 请求和实际 `knowledge-graph.json` 对这些假设做可证伪验证。

## 5. 不应立即做的事

在根因确认前，不做以下扩张：

- 不增加 `Domain`、`Layer`、`Focus` 三个新的顶层模式；
- 不重新实现目录聚类、Louvain、ELK 容器布局；
- 不新增与 UA Viewer 重复的独立投影图谱体系；
- 不把 Full 图删除或永久裁剪；
- 不把“缩小节点”“只做虚拟化”当作认知问题的解决方案；
- 不把当前截图直接写成“上游 bug”，因为当前是插件集成上下文中的观察。

## 6. 修复目标

Layer detail 的 Stage 1 必须满足：

```text
加载中:
  显示容器名称、子节点数量、聚合边
  显示明确的布局/展开状态

加载完成:
  显示真实节点和关系

加载失败:
  保留容器语义
  显示错误信息
  提供重试

禁止:
  空白矩形长期存在
  没有名称的容器成为最终视觉结果
  没有关系线的散点块被误认为架构图
```

建议的可读容器信息至少包括：

```text
容器名称
包含文件数 / 节点数
主要节点类型或职责
跨容器关系数量
当前状态：未展开 / 展开中 / 已展开 / 失败
```

## 7. 验证顺序

### Gate A：确认当前加载的 bundle 和 Viewer 版本

- 确认当前打开的是 Full structural graph，而不是错误 bundle；
- 确认 Viewer 资源为锁定的 v2.9.0 + Human Layout patch，而不是 vanilla v2.9.0；
- 确认 `layers[]` 的 nodeIds 完整覆盖 nodes[]；
- 确认每个当前 layer 的 nodeIds 能在 nodes[] 中解析。

### Gate B：确认 Stage 1 数据

在浏览器和构建产物中验证：

- 先读取当前 layer 的可见节点数量：若数量小于等于 20，应按 Human Layout patch 预期允许 containers 为空并检查 compact/flat-layout 分支；若超过该阈值，再验证容器推导结果非空；
- 每个 container 有 name 和 nodeIds；
- Stage 1 的聚合边结果非空；在当前构建产物中优先通过 React Flow edge 集合、边计数标签或 `agg-*` 边 id 验证，不假设插件源码中存在名为 `aggregateContainerEdges()` 的函数；
- 在适用的容器分支中确认 `ContainerNode` 的名称、childCount 和状态实际进入 DOM；
- 在适用的容器分支中确认 Stage 1 节点没有被错误当成普通 custom node。

### Gate C：确认视觉渲染

- ContainerNode 的名称和 childCount 出现在 DOM；
- 聚合边出现在 React Flow edge 集合；
- 容器展开前后都有可读状态；
- Stage 2 延迟或失败不会清空 Stage 1 容器；
- 浏览器控制台无布局异常或未处理 Promise rejection。

### Gate D：确认失败降级

- Stage 2 失败时保留 Stage 1 容器；
- 容器显示“内部节点加载失败”和重试入口；
- 不能把失败状态表现成空白矩形；
- 必要时退回 Architecture 总览。
- 如果 vanilla v2.9.0 与 v2.9.0 + Human Layout patch 的行为不同，保留两者的对照结果；确认 patch 为问题源时，临时回退到已验证的 vanilla asset set 或先修复/重打 patch，不直接调整事实图数据。

## 8. 推荐实施边界

### 第一阶段：修复现有上游能力的接入

只改插件集成层和验证基线，优先检查：

- `routes/viewer.js` 的 frame wrapper 和 fetch shim；
- `assets/ua/hana-overlay.js` 的运行时覆盖；
- 当前 frame 的 bundle、sessionStorage 和初始导航状态；
- 真实 Full graph 的 layers/nodes/edges 契约；
- 浏览器中 Stage 1/Stage 2 的状态转换。

不改变 Full/Architecture 事实管线，不新建 Domain/Layer bundle。Human Layout patch 仍是锁定 Viewer 构建的一部分；如需修复 patch 行为，必须重新生成 asset manifest、更新 SHA 并完成 vanilla 对照验证。

### 第二阶段：只在上游能力确实不足时补宿主层

只有在以下证据成立时，才考虑增加宿主侧投影：

- 当前 v2.9.0 的 hierarchical drill-down 已正确接入；
- ContainerNode 和聚合边正常工作；
- 但某类超大 layer 仍无法保持可读；
- 上游标准 schema 无法表达需要的截断计数或摘要信息。

即使需要补充，也优先增加一个“查看此处”动作，不暴露多个新模式。

## 9. 与上游能力的边界

| 能力 | 上游已有 | 插件当前责任 |
|---|---:|---:|
| Overview → Layer detail | 是 | 正确提供 layers 数据和初始状态 |
| Folder/community containers | 是 | 不破坏容器数据和渲染 |
| Lazy two-stage layout | 是 | 保留 Stage 1，不泄漏空白失败态 |
| Aggregated container edges | 是 | 确认 graph/React Flow 边没有被 wrapper 丢失 |
| Focus mode | 是 | 确认选中节点和一跳邻域状态可用 |
| Architecture macro overview | 插件已有 | 作为上游 structural view 的入口补充 |
| LLM semantic overlay | 插件已有 | 不与上游容器导航重复 |
| Full factual graph | 插件已有 | 事实源和精确检索入口 |

## 10. 结论

当前执行证据尚未证明截图中的具体根因。隔离浏览器加载 `/frame` 时因缺少真实 Hana `pluginSurfaceSession` 得到 `Missing or invalid project metadata`，该结果属于验证环境限制，不能作为用户截图根因。现有 `viewer-wrapper.test.js` 的 65 项断言通过，证明 wrapper 的静态契约和 asset manifest 没有回归，但仍缺少真实宿主 session 下的 DOM/React Flow 证据。

上游已经正面处理了大图的人类可读性问题，策略不是缩小节点，而是：

```text
层级导航 + 容器聚合 + 聚合边 + 懒展开 + Focus mode
```

当前截图表明，插件实际呈现出的懒加载中间态没有达到这个设计目标。正确的下一步是：

> 先修复并验证 UA v2.9.0 hierarchical drill-down 在 Hana wrapper 中的真实表现；不要因为当前中间态不可读，就立即增加两种新的用户模式。

Full 负责完整事实，Architecture 负责宏观方向，UA 原生 Layer detail 负责层内理解，Focus 负责定向追查。若这些边界全部正常，当前不需要新增模式。

## 11. Sources

- Locked local upstream metadata: `third_party/understand-anything/UPSTREAM.json`
- Upstream v2.5.0 release: `https://github.com/Egonex-AI/Understand-Anything/releases/tag/v2.5.0`
- Upstream hierarchical navigation PR #44: `https://github.com/Egonex-AI/Understand-Anything/pull/44`
- Upstream graph layout scaling PR #111: `https://github.com/Egonex-AI/Understand-Anything/pull/111`
- Upstream v2.9.0 release: `https://github.com/Egonex-AI/Understand-Anything/releases/tag/v2.9.0`
- User visual evidence: attached `粘贴图片.jpg` in the review session; screenshot observation is treated as acceptance evidence, not root-cause proof.
- Review limitation: external GitHub PR/release pages were used for design context but were not independently cloned and rebuilt in this review; local `UPSTREAM.json`, patch SHA and locked asset manifest remain the reproducibility baseline.
- Execution limitation: user-Chrome remote debugging was unavailable and the isolated browser could not inherit a real Hana plugin surface session; Gate C/D require a real Hana-hosted browser run before any source fix is authorized.
