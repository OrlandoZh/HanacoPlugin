#!/usr/bin/env python3
"""
test_hana_adapter.py — Tests for hana_adapter.py in-process pipeline

Covers:
  - Full output layout with source-preview/ subdirectory (not bundle root)
  - Architecture output with overlay
  - build-meta.json merge (cbmProjectName, pipelineVersion, gitCommitHash)
  - CBM_BIN/CBM_TIMEOUT_SECONDS sync after import
  - _resolve_overlay and _collect_preview_files helpers
  - Source preview files are under source-preview/, not mirrored at bundle root
"""

import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import hana_adapter
import adapter
import enhance
import overview
import pipeline


class HanaAdapterHelpersTest(unittest.TestCase):
    def test_overlay_hash_contract_matches_node(self):
        overlay = {"z": "中文", "a": {"b": 2, "a": [True, None, "x"]}}
        serialized = json.dumps(
            overlay, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        self.assertEqual(
            hashlib.sha256(serialized).hexdigest(),
            "512d769c00f278a3c72ea1214bc256c77527d3fa4b36b5b602181387f6c55698",
        )

    def test_collect_preview_files_returns_relative_paths(self):
        graph = {"nodes": [
            {"id": "f:src/main.ts", "type": "file", "filePath": "src/main.ts"},
            {"id": "f:../outside.txt", "type": "file", "filePath": "../outside.txt"},
            {"id": "f:/absolute.txt", "type": "file", "filePath": "/absolute.txt"},
        ]}
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "src").mkdir()
            (Path(d) / "src" / "main.ts").write_text("x", encoding="utf-8")
            files = hana_adapter._collect_preview_files(graph, d)
            paths = {f["relativePath"] for f in files}
            self.assertIn("src/main.ts", paths)
            self.assertNotIn("../outside.txt", paths)
            self.assertNotIn("/absolute.txt", paths)

    def test_collect_preview_files_skips_ua_paths(self):
        graph = {"nodes": [
            {"id": "f:.ua/config.json", "type": "file", "filePath": ".ua/config.json"},
            {"id": "f:src/a.ts", "type": "file", "filePath": "src/a.ts"},
        ]}
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "src").mkdir(); (Path(d) / "src" / "a.ts").write_text("x", encoding="utf-8")
            files = hana_adapter._collect_preview_files(graph, d)
            self.assertNotIn(".ua/config.json", {f["relativePath"] for f in files})

    def test_resolve_overlay_returns_none_for_no_overlay(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertIsNone(hana_adapter._resolve_overlay(d, None))

    def test_resolve_overlay_loads_explicit(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "ov.json"
            p.write_text(json.dumps({"language": "zh"}), encoding="utf-8")
            r = hana_adapter._resolve_overlay(d, str(p))
            self.assertEqual(r["language"], "zh")

    def test_resolve_overlay_loads_project_ua_overlay(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / ".ua").mkdir()
            (Path(d) / ".ua" / "overlay.json").write_text(json.dumps({"language": "en"}), encoding="utf-8")
            self.assertEqual(hana_adapter._resolve_overlay(d, None)["language"], "en")


class HanaAdapterPipelineOutputTest(unittest.TestCase):
    def _graph(self):
        return {
            "version": "1.0.0", "kind": "codebase",
            "project": {"name": "demo", "languages": ["ts"], "frameworks": [],
                        "description": "", "analyzedAt": "", "gitCommitHash": "abc"},
            "nodes": [{"id": "file:src/main.ts", "type": "file", "name": "main.ts",
                       "filePath": "src/main.ts", "summary": "F", "tags": [], "complexity": "simple"}],
            "edges": [], "layers": [], "tour": [],
        }

    def test_source_preview_files_under_source_preview_dir(self):
        """Source files must be under bundle/source-preview/, not at bundle root."""
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "src"; src.mkdir()
            (src / "main.ts").write_text("export const main = 1\n", encoding="utf-8")
            graph = self._graph()
            with patch.object(adapter, "convert", return_value=graph):
                hana_adapter.run_pipeline(
                    project_root=d, cbm_project="test",
                    output_root=str(Path(d) / "out"),
                    cbm_binary="echo", overlay_path=None,
                    materialize_source_preview=True,
                )
            out = Path(d) / "out"
            # Files must be in full/source-preview/src/main.ts
            self.assertTrue((out / "full" / "source-preview" / "src" / "main.ts").exists(),
                            "source preview file must be under full/source-preview/")
            # Files must NOT be at full/src/main.ts (bundle root mirror)
            self.assertFalse((out / "full" / "src" / "main.ts").exists(),
                             "source preview file must NOT be at bundle root")

    def test_full_only_output_no_overlay(self):
        with tempfile.TemporaryDirectory() as d:
            graph = self._graph()
            with patch.object(adapter, "convert", return_value=graph):
                hana_adapter.run_pipeline(
                    project_root=d, cbm_project="test",
                    output_root=str(Path(d) / "out"),
                    cbm_binary="echo", overlay_path=None,
                    materialize_source_preview=False,
                )
            out = Path(d) / "out"
            self.assertTrue((out / "full" / ".ua" / "knowledge-graph.json").exists())
            self.assertFalse((out / "architecture").exists())
            self.assertTrue((out / "build-meta.json").exists())

    def test_dual_bundle_with_overlay(self):
        with tempfile.TemporaryDirectory() as d:
            overlay = {"language": "zh", "layers": [
                {"id": "l-src", "name": "Src", "description": "src", "patterns": ["src/**"]}],
                "architectureOverview": {
                    "representativesPerLayer": 1, "maxBackboneEdges": 5,
                    "macroDomains": [{"id": "m-src", "name": "Src", "description": "s", "layerIds": ["l-src"]}],
                }}
            op = Path(d) / "overlay.json"
            op.write_text(json.dumps(overlay), encoding="utf-8")
            graph = self._graph()
            with patch.object(adapter, "convert", return_value=graph):
                hana_adapter.run_pipeline(
                    project_root=d, cbm_project="test",
                    output_root=str(Path(d) / "out"),
                    cbm_binary="echo", overlay_path=str(op),
                    materialize_source_preview=False,
                )
            out = Path(d) / "out"
            self.assertTrue((out / "full" / ".ua" / "knowledge-graph.json").exists())
            self.assertTrue((out / "architecture" / ".ua" / "knowledge-graph.json").exists())

    def test_build_meta_contains_cbm_and_git_fields(self):
        """build-meta.json must record cbmProjectName, pipelineVersion, gitCommitHash."""
        with tempfile.TemporaryDirectory() as d:
            graph = self._graph()
            with patch.object(adapter, "convert", return_value=graph):
                hana_adapter.run_pipeline(
                    project_root=d, cbm_project="my-cbm-project",
                    output_root=str(Path(d) / "out"),
                    cbm_binary="echo", overlay_path=None,
                    materialize_source_preview=False,
                )
            meta = json.loads((Path(d) / "out" / "build-meta.json").read_text(encoding="utf-8"))
            self.assertEqual(meta["cbmProjectName"], "my-cbm-project")
            self.assertIn("pipelineVersion", meta)
            self.assertIn("gitCommitHash", meta)

    def test_build_meta_preserved_by_node_promote(self):
        """Simulate Node's promoteBuild merge: pipeline fields survive."""
        with tempfile.TemporaryDirectory() as d:
            graph = self._graph()
            with patch.object(adapter, "convert", return_value=graph):
                meta = hana_adapter.run_pipeline(
                    project_root=d, cbm_project="my-cbm",
                    output_root=str(Path(d) / "out"),
                    cbm_binary="echo", overlay_path=None,
                    materialize_source_preview=False,
                )
            # Simulate Node promoteBuild adding fields
            merged = {**meta, "buildId": "b1", "projectId": "abc123", "promotedAt": "now"}
            self.assertEqual(merged["cbmProjectName"], "my-cbm")
            self.assertEqual(merged["buildId"], "b1")

    def test_source_preview_meta_contains_files_array(self):
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "src"; src.mkdir()
            (src / "main.ts").write_text("x\n", encoding="utf-8")
            graph = self._graph()
            with patch.object(adapter, "convert", return_value=graph):
                hana_adapter.run_pipeline(
                    project_root=d, cbm_project="test",
                    output_root=str(Path(d) / "out"),
                    cbm_binary="echo", overlay_path=None,
                    materialize_source_preview=True,
                )
            meta = json.loads((Path(d) / "out" / "full" / ".ua" / "source-preview-meta.json").read_text())
            self.assertIn("files", meta)
            self.assertIsInstance(meta["files"], list)

    def test_run_pipeline_requires_cbm_project(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(RuntimeError) as ctx:
                hana_adapter.run_pipeline(d, None, str(Path(d) / "out"), "echo")
            self.assertIn("cbm-project", str(ctx.exception))


class HanaAdapterCBMBinSyncTest(unittest.TestCase):
    """Test that --cbm-binary actually takes effect by syncing adapter.CBM_BIN after import."""

    def test_run_pipeline_syncs_cbm_bin(self):
        """run_pipeline must set adapter.CBM_BIN to the provided cbm_binary."""
        with tempfile.TemporaryDirectory() as d:
            graph = {
                "version": "1.0.0", "kind": "codebase",
                "project": {"name": "t", "languages": [], "frameworks": [],
                            "description": "", "analyzedAt": "", "gitCommitHash": ""},
                "nodes": [], "edges": [], "layers": [], "tour": [],
            }
            original_bin = adapter.CBM_BIN
            with patch.object(adapter, "convert", return_value=graph):
                hana_adapter.run_pipeline(
                    project_root=d, cbm_project="test",
                    output_root=str(Path(d) / "out"),
                    cbm_binary="/custom/cbm/path",
                    materialize_source_preview=False,
                )
            # After run_pipeline, adapter.CBM_BIN should be the explicitly provided value
            self.assertEqual(adapter.CBM_BIN, "/custom/cbm/path")
            # Restore
            adapter.CBM_BIN = original_bin

    def test_cbm_timeout_synced(self):
        """CBM_TIMEOUT_SECONDS env should override adapter.CBM_TIMEOUT_SECONDS."""
        with tempfile.TemporaryDirectory() as d:
            graph = {
                "version": "1.0.0", "kind": "codebase",
                "project": {"name": "t", "languages": [], "frameworks": [],
                            "description": "", "analyzedAt": "", "gitCommitHash": ""},
                "nodes": [], "edges": [], "layers": [], "tour": [],
            }
            os.environ["CBM_TIMEOUT_SECONDS"] = "42"
            try:
                with patch.object(adapter, "convert", return_value=graph):
                    hana_adapter.run_pipeline(
                        project_root=d, cbm_project="test",
                        output_root=str(Path(d) / "out"),
                        cbm_binary="echo",
                        materialize_source_preview=False,
                    )
                self.assertEqual(adapter.CBM_TIMEOUT_SECONDS, 42)
            finally:
                os.environ.pop("CBM_TIMEOUT_SECONDS", None)


class HanaAdapterManagerTest(unittest.TestCase):
    def test_adapter_does_not_spawn_pipeline_py(self):
        with tempfile.TemporaryDirectory() as d:
            graph = {
                "version": "1.0.0", "kind": "codebase",
                "project": {"name": "t", "languages": [], "frameworks": [],
                            "description": "", "analyzedAt": "", "gitCommitHash": ""},
                "nodes": [], "edges": [], "layers": [], "tour": [],
            }
            with patch.object(adapter, "convert", return_value=graph):
                with patch("subprocess.run") as mock_run:
                    hana_adapter.run_pipeline(
                        project_root=d, cbm_project="test",
                        output_root=str(Path(d) / "staging"),
                        cbm_binary="echo",
                        materialize_source_preview=False,
                    )
                    for call in mock_run.call_args_list:
                        args = call[0][0] if call[0] else []
                        if isinstance(args, list):
                            for arg in args:
                                self.assertNotIn("pipeline.py", str(arg))


if __name__ == "__main__":
    unittest.main()
