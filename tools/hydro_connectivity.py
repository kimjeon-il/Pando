"""Shared source-proven hydro connectivity audit and build-time repair."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import shapefile

ORDER = ('eu', 'as', 'si', 'af', 'sa', 'na', 'ar', 'au', 'gr')


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


def run_native(payload):
    binary = os.environ.get('PANDO_HYDRO_CONNECTIVITY_BINARY')
    if not binary:
        raise RuntimeError('PANDO_HYDRO_CONNECTIVITY_BINARY is required for Hydro generation')
    completed = subprocess.run([binary], input=json.dumps(payload, ensure_ascii=False, separators=(',', ':')),
                               text=True, encoding='utf-8', stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               check=True, timeout=180)
    return json.loads(completed.stdout)


def audit_parts(parts, raw):
    """Audit through the native connectivity owner without mutating the source."""
    result = run_native({'mode': 'audit', 'parts': {str(source): rows for source, rows in parts.items()},
                         'raw': raw, 'sourceOrder': list(raw)})
    if not isinstance(result, dict) or not isinstance(result.get('regions'), dict) or set(result['regions']) != set(ORDER) or not isinstance(result.get('issues'), list):
        raise ValueError('Invalid native Hydro audit result')
    seen, counts = set(), Counter()
    for issue in result['issues']:
        source = issue.get('source') if isinstance(issue, dict) else None
        if source not in raw or source in seen or issue.get('region') != raw[source]['region'] or issue.get('downstream') != raw[source]['next'] or not isinstance(issue.get('repairable'), bool):
            raise ValueError('Invalid native Hydro audit issue')
        seen.add(source)
        counts[issue['region']] += 1
    for region in ORDER:
        row = result['regions'][region]
        if not isinstance(row, dict) or any(not isinstance(n, int) or isinstance(n, bool) or n < 0 for n in row.values()) or row.get('issues', 0) != counts[region]:
            raise ValueError('Invalid native Hydro audit counts')
    return {'regions': {region: result['regions'][region] for region in ORDER}, 'issues': result['issues']}


def audit(features, raw):
    return audit_parts(parts_by_source(features), raw)


def repair_connections_native(parts, raw, region):
    """Use the C++ junction owner; validate every result before mutating feature coordinates."""
    payload = {'parts': {str(source): rows for source, rows in parts.items()},
               'raw': raw, 'region': region}
    result = run_native(payload)
    if not isinstance(result, dict) or not isinstance(result.get('parts'), dict) or not isinstance(result.get('changes'), list):
        raise ValueError('Invalid native Hydro junction result')
    if set(result['parts']) != set(payload['parts']):
        raise ValueError('Native repair changed source ID membership')
    expected, updates = [], []
    for source, original_rows in payload['parts'].items():
        returned = result['parts'][source]
        if not isinstance(returned, list) or len(returned) != len(original_rows):
            raise ValueError('Native repair changed split reach cardinality')
        for row_index, (old, new) in enumerate(zip(original_rows, returned)):
            if not isinstance(new, dict) or {
                    key: value for key, value in old.items() if key != 'points'} != {
                    key: value for key, value in new.items() if key != 'points'}:
                raise ValueError('Native repair changed feature metadata')
            before, after = old['points'], new.get('points')
            if not isinstance(after, list) or len(before) != len(after) or not before:
                raise ValueError('Native repair changed vertex count')
            for index, (a, b) in enumerate(zip(before, after)):
                if list(a) == b:
                    continue
                if index not in (0, len(before) - 1):
                    raise ValueError('Native repair changed interior vertices')
                endpoint_index = 0 if index == 0 else -1
                expected.append((old['fid'], old['part'], endpoint_index, tuple(a), tuple(b)))
                updates.append((parts[int(source)][row_index]['points'], index, list(b)))
    actual = []
    for change in result['changes']:
        if change.get('region') != region or change.get('index') not in (0, -1):
            raise ValueError('Invalid native repair receipt')
        actual.append((change['fid'], change['part'], change['index'],
                       tuple(change['before']), tuple(change['after'])))
    if Counter(expected) != Counter(actual):
        raise ValueError('Native repair mutations disagree with receipts')
    for points, index, value in updates:
        points[index] = value
    return result['changes']


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
