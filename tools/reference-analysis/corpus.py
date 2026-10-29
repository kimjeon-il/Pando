"""Application-owned reference-map corpus contracts. Data stays in the library."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from report_paths import report_argument
import re
import importlib.metadata

from PIL import Image

CHANNELS = ["international", "administrative", "coast", "hydro", "transport", "text", "frame"]
RASTER_ORIGINS = {'publisher-layer-export', 'semap-human-mask-export', 'macro-vector-supervision'}
LANGUAGES = set(json.loads(subprocess.check_output([
    'node', '--input-type=module', '-e',
    "import {REFERENCE_OCR_LANGUAGES} from './plugins/pando-map-tools/lib/analysis/ocr-catalog.mjs'; console.log(JSON.stringify(REFERENCE_OCR_LANGUAGES))",
], cwd=pathlib.Path(__file__).resolve().parents[2], text=True, encoding='utf-8')))


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
        raise ValueError('Human-reviewed independent corpus required; supplied corpus is training-only')
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
        if (sheet.get("language") not in LANGUAGES and not (training_only and sheet.get('language') == 'und')) or not sheet.get("script"):
            raise ValueError("Supported language and explicit script required")
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
                    elif annotations.get("reviewed") is not True or annotations.get("schemaVersion") != 1 or annotations.get('origin') in RASTER_ORIGINS:
                        raise ValueError("Human-reviewed current annotation schema required")
    return value


def evaluation_groups(sheets):
    groups = {}
    for sheet in sheets:
        key = "/".join(sheet[k] for k in ["mapKind", "script", "language"])
        groups.setdefault(key, []).append(sheet["id"])
    return groups


def prepare_review_corpus(sources):
    """Prepare unreviewed current-schema labels without copying map masters."""
    sources = pathlib.Path(sources).resolve()
    root = sources.parent

    def contained(path):
        if not path.resolve().is_relative_to(root):
            raise ValueError("Review corpus path escape")
        return path

    labels_dir = contained(root / "labels")
    manifest = contained(root / "corpus.draft.json")
    sheets, drafts = [], []
    seen = set()
    for metadata_path in sorted(sources.glob("*.source.json")):
        contained(metadata_path)
        source = json.loads(metadata_path.read_text(encoding="utf-8"))
        key = source.get("id", "")
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]*", key) or key in seen:
            raise ValueError("Unique safe source id required")
        seen.add(key)
        image = contained(sources / (key + ".jpg"))
        if (source.get("rightsReviewed") is not True or not source.get("license") or not source.get("url")
                or not source.get("familyId") or source.get("language") not in LANGUAGES or not source.get("script")):
            raise ValueError("Verified acquired source and provenance required")
        if source.get("sha256") != hashlib.sha256(image.read_bytes()).hexdigest():
            raise ValueError("Original image hash changed: " + key)
        previous_limit = Image.MAX_IMAGE_PIXELS
        Image.MAX_IMAGE_PIXELS = 300_000_000
        try:
            with Image.open(image) as header:
                if header.format != "JPEG" or header.getexif().get(274, 1) != 1:
                    raise ValueError("Current acquired JPEG orientation required")
                width, height = header.size
        finally:
            Image.MAX_IMAGE_PIXELS = previous_limit
        labels = contained(labels_dir / (key + ".json"))
        annotation = dict(schemaVersion=1, reviewed=False, width=width, height=height, lines=[], ignore=[])
        if labels.exists():
            existing = json.loads(labels.read_text(encoding="utf-8"))
            if any(existing.get(field) != annotation[field] for field in ["schemaVersion", "width", "height"]):
                raise ValueError("Existing labels differ from source dimensions; preserve for inspection")
        else:
            drafts.append((labels, annotation))
        sheets.append(dict(id=key, familyId=source["familyId"], editionId=None, duplicateGroup=key,
                           split=None, image=image.relative_to(root).as_posix(), sha256=source["sha256"],
                           annotations=labels.relative_to(root).as_posix(), mapKind=None,
                           language=source["language"], script=source["script"],
                           source={field: source.get(field) for field in ["url", "metadataUrl", "license", "surveyed", "published", "revised", "materialKind", "uncertainty"]}))
    if not sheets:
        raise ValueError("Verified acquired map sources required")
    if manifest.exists():
        existing = json.loads(manifest.read_text(encoding="utf-8"))
        old_sheets = existing.get("sheets", [])
        expected = {row["id"]: row for row in sheets}
        if existing.get("schemaVersion") != 1 or len(old_sheets) != len(sheets) or {row.get("id") for row in old_sheets} != set(expected):
            raise ValueError("Existing draft source inventory differs; preserve for inspection")
        for row in old_sheets:
            if any(row.get(field) != expected[row["id"]][field] for field in ["image", "sha256", "annotations", "familyId"]):
                raise ValueError("Existing draft source identity differs; preserve for inspection")
    # Validate every source and existing target before creating any draft files.
    labels_dir.mkdir(exist_ok=True)
    for path, value in drafts:
        with path.open("x", encoding="utf-8") as output:
            json.dump(value, output, ensure_ascii=False, indent=2)
            output.write("\n")
    if not manifest.exists():
        with manifest.open("x", encoding="utf-8") as output:
            json.dump(dict(schemaVersion=1, trainingReady=False, sheets=sheets), output, ensure_ascii=False, indent=2)
            output.write("\n")
    return manifest


def inventory(reports, sources):
    entries = []
    for root in [pathlib.Path(reports), pathlib.Path(sources)]:
        if not root.exists():
            continue
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.suffix.lower() not in {".jpg", ".jpeg", ".png", ".tif", ".jp2", ".pdf", ".md"}:
                continue
            if path.suffix.lower() == ".md":
                text = path.read_text(encoding="utf-8", errors="replace")
                urls = sorted(set(re.findall(r"https?://[^\s<>\])]+", text)))
                urls = [url for url in urls if re.search(r"wms|kartenforum|fotothek|\.pdf|\.jpg|\.tif|iiif|map|atlas", url, re.I)]
                if urls:
                    entries.append(dict(path=str(path), kind="source-references", urls=urls, annotationStatus="unreviewed"))
            else:
                original = root == pathlib.Path(sources) or 'sources' in path.relative_to(root).parts[:-1]
                kind = "original-candidate" if original else "report-evidence-candidate"
                source_metadata, derivative_metadata = path.with_suffix('.source.json'), path.with_suffix('.json')
                if source_metadata.is_file() and json.loads(source_metadata.read_text(encoding='utf-8')).get('materialKind') == 'official-downsample':
                    kind = 'source-downsample-candidate'
                if derivative_metadata.is_file() and json.loads(derivative_metadata.read_text(encoding='utf-8')).get('purpose') == 'app-runtime-input-only':
                    kind = 'analysis-derivative'
                entries.append(dict(path=str(path), kind=kind,
                                    sha256=hashlib.sha256(path.read_bytes()).hexdigest(), annotationStatus="unlabelled"))
    return dict(schemaVersion=1, entries=entries, trainingReady=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus")
    parser.add_argument("--reports")
    parser.add_argument("--sources")
    parser.add_argument("--output")
    parser.add_argument("--prepare-review", type=pathlib.Path, metavar="SOURCE_DIRECTORY")
    args = parser.parse_args()
    if args.prepare_review:
        args.prepare_review = pathlib.Path(report_argument(args.prepare_review, access='write'))
    args.corpus = report_argument(args.corpus, access='read', siblings=True)
    args.reports = report_argument(args.reports, access='read')
    args.sources = report_argument(args.sources, access='read')
    args.output = report_argument(args.output, access='write')
    if args.prepare_review:
        if any([args.corpus, args.reports, args.sources, args.output]):
            parser.error("--prepare-review takes only the acquired source directory")
        if args.prepare_review.resolve().is_relative_to(pathlib.Path(__file__).resolve().parents[2]):
            parser.error("Review materials belong to external library storage")
        print(prepare_review_corpus(args.prepare_review))
    elif args.corpus:
        path = pathlib.Path(args.corpus)
        result = validate_corpus(json.loads(path.read_text(encoding="utf-8")), path.parent)
        print(json.dumps(dict(valid=True, groups=evaluation_groups(result["sheets"])), ensure_ascii=False))
    else:
        if not all([args.reports, args.sources, args.output]):
            parser.error("Inventory requires --reports, --sources and --output")
        output = pathlib.Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(inventory(args.reports, args.sources), ensure_ascii=False, indent=2), encoding="utf-8")
