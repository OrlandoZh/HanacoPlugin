#!/usr/bin/env python3
"""Apply a versioned semantic overlay to a cbm2ua structural graph.

The input graph remains the deterministic cbm-derived fact layer. This command
writes a separate UA-compatible graph with presentation filters, semantic
layers, selected node summaries, a guided tour, and UI language configuration.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import time
from pathlib import Path
from typing import Any


NODE_TYPE_PRIORITY = {
    "file": 0,
    "module": 1,
    "class": 2,
    "function": 3,
    "config": 4,
    "document": 5,
    "concept": 6,
}


def load_json(path: str | Path) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object in {path}")
    return value


def write_json(path: str | Path, value: dict[str, Any]) -> None:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def clean_path(value: Any) -> str:
    path = str(value or "").replace("\\", "/")
    while path.startswith("./"):
        path = path[2:]
    return path


def normalized_path(node: dict[str, Any]) -> str:
    return clean_path(node.get("filePath"))


def matches_any_path(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatchcase(path, pattern) for pattern in patterns)


def node_matches(node: dict[str, Any], selector: dict[str, Any]) -> bool:
    path = normalized_path(node)
    exact_path = selector.get("filePath")
    if exact_path is not None and path != clean_path(exact_path):
        return False

    patterns = selector.get("pathPatterns") or []
    if patterns and not matches_any_path(path, patterns):
        return False

    name = selector.get("name")
    if name is not None and node.get("name") != name:
        return False

    node_types = selector.get("types") or []
    if node_types and node.get("type") not in node_types:
        return False

    required_tags = set(selector.get("tags") or [])
    if required_tags and not required_tags.issubset(set(node.get("tags") or [])):
        return False

    return bool(exact_path is not None or patterns or name is not None or node_types or required_tags)


def find_nodes(nodes: list[dict[str, Any]], selector: dict[str, Any]) -> list[dict[str, Any]]:
    matches = [node for node in nodes if node_matches(node, selector)]
    return sorted(
        matches,
        key=lambda node: (
            NODE_TYPE_PRIORITY.get(str(node.get("type")), 99),
            normalized_path(node),
            str(node.get("name") or ""),
        ),
    )


def _auto_generate_tour(
    layers: list[dict[str, Any]],
    nodes: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Generate a tour skeleton from layer structure.

    Walks layers in their natural order (matching overlay definition).
    For each layer with at least 1 file:
      1. Pick a representative file: prefer "entry-point" tag, then
         the file with the highest edge degree, then the first file.
      2. Title = layer name (e.g. "标签与主题管理")
      3. Description = layer description + file summary
      4. nodeIds = [representative file id]

    Layers with 0 files are skipped. Maximum 10 steps to stay readable.
    """
    nodes_by_id = {str(n.get("id")): n for n in nodes}

    # Compute edge degree per node
    degree: dict[str, int] = {}
    for e in edges:
        sid = str(e.get("source", ""))
        tid = str(e.get("target", ""))
        degree[sid] = degree.get(sid, 0) + 1
        degree[tid] = degree.get(tid, 0) + 1

    # Build layer ordering: skip layers with 0 files
    eligible = [l for l in layers if l.get("nodeIds")]
    if not eligible:
        return []

    tour: list[dict[str, Any]] = []
    for i, layer in enumerate(eligible[:10]):
        layer_file_ids = layer["nodeIds"]
        layer_files = [
            nodes_by_id[fid]
            for fid in layer_file_ids
            if fid in nodes_by_id and nodes_by_id[fid].get("type") == "file"
        ]
        if not layer_files:
            continue

        # Pick representative: entry-point tag > highest degree > first
        rep = None
        for f in layer_files:
            if "entry-point" in (f.get("tags") or []):
                rep = f
                break
        if not rep:
            rep = max(layer_files, key=lambda f: degree.get(str(f.get("id")), 0))
        if not rep:
            rep = layer_files[0]

        layer_name = layer.get("name", "Layer")
        layer_desc = layer.get("description", "")
        file_summary = rep.get("summary", "")
        file_name = rep.get("name", rep.get("filePath", "").split("/")[-1])

        # Assemble description
        desc_parts = []
        if layer_desc:
            desc_parts.append(layer_desc)
        if file_summary and file_summary != f"File {file_name}":
            desc_parts.append(f"关键文件：{file_name} — {file_summary}")
        else:
            desc_parts.append(f"关键文件：{file_name}")
        description = "。".join(desc_parts)

        tour.append({
            "order": i + 1,
            "title": layer_name,
            "description": description,
            "nodeIds": [str(rep["id"])],
        })

    return tour


def derive_cluster_name_hints(
    all_nodes: list[dict[str, Any]],
    layer_node_ids: list[str],
) -> list[dict[str, Any]]:
    """Derive semantic cluster name hints from file naming patterns.

    When UA Viewer's directory-aggregation triggers Louvain community
    detection (because >90% of files share a parent directory), the
    resulting containers are anonymous ("Cluster A", "Cluster B", etc).

    This function groups files by filename prefix (the first token
    before a hyphen or underscore) and produces name hints injected
    into the layer data. UA Viewer or a human reviewer can use these
    hints to assign meaningful names to Louvain communities.

    Grouping algorithm:
    1. Extract the prefix token from each filename
       (e.g. tag-store.js -> "tag", pdf-translate.js -> "pdf")
    2. Group files sharing the same prefix
    3. Name each multi-file group from its prefix (capitalized)
    4. Single-file groups get the filename stem as their name

    Returns a list of {name, fileIds} dicts, one per detected group.
    """
    id_set = set(layer_node_ids)
    file_nodes = [
        n for n in all_nodes
        if str(n.get("id")) in id_set and n.get("type") == "file"
    ]
    if len(file_nodes) < 3:
        return []

    # Group by filename prefix (first token before - or _)
    prefix_to_files: dict[str, list[str]] = {}
    for node in file_nodes:
        name = os.path.basename(node.get("filePath", ""))
        stem = os.path.splitext(name)[0]
        parts = re.split(r'[-_]', stem)
        prefix = parts[0].lower() if parts and parts[0] else "unknown"
        prefix_to_files.setdefault(prefix, []).append(str(node["id"]))

    hints: list[dict[str, Any]] = []
    for prefix, file_ids in sorted(prefix_to_files.items()):
        if len(file_ids) >= 2:
            hints.append({"name": prefix.capitalize(), "fileIds": file_ids})
        else:
            # Single file — use filename stem as hint
            node = next(
                (n for n in file_nodes if str(n["id"]) == file_ids[0]),
                None,
            )
            if node:
                name = os.path.basename(node.get("filePath", ""))
                stem = os.path.splitext(name)[0]
                display_name = stem.replace("-", " ").replace("_", " ").title()
            else:
                display_name = prefix.capitalize()
            hints.append({"name": display_name, "fileIds": file_ids})

    return hints


def apply_overlay(
    graph: dict[str, Any],
    overlay: dict[str, Any],
    *,
    strict: bool = True,
) -> tuple[dict[str, Any], dict[str, Any]]:
    raw_nodes = graph.get("nodes")
    raw_edges = graph.get("edges")
    if not isinstance(raw_nodes, list) or not isinstance(raw_edges, list):
        raise ValueError("Input graph must contain nodes[] and edges[]")

    exclude_patterns = list(overlay.get("excludePaths") or [])
    nodes = [
        dict(node)
        for node in raw_nodes
        if isinstance(node, dict)
        and not matches_any_path(normalized_path(node), exclude_patterns)
    ]

    node_ids = {str(node.get("id")) for node in nodes}
    edges = [
        dict(edge)
        for edge in raw_edges
        if isinstance(edge, dict)
        and edge.get("source") in node_ids
        and edge.get("target") in node_ids
    ]

    project_overlay = overlay.get("project") or {}
    project = dict(graph.get("project") or {})
    for field in ("name", "description", "frameworks"):
        if field in project_overlay:
            project[field] = project_overlay[field]

    summary_match_counts: list[dict[str, Any]] = []
    for override in overlay.get("nodeSummaries") or []:
        selector = override.get("selector") or {}
        matched = find_nodes(nodes, selector)
        if strict and not matched:
            raise ValueError(f"Node summary selector matched nothing: {selector}")
        for node in matched:
            if "summary" in override:
                node["summary"] = override["summary"]
            tags = list(node.get("tags") or [])
            for tag in override.get("tags") or []:
                if tag not in tags:
                    tags.append(tag)
            node["tags"] = tags
        summary_match_counts.append({"selector": selector, "matches": len(matched)})

    assigned: set[str] = set()
    layers: list[dict[str, Any]] = []
    layer_match_counts: list[dict[str, Any]] = []

    for layer_spec in overlay.get("layers") or []:
        patterns = list(layer_spec.get("patterns") or [])
        excluded = list(layer_spec.get("excludePatterns") or [])
        selected: list[str] = []
        for node in nodes:
            node_id = str(node.get("id"))
            # Only file nodes belong in layer membership.
            # UA Viewer's detailLevel=file mode uses layer.nodeIds directly;
            # functions/classes are reached via contains-edge expansion in
            # detailLevel=class mode. Including non-file nodes in layerIds
            # causes the file view to show 1000+ nodes instead of ~40 files,
            # which defeats container derivation and produces unreadable clusters.
            if node.get("type") != "file":
                continue
            path = normalized_path(node)
            if node_id in assigned:
                continue
            if patterns and not matches_any_path(path, patterns):
                continue
            if excluded and matches_any_path(path, excluded):
                continue
            selected.append(node_id)
            assigned.add(node_id)

        if strict and not selected:
            raise ValueError(f"Semantic layer matched no nodes: {layer_spec.get('id')}")
        if selected:
            layers.append(
                {
                    "id": layer_spec["id"],
                    "name": layer_spec["name"],
                    "description": layer_spec["description"],
                    "nodeIds": selected,
                }
            )
        layer_match_counts.append({"id": layer_spec.get("id"), "matches": len(selected)})

    fallback = overlay.get("fallbackLayer")
    unassigned_files = [
        str(node.get("id"))
        for node in nodes
        if node.get("type") == "file" and str(node.get("id")) not in assigned
    ]
    if fallback and unassigned_files:
        layers.append(
            {
                "id": fallback["id"],
                "name": fallback["name"],
                "description": fallback["description"],
                "nodeIds": unassigned_files,
            }
        )
        assigned.update(unassigned_files)
        layer_match_counts.append({"id": fallback.get("id"), "matches": len(unassigned_files)})
    elif strict and unassigned_files:
        raise ValueError(f"{len(unassigned_files)} file nodes were not assigned to a semantic layer")

    tour: list[dict[str, Any]] = []
    tour_match_counts: list[dict[str, Any]] = []
    for step_spec in overlay.get("tour") or []:
        selected_ids: list[str] = []
        for selector in step_spec.get("selectors") or []:
            for node in find_nodes(nodes, selector):
                node_id = str(node.get("id"))
                if node_id not in selected_ids:
                    selected_ids.append(node_id)
                if len(selected_ids) >= 5:
                    break
            if len(selected_ids) >= 5:
                break

        if strict and not selected_ids:
            raise ValueError(f"Tour step matched no nodes: {step_spec.get('title')}")
        if not selected_ids:
            continue

        step = {
            "order": int(step_spec["order"]),
            "title": step_spec["title"],
            "description": step_spec["description"],
            "nodeIds": selected_ids,
        }
        if step_spec.get("languageLesson"):
            step["languageLesson"] = step_spec["languageLesson"]
        tour.append(step)
        tour_match_counts.append({"order": step["order"], "matches": len(selected_ids)})

    # ── Auto-generate tour skeleton if overlay has no tour steps ──
    # The plugin's core goal is helping humans quickly understand code
    # structure and module composition. A tour skeleton walks the user
    # through layers in order, picking one representative file per layer
    # (entry-point tag first, then highest-degree file). Descriptions are
    # assembled from layer name + file summary. Overlay-provided tours
    # always take precedence.
    if not tour and layers:
        tour = _auto_generate_tour(layers, nodes, edges)
        if tour:
            tour_match_counts = [
                {"order": s["order"], "matches": len(s["nodeIds"])}
                for s in tour
            ]

    # Inject clusterNameHints for layers with enough files to trigger
    # UA Viewer's Louvain community detection fallback.
    for layer in layers:
        hints = derive_cluster_name_hints(nodes, layer.get("nodeIds", []))
        if hints:
            layer["clusterNameHints"] = hints

    enhanced = dict(graph)
    enhanced["project"] = project
    enhanced["nodes"] = nodes
    enhanced["edges"] = edges
    enhanced["layers"] = layers
    enhanced["tour"] = sorted(tour, key=lambda item: item["order"])

    report = {
        "version": "1.0.0",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "language": overlay.get("language", "en"),
        "sourceNodeCount": len(raw_nodes),
        "sourceEdgeCount": len(raw_edges),
        "enhancedNodeCount": len(nodes),
        "enhancedEdgeCount": len(edges),
        "excludedNodeCount": len(raw_nodes) - len(nodes),
        "excludedEdgeCount": len(raw_edges) - len(edges),
        "layerMatches": layer_match_counts,
        "summaryMatches": summary_match_counts,
        "tourMatches": tour_match_counts,
        "overlaySha256": hashlib.sha256(
            json.dumps(overlay, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest(),
        "evidenceStatus": overlay.get("evidenceStatus", "semantic-inference"),
    }
    return enhanced, report


def write_enhanced_bundle(
    graph: dict[str, Any],
    overlay: dict[str, Any],
    output_path: str | Path,
    *,
    strict: bool = True,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Apply an overlay and write the UA graph, locale config, and provenance."""
    enhanced, report = apply_overlay(graph, overlay, strict=strict)
    output = Path(output_path)
    write_json(output, enhanced)
    config_path = output.parent / "config.json"
    config = load_json(config_path) if config_path.exists() else {}
    config.update(
        {
            "autoUpdate": False,
            "outputLanguage": overlay.get("language", "en"),
        }
    )
    write_json(config_path, config)
    write_json(output.parent / "semantic-meta.json", report)
    return enhanced, report


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply a semantic overlay to a cbm2ua graph")
    parser.add_argument("--input", required=True, help="Structural knowledge-graph JSON")
    parser.add_argument("--overlay", required=True, help="Semantic overlay JSON")
    parser.add_argument("--output", required=True, help="Enhanced knowledge-graph JSON")
    parser.add_argument("--no-strict", action="store_true", help="Allow stale selectors and empty layers")
    args = parser.parse_args()

    graph = load_json(args.input)
    overlay = load_json(args.overlay)
    enhanced, report = write_enhanced_bundle(
        graph,
        overlay,
        args.output,
        strict=not args.no_strict,
    )

    print(f"Enhanced graph: {args.output}")
    print(
        f"Nodes {report['sourceNodeCount']} -> {report['enhancedNodeCount']}; "
        f"edges {report['sourceEdgeCount']} -> {report['enhancedEdgeCount']}"
    )
    print(f"Layers: {len(enhanced['layers'])}; tour steps: {len(enhanced['tour'])}")
    print(f"UI language: {overlay.get('language', 'en')}")


if __name__ == "__main__":
    main()
