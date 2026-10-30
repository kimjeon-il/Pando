"""Shared source-proven hydro connectivity audit and build-time repair."""
from __future__ import annotations

import json
import os
import subprocess
from collections import Counter

ORDER = ('eu', 'as', 'si', 'af', 'sa', 'na', 'ar', 'au', 'gr')


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
