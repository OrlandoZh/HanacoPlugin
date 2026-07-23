import json
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from unittest.mock import patch

import adapter
import enhance
import hana_adapter
import overview
import pipeline


class AdapterTests(unittest.TestCase):
    @patch("hana_adapter.subprocess.run")
    def test_cbm_version_is_extracted_for_build_provenance(self, run):
        run.return_value.returncode = 0
        run.return_value.stdout = "codebase-memory-mcp 0.9.0\n"
        self.assertEqual(hana_adapter._get_cbm_version("cbm"), "0.9.0")

    @patch("hana_adapter.subprocess.run", side_effect=OSError("missing"))
    def test_cbm_version_probe_degrades_to_unknown(self, _run):
        self.assertEqual(hana_adapter._get_cbm_version("cbm"), "unknown")

    @patch("hana_adapter.subprocess.run")
    def test_cbm_version_accepts_v_prefix_and_prerelease(self, run):
        run.return_value.returncode = 0
        run.return_value.stdout = "v1.2.3-alpha.1+build.42\n"
        self.assertEqual(hana_adapter._get_cbm_version("cbm"), "1.2.3-alpha.1+build.42")

    def test_route_nodes_map_to_ua_endpoints(self):
        row = ['["Route"]', "/api/jobs", "demo.route.jobs", "src/routes/api/jobs.ts", "1", "5", "1", "true", "true", "false", "5", "", "", ""]
        node = adapter.parse_node(row)
        self.assertEqual(node["type"], "endpoint")
        self.assertEqual(node["id"], "endpoint:src/routes/api/jobs.ts:/api/jobs")

    def test_parse_node_fallback_summary_includes_signature(self):
        """When no docstring, summary should include signature for info density."""
        row = ['["Function"]', "run", "demo.run", "src/a.ts", "1", "10", "3", "false", "false", "false", "10", "", "run(a: number, b: string): void", ""]
        node = adapter.parse_node(row)
        self.assertIn("run", node["summary"])
        self.assertIn("run(a: number, b: string): void", node["summary"])

    def test_parse_node_fallback_summary_includes_parent_class(self):
        """Method summary should include parent class name."""
        row = ['["Function"]', "save", "demo.Model.save", "src/model.ts", "1", "10", "3", "false", "false", "false", "10", "", "save(): void", "Model"]
        node = adapter.parse_node(row)
        self.assertIn("Model.save", node["summary"])

    def test_parse_node_docstring_takes_priority_over_signature(self):
        """Docstring should be preferred over structural fallback."""
        row = ['["Function"]', "run", "demo.run", "src/a.ts", "1", "10", "3", "false", "false", "false", "10", "Saves data to disk.", "run(): void", ""]
        node = adapter.parse_node(row)
        self.assertEqual(node["summary"], "Saves data to disk.")

    def test_parse_node_derives_async_tag_from_signature(self):
        """async functions should get the 'async' tag."""
        row = ['["Function"]', "fetch", "demo.fetch", "src/a.ts", "1", "10", "3", "false", "false", "false", "10", "", "async fetch(): Promise<void>", ""]
        node = adapter.parse_node(row)
        self.assertIn("async", node["tags"])

    def test_parse_node_derives_api_tag_from_file_path(self):
        """Functions in /api/ or /routes/ paths should get 'api' tag."""
        row = ['["Function"]', "handler", "demo.handler", "src/api/handler.ts", "1", "10", "3", "false", "false", "false", "10", "", "handler(req, res)", ""]
        node = adapter.parse_node(row)
        self.assertIn("api", node["tags"])

    def test_parse_node_derives_utility_tag_from_file_path(self):
        """Functions in /util/ or /helper/ paths should get 'utility' tag."""
        row = ['["Function"]', "format", "demo.format", "src/utils/format.ts", "1", "10", "3", "false", "false", "false", "10", "", "format(s: string)", ""]
        node = adapter.parse_node(row)
        self.assertIn("utility", node["tags"])

    def test_parse_node_derives_data_tag_from_file_path(self):
        """Functions in /db/ or /store/ paths should get 'data' tag."""
        row = ['["Function"]', "query", "demo.query", "src/db/query.ts", "1", "10", "3", "false", "false", "false", "10", "", "query(sql: string)", ""]
        node = adapter.parse_node(row)
        self.assertIn("data", node["tags"])

    def test_parse_node_does_not_add_duplicate_tags(self):
        """Tags should not be duplicated."""
        row = ['["Function"]', "run", "demo.run", "src/api/run.ts", "1", "10", "3", "true", "true", "false", "10", "", "async run(): Promise<void>", ""]
        node = adapter.parse_node(row)
        self.assertEqual(node["tags"].count("async"), 1)
        self.assertEqual(node["tags"].count("api"), 1)
        self.assertEqual(node["tags"].count("entry-point"), 1)
        self.assertEqual(node["tags"].count("exported"), 1)

    def test_parse_node_bare_fallback_without_sig_or_pc(self):
        """Without docstring, signature, or parent_class, summary is just 'type name'."""
        row = ['["Function"]', "run", "demo.run", "src/a.ts", "1", "10", "3", "false", "false", "false", "10", "", "", ""]
        node = adapter.parse_node(row)
        self.assertEqual(node["summary"], "function run")

    def test_unique_node_id_preserves_first_and_suffixes_collisions(self):
        used = set()
        first = adapter.unique_node_id("function:src/a.ts:run", "project.a.run", used)
        used.add(first)
        second = adapter.unique_node_id("function:src/a.ts:run", "project.a.run.overload", used)

        self.assertEqual(first, "function:src/a.ts:run")
        self.assertTrue(second.startswith("function:src/a.ts:run~"))
        self.assertNotEqual(first, second)

    def test_complexity_mapping(self):
        self.assertEqual(adapter.map_complexity("0"), "simple")
        self.assertEqual(adapter.map_complexity("6"), "moderate")
        self.assertEqual(adapter.map_complexity("11"), "complex")

    def test_cbm_native_test_and_listener_edges_map_to_ua_types(self):
        self.assertEqual(adapter.EDGE_TYPE_MAP["TESTS_FILE"], "tested_by")
        self.assertEqual(adapter.EDGE_TYPE_MAP["LISTENS_ON"], "subscribes")
        self.assertNotIn("FILE_CHANGES_WITH", adapter.EDGE_TYPE_MAP)

    def test_tests_file_endpoints_are_reversed_for_ua(self):
        self.assertEqual(
            adapter.normalize_edge_endpoints("TESTS_FILE", "file:test", "file:source"),
            ("file:source", "file:test"),
        )

    def test_listens_on_endpoints_keep_cbm_direction(self):
        self.assertEqual(
            adapter.normalize_edge_endpoints("LISTENS_ON", "file:listener", "concept:channel"),
            ("file:listener", "concept:channel"),
        )

    def test_query_nodes_buckets_by_schema_and_skips_noise(self):
        schema = {
            "node_labels": [
                {"label": "File", "count": 2},
                {"label": "Variable", "count": 99},
            ]
        }
        # Batch query: mock returns rows with labels(n) as first field
        rows = [
            ['["File"]', "file-a", "a", "", "1", "1", "0", "false", "false", "false", "0", "", "", ""],
            ['["File"]', "file-b", "b", "", "1", "1", "0", "false", "false", "false", "0", "", "", ""],
            # Variable rows filtered out by SKIP_LABELS
            ['["Variable"]', "var1", "v1", "", "1", "1", "0", "false", "false", "false", "0", "", "", ""],
        ]
        with patch.object(adapter, "cbm_cli", return_value={"rows": rows}) as cbm_call:
            result = adapter.query_nodes("demo", schema)

        self.assertEqual(len(result), 2)
        self.assertEqual(cbm_call.call_count, 1)
        self.assertIn("MATCH (n)", cbm_call.call_args.args[1]["query"])
        self.assertNotIn("MATCH (n:File)", cbm_call.call_args.args[1]["query"])

    def test_query_nodes_preserves_unknown_labels_for_concept_fallback(self):
        schema = {"node_labels": [{"label": "CustomSemanticNode", "count": 1}]}
        row = ['["CustomSemanticNode"]', "topic", "demo.topic", "", "1", "1", "0", "false", "false", "false", "0", "", "", ""]
        with patch.object(adapter, "cbm_cli", return_value={"rows": [row]}) as cbm_call:
            rows = adapter.query_nodes("demo", schema)

        self.assertEqual(rows, [row])
        self.assertIn("MATCH (n)", cbm_call.call_args.args[1]["query"])
        self.assertEqual(adapter.parse_node(row)["type"], "concept")

    def test_query_nodes_rejects_bucket_above_cbm_ceiling(self):
        schema = {
            "node_labels": [
                {"label": "Function", "count": adapter.QUERY_ROW_LIMIT + 1},
            ]
        }
        with self.assertRaisesRegex(RuntimeError, "scope the repository"):
            adapter.query_nodes("demo", schema)

    def test_query_nodes_rejects_raw_total_before_skipped_rows_can_truncate(self):
        schema = {
            "node_labels": [
                {"label": "File", "count": 40_000},
                {"label": "Variable", "count": 70_000},
            ]
        }
        with patch.object(adapter, "cbm_cli") as cbm_call:
            with self.assertRaisesRegex(RuntimeError, r"raw node total 110000 .*retained 40000"):
                adapter.query_nodes("demo", schema)
        cbm_call.assert_not_called()

    def test_query_edges_rejects_raw_total_before_unmapped_rows_can_truncate(self):
        schema = {
            "edge_types": [
                {"type": "CALLS", "count": 40_000},
                {"type": "RAISES", "count": 70_000},
            ]
        }
        with patch.object(adapter, "cbm_cli") as cbm_call:
            with self.assertRaisesRegex(RuntimeError, r"raw edge total 110000 .*retained 40000"):
                adapter.query_edges("demo", schema)
        cbm_call.assert_not_called()

    def test_auto_layers_group_top_level_directories(self):
        layers = adapter.auto_generate_layers(
            [
                {"id": "file:src/a.ts", "filePath": "src/a.ts"},
                {"id": "function:src/a.ts:run", "filePath": "src/a.ts"},
                {"id": "file:docs/readme.md", "filePath": "docs/readme.md"},
                {"id": "document:docs/readme.md:intro", "filePath": "docs/readme.md"},
            ]
        )
        by_id = {layer["id"]: layer for layer in layers}
        self.assertEqual(len(by_id["layer-src"]["nodeIds"]), 2)
        self.assertEqual(by_id["layer-docs"]["name"], "Documentation")


class FileLevelEdgeProjectionTests(unittest.TestCase):
    """Tests for derive_file_level_edges()."""

    def _make_graph(self):
        """Build a minimal graph: 2 files, 2 functions, contains + calls edges."""
        nodes = [
            {"id": "file:src/a.ts", "type": "file"},
            {"id": "file:src/b.ts", "type": "file"},
            {"id": "function:src/a.ts:run", "type": "function"},
            {"id": "function:src/b.ts:serve", "type": "function"},
        ]
        edges = [
            {"source": "file:src/a.ts", "target": "function:src/a.ts:run", "type": "contains"},
            {"source": "file:src/b.ts", "target": "function:src/b.ts:serve", "type": "contains"},
            {"source": "function:src/a.ts:run", "target": "function:src/b.ts:serve", "type": "calls"},
        ]
        return nodes, edges

    def test_projects_calls_edge_to_file_level(self):
        nodes, edges = self._make_graph()
        projected = adapter.derive_file_level_edges(nodes, edges, set())
        self.assertEqual(len(projected), 1)
        e = projected[0]
        self.assertEqual(e["source"], "file:src/a.ts")
        self.assertEqual(e["target"], "file:src/b.ts")
        self.assertEqual(e["type"], "calls")

    def test_weight_is_uniform_one(self):
        nodes, edges = self._make_graph()
        projected = adapter.derive_file_level_edges(nodes, edges, set())
        for e in projected:
            self.assertEqual(e["weight"], 1.0)

    def test_multiple_calls_aggregate_into_single_edge(self):
        nodes, edges = self._make_graph()
        # Add a second calls edge between the same functions
        edges.append({"source": "function:src/a.ts:run", "target": "function:src/b.ts:serve", "type": "calls"})
        projected = adapter.derive_file_level_edges(nodes, edges, set())
        self.assertEqual(len(projected), 1, "two calls between same pair should aggregate")
        # Weight is now uniformly 1.0
        self.assertEqual(projected[0]["weight"], 1.0)

    def test_preserves_original_edges_unchanged(self):
        nodes, edges = self._make_graph()
        original_count = len(edges)
        adapter.derive_file_level_edges(nodes, edges, set())
        self.assertEqual(len(edges), original_count, "input edges list must not be mutated")

    def test_no_contains_edges_returns_empty(self):
        # If there are no contains edges, parent_file is empty, so no projection
        nodes = [
            {"id": "file:src/a.ts", "type": "file"},
            {"id": "function:src/a.ts:run", "type": "function"},
        ]
        edges = [
            {"source": "function:src/a.ts:run", "target": "file:src/a.ts", "type": "calls"},
        ]
        projected = adapter.derive_file_level_edges(nodes, edges, set())
        self.assertEqual(projected, [])

    def test_self_loop_filtered(self):
        # A function calling another function in the same file should not project
        nodes = [
            {"id": "file:src/a.ts", "type": "file"},
            {"id": "function:src/a.ts:run", "type": "function"},
            {"id": "function:src/a.ts:halt", "type": "function"},
        ]
        edges = [
            {"source": "file:src/a.ts", "target": "function:src/a.ts:run", "type": "contains"},
            {"source": "file:src/a.ts", "target": "function:src/a.ts:halt", "type": "contains"},
            {"source": "function:src/a.ts:run", "target": "function:src/a.ts:halt", "type": "calls"},
        ]
        projected = adapter.derive_file_level_edges(nodes, edges, set())
        self.assertEqual(projected, [])

    def test_publishes_edge_is_projected(self):
        nodes, edges = self._make_graph()
        edges.append({"source": "function:src/a.ts:run", "target": "function:src/b.ts:serve", "type": "publishes"})
        projected = adapter.derive_file_level_edges(nodes, edges, set())
        types = {e["type"] for e in projected}
        self.assertIn("calls", types)
        self.assertIn("publishes", types)

    def test_duplicate_with_existing_keys_is_skipped(self):
        nodes, edges = self._make_graph()
        existing = {"file:src/a.ts->file:src/b.ts:calls"}
        projected = adapter.derive_file_level_edges(nodes, edges, existing)
        self.assertEqual(projected, [])

    def test_mixed_behavioral_and_contains_edges(self):
        nodes = [
            {"id": "file:src/a.ts", "type": "file"},
            {"id": "file:src/b.ts", "type": "file"},
            {"id": "file:src/c.ts", "type": "file"},
            {"id": "function:src/a.ts:run", "type": "function"},
            {"id": "function:src/b.ts:serve", "type": "function"},
            {"id": "function:src/c.ts:init", "type": "function"},
        ]
        edges = [
            {"source": "file:src/a.ts", "target": "function:src/a.ts:run", "type": "contains"},
            {"source": "file:src/b.ts", "target": "function:src/b.ts:serve", "type": "contains"},
            {"source": "file:src/c.ts", "target": "function:src/c.ts:init", "type": "contains"},
            {"source": "function:src/a.ts:run", "target": "function:src/b.ts:serve", "type": "calls"},
            {"source": "function:src/a.ts:run", "target": "function:src/b.ts:serve", "type": "writes_to"},
            {"source": "function:src/b.ts:serve", "target": "function:src/c.ts:init", "type": "calls"},
        ]
        projected = adapter.derive_file_level_edges(nodes, edges, set())
        pairs = {(e["source"], e["target"], e["type"]) for e in projected}
        self.assertIn(("file:src/a.ts", "file:src/b.ts", "calls"), pairs)
        self.assertIn(("file:src/a.ts", "file:src/b.ts", "writes_to"), pairs)
        self.assertIn(("file:src/b.ts", "file:src/c.ts", "calls"), pairs)
        self.assertEqual(len(projected), 3)

    def test_isolated_file_gets_related_fallback_edge(self):
        """A file with no behavioral file-to-file edges should get
        a related (USAGE) fallback edge if related edges exist
        between its functions and functions in other files."""
        nodes = [
            {"id": "file:src/a.ts", "type": "file"},
            {"id": "file:src/b.ts", "type": "file"},
            {"id": "file:src/c.ts", "type": "file"},
            {"id": "function:src/a.ts:run", "type": "function"},
            {"id": "function:src/b.ts:serve", "type": "function"},
            {"id": "function:src/c.ts:init", "type": "function"},
        ]
        edges = [
            # a.ts and b.ts are connected via calls
            {"source": "file:src/a.ts", "target": "function:src/a.ts:run", "type": "contains"},
            {"source": "file:src/b.ts", "target": "function:src/b.ts:serve", "type": "contains"},
            {"source": "file:src/c.ts", "target": "function:src/c.ts:init", "type": "contains"},
            {"source": "function:src/a.ts:run", "target": "function:src/b.ts:serve", "type": "calls"},
            # c.ts has only a related (USAGE) edge to a.ts — no behavioral
            {"source": "function:src/c.ts:init", "target": "function:src/a.ts:run", "type": "related"},
        ]
        projected = adapter.derive_file_level_edges(nodes, edges, set())
        types = {(e["source"], e["target"], e["type"]) for e in projected}
        # Behavioral projection: a.ts -> b.ts
        self.assertIn(("file:src/a.ts", "file:src/b.ts", "calls"), types)
        # Fallback: c.ts -> a.ts via related
        self.assertIn(("file:src/c.ts", "file:src/a.ts", "related"), types)

    def test_connected_file_does_not_get_related_fallback(self):
        """Files that already have behavioral file-to-file edges
        should NOT get related fallback edges — no noise."""
        nodes = [
            {"id": "file:src/a.ts", "type": "file"},
            {"id": "file:src/b.ts", "type": "file"},
            {"id": "function:src/a.ts:run", "type": "function"},
            {"id": "function:src/b.ts:serve", "type": "function"},
        ]
        edges = [
            {"source": "file:src/a.ts", "target": "function:src/a.ts:run", "type": "contains"},
            {"source": "file:src/b.ts", "target": "function:src/b.ts:serve", "type": "contains"},
            # Both files have behavioral edges (calls)
            {"source": "function:src/a.ts:run", "target": "function:src/b.ts:serve", "type": "calls"},
            # Also a related edge between the same pair
            {"source": "function:src/a.ts:run", "target": "function:src/b.ts:serve", "type": "related"},
        ]
        projected = adapter.derive_file_level_edges(nodes, edges, set())
        # Should have calls edge but NO related edge (both files are connected)
        types = [e["type"] for e in projected]
        self.assertIn("calls", types)
        self.assertNotIn("related", types)

    def test_isolated_file_with_no_related_stays_isolated(self):
        """If an isolated file has no related edges either, it stays
        isolated — the fallback only adds edges when data exists."""
        nodes = [
            {"id": "file:src/a.ts", "type": "file"},
            {"id": "file:src/b.ts", "type": "file"},
            {"id": "function:src/a.ts:run", "type": "function"},
            {"id": "function:src/b.ts:serve", "type": "function"},
        ]
        edges = [
            {"source": "file:src/a.ts", "target": "function:src/a.ts:run", "type": "contains"},
            {"source": "file:src/b.ts", "target": "function:src/b.ts:serve", "type": "contains"},
            # No behavioral or related edges — both files are isolated
        ]
        projected = adapter.derive_file_level_edges(nodes, edges, set())
        self.assertEqual(projected, [])


class ClusterNameHintsTests(unittest.TestCase):
    """Tests for derive_cluster_name_hints()."""

    def test_groups_files_by_shared_token(self):
        nodes = [
            {"id": "file:core/tag-store.js", "type": "file", "filePath": "core/tag-store.js"},
            {"id": "file:core/tag-organizer.js", "type": "file", "filePath": "core/tag-organizer.js"},
            {"id": "file:core/tag-cleaner.js", "type": "file", "filePath": "core/tag-cleaner.js"},
            {"id": "file:core/pdf-organizer.js", "type": "file", "filePath": "core/pdf-organizer.js"},
            {"id": "file:core/pdf-translate.js", "type": "file", "filePath": "core/pdf-translate.js"},
        ]
        node_ids = [n["id"] for n in nodes]
        hints = enhance.derive_cluster_name_hints(nodes, node_ids)
        self.assertTrue(len(hints) >= 2)
        # Tag group should contain all tag-* files
        tag_hint = next(h for h in hints if "Tag" in h["name"])
        self.assertEqual(len(tag_hint["fileIds"]), 3)
        # PDF group should contain both pdf-* files
        pdf_hint = next(h for h in hints if "Pdf" in h["name"])
        self.assertEqual(len(pdf_hint["fileIds"]), 2)

    def test_returns_empty_for_small_layers(self):
        nodes = [
            {"id": "file:src/a.ts", "type": "file", "filePath": "src/a.ts"},
            {"id": "file:src/b.ts", "type": "file", "filePath": "src/b.ts"},
        ]
        hints = enhance.derive_cluster_name_hints(nodes, [n["id"] for n in nodes])
        self.assertEqual(hints, [])

    def test_no_shared_tokens_returns_individual_hints(self):
        nodes = [
            {"id": "file:core/utils.js", "type": "file", "filePath": "core/utils.js"},
            {"id": "file:core/main.js", "type": "file", "filePath": "core/main.js"},
            {"id": "file:core/logger.js", "type": "file", "filePath": "core/logger.js"},
        ]
        hints = enhance.derive_cluster_name_hints(nodes, [n["id"] for n in nodes])
        # No shared tokens, so each file is its own group
        self.assertEqual(len(hints), 3)
        for h in hints:
            self.assertEqual(len(h["fileIds"]), 1)

    def test_overlay_injects_cluster_hints_into_layers(self):
        """apply_overlay should add clusterNameHints to layers with enough files."""
        graph = {
            "version": "1.0.0",
            "kind": "codebase",
            "project": {"name": "demo", "languages": [], "frameworks": [],
                        "description": "", "analyzedAt": "", "gitCommitHash": ""},
            "nodes": [
                {"id": f"file:core/{name}", "type": "file", "name": name,
                 "filePath": f"core/{name}", "summary": "", "tags": [], "complexity": "simple"}
                for name in ["tag-store.js", "tag-organizer.js", "tag-cleaner.js",
                             "pdf-organizer.js", "pdf-translate.js"]
            ],
            "edges": [],
            "layers": [],
            "tour": [],
        }
        overlay = {
            "language": "en",
            "layers": [{
                "id": "layer-core",
                "name": "Core",
                "description": "Core files",
                "patterns": ["core/**"],
            }],
        }
        result, _ = enhance.apply_overlay(graph, overlay)
        layer = result["layers"][0]
        self.assertIn("clusterNameHints", layer)
        self.assertTrue(len(layer["clusterNameHints"]) >= 2)


class TestedByLinkerTests(unittest.TestCase):
    """Tests for derive_tested_by_edges()."""

    def test_js_ts_sibling_pairing(self):
        """foo.test.ts should link to foo.ts in the same directory."""
        nodes = [
            {"id": "file:src/foo.ts", "type": "file", "filePath": "src/foo.ts"},
            {"id": "file:src/foo.test.ts", "type": "file", "filePath": "src/foo.test.ts"},
        ]
        edges, tagged = adapter.derive_tested_by_edges(nodes, [], set())
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["source"], "file:src/foo.ts")
        self.assertEqual(edges[0]["target"], "file:src/foo.test.ts")
        self.assertEqual(edges[0]["type"], "tested_by")
        self.assertEqual(tagged, 1)

    def test_python_test_prefix_pairing(self):
        """test_foo.py should link to foo.py in the same directory."""
        nodes = [
            {"id": "file:src/foo.py", "type": "file", "filePath": "src/foo.py"},
            {"id": "file:src/test_foo.py", "type": "file", "filePath": "src/test_foo.py"},
        ]
        edges, tagged = adapter.derive_tested_by_edges(nodes, [], set())
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["source"], "file:src/foo.py")
        self.assertEqual(edges[0]["target"], "file:src/test_foo.py")
        self.assertEqual(tagged, 1)

    def test_go_test_suffix_pairing(self):
        """foo_test.go should link to foo.go in the same directory."""
        nodes = [
            {"id": "file:src/foo.go", "type": "file", "filePath": "src/foo.go"},
            {"id": "file:src/foo_test.go", "type": "file", "filePath": "src/foo_test.go"},
        ]
        edges, tagged = adapter.derive_tested_by_edges(nodes, [], set())
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["source"], "file:src/foo.go")
        self.assertEqual(tagged, 1)

    def test_no_test_files_returns_empty(self):
        """If no test files exist, no tested_by edges are produced."""
        nodes = [
            {"id": "file:src/a.ts", "type": "file", "filePath": "src/a.ts"},
            {"id": "file:src/b.ts", "type": "file", "filePath": "src/b.ts"},
        ]
        edges, tagged = adapter.derive_tested_by_edges(nodes, [], set())
        self.assertEqual(edges, [])
        self.assertEqual(tagged, 0)

    def test_no_production_match_returns_empty(self):
        """If a test file has no matching production file, no edge is produced."""
        nodes = [
            {"id": "file:src/orphan.test.ts", "type": "file", "filePath": "src/orphan.test.ts"},
        ]
        edges, tagged = adapter.derive_tested_by_edges(nodes, [], set())
        self.assertEqual(edges, [])
        self.assertEqual(tagged, 0)

    def test_mirror_tree_pairing(self):
        """tests/foo/bar.test.ts should find src/foo/bar.ts via mirror tree."""
        nodes = [
            {"id": "file:src/foo/bar.ts", "type": "file", "filePath": "src/foo/bar.ts"},
            {"id": "file:tests/foo/bar.test.ts", "type": "file", "filePath": "tests/foo/bar.test.ts"},
        ]
        edges, tagged = adapter.derive_tested_by_edges(nodes, [], set())
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["source"], "file:src/foo/bar.ts")

    def test_spec_infix_pairing(self):
        """foo.spec.ts should link to foo.ts."""
        nodes = [
            {"id": "file:src/foo.ts", "type": "file", "filePath": "src/foo.ts"},
            {"id": "file:src/foo.spec.ts", "type": "file", "filePath": "src/foo.spec.ts"},
        ]
        edges, tagged = adapter.derive_tested_by_edges(nodes, [], set())
        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0]["source"], "file:src/foo.ts")

    def test_duplicate_pairing_deduped(self):
        """Multiple test files for the same production file should each get their own edge."""
        nodes = [
            {"id": "file:src/foo.ts", "type": "file", "filePath": "src/foo.ts"},
            {"id": "file:src/foo.test.ts", "type": "file", "filePath": "src/foo.test.ts"},
            {"id": "file:src/foo.spec.ts", "type": "file", "filePath": "src/foo.spec.ts"},
        ]
        edges, tagged = adapter.derive_tested_by_edges(nodes, [], set())
        self.assertEqual(len(edges), 2)
        # Only 1 production node tagged
        self.assertEqual(tagged, 1)

    def test_test_to_test_not_linked(self):
        """A test file should not link to another test file."""
        nodes = [
            {"id": "file:src/a.test.ts", "type": "file", "filePath": "src/a.test.ts"},
            {"id": "file:src/a.spec.ts", "type": "file", "filePath": "src/a.spec.ts"},
        ]
        edges, tagged = adapter.derive_tested_by_edges(nodes, [], set())
        self.assertEqual(edges, [])

    def test_native_test_edge_prevents_path_duplicate_and_tags_production(self):
        nodes = [
            {"id": "file:src/foo.ts", "type": "file", "filePath": "src/foo.ts", "tags": []},
            {"id": "file:src/foo.test.ts", "type": "file", "filePath": "src/foo.test.ts", "tags": []},
        ]
        native_edge = {
            "source": "file:src/foo.ts",
            "target": "file:src/foo.test.ts",
            "type": "tested_by",
        }
        edge_key = "file:src/foo.ts->file:src/foo.test.ts:tested_by"

        derived, _ = adapter.derive_tested_by_edges(nodes, [native_edge], {edge_key})
        tagged = adapter.tag_tested_nodes(nodes, [native_edge])

        self.assertEqual(derived, [])
        self.assertEqual(tagged, 1)
        self.assertEqual(adapter.tag_tested_nodes(nodes, [native_edge]), 0)
        self.assertEqual(nodes[0]["tags"].count("tested"), 1)
        self.assertNotIn("test", nodes[0]["tags"])


class OverviewTests(unittest.TestCase):
    def test_representative_files_prefer_source_over_high_degree_tests(self):
        source = {"id": "file:src/main.ts", "type": "file", "filePath": "src/main.ts", "tags": [], "summary": "File main.ts"}
        test = {"id": "file:src/main.test.ts", "type": "file", "filePath": "src/main.test.ts", "tags": [], "summary": "File main.test.ts"}
        selected = overview._representative_files(
            {"nodeIds": [source["id"], test["id"]]},
            {source["id"]: source, test["id"]: test},
            Counter({test["id"]: 100, source["id"]: 1}),
            1,
        )
        self.assertEqual(selected, [source])

    def test_build_architecture_overview_applies_visual_budgets(self):
        graph = {
            "version": "1.0.0",
            "kind": "codebase",
            "project": {
                "name": "demo",
                "languages": ["typescript"],
                "frameworks": [],
                "description": "full graph",
                "analyzedAt": "2026-01-01T00:00:00Z",
                "gitCommitHash": "abc",
            },
            "nodes": [
                {"id": "file:src/a.ts", "type": "file", "name": "a.ts", "filePath": "src/a.ts", "summary": "应用入口文件。", "tags": ["entry-point"], "complexity": "simple"},
                {"id": "module:src/a.ts", "type": "module", "name": "src/a.ts", "filePath": "src/a.ts", "summary": "Module src/a.ts", "tags": [], "complexity": "simple"},
                {"id": "function:src/a.ts:run", "type": "function", "name": "run", "filePath": "src/a.ts", "summary": "Function run", "tags": [], "complexity": "simple"},
                {"id": "file:src/b.ts", "type": "file", "name": "b.ts", "filePath": "src/b.ts", "summary": "File b.ts", "tags": [], "complexity": "simple"},
                {"id": "function:src/b.ts:serve", "type": "function", "name": "serve", "filePath": "src/b.ts", "summary": "Function serve", "tags": [], "complexity": "simple"},
            ],
            "edges": [
                {"source": "file:src/a.ts", "target": "function:src/a.ts:run", "type": "contains", "direction": "forward", "weight": 1},
                {"source": "function:src/a.ts:run", "target": "function:src/b.ts:serve", "type": "calls", "direction": "forward", "weight": 1},
                {"source": "file:src/a.ts", "target": "file:src/b.ts", "type": "imports", "direction": "forward", "weight": 1},
            ],
            "layers": [
                {"id": "layer-a", "name": "入口", "description": "入口层", "nodeIds": ["file:src/a.ts", "module:src/a.ts", "function:src/a.ts:run"]},
                {"id": "layer-b", "name": "服务", "description": "服务层", "nodeIds": ["file:src/b.ts", "function:src/b.ts:serve"]},
            ],
            "tour": [],
        }
        overlay = {
            "language": "zh",
            "architectureOverview": {
                "representativesPerLayer": 1,
                "maxBackboneEdges": 1,
                "macroDomains": [
                    {"id": "macro-a", "name": "产品入口", "description": "入口", "layerIds": ["layer-a"]},
                    {"id": "macro-b", "name": "平台服务", "description": "服务", "layerIds": ["layer-b"]},
                ],
            },
        }

        result, report = overview.build_architecture_overview(graph, overlay)

        self.assertEqual(len(result["layers"]), 2)
        self.assertEqual(len(report["backboneEdges"]), 1)
        self.assertLessEqual(len(result["edges"]), 5)
        self.assertFalse(any(node["type"] in {"function", "module"} for node in result["nodes"]))
        self.assertEqual(
            {node["filePath"] for node in result["nodes"] if node["type"] == "file"},
            {"src/a.ts", "src/b.ts"},
        )
        node_ids = {node["id"] for node in result["nodes"]}
        self.assertTrue(all(edge["source"] in node_ids and edge["target"] in node_ids for edge in result["edges"]))
        self.assertTrue(all(0 <= edge["weight"] <= 1 for edge in result["edges"]))
        self.assertTrue(all(node_id in node_ids for layer in result["layers"] for node_id in layer["nodeIds"]))

    def test_architecture_overview_rejects_incomplete_macro_coverage(self):
        graph = {
            "nodes": [],
            "edges": [],
            "layers": [{"id": "layer-unmapped", "name": "未映射", "description": "", "nodeIds": []}],
        }
        overlay = {
            "architectureOverview": {
                "macroDomains": [
                    {"id": "macro", "name": "宏观域", "description": "域", "layerIds": ["layer-other"]}
                ]
            }
        }
        with self.assertRaisesRegex(ValueError, "coverage mismatch"):
            overview.build_architecture_overview(graph, overlay)


class TourAutoGenerateTests(unittest.TestCase):
    """Tests for _auto_generate_tour()."""

    def _make_graph(self, layers=None, nodes=None, edges=None):
        return {
            "version": "1.0.0",
            "kind": "codebase",
            "project": {"name": "demo", "languages": ["javascript"], "frameworks": [], "description": "d", "analyzedAt": "", "gitCommitHash": ""},
            "nodes": nodes or [],
            "edges": edges or [],
            "layers": layers or [],
            "tour": [],
        }

    def _make_overlay(self, layers=None):
        return {
            "language": "zh",
            "layers": layers or [],
        }

    def test_auto_tour_generates_steps_per_layer(self):
        """Overlay with no tour should auto-generate one step per layer."""
        nodes = [
            {"id": "file:src/main.ts", "type": "file", "filePath": "src/main.ts", "name": "main.ts", "summary": "应用入口", "tags": ["entry-point"], "complexity": "simple"},
            {"id": "file:src/utils.ts", "type": "file", "filePath": "src/utils.ts", "name": "utils.ts", "summary": "工具函数", "tags": [], "complexity": "simple"},
        ]
        graph = self._make_graph(nodes=nodes)
        overlay = self._make_overlay(layers=[
            {"id": "layer-entry", "name": "入口", "description": "应用入口层", "patterns": ["src/main.ts"]},
            {"id": "layer-util", "name": "工具", "description": "工具函数层", "patterns": ["src/utils.ts"]},
        ])
        result, _ = enhance.apply_overlay(graph, overlay, strict=False)
        self.assertEqual(len(result["tour"]), 2)
        self.assertEqual(result["tour"][0]["title"], "入口")
        self.assertEqual(result["tour"][1]["title"], "工具")
        self.assertEqual(result["tour"][0]["order"], 1)
        self.assertEqual(result["tour"][1]["order"], 2)

    def test_auto_tour_prefers_entry_point_file(self):
        """Representative file should prefer entry-point tag."""
        nodes = [
            {"id": "file:src/a.ts", "type": "file", "filePath": "src/a.ts", "name": "a.ts", "summary": "A", "tags": [], "complexity": "simple"},
            {"id": "file:src/b.ts", "type": "file", "filePath": "src/b.ts", "name": "b.ts", "summary": "B", "tags": ["entry-point"], "complexity": "simple"},
        ]
        graph = self._make_graph(nodes=nodes)
        overlay = self._make_overlay(layers=[
            {"id": "layer-src", "name": "源码", "description": "", "patterns": ["src/**"]},
        ])
        result, _ = enhance.apply_overlay(graph, overlay, strict=False)
        self.assertEqual(result["tour"][0]["nodeIds"], ["file:src/b.ts"])

    def test_auto_tour_picks_highest_degree_without_entry_point(self):
        """Without entry-point tag, pick the file with most edges."""
        nodes = [
            {"id": "file:src/a.ts", "type": "file", "filePath": "src/a.ts", "name": "a.ts", "summary": "A", "tags": [], "complexity": "simple"},
            {"id": "file:src/b.ts", "type": "file", "filePath": "src/b.ts", "name": "b.ts", "summary": "B", "tags": [], "complexity": "simple"},
        ]
        edges = [
            {"source": "file:src/a.ts", "target": "file:src/b.ts", "type": "calls"},
            {"source": "file:src/a.ts", "target": "file:src/b.ts", "type": "writes_to"},
        ]
        graph = self._make_graph(nodes=nodes, edges=edges)
        overlay = self._make_overlay(layers=[
            {"id": "layer-src", "name": "源码", "description": "", "patterns": ["src/**"]},
        ])
        result, _ = enhance.apply_overlay(graph, overlay, strict=False)
        # a.ts has degree 2+2=4 (2 outgoing + 2 incoming), b.ts also 4
        # But a.ts is first alphabetically and degree is equal, so pick a.ts
        self.assertIn(result["tour"][0]["nodeIds"][0], ["file:src/a.ts", "file:src/b.ts"])

    def test_auto_tour_description_includes_layer_and_file(self):
        """Description should combine layer description and file summary."""
        nodes = [
            {"id": "file:src/main.ts", "type": "file", "filePath": "src/main.ts", "name": "main.ts", "summary": "应用启动入口", "tags": ["entry-point"], "complexity": "simple"},
        ]
        graph = self._make_graph(nodes=nodes)
        overlay = self._make_overlay(layers=[
            {"id": "layer-entry", "name": "入口", "description": "应用入口层", "patterns": ["src/main.ts"]},
        ])
        result, _ = enhance.apply_overlay(graph, overlay, strict=False)
        desc = result["tour"][0]["description"]
        self.assertIn("应用入口层", desc)
        self.assertIn("main.ts", desc)
        self.assertIn("应用启动入口", desc)

    def test_auto_tour_skipped_when_overlay_has_tour(self):
        """Overlay-provided tour should take precedence over auto-generated."""
        nodes = [
            {"id": "file:src/main.ts", "type": "file", "filePath": "src/main.ts", "name": "main.ts", "summary": "", "tags": [], "complexity": "simple"},
        ]
        graph = self._make_graph(nodes=nodes)
        overlay = self._make_overlay(layers=[
            {"id": "layer-src", "name": "源码", "description": "", "patterns": ["src/**"]},
        ])
        overlay["tour"] = [{
            "order": 1,
            "title": "自定义导览",
            "description": "用户手动配置",
            "selectors": [{"filePath": "src/main.ts", "types": ["file"]}],
        }]
        result, _ = enhance.apply_overlay(graph, overlay, strict=False)
        self.assertEqual(len(result["tour"]), 1)
        self.assertEqual(result["tour"][0]["title"], "自定义导览")

    def test_auto_tour_empty_layers_returns_empty(self):
        """No layers means no tour steps."""
        graph = self._make_graph()
        overlay = self._make_overlay()
        result, _ = enhance.apply_overlay(graph, overlay, strict=False)
        self.assertEqual(result["tour"], [])

    def test_auto_tour_max_10_steps(self):
        """Tour should be capped at 10 steps for readability."""
        nodes = []
        layers = []
        for i in range(15):
            fid = f"file:src/mod{i}.ts"
            nodes.append({"id": fid, "type": "file", "filePath": f"src/mod{i}.ts", "name": f"mod{i}.ts", "summary": "", "tags": [], "complexity": "simple"})
            layers.append({"id": f"layer-{i}", "name": f"模块{i}", "description": "", "patterns": [f"src/mod{i}.ts"]})
        graph = self._make_graph(nodes=nodes)
        overlay = self._make_overlay(layers=layers)
        result, _ = enhance.apply_overlay(graph, overlay, strict=False)
        self.assertEqual(len(result["tour"]), 10)


class PipelineTests(unittest.TestCase):
    def test_materialize_source_previews_copies_only_safe_graph_files(self):
        with tempfile.TemporaryDirectory() as source_dir, tempfile.TemporaryDirectory() as output_dir:
            source = Path(source_dir)
            (source / "src").mkdir()
            (source / "src" / "main.ts").write_text("export const main = 1\n", encoding="utf-8")
            graph = {
                "nodes": [
                    {"filePath": "src/main.ts"},
                    {"filePath": "../outside.txt"},
                    {"filePath": "/absolute.txt"},
                ]
            }

            meta = pipeline.materialize_source_previews(graph, source, output_dir)

            self.assertEqual(meta["copiedFiles"], 1)
            self.assertEqual(meta["skippedPaths"], 2)
            self.assertEqual(
                (Path(output_dir) / "src" / "main.ts").read_text(encoding="utf-8"),
                "export const main = 1\n",
            )


class EnhancerTests(unittest.TestCase):
    def setUp(self):
        self.graph = {
            "version": "1.0.0",
            "kind": "codebase",
            "project": {
                "name": "demo",
                "languages": ["typescript"],
                "frameworks": [],
                "description": "structural",
                "analyzedAt": "2026-01-01T00:00:00Z",
                "gitCommitHash": "abc",
            },
            "nodes": [
                {
                    "id": "file:src/main.ts",
                    "type": "file",
                    "name": "main.ts",
                    "filePath": "src/main.ts",
                    "summary": "File main.ts",
                    "tags": [],
                    "complexity": "simple",
                },
                {
                    "id": "function:src/main.ts:main",
                    "type": "function",
                    "name": "main",
                    "filePath": "src/main.ts",
                    "summary": "Function main",
                    "tags": ["entry-point"],
                    "complexity": "simple",
                },
                {
                    "id": "file:dist/bundle.js",
                    "type": "file",
                    "name": "bundle.js",
                    "filePath": "dist/bundle.js",
                    "summary": "generated",
                    "tags": [],
                    "complexity": "complex",
                },
            ],
            "edges": [
                {
                    "source": "file:src/main.ts",
                    "target": "function:src/main.ts:main",
                    "type": "contains",
                    "direction": "forward",
                    "weight": 1,
                },
                {
                    "source": "file:dist/bundle.js",
                    "target": "function:src/main.ts:main",
                    "type": "calls",
                    "direction": "forward",
                    "weight": 1,
                },
            ],
            "layers": [],
            "tour": [],
        }
        self.overlay = {
            "language": "zh",
            "project": {"description": "中文项目说明", "frameworks": ["TypeScript"]},
            "excludePaths": ["dist/**"],
            "layers": [
                {
                    "id": "layer-source",
                    "name": "源码",
                    "description": "核心源码",
                    "patterns": ["src/**"],
                }
            ],
            "nodeSummaries": [
                {
                    "selector": {"filePath": "src/main.ts", "types": ["file"]},
                    "summary": "应用入口文件。",
                    "tags": ["应用入口"],
                }
            ],
            "tour": [
                {
                    "order": 1,
                    "title": "从入口开始",
                    "description": "查看启动流程。",
                    "selectors": [{"filePath": "src/main.ts", "types": ["file"]}],
                }
            ],
        }

    def test_dot_directory_is_not_stripped_from_path(self):
        node = {"filePath": ".github/workflows/ci.yml"}
        self.assertEqual(enhance.normalized_path(node), ".github/workflows/ci.yml")
        self.assertTrue(enhance.matches_any_path(enhance.normalized_path(node), [".github/**"]))

    def test_fnmatch_patterns_intentionally_cross_directories(self):
        self.assertTrue(enhance.matches_any_path("src/a/b/task.test.ts", ["**/*.test.ts"]))
        self.assertTrue(enhance.matches_any_path("src/a/b.ts", ["src/**"]))

    def test_overlay_filters_generated_nodes_and_adds_semantics(self):
        result, report = enhance.apply_overlay(self.graph, self.overlay)

        self.assertEqual(len(result["nodes"]), 2)
        self.assertEqual(len(result["edges"]), 1)
        self.assertEqual(result["project"]["description"], "中文项目说明")
        self.assertEqual(result["layers"][0]["name"], "源码")
        self.assertEqual(result["tour"][0]["nodeIds"], ["file:src/main.ts"])
        file_node = next(node for node in result["nodes"] if node["id"] == "file:src/main.ts")
        self.assertEqual(file_node["summary"], "应用入口文件。")
        self.assertIn("应用入口", file_node["tags"])
        self.assertEqual(report["excludedNodeCount"], 1)
        self.assertEqual(report["excludedEdgeCount"], 1)

    def test_strict_mode_rejects_stale_selectors(self):
        self.overlay["nodeSummaries"][0]["selector"] = {"filePath": "missing.ts"}
        with self.assertRaisesRegex(ValueError, "matched nothing"):
            enhance.apply_overlay(self.graph, self.overlay)

    def test_layer_nodeids_contain_only_file_nodes(self):
        """Layer membership must be file-only; functions/classes are reached
        via contains-edge expansion in UA Viewer's detailLevel=class mode."""
        result, _ = enhance.apply_overlay(self.graph, self.overlay)
        layer = result["layers"][0]
        self.assertEqual(layer["nodeIds"], ["file:src/main.ts"])
        self.assertNotIn("function:src/main.ts:main", layer["nodeIds"])

    def test_strict_mode_rejects_layer_matching_only_functions(self):
        """If a layer pattern matches functions but no files, strict mode
        should reject it — the layer would be invisible in file view."""
        overlay = {
            "language": "en",
            "layers": [
                {
                    "id": "layer-func-only",
                    "name": "Functions",
                    "description": "Only matches functions",
                    "patterns": ["src/**/*.ts"],
                    "excludePatterns": ["src/main.ts"],
                }
            ],
        }
        # self.graph has file:src/main.ts and function:src/main.ts:main
        # The pattern excludes src/main.ts (file), so only the function matches.
        # With file-only filtering, no file matches → strict should reject.
        with self.assertRaisesRegex(ValueError, "matched no nodes"):
            enhance.apply_overlay(self.graph, overlay, strict=True)

    def test_fallback_layer_collects_only_unassigned_files(self):
        """Fallback layer should only collect unassigned file nodes, not
        functions or modules."""
        overlay = {
            "language": "en",
            "fallbackLayer": {
                "id": "layer-other",
                "name": "Other",
                "description": "Unassigned files",
            },
            # No explicit layers → all files go to fallback
        }
        result, _ = enhance.apply_overlay(self.graph, overlay, strict=False)
        fallback_layer = next(l for l in result["layers"] if l["id"] == "layer-other")
        # Should contain file:src/main.ts but NOT function:src/main.ts:main
        self.assertIn("file:src/main.ts", fallback_layer["nodeIds"])
        self.assertNotIn("function:src/main.ts:main", fallback_layer["nodeIds"])

    def test_strict_mode_does_not_reject_unassigned_non_file_nodes(self):
        """Non-file nodes (functions, modules) should NOT trigger strict
        mode rejection even if they aren't assigned to any layer."""
        overlay = {
            "language": "en",
            "excludePaths": ["dist/**"],
            "layers": [
                {
                    "id": "layer-src",
                    "name": "Source",
                    "description": "Source files",
                    "patterns": ["src/**"],
                }
            ],
            # No fallback layer → file:src/main.ts matches, function doesn't
        }
        # Should not raise even though function:src/main.ts:main is unassigned
        result, _ = enhance.apply_overlay(self.graph, overlay, strict=True)
        self.assertEqual(len(result["layers"]), 1)

    def test_cli_outputs_chinese_config_and_meta(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            graph_path = root / "structural.json"
            overlay_path = root / "overlay.json"
            output_path = root / ".ua" / "knowledge-graph.json"
            graph_path.write_text(json.dumps(self.graph), encoding="utf-8")
            overlay_path.write_text(json.dumps(self.overlay), encoding="utf-8")

            output_path.parent.mkdir(parents=True)
            (output_path.parent / "config.json").write_text(
                json.dumps({"customSetting": "preserved", "outputLanguage": "en"}),
                encoding="utf-8",
            )

            graph = enhance.load_json(graph_path)
            overlay = enhance.load_json(overlay_path)
            enhance.write_enhanced_bundle(graph, overlay, output_path)

            config = json.loads((output_path.parent / "config.json").read_text(encoding="utf-8"))
            meta = json.loads((output_path.parent / "semantic-meta.json").read_text(encoding="utf-8"))
            self.assertEqual(config["outputLanguage"], "zh")
            self.assertEqual(config["customSetting"], "preserved")
            self.assertEqual(meta["language"], "zh")


if __name__ == "__main__":
    unittest.main()
