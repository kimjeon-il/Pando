"""Resolve report inputs and outputs during the Pando -> PandoLab move."""
import argparse
import os
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MAPPING = json.loads((REPO / 'tools/report-paths.json').read_text(encoding='utf-8'))


def report_path(legacy, root=REPO):
    root = Path(root)
    legacy = str(legacy)
    target = MAPPING['files'].get(legacy, legacy)
    for old, new in MAPPING['directories'].items():
        recursive = old == 'assets/data/research/siachen'
        if legacy == old or (recursive and legacy.startswith(old + '/')):
            target = MAPPING['files'].get(legacy, new + legacy[len(old):])
            break
    if not target.startswith('reports/'):
        raise ValueError(f'Not a report path: {legacy}')
    checkout = Path(os.environ.get('PANDOLAB_LIBRARY_DATA_ROOT', root / '.library-data/repository'))
    return checkout / target



if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path')
    args = parser.parse_args()
    print(report_path(args.path))
