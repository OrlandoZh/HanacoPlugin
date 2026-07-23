#!/usr/bin/env python3
"""
cbm2ua - Convert codebase-memory-mcp graph to Understand-Anything knowledge-graph.json

Pipeline: cbm SQLite graph -> adapter -> UA knowledge-graph.json -> UA dashboard

Usage:
    python3 adapter.py --project <cbm_project_name> --output <output_path> [--root <project_root>]

    python3 adapter.py \
      --project <cbm-project-name> \
      --root /path/to/project \
      --output /tmp/ua-test/.ua/knowledge-graph.json
"""

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time

CBM_BIN = os.environ.get(
    "CBM_BIN",
    os.path.expanduser("~/.local/bin/codebase-memory-mcp"),
)
CBM_TIMEOUT_SECONDS = int(os.environ.get("CBM_TIMEOUT_SECONDS", "120"))
QUERY_ROW_LIMIT = 100_000

# ── Mapping tables ──────────────────────────────────────────────────────────

# cbm node label -> UA node type
NODE_TYPE_MAP = {
    "File": "file",
    "Function": "function",
    "Method": "function",
    "Class": "class",
    "Interface": "class",
    "Type": "class",
    "Module": "module",
    "Variable": "concept",
    "Section": "document",
    "Folder": "module",
    "Project": "module",
    "Route": "endpoint",
    "Channel": "concept",
    "EnvVar": "config",
}

# cbm edge type -> UA edge type
EDGE_TYPE_MAP = {
    "CALLS": "calls",
    "IMPORTS": "imports",
    "DEFINES": "contains",
    "DEFINES_METHOD": "contains",
    "CONTAINS_FILE": "contains",
    "CONTAINS_FOLDER": "contains",
    "USAGE": "related",
    "WRITES": "writes_to",
    "CONFIGURES": "configures",
    "READS": "reads_from",
    "DATA_FLOWS": "transforms",
    "HTTP_CALLS": "routes",
    "ASYNC_CALLS": "publishes",
    "LISTENS_ON": "subscribes",
    "TESTS_FILE": "tested_by",
    "INHERITS": "inherits",
    "SIMILAR_TO": "similar_to",
    "SEMANTICALLY_RELATED": "related",
    "DECORATES": "configures",
}

# Node labels to skip (noise for dashboard)
SKIP_LABELS = {"Variable", "Section", "EnvVar"}


def cbm_cli(tool: str, params: dict) -> dict:
    """Run a single cbm CLI tool call using flag-style arguments.

    The legacy raw-JSON argument format is deprecated upstream;
    --flag value pairs avoid shell-quoting issues on all platforms.
    """
    args = [CBM_BIN, "cli", tool]
    for key, value in params.items():
        args.extend([f"--{key}", str(value)])
    result = subprocess.run(
        args,
        capture_output=True, text=True, timeout=CBM_TIMEOUT_SECONDS
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"cbm tool {tool} failed ({result.returncode}): "
            f"{result.stderr.strip() or result.stdout.strip()}"
        )

    lines = [line for line in result.stdout.strip().split("\n") if not line.startswith("level=")]
    output = "\n".join(lines)
    if not output:
        raise RuntimeError(f"cbm tool {tool} returned no JSON output")
    return json.loads(output)


def get_graph_schema(project: str) -> dict:
    """Read cbm label/type counts used to prevent silent query truncation."""
    return cbm_cli("get_graph_schema", {"project": project})


def query_nodes(project: str, schema: dict | None = None) -> list:
    """Query all non-skipped node labels in a single batch and verify counts.

    Previous implementation issued one cbm_cli call per label (up to 14 calls).
    Batch approach: 1 call with MATCH (n), filter SKIP_LABELS in Python,
    then verify per-label row counts against the schema.
    """
    schema = schema or get_graph_schema(project)

    # The Cypher query returns skipped labels too, so preflight the raw total.
    schema_labels = schema.get("node_labels", [])
    raw_total = sum(int(entry.get("count") or 0) for entry in schema_labels)
    expected_by_label = {}
    for entry in schema_labels:
        label = entry.get("label")
        count = int(entry.get("count") or 0)
        if label in SKIP_LABELS:
            continue
        if count > QUERY_ROW_LIMIT:
            raise RuntimeError(
                f"cbm label {label} has {count} rows, above the {QUERY_ROW_LIMIT} "
                "query_graph ceiling; scope the repository before conversion"
            )
        expected_by_label[label] = count

    total_expected = sum(expected_by_label.values())
    if raw_total > QUERY_ROW_LIMIT:
        raise RuntimeError(
            f"cbm raw node total {raw_total} (retained {total_expected}) above the "
            f"{QUERY_ROW_LIMIT} query_graph ceiling; scope or shard the repository before conversion"
        )

    query = (
        "MATCH (n) "
        "RETURN labels(n) AS label, n.name AS name, "
        "n.qualified_name AS qn, n.file_path AS fp, "
        "n.start_line AS sl, n.end_line AS el, "
        "n.complexity AS cx, n.is_entry_point AS ep, "
        "n.is_exported AS ex, n.is_test AS test, "
        "n.lines AS lines, n.docstring AS doc, "
        "n.signature AS sig, n.parent_class AS pc"
    )
    data = cbm_cli(
        "query_graph",
        {"project": project, "query": query, "max_rows": QUERY_ROW_LIMIT},
    )
    all_rows = data.get("rows", [])

    # Filter out skipped labels and collect kept rows
    rows = []
    actual_by_label = {}
    for row in all_rows:
        label_str = row[0] if row else ""
        # labels(n) returns a JSON array string like ["File"]
        try:
            labels = json.loads(label_str) if isinstance(label_str, str) else []
        except (json.JSONDecodeError, TypeError):
            labels = []
        label = labels[0] if labels else ""
        if label in SKIP_LABELS:
            continue
        rows.append(row)
        actual_by_label[label] = actual_by_label.get(label, 0) + 1

    # Verify per-label counts
    for label, expected in expected_by_label.items():
        actual = actual_by_label.get(label, 0)
        if actual != expected:
            raise RuntimeError(
                f"cbm node query for {label} returned {actual} rows; expected {expected}"
            )

    return rows


def query_edges(project: str, schema: dict | None = None) -> list:
    """Query all edges in a single batch, filter by mapped types, and log unmapped.

    Previous implementation issued one cbm_cli call per mapped edge type (up to 12 calls).
    Batch approach: 1 call with MATCH (a)-[r]->(b), filter in Python,
    log unmapped edge types as warnings, verify per-type counts.
    """
    schema = schema or get_graph_schema(project)

    # The Cypher query returns unmapped types too, so preflight the raw total.
    schema_edges = schema.get("edge_types", [])
    raw_total = sum(int(entry.get("count") or 0) for entry in schema_edges)
    expected_by_type = {}
    unmapped_types = []
    for entry in schema_edges:
        edge_type = entry.get("type")
        count = int(entry.get("count") or 0)
        if edge_type not in EDGE_TYPE_MAP:
            if count > 0:
                unmapped_types.append((edge_type, count))
            continue
        if count > QUERY_ROW_LIMIT:
            raise RuntimeError(
                f"cbm edge type {edge_type} has {count} rows, above the {QUERY_ROW_LIMIT} "
                "query_graph ceiling; scope the repository before conversion"
            )
        expected_by_type[edge_type] = count

    # Log unmapped edge types (P2: no longer silently dropped)
    for edge_type, count in unmapped_types:
        print(f"[adapter] WARNING: unmapped edge type '{edge_type}' ({count} edges) skipped", file=sys.stderr)

    total_expected = sum(expected_by_type.values())
    if raw_total > QUERY_ROW_LIMIT:
        raise RuntimeError(
            f"cbm raw edge total {raw_total} (retained {total_expected}) above the "
            f"{QUERY_ROW_LIMIT} query_graph ceiling; scope or shard the repository before conversion"
        )

    query = (
        "MATCH (a)-[r]->(b) "
        "RETURN a.qualified_name AS src, b.qualified_name AS tgt, "
        "type(r) AS rel, labels(a) AS src_label, labels(b) AS tgt_label"
    )
    data = cbm_cli(
        "query_graph",
        {"project": project, "query": query, "max_rows": QUERY_ROW_LIMIT},
    )
    all_rows = data.get("rows", [])

    # Filter to mapped edge types and collect kept rows
    rows = []
    actual_by_type = {}
    for row in all_rows:
        edge_type = row[2] if len(row) > 2 else ""
        if edge_type not in EDGE_TYPE_MAP:
            continue
        rows.append(row)
        actual_by_type[edge_type] = actual_by_type.get(edge_type, 0) + 1

    # Verify per-type counts
    for edge_type, expected in expected_by_type.items():
        actual = actual_by_type.get(edge_type, 0)
        if actual != expected:
            raise RuntimeError(
                f"cbm edge query for {edge_type} returned {actual} rows; expected {expected}"
            )

    return rows


def map_complexity(cx_str: str) -> str:
    """Map cbm cyclomatic complexity to UA complexity rating."""
    try:
        cx = int(float(cx_str)) if cx_str else 0
    except (ValueError, TypeError):
        return "simple"
    if cx <= 5:
        return "simple"
    elif cx <= 10:
        return "moderate"
    else:
        return "complex"


def make_node_id(label: str, file_path: str, name: str, qn: str) -> str:
    """Generate UA-compatible node ID."""
    ua_type = NODE_TYPE_MAP.get(label, "concept")
    # Clean file path - use as-is if it looks like a relative path
    fp = file_path or ""
    if ua_type == "file":
        return f"file:{fp}"
    elif ua_type == "function":
        return f"function:{fp}:{name}"
    elif ua_type == "class":
        return f"class:{fp}:{name}"
    elif ua_type == "module":
        return f"module:{name}"
    elif ua_type == "endpoint":
        return f"endpoint:{fp}:{name}"
    else:
        return f"concept:{fp}:{name}"


def parse_node(row: list) -> dict | None:
    """Convert a cbm node row to UA node dict."""
    # row = [label_json, name, qn, fp, sl, el, cx, ep, ex, test, lines, doc, sig, pc]
    if len(row) < 11:
        return None

    label_raw = row[0]
    # Parse label JSON array string like '["File"]'
    try:
        labels = json.loads(label_raw) if isinstance(label_raw, str) else label_raw
    except (json.JSONDecodeError, TypeError):
        labels = [label_raw]

    label = labels[0] if labels else "Unknown"

    # Skip noisy node types
    if label in SKIP_LABELS:
        return None

    name = row[1] or "unknown"
    qn = row[2] or ""
    fp = row[3] or ""
    cx = row[6] if len(row) > 6 else ""
    ep = row[7] if len(row) > 7 else ""
    ex = row[8] if len(row) > 8 else ""
    test = row[9] if len(row) > 9 else ""
    lines = row[10] if len(row) > 10 else ""
    doc = row[11] if len(row) > 11 else ""
    sig = row[12] if len(row) > 12 else ""
    pc = row[13] if len(row) > 13 else ""

    ua_type = NODE_TYPE_MAP.get(label, "concept")

    # Build tags from cbm properties and structural signals
    tags = []
    if ep and ep != "false":
        tags.append("entry-point")
    if ex and ex != "false":
        tags.append("exported")
    if test and test != "false":
        tags.append("tested")
    # Derive semantic tags from signature and file path
    if sig:
        sig_lower = sig.lower()
        if "async" in sig_lower or "promise" in sig_lower:
            tags.append("async")
        if "callback" in sig_lower or "=>" in sig:
            tags.append("callback")
    if fp:
        fp_lower = fp.lower()
        if "/api/" in fp_lower or "/routes/" in fp_lower or "/endpoint" in fp_lower:
            tags.append("api")
        if "/test" in fp_lower or "/spec" in fp_lower or "/__tests__" in fp_lower:
            tags.append("test-file")
        if "/ui/" in fp_lower or "/component" in fp_lower or "/view" in fp_lower:
            tags.append("ui")
        if "/db" in fp_lower or "/model" in fp_lower or "/store" in fp_lower:
            tags.append("data")
        if "/util" in fp_lower or "/helper" in fp_lower or "/lib/" in fp_lower:
            tags.append("utility")

    # Build summary: docstring > structural > bare name
    summary = ""
    if doc and doc.strip():
        summary = doc.strip()[:200]
    else:
        # Generate a structural summary from signature and parent class
        kind_label = label.lower() if label else ua_type
        if pc and ua_type == "function":
            # Method on a class
            base = f"{kind_label} {pc}.{name}"
        else:
            base = f"{kind_label} {name}"
        if sig and sig.strip():
            # Truncate very long signatures
            sig_short = sig.strip()[:120]
            summary = f"{base} — {sig_short}"
        else:
            summary = base

    node_id = make_node_id(label, fp, name, qn)

    # Skip duplicate module entries for folders
    if ua_type == "module" and "." in name and "__file__" in name:
        return None

    node = {
        "id": node_id,
        "type": ua_type,
        "name": name,
        "filePath": fp,
        "summary": summary,
        "tags": tags,
        "complexity": map_complexity(cx),
    }

    # Add line range if available
    try:
        sl = int(row[4]) if row[4] else 0
        el = int(row[5]) if row[5] else 0
        if sl and el and el > sl:
            node["lineRange"] = [sl, el]
    except (ValueError, TypeError):
        pass

    return node


def unique_node_id(base_id: str, qualified_name: str, used_ids: set[str]) -> str:
    """Keep UA-style IDs while disambiguating overloads and duplicate names."""
    if base_id not in used_ids:
        return base_id
    suffix = hashlib.sha1(qualified_name.encode("utf-8")).hexdigest()[:8]
    candidate = f"{base_id}~{suffix}"
    sequence = 2
    while candidate in used_ids:
        candidate = f"{base_id}~{suffix}-{sequence}"
        sequence += 1
    return candidate


def auto_generate_layers(nodes: list) -> list:
    """Auto-generate architectural layers based on file paths."""
    # Group nodes by top-level directory
    dir_groups = {}
    for node in nodes:
        fp = node.get("filePath", "")
        if not fp:
            continue
        # Get top-level directory
        parts = fp.replace("\\", "/").split("/")
        if len(parts) > 1:
            top_dir = parts[0]
        else:
            top_dir = "root"
        
        if top_dir not in dir_groups:
            dir_groups[top_dir] = []
        dir_groups[top_dir].append(node["id"])
    
    # Map directory names to layer names
    layer_name_map = {
        "src": "Source Code",
        "lib": "Library",
        "test": "Tests",
        "tests": "Tests",
        "__tests__": "Tests",
        "spec": "Tests",
        "docs": "Documentation",
        "doc": "Documentation",
        "config": "Configuration",
        "configs": "Configuration",
        "scripts": "Scripts",
        "tools": "Tools",
        "build": "Build",
        "dist": "Build Output",
        "public": "Public Assets",
        "static": "Static Assets",
        "assets": "Assets",
        "addon": "Addon",
        "electron": "Electron",
        "node_modules": "Dependencies",
    }
    
    layers = []
    for dir_name, node_ids in sorted(dir_groups.items()):
        if len(node_ids) < 2:
            continue  # Skip tiny groups
        layer_name = layer_name_map.get(dir_name, dir_name.replace("-", " ").replace("_", " ").title())
        layers.append({
            "id": f"layer-{dir_name}",
            "name": layer_name,
            "description": f"Auto-generated layer from {dir_name}/ directory ({len(node_ids)} nodes)",
            "nodeIds": node_ids,
        })
    
    return layers


def detect_languages(nodes: list) -> list:
    """Detect programming languages from file extensions."""
    ext_map = {
        ".ts": "typescript", ".tsx": "typescript",
        ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript",
        ".py": "python",
        ".go": "go",
        ".rs": "rust",
        ".java": "java",
        ".rb": "ruby",
        ".php": "php",
        ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp",
        ".cs": "csharp",
        ".swift": "swift",
        ".kt": "kotlin",
    }
    languages = set()
    for node in nodes:
        fp = node.get("filePath", "")
        ext = os.path.splitext(fp)[1].lower()
        if ext in ext_map:
            languages.add(ext_map[ext])
    return sorted(languages)


def get_git_hash(project_root: str) -> str:
    """Get current git commit hash."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True, text=True, cwd=project_root, timeout=10
        )
        return result.stdout.strip() if result.returncode == 0 else "unknown"
    except Exception:
        return "unknown"


# Edge types eligible for file-level projection.
# "contains" is excluded (it's the structural ownership edge used
# to build the parent_file map). "related" is excluded because
# USAGE edges are too vague to carry meaningful file-level semantics.
BEHAVIORAL_EDGE_TYPES = frozenset({
    "calls", "writes_to", "imports", "routes",
    "reads_from", "transforms", "configures", "publishes",
})


def derive_file_level_edges(
    nodes: list[dict],
    edges: list[dict],
    existing_keys: set[str],
) -> list[dict]:
    """Project behavioral edges (calls, writes_to, etc.) to file-level.

    For each behavioral edge between non-file nodes, find the owning
    file of source and target via contains edges. If both files differ,
    emit a weighted file-to-file edge. Original edges are preserved.

    Args:
        nodes: UA nodes list (used to identify file-type nodes).
        edges: UA edges list (contains edges build the parent map;
               behavioral edges are projected).
        existing_keys: set of "src->tgt:type" strings already present;
            projected edges matching these are skipped to avoid duplicates.

    Returns:
        List of projected file-level edge dicts. Does not modify inputs.
    """
    file_ids = {n["id"] for n in nodes if n.get("type") == "file"}

    # Build parent_file: node_id -> file_id via contains edges
    parent_file = {}
    for e in edges:
        if e["type"] == "contains":
            src, tgt = e["source"], e["target"]
            if src in file_ids and tgt not in file_ids:
                parent_file[tgt] = src

    def _owner(node_id: str) -> str | None:
        if node_id in file_ids:
            return node_id
        return parent_file.get(node_id)

    # Aggregate file-to-file edge counts
    file_edge_counts: dict[tuple[str, str, str], int] = {}
    for e in edges:
        etype = e["type"]
        if etype not in BEHAVIORAL_EDGE_TYPES:
            continue
        src_file = _owner(e["source"])
        tgt_file = _owner(e["target"])
        if not src_file or not tgt_file or src_file == tgt_file:
            continue
        key = (src_file, tgt_file, etype)
        file_edge_counts[key] = file_edge_counts.get(key, 0) + 1

    if not file_edge_counts:
        return []

    # Emit projected edges (deduplicated, weighted)
    projected: list[dict] = []
    for (src_file, tgt_file, etype), count in sorted(file_edge_counts.items()):
        ek = f"{src_file}->{tgt_file}:{etype}"
        if ek in existing_keys:
            continue
        existing_keys.add(ek)
        # Uniform weight: UA Viewer's aggregateContainerEdges uses
        # count for strokeWidth; weight only affects backbone
        # selection. A flat 1.0 avoids subjective scaling.
        projected.append({
            "source": src_file,
            "target": tgt_file,
            "type": etype,
            "direction": "forward",
            "weight": 1.0,
        })

    # ── Isolated file fallback via related (USAGE) edges ──────
    # After behavioral projection, some files may still have no
    # file-to-file edges at all — they appear as scattered dots in
    # UA Viewer. For these completely isolated files, project
    # related (USAGE) edges as weak fallback links.
    # Constraint: only add edges for files with ZERO existing
    # file-to-file edges (behavioral or projected). This avoids
    # adding noise to well-connected files.

    # Build set of files that already have file-to-file edges
    connected_files: set[str] = set()
    for e in edges:
        if e.get("type") in BEHAVIORAL_EDGE_TYPES and e["source"] in file_ids and e["target"] in file_ids:
            connected_files.add(e["source"])
            connected_files.add(e["target"])
    for p in projected:
        connected_files.add(p["source"])
        connected_files.add(p["target"])

    isolated_files = file_ids - connected_files
    if isolated_files:
        # Aggregate related (USAGE) edges for isolated files only
        related_counts: dict[tuple[str, str], int] = {}
        for e in edges:
            if e["type"] != "related":
                continue
            src_file = _owner(e["source"])
            tgt_file = _owner(e["target"])
            if not src_file or not tgt_file or src_file == tgt_file:
                continue
            # Only project if at least one endpoint is an isolated file
            if src_file not in isolated_files and tgt_file not in isolated_files:
                continue
            key = (src_file, tgt_file)
            related_counts[key] = related_counts.get(key, 0) + 1

        for (src_file, tgt_file), count in sorted(related_counts.items()):
            ek = f"{src_file}->{tgt_file}:related"
            if ek in existing_keys:
                continue
            existing_keys.add(ek)
            projected.append({
                "source": src_file,
                "target": tgt_file,
                "type": "related",
                "direction": "forward",
                "weight": 1.0,
            })

    return projected


# ── Deterministic tested_by linker ──────────────────────────────
# Ported from UA's merge-batch-graphs.py link_tests() Pass 2.
# cbm TESTS_FILE edges are authoritative; path conventions only fill gaps.

_JS_TS_EXTS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".vue")
_JS_TS_TEST_EXTS = frozenset(_JS_TS_EXTS)
_MIRROR_PRODUCTION_ROOTS = ("src", "app", "lib", "")

_TEST_NAME_PATTERNS = {
    ".go": ((), ("_test",)),
    ".py": (("test_",), ("_test",)),
    ".java": ((), ("Test", "Tests", "IT")),
    ".kt": ((), ("Test", "Tests")),
    ".c": (("test_",), ("_test",)),
    ".cpp": (("test_",), ("_test",)),
    ".cc": (("test_",), ("_test",)),
}


def _is_test_path(path: str) -> bool:
    """Return True if path looks like a test file by basename convention."""
    basename = os.path.basename(path)
    stem, ext = os.path.splitext(basename)
    if ext in _JS_TS_TEST_EXTS:
        return stem.endswith(".test") or stem.endswith(".spec")
    patterns = _TEST_NAME_PATTERNS.get(ext)
    if patterns is None:
        return False
    prefixes, suffixes = patterns
    return any(stem.startswith(p) for p in prefixes) or any(stem.endswith(s) for s in suffixes)


def _strip_test_infix(stem: str) -> str | None:
    for infix in (".test", ".spec"):
        if stem.endswith(infix):
            return stem[: -len(infix)]
    return None


def _production_candidates(test_path: str) -> list[str]:
    """For a test file path, return ordered candidate production paths."""
    basename = os.path.basename(test_path)
    stem, ext = os.path.splitext(basename)
    segs = test_path.replace("\\", "/").split("/")
    dir_segs = segs[:-1]
    dir_path = "/".join(dir_segs)
    candidates: list[str] = []

    def _add(p: str) -> None:
        if p and p not in candidates:
            candidates.append(p)

    if ext in _JS_TS_TEST_EXTS:
        base_stem = _strip_test_infix(stem)
        if base_stem is not None:
            _add(f"{dir_path}/{base_stem}{ext}" if dir_path else f"{base_stem}{ext}")
            for e in _JS_TS_EXTS:
                _add(f"{dir_path}/{base_stem}{e}" if dir_path else f"{base_stem}{e}")
            if dir_segs and dir_segs[-1] in ("__tests__", "test", "spec", "tests"):
                parent = "/".join(dir_segs[:-1])
                _add(f"{parent}/{base_stem}{ext}" if parent else f"{base_stem}{ext}")
                for e in _JS_TS_EXTS:
                    _add(f"{parent}/{base_stem}{e}" if parent else f"{base_stem}{e}")
            if dir_segs and dir_segs[0] in ("tests", "test", "__tests__"):
                tail = "/".join(dir_segs[1:])
                for root in _MIRROR_PRODUCTION_ROOTS:
                    new_dir = "/".join(p for p in (root, tail) if p)
                    _add(f"{new_dir}/{base_stem}{ext}" if new_dir else f"{base_stem}{ext}")
                    for e in _JS_TS_EXTS:
                        _add(f"{new_dir}/{base_stem}{e}" if new_dir else f"{base_stem}{e}")
    elif ext == ".go" and stem.endswith("_test"):
        base = stem[: -len("_test")]
        _add(f"{dir_path}/{base}.go" if dir_path else f"{base}.go")
    elif ext == ".py" and (stem.startswith("test_") or stem.endswith("_test")):
        base = stem[len("test_"):] if stem.startswith("test_") else stem[: -len("_test")]
        _add(f"{dir_path}/{base}.py" if dir_path else f"{base}.py")
        if dir_segs and dir_segs[-1] in ("tests", "test"):
            parent = "/".join(dir_segs[:-1])
            _add(f"{parent}/{base}.py" if parent else f"{base}.py")
        if dir_segs and dir_segs[0] in ("tests", "test"):
            tail = "/".join(dir_segs[1:])
            for root in _MIRROR_PRODUCTION_ROOTS:
                new_dir = "/".join(p for p in (root, tail) if p)
                _add(f"{new_dir}/{base}.py" if new_dir else f"{base}.py")
    elif ext in (".java", ".kt") and any(stem.endswith(s) for s in ("Test", "Tests")):
        base = stem
        for suffix in ("Test", "Tests"):
            if base.endswith(suffix):
                base = base[: -len(suffix)]
                break
        _add(f"{dir_path}/{base}.{ext[1:]}" if dir_path else f"{base}.{ext[1:]}")

    return candidates


def derive_tested_by_edges(
    nodes: list[dict],
    edges: list[dict],
    existing_keys: set[str],
) -> tuple[list[dict], int]:
    """Link test files to production files by path convention.

    Ported from UA's link_tests() Pass 2. For each file node that looks
    like a test file, find the first matching production file by path
    convention and emit a tested_by edge. Also returns the count of
    production nodes that should be tagged "tested".

    Returns (edges, tagged_count) where tagged_count is the number of
    production nodes newly linked. Caller is responsible for adding
    the "tested" tag to those nodes.
    """
    file_nodes = [n for n in nodes if n.get("type") == "file"]
    file_by_path: dict[str, dict] = {}
    test_nodes: list[tuple[str, dict]] = []

    for node in file_nodes:
        fp = (node.get("filePath") or "").replace("\\", "/")
        if not fp:
            continue
        file_by_path[fp] = node
        if _is_test_path(fp):
            test_nodes.append((fp, node))

    if not test_nodes:
        return [], 0

    covered_pairs: set[tuple[str, str]] = set()
    new_edges: list[dict] = []
    tagged_prod_ids: set[str] = set()

    for test_path, test_node in test_nodes:
        for cand_path in _production_candidates(test_path):
            prod_node = file_by_path.get(cand_path)
            if prod_node is None:
                continue
            if _is_test_path(cand_path):
                continue
            pair = (prod_node["id"], test_node["id"])
            if pair in covered_pairs:
                continue
            ek = f"{prod_node['id']}->{test_node['id']}:tested_by"
            if ek in existing_keys:
                continue
            existing_keys.add(ek)
            new_edges.append({
                "source": prod_node["id"],
                "target": test_node["id"],
                "type": "tested_by",
                "direction": "forward",
                "weight": 0.5,
                "description": "Path-based pairing (deterministic)",
            })
            covered_pairs.add(pair)
            tagged_prod_ids.add(prod_node["id"])
            break

    return new_edges, len(tagged_prod_ids)


def normalize_edge_endpoints(rel: str, src_id: str, tgt_id: str) -> tuple[str, str]:
    """Return UA-oriented endpoints for a mapped cbm relationship."""
    if rel == "TESTS_FILE":
        return tgt_id, src_id  # cbm test -> production; UA production -> test
    return src_id, tgt_id


def tag_tested_nodes(nodes: list[dict], edges: list[dict]) -> int:
    """Tag every production node that sources a tested_by edge."""
    tested_ids = {edge["source"] for edge in edges if edge.get("type") == "tested_by"}
    tagged = 0
    for node in nodes:
        if node.get("id") not in tested_ids:
            continue
        tags = node.setdefault("tags", [])
        if "tested" not in tags:
            tags.append("tested")
            tagged += 1
    return tagged


def convert(project: str, project_root: str, output_path: str):
    """Main conversion pipeline."""
    print(f"[1/4] Querying nodes from cbm project: {project}")
    schema = get_graph_schema(project)
    raw_nodes = query_nodes(project, schema)
    print(f"      Got {len(raw_nodes)} raw nodes")

    print(f"[2/4] Querying edges from cbm project: {project}")
    raw_edges = query_edges(project, schema)
    print(f"      Got {len(raw_edges)} raw edges")

    print(f"[3/4] Converting to UA format")

    # First pass: parse nodes and build qualified_name -> UA ID map
    ua_nodes = []
    qn_to_ua_id = {}
    qn_identities = {}
    used_ids: set[str] = set()
    duplicate_qn_count = 0

    for row in raw_nodes:
        node = parse_node(row)
        if not node:
            continue
        qn = row[2] if len(row) > 2 else ""
        identity = tuple(row[index] if index < len(row) else "" for index in (0, 1, 3, 4, 5))
        if qn and qn in qn_to_ua_id:
            if qn_identities[qn] != identity:
                raise RuntimeError(f"cbm qualified_name collision has conflicting identities: {qn}")
            duplicate_qn_count += 1
            continue
        node["id"] = unique_node_id(node["id"], qn or node["id"], used_ids)
        used_ids.add(node["id"])
        ua_nodes.append(node)
        if qn:
            qn_to_ua_id[qn] = node["id"]
            qn_identities[qn] = identity

    if duplicate_qn_count:
        print(f"      Deduplicated {duplicate_qn_count} exact qualified_name rows")

    # Second pass: parse edges using the ID map
    ua_edges = []
    edge_keys = set()

    for row in raw_edges:
        if len(row) < 3:
            continue
        src_qn = row[0]
        tgt_qn = row[1]
        rel = row[2]

        ua_type = EDGE_TYPE_MAP.get(rel)
        if not ua_type:
            continue

        src_id = qn_to_ua_id.get(src_qn)
        tgt_id = qn_to_ua_id.get(tgt_qn)

        if not src_id or not tgt_id:
            continue  # Skip edges with dangling references

        src_id, tgt_id = normalize_edge_endpoints(rel, src_id, tgt_id)
        edge_key = f"{src_id}->{tgt_id}:{ua_type}"
        if edge_key in edge_keys:
            continue  # Skip duplicates
        edge_keys.add(edge_key)

        ua_edges.append({
            "source": src_id,
            "target": tgt_id,
            "type": ua_type,
            "direction": "forward",
            "weight": 1.0,
        })

    # ── File-level edge projection ──────────────────────────────
    # UA Viewer's "Files only" detail mode shows only file nodes.
    # Original cbm edges are function-to-function (calls, writes_to, etc).
    # Without file-to-file edges, containers in layer-detail have zero
    # inter-container edges, producing unreadable scattered blocks.
    #
    # Projection: for each behavioral edge, find the owning file of
    # source and target via contains edges. If both files differ,
    # emit a weighted file-to-file edge.
    # Original function-level edges are preserved unchanged.

    projected = derive_file_level_edges(ua_nodes, ua_edges, edge_keys)
    if projected:
        ua_edges.extend(projected)
        print(f"      Projected {len(projected)} file-level edges")

    # ── tested_by edge derivation ───────────────────────────────
    # Keep native cbm TESTS_FILE facts, then fill missing pairs by path.
    tested_by_edges, _ = derive_tested_by_edges(ua_nodes, ua_edges, edge_keys)
    if tested_by_edges:
        ua_edges.extend(tested_by_edges)
        print(f"      Derived {len(tested_by_edges)} supplemental tested_by edges")

    tagged_count = tag_tested_nodes(ua_nodes, ua_edges)
    if tagged_count:
        print(f"      Tagged {tagged_count} tested production nodes")

    # Build project metadata
    languages = detect_languages(ua_nodes)
    git_hash = get_git_hash(project_root)
    project_name = os.path.basename(project_root)

    # Auto-generate layers based on top-level directory structure
    layers = auto_generate_layers(ua_nodes)
    graph = {
        "version": "1.0.0",
        "kind": "codebase",
        "project": {
            "name": project_name,
            "languages": languages,
            "frameworks": [],
            "description": f"Generated by cbm2ua adapter from codebase-memory-mcp graph ({len(ua_nodes)} nodes, {len(ua_edges)} edges)",
            "analyzedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "gitCommitHash": git_hash,
        },
        "nodes": ua_nodes,
        "edges": ua_edges,
        "layers": layers,
        "tour": [],
    }

    print(f"[4/4] Writing knowledge-graph.json")
    print(f"      Nodes: {len(ua_nodes)}")
    print(f"      Edges: {len(ua_edges)}")
    print(f"      Languages: {languages}")
    print(f"      Git hash: {git_hash}")

    # Write output
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(graph, f, indent=2, ensure_ascii=False)

    print(f"      Output: {output_path}")
    print(f"\n✅ Conversion complete. Open with UA dashboard:")
    print(f"   npx https://github.com/Egonex-AI/Understand-Anything/releases/latest/download/understand-anything-viewer.tgz {os.path.dirname(os.path.dirname(output_path))}")

    return graph


def main():
    parser = argparse.ArgumentParser(description="Convert cbm graph to UA knowledge-graph.json")
    parser.add_argument("--project", required=True, help="cbm project name")
    parser.add_argument("--root", required=True, help="Project root directory")
    parser.add_argument("--output", required=True, help="Output path for knowledge-graph.json")
    args = parser.parse_args()

    convert(args.project, args.root, args.output)


if __name__ == "__main__":
    main()
