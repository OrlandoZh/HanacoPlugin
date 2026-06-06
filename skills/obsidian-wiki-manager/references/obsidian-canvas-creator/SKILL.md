---
name: obsidian-canvas-creator
description: Create Obsidian Canvas files from text content, supporting both MindMap and freeform layouts. Use this skill when users want to visualize content as an interactive canvas, create mind maps, or organize information spatially in Obsidian format.
license: MIT
compatibility: opencode
metadata:
  version: 1.6.0
  source_repo: axtonliu/axton-obsidian-visual-skills
---

# Obsidian Canvas Creator

Transform text content into structured Obsidian Canvas files with support for MindMap and freeform layouts.

## When to Use This Skill

- User requests to create a canvas, mind map, or visual diagram from text
- User wants to organize information spatially
- User mentions "Obsidian Canvas" or similar visualization tools
- Converting structured content (articles, notes, outlines) into visual format

## Core Workflow

### 1. Analyze Content

Read and understand the input content:
- Identify main topics and hierarchical relationships
- Extract key points, facts, and supporting details
- Note any existing structure (headings, lists, sections)

### 2. Determine Layout Type

Ask user to choose or infer from context. If the context already makes the best layout obvious, infer it directly:

**MindMap Layout:**
- Radial structure from center
- Parent-child relationships
- Clear hierarchy
- Good for: brainstorming, topic exploration, hierarchical content

**Freeform Layout:**
- Custom positioning
- Flexible relationships
- Multiple connection types
- Good for: complex networks, non-hierarchical content, custom arrangements

### 3. Plan Structure

**For MindMap:**
- Identify central concept (root node)
- Map primary branches (main topics)
- Organize secondary branches (subtopics)
- Position leaf nodes (details)

**For Freeform:**
- Group related concepts
- Identify connection patterns
- Plan spatial zones
- Consider visual flow

### 4. Generate Canvas

Create JSON following the Canvas specification:

**Node Creation:**
- Assign unique 8-12 character hex IDs
- Set appropriate dimensions based on content length
- Apply consistent color schemes
- Ensure no coordinate overlaps

**Node Content Format (Wiki Link Style):**
所有节点的 `text` 字段必须遵循以下格式，使用 Obsidian wiki 链接作为标题：

```
# [[节点名称]]

简要说明文字（1-2行，帮助新手快速理解）
```

**格式规则：**
- 标题层级：中心节点用 `#`（一级标题），分支节点用 `##`（二级标题），叶节点用 `###`（三级标题）
- Wiki 链接：使用简洁格式 `[[节点名称]]`，节点名称应在 vault 中唯一
  - Obsidian 会自动在整个 vault 中搜索匹配的笔记
  - 建议将相关笔记组织在白板同名子文件夹中（便于管理，而非链接解析）
- 节点名称：简洁、可作为有效笔记标题，避免特殊字符和重复名称
- 说明文字：紧跟标题后，用换行分隔，提供简短解释（不超过 60 字符）
- 示例：
  - 中心节点：`"# [[核心概念]]\n\n这是整个知识网络的核心"`
  - 分支节点：`"## [[分支主题]]\n\n从核心延伸的关键方向"`
  - 叶节点：`"### [[具体要点]]\n\n可进一步展开的细节"`

**Wiki 链接路径规则：**

所有 wiki 链接指向的位置取决于用户的 Obsidian 设置和笔记文件是否存在：

**Obsidian Wiki 链接解析规则：**
- `[[节点名称]]` → 在整个 vault 中搜索匹配的笔记文件
- 如果存在同名笔记，点击链接会跳转到该笔记
- 如果不存在，点击会创建新笔记（位置取决于「新笔记默认存放位置」设置）

**同名子文件夹组织建议：**
- 建议用户手动创建与白板同名的子文件夹
- 将相关笔记放在该子文件夹中
- Wiki 链接仍使用简洁格式 `[[节点名称]]`（Obsidian 会自动找到）

```
推荐组织结构：
白板文件: Projects/项目A/架构设计.canvas
笔记存放: Projects/项目A/架构设计/
          ├── 核心模块.md
          ├── API设计.md
          └── 数据库设计.md
节点链接: [[核心模块]] → 自动匹配到架构设计/核心模块.md
```

**注意事项：**
- 避免笔记名称重复（vault 中唯一命名可确保正确解析）
- 可使用显式路径 `[[架构设计/核心模块]]` 消除歧义（但会降低可读性）
- Canvas 中的 text 节点 wiki 链接行为与普通笔记中的链接一致

**设计意图：**
- Wiki 链接点击后可跳转到对应笔记，实现「白板即导航」
- 同名子文件夹组织相关笔记，保持 vault 结构清晰（推荐但非强制）
- 简要说明帮助新手快速理解概念，无需打开笔记即可获知大意
- 标题层级视觉上区分节点重要性

**Edge Creation:**
- Connect parent-child relationships
- Use appropriate arrow styles
- Add labels for complex relationships
- Choose line styles (straight for hierarchy, curved for cross-references)

**Grouping (REQUIRED for layered architecture):**

当创建分层架构框架时，必须使用分组（group）节点来框选边界清晰的模块，帮助用户：

1. **快速理解分层** - 一眼看到各层边界
2. **方便管理** - Obsidian 支持折叠/展开分组
3. **视觉导航** - 分组标签作为层级的快捷标识

**分组创建规则：**

```json
{
  "id": "group_unique_id",
  "type": "group",
  "x": -1150,
  "y": -350,
  "width": 720,
  "height": 350,
  "color": "5",
  "label": "Bootstrap 组合根层"
}
```

**坐标计算：**
- `x` = 该组所有节点的最小 x 值 - 50（左边距）
- `y` = 该组所有节点的最小 y 值 - 50（上边距）
- `width` = 最大 x + 节点宽度 - 最小 x + 100（左右边距）
- `height` = 最大 y + 节点高度 - 最小 y + 100（上下边距）

**分组命名：**
- 使用层级名称作为 label：`Bootstrap 组合根层`、`Feature 注册层`、`Domain-Runtime 层`
- 颜色与该层主色调一致
- 分组节点放在 nodes 数组最前面（底层渲染）

**必须分组的情况：**
- 明确的分层架构（如6层架构）
- 边界清晰的模块组（如 Agent 工具体系）
- 需要整体移动的配置区块

**可选分组的情况：**
- 跨层引用的节点（如治理规则）
- 单个独立模块

### 5. Apply Layout Algorithm

**布局类型选择：**

| 内容类型 | 推荐布局 | 特点 |
|----------|----------|------|
| 分层架构 | Layered Grid | 按层分组，网格对齐，分组间距充足 |
| 思维导图 | MindMap | 中心辐射，层级展开 |
| 知识网络 | Freeform | 自由布局，曲线连接 |
| 流程图 | Flow | 从上到下或从左到右 |

---

## 5.1 Layered Grid Layout (分层架构专用)

**适用场景：** 6层架构、模块分层、技术栈展示

**核心原则：**

```
┌─────────────────────────────────────────────────────────────┐
│                    水平方向：从左到右排列层级                  │
│                    垂直方向：每层内从上到下排列节点             │
└─────────────────────────────────────────────────────────────┘
```

**坐标计算公式：**

```python
# 层级配置
LAYER_CONFIG = {
    'spacing_between_layers': 500,    # 层与层之间的水平间距
    'spacing_within_layer': 80,       # 同层节点之间的垂直间距
    'node_width': 260,                # 标准节点宽度
    'node_height': 120,               # 标准节点高度
    'group_padding': 60,              # 分组边距
    'header_height': 100,             # 层标题节点高度
}

# 第 N 层的起始 X 坐标
layer_start_x = n * (max_layer_width + LAYER_CONFIG['spacing_between_layers'] + LAYER_CONFIG['group_padding'] * 2)

# 层内第 M 个节点的 Y 坐标
node_y = header_height + LAYER_CONFIG['group_padding'] + m * (LAYER_CONFIG['node_height'] + LAYER_CONFIG['spacing_within_layer'])
```

**分层布局示例：**

```
Layer 0          Layer 1          Layer 2          Layer 3
(x=0)            (x=900)          (x=1800)         (x=2700)

┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│ 层标题   │     │ 层标题   │     │ 层标题   │     │ 层标题   │
├─────────┤     ├─────────┤     ├─────────┤     ├─────────┤
│ 节点1   │     │ 节点1   │     │ 节点1   │     │ 节点1   │
│ 节点2   │     │ 节点2   │     │ 节点2   │     │ 节点2   │
│ 节点3   │     │ 节点3   │     │         │     │         │
└─────────┘     └─────────┘     └─────────┘     └─────────┘
```

**防重叠检查（必须执行）：**

```python
def check_overlap(nodes):
    for i, node_a in enumerate(nodes):
        for node_b in nodes[i+1:]:
            # 计算边界
            a_left = node_a['x']
            a_right = node_a['x'] + node_a['width']
            a_top = node_a['y']
            a_bottom = node_a['y'] + node_a['height']
            
            b_left = node_b['x']
            b_right = node_b['x'] + node_b['width']
            b_top = node_b['y']
            b_bottom = node_b['y'] + node_b['height']
            
            # 检测重叠
            if not (a_right < b_left or b_right < a_left or 
                    a_bottom < b_top or b_bottom < a_top):
                raise ValueError(f"节点重叠: {node_a.get('text', '')[:20]} 与 {node_b.get('text', '')[:20]}")
```

---

## 5.2 MindMap Layout Calculations

Refer to `references/layout-algorithms.md` for detailed algorithms. Key principles:

- Center root at (0, 0)
- Distribute primary nodes radially
- Space secondary nodes based on sibling count
- Maintain minimum spacing: **400px horizontal, 250px vertical** (比之前增加)

---

## 5.3 Freeform Layout Principles

- Start with logical groupings
- Position groups with clear separation (**minimum 500px between groups**)
- Connect across groups with curved edges
- Balance visual weight across canvas
- **Always verify no overlap after positioning**

---

## 5.4 分组与节点的空间关系

**重要：分组必须完全包含其节点**

```
分组坐标计算：
  group.x = min(节点.x) - group_padding
  group.y = min(节点.y) - group_padding - header_offset
  group.width = max(节点.x + 节点.width) - min(节点.x) + group_padding * 2
  group.height = max(节点.y + 节点.height) - min(节点.y) + group_padding * 2

其中：
  group_padding = 60
  header_offset = 50  # 为分组标题预留空间
```

**分组之间必须保留的间距：**
- 相邻分组最小间距：100px
- 避免分组边框重叠

### 6. Generate Companion Notes (REQUIRED)

**必须在生成 Canvas 后同步创建对应的 markdown 笔记文件，并填充详细内容。**

**笔记生成规则：**

1. **存放位置**：
   - 在 Canvas 文件同级目录下创建与 Canvas 同名的子文件夹
   - 所有笔记存放在该子文件夹中
   ```
   Canvas文件: obsidian/插件开发框架.canvas
   笔记目录:   obsidian/插件开发框架/
                ├── Bootstrap组合根层.md
                ├── main-js入口.md
                └── ...
   ```

2. **笔记文件命名**：
   - 从节点的 wiki 链接 `[[节点名称]]` 中提取名称
   - 直接作为文件名：`节点名称.md`
   - 避免特殊字符：`/ \ : * ? " < > |`

3. **笔记内容模板**：
   ```markdown
   # 节点名称
   
   > [!info] 概述
   > 从 Canvas 节点提取的简要说明文字（1-2句话）
   
   ## 核心职责
   
   <!-- 根据上下文填充：该模块负责什么 -->
   
   ## 关键文件
   
   <!-- 列出相关文件路径 -->
   
   ## 依赖关系
   
   <!-- 列出上游/下游依赖 -->
   
   ## 注意事项
   
   <!-- 开发时需要注意的约束或规则 -->
   
   ## 相关链接
   
   - [[Canvas主文件名]] - 返回白板
   - [[相关节点1]]
   - [[相关节点2]]
   ```

4. **内容填充规则（必须执行）**：

   **步骤 4.1：识别内容来源**
   
   根据 Canvas 的主题类型，选择信息来源：
   
   | Canvas 类型 | 信息来源 | 内容填充策略 |
   |------------|---------|-------------|
   | 项目架构框架 | AGENTS.md, 项目文档, 源码注释 | 提取模块职责、文件路径、依赖关系 |
   | 知识体系总结 | 用户提供的参考资料 | 提取定义、关键概念、应用场景 |
   | 流程/决策树 | 流程描述文本 | 提取步骤、条件、输入输出 |
   | 头脑风暴 | 无预设来源 | 生成概念解释、示例应用 |
   
   **步骤 4.2：填充各节内容**
   
   - **概述**：从 Canvas 节点的说明文字提取，或根据上下文扩展
   - **核心职责**：该模块/概念负责什么，解决什么问题
   - **关键文件**：相关源码文件路径（适用于技术类）
   - **依赖关系**：上游依赖（需要什么）、下游依赖（被谁使用）
   - **注意事项**：开发约束、常见陷阱、最佳实践
   - **相关链接**：有边连接的其他节点 + 返回白板链接
   
   **步骤 4.3：内容深度要求**
   
   - **分层节点（如 Bootstrap层）**：描述该层的职责和边界
   - **模块节点（如 Reader-Chat-Runtime）**：描述核心职责、文件路径、依赖关系
   - **规则节点（如 单一真相源约束）**：描述规则内容、触发条件、违反后果
   - **流程节点（如 初始化流程）**：描述步骤、命令、预期结果
   - **工具节点（如 读工具）**：列出具体工具名称、用途、参数

5. **生成顺序**：
   - 先创建 `.canvas` 文件
   - 再创建子文件夹
   - **读取项目文档获取信息**
   - 批量创建 `.md` 笔记文件并填充详细内容

### 7. Validate and Output

Before outputting:

**Validation Checklist:**
- All nodes have unique IDs
- No coordinate overlaps (check distance > node dimensions + spacing)
- All edges reference valid node IDs
- Groups (if any) have labels
- Colors use consistent format (hex or preset numbers)
- JSON is properly escaped (Chinese quotes: 『』 for double, 「」 for single)
- **所有 wiki 链接对应的笔记文件已创建**

**Output Format:**
- Complete, valid JSON Canvas file
- Companion markdown note files in subfolder
- Summary of created files
- Directly importable into Obsidian

## Node Sizing Guidelines

**Text Length-Based Sizing:**
- Short text (<30 chars): 220 × 100 px
- Medium text (30-60 chars): 260 × 120 px  
- Long text (60-100 chars): 320 × 140 px
- Very long text (>100 chars): 320 × 180 px

## Color Schemes

**Preset Colors (Recommended):**
- `"1"` - Red (warnings, important)
- `"2"` - Orange (action items)
- `"3"` - Yellow (questions, notes)
- `"4"` - Green (positive, completed)
- `"5"` - Cyan (information, details)
- `"6"` - Purple (concepts, abstract)

**Custom Hex Colors:**
Use for brand consistency or specific themes. Always use uppercase format: `"#4A90E2"`

## Critical Rules

1. **Quote Handling:**
   - Chinese double quotes → 『』
   - Chinese single quotes → 「」
   - English double quotes → `\"`

2. **ID Generation:**
   - 8-12 character random hex strings
   - Must be unique across all nodes and edges

3. **Z-Index Order:**
   - Output groups first (bottom layer)
   - Then subgroups
   - Finally text/link nodes (top layer)

4. **Spacing Requirements (重要 - 防止重叠):**
   - **同层节点垂直间距：80px（最小）**
   - **层与层水平间距：500px（最小，含分组边框）**
   - **分组内边距：60px**
   - **分组之间间距：100px（最小）**
   - 必须在输出前执行重叠检查
   - 分组必须完全包含其所有节点

5. **Layered Layout 专用间距：**
   - 每层起始 X 坐标间隔：`layer_width + 500`
   - 每层内节点 Y 坐标间隔：`node_height + 80`
   - 层标题放在分组顶部（y = group.y + 20）

5. **JSON Structure:**
   - Top level contains only `nodes` and `edges` arrays
   - No extra wrapping objects
   - No comments in output

6. **No Emoji:**
   - Do not use any Emoji symbols in node text
   - Use color coding or text labels for visual distinction instead

## Examples

### Simple MindMap Request
User: "Create a mind map about solar system planets"

Process:
1. Identify center: "Solar System" → wiki link: `[[太阳系]]`
2. Primary branches: Inner Planets, Outer Planets, Dwarf Planets → wiki links
3. Secondary nodes: Individual planets with brief descriptions
4. Apply radial layout
5. Generate JSON with wiki link format:

**Expected Node Text Example:**
- Center: `"# [[太阳系]]\n\n包含行星、卫星和小天体的天体系统"`
- Branch: `"## [[内行星]]\n\n靠近太阳的岩石行星群"`
- Leaf: `"### [[火星]]\n\n红色行星，可能存在生命痕迹"`

> **注意**: Wiki 链接使用简洁格式 `[[节点名称]]`。建议在白板同名子文件夹（如 `太阳系/`）中创建对应笔记以便管理。

### Freeform Content Request
User: "Turn this article into a canvas" + [article text]

Process:
1. Extract article structure (intro, body sections, conclusion)
2. Identify key concepts and convert to wiki link names
3. Write brief descriptions for each concept (novice-friendly)
4. Group related sections spatially
5. Connect with labeled edges
6. Apply freeform layout with clear zones

**Expected Node Text Example:**
- `"# [[核心论点]]\n\n文章的主要观点概述"`
- `"## [[支持证据]]\n\n论证核心论点的数据和案例"`

> **注意**: Wiki 链接使用简洁格式 `[[节点名称]]`，Obsidian 会在 vault 中搜索匹配笔记。

## Reference Documents

- **Canvas Specification**: `references/canvas-spec.md` - Complete JSON Canvas format specification
- **Layout Algorithms**: `references/layout-algorithms.md` - Detailed positioning algorithms for both layout types

Load these references when:
- Need specification details for edge cases
- Implementing complex layout calculations
- Troubleshooting validation errors

## Tips for Quality Canvases

1. **Wiki link naming**: 节点名称应简洁、可作为笔记标题，避免过长或特殊字符
2. **Novice-friendly descriptions**: 说明文字应通俗易懂，帮助新手快速理解概念
3. **Keep descriptions concise**: 每个节点的说明不超过 60 字符（约 1-2 行）
4. **Use hierarchy**: 标题层级（# / ## / ###）区分节点重要性
5. **Balance the canvas**: Distribute nodes to avoid clustering
6. **Strategic colors**: Use colors to encode meaning, not just decoration
7. **Meaningful connections**: Only add edges that clarify relationships
8. **Test in Obsidian**: Verify wiki links work and canvas opens correctly
9. **同步创建笔记**: Canvas 生成后必须创建对应的 markdown 笔记文件
10. **防重叠检查**: 输出前必须验证无节点重叠，分组完全包含节点
11. **分组标签清晰**: 使用层级名称作为分组 label，方便用户快速识别

## Common Pitfalls to Avoid

- Overlapping nodes (always check distances)
- Inconsistent quote escaping (breaks JSON parsing)
- Missing group labels (causes sidebar navigation issues)
- Descriptions too long (keep under 60 chars for readability)
- Wiki link names with special characters (use simple, valid note titles)
- Duplicate IDs (each must be unique)
- Unconnected nodes (unless intentional islands)
- Missing brief descriptions (nodes should explain themselves to novices)
- **只生成 Canvas 不生成笔记（必须同步创建）**
- **笔记文件名与 wiki 链接不匹配**
