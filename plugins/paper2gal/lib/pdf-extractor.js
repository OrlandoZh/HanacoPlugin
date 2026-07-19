/**
 * PDF text extractor using pdfjs-dist (pure JS, no Python needed).
 *
 * Extracts text page-by-page and returns structured page objects.
 * Adapted from patterns seen in Nova42x/paper2galgame and MrChenLearnSpace fork
 * which both use pdfjs-dist for client-side PDF text extraction.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// pdfjs-dist is loaded lazily so the plugin doesn't hard-fail if the dep
// is missing at load time (only fails when actually parsing a PDF).
let _pdfjs = null;
async function getPdfjs() {
  if (_pdfjs) return _pdfjs;
  // Try different import strategies for different pdfjs-dist versions
  try {
    const mod = await import("pdfjs-dist/legacy/build/pdf.mjs");
    _pdfjs = mod;
  } catch {
    try {
      const mod = await import("pdfjs-dist");
      _pdfjs = mod;
    } catch {
      throw new Error(
        "pdfjs-dist is not installed. Run `npm install` in the paper2gal plugin directory."
      );
    }
  }
  return _pdfjs;
}

/**
 * Resolve the pdfjs worker path for Node.js environments.
 * In Node, we can disable the worker by setting `disableWorker` or
 * use the fake worker (which runs in the main thread).
 */
async function getWorkerOptions() {
  // Resolve standardFontDataUrl to suppress font warnings in Node.js
  // pdfjs-dist bundles standard fonts in the `standard_fonts` subdirectory
  let standardFontDataUrl;
  try {
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const modPath = fileURLToPath(import.meta.resolve('pdfjs-dist/package.json'));
    standardFontDataUrl = resolve(dirname(modPath), 'standard_fonts') + '/';
  } catch {
    // If we can't resolve the path, proceed without it (warnings are non-fatal)
  }

  return {
    // Disable worker — process in main thread (sufficient for our use case)
    disableWorker: true,
    useSystemFonts: true,
    ...(standardFontDataUrl ? { standardFontDataUrl } : {}),
  };
}

/**
 * Extract text from a PDF file, page by page.
 *
 * @param {string} filePath - Absolute path to the PDF file.
 * @returns {Promise<Array<{ page: number, text: string }>>} Array of page objects.
 */
export async function extractPdfText(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`PDF file not found: ${filePath}`);
  }

  const pdfjs = await getPdfjs();
  const workerOptions = await getWorkerOptions();

  // Read file as Uint8Array
  const data = new Uint8Array(fs.readFileSync(filePath));

  // Load document — `getDocument` is the standard pdfjs-dist entry point.
  // In Node.js we pass data directly; no `cMapUrl` or `standardFontDataUrl` needed
  // for basic text extraction.
  const loadingTask = pdfjs.getDocument({
    data,
    ...workerOptions,
  });

  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;
  const pages = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const textContent = await page.getTextContent();

    // Reconstruct text from text items, preserving line breaks
    const lines = [];
    let currentY = null;
    let currentLine = [];

    for (const item of textContent.items) {
      const transform = item.transform || [1, 0, 0, 1, 0, 0];
      const y = transform[5];

      if (currentY !== null && Math.abs(y - currentY) > 3) {
        // New line
        if (currentLine.length > 0) {
          lines.push(currentLine.join(""));
        }
        currentLine = [item.str];
      } else {
        currentLine.push(item.str);
      }
      currentY = y;
    }
    if (currentLine.length > 0) {
      lines.push(currentLine.join(""));
    }

    const text = lines.join("\n").trim();
    if (text) {
      pages.push({ page: i, text });
    }

    // Clean up page resources
    page.cleanup();
  }

  // Clean up document
  await pdfDoc.destroy();

  return pages;
}

/**
 * mergePages - join page texts into a single string with page markers.
 *
 * @param {Array<{ page: number, text: string }>} pages
 * @returns {string} Full text with page markers.
 */
export function mergePages(pages) {
  return pages
    .map((p) => `[Page ${p.page}]\n${p.text}`)
    .join("\n\n");
}

/**
 * Extract figure/table references from text (simple heuristic).
 * Looks for patterns like "Figure 1", "Fig. 2", "Table 3", "图1", "表2".
 *
 * @param {string} text
 * @returns {Array<string>} List of figure labels found.
 */
export function extractFigureLabels(text) {
  const labels = new Set();
  const patterns = [
    /(?:fig(?:ure)?\.?\s*\d+[a-z]?)/gi,
    /(?:tab(?:le)?\.?\s*\d+[a-z]?)/gi,
    /(?:图\s*\d+[a-z]?)/g,
    /(?:表\s*\d+[a-z]?)/g,
  ];
  for (const pat of patterns) {
    const matches = text.matchAll(pat);
    for (const m of matches) {
      labels.add(m[0].trim());
    }
  }
  return [...labels].sort();
}
