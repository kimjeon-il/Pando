#!/usr/bin/env python3
"""Offline corruption checks using disposable copies; original files are untouched."""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--package', type=Path, default=Path(__file__).resolve().parent.parent)
    p.add_argument('--input-cache', type=Path, required=True)
    p.add_argument('--historical-input-root', type=Path, required=True)
    p.add_argument('--local-source-index', type=Path, required=True)
    args = p.parse_args()
    outcomes = []
    for case in ['frozen_source_coordinate_changed', 'raw_original_source_changed', 'korean_name_fabricated', 'reservoir_water_mask_hold_removed', 'tathlina_lead_substituted']:
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            package = d / 'package'
            shutil.copytree(args.package, package)
            index = json.loads(args.local_source_index.read_bytes())
            if case == 'frozen_source_coordinate_changed':
                file = package / 'selected-lake-geometries.geojson'
                v = json.loads(file.read_bytes())
                v['features'][0]['geometry']['coordinates'][0][1][0] += 0.001
                file.write_text(json.dumps(v))
            elif case == 'raw_original_source_changed':
                key = next(iter(index))
                modified = d / 'modified-original'
                modified.write_bytes(Path(index[key]['local_path']).read_bytes() + b' ')
                index[key]['local_path'] = str(modified)
            else:
                file = package / 'review/independent-review.json'
                v = json.loads(file.read_bytes())
                if case == 'korean_name_fabricated':
                    v['findings'][0]['name_ko'] = 'unsupported example'
                elif case == 'reservoir_water_mask_hold_removed':
                    v['findings'][1]['precise_water_mask_verdict'] = 'approved'
                else:
                    v['findings'][2]['identity'] = 'Tathlina Lake'
                file.write_text(json.dumps(v))
            local_index = d / 'source-index.json'
            local_index.write_text(json.dumps(index))
            cmd = [sys.executable, str(package / 'review/validate-independent-review.py'), '--package', str(package), '--input-cache', str(args.input_cache.resolve()), '--historical-input-root', str(args.historical_input_root.resolve()), '--local-source-index', str(local_index)]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                raise RuntimeError('Corrupt fixture accepted: ' + case)
            outcomes.append({'case': case, 'rejected': True, 'exit_code': result.returncode})
    print(json.dumps({'status':'passed','fixture_count':len(outcomes),'fixtures':outcomes,'original_inputs_modified':False,'network_requests':0},indent=2))


if __name__ == '__main__':
    main()
