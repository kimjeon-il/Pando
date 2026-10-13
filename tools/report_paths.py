"""Resolve explicit current report paths relative to the repository."""
import argparse
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def report_path(relative, root=REPO):
    relative = Path(relative)
    if relative.is_absolute() or not relative.parts or relative.parts[0] != 'reports' or '..' in relative.parts:
        raise ValueError('Expected a current reports/ path.')
    return Path(root) / relative


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path')
    args = parser.parse_args()
    print(report_path(args.path))
