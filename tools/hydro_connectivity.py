"""Shared source-proven hydro connectivity audit and build-time repair."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import shapefile

ORDER = ('eu', 'as', 'si', 'af', 'sa', 'na', 'ar', 'au', 'gr')


def key(point):
    return (round(point[0] * 1_000_000), round(point[1] * 1_000_000))


def distance(a, b):
    lon = (b[0] - a[0] + 180) % 360 - 180
    return math.hypot(lon * 111195.08 * math.cos(math.radians((a[1] + b[1]) / 2)),
                      (b[1] - a[1]) * 111195.08)


def parts_by_source(features):
    parts = defaultdict(list)
    for feature in features:
        meta = feature['metadata']
        if meta['category'] != 'river':
            continue
        lines = ([feature['geometry']['coordinates']] if feature['geometry']['type'] == 'LineString'
                 else feature['geometry']['coordinates'])
        sources = list(map(int, meta['sourceId'].split(',')))
        if len(sources) != len(lines):
            raise ValueError(f"Ambiguous source/part mapping: {meta['fid']}")
        for index, (source, line) in enumerate(zip(sources, lines)):
            parts[source].append({'fid': meta['fid'], 'part': index, 'points': line,
                                  'aligned': bool(meta['flags'] & 1), 'system': meta['systemId']})
    return parts


def endpoints(parts):
    if len(parts) == 1:
        return parts[0], parts[0]
    starts = Counter(key(p['points'][0]) for p in parts)
    ends = Counter(key(p['points'][-1]) for p in parts)
    first = [p for p in parts if starts[key(p['points'][0])] > ends[key(p['points'][0])]]
    last = [p for p in parts if ends[key(p['points'][-1])] > starts[key(p['points'][-1])]]
    return (first[0], last[0]) if len(first) == len(last) == 1 else (None, None)


def load_sources(baseline, directory, selected):
    cache = directory / 'verified-topology.json'
    specs = baseline['manifest']['sources']['hydroRivers']
    fingerprint = hashlib.sha256(json.dumps(specs, sort_keys=True).encode()).hexdigest()
    if cache.exists():
        saved = json.loads(cache.read_text(encoding='utf8'))
        if saved['fingerprint'] == fingerprint and saved['selected'] == sorted(selected):
            return {int(k): v for k, v in saved['rows'].items()}
    rows = {}
    for code in ORDER:
        spec = next(s for s in specs if s['datasetCode'] == code)
        region = directory / code
        region.mkdir(exist_ok=True)
        with zipfile.ZipFile(directory / f'HydroRIVERS_v10_{code}_shp.zip') as archive:
            for item in spec['files']:
                matches = [name for name in archive.namelist() if Path(name).name == item['file']]
                if len(matches) != 1:
                    raise ValueError(f"Source missing: {item['file']}")
                target = region / Path(item['file']).name
                digest = hashlib.sha256()
                with archive.open(matches[0]) as incoming, target.open('wb') as outgoing:
                    while chunk := incoming.read(1024 * 1024):
                        digest.update(chunk)
                        outgoing.write(chunk)
                if digest.hexdigest() != item['sha256']:
                    raise ValueError(f"Source hash mismatch: {item['file']}")
        with shapefile.Reader(str(region / f'HydroRIVERS_v10_{code}.shp')) as reader:
            for record in reader.iterRecords(fields=['HYRIV_ID', 'NEXT_DOWN']):
                source = int(record['HYRIV_ID'])
                if source not in selected:
                    continue
                shape = reader.shape(record.oid)
                rows[source] = {'region': code, 'next': int(record['NEXT_DOWN']),
                                'start': list(shape.points[0]), 'end': list(shape.points[-1])}
        print(f'{code}: sources verified; {len(rows)} selected reaches read', flush=True)
    if selected - rows.keys():
        raise ValueError(f'{len(selected - rows.keys())} selected source IDs not found')
    cache.write_text(json.dumps({'fingerprint': fingerprint, 'selected': sorted(selected), 'rows': rows}), encoding='utf8')
    return rows


def junction_plans(parts, raw):
    """Choose only topology-proven junctions, preserving aligned anchors."""
    boundaries = {source: endpoints(value) for source, value in parts.items()}
    upstreams = defaultdict(list)
    for source, original in raw.items():
        if original['next'] in parts:
            upstreams[original['next']].append(source)
    plans = {}
    for downstream, sources in upstreams.items():
        start = boundaries[downstream][0]
        tails = [(source, boundaries[source][1]) for source in sorted(sources)]
        if start is None or any(tail is None for _, tail in tails):
            continue
        ports = [(start, 0)] + [(tail, -1) for _, tail in tails]
        if len({part['system'] for part, _ in ports}) != 1:
            continue
        if any(distance(raw[source]['end'], raw[downstream]['start']) > 0.5 for source in sources):
            continue
        anchors = [part['points'][index] for part, index in ports if part['aligned']]
        chosen = anchors[0] if anchors else start['points'][0]
        if any(distance(chosen, point) > 0.5 for point in anchors):
            continue
        if any(distance(chosen, part['points'][index]) > 25000 for part, index in ports):
            continue
        shared = [value / 1_000_000 for value in key(chosen)]
        plans[downstream] = {'ports': ports, 'point': shared, 'sources': sorted(sources)}
    return plans


def audit_parts(parts, raw):
    boundaries = {source: endpoints(value) for source, value in parts.items()}
    plans = junction_plans(parts, raw)
    issues, stats = [], {code: Counter() for code in ORDER}
    for source, original in raw.items():
        counts = stats[original['region']]
        counts['selectedReaches'] += 1
        downstream = original['next']
        if not downstream:
            counts['naturalTerminals'] += 1
            continue
        if downstream not in raw:
            issues.append({'region': original['region'], 'source': source, 'downstream': downstream,
                           'cause': 'missing-downstream', 'repairable': False})
            continue
        counts['expectedConnections'] += 1
        upstream_end = boundaries[source][1]
        downstream_start = boundaries[downstream][0]
        if upstream_end is None or downstream_start is None:
            issues.append({'region': original['region'], 'source': source, 'downstream': downstream,
                           'cause': 'ambiguous-source-parts', 'repairable': False})
            continue
        a, b = upstream_end['points'][-1], downstream_start['points'][0]
        if key(a) == key(b):
            counts['connected'] += 1
            continue
        original_gap = distance(original['end'], raw[downstream]['start'])
        gap = distance(a, b)
        aligned = upstream_end['aligned'] or downstream_start['aligned']
        cause = ('original-mismatch' if original_gap > 0.5 else
                 'border-alignment' if aligned else 'chain-connection')
        repairable = downstream in plans
        issues.append({'region': original['region'], 'source': source, 'downstream': downstream,
                       'cause': cause, 'repairable': repairable, 'gapM': gap, 'originalGapM': original_gap,
                       'originalEnd': original['end'], 'originalDownstreamStart': raw[downstream]['start'],
                       'displayEnd': a, 'displayDownstreamStart': b,
                       'upstream': {k: v for k, v in upstream_end.items() if k != 'points'},
                       'downstreamPart': {k: v for k, v in downstream_start.items() if k != 'points'}})
    for issue in issues:
        stats[issue['region']]['issues'] += 1
        stats[issue['region']]['repairable' if issue['repairable'] else 'unresolved'] += 1
        stats[issue['region']][issue['cause']] += 1
    return {'regions': stats, 'issues': issues}


def audit(features, raw):
    return audit_parts(parts_by_source(features), raw)


def repair_connections(parts, raw, region):
    """Plan before mutating, so converging tributaries share one deterministic point."""
    changes = []
    for downstream, plan in sorted(junction_plans(parts, raw).items()):
        if raw[downstream]['region'] != region:
            continue
        for part, index in plan['ports']:
            if key(part['points'][index]) == key(plan['point']):
                continue
            changes.append({'region': region, 'downstream': downstream, 'sources': plan['sources'],
                            'fid': part['fid'], 'part': part['part'], 'index': index,
                            'before': list(part['points'][index]), 'after': list(plan['point'])})
            part['points'][index] = list(plan['point'])
    return changes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--sources', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    baseline = json.loads(args.baseline.read_text(encoding='utf8'))
    raw = load_sources(baseline, args.sources, set(parts_by_source(baseline['features'])))
    report = audit(baseline['features'], raw)
    report['baselineManifestSha256'] = hashlib.sha256(json.dumps(baseline['manifest'], sort_keys=True).encode()).hexdigest()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps(report['regions'], ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
