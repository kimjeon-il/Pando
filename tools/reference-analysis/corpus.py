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


def validate_publisher_annotation(annotation, sheet, root):
    if annotation.get('reviewed') is not False or annotation.get('schemaVersion') != 1:
        raise ValueError('Publisher-derived training labels cannot claim human review')
    producer = annotation.get('producer', {})
    script_hash = hashlib.sha256(pathlib.Path(__file__).with_name('publisher.py').read_bytes().replace(b'\r\n', b'\n')).hexdigest()
    if producer != dict(script='tools/reference-analysis/publisher.py', sha256=script_hash,
                        renderer='PyMuPDF', rendererVersion=importlib.metadata.version('PyMuPDF')):
        raise ValueError('Publisher label generator identity differs')
    source = corpus_path(root, annotation.get('sourcePdf'))
    metadata_path = corpus_path(root, annotation.get('sourceMetadata'))
    if hashlib.sha256(source.read_bytes()).hexdigest() != annotation.get('sourceSha256'):
        raise ValueError('Publisher source hash changed')
    if hashlib.sha256(metadata_path.read_bytes()).hexdigest() != annotation.get('sourceMetadataSha256'):
        raise ValueError('Publisher source metadata hash changed')
    metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
    if (metadata.get('sha256') != annotation['sourceSha256'] or metadata.get('rightsReviewed') is not True
            or metadata.get('materialKind') != 'publisher-layered-pdf' or not metadata.get('license')
            or metadata.get('id') != sheet['id'] or metadata.get('familyId') != sheet['familyId']
            or metadata.get('url') != sheet['source']['url']):
        raise ValueError('Verified publisher source provenance required')
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
    producer = annotation.get('producer', {})
    if (annotation.get('schemaVersion') != 1 or annotation.get('reviewed') is not False
            or annotation.get('supervisionQuality') != 'source-derived-weak'
            or producer.get('script') != 'tools/reference-analysis/macro.py'
            or not re.fullmatch('[a-f0-9]{64}', producer.get('sha256', ''))
            or producer.get('renderer') != 'PyMuPDF'
            or producer.get('rendererVersion') != importlib.metadata.version('PyMuPDF')):
        raise ValueError('Explicit source-derived macro provenance required')
    source, metadata_path = [corpus_path(root, annotation.get(field)) for field in ['sourcePdf', 'sourceMetadata']]
    if (hashlib.sha256(source.read_bytes()).hexdigest() != annotation.get('sourceSha256')
            or hashlib.sha256(metadata_path.read_bytes()).hexdigest() != annotation.get('sourceMetadataSha256')):
        raise ValueError('Macro source evidence hash changed')
    metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
    if (metadata.get('sha256') != annotation['sourceSha256']
            or any(metadata.get(key) != sheet.get(key) for key in ['id', 'familyId', 'editionId', 'duplicateGroup', 'geographicScope', 'scopeEvidence'])
            or metadata.get('url') != sheet['source']['url'] or metadata.get('license') != sheet['source']['license']):
        raise ValueError('Verified macro source and geographic scope required')
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
    payload = json.dumps(dict(value=value, trainingOnly=training_only), allow_nan=False).encode('utf-8')
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
                if key == "image" and hashlib.sha256(absolute.read_bytes()).hexdigest() != sheet["sha256"]:
                    raise ValueError("Original image hash changed: " + sheet["id"])
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
    groups = {}
    for sheet in sheets:
        key = "/".join(sheet[k] for k in ["mapKind", "script", "language"])
        groups.setdefault(key, []).append(sheet["id"])
    return groups
