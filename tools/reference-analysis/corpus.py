"""Application-owned reference-map corpus contracts. Data stays in the library."""
import hashlib
import json
import pathlib
import subprocess
import re
import importlib.metadata

from PIL import Image

CHANNELS = ["international", "administrative", "coast", "hydro", "transport", "text", "frame"]
RASTER_ORIGINS = {'publisher-layer-export', 'semap-human-mask-export', 'macro-vector-supervision'}
def validate_review_annotation(annotation, sheet):
    script = pathlib.Path(__file__).with_name('review-masks.mjs')
    payload = json.dumps(dict(annotation=annotation, sheet=sheet), allow_nan=False).encode('utf-8')
    result = subprocess.run(['node', str(script), '--validate-stream'], input=payload,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=1800,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError('Native review validation failed: ' + result.stderr.decode('utf-8', errors='replace'))
    if json.loads(result.stdout) != {'valid': True}:
        raise ValueError('Invalid native review validation response')


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


def validate_training_provenance(action, annotation, sheet, root):
    script = pathlib.Path(__file__).with_name('reviewed-corpus.mjs')
    request = dict(annotation=annotation, sheet=sheet, root=str(pathlib.Path(root).resolve()),
                   rendererVersion=importlib.metadata.version('PyMuPDF'))
    result = subprocess.run(['node', str(script), f'--{action}-provenance-stream'],
                            input=json.dumps(request, allow_nan=False).encode('utf-8'),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=1800,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError(f'{action} provenance validation failed: ' + result.stderr.decode('utf-8', errors='replace'))
    if json.loads(result.stdout) != {'valid': True}:
        raise ValueError('Invalid training provenance validation receipt')


def validate_publisher_annotation(annotation, sheet, root):
    validate_training_provenance('publisher', annotation, sheet, root)
    validate_training_rasters(annotation, sheet, root)


def validate_semap_annotation(annotation, sheet, root):
    script = pathlib.Path(__file__).with_name('validate-semap.mjs')
    request = json.dumps(dict(root=str(pathlib.Path(root).resolve()), sheet=sheet, annotation=annotation)).encode('utf-8')
    result = subprocess.run(['node', str(script), '--sheet-stream'], input=request, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=180, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError('Semap validation failed: ' + result.stderr.decode('utf-8', errors='replace'))
    receipt = json.loads(result.stdout)
    if receipt != dict(valid=True, sheets=1, trainingOnly=True, independentEvaluation=False):
        raise ValueError('Invalid native Semap validation receipt')


def validate_training_rasters(annotation, sheet, root):
    observed = annotation.get('observedChannels', [])
    if not observed or len(set(observed)) != len(observed) or any(channel not in CHANNELS for channel in observed):
        raise ValueError('Explicit observed publisher channels required')
    allowed = sum(1 << CHANNELS.index(channel) for channel in observed)
    for name in ['raster', 'validRaster']:
        spec = annotation.get(name, {})
        path = corpus_path(root, spec.get('path'))
        if hashlib.sha256(path.read_bytes()).hexdigest() != spec.get('sha256'):
            raise ValueError('Publisher raster hash changed')
        with Image.open(path) as image:
            if image.mode != 'L' or list(image.size) != [annotation.get('width'), annotation.get('height')]:
                raise ValueError('Publisher raster dimensions or mode differ')
            if any(value and value & ~allowed for value, count in enumerate(image.histogram()) if count):
                raise ValueError('Publisher raster contains unobserved channels')
    with Image.open(corpus_path(root, sheet['image'])) as image:
        if list(image.size) != [annotation['width'], annotation['height']]:
            raise ValueError('Publisher raster/image dimensions differ')


def validate_macro_annotation(annotation, sheet, root):
    import numpy as np
    from macro import derive, image_bytes
    validate_training_provenance('macro', annotation, sheet, root)
    source, metadata_path = [corpus_path(root, annotation.get(field)) for field in ['sourcePdf', 'sourceMetadata']]
    metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
    validate_training_rasters(annotation, sheet, root)
    image, target, valid, _ = derive(source, metadata, annotation['maximumDimension'])
    for field, expected in [('raster', target), ('validRaster', valid)]:
        with Image.open(corpus_path(root, annotation[field]['path'])) as raster:
            if not np.array_equal(expected, np.asarray(raster)):
                raise ValueError('Macro source supervision differs')
    if hashlib.sha256(image_bytes(image, 'JPEG')).hexdigest() != sheet['sha256']:
        raise ValueError('Macro source image differs')
    observed = [name for index, name in enumerate(CHANNELS) if np.any(valid & (1 << index))]
    positives = {name: int(np.count_nonzero(target & (1 << index))) for index, name in enumerate(CHANNELS)}
    if annotation['observedChannels'] != observed or annotation['positivePixels'] != positives:
        raise ValueError('Macro source supervision statistics differ')


def validate_corpus(value, root=None, *, training_only=False):
    if training_only and root is None:
        raise ValueError('Explicit materialized training-only corpus required')
    script = pathlib.Path(__file__).with_name('reviewed-corpus.mjs')
    payload = json.dumps(dict(value=value, trainingOnly=training_only, root=str(pathlib.Path(root).resolve()) if root else None), allow_nan=False).encode('utf-8')
    result = subprocess.run(['node', str(script), '--metadata-stream'], input=payload, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=120, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError('Corpus metadata validation failed: ' + result.stderr.decode('utf-8', errors='replace'))
    if json.loads(result.stdout) != {'valid': True}:
        raise ValueError('Invalid corpus metadata validation response')
    for sheet in value["sheets"]:
        for key in ["image", "annotations"]:
            if root:
                absolute = corpus_path(root, sheet[key])
                if key == "annotations":
                    annotations = json.loads(absolute.read_text(encoding="utf-8"))
                    if annotations.get('origin') == 'publisher-layer-export' and training_only:
                        validate_publisher_annotation(annotations, sheet, root)
                    elif annotations.get('origin') == 'semap-human-mask-export' and training_only:
                        validate_semap_annotation(annotations, sheet, root)
                    elif annotations.get('origin') == 'macro-vector-supervision' and training_only:
                        validate_macro_annotation(annotations, sheet, root)
                    elif annotations.get('origin') in RASTER_ORIGINS:
                        raise ValueError('Derived training labels cannot become independent review truth')
                    else:
                        validate_review_annotation(annotations, sheet)
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
