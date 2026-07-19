/**
 * Reading mode filter — translated from gitveg/paper2gal/utils/reading_mode.py
 *
 * Two modes:
 *   - "fast": only keep Abstract, Method, Experiment sections
 *   - "detailed": keep all sections (no filtering)
 *
 * The fast mode uses keyword scoring to select the most relevant chunks
 * when section titles aren't available (pypdf / pdfjs fallback path).
 * When sectionKey is available, it filters directly by section type.
 */

import { COMMON_SECTION_KEYWORDS } from "./chapter-splitter.js";

const FAST_CATEGORIES = ["abstract", "method", "experiment"];

/**
 * Normalize text for keyword matching.
 */
function normalize(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Check which section categories a text matches.
 * @param {string} text
 * @returns {Object<string, boolean>}
 */
function categoryHits(text) {
  const t = normalize(text);
  const hits = {};
  for (const [key, kws] of Object.entries(COMMON_SECTION_KEYWORDS)) {
    hits[key] = kws.some((kw) => t.includes(kw));
  }
  return hits;
}

/**
 * Score a text chunk for fast mode relevance.
 * Higher score = more likely to be a core section.
 */
function fastScoreText(text) {
  const hits = categoryHits(String(text || "").slice(0, 2000));
  let score = 0;
  if (hits.abstract) score += 2;
  if (hits.method) score += 3;
  if (hits.experiment) score += 3;
  return score;
}

/**
 * Calculate target chunk count for fast mode.
 * Translated from gitveg's _target_fast function.
 */
function targetFast(total) {
  if (total <= 4) return Math.min(total, 2);
  return Math.min(total, Math.max(4, Math.ceil(total * 0.25)));
}

/**
 * Pick top items by score, preserving original order.
 */
function pickTopByScore(indices, scores, limit) {
  const ranked = [...indices].sort((a, b) => {
    const sa = scores[a] || 0;
    const sb = scores[b] || 0;
    if (sb !== sa) return sb - sa;
    return a - b; // Lower index wins ties
  });
  return ranked.slice(0, Math.max(0, limit));
}

/**
 * Apply fast mode when sectionKey is available (heading-based split).
 * Filter by sectionKey, but also cap the result to a reasonable target
 * (not every chunk with sectionKey="method" should be kept for a 1000-page book).
 */
function applySectionBasedFast(chunks) {
  const target = targetFast(chunks.length);
  const filtered = chunks.filter((c) => {
    if (!c.sectionKey) return false;
    return FAST_CATEGORIES.includes(c.sectionKey);
  });
  // If we have way more filtered chunks than the target, keep only the
  // first N per category to maintain a balanced selection.
  if (filtered.length > target * 2) {
    const perCat = Math.ceil(target / FAST_CATEGORIES.length);
    const counts = {};
    return filtered.filter((c) => {
      const cat = c.sectionKey;
      counts[cat] = (counts[cat] || 0) + 1;
      return counts[cat] <= perCat;
    });
  }
  return filtered;
}

/**
 * Apply fast mode when sectionKey is NOT available (character split).
 * Uses keyword scoring + quota allocation.
 * Translated from gitveg's _apply_pypdf_fast.
 */
function applyScoreBasedFast(chunks) {
  const n = chunks.length;
  const target = targetFast(n);
  const fastScores = {};
  for (let i = 0; i < n; i++) {
    fastScores[i] = fastScoreText(chunks[i].text || "");
  }

  // Group chunk indices by category
  const catIndices = {};
  for (const cat of FAST_CATEGORIES) catIndices[cat] = [];

  for (let i = 0; i < n; i++) {
    const hits = categoryHits(chunks[i].text || "");
    for (const cat of FAST_CATEGORIES) {
      if (hits[cat]) catIndices[cat].push(i);
    }
  }

  // Quotas: abstract 25%, method 40%, experiment 35%
  const quotas = {
    abstract: Math.max(1, Math.ceil(target * 0.25)),
    method: Math.max(1, Math.ceil(target * 0.4)),
    experiment: Math.max(1, target - (Math.ceil(target * 0.25) + Math.ceil(target * 0.4))),
  };

  const selected = new Set();
  for (const cat of FAST_CATEGORIES) {
    const ranked = pickTopByScore(catIndices[cat], fastScores, quotas[cat]);
    for (const idx of ranked) {
      selected.add(idx);
      if (selected.size >= target) break;
    }
    if (selected.size >= target) break;
  }

  // Fill remaining slots with any positive-scoring chunks
  if (selected.size < target) {
    const positive = [];
    for (let i = 0; i < n; i++) {
      if ((fastScores[i] || 0) > 0) positive.push(i);
    }
    for (const idx of pickTopByScore(positive, fastScores, target)) {
      selected.add(idx);
      if (selected.size >= target) break;
    }
  }

  // Fallback: just take first N
  if (selected.size === 0) {
    return chunks.slice(0, Math.min(n, target));
  }

  // Return in original order
  return chunks.filter((_, i) => selected.has(i));
}

/**
 * Apply reading mode filter to chunks.
 *
 * @param {Array<{ index: number, text: string, sectionTitle: string, sectionKey: string|null }>} chunks
 * @param {"fast"|"detailed"} mode
 * @returns {Array} Filtered chunks (re-indexed)
 */
export function applyReadingMode(chunks, mode = "detailed") {
  if (!chunks || chunks.length === 0) return chunks;

  const m = String(mode || "detailed").trim().toLowerCase();
  if (m === "detailed" || m === "standard" || m === "focus") {
    return chunks;
  }
  if (m !== "fast") return chunks;

  // Check if we have sectionKey info
  const hasSectionKeys = chunks.some((c) => c.sectionKey);

  let filtered;
  if (hasSectionKeys) {
    filtered = applySectionBasedFast(chunks);
    // If section-based filtering removed everything, fall back to score-based
    if (filtered.length === 0) {
      filtered = applyScoreBasedFast(chunks);
    }
  } else {
    filtered = applyScoreBasedFast(chunks);
  }

  // Re-index
  return filtered.map((c, i) => ({ ...c, index: i }));
}
