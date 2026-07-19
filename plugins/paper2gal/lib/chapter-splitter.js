/**
 * Chapter splitter — translated from gitveg/paper2gal/utils/pdf_loader.py
 * and reading_mode.py section detection logic.
 *
 * Two strategies:
 *   1. Section-based split: detect headings via keyword matching → one chunk per section
 *   2. Character-based fallback: RecursiveCharacterTextSplitter equivalent
 *
 * The original Python uses LangChain's RecursiveCharacterTextSplitter.
 * Here we implement the same recursive separator logic in pure JS.
 */

// ── Section keywords (from gitveg app.py COMMON_SECTION_KEYWORDS) ──

export const COMMON_SECTION_ORDER = [
  "abstract",
  "introduction",
  "related_work",
  "method",
  "experiment",
  "conclusion",
  "appendix",
];

export const COMMON_SECTION_LABELS = {
  abstract: "Abstract / 摘要",
  introduction: "Introduction / 引言",
  related_work: "Related Work / 相关工作",
  method: "Method / 方法",
  experiment: "Experiment / 实验与结果",
  conclusion: "Conclusion / 结论",
  appendix: "Appendix / 附录",
};

export const COMMON_SECTION_KEYWORDS = {
  abstract: ["abstract", "摘要"],
  introduction: ["introduction", "intro", "引言", "背景"],
  related_work: ["related work", "related", "literature", "相关工作"],
  method: ["method", "methods", "approach", "framework", "methodology", "方法", "模型", "算法"],
  experiment: ["experiment", "experiments", "evaluation", "result", "results", "实验", "评估", "结果"],
  conclusion: ["conclusion", "conclusions", "future work", "总结", "结论"],
  appendix: ["appendix", "supplementary", "supplement", "附录"],
};

// ── Section detection ──

/**
 * Normalize text for section matching.
 * @param {string} text
 * @returns {string}
 */
function normalizeForSection(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[#`$^*_+~]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Infer the common section key (abstract/introduction/...) from a title and body prefix.
 * Directly translated from gitveg's _infer_common_section_key.
 *
 * @param {string} title
 * @param {string} body
 * @returns {string|null}
 */
export function inferSectionKey(title, body = "") {
  const titleNorm = normalizeForSection(title);
  const bodyNorm = normalizeForSection(body.slice(0, 1200));

  // Prefer title match
  for (const key of COMMON_SECTION_ORDER) {
    const kws = COMMON_SECTION_KEYWORDS[key];
    if (kws.some((kw) => titleNorm.includes(kw))) return key;
  }
  // Fallback to body prefix
  for (const key of COMMON_SECTION_ORDER) {
    const kws = COMMON_SECTION_KEYWORDS[key];
    if (kws.some((kw) => bodyNorm.includes(kw))) return key;
  }
  return null;
}

// ── Heading-based section splitting ──

/**
 * Detect potential section headings in extracted PDF text.
 * A heading is typically:
 *   - A short line (< 80 chars)
 *   - Starts with a number (1. Introduction, 2 Method, 3.1 Approach)
 *   - Or is ALL CAPS (ABSTRACT, INTRODUCTION)
 *   - Or matches common section keywords directly
 *
 * @param {string} text - Full PDF text
 * @returns {Array<{ title: string, start: number, end: number }>}
 */
function detectHeadings(text) {
  const lines = text.split("\n");
  const headings = [];
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineLen = lines[i].length + 1; // +1 for the \n

    if (!line || line.length > 80) {
      offset += lineLen;
      continue;
    }

    // Check: numbered heading (1. Introduction / 2 Method / 3.1. Approach)
    const numberedMatch = line.match(/^(\d+(?:\.\d+)*)\.?\s+(.+)/);
    if (numberedMatch) {
      const headingText = numberedMatch[2];
      const key = inferSectionKey(headingText, "");
      if (key) {
        headings.push({ title: line, start: offset, end: -1 });
      }
      offset += lineLen;
      continue;
    }

    // Check: ALL CAPS heading (ABSTRACT, INTRODUCTION)
    if (line === line.toUpperCase() && line.length > 3 && /^[A-Z\s]+$/.test(line)) {
      const key = inferSectionKey(line, "");
      if (key) {
        headings.push({ title: line, start: offset, end: -1 });
      }
      offset += lineLen;
      continue;
    }

    // Check: direct keyword match — only for short heading-like lines
    // (avoid matching body sentences that happen to contain keywords)
    if (line.length <= 60 && !line.endsWith('.')) {
      const key = inferSectionKey(line, "");
      if (key) {
        headings.push({ title: line, start: offset, end: -1 });
      }
    }

    offset += lineLen;
  }

  // Set end positions
  for (let i = 0; i < headings.length; i++) {
    headings[i].end = i + 1 < headings.length ? headings[i + 1].start : text.length;
  }

  return headings;
}

// ── Recursive character text splitter ──
// Ported from LangChain's RecursiveCharacterTextSplitter

const DEFAULT_SEPARATORS = ["\n\n", "\n", "。", "，", ";", "；", ",", " ", ""];

/**
 * Recursively split text using a list of separators.
 * Tries the first separator; if resulting chunks still exceed chunkSize,
 * recursively splits them with the next separator.
 *
 * @param {string} text
 * @param {string[]} separators
 * @param {number} chunkSize
 * @param {number} chunkOverlap
 * @returns {string[]}
 */
function recursiveSplit(text, separators, chunkSize, chunkOverlap) {
  const finalChunks = [];
  let separator = separators[separators.length - 1];
  let newSeparators = [];

  for (let i = 0; i < separators.length; i++) {
    if (text.includes(separators[i])) {
      separator = separators[i];
      newSeparators = separators.slice(i + 1);
      break;
    }
  }

  const splits = separator ? text.split(separator) : [text];

  // Merge small splits
  const goodSplits = [];
  for (const split of splits) {
    if (split.length < chunkSize) {
      goodSplits.push(split);
    } else {
      // Flush good splits
      if (goodSplits.length > 0) {
        finalChunks.push(...mergeSplits(goodSplits, separator, chunkSize, chunkOverlap));
        goodSplits.length = 0;
      }
      if (newSeparators.length > 0) {
        finalChunks.push(...recursiveSplit(split, newSeparators, chunkSize, chunkOverlap));
      } else {
        finalChunks.push(split);
      }
    }
  }
  if (goodSplits.length > 0) {
    finalChunks.push(...mergeSplits(goodSplits, separator, chunkSize, chunkOverlap));
  }

  return finalChunks;
}

/**
 * Merge splits with overlap, respecting chunk size.
 */
function mergeSplits(splits, separator, chunkSize, chunkOverlap) {
  const sepLen = separator.length;
  const chunks = [];
  let current = [];
  let currentLen = 0;

  for (const split of splits) {
    const splitLen = split.length;

    if (currentLen + splitLen + (current.length > 0 ? sepLen : 0) > chunkSize) {
      if (current.length > 0) {
        const chunk = current.join(separator);
        if (chunk.trim()) chunks.push(chunk);

        // Keep overlap
        while (
          current.length > 1 &&
          currentLen - current[0].length > chunkOverlap
        ) {
          currentLen -= current[0].length + sepLen;
          current.shift();
        }
      }
      current = [split];
      currentLen = splitLen;
    } else {
      current.push(split);
      currentLen += splitLen + (current.length > 1 ? sepLen : 0);
    }
  }

  if (current.length > 0) {
    const chunk = current.join(separator);
    if (chunk.trim()) chunks.push(chunk);
  }

  return chunks;
}

// ── Main entry: splitPdfIntoChunks ──

/**
 * @typedef {Object} PdfChunk
 * @property {number} index - Chunk index (0-based)
 * @property {string} text - Chunk text content
 * @property {string} sectionTitle - Detected section title (empty if unknown)
 * @property {string|null} sectionKey - Standardized section key (abstract/method/...)
 */

/**
 * Split extracted PDF text into chunks for script generation.
 *
 * Strategy:
 *   1. Try heading-based section split (better structure)
 *   2. Fall back to recursive character split (when no headings found)
 *
 * @param {string} fullText - Full PDF text (from mergePages or raw)
 * @param {{ chunkSize?: number, chunkOverlap?: number }} options
 * @returns {PdfChunk[]}
 */
export function splitIntoChunks(fullText, options = {}) {
  const { chunkSize = 1400, chunkOverlap = 180 } = options;

  if (!fullText || !fullText.trim()) return [];

  // Strategy 1: heading-based split
  const headings = detectHeadings(fullText);

  if (headings.length >= 2) {
    // We have enough headings to do section-based splitting
    const chunks = [];
    for (let i = 0; i < headings.length; i++) {
      const h = headings[i];
      const sectionText = fullText.slice(h.start, h.end).trim();
      if (!sectionText) continue;

      // If section is too long, further split it
      if (sectionText.length > chunkSize * 2) {
        const subChunks = recursiveSplit(
          sectionText,
          DEFAULT_SEPARATORS,
          chunkSize,
          chunkOverlap
        );
        for (const sub of subChunks) {
          chunks.push({
            index: chunks.length,
            text: sub,
            sectionTitle: h.title,
            sectionKey: inferSectionKey(h.title, sub),
          });
        }
      } else {
        chunks.push({
          index: chunks.length,
          text: sectionText,
          sectionTitle: h.title,
          sectionKey: inferSectionKey(h.title, sectionText),
        });
      }
    }

    // Also include preamble (text before first heading)
    if (headings[0].start > 0) {
      const preamble = fullText.slice(0, headings[0].start).trim();
      if (preamble) {
        chunks.unshift({
          index: 0,
          text: preamble,
          sectionTitle: "Preamble",
          sectionKey: null,
        });
        // Re-index
        for (let i = 0; i < chunks.length; i++) chunks[i].index = i;
      }
    }

    if (chunks.length > 0) return chunks;
  }

  // Strategy 2: recursive character split fallback
  const textChunks = recursiveSplit(
    fullText,
    DEFAULT_SEPARATORS,
    chunkSize,
    chunkOverlap
  );

  return textChunks.map((text, index) => ({
    index,
    text,
    sectionTitle: "",
    sectionKey: inferSectionKey("", text),
  }));
}
