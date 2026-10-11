#!/usr/bin/env python3
"""Bounded corruption fixtures; fixtures never modify retained inputs."""
import argparse,copy,importlib.util,json,subprocess,sys,tempfile,shutil
from pathlib import Path
sys.dont_write_bytecode=True

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--package',type=Path,default=Path(__file__).resolve().parent.parent);p.add_argument('--local-source-index',type=Path);p.add_argument('--local-source-root',type=Path);a=p.parse_args();root=a.package
    spec=importlib.util.spec_from_file_location('review_validator',root/'review/validate-independent-review.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    report=json.loads(subprocess.run([sys.executable,str(root/'review/validate-independent-review.py'),'--package',str(root)],check=True,capture_output=True,text=True).stdout)
    m.require(report['mode']=='durable_only' and all(report[k] is False for k in ['independent_binary_decoder_replayed','original_inventory_rechecked','original_prior_index_rechecked','visual_inspection_repeated']) and report['local_evidence_assets_rehashed']==0 and report['geometry_component']['production_decoder_replayed'] is False,'Durable-only scope')
    passed=[]
    def reject(label,fn):
        try:fn()
        except (ValueError,KeyError,IndexError):passed.append(label)
        else:raise AssertionError('Accepted corrupted fixture: '+label)
    verdict=m.read_json(root/'review/independent-review.json');m.check_verdict(verdict)
    for label,mutate in [
        ('automatic_application',lambda v:v.update(automatic_application=True)),
        ('unsupported_korean_name',lambda v:v['findings'][0].update(name_ko='unsupported')),
        ('whole_polygon_scalar_name',lambda v:v['findings'][1].update(whole_feature_scalar_name='Ennadai Lake')),
        ('scalar_product_clearance',lambda v:v['findings'][2].update(scalar_product_name_approved=True)),
        ('whole_polygon_clearance',lambda v:v['findings'][0].update(whole_polygon_name_application_cleared=True)),
        ('label_overlap_promoted',lambda v:v['findings'][1].update(label_overlap_alone_used_as_identity=True)),
        ('history_restoration_claim',lambda v:v.update(historical_verdicts_restored=True)),
        ('target_order_reversed',lambda v:v['findings'].reverse()),
        ('wrong_identifier_domain',lambda v:v['findings'][2].update(logical_fid=15312)),
        ('cumulative_count_inflated',lambda v:v.update(cumulative_distinct_targets=19)),
        ('formal_name_registry_claim',lambda v:v['findings'][1].update(formal_registry_verified=True)),
        ('local_subbasin_erased',lambda v:v['findings'][2].update(associated_source_name_forms=[])),
        ('independent_second_lake_asserted',lambda v:v['findings'][2].update(multiwater_extent_assessment='proven_composite')),
        ('unsupported_accent_added',lambda v:v['findings'][0].update(candidate_name='Doré Lake'))]:
        v=copy.deepcopy(verdict);mutate(v);reject(label,lambda x=v:m.check_verdict(x))
    ref=m.read_json(root/'geometry-reference.json');pins=m.read_json(root/'review/frozen-input-pins.json')
    with tempfile.TemporaryDirectory() as d:
        d=Path(d)
        source='selected-lake-geometries.geojson';baseline='selected-baseline-rendered-geometries.geojson'
        for n in [source,baseline]:(d/n).write_bytes((root/n).read_bytes())
        for label,name,mutate in [
            ('source_ring_reversed',source,lambda g:g['features'][0]['geometry']['coordinates'][0].reverse()),
            ('source_interior_coordinate_changed',source,lambda g:g['features'][1]['geometry']['coordinates'][0][5].__setitem__(0,g['features'][1]['geometry']['coordinates'][0][5][0]+0.000001)),
            ('rendered_interior_coordinate_changed',baseline,lambda g:g['features'][2]['geometry']['coordinates'][0][7].__setitem__(1,g['features'][2]['geometry']['coordinates'][0][7][1]+0.000001)),
            ('source_target_dropped',source,lambda g:g['features'].pop()),
            ('rendered_source_id_changed',baseline,lambda g:g['features'][0]['properties'].update(sourceId='1159110303'))]:
            for n in [source,baseline]:(d/n).write_bytes((root/n).read_bytes())
            v=m.read_json(d/name);mutate(v);(d/name).write_text(json.dumps(v));reject(label,lambda:m.validate_lakes(d,ref))
        for n in [source,baseline]:(d/n).write_bytes((root/n).read_bytes())
        shutil.copytree(root/'research',d/'research');shutil.copytree(root/'review',d/'review')
        name='research/naknek/source-evidence.json';pin=next(e for e in pins['package_inputs'] if e['file']==name)
        (d/name).write_bytes((root/name).read_bytes()+b' ');reject('frozen_source_evidence_bytes',lambda:m.checked(d/name,pin));(d/name).write_bytes((root/name).read_bytes())
        badpins=copy.deepcopy(pins);next(e for e in badpins['local_evidence_assets'] if e['id']=='NPS-KATM-CLASSIC-MAP-BODY')['sha256']=next(e for e in pins['local_evidence_assets'] if e['id']=='NPS-KATM-CLASSIC-MAP-TEXT')['sha256'];reject('pdf_hash_replaced_by_text_hash',lambda:m.check_sources(d,badpins))
        name='research/naknek/map-scope-review.json';v=m.read_json(d/name);v['geometry_sha256']='0'*64;(d/name).write_text(json.dumps(v));reject('whole_shape_evidence_wrong_geometry',lambda:m.check_source_joins(d,pins));(d/name).write_bytes((root/name).read_bytes())
        name='review/source-observations.json';v=m.read_json(d/name);next(r for r in v['observations'] if r['source_key']=='NPS-NAKNEK-BOATING-GUIDE-2013')['printed_date']='2018';(d/name).write_text(json.dumps(v));reject('map_date_replaced_by_metadata_date',lambda:m.check_source_joins(d,pins))
        duplicate=m.read_json(root/'geometry-duplicate-check.json');duplicate['intersection_aw_ids']=[m.AWIDS[0]];reject('prior_duplicate_introduced',lambda:m.check_duplicates(duplicate,pins))
        if a.local_source_index or a.local_source_root:
            m.require(a.local_source_index and a.local_source_root,'Local source index/root pair')
            index={r['id']:r for r in m.read_json(a.local_source_index)};pin=next(x for x in pins['local_evidence_assets'] if x['kind']=='original_source_body');q=a.local_source_root/index[pin['id']]['local_file'];data=q.read_bytes();m.checked(q,pin)
            (d/'changed-source.bin').write_bytes(data[:-1]+bytes([data[-1]^1]));reject('original_source_byte_changed',lambda:m.checked(d/'changed-source.bin',pin))
    print(json.dumps(dict(status='passed',scope_aw_ids=m.AWIDS,durable_only_truthful_reporting=True,corrupt_fixtures_rejected=len(passed),fixtures=passed,local_original_byte_fixture_run=bool(a.local_source_index),network_requests=0,original_inputs_modified=False),indent=2))
if __name__=='__main__':main()
