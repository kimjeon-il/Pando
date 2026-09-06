"""Replay frozen production features through the canonical encoder after junction repair.

No river selection, naming, lake/coast policy, feature order or source geometry
is regenerated. The same connector is used by fresh build-hydro-tiles runs.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

from hydro_connectivity import ORDER, audit, load_sources, parts_by_source, repair_connections

spec = importlib.util.spec_from_file_location('hydro_builder', Path(__file__).with_name('build-hydro-tiles.py'))
builder = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = builder
spec.loader.exec_module(builder)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--baseline', type=Path, required=True)
    parser.add_argument('--sources', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    # PackBuilder.write removes its output: only a NEW external staging path is allowed.
    output = args.output.resolve()
    if output.exists() or output == root or root in output.parents:
        raise ValueError('Output must be a new staging directory outside the repository')
    baseline = json.loads(args.baseline.read_text(encoding='utf8'))
    features = baseline['features']
    original_fingerprints = {r['metadata']['fid']: fingerprint(r) for r in features}
    parts = parts_by_source(features)
    raw = load_sources(baseline, args.sources, set(parts))
    before = audit(features, raw)
    changes, region_results = [], {}
    expected = {(x['source'], x['downstream']) for x in before['issues']}
    for region in ORDER:
        region_changes = repair_connections(parts, raw, region)
        changes.extend(region_changes)
        after = audit(features, raw)
        if {(x['source'], x['downstream']) for x in after['issues']} - expected:
            raise ValueError(f'New broken connection after {region}')
        region_results[region] = after['regions'][region]
        if region_results[region].get('repairable', 0):
            raise ValueError(f'Repairable gaps remain after {region}')
        print(f'{region}: {len(region_changes)} ports changed; {region_results[region].get("issues", 0)} unresolved', flush=True)
    if any(repair_connections(parts, raw, region) for region in ORDER):
        raise ValueError('Repair is not idempotent')
    changed_fids = {change['fid'] for change in changes}
    by_fid = {row['metadata']['fid']: row for row in features}
    for change in changes:
        row = by_fid[change['fid']]
        lines = ([row['geometry']['coordinates']] if row['geometry']['type'] == 'LineString' else row['geometry']['coordinates'])
        terminal = row['metadata'].get('terminal')
        if terminal and change['part'] == len(lines) - 1 and change['index'] == -1:
            terminal['renderEndpoint'] = list(change['after'])
    pack_builder = builder.PackBuilder(output)
    for row in features:
        meta, geometry = row['metadata'], row['geometry']
        fid = meta['fid']
        if fid not in changed_fids and fingerprint(row) != original_fingerprints[fid]:
            raise ValueError(f'Unrelated feature changed: {fid}')
        bounds = (builder.geometry_bounds(geometry) if fid in changed_fids else tuple(v / 1e6 for v in meta['bounds']))
        pack_builder.add(builder.BuiltFeature(
            fid=fid, logical_fid=meta['logicalFid'], pandolab_id=meta['awId'],
            layer_id=meta['layerId'], category=meta['category'], stage=meta['stage'], name=meta['name'],
            source_id=meta.get('sourceId', ''), source=meta.get('source', ''), width=meta['width'],
            geometry=geometry, bounds=bounds, width_profile=row.get('widths'),
            fragment_index=meta['fragmentIndex'], fragment_count=meta['fragmentCount'], flags=meta['flags'],
            terminal=meta.get('terminal'), system_id=meta.get('systemId', ''),
            mainstem_name_ko=meta.get('mainstemNameKo', ''), role=meta.get('role', ''),
            aliases=meta.get('aliases'), tributary_names=meta.get('tributaryNames'), osm_relation_ids=meta.get('osmRelationIds'),
        ))
    stats = pack_builder.write()
    layout = stats.pop('_layout')
    manifest = copy.deepcopy(baseline['manifest'])
    for field in ('index', 'metadata', 'shards'):
        manifest[field] = layout[field]
    manifest['stats'].update(stats)
    manifest['cache']['name'] = f"pandolab-water-v{manifest['version']}-{layout['index']['sha256'][:12]}"
    manifest['connectivity'] = {'revision': 1, 'repairedConnections': len(before['issues']) - len(after['issues']),
                                'unresolvedConnections': len(after['issues'])}
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    report = {'baselineRegions': before['regions'], 'regions': region_results, 'changes': changes,
              'remaining': after['issues'], 'changedFeatureIds': sorted(changed_fids),
              'unchangedFeatureCount': len(features) - len(changed_fids),
              'baselineManifestFingerprint': fingerprint(baseline['manifest'])}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(f'Staged {len(changed_fids)} changed / {len(features)} features at {output}', flush=True)


if __name__ == '__main__':
    main()
