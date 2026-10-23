"""Source-derived training labels from published US Topo optional-content layers."""
import argparse
import hashlib
import json
import math
import pathlib
import re

import numpy as np
import pymupdf
from PIL import Image, ImageDraw

from corpus import CHANNELS, validate_corpus

LAYER_CHANNELS = {
    'international': ['International'],
    'administrative': ['State or Territory', 'County or Equivalent'],
    'hydro': ['Hydrography'],
    'transport': ['Road Features', 'Trails', 'Railroads'],
    'frame': ['Map Frame', 'Projection and Grids'],
}
DISABLED_INPUT_LAYERS = ['Orthoimage', 'Shaded Relief']


def file_hash(path):
    with pathlib.Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def producer_identity():
    return dict(script='tools/reference-analysis/publisher.py',
                sha256=hashlib.sha256(pathlib.Path(__file__).read_bytes().replace(b'\r\n', b'\n')).hexdigest(),
                renderer='PyMuPDF', rendererVersion=pymupdf.VersionBind)


def prepare_sheet(source, root, maximum_dimension=2560):
    root, source = pathlib.Path(root).resolve(), pathlib.Path(source).resolve()
    if not source.is_relative_to(root) or source.suffix != '.pdf':
        raise ValueError('Publisher PDF must remain inside corpus root')
    metadata_path = source.with_suffix('.source.json')
    metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
    key = metadata.get('id', '')
    if (not re.fullmatch(r'[a-z0-9][a-z0-9-]*', key) or metadata.get('format') != 'pdf'
            or metadata.get('materialKind') != 'publisher-layered-pdf' or metadata.get('rightsReviewed') is not True
            or not metadata.get('license') or metadata.get('sha256') != file_hash(source)):
        raise ValueError('Verified acquired publisher PDF and provenance required')
    if not isinstance(maximum_dimension, int) or not 32 <= maximum_dimension <= 4096:
        raise ValueError('Bounded publisher render size required')
    paths = {name: root / relative for name, relative in {
        'image': f'derived/{key}.jpg', 'raster': f'derived/{key}.mask.png',
        'validRaster': f'derived/{key}.valid.png', 'annotations': f'labels/{key}.json',
        'notice': f'notices/{key}.txt',
    }.items()}
    if any(not path.resolve().is_relative_to(root) for path in [metadata_path, *paths.values()]):
        raise ValueError('Publisher output path escape')
    if any(path.exists() for path in paths.values()):
        if not all(path.is_file() for path in paths.values()):
            raise ValueError('Incomplete existing publisher labels; preserve for inspection')
        annotation = json.loads(paths['annotations'].read_text(encoding='utf-8'))
        if (annotation.get('maximumDimension') != maximum_dimension or annotation.get('producer') != producer_identity()
                or annotation.get('sourceSha256') != metadata['sha256']):
            raise ValueError('Existing publisher render identity differs; preserve for inspection')
        sheet = annotation['sheet']
        validate_corpus(dict(schemaVersion=1, trainingOnly=True, sheets=[sheet]), root, training_only=True)
        return sheet
    with pymupdf.open(source) as doc:
        if len(doc) != 1 or doc[0].rotation != 0:
            raise ValueError('Single unrotated publisher map page required')
        ocgs = doc.get_ocgs()
        names = {row['name']: xref for xref, row in ocgs.items()}
        if len(names) != len(ocgs) or not all(name in names for name in ['International', 'Map Frame', 'Hydrography']):
            raise ValueError('Unambiguous International, Map Frame and Hydrography layers required')
        parents, stack = {}, []
        for row in doc.layer_ui_configs():
            while stack and stack[-1][0] >= row['depth']:
                stack.pop()
            if row['text'] in names:
                parents[row['text']] = [name for _, name in stack]
                stack.append((row['depth'], row['text']))
        scale = maximum_dimension / max(doc[0].rect.width, doc[0].rect.height)
        matrix = pymupdf.Matrix(scale, scale)

        def render(enabled):
            on = [names[name] for name in enabled]
            doc.set_layer(-1, on=on, off=[xref for xref in ocgs if xref not in on], basestate='OFF')
            # Reopen the in-memory configuration so MuPDF cannot reuse an old
            # display-list visibility state. The original PDF is never saved.
            with pymupdf.open(stream=doc.tobytes(), filetype='pdf') as view:
                pix = view[0].get_pixmap(matrix=matrix, alpha=False)
                return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).copy()

        visible = set(names) - set(DISABLED_INPUT_LAYERS)
        image = render(visible)
        height, width = image.shape[:2]
        # Text is labelled from publisher glyph spans. Boundary pixels under
        # their boxes are unknown rather than incorrectly labelled as background.
        doc.set_layer(-1, on=list(ocgs), off=[], basestate='ON')
        with pymupdf.open(stream=doc.tobytes(), filetype='pdf') as text_doc:
            boxes = [character[3] for span in text_doc[0].get_texttrace()
                     if span.get('type') != 3 and span.get('opacity', 1) > 0
                     and span.get('layer') not in DISABLED_INPUT_LAYERS
                     for character in span['chars'] if not chr(character[0]).isspace()]
            credit_text = text_doc[0].get_text()
        text = Image.new('L', (width, height))
        draw = ImageDraw.Draw(text)
        for box in boxes:
            if not all(math.isfinite(value) for value in box):
                continue
            x0, y0, x1, y1 = [value * scale for value in box]
            if x1 > x0 and y1 > y0:
                draw.rectangle((math.floor(x0) - 1, math.floor(y0) - 1, math.ceil(x1) + 1, math.ceil(y1) + 1), fill=1)
        text_pixels = np.asarray(text).astype(bool)
        masks = np.zeros((height, width), dtype=np.uint8)
        masks[text_pixels] |= 1 << CHANNELS.index('text')
        observed, selections = ['text'], {}
        for channel, candidates in LAYER_CHANNELS.items():
            layers = [name for name in candidates if name in names]
            if not layers:
                continue
            observed.append(channel)
            selections[channel] = layers
            pixels = np.zeros((height, width), dtype=bool)
            for name in layers:
                ancestors = set(parents.get(name, []))
                before, after = render(ancestors), render(ancestors | {name})
                pixels |= np.max(np.abs(after.astype(np.int16) - before.astype(np.int16)), axis=2) > 8
            pixels[text_pixels] = False
            masks[pixels] |= 1 << CHANNELS.index(channel)
        observed.sort(key=CHANNELS.index)
        bits = sum(1 << CHANNELS.index(channel) for channel in observed)
        validity = np.full((height, width), bits, dtype=np.uint8)
        validity[text_pixels] = 1 << CHANNELS.index('text')
        sheet = dict(id=key, familyId=metadata['familyId'], editionId=metadata['editionId'], duplicateGroup=key,
                     split='train', image=paths['image'].relative_to(root).as_posix(),
                     annotations=paths['annotations'].relative_to(root).as_posix(),
                     mapKind='color', language=metadata['language'], script=metadata['script'],
                     source={name: metadata.get(name) for name in ['url', 'metadataUrl', 'license', 'rightsUrl', 'published']})
        annotation = dict(schemaVersion=1, reviewed=False, origin='publisher-layer-export',
                          width=width, height=height, maximumDimension=maximum_dimension, observedChannels=observed,
                          sourcePdf=source.relative_to(root).as_posix(), sourceSha256=metadata['sha256'],
                          sourceMetadata=metadata_path.relative_to(root).as_posix(), sourceMetadataSha256=file_hash(metadata_path),
                          producer=producer_identity(), sourceRectPts=list(doc[0].rect), pixelsPerPoint=scale,
                          layers=selections, disabledInputLayers=DISABLED_INPUT_LAYERS,
                          positivePixels={channel: int(np.count_nonzero(masks & (1 << CHANNELS.index(channel)))) for channel in CHANNELS})
    created = []
    try:
        def save(name, value, format):
            paths[name].parent.mkdir(parents=True, exist_ok=True)
            with paths[name].open('xb') as output:
                created.append(paths[name])
                Image.fromarray(value).save(output, format=format, **({'quality': 95} if format == 'JPEG' else {}))
        save('image', image, 'JPEG')
        save('raster', masks, 'PNG')
        save('validRaster', validity, 'PNG')
        sheet['sha256'] = file_hash(paths['image'])
        for name in ['raster', 'validRaster']:
            annotation[name] = dict(path=paths[name].relative_to(root).as_posix(), sha256=file_hash(paths[name]))
        annotation['sheet'] = sheet
        paths['notice'].parent.mkdir(parents=True, exist_ok=True)
        with paths['notice'].open('x', encoding='utf-8') as output:
            created.append(paths['notice'])
            output.write(metadata['url'] + '\n' + metadata['license'] + '\n\nPublisher text / credits:\n' + credit_text)
        paths['annotations'].parent.mkdir(parents=True, exist_ok=True)
        with paths['annotations'].open('x', encoding='utf-8') as output:
            created.append(paths['annotations'])
            json.dump(annotation, output, indent=2)
            output.write('\n')
        validate_corpus(dict(schemaVersion=1, trainingOnly=True, sheets=[sheet]), root, training_only=True)
    except BaseException:
        for path in reversed(created):
            path.unlink()
        raise
    return sheet


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--sources', type=pathlib.Path, required=True)
    parser.add_argument('--maximum-dimension', type=int, default=2560)
    args = parser.parse_args()
    if args.sources.resolve().is_relative_to(pathlib.Path(__file__).resolve().parents[2]):
        parser.error('Publisher materials belong to external library storage')
    root = args.sources.resolve().parent
    sheets = [prepare_sheet(source, root, args.maximum_dimension) for source in sorted(args.sources.glob('*.pdf'))]
    if not sheets:
        parser.error('Acquired publisher PDFs required')
    manifest = root / 'corpus.training.json'
    value = dict(schemaVersion=1, trainingOnly=True, sheets=sheets)
    if manifest.exists():
        if json.loads(manifest.read_text(encoding='utf-8')) != value:
            raise ValueError('Existing training corpus differs; preserve for inspection')
    else:
        with manifest.open('x', encoding='utf-8') as output:
            json.dump(value, output, indent=2)
            output.write('\n')
    print(json.dumps(dict(manifest=str(manifest), sheets=len(sheets), trainingOnly=True)))
