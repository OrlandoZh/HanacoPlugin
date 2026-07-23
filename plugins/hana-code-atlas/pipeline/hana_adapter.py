#!/usr/bin/env python3
"""
hana_adapter.py — Hana plugin pipeline adapter

Called by Node via execFile/spawn (shell:false) with fixed arguments.
This adapter performs conversion IN-PROCESS by importing pipeline/adapter/enhance/overview
modules directly — it does NOT spawn pipeline.py as a second Python process.

Output layout (under --output-root):
  full/.ua/knowledge-graph.json
  full/.ua/config.json
  full/.ua/semantic-meta.json
  full/.ua/source-preview-meta.json
  full/source-preview/**            ← source files under source-preview/
  architecture/.ua/knowledge-graph.json   (overlay only)
  architecture/.ua/config.json
  architecture/.ua/overview-meta.json
  architecture/.ua/source-preview-meta.json
  architecture/source-preview/**    ← source files under source-preview/
  build-meta.json

If overlay is present and has architectureOverview → Full + Architecture bundles.
If no overlay → Full bundle only, architecture is unavailable.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

# Ensure the pipeline directory is on the import path
_PIPELINE_DIR = str(Path(__file__).parent.resolve())
if _PIPELINE_DIR not in sys.path:
    sys.path.insert(0, _PIPELINE_DIR)

import adapter
import enhance
import overview
import pipeline

PIPELINE_VERSION = "0.2.0"


def _find_profile_overlay(project_root: str) -> str | None:
    """Search pipeline/profiles/ for a matching overlay."""
    basename = Path(project_root).name
    profiles_dir = Path(_PIPELINE_DIR) / "profiles"
    if not profiles_dir.is_dir():
        return None
    for candidate in [f"{basename}.zh.json", f"{basename}.json"]:
        p = profiles_dir / candidate
        if p.is_file():
            return str(p)
    return None


def _resolve_overlay(project_root: str, overlay_arg: str | None) -> dict | None:
    """Resolve and load the overlay JSON."""
    if overlay_arg:
        try:
            p = Path(overlay_arg).resolve()
            content = p.read_text(encoding="utf-8")
            return json.loads(content)
        except Exception as e:
            print(f"WARNING: Failed to load overlay from {overlay_arg}: {e}", file=sys.stderr)
            return None

    project_overlay = Path(project_root) / ".ua" / "overlay.json"
    try:
        real_path = project_overlay.resolve()
        real_root = Path(project_root).resolve()
        if str(real_path).startswith(str(real_root) + os.sep):
            content = real_path.read_text(encoding="utf-8")
            return json.loads(content)
    except (FileNotFoundError, OSError):
        pass

    profile_path = _find_profile_overlay(project_root)
    if profile_path:
        try:
            return json.loads(Path(profile_path).read_text(encoding="utf-8"))
        except Exception as e:
            print(f"WARNING: Failed to load profile overlay from {profile_path}: {e}", file=sys.stderr)

    return None


def _get_git_sha(project_root: str) -> str:
    """Get current git commit hash using execFile-style (list args, shell=False)."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True, text=True,
            cwd=project_root, timeout=10, shell=False,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return "unknown"


def _get_cbm_version(cbm_binary: str) -> str:
    """Read the cbm semantic version without making builds depend on it."""
    try:
        result = subprocess.run(
            [cbm_binary, "--version"],
            capture_output=True, text=True,
            timeout=10, shell=False,
        )
        if result.returncode == 0:
            match = re.search(
                r"(?<![0-9A-Za-z])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\b",
                result.stdout,
            )
            if match:
                return match.group(1)
    except Exception:
        pass
    return "unknown"


def _collect_preview_files(graph: dict, source_root: str) -> list[dict]:
    """Collect registered file paths from the graph for source-preview-meta files array."""
    source_root = str(Path(source_root).resolve())
    MAX_BYTES = 1024 * 1024
    seen = set()
    files = []
    for node in graph.get("nodes", []):
        fp = node.get("filePath", "")
        if not fp:
            continue
        p = Path(fp)
        if p.is_absolute() or ".." in p.parts or p.parts[:1] == (".ua",):
            continue
        if fp in seen:
            continue
        seen.add(fp)
        source = (Path(source_root) / p).resolve()
        try:
            source.relative_to(Path(source_root).resolve())
        except ValueError:
            continue
        try:
            if source.is_file() and source.stat().st_size <= MAX_BYTES:
                files.append({"relativePath": fp, "sizeBytes": source.stat().st_size})
        except OSError:
            continue
    return files


def run_pipeline(
    project_root: str,
    cbm_project: str | None,
    output_root: str,
    cbm_binary: str = "codebase-memory-mcp",
    overlay_path: str | None = None,
    no_strict: bool = False,
    materialize_source_preview: bool = True,
) -> dict:
    """Run the full pipeline in-process. Returns build-meta dict."""
    project_root = str(Path(project_root).resolve())
    output_root = str(Path(output_root).resolve())

    if not Path(project_root).is_dir():
        raise RuntimeError(f"project-root does not exist: {project_root}")

    if not cbm_project:
        raise RuntimeError("cbm-project name is required but was not provided; "
                           "ensure the project has a matching cbm index")

    # ── Sync adapter module constants AFTER import ─────────
    # adapter.CBM_BIN is a module-level constant set from os.environ at import time.
    # We must explicitly overwrite it to respect --cbm-binary.
    adapter.CBM_BIN = cbm_binary
    cbm_timeout = int(os.environ.get("CBM_TIMEOUT_SECONDS", "120"))
    adapter.CBM_TIMEOUT_SECONDS = cbm_timeout

    print(f"  Project root: {project_root}")
    print(f"  CBM project:  {cbm_project}")
    print(f"  CBM binary:   {cbm_binary}")
    print(f"  Output root:  {output_root}")
    print()

    # Capture source and indexer provenance before the build starts.
    git_sha = _get_git_sha(project_root)
    cbm_version = _get_cbm_version(cbm_binary)

    # ── Stage 1: Resolve overlay ──────────────────────────
    overlay = _resolve_overlay(project_root, overlay_path)
    has_overlay = overlay is not None
    has_architecture = has_overlay and bool(overlay.get("architectureOverview"))

    if has_overlay:
        print(f"  Overlay: loaded ({'with' if has_architecture else 'without'} architecture)")
    else:
        print("  Overlay: none (Full bundle only)")

    # ── Stage 2: Structural conversion ────────────────────
    print("[1/4] Converting cbm graph to UA structural format...")
    structural = adapter.convert(
        cbm_project,
        project_root,
        str(Path(output_root) / "full" / ".ua" / "knowledge-graph.structural.json"),
    )
    print(f"      Structural: {len(structural.get('nodes', []))} nodes, {len(structural.get('edges', []))} edges")

    # ── Stage 3: Enhance ──────────────────────────────────
    print("[2/4] Enhancing graph...")
    full_ua_path = Path(output_root) / "full" / ".ua" / "knowledge-graph.json"

    if has_overlay:
        enhanced, report = enhance.write_enhanced_bundle(
            structural, overlay, str(full_ua_path), strict=not no_strict,
        )
    else:
        enhanced = structural
        report = {
            "version": "1.0.0",
            "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "language": "en",
            "sourceNodeCount": len(structural.get("nodes", [])),
            "sourceEdgeCount": len(structural.get("edges", [])),
            "enhancedNodeCount": len(structural.get("nodes", [])),
            "enhancedEdgeCount": len(structural.get("edges", [])),
            "excludedNodeCount": 0,
            "excludedEdgeCount": 0,
            "evidenceStatus": "structural-only",
        }
        enhance.write_json(full_ua_path, enhanced)
        enhance.write_json(
            full_ua_path.parent / "config.json",
            {"autoUpdate": False, "outputLanguage": "en"},
        )
        enhance.write_json(full_ua_path.parent / "semantic-meta.json", report)

    print(f"      Enhanced: {len(enhanced.get('nodes', []))} nodes, {len(enhanced.get('edges', []))} edges")

    # ── Stage 4: Architecture bundle ──────────────────────
    architecture_graph = None
    if has_architecture:
        print("[3/4] Building architecture overview...")
        arch_ua_path = Path(output_root) / "architecture" / ".ua" / "knowledge-graph.json"
        architecture_graph, arch_report = overview.write_architecture_bundle(
            enhanced, overlay, str(arch_ua_path),
        )
        print(f"      Architecture: {len(architecture_graph.get('nodes', []))} nodes, "
              f"{len(architecture_graph.get('edges', []))} edges, "
              f"{len(architecture_graph.get('layers', []))} macro domains")
    else:
        print("[3/4] Architecture: skipped (no overlay with architectureOverview)")

    # ── Stage 5: Source preview — output to bundle/source-preview/ ──
    if materialize_source_preview:
        print("[4/4] Materializing source previews...")

        # Full bundle: materialize into full/source-preview/
        full_preview_root = Path(output_root) / "full" / "source-preview"
        full_preview_meta = pipeline.materialize_source_previews(
            enhanced, project_root,
            str(full_preview_root),
        )
        files_list = _collect_preview_files(enhanced, project_root)
        full_preview_meta["files"] = files_list
        enhance.write_json(
            Path(output_root) / "full" / ".ua" / "source-preview-meta.json",
            full_preview_meta,
        )
        print(f"      Full: {full_preview_meta['copiedFiles']} files, {full_preview_meta['copiedBytes']} bytes")

        # Architecture bundle: materialize into architecture/source-preview/
        if architecture_graph is not None:
            arch_preview_root = Path(output_root) / "architecture" / "source-preview"
            arch_preview_meta = pipeline.materialize_source_previews(
                architecture_graph, project_root,
                str(arch_preview_root),
            )
            arch_files = _collect_preview_files(architecture_graph, project_root)
            arch_preview_meta["files"] = arch_files
            enhance.write_json(
                Path(output_root) / "architecture" / ".ua" / "source-preview-meta.json",
                arch_preview_meta,
            )
            print(f"      Architecture: {arch_preview_meta['copiedFiles']} files, "
                  f"{arch_preview_meta['copiedBytes']} bytes")
    else:
        print("[4/4] Source preview: skipped")

    # ── Stage 6: Write build-meta.json ────────────────────
    build_meta = {
        "hasArchitecture": has_architecture,
        "hasOverlay": has_overlay,
        "cbmProjectName": cbm_project,
        "cbmVersion": cbm_version,
        "pipelineVersion": PIPELINE_VERSION,
        "gitCommitHash": git_sha,
        "nodeCount": len(enhanced.get("nodes", [])),
        "edgeCount": len(enhanced.get("edges", [])),
        "layerCount": len(enhanced.get("layers", [])),
        "tourStepCount": len(enhanced.get("tour", [])),
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    if has_overlay:
        build_meta["overlaySha256"] = hashlib.sha256(
            json.dumps(overlay, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
    if architecture_graph is not None:
        build_meta["architectureNodeCount"] = len(architecture_graph.get("nodes", []))
        build_meta["architectureEdgeCount"] = len(architecture_graph.get("edges", []))

    enhance.write_json(Path(output_root) / "build-meta.json", build_meta)

    print("\nPipeline complete")
    return build_meta


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Hana Code Atlas pipeline adapter (in-process)"
    )
    parser.add_argument("--project-root", required=True, help="Source repository absolute root path")
    parser.add_argument("--cbm-project", default=None, help="cbm project name")
    parser.add_argument("--output-root", required=True, help="Staging output directory")
    parser.add_argument("--cbm-binary", default="codebase-memory-mcp", help="codebase-memory-mcp CLI binary")
    parser.add_argument("--overlay", default=None, help="Explicit overlay JSON path")
    parser.add_argument("--no-strict", action="store_true", help="Allow stale overlay selectors")
    parser.add_argument("--materialize-source-preview", action="store_true", help="Copy source files for preview")
    args = parser.parse_args()

    try:
        build_meta = run_pipeline(
            project_root=args.project_root,
            cbm_project=args.cbm_project,
            output_root=args.output_root,
            cbm_binary=args.cbm_binary,
            overlay_path=args.overlay,
            no_strict=args.no_strict,
            materialize_source_preview=args.materialize_source_preview,
        )
        print(f"Build meta: {json.dumps(build_meta, indent=2)}")
    except Exception as e:
        print(f"FATAL: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
