"""Resolve report inputs and outputs during the Pando -> PandoLab move."""
import argparse
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MAPPING = json.loads((REPO / 'tools/report-paths.json').read_text(encoding='utf-8'))


def report_path(legacy, root=REPO):
    root = Path(root)
    legacy = str(legacy)
    target = MAPPING['files'].get(legacy, legacy)
    for old, new in MAPPING['directories'].items():
        if legacy == old or legacy.startswith(old + '/'):
            target = MAPPING['files'].get(legacy, new + legacy[len(old):])
            break
    migrated = (root / 'reports/places/source-manifest.json').is_file()
    return root / (target if migrated or (root / target).exists() else legacy)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path')
    parser.add_argument('--native', action='store_true')
    args = parser.parse_args()
    legacy = ('native/' if args.native else '') + args.path
    print(report_path(legacy))
