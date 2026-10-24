"""Pillow/PyMuPDF adapter; binary stdout is JSON header + newline + RGBA/PNG.

No browser, server, persistent process or new environment. Input coordinates
refer to the EXIF-oriented source page. Cropping/resize metadata is explicit.
"""
import io
import json
import math
import sys
from PIL import Image, ImageOps, ImageDraw


def check_source_grid(width, height):
    if width * height > 16_777_216 or max(width, height) > 16_384:
        raise ValueError('Original raster exceeds the current 16MP graph budget; use an explicit analysis derivative and preserve the master')


def source(spec):
    path = spec['path']
    if path.lower().endswith('.pdf'):
        import fitz
        with fitz.open(path) as document:
            if len(document) > 1 and spec.get('page') is None:
                raise ValueError('Multi-page PDF requires an explicit 1-based page')
            page_number = spec.get('page', 1)
            if not isinstance(page_number, int) or not 1 <= page_number <= len(document):
                raise ValueError('Invalid PDF page')
            page = document[page_number - 1]
            check_source_grid(math.ceil(page.rect.width * 2), math.ceil(page.rect.height * 2))
            # 144 dpi is the documented original raster pixel coordinate plane.
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            image = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
            return image, {'page': page_number, 'pdfDpi': 144}
    with Image.open(path) as opened:
        if opened.format not in ('PNG', 'JPEG', 'WEBP'):
            raise ValueError('Expected PNG, JPEG, WebP or PDF')
        check_source_grid(*opened.size)
        orientation = opened.getexif().get(274, 1)
        raw_size = list(opened.size)
        oriented = ImageOps.exif_transpose(opened).convert('RGBA')
        white = Image.new('RGBA', oriented.size, (255, 255, 255, 255))
        return Image.alpha_composite(white, oriented), {'exifOrientation': orientation, 'encodedSize': raw_size}


def run(spec):
    action = spec['action']
    if action in ('encode', 'resize', 'rotate'):
        image = Image.frombytes('RGBA', (spec['width'], spec['height']), sys.stdin.buffer.read())
        if action in ('resize', 'rotate'):
            if action == 'rotate':
                if spec['degrees'] not in (0, 90, 180, 270):
                    raise ValueError('Invalid clockwise rotation')
                image = image.rotate(-spec['degrees'], expand=True)
            else:
                image = image.resize(tuple(spec['size']), Image.Resampling.LANCZOS)
            return {'width': image.width, 'height': image.height}, image.tobytes()
    else:
        image, metadata = source(spec)
        width, height = image.size
        rect = spec.get('rect') or {'x': 0, 'y': 0, 'width': width, 'height': height}
        if any(not isinstance(rect[k], int) for k in ('x', 'y', 'width', 'height')) or rect['x'] < 0 or rect['y'] < 0 or rect['width'] < 2 or rect['height'] < 2 or rect['x'] + rect['width'] > width or rect['y'] + rect['height'] > height:
            raise ValueError('Source rectangle exceeds original pixel bounds')
        if action == 'read':
            image = image.crop((rect['x'], rect['y'], rect['x'] + rect['width'], rect['y'] + rect['height']))
            maximum = spec.get('maxPixels', 4_000_000)
            if not isinstance(maximum, int) or not 256 <= maximum <= 16_777_216:
                raise ValueError('Pixel budget must be 256..16777216')
            scale = min(1, math.sqrt(maximum / (image.width * image.height)))
            image = image.resize((max(2, int(image.width * scale)), max(2, int(image.height * scale))), Image.Resampling.LANCZOS)
            return {'width': image.width, 'height': image.height, 'originalWidth': width, 'originalHeight': height,
                    'mapping': {**metadata, 'rect': rect, 'analysisSize': list(image.size), 'coordinateSpace': 'exif-oriented-original-pixels'}}, image.convert('RGBA').tobytes()
        if action != 'preview':
            raise ValueError('Unknown raster operation')
        job = spec['job']
        image.thumbnail((2200, 2200), Image.Resampling.LANCZOS)
        sx, sy = image.width / width, image.height / height
        drawing = ImageDraw.Draw(image)
        for chain in (job.get('graph') or {}).get('chains', []):
            points = [(x * sx, y * sy) for x, y in chain['points']]
            if len(points) >= 2:
                bits = chain.get('semanticBits', 0)
                color = '#a94ddd' if bits & 3 == 3 else '#e85530' if bits & 1 else '#247bed' if bits & 2 else '#00b6bb'
                drawing.line(points, fill=color, width=2)
        for item in (job.get('graph') or {}).get('unresolved', []):
            point = item.get('point')
            if point:
                x, y = point[0] * sx, point[1] * sy
                drawing.ellipse((x-5, y-5, x+5, y+5), outline='#ffba00', width=2)
        residuals = {row['id']: row['meters'] for row in (job.get('warp') or {}).get('diagnostics', {}).get('residuals', [])}
        for index, point in enumerate((job.get('warp') or {}).get('controlPoints', []), 1):
            x, y = point['image'][0] * (width-1) * sx, point['image'][1] * (height-1) * sy
            drawing.ellipse((x-5, y-5, x+5, y+5), outline='#00aaff', width=2)
            label = str(index)
            if point['id'] in residuals:
                label += ': %.0fm' % residuals[point['id']]
            drawing.text((x+6, y-5), label, fill='#0066aa', stroke_width=1, stroke_fill='white')
        region = job['source'].get('mapping', {}).get('rect')
        if region:
            drawing.rectangle((region['x']*sx, region['y']*sy, (region['x']+region['width']-1)*sx, (region['y']+region['height']-1)*sy), outline='#00aaff', width=2)
        quality = job.get('quality') or {}
        banner = 'PROVISIONAL | orange: border / blue: admin / purple: mixed / yellow: unresolved'
        banner += ' | georeference: ' + ('recommended' if quality.get('recommended') else 'needs review')
        drawing.rectangle((0, 0, image.width, 24), fill='white')
        drawing.text((5, 5), banner, fill='black')
    output = io.BytesIO()
    image.save(output, format='PNG')
    return {'width': image.width, 'height': image.height}, output.getvalue()


if __name__ == '__main__':
    specification = json.loads(sys.stdin.buffer.readline())
    header, binary = run(specification)
    sys.stdout.buffer.write(json.dumps(header).encode('utf8') + b'\n' + binary)
