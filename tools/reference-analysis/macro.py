"""Conservative source-derived supervision for whole published macro maps.

This importer does not supply independently reviewed evaluation truth.
"""
import argparse
import hashlib
import io
import json
import math
import pathlib
import subprocess
import sys
import re
import struct

import numpy as np
import pymupdf
from PIL import Image, ImageDraw

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from report_paths import report_argument

from corpus import CHANNELS, validate_corpus


def digest(value):
    return hashlib.sha256(value).hexdigest()


def fill_adjacency_supervision(labels, radius=2):
    if labels.ndim != 2 or labels.dtype != np.uint8 or not 1 <= radius <= 4:
        raise ValueError('Bounded palette labels required')
    output = native_macro_mask('adjacency', labels, radius)
    pixels = labels.size
    return (np.frombuffer(output, dtype=np.uint8, count=pixels).copy().reshape(labels.shape),
            np.frombuffer(output, dtype=np.uint8, count=pixels, offset=pixels).copy().reshape(labels.shape))


def native_macro_mask(action, image, radius):
    if image.ndim != 2 or image.dtype != np.uint8 or type(radius) is not int:
        raise ValueError('Two-dimensional uint8 macro mask and integer radius required')
    height, width = image.shape
    script = pathlib.Path(__file__).with_name('macro-masks.mjs')
    result = subprocess.run(['node', str(script), action, str(width), str(height), str(radius)],
                            input=image.tobytes(), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError('Native macro mask failed: ' + result.stderr.decode('utf-8', errors='replace'))
    if len(result.stdout) != width * height * (2 if action == 'adjacency' else 1):
        raise ValueError('Invalid native macro mask length')
    return result.stdout


def dilate_macro_mask(mask, radius):
    image = np.asarray(mask, dtype=np.uint8)
    return np.frombuffer(native_macro_mask('dilate', image, radius), dtype=np.uint8).copy().reshape(image.shape).astype(bool)


def native_macro_colors(action, image, colors):
    if image.ndim != 3 or image.shape[2] != 3 or image.dtype != np.uint8:
        raise ValueError('RGB uint8 macro image required')
    palette = np.asarray(colors, dtype=np.float64)
    if (palette.ndim != 2 or palette.shape[1] != 3 or not np.isfinite(palette).all()
            or np.any((palette < 0) | (palette > 1)) or not 1 <= len(palette) <= 1024):
        raise ValueError('Explicit source color palette required')
    height, width = image.shape[:2]
    script = pathlib.Path(__file__).with_name('macro-masks.mjs')
    payload = struct.pack('<' + 'd' * palette.size, *palette.flat) + image.tobytes()
    result = subprocess.run(['node', str(script), action, str(width), str(height), str(len(palette))],
                            input=payload, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise ValueError('Native macro color classification failed: ' + result.stderr.decode('utf-8', errors='replace'))
    if len(result.stdout) != width * height:
        raise ValueError('Invalid native macro color length')
    return np.frombuffer(result.stdout, dtype=np.uint8).copy().reshape(height, width)


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
        if len(doc) != 1:
            raise ValueError('Single-page macro map required')
        page = doc[0]
        # Paths and glyph boxes use unrotated PDF coordinates. Rasterize all
        # three planes there, then rotate them together without interpolation.
        rotation = page.rotation
        page.set_rotation(0)
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
            labels = native_macro_colors('palette', image, colors)
            masks, valid = fill_adjacency_supervision(labels, specification['radiusPixels'])
        elif specification['strategy'] == 'boundary-stroke-signatures':
            drawings = page.get_drawings()
            band = specification.get('knownBandRadiusPixels')
            if band is not None and (type(band) is not int or not 1 <= band <= 32):
                raise ValueError('Bounded known supervision band required')
            for channel, signatures in specification['channels'].items():
                if channel not in {'international', 'administrative'}:
                    raise ValueError('Only catalogued macro boundary strokes supported')
                pixels = stroke_mask(page, drawings, signatures, matrix)
                # get_drawings ignores some visibility/clipping rules. Admit
                # only marks whose source stroke colour is visible in the map.
                visible = native_macro_colors('visible', image, [signature['color'] for signature in signatures]).astype(bool)
                masks[pixels & visible] |= 1 << CHANNELS.index(channel)
                known = np.ones(masks.shape, dtype=bool) if band is None else dilate_macro_mask((pixels & visible).astype(np.uint8), band)
                valid[known] |= 1 << CHANNELS.index(channel)
            for signature in specification.get('unknownStrokes', []):
                unknown = stroke_mask(page, drawings, [signature], matrix)
                unknown = dilate_macro_mask(unknown.astype(np.uint8), 2)
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
        if rotation:
            image, masks, valid = (np.rot90(value, -rotation // 90).copy()
                                   for value in (image, masks, valid))
        height, width = masks.shape
        for region in metadata.get('excludedRegionsNormalized', []):
            if (len(region) != 4 or not all(isinstance(value, (int, float)) and math.isfinite(value) for value in region)
                    or not 0 <= region[0] < region[2] <= 1 or not 0 <= region[1] < region[3] <= 1):
                raise ValueError('Bounded explicit macro exclusion rectangle required')
            x0, y0, x1, y1 = region
            ys = slice(math.floor(y0 * height), math.ceil(y1 * height))
            xs = slice(math.floor(x0 * width), math.ceil(x1 * width))
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


def prepare(source, root, maximum_dimension=2560, metadata_path=None):
    root, source = pathlib.Path(root).resolve(), pathlib.Path(source).resolve()
    if not source.is_relative_to(root) or source.suffix != '.pdf':
        raise ValueError('Contained macro source PDF required')
    original_metadata_path = source.with_suffix('.source.json')
    metadata_path = pathlib.Path(metadata_path or original_metadata_path).resolve()
    if not metadata_path.is_relative_to(root):
        raise ValueError('Contained source metadata required')
    metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
    original = json.loads(original_metadata_path.read_text(encoding='utf-8'))
    if metadata_path != original_metadata_path:
        # Exclusions are supervision too. A revised edition keeps its own id
        # and masks while reusing immutable source bytes and original grouping.
        immutable = lambda value: {key: item for key, item in value.items() if key not in {'id', 'supervision', 'excludedRegionsNormalized'}}
        if immutable(metadata) != immutable(original) or metadata['id'] == original['id']:
            raise ValueError('Alternate supervision must preserve original identity with a distinct id')
    if metadata['sha256'] != digest(source.read_bytes()) or not re.fullmatch('[a-z0-9-]+', metadata['id']):
        raise ValueError('Pinned source identity required')
    image, masks, valid, credits = derive(source, metadata, maximum_dimension)
    key = metadata['id']
    image_key = original['id']
    if not re.fullmatch('[a-z0-9-]+', image_key):
        raise ValueError('Pinned source identity required')
    files = {f'derived/{image_key}.jpg': image_bytes(image, 'JPEG'), f'derived/{key}.mask.png': image_bytes(masks, 'PNG'),
             f'derived/{key}.valid.png': image_bytes(valid, 'PNG'), f'notices/{image_key}.txt': (metadata['url']+'\n'+metadata['license']+'\n'+credits).encode()}
    sheet = dict(id=key, familyId=metadata['familyId'], editionId=metadata['editionId'], duplicateGroup=metadata['duplicateGroup'],
                 split='train', image=f'derived/{image_key}.jpg', sha256=digest(files[f'derived/{image_key}.jpg']), annotations=f'labels/{key}.json',
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
    existing = root / sheet['annotations']
    if existing.exists():
        # The recorded generator is immutable provenance, not a requirement to
        # regenerate unchanged evidence whenever manifest/selection code changes.
        previous = json.loads(existing.read_text(encoding='utf-8'))
        generator_hash = previous.get('producer', {}).get('sha256', '')
        if not re.fullmatch('[a-f0-9]{64}', generator_hash):
            raise ValueError('Existing macro evidence differs: invalid producer')
        annotation['producer']['sha256'] = generator_hash
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


def prepare_corpus(sources, maximum_dimension=2560, manifest_name='corpus.training.json', *, metadata_directory=None):
    if (not isinstance(manifest_name, str) or '..' in manifest_name
            or not re.fullmatch('[a-z0-9][a-z0-9.-]*\\.json', manifest_name)):
        raise ValueError('Safe single macro manifest filename required')
    sources = pathlib.Path(sources).resolve()
    if sources.is_relative_to(pathlib.Path(__file__).resolve().parents[2]):
        raise ValueError('Macro materials belong in external library storage')
    root = sources.parent
    target = root / manifest_name
    if target.is_symlink() or target.resolve().parent != root:
        raise ValueError('Safe single macro manifest filename required')
    originals = [path for path in sorted(sources.glob('*.pdf')) if path.with_suffix('.source.json').is_file()]
    alternate = {}
    if metadata_directory is not None:
        directory = pathlib.Path(metadata_directory).resolve()
        if not directory.is_relative_to(root) or directory == sources or not directory.is_dir():
            raise ValueError('Contained metadata directory distinct from original sources required')
        alternate = {path.name: path for path in directory.glob('*.source.json')}
        if not alternate or set(alternate) - {path.with_suffix('.source.json').name for path in originals}:
            raise ValueError('Unmatched or empty alternate source metadata')
    sheets = [prepare(path, root, maximum_dimension, alternate.get(path.with_suffix('.source.json').name)) for path in originals]
    if not sheets:
        raise ValueError('Verified macro sources required')
    value = dict(schemaVersion=1, trainingOnly=True, sheets=sheets)
    validate_corpus(value, root, training_only=True)
    if target.exists():
        recorded = json.loads(target.read_text(encoding='utf-8'))
        # Order and serialized bytes participate in the training fingerprint.
        # Reuse an identical inventory in its recorded order without rewriting.
        order = [row['id'] for row in recorded['sheets']]
        by_id = {row['id']: row for row in sheets}
        if len(order) == len(sheets) and set(order) == set(by_id):
            value['sheets'] = [by_id[key] for key in order]
        if recorded != value:
            raise ValueError('Existing macro corpus differs')
    else:
        with target.open('xb') as output:
            output.write((json.dumps(value, indent=2)+'\n').encode())
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--sources', type=pathlib.Path, required=True)
    parser.add_argument('--maximum-dimension', type=int, default=2560)
    parser.add_argument('--manifest-name', default='corpus.training.json')
    parser.add_argument('--metadata-directory', type=pathlib.Path, help='Contained alternate supervision metadata; originals are preserved')
    args = parser.parse_args()
    args.sources = report_argument(args.sources, access='write')
    target = prepare_corpus(args.sources, args.maximum_dimension, args.manifest_name, metadata_directory=args.metadata_directory)
    value = json.loads(target.read_text(encoding='utf-8'))
    print(json.dumps(dict(manifest=str(target), maps=len(value['sheets']), focus='macro-only')))
