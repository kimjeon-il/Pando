"""Conservative source-derived supervision for whole published macro maps.

This importer does not supply independently reviewed evaluation truth.
"""
import argparse
import hashlib
import io
import json
import math
import pathlib
import sys
import re

import numpy as np
import pymupdf
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from report_paths import report_argument

from corpus import CHANNELS, validate_corpus


def digest(value):
    return hashlib.sha256(value).hexdigest()


def fill_adjacency_supervision(labels, radius=2):
    if labels.ndim != 2 or labels.dtype != np.uint8 or not 1 <= radius <= 4:
        raise ValueError('Bounded palette labels required')
    neighbors = np.zeros(labels.shape, dtype=np.uint8)
    interior = np.zeros(labels.shape, dtype=bool)
    for value in np.unique(labels):
        if not value:
            continue
        mask = Image.fromarray((labels == value).astype(np.uint8))
        neighbors += np.asarray(mask.filter(ImageFilter.MaxFilter(2 * radius + 1)))
        interior |= np.asarray(mask.filter(ImageFilter.MinFilter(2 * radius + 1))).astype(bool)
    # Only the visible, uncoloured seam between different country fills is a
    # positive. Coast/sea, same-colour gaps and text holes remain unknown.
    positive = (neighbors >= 2) & (labels == 0)
    return positive.astype(np.uint8), (positive | interior).astype(np.uint8)


def stroke_matches(drawing, signature):
    if drawing.get('type') not in {'s', 'fs'} or drawing.get('color') is None:
        return False
    dashes = [float(value) for value in re.findall(r'[-+\d.eE]+', (drawing.get('dashes') or '').split(']')[0])]
    return (len(dashes) == len(signature['dashes'])
            and np.allclose(dashes, signature['dashes'], atol=.001, rtol=0)
            and abs(drawing['width'] - signature['width']) <= .001
            and np.allclose(drawing['color'], signature['color'], atol=.0001, rtol=0))


def stroke_mask(page, drawings, signatures, matrix):
    with pymupdf.open() as output:
        canvas = output.new_page(width=page.rect.width, height=page.rect.height)
        shape, selected = canvas.new_shape(), 0
        for drawing in drawings:
            if not any(stroke_matches(drawing, signature) for signature in signatures):
                continue
            selected += 1
            for item in drawing['items']:
                kind, *points = item
                if kind == 'l':
                    shape.draw_line(*points)
                elif kind == 'c':
                    shape.draw_bezier(*points)
                elif kind == 're':
                    shape.draw_rect(points[0])
                elif kind == 'qu':
                    shape.draw_quad(points[0])
                else:
                    raise ValueError('Unhandled source drawing: ' + kind)
            shape.finish(color=(0, 0, 0), fill=None, dashes=drawing['dashes'],
                         width=drawing['width'], closePath=drawing['closePath'],
                         lineCap=max(drawing['lineCap']), lineJoin=drawing['lineJoin'])
        if not selected:
            raise ValueError('Catalogued macro boundary stroke is absent')
        shape.commit()
        pix = canvas.get_pixmap(matrix=matrix, colorspace=pymupdf.csGRAY)
        return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width) < 247


def derive(source, metadata, maximum_dimension):
    if (metadata.get('geographicScope') not in {'world', 'continent', 'country'}
            or not metadata.get('scopeEvidence') or metadata.get('materialKind') != 'published-macro-pdf'
            or metadata.get('rightsReviewed') is not True or not metadata.get('license')):
        raise ValueError('Verified whole-map macro scope and rights required')
    if not isinstance(maximum_dimension, int) or not 64 <= maximum_dimension <= 4096:
        raise ValueError('Bounded macro render required')
    with pymupdf.open(source) as doc:
        if len(doc) != 1 or doc[0].rotation != 0:
            raise ValueError('Single unrotated macro map required')
        page = doc[0]
        scale = maximum_dimension / max(page.rect.width, page.rect.height)
        matrix = pymupdf.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        image = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).copy()
        masks = np.zeros(image.shape[:2], dtype=np.uint8)
        valid = np.zeros_like(masks)
        specification = metadata['supervision']
        if specification['strategy'] == 'country-fill-adjacency':
            colors = np.asarray(specification['countryFillColors'], dtype=np.float32)
            if colors.ndim != 2 or colors.shape[1] != 3 or not 2 <= len(colors) <= 16 or not np.isfinite(colors).all() or np.any((colors < 0) | (colors > 1)):
                raise ValueError('Explicit source country palette required')
            labels, nearest = np.zeros(masks.shape, dtype=np.uint8), np.full(masks.shape, np.inf)
            rgb = image.astype(np.float32) / 255
            for index, color in enumerate(colors):
                distance = np.max(np.abs(rgb - color), axis=2)
                take = (distance < nearest) & (distance <= 2.5 / 255)
                labels[take] = index + 1
                nearest[take] = distance[take]
            masks, valid = fill_adjacency_supervision(labels, specification['radiusPixels'])
        elif specification['strategy'] == 'boundary-stroke-signatures':
            drawings = page.get_drawings()
            for channel, signatures in specification['channels'].items():
                if channel not in {'international', 'administrative'}:
                    raise ValueError('Only catalogued macro boundary strokes supported')
                pixels = stroke_mask(page, drawings, signatures, matrix)
                # get_drawings ignores some visibility/clipping rules. Admit
                # only marks whose source stroke colour is visible in the map.
                visible = np.zeros(masks.shape, dtype=bool)
                for signature in signatures:
                    visible |= np.max(np.abs(image.astype(np.float32) / 255 - signature['color']), axis=2) <= .15
                masks[pixels & visible] |= 1 << CHANNELS.index(channel)
                valid |= 1 << CHANNELS.index(channel)
            for signature in specification.get('unknownStrokes', []):
                unknown = stroke_mask(page, drawings, [signature], matrix)
                unknown = np.asarray(Image.fromarray(unknown.astype(np.uint8)).filter(ImageFilter.MaxFilter(5))).astype(bool)
                valid[unknown] = 0
        else:
            raise ValueError('Explicit macro supervision strategy required')
        # Publisher glyph boxes are exclusion areas, not invented text truth.
        text = Image.new('L', (pix.width, pix.height))
        draw = ImageDraw.Draw(text)
        for span in page.get_texttrace():
            if span.get('type') == 3 or span.get('opacity', 1) <= 0:
                continue
            for character in span['chars']:
                if chr(character[0]).isspace():
                    continue
                box = [coordinate * scale for coordinate in character[3]]
                if all(math.isfinite(coordinate) for coordinate in box):
                    x0, y0, x1, y1 = box
                    if x1 > x0 and y1 > y0:
                        draw.rectangle((math.floor(x0)-1, math.floor(y0)-1, math.ceil(x1)+1, math.ceil(y1)+1), fill=1)
        obscured = np.asarray(text).astype(bool)
        masks[obscured] = 0
        valid[obscured] = 0
        for region in metadata.get('excludedRegionsNormalized', []):
            if (len(region) != 4 or not all(isinstance(value, (int, float)) and math.isfinite(value) for value in region)
                    or not 0 <= region[0] < region[2] <= 1 or not 0 <= region[1] < region[3] <= 1):
                raise ValueError('Bounded explicit macro exclusion rectangle required')
            x0, y0, x1, y1 = region
            ys = slice(math.floor(y0 * pix.height), math.ceil(y1 * pix.height))
            xs = slice(math.floor(x0 * pix.width), math.ceil(x1 * pix.width))
            masks[ys, xs] = 0
            valid[ys, xs] = 0
        # Opaque raster-only maps cannot silently generate empty supervision.
        if np.count_nonzero(masks) < 20 or np.count_nonzero(valid) < 100:
            raise ValueError('Insufficient actual macro boundary supervision')
        return image, masks, valid, page.get_text()


def image_bytes(array, format):
    buffer = io.BytesIO()
    Image.fromarray(array).save(buffer, format=format, **({'quality': 95} if format == 'JPEG' else {}))
    return buffer.getvalue()


def prepare(source, root, maximum_dimension=2560):
    root, source = pathlib.Path(root).resolve(), pathlib.Path(source).resolve()
    if not source.is_relative_to(root) or source.suffix != '.pdf':
        raise ValueError('Contained macro source PDF required')
    metadata_path = source.with_suffix('.source.json')
    metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
    if metadata['sha256'] != digest(source.read_bytes()) or not re.fullmatch('[a-z0-9-]+', metadata['id']):
        raise ValueError('Pinned source identity required')
    image, masks, valid, credits = derive(source, metadata, maximum_dimension)
    key = metadata['id']
    files = {f'derived/{key}.jpg': image_bytes(image, 'JPEG'), f'derived/{key}.mask.png': image_bytes(masks, 'PNG'),
             f'derived/{key}.valid.png': image_bytes(valid, 'PNG'), f'notices/{key}.txt': (metadata['url']+'\n'+metadata['license']+'\n'+credits).encode()}
    sheet = dict(id=key, familyId=metadata['familyId'], editionId=metadata['editionId'], duplicateGroup=metadata['duplicateGroup'],
                 split='train', image=f'derived/{key}.jpg', sha256=digest(files[f'derived/{key}.jpg']), annotations=f'labels/{key}.json',
                 mapKind=metadata['mapKind'], language=metadata['language'], script=metadata['script'],
                 geographicScope=metadata['geographicScope'], scopeEvidence=metadata['scopeEvidence'],
                 source={name: metadata.get(name) for name in ['url', 'metadataUrl', 'license', 'rightsUrl', 'published']})
    annotation = dict(schemaVersion=1, origin='macro-vector-supervision', reviewed=False, supervisionQuality='source-derived-weak',
                      width=image.shape[1], height=image.shape[0], maximumDimension=maximum_dimension,
                      observedChannels=[name for index, name in enumerate(CHANNELS) if np.any(valid & (1 << index))],
                      sourcePdf=source.relative_to(root).as_posix(), sourceSha256=metadata['sha256'],
                      sourceMetadata=metadata_path.relative_to(root).as_posix(), sourceMetadataSha256=digest(metadata_path.read_bytes()),
                      producer=dict(script='tools/reference-analysis/macro.py', sha256=digest(pathlib.Path(__file__).read_bytes().replace(b'\r\n', b'\n')),
                                    renderer='PyMuPDF', rendererVersion=pymupdf.VersionBind),
                      positivePixels={name: int(np.count_nonzero(masks & (1 << index))) for index, name in enumerate(CHANNELS)})
    for field, suffix in [('raster', '.mask.png'), ('validRaster', '.valid.png')]:
        path = f'derived/{key}{suffix}'
        annotation[field] = dict(path=path, sha256=digest(files[path]))
    files[sheet['annotations']] = (json.dumps(annotation, indent=2)+'\n').encode()
    # Validate all conflicts before writing; do not partially replace evidence.
    for name, value in files.items():
        target = (root / name).resolve()
        if not target.is_relative_to(root) or (target.exists() and target.read_bytes() != value):
            raise ValueError('Existing macro evidence differs: '+name)
    for name, value in files.items():
        target = root / name
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as output:
                output.write(value)
    return sheet


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--sources', type=pathlib.Path, required=True)
    parser.add_argument('--maximum-dimension', type=int, default=2560)
    args = parser.parse_args()
    args.sources = pathlib.Path(report_argument(args.sources, access='write'))
    if args.sources.resolve().is_relative_to(pathlib.Path(__file__).resolve().parents[2]):
        parser.error('Macro materials belong in external library storage')
    root = args.sources.resolve().parent
    sources = [path for path in sorted(args.sources.glob('*.pdf')) if path.with_suffix('.source.json').is_file()]
    sheets = [prepare(path, root, args.maximum_dimension) for path in sources]
    if not sheets:
        parser.error('Verified macro sources required')
    value = dict(schemaVersion=1, trainingOnly=True, sheets=sheets)
    validate_corpus(value, root, training_only=True)
    target = root / 'corpus.training.json'
    payload = (json.dumps(value, indent=2)+'\n').encode()
    if target.exists() and target.read_bytes() != payload:
        raise ValueError('Existing macro corpus differs')
    target.write_bytes(payload)
    print(json.dumps(dict(manifest=str(target), maps=len(sheets), focus='macro-only')))
