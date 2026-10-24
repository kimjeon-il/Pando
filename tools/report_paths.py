"""Resolve original report paths through the shared Node owner and hydration."""
import argparse
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def report_path(path, *, access, root=REPO):
    output = subprocess.check_output(
        ['node', str(REPO / 'tools/report-paths.mjs'), str(path), access, str(root)],
        text=True, encoding='utf-8',
    )
    return Path(output.strip())


def report_argument(value, *, access, siblings=False, root=REPO):
    """Resolve a CLI path under this app's reports mount; leave other inputs explicit."""
    if value is None:
        return None
    path = Path(value)
    try:
        relative = path.absolute().relative_to(Path(root).absolute() / 'reports')
    except ValueError:
        return str(path)
    if siblings and relative.parent != Path('.'):
        directory = report_path('reports/' + relative.parent.as_posix(), access=access, root=root)
        return str(directory / relative.name)
    return str(report_path('reports/' + relative.as_posix(), access=access, root=root))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('path')
    parser.add_argument('--access', choices=['read', 'write'], required=True)
    args = parser.parse_args()
    print(report_path(args.path, access=args.access))
