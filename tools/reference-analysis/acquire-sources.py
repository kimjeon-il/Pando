"""Acquire a bounded, provenance-preserving seed inventory, never training labels.

Run in PandoLab; --output must name storage in the external library.
"""
import argparse
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from report_paths import report_argument
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'plugins/pando-map-tools/lib'))
from map_source import acquire


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", type=pathlib.Path, default=pathlib.Path(__file__).with_name("source-catalog.json"))
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    args.catalog = pathlib.Path(report_argument(args.catalog, access='read'))
    args.output = pathlib.Path(report_argument(args.output, access='write'))
    workspace = pathlib.Path(__file__).resolve().parents[2]
    if args.output.resolve().is_relative_to(workspace):
        parser.error("Original materials must be stored outside the application worktree")
    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    if catalog.get("schemaVersion") != 1:
        parser.error("Current source catalog required")
    for entry in catalog["sources"]:
        print(json.dumps(acquire(entry, args.output), ensure_ascii=False), flush=True)
