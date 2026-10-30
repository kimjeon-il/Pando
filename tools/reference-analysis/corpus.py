"""Application-owned reference-map corpus contracts. Data stays in the library."""
import hashlib
import json
import pathlib
import subprocess
import re
import importlib.metadata

from PIL import Image, ImageDraw

CHANNELS = ["international", "administrative", "coast", "hydro", "transport", "text", "frame"]
RASTER_ORIGINS = {'publisher-layer-export', 'semap-human-mask-export', 'macro-vector-supervision'}
LANGUAGES = set(json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    "import {REFERENCE_OCR_LANGUAGES} from './plugins/pando-map-tools/lib/analysis/ocr-catalog.mjs'; console.log(JSON.stringify(REFERENCE_OCR_LANGUAGES))",
], cwd=pathlib.Path(__file__).resolve().parents[2], text=True, encoding='utf-8')))


def review_masks(annotation, *, window=None):
    """One rasterization owner for source-reviewed training and full-sheet evaluation."""
    import numpy as np
    width, height = annotation['width'], annotation['height']
    x, y, w, h = window if window is not None else (0, 0, width, height)
    if not isinstance(annotation.get('known'), dict):
        raise ValueError('Explicit per-channel known regions required')
    targets = [Image.new('L', (w, h)) for _ in CHANNELS]
    known = [Image.new('L', (w, h)) for _ in CHANNELS]
    offset = lambda points: [(px-x, py-y) for px, py in points]
    for kind, polygons in annotation['known'].items():
        if kind not in CHANNELS:
            raise ValueError('Unknown semantic annotation class')
        for polygon in polygons:
            ImageDraw.Draw(known[CHANNELS.index(kind)]).polygon(offset(polygon), fill=1)
    for line in annotation.get('lines', []):
        ImageDraw.Draw(targets[CHANNELS.index(line['kind'])]).line(offset(line['points']), fill=1, width=max(1, round(line['width'])))
    for region in annotation.get('regions', []):
        ImageDraw.Draw(targets[CHANNELS.index(region['kind'])]).polygon(offset(region['polygon']), fill=1)
    for polygon in annotation.get('ignore', []):
        for value in known:
            ImageDraw.Draw(value).polygon(offset(polygon), fill=0)
    # A padded training tile never treats pixels outside the original as truth.
    outside = Image.new('L', (w, h))
    ImageDraw.Draw(outside).rectangle((max(0, -x), max(0, -y), min(w, width-x)-1, min(h, height-y)-1), fill=1)
    valid = np.stack([np.asarray(value, dtype=bool) for value in known]) & np.asarray(outside, dtype=bool)
    return np.stack([np.asarray(value, dtype=bool) for value in targets]), valid


def validate_review_annotation(annotation, sheet):
    review = annotation.get('review', {})
    if annotation.get('schemaVersion') != 1 or annotation.get('reviewed') is not True:
        raise ValueError('Source-reviewed current annotations required')
    if (review.get('kind') not in {'agent', 'human', 'source-published'} or not review.get('reviewer')
            or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T[^\s]+Z', review.get('reviewedAt', ''))):
        raise ValueError('Explicit source-review identity required')
    if review.get('sourceSha256') != sheet['sha256']:
        raise ValueError('Review source hash differs from original image')
    if review.get('predictionBlind') is not True:
        raise ValueError('Prediction-blind source review required')
    width, height = annotation.get('width'), annotation.get('height')
    if not isinstance(width, int) or not isinstance(height, int) or min(width, height) < 2:
        raise ValueError('Original image dimensions required')
    import math
    import numpy as np
    def points(values, minimum):
        if (not isinstance(values, list) or len(values) < minimum
                or any(not isinstance(p, list) or len(p) != 2
                       or any(not isinstance(n, (int, float)) or not math.isfinite(n) for n in p)
                       or not (0 <= p[0] < width and 0 <= p[1] < height) for p in values)):
            raise ValueError('Annotations must use finite original image pixels')
    if not isinstance(annotation.get('known'), dict) or not annotation['known']:
        raise ValueError('Explicit per-channel known regions required')
    for kind, polygons in annotation['known'].items():
        if kind not in CHANNELS or not isinstance(polygons, list):
            raise ValueError('Invalid known semantic class')
        for polygon in polygons:
            points(polygon, 3)
    for row in annotation.get('lines', []):
        if row.get('kind') not in CHANNELS or not isinstance(row.get('width'), (int, float)) or not math.isfinite(row['width']) or row['width'] <= 0:
            raise ValueError('Semantic class and measured positive stroke width required')
        points(row.get('points'), 2)
    for row in annotation.get('regions', []):
        if row.get('kind') not in CHANNELS[3:]:
            raise ValueError('Boundary truth requires centerlines; regions describe confounders')
        points(row.get('polygon'), 3)
    for polygon in annotation.get('ignore', []):
        points(polygon, 3)
    target, valid = review_masks({**annotation, 'ignore': []})
    if np.any(target & ~valid):
        raise ValueError('Positive labels extend outside explicitly known regions')


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
    import io
    import zipfile
    import numpy as np
    from semap import convert_labels, member_identity, INSTITUTIONS, FILES
    producer = annotation.get('producer', {})
    if (annotation.get('reviewed') is not False or annotation.get('schemaVersion') != 1
            or producer.get('script') != 'tools/reference-analysis/semap.py'
            or not re.fullmatch('[a-f0-9]{64}', producer.get('sha256', ''))
            or annotation.get('authorPartition') != 'train'
            or annotation.get('synthetic') is not False or annotation.get('observedChannels') != ['hydro', 'transport']
            or annotation.get('labelMapping') != {'4': 'hydro', '5': 'transport'}):
        raise ValueError('Verified real-only Semap auxiliary provenance required')
    if len(annotation.get('sourceFiles', [])) != 5:
        raise ValueError('Semap original image, original label, partition and rights evidence required')
    for spec in annotation['sourceFiles']:
        if hashlib.sha256(corpus_path(root, spec['path']).read_bytes()).hexdigest() != spec['sha256']:
            raise ValueError('Semap source evidence hash changed')
    validate_training_rasters(annotation, sheet, root)
    member = annotation.get('originalImageMember', '')
    identity = member_identity(member)
    key = pathlib.PurePosixPath(member).stem
    sources = {pathlib.PurePosixPath(spec['path']).name: spec for spec in annotation['sourceFiles']}
    if (not identity or identity[0] not in INSTITUTIONS or set(sources) != {key + '.jpg', key + '.png', 'partitions.zip', 'license_images.md', 'README.md'}
            or sources[key + '.jpg']['path'] != sheet['image'] or sources[key + '.jpg']['sha256'] != sheet['sha256']):
        raise ValueError('Licensed real Semap member identity required')
    for name in ['partitions.zip', 'license_images.md', 'README.md']:
        value = corpus_path(root, sources[name]['path']).read_bytes()
        if len(value) != FILES[name][0] or hashlib.md5(value).hexdigest() != FILES[name][1]:
            raise ValueError('Pinned Semap split/rights documentation differs')
    with zipfile.ZipFile(io.BytesIO(corpus_path(root, sources['partitions.zip']['path']).read_bytes())) as partitions:
        names = [name for name in partitions.namelist() if name.endswith('/train.txt') or name == 'train.txt']
        if len(names) != 1 or key not in partitions.read(names[0]).decode().split():
            raise ValueError('Original Semap author training partition required')
    with Image.open(corpus_path(root, sources[key + '.png']['path'])) as source:
        expected = convert_labels(np.asarray(source))
    for field, array in zip(['raster', 'validRaster'], expected):
        with Image.open(corpus_path(root, annotation[field]['path'])) as raster:
            if not np.array_equal(array, np.asarray(raster)):
                raise ValueError('Semap source label conversion differs')


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
