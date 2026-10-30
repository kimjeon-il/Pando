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
LANGUAGES = set(json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    "import {REFERENCE_OCR_LANGUAGES} from './plugins/pando-map-tools/lib/analysis/ocr-catalog.mjs'; console.log(JSON.stringify(REFERENCE_OCR_LANGUAGES))",
], cwd=pathlib.Path(__file__).resolve().parents[2], text=True, encoding='utf-8')))


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


LINEAGE_KEYS = ('id', 'sha256', 'familyId', 'editionId', 'duplicateGroup')


def validate_training_lineage(value):
    if (not isinstance(value, dict) or value.get('schemaVersion') != 1 or value.get('complete') is not True
            or not isinstance(value.get('sheets'), list) or not isinstance(value.get('parents'), list)):
        raise ValueError('Complete verified ancestral lineage required')
    if any(not isinstance(sha, str) or not re.fullmatch('[a-f0-9]{64}', sha) for sha in value['parents']):
        raise ValueError('Complete ancestral checkpoint hashes required')
    for row in value['sheets']:
        if (not all(isinstance(row.get(key), str) and row[key] for key in LINEAGE_KEYS)
                or not re.fullmatch('[a-f0-9]{64}', row['sha256']) or row.get('usage') not in {'train', 'selection'}):
            raise ValueError('Complete ancestral source identity required')
    return value


def build_training_lineage(sheets, *, parent=None, parent_sha256=None):
    """Record training and model-selection exposure, including every ancestor."""
    result = dict(schemaVersion=1, complete=True, parents=[], sheets=[])
    if parent is not None:
        validate_training_lineage(parent)
        if not re.fullmatch('[a-f0-9]{64}', parent_sha256 or ''):
            raise ValueError('Complete verified ancestral lineage required')
        result['parents'] = [*parent.get('parents', []), parent_sha256]
        result['sheets'] = [dict(row) for row in parent['sheets']]
    for sheet in sheets:
        if sheet.get('split') == 'test':
            continue
        row = {key: sheet.get(key) for key in LINEAGE_KEYS}
        row['usage'] = 'selection' if sheet.get('split') == 'validation' else 'train'
        if not all(isinstance(row[key], str) and row[key] for key in LINEAGE_KEYS) or not re.fullmatch('[a-f0-9]{64}', row['sha256']):
            raise ValueError('Complete source/family identity required for lineage')
        if row not in result['sheets']:
            result['sheets'].append(row)
    return validate_training_lineage(result)


def assert_evaluation_independence(lineage, sheets, *, split='test'):
    validate_training_lineage(lineage)
    for sheet in sheets:
        if split not in {'test', 'validation'} or sheet.get('split') != split:
            raise ValueError('Independent final-test split required')
        for previous in lineage['sheets']:
            for key in LINEAGE_KEYS:
                if not sheet.get(key) or sheet[key] == previous[key]:
                    raise ValueError('Not independent: ancestral ' + key + ' overlap or missing identity')


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
    """Pin labels and their rasters as well as the manifest and original images."""
    if auxiliary:
        return hashlib.sha256(json.dumps([corpus_fingerprint(manifest), corpus_fingerprint(auxiliary)]).encode()).hexdigest()
    manifest = pathlib.Path(manifest).resolve()
    value = json.loads(manifest.read_text(encoding='utf-8'))
    root, files = manifest.parent, {manifest.name}
    for sheet in value['sheets']:
        files.update([sheet['image'], sheet['annotations']])
        annotation = json.loads(corpus_path(root, sheet['annotations']).read_text(encoding='utf-8'))
        if annotation.get('origin') in {'publisher-layer-export', 'macro-vector-supervision'}:
            files.update([annotation['sourcePdf'], annotation['sourceMetadata'],
                          annotation['raster']['path'], annotation['validRaster']['path']])
        elif annotation.get('origin') == 'semap-human-mask-export':
            files.update([spec['path'] for spec in annotation['sourceFiles']])
            files.update([annotation['raster']['path'], annotation['validRaster']['path']])
    digest = hashlib.sha256()
    for relative in sorted(files):
        with corpus_path(root, relative).open('rb') as stream:
            file_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
        digest.update(f'{relative}\n{file_hash}\n'.encode('utf-8'))
    return digest.hexdigest()


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
    if value.get("schemaVersion") != 1 or not isinstance(value.get("sheets"), list):
        raise ValueError("Corpus schemaVersion=1 and sheets are required")
    if training_only and (value.get('trainingOnly') is not True or root is None):
        raise ValueError('Explicit materialized training-only corpus required')
    if not training_only and value.get('trainingOnly'):
        raise ValueError('Source-reviewed independent corpus required; supplied corpus is training-only')
    seen, splits = set(), {}
    for sheet in value["sheets"]:
        if not sheet.get("id") or sheet["id"] in seen:
            raise ValueError("Unique sheet id required")
        seen.add(sheet["id"])
        if sheet.get("split") not in {"train", "validation", "test"}:
            raise ValueError("Explicit train/validation/test split required")
        if training_only and sheet['split'] != 'train':
            raise ValueError('Publisher training-only data cannot become validation/test truth')
        for key in ["familyId", "editionId", "duplicateGroup"]:
            group = sheet.get(key)
            if not group:
                raise ValueError(key + " required")
            previous = splits.setdefault((key, group), sheet["split"])
            if previous != sheet["split"]:
                raise ValueError(key + " crosses split boundaries")
        if not sheet.get("annotations"):
            raise ValueError("Reviewed annotations required; unlabelled sources are inventory only")
        if not re.fullmatch("[a-f0-9]{64}", sheet.get("sha256", "")):
            raise ValueError("Original image sha256 required")
        validate_source_language(sheet)
        if sheet.get("mapKind") not in {"color", "monochrome"}:
            raise ValueError("mapKind must be color or monochrome")
        if not all(sheet.get("source", {}).get(key) for key in ["url", "license"]):
            raise ValueError("Source URL and license required")
        for key in ["image", "annotations"]:
            path = pathlib.PurePosixPath(sheet[key])
            if path.is_absolute() or ".." in path.parts:
                raise ValueError("Corpus paths must stay inside corpus root")
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


def validate_source_language(source):
    if not re.fullmatch(r'[a-z]{3}(?:_[a-z0-9]+)*', source.get('language', '')) or not source.get('script'):
        raise ValueError('Explicit source language and script required')
    packs = source.get('ocrLanguages', [])
    if not isinstance(packs, list) or len(set(packs)) != len(packs) or any(pack not in LANGUAGES for pack in packs):
        raise ValueError('OCR languages must refer to the installed runtime catalog')
