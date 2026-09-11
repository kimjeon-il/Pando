"""Verify decoded staging output: no unintended edits and no new broken junctions."""
import argparse
import copy
import json
from pathlib import Path
from hydro_connectivity import audit, load_sources, parts_by_source

parser = argparse.ArgumentParser()
parser.add_argument('--baseline', type=Path, required=True)
parser.add_argument('--staged', type=Path, required=True)
parser.add_argument('--sources', type=Path, required=True)
parser.add_argument('--report', type=Path, required=True)
args = parser.parse_args()
baseline = json.loads(args.baseline.read_text(encoding='utf8'))
staged = json.loads(args.staged.read_text(encoding='utf8'))
report = json.loads(args.report.read_text(encoding='utf8'))
expected = copy.deepcopy(baseline['features'])
by_fid = {row['metadata']['fid']: row for row in expected}
for change in report['changes']:
    row = by_fid[change['fid']]
    geometry = row['geometry']
    lines = [geometry['coordinates']] if geometry['type'] == 'LineString' else geometry['coordinates']
    lines[change['part']][change['index']] = change['after']
    terminal = row['metadata'].get('terminal')
    if terminal and change['index'] == -1 and change['part'] == len(lines) - 1:
        terminal['renderEndpoint'] = change['after']
assert len(expected) == len(staged['features'])
for old, new in zip(expected, staged['features']):
    assert old['geometry'] == new['geometry'], f"Unexpected geometry change: {old['metadata']['fid']}"
    assert old.get('widths') == new.get('widths'), f"Width changed: {old['metadata']['fid']}"
    before, after = dict(old['metadata']), dict(new['metadata'])
    if before['fid'] in report['changedFeatureIds']:
        before.pop('bounds'); after.pop('bounds')
    assert before == after, f"Metadata changed: {old['metadata']['fid']}"
raw = load_sources(baseline, args.sources, set(parts_by_source(baseline['features'])))
final = audit(staged['features'], raw)
assert not any(issue['repairable'] for issue in final['issues'])
assert {(x['source'], x['downstream']) for x in final['issues']} == {(x['source'], x['downstream']) for x in report['remaining']}
report['serializedVerification'] = {'features': len(expected), 'unchangedFeatures': report['unchangedFeatureCount'],
                                  'repairableGaps': 0, 'remaining': len(final['issues']), 'regions': final['regions']}
args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print(json.dumps(report['serializedVerification'], indent=2))
