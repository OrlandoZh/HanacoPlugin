import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveParseOptions,
  resolvePdfPath,
} from "../tools/paper2gal_parse.js";

test("explicit parse options override plugin defaults", () => {
  assert.deepEqual(
    resolveParseOptions(
      {
        readingMode: "fast",
        chunkSize: 900,
        chunkOverlap: 90,
        maxChunks: 4,
        extractFigures: false,
      },
      {
        defaultReadingMode: "detailed",
        chunkSize: 1400,
        chunkOverlap: 180,
        maxReturnedChunks: 30,
      },
    ),
    {
      readingMode: "fast",
      chunkSize: 900,
      chunkOverlap: 90,
      maxChunks: 4,
      extractFigures: false,
    },
  );
});

test("parse options fall back to plugin configuration", () => {
  assert.deepEqual(
    resolveParseOptions(
      {},
      {
        defaultReadingMode: "fast",
        chunkSize: 1200,
        chunkOverlap: 120,
        maxReturnedChunks: 12,
      },
    ),
    {
      readingMode: "fast",
      chunkSize: 1200,
      chunkOverlap: 120,
      maxChunks: 12,
      extractFigures: true,
    },
  );
});

test("maxChunks zero keeps the documented unlimited behavior", () => {
  assert.equal(
    resolveParseOptions(
      { maxChunks: 0 },
      { maxReturnedChunks: 30 },
    ).maxChunks,
    0,
  );
});

test("invalid modes and chunk bounds fall back or clamp safely", () => {
  assert.deepEqual(
    resolveParseOptions({
      readingMode: "typo",
      chunkSize: 0,
      chunkOverlap: 2000,
      maxChunks: -1,
    }),
    {
      readingMode: "detailed",
      chunkSize: 1400,
      chunkOverlap: 1399,
      maxChunks: 30,
      extractFigures: true,
    },
  );
  assert.equal(resolveParseOptions({ chunkOverlap: 0 }).chunkOverlap, 0);
});

test("PDF resources are materialized through the Hana resource boundary", async () => {
  const resource = { kind: "session-file", fileId: "sf_test" };
  assert.equal(
    await resolvePdfPath(
      { resource },
      {
        resources: {
          async materialize(received) {
            assert.equal(received, resource);
            return { filePath: "/tmp/materialized-paper.pdf" };
          },
        },
      },
    ),
    "/tmp/materialized-paper.pdf",
  );
});

test("legacy local file paths remain available for local development", async () => {
  assert.equal(
    await resolvePdfPath({ filePath: " /tmp/local-paper.pdf " }),
    "/tmp/local-paper.pdf",
  );
});
