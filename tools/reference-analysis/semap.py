"""Bounded real-only Semap auxiliary training import. No synthetic or test images."""
import argparse
import collections
import hashlib
import io
import json
import pathlib
import re
import shutil
import urllib.request
import zipfile
import zlib
import http.client
import time

import numpy as np
from PIL import Image

RECORD = 'https://zenodo.org/api/records/19048095'
# Image rights table supplied by the authors; exclude NC/restricted/unclear rows.
INSTITUTIONS = {'loc', 'bostonleventhal', 'nypl', 'erara', 'princeton', 'unileiden',
                'wwu_munster', 'berkeleylib', 'bordeaux_montaigne', 'emanuscripta', 'illinois', 'uva'}
FILES = {
    'images.zip': (2007189820, '61589127025b48dc1f1338c2b468e8da'),
    'labels.zip': (258666716, '127f8acc34959784976da466bd659493'),
    'partitions.zip': (101670, 'd58bb534f2373726c9f3e21d898d831d'),
    'license_images.md': (5543, '7faf85fac21dc139c150310ac0bdec94'),
    'README.md': (6620, '5338bb3558738de63187ff523a0ddba0'),
}


class RangeArchive(io.RawIOBase):
    def __init__(self, size, fetch):
        self.size, self.fetch, self.position = size, fetch, 0
        self.cached_start, self.cached = 0, b''

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        position = offset if whence == 0 else (self.position if whence == 1 else self.size) + offset
        if position < 0:
            raise ValueError('Negative ZIP range position')
        self.position = position
        return position

    def read(self, size=-1):
        size = min(self.size - self.position, size if size >= 0 else self.size)
        if size <= 0:
            return b''
        if size > 8 * 1024 * 1024:
            raise ValueError('ZIP range exceeds bounded member/index budget')
        if not (self.cached_start <= self.position and self.position + size <= self.cached_start + len(self.cached)):
            end = min(self.size, self.position + max(size, 65536))
            value = self.fetch(self.position, end - 1)
            if len(value) != end - self.position:
                raise ValueError(f'ZIP range length mismatch at {self.position}: expected {end - self.position}, received {len(value)}')
            self.cached_start, self.cached = self.position, value
        offset = self.position - self.cached_start
        value = self.cached[offset:offset + size]
        self.position += size
        return value


def fetch_range(name, total, start, end, opener=urllib.request.urlopen):
    parts = []
    # Several 300KB+ responses yielded short reads. Bound
    # each HTTP transfer as well as the logical ZIP read; never trust EOF as a
    # successful range or a single read() as necessarily delivering the body.
    for part_start in range(start, end + 1, 128 * 1024):
        part_end = min(end, part_start + 128 * 1024 - 1)
        expected = part_end - part_start + 1
        for attempt in range(3):
            request = urllib.request.Request(f'{RECORD}/files/{name}/content',
                                             headers={'Range': f'bytes={part_start}-{part_end}', 'Accept-Encoding': 'identity'})
            with opener(request, timeout=45) as response:
                if response.status != 206 or response.headers.get('Content-Range') != f'bytes {part_start}-{part_end}/{total}':
                    raise ValueError('Server did not honor exact pinned ZIP byte range')
                value = bytearray()
                try:
                    while len(value) <= expected:
                        chunk = response.read(min(65536, expected + 1 - len(value)))
                        if not chunk:
                            break
                        value.extend(chunk)
                except http.client.IncompleteRead as error:
                    value.extend(error.partial)
                if len(value) == expected:
                    parts.append(bytes(value))
                    break
                if len(value) > expected or attempt == 2:
                    raise ValueError(f'{name} HTTP range body mismatch {part_start}-{part_end}: received={len(value)}, expected={expected}')
            time.sleep(.2 * (attempt + 1))
    return b''.join(parts)


def remote_archive(name):
    total = FILES[name][0]
    return zipfile.ZipFile(RangeArchive(total, lambda start, end: fetch_range(name, total, start, end)))


def read_member(archive, member, cached):
    if not cached.is_file():
        return archive.read(member)
    value = cached.read_bytes()
    info = archive.getinfo(member)
    if len(value) != info.file_size or zlib.crc32(value) != info.CRC:
        raise ValueError('Cached original differs from publisher ZIP CRC')
    return value


def member_identity(name):
    match = re.fullmatch(r'images/real/([a-z]+(?:_[a-z]+)*)_([0-9]+)-[0-9]+_[0-9]+_[0-9]+\.jpg', name)
    return (match[1], match[2]) if match else None


def select_real_training_members(names, training):
    selected = []
    for name in sorted(names):
        identity = member_identity(name)
        if not identity or identity[0] not in INSTITUTIONS or pathlib.PurePosixPath(name).stem not in training:
            continue
        # Keep alternates until their actual labels have been inspected.
        selected.append(name)
    return selected


def convert_labels(labels):
    if labels.ndim != 2 or not np.isin(labels, range(6)).all():
        raise ValueError('Unknown Semap semantic class or label dimensions')
    masks = np.zeros_like(labels, dtype=np.uint8)
    masks[labels == 4] = 8
    masks[labels == 5] = 16
    valid = np.zeros_like(masks)
    # Background/contours are ambiguous or unannotated. Only explicit land,
    # water and road pixels supervise these two auxiliary classes.
    valid[np.isin(labels, [2, 3, 4, 5])] = 8 | 16
    return masks, valid


def informative_labels(labels):
    masks, valid = convert_labels(labels)
    return np.count_nonzero(valid) >= labels.size * .03 and np.count_nonzero(masks) >= labels.size * .005


def sha(value):
    return hashlib.sha256(value).hexdigest()


def prepare(root, per_institution=4, manifest_name='corpus.training.json', maximum_maps=96):
    root = pathlib.Path(root).resolve()
    if root.is_relative_to(pathlib.Path(__file__).resolve().parents[2]):
        raise ValueError('Semap materials belong in external library storage')
    if not re.fullmatch(r'[a-z0-9.-]+\.json', manifest_name):
        raise ValueError('Safe Semap manifest filename required')
    root.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(root).free < 256 * 1024 * 1024:
        raise ValueError('Insufficient bounded Semap storage budget')

    def put(relative, value):
        path = (root / relative).resolve()
        if not path.is_relative_to(root):
            raise ValueError('Semap storage path escape')
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            if path.read_bytes() != value:
                raise ValueError('Existing Semap evidence differs; preserve for inspection: ' + relative)
        else:
            with path.open('xb') as output:
                output.write(value)
        return dict(path=relative, sha256=sha(value))

    evidence = []
    payloads = {}
    for name in ['partitions.zip', 'license_images.md', 'README.md']:
        with urllib.request.urlopen(f'{RECORD}/files/{name}/content', timeout=45) as response:
            value = response.read(FILES[name][0] + 1)
        if len(value) != FILES[name][0] or hashlib.md5(value).hexdigest() != FILES[name][1]:
            raise ValueError('Semap pinned small-file identity mismatch')
        payloads[name] = value
        evidence.append(put('sources/' + name, value))
    with zipfile.ZipFile(io.BytesIO(payloads['partitions.zip'])) as partitions:
        paths = [name for name in partitions.namelist() if name.endswith('/train.txt') or name == 'train.txt']
        if len(paths) != 1:
            raise ValueError('Unique author training partition required')
        training = set(partitions.read(paths[0]).decode().split())
    sheets = []
    producer = dict(script='tools/reference-analysis/semap.py', sha256=sha(pathlib.Path(__file__).read_bytes().replace(b'\r\n', b'\n')))
    with remote_archive('images.zip') as images, remote_archive('labels.zip') as labels:
        candidates = collections.defaultdict(list)
        for member in select_real_training_members(images.namelist(), training):
            candidates[member_identity(member)[0]].append(member)
        for rows in candidates.values():
            rows.sort(key=lambda member: sha(('diversity-v2:' + member).encode()))
        ordered = []
        for rank in range(max(map(len, candidates.values()), default=0)):
            ordered.extend(rows[rank] for _, rows in sorted(candidates.items()) if rank < len(rows))
        counts = collections.Counter()
        accepted_originals = set()
        for member in ordered:
            institution, document = member_identity(member)
            if (institution, document) in accepted_originals or counts[institution] >= per_institution or len(sheets) >= maximum_maps:
                continue
            key = pathlib.PurePosixPath(member).stem
            existing_label = root / 'sources' / (key + '.png')
            label_bytes = read_member(labels, 'labels/real/' + key + '.png', existing_label)
            with Image.open(io.BytesIO(label_bytes)) as source:
                labels_array = np.asarray(source)
            if not informative_labels(labels_array):
                continue
            existing_image = root / 'sources' / (key + '.jpg')
            image_bytes = read_member(images, member, existing_image)
            image_spec = put('sources/' + key + '.jpg', image_bytes)
            label_spec = put('sources/' + key + '.png', label_bytes)
            with Image.open(io.BytesIO(image_bytes)) as source:
                image = source.convert('RGB')
            if list(labels_array.shape) != [image.height, image.width] or max(image.size) > 1200:
                raise ValueError('Semap real image/label grid differs or exceeds budget')
            masks, valid = convert_labels(labels_array)
            specs = {}
            for field, array in [('raster', masks), ('validRaster', valid)]:
                buffer = io.BytesIO()
                Image.fromarray(array).save(buffer, format='PNG')
                specs[field] = put(f'derived/{key}.{field}.png', buffer.getvalue())
            # This describes input raster chroma, not an inferred historical
            # printing method, language, author or publication date.
            rgb = np.asarray(image.resize((128, 128)), dtype=np.int16)
            chroma = float(np.mean(rgb.max(2) - rgb.min(2)))
            sheet = dict(id='semap-' + key, familyId='semap-all-production-families-unresolved',
                         editionId='semap-' + institution + '-' + document,
                         duplicateGroup='semap-' + institution + '_' + document, split='train',
                         image=image_spec['path'], sha256=image_spec['sha256'], annotations=f'labels/{key}.json',
                         mapKind='monochrome' if chroma < 8 else 'color', mapKindBasis='input-raster-chroma-heuristic',
                         language='und', script='Unknown', source=dict(url='https://zenodo.org/records/19048095',
                         license='Annotations CC BY 4.0; image institution terms in sources/license_images.md',
                         institution=institution, originalItem=key.rsplit('_', 2)[0], published=None))
            annotation = dict(schemaVersion=1, origin='semap-human-mask-export', reviewed=False,
                              width=image.width, height=image.height, observedChannels=['hydro', 'transport'],
                              producer=producer, sourceFiles=[image_spec, label_spec, *evidence],
                              authorPartition='train', synthetic=False, originalImageMember=member,
                              labelMapping={'4': 'hydro', '5': 'transport'}, ignoredSourceClasses=[0, 1],
                              positivePixels={name: int(np.count_nonzero(masks & (1 << i))) for i, name in enumerate(
                                  ['international', 'administrative', 'coast', 'hydro', 'transport', 'text', 'frame'])},
                              **specs)
            annotation_path = root / sheet['annotations']
            if annotation_path.is_file():
                existing = json.loads(annotation_path.read_text(encoding='utf-8'))
                if {k: v for k, v in existing.items() if k != 'producer'} != {k: v for k, v in annotation.items() if k != 'producer'}:
                    raise ValueError('Existing label derivation differs; preserve for inspection')
            else:
                put(sheet['annotations'], (json.dumps(annotation, indent=2) + '\n').encode())
            sheets.append(sheet)
            accepted_originals.add((institution, document))
            counts[institution] += 1
            print(json.dumps(dict(id=sheet['id'], inputChroma=chroma, source='actual-author-training-image')), flush=True)
    if not sheets:
        raise ValueError('No licensed real training members selected')
    manifest = dict(schemaVersion=1, trainingOnly=True, sheets=sheets)
    put(manifest_name, (json.dumps(manifest, indent=2) + '\n').encode())
    return root / manifest_name


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--per-institution', type=int, default=4)
    parser.add_argument('--manifest-name', default='corpus.training.json')
    parser.add_argument('--maximum-maps', type=int, default=96)
    args = parser.parse_args()
    if not 1 <= args.per_institution <= 16 or not 1 <= args.maximum_maps <= 192:
        parser.error('Per-institution budget must be 1..16 and total 1..192')
    print(prepare(args.output, args.per_institution, args.manifest_name, args.maximum_maps))
