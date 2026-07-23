#!/usr/bin/env python3
"""Run the deterministic cbm -> UA structural + semantic overlay pipeline."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import adapter
import enhance
import overview


MAX_VIEWER_FILE_BYTES = 1024 * 1024


def materialize_source_previews(
    graph: dict,
    source_root: str | Path,
    output_root: str | Path,
) -> dict:
    """Copy only graph-referenced source files into the derived viewer bundle."""
    source_root = Path(source_root).resolve()
    output_root = Path(output_root).resolve()
    copied = 0
    copied_bytes = 0
    skipped = 0

    paths = sorted(
        {
            str(node.get("filePath"))
            for node in graph.get("nodes", [])
            if isinstance(node, dict) and node.get("filePath")
        }
    )
    for value in paths:
        relative = Path(value)
        if relative.is_absolute() or ".." in relative.parts or relative.parts[:1] == (".ua",):
            skipped += 1
            continue
        source = (source_root / relative).resolve()
        try:
            source.relative_to(source_root)
        except ValueError:
            skipped += 1
            continue
        if not source.is_file() or source.stat().st_size > MAX_VIEWER_FILE_BYTES:
            skipped += 1
            continue
        destination = output_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source != destination.resolve():
            shutil.copy2(source, destination)
        copied += 1
        copied_bytes += source.stat().st_size

    return {
        "version": "1.0.0",
        "sourceRoot": str(source_root),
        "copiedFiles": copied,
        "copiedBytes": copied_bytes,
        "skippedPaths": skipped,
        "maxFileBytes": MAX_VIEWER_FILE_BYTES,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build an enhanced UA graph from an indexed cbm project")
    parser.add_argument("--project", required=True, help="cbm project name")
    parser.add_argument("--root", required=True, help="Source repository root")
    parser.add_argument("--overlay", required=True, help="Versioned semantic overlay JSON")
    parser.add_argument("--output-root", required=True, help="Derived artifact output directory")
    parser.add_argument("--no-strict", action="store_true", help="Allow stale overlay selectors")
    parser.add_argument(
        "--materialize-source-preview",
        action="store_true",
        help="Copy graph-referenced files into the derived bundle for UA code preview",
    )
    args = parser.parse_args()

    output_root = Path(args.output_root)
    structural_path = output_root / "knowledge-graph.structural.json"
    ua_graph_path = output_root / ".ua" / "knowledge-graph.json"
    architecture_root = output_root / "architecture"
    architecture_graph_path = architecture_root / ".ua" / "knowledge-graph.json"

    structural = adapter.convert(args.project, args.root, str(structural_path))
    overlay = enhance.load_json(args.overlay)
    enhanced, report = enhance.write_enhanced_bundle(
        structural,
        overlay,
        ua_graph_path,
        strict=not args.no_strict,
    )

    architecture_graph = None
    architecture_report = None
    if overlay.get("architectureOverview"):
        architecture_graph, architecture_report = overview.write_architecture_bundle(
            enhanced,
            overlay,
            architecture_graph_path,
        )

    if args.materialize_source_preview:
        preview_meta = materialize_source_previews(enhanced, args.root, output_root)
        enhance.write_json(ua_graph_path.parent / "source-preview-meta.json", preview_meta)
        print(
            f"  Full source preview: {preview_meta['copiedFiles']} files, "
            f"{preview_meta['copiedBytes']} bytes"
        )
        if architecture_graph is not None:
            architecture_preview_meta = materialize_source_previews(
                architecture_graph,
                args.root,
                architecture_root,
            )
            enhance.write_json(
                architecture_graph_path.parent / "source-preview-meta.json",
                architecture_preview_meta,
            )
            print(
                f"  Architecture source preview: "
                f"{architecture_preview_meta['copiedFiles']} files, "
                f"{architecture_preview_meta['copiedBytes']} bytes"
            )

    print("\nPipeline complete")
    print(f"  Structural graph: {structural_path}")
    print(f"  Enhanced UA graph: {ua_graph_path}")
    print(f"  Nodes: {len(enhanced['nodes'])}; edges: {len(enhanced['edges'])}")
    print(f"  Layers: {len(enhanced['layers'])}; tour steps: {len(enhanced['tour'])}")
    print(f"  Excluded display nodes: {report['excludedNodeCount']}")
    if architecture_graph is not None and architecture_report is not None:
        print(f"  Architecture graph: {architecture_graph_path}")
        print(
            f"  Architecture overview: {len(architecture_graph['nodes'])} nodes; "
            f"{len(architecture_graph['edges'])} edges; "
            f"{len(architecture_graph['layers'])} macro domains; "
            f"{len(architecture_report['backboneEdges'])} backbone edges"
        )
    print("  Full analysis viewer:")
    print(
        "    npx --yes "
        "https://github.com/Egonex-AI/Understand-Anything/releases/latest/download/"
        f"understand-anything-viewer.tgz {output_root}"
    )
    if architecture_graph is not None:
        print("  Architecture viewer:")
        print(
            "    npx --yes "
            "https://github.com/Egonex-AI/Understand-Anything/releases/latest/download/"
            f"understand-anything-viewer.tgz {architecture_root}"
        )


if __name__ == "__main__":
    main()
