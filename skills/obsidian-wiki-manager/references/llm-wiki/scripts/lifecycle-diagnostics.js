#!/usr/bin/env node
"use strict";

/**
 * lifecycle-diagnostics.js — 只读扫描 wiki 页面的生命周期字段
 *
 * 用法：node scripts/lifecycle-diagnostics.js <wiki_root>
 *
 * 输出 JSON，包含：
 *   - summary: 统计概览（retention class 分布、平均置信度、页面总数等）
 *   - flagged: 需要关注的页面列表（低置信度、过时、矛盾未解决等）
 *   - supersession_chains: 取代链
 *   - retention_distribution: 按 retention_class 的页面分布
 *
 * 退出码：0 成功；1 参数错误；2 wiki 结构不完整
 */

const fs = require("fs");
const path = require("path");
const { extractFrontmatter } = require("./lib/source-signal-eligibility");

const SCAN_KINDS = [
  { subdir: "entities", pageType: "entity" },
  { subdir: "topics", pageType: "topic" },
  { subdir: "sources", pageType: "source" },
  { subdir: "comparisons", pageType: "comparison" },
  { subdir: "queries", pageType: "query" },
  { subdir: "synthesis", pageType: "synthesis" },
];

const SKIP_IDS = ["index", "log", "purpose", ".wiki-schema", "README", "overview"];

// ── Frontmatter 解析 ──────────────────────────────────────────

function parseFrontmatterValue(frontmatter, key) {
  if (!frontmatter) return undefined;

  const lines = frontmatter.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(new RegExp(`^${key}:\\s*(.*)$`));
    if (!match) continue;

    const rest = match[1].trim();

    // 值在同一行
    if (rest) {
      if (rest === "null" || rest === "~") return null;
      if (rest === "[]") return [];
      // 去引号
      let val = rest;
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      // 数组内联格式 [a, b, c]
      if (val.startsWith("[") && val.endsWith("]")) {
        const inner = val.slice(1, -1).trim();
        if (!inner) return [];
        return inner.split(",").map(s => {
          let t = s.trim();
          if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
            t = t.slice(1, -1);
          }
          return t;
        }).filter(Boolean);
      }
      // 数字
      const num = Number(val);
      if (!isNaN(num) && val !== "") return num;
      return val;
    }

    // 值在后续行（数组格式）
    const collected = [];
    let parsed = false;
    for (let cursor = i + 1; cursor < lines.length; cursor++) {
      const line = lines[cursor];
      if (!line.trim()) continue;
      if (/^[^\s-]/.test(line)) break; // 非数组项
      const itemMatch = line.match(/^\s*-\s*(.+)$/);
      if (!itemMatch) break;
      let token = itemMatch[1].trim();
      if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
        token = token.slice(1, -1);
      }
      if (token.startsWith("[[")) token = token.slice(2, -2);
      collected.push(token);
      parsed = true;
    }
    if (parsed) return collected;
    return null;
  }
  return undefined;
}

function parseLifecycleFields(frontmatter) {
  return {
    confidence_score: parseFrontmatterValue(frontmatter, "confidence_score"),
    last_confirmed: parseFrontmatterValue(frontmatter, "last_confirmed"),
    evidence_count: parseFrontmatterValue(frontmatter, "evidence_count"),
    contradicted_by: parseFrontmatterValue(frontmatter, "contradicted_by"),
    supersedes: parseFrontmatterValue(frontmatter, "supersedes"),
    superseded_by: parseFrontmatterValue(frontmatter, "superseded_by"),
    retention_class: parseFrontmatterValue(frontmatter, "retention_class"),
    updated: parseFrontmatterValue(frontmatter, "updated"),
    created: parseFrontmatterValue(frontmatter, "created"),
  };
}

// ── 生命周期计算 ──────────────────────────────────────────────

function daysSince(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const then = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  if (isNaN(then.getTime())) return null;
  const now = new Date();
  return Math.floor((now - then) / (1000 * 60 * 60 * 24));
}

function computeRetentionClass(fields) {
  // 如果已显式设为 archived，保持
  if (fields.retention_class === "archived") return "archived";

  // 如果有 superseded_by，应为 archived
  if (fields.superseded_by) return "archived";

  const score = fields.confidence_score;
  const days = daysSince(fields.last_confirmed);

  if (score != null && score >= 0.7 && days != null && days < 180) return "stable";
  if (score != null && score >= 0.5 && days != null && days < 90) return "active";
  if (days != null && days > 365) return "stale";
  if (score != null && score < 0.3) return "stale";
  if (days != null && days > 180) return "fading";
  if (score != null && score < 0.5) return "fading";
  return "active";
}

// ── 扫描 ─────────────────────────────────────────────────────

function scanWiki(wikiRoot) {
  const wikiDir = path.join(wikiRoot, "wiki");
  if (!fs.existsSync(wikiDir)) {
    console.error(`ERROR: wiki 目录不存在：${wikiDir}`);
    process.exit(2);
  }

  const pages = [];
  const flagged = {
    no_confidence: [],         // confidence_score 为 null 或 undefined
    low_confidence: [],        // confidence_score < 0.5
    stale_pages: [],           // last_confirmed > 180 天
    unsolved_contradictions: [], // contradicted_by 非空但无 superseded_by
    inconsistent_state: [],   // superseded_by 非空但 retention_class != archived
    no_evidence: [],           // evidence_count = 0
    retention_mismatch: [],    // 显式 retention_class 与计算值不一致
  };
  const supersessionChains = [];
  const retentionDistribution = {
    stable: 0, active: 0, fading: 0, stale: 0, archived: 0, unset: 0,
  };
  let totalScore = 0;
  let scoredCount = 0;

  for (const kind of SCAN_KINDS) {
    const dir = path.join(wikiDir, kind.subdir);
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir).filter(f => f.endsWith(".md")).sort();

    for (const file of files) {
      const id = path.basename(file, ".md");
      if (SKIP_IDS.includes(id)) continue;

      const filePath = path.join(dir, file);
      const raw = fs.readFileSync(filePath, "utf8");
      const { frontmatter } = extractFrontmatter(raw);
      const fields = parseLifecycleFields(frontmatter);

      const computedRetention = computeRetentionClass(fields);
      const daysSinceConfirmed = daysSince(fields.last_confirmed);

      // 统计
      const actualRetention = fields.retention_class || "unset";
      if (retentionDistribution[actualRetention] !== undefined) {
        retentionDistribution[actualRetention]++;
      } else {
        retentionDistribution.unset++;
      }

      if (fields.confidence_score != null) {
        totalScore += fields.confidence_score;
        scoredCount++;
      }

      // Flag 检查
      const pageEntry = {
        path: path.relative(wikiRoot, filePath),
        id,
        pageType: kind.pageType,
        confidence_score: fields.confidence_score,
        last_confirmed: fields.last_confirmed,
        days_since_confirmed: daysSinceConfirmed,
        evidence_count: fields.evidence_count,
        retention_class: fields.retention_class,
        computed_retention_class: computedRetention,
      };

      if (fields.confidence_score == null) {
        flagged.no_confidence.push(pageEntry);
      }
      if (fields.confidence_score != null && fields.confidence_score < 0.5) {
        flagged.low_confidence.push(pageEntry);
      }
      if (daysSinceConfirmed != null && daysSinceConfirmed > 180) {
        flagged.stale_pages.push(pageEntry);
      }
      if (Array.isArray(fields.contradicted_by) && fields.contradicted_by.length > 0 && !fields.superseded_by) {
        flagged.unsolved_contradictions.push({
          ...pageEntry,
          contradicted_by: fields.contradicted_by,
        });
      }
      if (fields.superseded_by && fields.retention_class !== "archived") {
        flagged.inconsistent_state.push({
          ...pageEntry,
          superseded_by: fields.superseded_by,
        });
      }
      if ((fields.evidence_count === 0 || fields.evidence_count == null) && kind.pageType !== "query") {
        flagged.no_evidence.push(pageEntry);
      }
      if (fields.retention_class && fields.retention_class !== computedRetention && fields.retention_class !== "archived") {
        flagged.retention_mismatch.push(pageEntry);
      }

      // Supersession chain
      if (fields.supersedes && Array.isArray(fields.supersedes) && fields.supersedes.length > 0) {
        supersessionChains.push({
          page: id,
          supersedes: fields.supersedes,
          path: path.relative(wikiRoot, filePath),
        });
      }

      pages.push(pageEntry);
    }
  }

  const summary = {
    total_pages: pages.length,
    scored_pages: scoredCount,
    avg_confidence: scoredCount > 0 ? Math.round((totalScore / scoredCount) * 1000) / 1000 : null,
    retention_distribution: retentionDistribution,
    flagged_counts: {
      no_confidence: flagged.no_confidence.length,
      low_confidence: flagged.low_confidence.length,
      stale_pages: flagged.stale_pages.length,
      unsolved_contradictions: flagged.unsolved_contradictions.length,
      inconsistent_state: flagged.inconsistent_state.length,
      no_evidence: flagged.no_evidence.length,
      retention_mismatch: flagged.retention_mismatch.length,
    },
    supersession_chains_count: supersessionChains.length,
  };

  return { summary, flagged, supersession_chains: supersessionChains, retention_distribution: retentionDistribution };
}

// ── 入口 ─────────────────────────────────────────────────────

function main(argv) {
  if (argv.length < 3) {
    console.error("Usage: node scripts/lifecycle-diagnostics.js <wiki_root>");
    process.exit(1);
  }

  const wikiRoot = path.resolve(argv[2]);
  const result = scanWiki(wikiRoot);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main(process.argv);
}

module.exports = { scanWiki, parseLifecycleFields, computeRetentionClass, daysSince };
