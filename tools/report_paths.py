"""Resolve original report paths through the shared Node owner and hydration."""
import argparse
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def report_path(legacy, root=REPO):
    output = subprocess.check_output(
        ['node', str(REPO / 'tools/report-paths.mjs'), str(legacy), str(root)],
        text=True, encoding='utf-8',
    )
    return Path(output.strip())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path')
    args = parser.parse_args()
    print(report_path(args.path))
