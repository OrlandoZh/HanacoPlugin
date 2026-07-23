#!/usr/bin/env python3
"""Build a compact UA architecture projection from the enhanced full graph."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import enhance


BACKBONE_EDGE_SCORES = {
    "routes": 4,
    "imports": 3,
    "calls": 1,
}
STRUCTURAL_SUMMARY_PREFIXES = (
    "File ",
    "Module ",
    "Function ",
    "Method ",
    "Class ",
    "Interface ",
    "Endpoint ",
    "Concept ",
)


def _node_degree(graph: dict[str, Any]) -> Counter[str]:
    degree: Counter[str] = Counter()
    for edge in graph.get("edges") or []:
        if not isinstance(edge, dict):
            continue
        source = edge.get("source")
        target = edge.get("target")
        if source:
            degree[str(source)] += 1
        if target:
            degree[str(target)] += 1
    return degree


def _is_enriched_summary(node: dict[str, Any]) -> bool:
    summary = str(node.get("summary") or "").strip()
    return bool(summary) and not summary.startswith(STRUCTURAL_SUMMARY_PREFIXES)


def _is_test_path(path: str) -> bool:
    lowered = path.lower()
    return any(marker in lowered for marker in (".test.", ".spec.", "/test/", "/tests/", "__tests__"))


def _representative_files(
    layer: dict[str, Any],
    node_by_id: dict[str, dict[str, Any]],
    degree: Counter[str],
    limit: int,
) -> list[dict[str, Any]]:
    candidates = [
        node_by_id[node_id]
        for node_id in layer.get("nodeIds") or []
        if node_id in node_by_id and node_by_id[node_id].get("type") == "file"
    ]

    def score(node: dict[str, Any]) -> tuple[int, int, int, int, str]:
        tags = set(node.get("tags") or [])
        path = str(node.get("filePath") or "")
        return (
            1 if "entry-point" in tags else 0,
            1 if _is_enriched_summary(node) else 0,
            0 if _is_test_path(path) else 1,
            degree[str(node.get("id"))],
            path,
        )

    return sorted(candidates, key=score, reverse=True)[:limit]


def _validate_overview_spec(
    graph: dict[str, Any],
    overlay: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, str]]:
    spec = overlay.get("architectureOverview")
    if not isinstance(spec, dict):
        raise ValueError("Overlay must contain architectureOverview")
    macro_domains = spec.get("macroDomains")
    if not isinstance(macro_domains, list) or not macro_domains:
        raise ValueError("architectureOverview.macroDomains must be a non-empty list")

    graph_layer_ids = {
        str(layer.get("id"))
        for layer in graph.get("layers") or []
        if isinstance(layer, dict) and layer.get("id")
    }
    layer_to_macro: dict[str, str] = {}
    macro_ids: set[str] = set()
    for macro in macro_domains:
        if not isinstance(macro, dict) or not all(
            macro.get(field) for field in ("id", "name", "description", "layerIds")
        ):
            raise ValueError("Each macro domain requires id, name, description, and layerIds")
        macro_id = str(macro["id"])
        if macro_id in macro_ids:
            raise ValueError(f"Duplicate macro domain id: {macro_id}")
        macro_ids.add(macro_id)
        for layer_id in macro["layerIds"]:
            layer_id = str(layer_id)
            if layer_id in layer_to_macro:
                raise ValueError(f"Semantic layer assigned to multiple macro domains: {layer_id}")
            layer_to_macro[layer_id] = macro_id

    missing = sorted(graph_layer_ids - set(layer_to_macro))
    unknown = sorted(set(layer_to_macro) - graph_layer_ids)
    if missing or unknown:
        raise ValueError(
            "Macro domain coverage mismatch: "
            f"missing layers={missing or 'none'}, unknown layers={unknown or 'none'}"
        )
    return spec, macro_domains, layer_to_macro


def _aggregate_backbone_edges(
    graph: dict[str, Any],
    node_to_layer: dict[str, str],
    layer_to_macro: dict[str, str],
    max_edges: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    directed: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    for edge in graph.get("edges") or []:
        if not isinstance(edge, dict):
            continue
        edge_type = str(edge.get("type") or "")
        if edge_type not in BACKBONE_EDGE_SCORES:
            continue
        source_layer = node_to_layer.get(str(edge.get("source")))
        target_layer = node_to_layer.get(str(edge.get("target")))
        if not source_layer or not target_layer:
            continue
        source_macro = layer_to_macro[source_layer]
        target_macro = layer_to_macro[target_layer]
        if source_macro == target_macro:
            continue
        directed[(source_macro, target_macro)][edge_type] += 1

    candidates: list[dict[str, Any]] = []
    macro_pairs = {tuple(sorted(pair)) for pair in directed}
    for left, right in macro_pairs:
        forward = directed.get((left, right), Counter())
        backward = directed.get((right, left), Counter())
        forward_score = sum(forward[kind] * score for kind, score in BACKBONE_EDGE_SCORES.items())
        backward_score = sum(backward[kind] * score for kind, score in BACKBONE_EDGE_SCORES.items())
        source, target = (left, right) if forward_score >= backward_score else (right, left)
        combined = forward + backward
        total_count = sum(combined.values())
        weighted_score = forward_score + backward_score
        dominant_type = max(
            BACKBONE_EDGE_SCORES,
            key=lambda kind: combined[kind] * BACKBONE_EDGE_SCORES[kind],
        )
        candidates.append(
            {
                "sourceMacro": source,
                "targetMacro": target,
                "type": dominant_type,
                "count": total_count,
                "score": weighted_score,
                "typeCounts": dict(combined),
            }
        )

    selected = sorted(
        candidates,
        key=lambda item: (
            int(item["score"]),
            int(item["count"]),
            str(item["sourceMacro"]),
            str(item["targetMacro"]),
        ),
        reverse=True,
    )[:max_edges]
    max_count = max((int(item["count"]) for item in selected), default=1)
    edges = [
        {
            "source": f"concept:macro-domain:{item['sourceMacro']}",
            "target": f"concept:macro-domain:{item['targetMacro']}",
            "type": item["type"],
            "direction": "forward",
            "weight": round(
                0.35 + 0.65 * math.log1p(int(item["count"])) / math.log1p(max_count),
                3,
            ),
        }
        for item in selected
    ]
    return edges, selected


def build_architecture_overview(
    graph: dict[str, Any],
    overlay: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Project a full UA graph into a compact, human-readable architecture map."""
    spec, macro_domains, layer_to_macro = _validate_overview_spec(graph, overlay)
    representatives_per_layer = int(spec.get("representativesPerLayer", 4))
    max_backbone_edges = int(spec.get("maxBackboneEdges", 12))
    if representatives_per_layer < 1 or max_backbone_edges < 1:
        raise ValueError("Architecture overview budgets must be positive")

    node_by_id = {
        str(node["id"]): node
        for node in graph.get("nodes") or []
        if isinstance(node, dict) and node.get("id")
    }
    layers = [layer for layer in graph.get("layers") or [] if isinstance(layer, dict)]
    layer_by_id = {str(layer["id"]): layer for layer in layers}
    node_to_layer = {
        str(node_id): str(layer["id"])
        for layer in layers
        for node_id in layer.get("nodeIds") or []
    }
    degree = _node_degree(graph)

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    overview_layers: list[dict[str, Any]] = []
    representative_counts: list[dict[str, Any]] = []

    for macro in macro_domains:
        macro_id = str(macro["id"])
        macro_node_id = f"concept:macro-domain:{macro_id}"
        nodes.append(
            {
                "id": macro_node_id,
                "type": "concept",
                "name": macro["name"],
                "filePath": "",
                "summary": macro["description"],
                "tags": ["macro-domain", "architecture-overview"],
                "complexity": "simple",
            }
        )
        macro_node_ids = [macro_node_id]

        for layer_id in macro["layerIds"]:
            layer = layer_by_id[str(layer_id)]
            layer_node_id = f"concept:semantic-layer:{layer_id}"
            nodes.append(
                {
                    "id": layer_node_id,
                    "type": "concept",
                    "name": layer["name"],
                    "filePath": "",
                    "summary": layer["description"],
                    "tags": ["semantic-layer", macro_id],
                    "complexity": "simple",
                }
            )
            macro_node_ids.append(layer_node_id)
            edges.append(
                {
                    "source": macro_node_id,
                    "target": layer_node_id,
                    "type": "contains",
                    "direction": "forward",
                    "weight": 1.0,
                }
            )

            representatives = _representative_files(
                layer,
                node_by_id,
                degree,
                representatives_per_layer,
            )
            representative_counts.append(
                {"layerId": str(layer_id), "selected": len(representatives)}
            )
            for representative in representatives:
                copied = dict(representative)
                copied["tags"] = list(dict.fromkeys([
                    *(copied.get("tags") or []),
                    "architecture-representative",
                    str(layer_id),
                ]))
                nodes.append(copied)
                macro_node_ids.append(str(copied["id"]))
                edges.append(
                    {
                        "source": layer_node_id,
                        "target": str(copied["id"]),
                        "type": "contains",
                        "direction": "forward",
                        "weight": 1.0,
                    }
                )

        overview_layers.append(
            {
                "id": macro_id,
                "name": macro["name"],
                "description": macro["description"],
                "nodeIds": macro_node_ids,
            }
        )

    backbone_edges, backbone_report = _aggregate_backbone_edges(
        graph,
        node_to_layer,
        layer_to_macro,
        max_backbone_edges,
    )
    edges.extend(backbone_edges)

    tour = [
        {
            "order": index,
            "title": macro["name"],
            "description": macro["description"],
            "nodeIds": [
                f"concept:macro-domain:{macro['id']}",
                *[
                    f"concept:semantic-layer:{layer_id}"
                    for layer_id in macro["layerIds"][:4]
                ],
            ],
        }
        for index, macro in enumerate(macro_domains, start=1)
    ]

    project = dict(graph.get("project") or {})
    project["name"] = str(spec.get("projectName") or f"{project.get('name', 'Project')} · 架构总览")
    project["description"] = str(
        spec.get("projectDescription")
        or "面向人类阅读的宏观架构投影；完整代码事实保留在独立分析图中。"
    )

    overview = {
        "version": graph.get("version", "1.0.0"),
        "kind": graph.get("kind", "codebase"),
        "project": project,
        "nodes": nodes,
        "edges": edges,
        "layers": overview_layers,
        "tour": tour,
    }
    report = {
        "version": "1.0.0",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "projection": "architecture-overview",
        "sourceNodeCount": len(graph.get("nodes") or []),
        "sourceEdgeCount": len(graph.get("edges") or []),
        "overviewNodeCount": len(nodes),
        "overviewEdgeCount": len(edges),
        "macroDomainCount": len(overview_layers),
        "semanticLayerCount": len(layers),
        "representativesPerLayer": representatives_per_layer,
        "maxBackboneEdges": max_backbone_edges,
        "backboneEdges": backbone_report,
        "representativeCounts": representative_counts,
        "overlaySha256": hashlib.sha256(
            json.dumps(overlay, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest(),
        "sourceGitCommitHash": project.get("gitCommitHash", ""),
    }
    return overview, report


def write_architecture_bundle(
    graph: dict[str, Any],
    overlay: dict[str, Any],
    output_path: str | Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    overview, report = build_architecture_overview(graph, overlay)
    output = Path(output_path)
    enhance.write_json(output, overview)
    enhance.write_json(
        output.parent / "config.json",
        {
            "autoUpdate": False,
            "outputLanguage": overlay.get("language", "en"),
        },
    )
    enhance.write_json(output.parent / "overview-meta.json", report)
    return overview, report


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a compact UA architecture overview")
    parser.add_argument("--input", required=True, help="Enhanced full knowledge-graph JSON")
    parser.add_argument("--overlay", required=True, help="Semantic overlay JSON")
    parser.add_argument("--output", required=True, help="Overview knowledge-graph JSON")
    args = parser.parse_args()

    graph = enhance.load_json(args.input)
    overlay = enhance.load_json(args.overlay)
    overview, report = write_architecture_bundle(graph, overlay, args.output)
    print(
        f"Architecture overview: {len(overview['nodes'])} nodes, "
        f"{len(overview['edges'])} edges, {len(overview['layers'])} macro domains"
    )
    print(f"Output: {args.output}")


if __name__ == "__main__":
    main()
