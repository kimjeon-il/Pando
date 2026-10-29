"""Original-pixel, full-sheet semantic boundary metrics (no tile double counting)."""
import math
import numpy as np
from PIL import Image, ImageDraw
from corpus import CHANNELS, review_masks


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
    _, known = review_masks(annotation)
    counts = np.zeros((3, 4), dtype=np.int64)
    for channel, kind in enumerate(CHANNELS[:3]):
        valid = known[channel]
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


def confounder_counts(prediction, annotation):
    width, height = annotation['width'], annotation['height']
    if prediction.shape != (3, height, width):
        raise ValueError('Prediction must use original sheet pixels')
    target, known = review_masks(annotation)
    allowed = np.zeros_like(prediction)
    for line in annotation.get('lines', []):
        if line['kind'] not in CHANNELS[:3]:
            continue
        image = Image.new('L', (width, height))
        ImageDraw.Draw(image).line([tuple(p) for p in line['points']], fill=1, width=1)
        allowed[CHANNELS.index(line['kind'])] |= dilate_disk(np.asarray(image, dtype=bool), max(2., float(line['width'])/2))
    result = {}
    for index, kind in enumerate(CHANNELS[3:], 3):
        rows = {}
        for channel, boundary in enumerate(CHANNELS[:3]):
            valid = target[index] & known[index] & known[channel] & ~allowed[channel]
            false_positive, pixels = int((prediction[channel] & valid).sum()), int(valid.sum())
            rows[boundary] = dict(falsePositive=false_positive, pixels=pixels,
                                  rate=float(false_positive/pixels) if pixels else None)
        result[kind] = rows
    return result


def confounder_nonregression(candidate, baseline):
    failures, measured = [], 0
    if not isinstance(baseline, dict) or set(candidate) != set(baseline):
        return dict(passed=False, measured=0, failures=[dict(reason='missing-or-different-baseline-scope')])
    for sheet, groups in candidate.items():
        if set(groups) != set(baseline[sheet]):
            failures.append(dict(sheet=sheet, reason='confounder-scope-differs'))
            continue
        for kind, channels in groups.items():
            if set(channels) != set(baseline[sheet][kind]):
                failures.append(dict(sheet=sheet, channel=kind, reason='boundary-channel-scope-differs'))
                continue
            for channel, row in channels.items():
                previous = baseline[sheet][kind][channel]
                if row['pixels'] != previous['pixels']:
                    failures.append(dict(sheet=sheet, confounder=kind, channel=channel, reason='known-pixel-scope-differs'))
                elif row['pixels']:
                    measured += 1
                    if row['falsePositive'] > previous['falsePositive']:
                        failures.append(dict(sheet=sheet, confounder=kind, channel=channel, reason='confounder-false-positive-regression'))
    if not measured:
        failures.append(dict(reason='no-known-confounder-evidence'))
    return dict(passed=not failures, measured=measured, failures=failures)


def boundary_admission(per_sheet, *, required_channels=()):
    """Frozen thresholds, equal original-map weight; empty truth never inflates scores."""
    macro, failures = {}, []
    for kind in CHANNELS[:3]:
        rows = []
        for identity, values in per_sheet.items():
            row = values[kind]
            if row['reference']:
                precision, recall = row['precision'] or 0., row['recall'] or 0.
                rows.append((precision, recall))
                if precision < .90 or recall < .75:
                    failures.append(dict(sheet=identity, channel=kind, reason='per-map-floor'))
            elif row['predicted']:
                failures.append(dict(sheet=identity, channel=kind, reason='false-positive-in-known-negative-area'))
        precision = float(np.mean([row[0] for row in rows])) if rows else None
        recall = float(np.mean([row[1] for row in rows])) if rows else None
        macro[kind] = dict(precision=precision, recall=recall, positiveMaps=len(rows))
        if rows and (precision < .95 or recall < .85):
            failures.append(dict(channel=kind, reason='map-macro-threshold'))
        if not rows and kind in required_channels:
            failures.append(dict(channel=kind, reason='missing-independent-positive-truth'))
    if not any(row['positiveMaps'] for row in macro.values()):
        failures.append(dict(reason='no-independent-positive-truth'))
    return dict(passed=not failures, macro=macro, failures=failures, mapCount=len(per_sheet),
                thresholds=dict(macroPrecision=.95, macroRecall=.85, mapPrecision=.90, mapRecall=.75))
