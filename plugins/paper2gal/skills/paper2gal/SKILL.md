---
name: paper2gal
description: 把学术论文变成二次元视觉小说风格的互动学习体验。当用户提到"用二次元读论文""paper2gal""论文 galgame""论文剧本化""论文角色讲解"时触发。MANDATORY TRIGGERS: paper2gal, 论文galgame, 论文剧本, 二次元读论文, 论文讲解, paper to gal, visual novel paper, 论文互动
---

# Paper2Galgame 📄💕

把学术论文变成二次元视觉小说风格的互动学习体验。上传 PDF，AI 角色会按章节把论文剧本化——不是摘要，是真正的角色对白、吐槽、小测验和选择题。

**优先调用工具**：`paper2gal_parse` → `paper2gal_generate`

## 执行流程

1. 用户提供 PDF ResourceRef（上传文件通常是 `{ "kind": "session-file", "fileId": "..." }`）；仅本地开发时可使用绝对路径
2. 调用 `paper2gal_parse` 工具解析 PDF，拿到章节文本块（chunks）
3. 调用 `paper2gal_generate` 工具，传入 chunks + 角色名 + LLM provider/model，插件内部调 LLM 生成 JSON 剧本
4. 用 `show_card` 渲染 Galgame 风格对话框卡片，将生成的剧本 items 注入 `window.__p2g_items`
5. 可选：用 `hanako-audio-player_tts` 或 `tts_bus` 合成角色语音

### 两步流程说明

**第一步：paper2gal_parse** — 纯 PDF 解析，不需要 LLM
```json
{
  "resource": { "kind": "session-file", "fileId": "..." },
  "readingMode": "detailed"
}
```
本地开发兼容形式：`{ "filePath": "/path/to/paper.pdf", "readingMode": "detailed" }`。
返回：章节文本块数组（index/sectionTitle/sectionKey/text/figureLabels）

**第二步：paper2gal_generate** — LLM 剧本生成
```json
{
  "chunks": [/* 从 paper2gal_parse 返回的 chunks */],
  "character": "奈奈",
  "providerId": "deepseek",
  "model": "deepseek-chat",
  "figureLabels": ["Figure 1", "Table 1"]
}
```
返回：JSON 剧本数组（每章节含 dialogue/quiz/choice/sub_head/show_image items）

**第三步：show_card 渲染** — 将 scripts 合并为一个 items 数组注入卡片

### 何时拆分两步 vs 一步

- **少量章节（≤5）**：一次 `paper2gal_generate` 传所有 chunks，一次性生成全部剧本
- **大量章节（>5）**：分批调用，每次传 3-5 个 chunks，逐批渲染交互
- **极速阅读**：`paper2gal_parse` 用 `readingMode: "fast"` 只拿关键章节，减少生成量

## 角色配置

可从以下角色中选择，也可由用户指定自定义角色：

### 奈奈（默认）
- **自称**：奈奈子
- **风格**：傲娇、毒舌但学识渊博的二次元猫娘
- **语气**：说话爱带"喵"，经常口嫌体正直地吐槽论文作者，称呼用户为"笨蛋"或"你"

### 玲娜贝儿
- **自称**：贝儿
- **风格**：机智、可爱、活泼、充满好奇心的粉色小狐狸
- **语气**：自称"贝儿"，语气热情且充满能量，擅长用森林里的事物做生动的比喻

### 蜡笔小新
- **自称**：小新
- **风格**：活泼、调皮、可爱、有点小聪明的5岁幼儿园小男孩
- **语气**：自称"小新"，说话直率有时口无遮拦，经常说"动感超人"、"小白"等经典台词

### 默认
- **自称**：我
- **风格**：学识渊博的陪读助手
- **语气**：语气亲切，逻辑清晰

## 剧本生成规则

当拿到论文的一个章节文本块后，按以下规则生成剧本：

1. **去学术化**：用口语、比喻来解释复杂的概念（比如把"神经网络"比作"连接起来的猫脑"）
2. **情绪价值**：不要只讲课。根据性格穿插吐槽、鼓励或活泼的互动（比如"这个作者写的句子好长啊！"）、撒娇或严厉
3. **互动设计**：在关键知识点，设计一个"选项"让用户选，或者设计一个"小测验"
4. **层次划分**：若本节内容较多（如 Method、Related Work），请按层次划分子节。在子节开头插入一条 type="sub_head"，且带 "title" 字段（子节标题，如 "3.1 概述"）。子节内再写 dialogue/quiz/choice
5. **解析**：quiz 和 choice 都必须附上 "explanation" 字段（50~120 字）。quiz 的解析解释为什么正确答案是对的；choice 的解析则针对用户的选择，给出思考角度或拓展观点
6. **图片/表格引用**：若工具返回中有 figureLabels，且正文中提到这些图号，在对应 dialogue 前面可以提示"This part references Figure X"
7. **格式严格**：输出为 JSON 列表。type 只能是 dialogue / quiz / choice / sub_head / show_image
8. **语气特色**：严格遵循角色设定的语气和口癖
9. **人设高度一致**：严格遵循角色的风格设定

## 剧本格式定义

每种 item 类型的字段：

### dialogue（对白）
```json
{
  "type": "dialogue",
  "speaker": "奈奈",
  "text": "对白内容",
  "emotion": "char_normal"
}
```
- emotion 只能选：`char_normal`, `char_happy`, `char_angry`, `char_shy`
- speaker 必须是当前角色名

### quiz（小测验）
```json
{
  "type": "quiz",
  "question": "问题内容",
  "options": ["选项A", "选项B", "选项C", "选项D"],
  "correct_answer": "选项B",
  "feedback_correct": "答对了的反馈",
  "feedback_wrong": "答错了的反馈",
  "explanation": "50~120字的解析",
  "emotion": "char_happy"
}
```

### choice（思考选择题）
```json
{
  "type": "choice",
  "prompt": "情境提示/思考方向",
  "options": ["选项A", "选项B", "选项C"],
  "emotion": "char_normal",
  "explanation": "50~120字的解析，给出角色的观点或思路拓展"
}
```

### sub_head（子节标题）
```json
{
  "type": "sub_head",
  "title": "3.1 概述"
}
```

### show_image（论文插图引用）
```json
{
  "type": "show_image",
  "figure_id": "Figure 1",
  "caption": "简短说明"
}
```

## 渲染卡片格式

生成剧本后，用 `show_card` 渲染为 Galgame 风格的交互卡片。卡片 HTML 模板参考 `templates/galgame_card.html`。

卡片应包含：
- 顶部：章节进度条 + 章节标题徽章
- 中部：角色立绘区域（用 emoji 或 CSS 代替图片）+ 对话框
- 底部：选项按钮（当遇到 quiz/choice 时）
- 对话框背景半透明，文字使用衬线字体

每次用户点击"继续"时，展示下一条剧本 item。遇到 quiz/choice 时暂停等待用户选择。

## 交互模式

1. **逐章推进**：先展示第一章的剧本，用户点击继续后生成下一章
2. **混合模式**：对白用 show_card 展示，测验/选择题等待用户回答后给出反馈
3. **语音模式**：可选为每条对白用 TTS 合成角色语音

## 建议参数

调用 `paper2gal_parse` 工具时：

```json
{
  "resource": { "kind": "session-file", "fileId": "..." },
  "readingMode": "detailed",
  "extractFigures": true
}
```

- 首次阅读建议 `detailed`；用户说"快速了解"时用 `fast`
- 最多返回 30 个章节块（可通过 maxChunks 调整）

## 示例对话

用户："帮我用二次元风格读这篇论文 /path/to/attention_is_all_you_need.pdf"

执行步骤：
1. 调用 `paper2gal_parse` 解析 PDF
2. 按 SKILL.md 规则逐章节生成 JSON 剧本
3. 用 `show_card` 渲染第一章的 Galgame 对话卡片
4. 等待用户交互（继续/答题/选角色）
5. 可选：调用 TTS 合成语音
