#!/usr/bin/env python3
"""Explicit opt-in entry point for raw GIS research/builds.

This launcher does NOT fetch sources, generate files or mutate Git by default.
Individual tools retain their original CLI contracts and provenance checks.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TASK_SOURCES = {
    "historical-border": "tools/build_german_empire_1914_base.py",
    "historical-coast": "tools/build_german_empire_1914_modern_coast.py",
    "terrain-dem": "tools/build-terrain-dem.py",
    "terrain-preview": "tools/build-terrain-preview.py",
    "hydro-tiles": "tools/build-hydro-tiles.py",
    "hydro-packfile": "tools/build-hydro-packfile.mjs",
    "hydro-connectivity": "tools/repair-hydro-connectivity.py",
    "physical-data": "tools/build-physical-data.py",
    "place-candidates": "tools/build-place-candidates.mjs",
}


def build_command(task: str, args: list[str]) -> list[str]:
    if task not in TASK_SOURCES:
        raise ValueError(f"Unsupported GIS research task: {task}")
    source = (REPO / TASK_SOURCES[task]).resolve(strict=True)
    if not source.is_relative_to(REPO):
        raise ValueError("GIS source path escaped repository")
    if args and args[0] == "--":
        args = args[1:]
    command = ["node"] if source.suffix == ".mjs" else [sys.executable]
    return [*command, str(source), *args]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Opt-in, isolated Python GIS workflow")
    parser.add_argument("--task", required=True, choices=sorted(TASK_SOURCES))
    parser.add_argument("--execute", action="store_true",
                        help="Explicitly run the selected GIS source command (dry-run is default)")
    namespace, passthrough = parser.parse_known_args(argv)
    command = build_command(namespace.task, passthrough)
    print(json.dumps({
        "schema": "pando-gis-python-manual-v1",
        "mode": "execute" if namespace.execute else "dry-run",
        "task": namespace.task,
        "source": TASK_SOURCES[namespace.task],
        "argv": passthrough[1:] if passthrough[:1] == ["--"] else passthrough,
        "requiresExternalOriginals": namespace.execute,
    }, ensure_ascii=False, indent=2), flush=True)
    if not namespace.execute:
        return 0
    return subprocess.run(command, cwd=REPO, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
