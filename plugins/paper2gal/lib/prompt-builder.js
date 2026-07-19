/**
 * prompt-builder.js — builds system + user messages for LLM script generation.
 *
 * Directly adapted from gitveg/paper2gal/utils/script_engine.py:
 *   - SYSTEM_PROMPT template
 *   - CHARACTER_CONFIGS
 *   - _build_user_prompt
 *   - _normalize_script / _normalize_option_text / _normalize_correct_answer
 *   - _fallback_script
 *
 * All prompt text is preserved from the original; only the wrapping code is JS.
 */

// ── Character configurations (from gitveg CHARACTER_CONFIGS) ──

export const CHARACTER_CONFIGS = {
  "奈奈": {
    self_name: "奈奈子",
    style: "傲娇、毒舌但学识渊博的二次元猫娘",
    tone: "说话爱带'喵'，经常口嫌体正直地吐槽论文作者，称呼用户为'笨蛋'或'你'。",
  },
  "玲娜贝儿": {
    self_name: "贝儿",
    style: "机智、可爱、活泼、充满好奇心的粉色小狐狸",
    tone: "自称'贝儿'，语气热情且充满能量，擅长用森林里的事物做生动的比喻。",
  },
  "蜡笔小新": {
    self_name: "小新",
    style: "活泼、调皮、可爱、有点小聪明的5岁幼儿园小男孩",
    tone: "自称'小新'，说话直率有时口无遮拦，经常说'动感超人'、'小白'等经典台词，喜欢搞笑和搞怪。",
  },
  "默认": {
    self_name: "我",
    style: "学识渊博的陪读助手",
    tone: "语气亲切，逻辑清晰。",
  },
};

export const AVAILABLE_CHARACTERS = ["奈奈", "玲娜贝儿", "蜡笔小新"];

// ── System prompt (from gitveg SYSTEM_PROMPT) ──

export const SYSTEM_PROMPT = `你现在是一个{character_style}，你的名字是{character_name}，在对话中必须自称"{self_name}"。你的任务是陪用户读论文。
输入是论文的**一整节**（例如 Abstract、Introduction、或 3 Method）。你需要把它改编成一段"对话剧本"。

要求：
1. **去学术化**：用口语、比喻来解释复杂的概念（比如把"神经网络"比作"连接起来的猫脑"）。
2. **情绪价值**：不要只讲课。根据性格穿插吐槽、鼓励或活泼的互动（比如"这个作者写的句子好长啊！"）、撒娇或严厉。
3. **互动设计**：在关键知识点，设计一个"选项"让用户选，或者设计一个"小测验"。
4. **层次划分**：若本节内容较多（如 Method、Related Work），请**按层次划分子节**。在子节开头插入一条 type="sub_head"，且带 "title" 字段（子节标题，如 "3.1 概述"）。子节内再写 dialogue/quiz/choice。这样用户能分层次理解，每层可含多个对话和题目。
5. **解析**：quiz 和 choice 都必须附上 "explanation" 字段（50~120 字）。quiz 的解析解释为什么正确答案是对的；choice 的解析则针对用户的选择，给出思考角度或拓展观点，帮助加深理解。无论哪种，都要口语化，可以吐槽，有{character_name}的风格。
6. **图片/表格同屏展示**：若正文中有「[图片: ...]」标记，说明原论文该处有插图或表格图。规则：
   - show_image 会与紧随其后的 dialogue **同屏显示**（图片在上，对话在下）。因此：
     * **每当** dialogue 的 text 中提到某张图/表（如"如图1所示""见 Figure 2""如 Figure 1(d) 展示的那样"），**必须紧接在该 dialogue 前面**插入对应的 type="show_image"。
     * 同一张图被多次提及时，每次都要插入 show_image，因为图片会和当前对话文字同屏，帮助理解。
     * **show_image 后紧跟的 dialogue 文字必须真正解释这张图**：描述图里的关键内容、实验结果、趋势对比——不要只说"来看这张图"，而是说"你看这条曲线……这说明……"。
     * show_image 同样适用于表格，figure_id 格式如 "Table 1" / "表1"。
   - **只能**引用"可用图片"列表里列出的图号；列表为空则不生成 show_image。
7. **格式严格**：输出为 JSON 列表。type 只能是 dialogue / quiz / choice / sub_head / show_image。sub_head 项只需 type 与 title；dialogue 需 speaker/text/emotion/type；quiz 需 question/options/correct_answer/feedback_correct/feedback_wrong/explanation；choice 需 prompt/options/emotion/explanation；show_image 需 figure_id 和 caption。
7.**语气特色**：{character_tone}
8.**人设高度一致**：严格遵循"{character_style}"的设置。`.trim();

// ── Build messages ──

/**
 * Build the system + user messages for LLM script generation.
 * Directly adapted from gitveg's generate_script + _build_user_prompt.
 *
 * @param {Object} opts
 * @param {string} opts.chunkText - The paper section text
 * @param {number} opts.chunkIndex - Chunk index (for context)
 * @param {string} [opts.sectionTitle] - Section title (e.g. "Abstract", "3 Method")
 * @param {string[]} [opts.figureLabels] - Available figure labels
 * @param {string} [opts.characterName] - Character name (default: "奈奈")
 * @returns {{ system: string, user: string }}
 */
export function buildMessages(opts = {}) {
  const {
    chunkText = "",
    chunkIndex = 0,
    sectionTitle = "",
    figureLabels = [],
    characterName = "奈奈",
  } = opts;

  const conf = CHARACTER_CONFIGS[characterName] || CHARACTER_CONFIGS["默认"];

  // Build system prompt
  const system = SYSTEM_PROMPT
    .replace(/{character_name}/g, characterName)
    .replace(/{character_style}/g, conf.style)
    .replace(/{self_name}/g, conf.self_name)
    .replace(/{character_tone}/g, conf.tone)
    .replace(/{character_pronoun}/g, "她");

  // Build user prompt
  const sectionLine = sectionTitle ? `当前章节：${sectionTitle}\n\n` : "";
  const figuresLine = figureLabels.length > 0
    ? `可用图片（只能引用这些图号）：${figureLabels.join("、")}\n\n`
    : "";

  const user = `${sectionLine}${figuresLine}输入论文本节全文（chunk #${chunkIndex}）：
"""${chunkText}"""

请只输出 JSON 数组（list），不要输出任何额外文本、不要用 \`\`\` 包裹。

约束：
- type 只能是 dialogue / quiz / choice / sub_head / show_image
- sub_head 项：仅需 type="sub_head" 与 title="子节标题"（用于长节按层次划分）
- show_image 项：type="show_image", figure_id（**必须与可用图片列表中的图号完全一致**）, caption（简短说明）。每次 dialogue 提到某图/表时，在该 dialogue 前插入对应 show_image；同一图可多次插入。若无可用图片则不生成。
- emotion 只能在以下 key 里选一个：char_normal, char_happy, char_angry, char_shy
- dialogue 项必须包含 speaker,text,emotion,type，其中 speaker 必须是 "${characterName}"
- quiz 项必须包含：type="quiz", question, options(数组), correct_answer, feedback_correct, feedback_wrong, explanation(解析，50~120字，解释为什么正确答案是对的)
- choice 项必须包含：type="choice", prompt, options(数组), emotion, explanation(解析，50~120字，针对这道思考题给出${characterName}的观点或思路拓展)

若本节内容较多，请用 sub_head 划分子节，再在子节内写 dialogue/quiz/choice。请把解释写进对话文本里，而不是 JSON 外面。`.trim();

  return { system, user };
}

// ── Script normalization (from gitveg _normalize_script) ──

/**
 * Parse and normalize the LLM's JSON output into a clean script array.
 * Handles common LLM output issues: markdown wrapping, non-JSON text, etc.
 *
 * @param {string} raw - LLM response text
 * @param {string} [characterName] - Fallback speaker name
 * @returns {Array<Object>} Normalized script items
 */
export function normalizeScript(raw, characterName = "奈奈") {
  if (!raw || !raw.trim()) return [];

  // Strip markdown code fences
  let cleaned = raw.trim().replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");

  // Try direct JSON parse
  let data;
  try {
    data = JSON.parse(cleaned);
  } catch {
    // Fallback: extract JSON array via regex
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (m) {
      try {
        data = JSON.parse(m[0]);
      } catch {
        return [];
      }
    } else {
      return [];
    }
  }

  if (!Array.isArray(data)) return [];

  const out = [];

  for (const it of data) {
    if (!it || typeof it !== "object") continue;
    const t = String(it.type || "").trim();
    if (!["dialogue", "quiz", "choice", "sub_head", "show_image"].includes(t)) continue;

    if (t === "sub_head") {
      const title = String(it.title || "").trim();
      if (title) out.push({ type: "sub_head", title });
      continue;
    }

    if (t === "show_image") {
      const figureId = String(it.figure_id || "").trim();
      const caption = String(it.caption || "").trim();
      if (figureId) out.push({ type: "show_image", figure_id: figureId, caption });
      continue;
    }

    if (t === "dialogue") {
      const speaker = String(it.speaker || characterName).trim();
      const text = String(it.text || "").trim();
      const emotion = clampEmotion(it.emotion);
      if (text) out.push({ type: "dialogue", speaker, text, emotion });
      continue;
    }

    if (t === "quiz") {
      const q = String(it.question || "").trim();
      const opts = it.options;
      if (!q || !Array.isArray(opts) || opts.length < 2) continue;
      const opts2 = opts.map(normalizeOptionText);
      const correct = normalizeCorrectAnswer(it.correct_answer, opts2);
      const explanation = String(it.explanation || "").trim();
      out.push({
        type: "quiz",
        question: q,
        options: opts2,
        correct_answer: correct,
        feedback_correct: String(it.feedback_correct || "嗯哼，还行吧。").trim(),
        feedback_wrong: String(it.feedback_wrong || "笨蛋！再想想喵！").trim(),
        explanation,
        emotion: clampEmotion(it.emotion),
      });
      continue;
    }

    if (t === "choice") {
      const prompt = String(it.prompt || it.question || "你选哪个？").trim();
      const opts = it.options;
      if (!Array.isArray(opts) || opts.length < 2) continue;
      const explanation = String(it.explanation || "").trim();
      out.push({
        type: "choice",
        prompt,
        options: opts.map(normalizeOptionText),
        emotion: clampEmotion(it.emotion),
        explanation,
      });
      continue;
    }
  }

  return out;
}

// ── Helpers (from gitveg) ──

function clampEmotion(emotion) {
  const e = String(emotion || "char_normal").trim();
  return ["char_normal", "char_happy", "char_angry", "char_shy"].includes(e)
    ? e
    : "char_normal";
}

function normalizeOptionText(value) {
  let text = String(value || "").trim();
  if (!text) return "";

  // Remove leading option labels: (A), A., 1), etc.
  for (let i = 0; i < 3; i++) {
    const prev = text;
    text = text.replace(/^\s*[（(]\s*(?:[A-Za-z]|\d{1,2})\s*[）)]\s*/, "").trim();
    text = text.replace(/^\s*(?:[A-Za-z]|\d{1,2})\s*[\.\)、,:：]\s*/, "").trim();
    if (text === prev) break;
  }
  return text || String(value).trim();
}

function normalizeCorrectAnswer(rawAnswer, options) {
  if (!options || options.length === 0) return String(rawAnswer || "").trim();

  const raw = String(rawAnswer || "").trim();
  if (!raw) return options[0];

  // Try label-to-index (A/B/C, 1/2/3)
  let idx = optionLabelToIndex(raw);
  if (idx !== null && idx >= 0 && idx < options.length) return options[idx];

  const cleaned = normalizeOptionText(raw);
  idx = optionLabelToIndex(cleaned);
  if (idx !== null && idx >= 0 && idx < options.length) return options[idx];

  // Match by exact text
  for (const opt of options) {
    if (cleaned === String(opt).trim()) return opt;
  }

  return cleaned || options[0];
}

function optionLabelToIndex(text) {
  const s = String(text || "").trim();
  if (!s) return null;

  // A/B/C
  let m = s.match(/^[（(]?\s*([A-Za-z])\s*[）)]?[\.\)、,:：]?\s*$/);
  if (m) return m[1].toUpperCase().charCodeAt(0) - 65;

  // 1/2/3
  m = s.match(/^[（(]?\s*(\d{1,2})\s*[）)]?[\.\)、,:：]?\s*$/);
  if (m) return parseInt(m[1], 10) - 1;

  return null;
}

/**
 * Build a fallback script when LLM fails to produce valid output.
 * @param {string} msg - Error/placeholder message
 * @param {number} chunkIndex
 * @param {string} [characterName]
 * @param {string} [extraHint] - Original text excerpt
 * @returns {Array<Object>}
 */
export function fallbackScript(msg, chunkIndex = 0, characterName = "奈奈", extraHint = null) {
  let text = msg;
  if (extraHint) text += `\n\n（原文片段：${extraHint}…）`;
  return [{
    type: "dialogue",
    speaker: characterName,
    text,
    emotion: chunkIndex % 2 === 0 ? "char_normal" : "char_shy",
  }];
}
