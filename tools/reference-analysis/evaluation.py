"""Original-pixel, full-sheet semantic boundary metrics (no tile double counting)."""
import math
import numpy as np
from PIL import Image, ImageDraw
from corpus import CHANNELS


def dilate_disk(mask, radius):
    result = np.zeros_like(mask)
    height, width = mask.shape
    limit = math.floor(radius)
    for dy in range(-limit, limit + 1):
        for dx in range(-limit, limit + 1):
            if dx * dx + dy * dy > radius * radius:
                continue
            sy, sx = max(0, -dy), max(0, -dx)
            ey, ex = min(height, height - dy), min(width, width - dx)
            result[sy + dy:ey + dy, sx + dx:ex + dx] |= mask[sy:ey, sx:ex]
    return result


def boundary_counts(prediction, annotation):
    width, height = annotation['width'], annotation['height']
    if prediction.shape != (3, height, width):
        raise ValueError('Prediction must use original sheet pixels')
    valid_image = Image.new('L', (width, height), 255)
    for polygon in annotation.get('ignore', []):
        ImageDraw.Draw(valid_image).polygon([tuple(p) for p in polygon], fill=0)
    valid = np.asarray(valid_image) > 0
    counts = np.zeros((3, 4), dtype=np.int64)
    for channel, kind in enumerate(CHANNELS[:3]):
        predicted = prediction[channel] & valid
        truth, tolerance, recalled = [np.zeros_like(valid) for _ in range(3)]
        for line in annotation.get('lines', []):
            if line['kind'] != kind:
                continue
            image = Image.new('L', (width, height))
            ImageDraw.Draw(image).line([tuple(p) for p in line['points']], fill=255, width=1)
            center = (np.asarray(image) > 0) & valid
            radius = max(2., float(line['width']) / 2)
            truth |= center
            tolerance |= dilate_disk(center, radius)
            recalled |= center & dilate_disk(predicted, radius)
        counts[channel] = [(predicted & tolerance).sum(), predicted.sum(), recalled.sum(), truth.sum()]
    return counts


def metrics(counts):
    return {kind: dict(precision=float(row[0] / row[1]) if row[1] else None,
                       recall=float(row[2] / row[3]) if row[3] else None,
                       matchedPrediction=int(row[0]), predicted=int(row[1]),
                       matchedReference=int(row[2]), reference=int(row[3]))
            for kind, row in zip(CHANNELS[:3], counts)}
