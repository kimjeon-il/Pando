#!/usr/bin/env python3
"""Bounded in-memory/temp-copy corruption checks. No network or original writes."""
import argparse,copy,importlib.util,json,subprocess,sys,tempfile
from pathlib import Path
sys.dont_write_bytecode=True

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--package',type=Path,default=Path(__file__).resolve().parent.parent);p.add_argument('--local-geometry',type=Path);a=p.parse_args();root=a.package
    spec=importlib.util.spec_from_file_location('review_validator',root/'review/validate-independent-review.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    report=json.loads(subprocess.run([sys.executable,str(root/'review/validate-independent-review.py'),'--package',str(root)],check=True,capture_output=True,text=True).stdout)
    m.require(report['mode']=='durable_only' and report['omitted_full_river_coordinates_rechecked'] is False and report['independent_binary_decoder_replayed'] is False and report['production_decoder_replayed'] is False and report['local_evidence_assets_rehashed_by_kind']=={} and report['full_original_dbf_rehashed'] is False,'Durable-only scope must be truthful')
    passed=[]
    def reject(label,fn):
        try:fn()
        except (ValueError,KeyError,IndexError):passed.append(label)
        else:raise AssertionError('Accepted corrupted fixture: '+label)
    verdict=m.read_json(root/'review/independent-review.json');m.check_verdict(verdict)
    for label,mutate in [
        ('automatic_application',lambda v:v.update(automatic_application=True)),
        ('korean_invented',lambda v:v['findings'][0].update(name_ko='unsupported')),
        ('whole_river_naming',lambda v:v['findings'][0].update(whole_reach_name_application_cleared=True)),
        ('lake_scalar_clearance',lambda v:v['findings'][1].update(scalar_product_name_approved=True)),
        ('complete_physical_reservoir',lambda v:v['findings'][1].update(complete_physical_reservoir_boundary_verified=True)),
        ('unviewed_map_promoted',lambda v:v['findings'][2].update(authoritative_whole_feature_map_viewed=True)),
        ('new_target_claimed_recovered',lambda v:v['findings'][2].update(historical_verified_ID_recovered=True))]:
        v=copy.deepcopy(verdict);mutate(v);reject(label,lambda x=v:m.check_verdict(x))
    ref=m.read_json(root/'geometry-reference.json')
    with tempfile.TemporaryDirectory() as d:
        d=Path(d);name='kamianske-source-evidence.json';original=root/name;(d/name).write_bytes(original.read_bytes()+b' ')
        pin=next(e for e in m.read_json(root/'review/frozen-input-pins.json')['package_inputs'] if e['file']==name)
        reject('frozen_source_byte_changed',lambda:m.checked(d/name,pin))
        for n in ['selected-lake-geometries.geojson','selected-baseline-lake-geometries.geojson']:(d/n).write_bytes((root/n).read_bytes())
        n='selected-lake-geometries.geojson';src=m.read_json(d/n);src['features'][0]['geometry']['coordinates'][0].reverse();(d/n).write_text(json.dumps(src))
        reject('lake_ring_reversed',lambda:m.validate_lakes(d,ref))
        src=m.read_json(root/n);src['features'][1]['geometry']['coordinates'][0][5][0]+=0.000001;(d/n).write_text(json.dumps(src))
        reject('lake_interior_coordinate_changed',lambda:m.validate_lakes(d,ref))
    if a.local_geometry:
        features=m.read_json(a.local_geometry)['features'];m.validate_features(features,root,ref)
        for label,mutate in [
            ('missing_fragment',lambda f:f.pop(2)),
            ('dropped_river_part',lambda f:f[0]['geometry']['coordinates'].pop()),
            ('river_part_order_reversed',lambda f:f[0]['geometry']['coordinates'].reverse()),
            ('river_interior_coordinate_changed',lambda f:f[0]['geometry']['coordinates'][0][1].__setitem__(0,f[0]['geometry']['coordinates'][0][1][0]+0.000001)),
            ('reach_id_order_changed',lambda f:f[0]['properties'].update(sourceId=','.join(reversed(f[0]['properties']['sourceId'].split(','))))),
            ('river_role_changed',lambda f:f[0]['properties'].update(role='tributary'))]:
            f=copy.deepcopy(features);mutate(f);reject(label,lambda x=f:m.validate_features(x,root,ref))
    print(json.dumps(dict(status='passed',scope_aw_ids=m.AWIDS,durable_only_truthful_reporting=True,corrupt_fixtures_rejected=len(passed),fixtures=passed,local_geometry_fixtures_run=bool(a.local_geometry),network_requests=0,original_inputs_modified=False),indent=2))
if __name__=='__main__':main()
