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

import numpy as np
from PIL import Image

RECORD = 'https://zenodo.org/api/records/19048095'
# Image rights table supplied by the authors; exclude NC/restricted/unclear rows.
INSTITUTIONS = {'loc', 'bostonleventhal', 'nypl', 'erara', 'princeton', 'unileiden', 'wwu'}
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
        value = self.fetch(self.position, self.position + size - 1)
        if len(value) != size:
            raise ValueError('ZIP range length mismatch')
        self.position += size
        return value


def remote_archive(name):
    total = FILES[name][0]
    def fetch(start, end):
        request = urllib.request.Request(f'{RECORD}/files/{name}/content', headers={'Range': f'bytes={start}-{end}'})
        with urllib.request.urlopen(request, timeout=45) as response:
            if response.status != 206 or response.headers.get('Content-Range') != f'bytes {start}-{end}/{total}':
                raise ValueError('Server did not honor exact pinned ZIP byte range')
            return response.read(end - start + 2)
    return zipfile.ZipFile(RangeArchive(total, fetch))


def select_real_training_members(names, training, per_institution=4):
    groups = collections.defaultdict(dict)
    for name in sorted(names):
        match = re.fullmatch(r'images/real/([a-z]+)_([0-9]+)-[0-9]+_[0-9]+_[0-9]+\.jpg', name)
        if not match or match[1] not in INSTITUTIONS or pathlib.PurePosixPath(name).stem not in training:
            continue
        # Pages and tiles from one source item count once, not as diversity.
        groups[match[1]].setdefault(match[2], name)
    selected = []
    for institution in sorted(groups):
        rows = list(groups[institution].values())
        indices = np.linspace(0, len(rows) - 1, min(per_institution, len(rows)), dtype=int)
        selected.extend(rows[i] for i in indices)
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


def sha(value):
    return hashlib.sha256(value).hexdigest()


def prepare(root, per_institution=4):
    root = pathlib.Path(root).resolve()
    if root.is_relative_to(pathlib.Path(__file__).resolve().parents[2]):
        raise ValueError('Semap materials belong in external library storage')
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
        selected = select_real_training_members(images.namelist(), training, per_institution)
        for member in selected:
            key = pathlib.PurePosixPath(member).stem
            image_bytes, label_bytes = images.read(member), labels.read('labels/real/' + key + '.png')
            image_spec = put('sources/' + key + '.jpg', image_bytes)
            label_spec = put('sources/' + key + '.png', label_bytes)
            with Image.open(io.BytesIO(image_bytes)) as source:
                image = source.convert('RGB')
            with Image.open(io.BytesIO(label_bytes)) as source:
                labels_array = np.asarray(source)
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
                         editionId='semap-' + key.split('_')[0] + '-' + key.split('_')[1].split('-')[0],
                         duplicateGroup='semap-' + key.rsplit('_', 2)[0].split('-')[0], split='train',
                         image=image_spec['path'], sha256=image_spec['sha256'], annotations=f'labels/{key}.json',
                         mapKind='monochrome' if chroma < 8 else 'color', mapKindBasis='input-raster-chroma-heuristic',
                         language='und', script='Unknown', source=dict(url='https://zenodo.org/records/19048095',
                         license='Annotations CC BY 4.0; image institution terms in sources/license_images.md',
                         institution=key.split('_')[0], originalItem=key.rsplit('_', 2)[0], published=None))
            annotation = dict(schemaVersion=1, origin='semap-human-mask-export', reviewed=False,
                              width=image.width, height=image.height, observedChannels=['hydro', 'transport'],
                              producer=producer, sourceFiles=[image_spec, label_spec, *evidence],
                              authorPartition='train', synthetic=False, originalImageMember=member,
                              labelMapping={'4': 'hydro', '5': 'transport'}, ignoredSourceClasses=[0, 1],
                              positivePixels={name: int(np.count_nonzero(masks & (1 << i))) for i, name in enumerate(
                                  ['international', 'administrative', 'coast', 'hydro', 'transport', 'text', 'frame'])},
                              **specs)
            put(sheet['annotations'], (json.dumps(annotation, indent=2) + '\n').encode())
            sheets.append(sheet)
            print(json.dumps(dict(id=sheet['id'], inputChroma=chroma, source='actual-author-training-image')), flush=True)
    if not sheets:
        raise ValueError('No licensed real training members selected')
    manifest = dict(schemaVersion=1, trainingOnly=True, sheets=sheets)
    put('corpus.training.json', (json.dumps(manifest, indent=2) + '\n').encode())
    return root / 'corpus.training.json'


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--per-institution', type=int, default=4)
    args = parser.parse_args()
    if not 1 <= args.per_institution <= 8:
        parser.error('Per-institution budget must be 1..8')
    print(prepare(args.output, args.per_institution))
