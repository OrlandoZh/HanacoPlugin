/**
 * paper2gal_parse — PDF parsing entry point for the plugin.
 *
 * Parses a PDF, splits into chapter chunks, optionally applies fast reading mode,
 * and returns structured text chunks for the Agent to generate visual novel scripts.
 *
 * The Agent (which IS the LLM) then uses the SKILL.md prompt to convert chunks
 * into dialogue/quiz/choice script items — no need for an API client here.
 */

import { extractPdfText, mergePages, extractFigureLabels } from "../lib/pdf-extractor.js";
import { splitIntoChunks } from "../lib/chapter-splitter.js";
import { applyReadingMode } from "../lib/reading-mode.js";

export const name = "paper2gal_parse";
export const description = [
  "Parse an academic PDF into chapter-based text chunks for visual novel script generation.",
  "Returns structured chunks with section titles and detected section keys.",
  "Supports fast mode (Abstract/Method/Experiment only) and detailed mode (all sections).",
  "Optionally extracts figure/table references from the full text.",
].join(" ");

export const sessionPermission = { readOnly: true, kind: "read_only" };

export const parameters = {
  type: "object",
  properties: {
    resource: {
      type: "object",
      description: "Hana ResourceRef for the PDF, such as a session-file, local-file, mount, or resource reference.",
      additionalProperties: true,
    },
    filePath: {
      type: "string",
      description: "Legacy local-only absolute path to the PDF file.",
    },
    readingMode: {
      type: "string",
      enum: ["fast", "detailed"],
      description: "fast = only Abstract/Method/Experiment; detailed = all chapters. Defaults to detailed.",
    },
    maxChunks: {
      type: "number",
      minimum: 0,
      description: "Maximum number of chunks to return. 0 means no limit; omitted uses plugin config.",
    },
    chunkSize: {
      type: "number",
      minimum: 1,
      description: "Maximum characters per chunk for non-section-split text. Default 1400.",
    },
    chunkOverlap: {
      type: "number",
      minimum: 0,
      description: "Character overlap between adjacent chunks. Default 180.",
    },
    extractFigures: {
      type: "boolean",
      description: "If true, also extract figure/table labels from the full text and return them. Default true.",
    },
  },
  anyOf: [
    { required: ["resource"] },
    { required: ["filePath"] },
  ],
  additionalProperties: false,
};

/**
 * @param {Object} input
 * @param {Object} ctx - Plugin context (contains config, dataDir, etc.)
 */
export function resolveParseOptions(input = {}, config = {}) {
  const requestedMode = input.readingMode ?? config.defaultReadingMode ?? "detailed";
  const requestedChunkSize = Number(input.chunkSize ?? config.chunkSize ?? 1400);
  const requestedChunkOverlap = Number(input.chunkOverlap ?? config.chunkOverlap ?? 180);
  const requestedMaxChunks = Number(input.maxChunks ?? config.maxReturnedChunks ?? 30);
  const chunkSize = Number.isFinite(requestedChunkSize) && requestedChunkSize > 0
    ? Math.floor(requestedChunkSize)
    : 1400;
  const chunkOverlap = Number.isFinite(requestedChunkOverlap) && requestedChunkOverlap >= 0
    ? Math.min(Math.floor(requestedChunkOverlap), Math.max(0, chunkSize - 1))
    : Math.min(180, Math.max(0, chunkSize - 1));

  return {
    readingMode: requestedMode === "fast" ? "fast" : "detailed",
    chunkSize,
    chunkOverlap,
    maxChunks: Number.isFinite(requestedMaxChunks) && requestedMaxChunks >= 0
      ? Math.floor(requestedMaxChunks)
      : 30,
    extractFigures: input.extractFigures !== false,
  };
}

export async function resolvePdfPath(input = {}, ctx = {}) {
  if (input.resource != null) {
    if (!ctx.resources?.materialize) {
      throw new Error("Hana resource materialization is unavailable.");
    }
    const materialized = await ctx.resources.materialize(input.resource);
    const filePath = String(materialized?.filePath || "").trim();
    if (!filePath) {
      throw new Error("The PDF resource did not materialize to a local file.");
    }
    return filePath;
  }
  return String(input.filePath || "").trim();
}

export async function execute(input = {}, ctx = {}) {
  let filePath;
  try {
    filePath = await resolvePdfPath(input, ctx);
  } catch (error) {
    return {
      content: [{ type: "text", text: `❌ PDF resource could not be opened: ${error.message}` }],
    };
  }
  if (!filePath) {
    return {
      content: [{ type: "text", text: "❌ resource or filePath is required." }],
    };
  }

  // Read config from plugin context (manifest configuration properties).
  const {
    readingMode,
    chunkSize,
    chunkOverlap,
    maxChunks,
    extractFigures,
  } = resolveParseOptions(input, ctx.config || {});

  try {
    // Step 1: Extract text from PDF
    const pages = await extractPdfText(filePath);
    if (pages.length === 0) {
      return {
        content: [{
          type: "text",
          text: "❌ No text could be extracted from this PDF. It may be a scanned/image-only PDF.",
        }],
      };
    }

    // Step 2: Merge into full text
    const fullText = mergePages(pages);

    // Step 3: Split into chapter chunks
    const chunks = splitIntoChunks(fullText, { chunkSize, chunkOverlap });

    if (chunks.length === 0) {
      return {
        content: [{
          type: "text",
          text: "❌ Text was extracted but could not be split into meaningful chunks.",
        }],
      };
    }

    // Step 4: Apply reading mode filter
    const filtered = applyReadingMode(chunks, readingMode);

    // Step 5: Limit chunks
    const limited = maxChunks > 0 ? filtered.slice(0, maxChunks) : filtered;

    // Step 6: Extract figure labels (optional)
    let figureLabels = [];
    if (extractFigures) {
      figureLabels = extractFigureLabels(fullText);
    }

    // Step 7: Build page summary
    const pageSummary = pages.map((p) => `Page ${p.page}: ${p.text.length} chars`);

    // Build result
    const result = {
      parser: "pdfjs-dist",
      readingMode,
      totalPages: pages.length,
      totalChunksBeforeFilter: chunks.length,
      totalChunksAfterFilter: filtered.length,
      returnedChunks: limited.length,
      figureLabels,
      pages: pageSummary,
      chunks: limited.map((c) => ({
        index: c.index,
        sectionTitle: c.sectionTitle || "",
        sectionKey: c.sectionKey || null,
        textLength: c.text.length,
        text: c.text,
        // Include a preview for quick scanning (first 200 chars)
        preview: c.text.slice(0, 200).replace(/\n/g, " ") + (c.text.length > 200 ? "…" : ""),
      })),
    };

    // Truncate chunk text in the returned JSON if it's extremely long
    // to avoid overwhelming the Agent's context (individual chunks are fine,
    // but if there are 30 chunks × 1400 chars = 42K chars, that's a lot).
    // We keep full text — the Agent needs it for script generation.

    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `❌ PDF parsing failed: ${error.message}\n\nStack: ${error.stack || "(no stack)"}`,
      }],
    };
  }
}
