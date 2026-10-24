"""Scoped runtime writes owned by the shared library-data Node implementation."""
import contextlib
import json
import os
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]


@contextlib.contextmanager
def library_write(prefixes, *, root=ROOT):
    root = pathlib.Path(root).absolute()
    command = ['node', str(ROOT / 'tools/library-data.mjs')]
    arguments = [f'--root={root}', *[f'--include-prefix={p}' for p in prefixes]]
    inherited = os.environ.get('PANDOLAB_LIBRARY_WRITE_LEASE')
    if inherited:
        if not re.fullmatch(r'[\w-]+', inherited):
            raise RuntimeError('Invalid inherited library write lease ID')
        # The parent wrapper owns completion. Never create a second overlapping lease.
        from pathlib import Path
        repository = (root / '.library-data/repository').resolve()
        common = subprocess.check_output(['git', 'rev-parse', '--git-common-dir'], cwd=repository, text=True).strip()
        shared = (repository / common).resolve().parent
        record = json.loads((shared / '.pando-store/leases' / (inherited + '.json')).read_text(encoding='utf-8'))
        if record.get('schema') != 'pando-library-write-v1' or Path(record['root']) != root or any(not any(p == a or p.startswith(a + '/') for a in record['prefixes']) for p in prefixes):
            raise RuntimeError('Inherited library write lease does not cover this scope')
        yield
        return
    lease = json.loads(subprocess.check_output(command + ['--begin-write', *arguments, f'--writer-pid={os.getpid()}'], text=True, encoding='utf-8'))
    try:
        yield
    finally:
        subprocess.check_call(command + ['--end-write', f'--root={root}', '--lease-id=' + lease['id']])


@contextlib.contextmanager
def library_output(paths, *, root=ROOT):
    """Lease mounted destinations; keep custom build/staging folders private."""
    root = pathlib.Path(root).absolute()
    config = root / 'config/library-data.json'
    if not config.exists():
        yield
        return
    mounts = json.loads(config.read_text(encoding='utf-8'))['mounts']
    prefixes = []
    for path in paths:
        try:
            logical = pathlib.Path(path).absolute().relative_to(root).as_posix()
        except ValueError:
            continue
        if any(m != 'reports' and (logical == m or logical.startswith(m + '/')) for m in mounts):
            prefixes.append(logical)
    if prefixes:
        with library_write(prefixes, root=root):
            yield
    else:
        yield


def write_library_text(path, *args, **kwargs):
    with library_output([path]):
        return pathlib.Path(path).write_text(*args, **kwargs)


def write_library_bytes(path, *args, **kwargs):
    with library_output([path]):
        return pathlib.Path(path).write_bytes(*args, **kwargs)
