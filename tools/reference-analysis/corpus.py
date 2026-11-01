"""Application-owned reference-map corpus contracts. Data stays in the library."""
import json
import pathlib
import subprocess
import re
import importlib.metadata

CHANNELS = ["international", "administrative", "coast", "hydro", "transport", "text", "frame"]

def lineage_operation(action, **values):
    script = pathlib.Path(__file__).with_name('training-lineage.mjs')
    payload = json.dumps(dict(action=action, **values), allow_nan=False).encode('utf-8')
    result = subprocess.run(['node', str(script), '--stream'], input=payload,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError('Training lineage validation failed: ' + result.stderr.decode('utf-8', errors='replace'))
    response = json.loads(result.stdout)
    if not isinstance(response, dict) or set(response) != {'result'}:
        raise ValueError('Invalid training lineage response')
    return response['result']


def build_training_lineage(sheets, *, parent=None, parent_sha256=None):
    return lineage_operation('build', sheets=sheets, parent=parent, parentSha256=parent_sha256)


def assert_evaluation_independence(lineage, sheets, *, split='test'):
    lineage_operation('independent', lineage=lineage, sheets=sheets, split=split)


def corpus_path(root, relative):
    if not isinstance(relative, str):
        raise ValueError('Corpus path required')
    path = pathlib.PurePosixPath(relative)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('Corpus paths must stay inside corpus root')
    absolute = (pathlib.Path(root) / path).resolve()
    if not absolute.is_relative_to(pathlib.Path(root).resolve()):
        raise ValueError('Corpus symlink escapes root')
    return absolute


def corpus_fingerprint(manifest, auxiliary=None):
    script = pathlib.Path(__file__).with_name('training-evidence.mjs')
    payload = json.dumps(dict(manifest=str(manifest), auxiliary=str(auxiliary) if auxiliary else None)).encode('utf-8')
    result = subprocess.run(['node', str(script), '--fingerprint-stream'], input=payload,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=1800,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError('Native corpus fingerprint failed: ' + result.stderr.decode('utf-8', errors='replace'))
    fingerprint = json.loads(result.stdout).get('fingerprint')
    if not isinstance(fingerprint, str) or not re.fullmatch('[a-f0-9]{64}', fingerprint):
        raise ValueError('Invalid corpus fingerprint response')
    return fingerprint


def validate_corpus(value, root=None, *, training_only=False):
    if training_only and root is None:
        raise ValueError('Explicit materialized training-only corpus required')
    script = pathlib.Path(__file__).with_name('materialized-corpus.mjs')
    try:
        renderer_version = importlib.metadata.version('PyMuPDF')
    except importlib.metadata.PackageNotFoundError:
        renderer_version = None
    payload = json.dumps(dict(value=value, trainingOnly=training_only, root=str(pathlib.Path(root).resolve()) if root else None,
                              rendererVersion=renderer_version), allow_nan=False).encode('utf-8')
    result = subprocess.run(['node', str(script), '--stream'], input=payload, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=1800, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError('Corpus metadata validation failed: ' + result.stderr.decode('utf-8', errors='replace'))
    if json.loads(result.stdout) != {'valid': True}:
        raise ValueError('Invalid corpus metadata validation response')
    return value


def evaluation_groups(sheets):
    script = pathlib.Path(__file__).with_name('reviewed-corpus.mjs')
    result = subprocess.run(['node', str(script), '--groups-stream'], input=json.dumps(sheets, allow_nan=False).encode('utf-8'),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError('Corpus evaluation grouping failed: ' + result.stderr.decode('utf-8', errors='replace'))
    groups = json.loads(result.stdout)
    if not isinstance(groups, dict) or any(not isinstance(ids, list) for ids in groups.values()):
        raise ValueError('Invalid corpus evaluation grouping response')
    return groups
