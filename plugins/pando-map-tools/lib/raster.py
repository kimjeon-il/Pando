"""Pillow/PyMuPDF adapter; binary stdout is JSON header + newline + RGBA/PNG.

No browser, server, persistent process or new environment. Input coordinates
refer to the EXIF-oriented source page. Cropping/resize metadata is explicit.
"""
import io
import json
import math
import sys
import re
from PIL import Image, ImageOps, ImageDraw


def oriented_map_image(opened):
    """Canonical EXIF orientation and white alpha composite for app and training."""
    oriented = ImageOps.exif_transpose(opened).convert('RGBA')
    return Image.alpha_composite(Image.new('RGBA', oriented.size, (255, 255, 255, 255)), oriented)


def check_source_grid(width, height):
    if width * height > 16_777_216 or max(width, height) > 16_384:
        raise ValueError('Original raster exceeds the current 16MP graph budget; use an explicit analysis derivative and preserve the master')


def geopdf_projection(wkt):
    """Recognized WKT1 projection subset, not a general CRS/datum parser."""
    prime = re.findall(r'PRIMEM\["[^"]+",([\d.eE+-]+)\]', wkt, re.I)
    units = re.findall(r'UNIT\["([^"]+)",([\d.eE+-]+)\]', wkt, re.I)
    if (len(prime) != 1 or float(prime[0]) != 0 or len(units) != 2
            or units[0][0].lower() not in {'degree', 'degrees'}
            or abs(float(units[0][1])-math.pi/180) > 1e-16
            or re.search(r'AXIS\[|TOWGS84\[', wkt, re.I)):
        return None
    method = re.search(r'PROJECTION\["([^"]+)"\]', wkt, re.I)
    spheroid = re.search(r'SPHEROID\["[^"]+",([\d.eE+-]+),([\d.eE+-]+)\]', wkt, re.I)
    if not method or not spheroid or not re.search(r'UNIT\["(?:Meter|Metre)",1(?:\.0*)?\]\]$', wkt, re.I):
        return None
    kinds = {'lambert_conformal_conic': 'lcc', 'mercator': 'merc', 'mercator_1sp': 'merc',
             'azimuthal_equidistant': 'aeqd', 'lambert_azimuthal_equal_area': 'laea',
             'polar_stereographic': 'stere', 'robinson': 'robin', 'equirectangular': 'eqc'}
    kind = kinds.get(method[1].lower())
    if not kind:
        return None
    radius, inverse_flattening = map(float, spheroid.groups())
    if not math.isfinite(radius) or radius <= 0:
        return None
    if inverse_flattening == 0:
        projection = dict(kind=kind, ellipsoid='sphere', radius=radius)
    elif abs(radius-6378137) < .00001 and abs(inverse_flattening-298.257222101) < 1e-8:
        projection = dict(kind=kind, ellipsoid='GRS80')
    elif abs(radius-6378137) < .00001 and abs(inverse_flattening-298.257223563) < 1e-8:
        projection = dict(kind=kind, ellipsoid='WGS84')
    else:
        return None
    if kind in {'eqc', 'aeqd', 'laea', 'robin'} and projection['ellipsoid'] != 'sphere':
        return None
    keys = dict(central_meridian='lon0', latitude_of_origin='lat0', standard_parallel_1='lat1',
                standard_parallel_2='lat2', scale_factor='k0', false_easting='x0', false_northing='y0')
    for key, number in re.findall(r'PARAMETER\["([^"]+)",([\d.eE+-]+)\]', wkt, re.I):
        if key.lower() not in keys or not math.isfinite(float(number)):
            return None
        projection[keys[key.lower()]] = float(number)
    return projection


def geopdf_reference(document, page):
    raw = document.xref_get_key(page.xref, 'VP')[1]
    if raw == 'null':
        return None
    if len(raw) > 1_000_000:
        return dict(diagnostic='geopdf-viewport-exceeds-budget')
    refs = re.findall(r'(\d+)\s+\d+\s+R', raw)
    if refs and '/BBox' not in raw:
        if len(refs) != 1:
            return dict(diagnostic='multiple-geopdf-viewports-need-selection')
        raw = document.xref_object(int(refs[0]), compressed=True)
    if raw.count('/BBox') != 1:
        return dict(diagnostic='multiple-or-unsupported-geopdf-viewports')
    def numbers(key):
        match = re.search(r'/'+key+r'\s*\[([\d.eE+\s-]+)\]', raw)
        return list(map(float, match[1].split())) if match else []
    bounds, geographic, local = numbers('BBox'), numbers('GPTS'), numbers('LPTS')
    wkt = re.search(r'/WKT\s*\((.*?)\)\s*>>', raw)
    projection = geopdf_projection(wkt[1]) if wkt else None
    if not projection or len(bounds) != 4 or len(geographic) != len(local) or len(local) < 6 or len(local) % 2:
        return dict(diagnostic='unsupported-geopdf-crs-or-control-layout')
    if not all(math.isfinite(value) for value in bounds+geographic+local) or bounds[2] <= bounds[0] or bounds[3] <= bounds[1]:
        return dict(diagnostic='invalid-geopdf-control-layout')
    import fitz
    controls = []
    for index in range(0, len(local), 2):
        u, v = local[index:index+2]
        pixel = fitz.Point(bounds[0]+u*(bounds[2]-bounds[0]), bounds[1]+v*(bounds[3]-bounds[1])) * page.transformation_matrix * page.rotation_matrix
        image = [pixel.x/page.rect.width, pixel.y/page.rect.height]
        coordinate = [geographic[index+1], geographic[index]]
        if any(not 0 <= value <= 1 for value in image) or abs(coordinate[0]) > 180 or abs(coordinate[1]) > 90:
            return dict(diagnostic='geopdf-controls-outside-page')
        controls.append(dict(id='geopdf-'+str(index//2), image=image, coordinate=coordinate))
    return dict(projection=projection, controlPoints=controls, wkt=wkt[1], independentChecks=False,
                coordinateEvidence='embedded-publisher-metadata', datumTransformation='not-performed')


def source(spec):
    path = spec['path']
    if path.lower().endswith('.pdf'):
        import fitz
        with fitz.open(path) as document:
            if len(document) > 1 and spec.get('page') is None:
                raise ValueError('Multi-page PDF requires an explicit 1-based page')
            page_number = 1 if spec.get('page') is None else spec['page']
            if not isinstance(page_number, int) or not 1 <= page_number <= len(document):
                raise ValueError('Invalid PDF page')
            page = document[page_number - 1]
            check_source_grid(math.ceil(page.rect.width * 2), math.ceil(page.rect.height * 2))
            # 144 dpi is the documented original raster pixel coordinate plane.
            pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            image = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
            return image, {'page': page_number, 'pdfDpi': 144, 'georeference': geopdf_reference(document, page)}
    with Image.open(path) as opened:
        if opened.format not in ('PNG', 'JPEG', 'WEBP'):
            raise ValueError('Expected PNG, JPEG, WebP or PDF')
        check_source_grid(*opened.size)
        orientation = opened.getexif().get(274, 1)
        raw_size = list(opened.size)
        return oriented_map_image(opened), {'exifOrientation': orientation, 'encodedSize': raw_size}


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
        selected = spec.get('selectedGeometry')
        selected_paths = []
        if selected is None:
            for chain in (job.get('graph') or {}).get('chains', []):
                points = [(x * sx, y * sy) for x, y in chain['points']]
                if len(points) >= 2:
                    bits = chain.get('semanticBits', 0)
                    color = '#a94ddd' if bits & 3 == 3 else '#e85530' if bits & 1 else '#247bed' if bits & 2 else '#00b6bb'
                    drawing.line(points, fill=color, width=2)
        else:
            for geometry in selected:
                if geometry['type'] == 'LineString':
                    selected_paths.append(geometry['coordinates'])
                elif geometry['type'] == 'Polygon':
                    selected_paths.extend(geometry['coordinates'])
                else:
                    raise ValueError('Unsupported selected source-pixel geometry')
            for path in selected_paths:
                drawing.line([(x * sx, y * sy) for x, y in path], fill='#16803c', width=2)

        def on_selection(p):
            if selected is None:
                return True
            for path in selected_paths:
                for a, b in zip(path, path[1:]):
                    dx, dy = b[0]-a[0], b[1]-a[1]
                    squared = dx*dx+dy*dy
                    if squared == 0:
                        continue
                    t = max(0, min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/squared))
                    if math.hypot(p[0]-a[0]-t*dx, p[1]-a[1]-t*dy) <= 2:
                        return True
            return False

        for item in (job.get('graph') or {}).get('unresolved', []):
            point = item.get('point')
            if point and on_selection(point):
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
        banner = ('REVIEWED SELECTION | green: selected geometry / yellow: unresolved | model provisional'
                  if selected is not None else
                  'PROVISIONAL CANDIDATES | orange: border / blue: admin / purple: mixed / yellow: unresolved')
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
