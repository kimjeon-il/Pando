#!/usr/bin/env python3
"""Bounded corruption fixtures against independent structural and naming checks."""
import argparse,copy,importlib.util,json,subprocess,sys,tempfile
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
        ('whole_polygon_scalar_name',lambda v:v['findings'][1].update(whole_feature_scalar_name='Lac de Gras')),
        ('scalar_product_clearance',lambda v:v['findings'][2].update(scalar_product_name_approved=True)),
        ('whole_polygon_clearance',lambda v:v['findings'][0].update(whole_polygon_name_application_cleared=True)),
        ('label_overlap_promoted',lambda v:v['findings'][1].update(label_overlap_alone_used_as_identity=True)),
        ('history_restoration_claim',lambda v:v.update(historical_verdicts_restored=True)),
        ('target_order_reversed',lambda v:v['findings'].reverse()),
        ('wrong_identifier_domain',lambda v:v['findings'][2].update(logical_fid=15571)),
        ('cumulative_count_inflated',lambda v:v.update(cumulative_distinct_targets=16)),
        ('formal_name_registry_claim',lambda v:v['findings'][1].update(formal_registry_verified=True))]:
        v=copy.deepcopy(verdict);mutate(v);reject(label,lambda x=v:m.check_verdict(x))
    ref=m.read_json(root/'geometry-reference.json');pins=m.read_json(root/'review/frozen-input-pins.json')
    with tempfile.TemporaryDirectory() as d:
        d=Path(d);(d/'research').mkdir()
        source='selected-lake-geometries.geojson';baseline='selected-baseline-rendered-geometries.geojson'
        for n in [source,baseline]:(d/n).write_bytes((root/n).read_bytes())
        for label,name,mutate in [
            ('source_ring_reversed',source,lambda g:g['features'][0]['geometry']['coordinates'][0].reverse()),
            ('source_interior_coordinate_changed',source,lambda g:g['features'][1]['geometry']['coordinates'][0][5].__setitem__(0,g['features'][1]['geometry']['coordinates'][0][5][0]+0.000001)),
            ('rendered_interior_coordinate_changed',baseline,lambda g:g['features'][2]['geometry']['coordinates'][0][7].__setitem__(1,g['features'][2]['geometry']['coordinates'][0][7][1]+0.000001)),
            ('source_target_dropped',source,lambda g:g['features'].pop()),
            ('rendered_source_id_changed',baseline,lambda g:g['features'][0]['properties'].update(sourceId='1159109471'))]:
            for n in [source,baseline]:(d/n).write_bytes((root/n).read_bytes())
            v=m.read_json(d/name);mutate(v);(d/name).write_text(json.dumps(v));reject(label,lambda:m.validate_lakes(d,ref))
        for n in [source,baseline]:(d/n).write_bytes((root/n).read_bytes())
        name='research/northern-lakes-source-evidence.json';pin=next(e for e in pins['package_inputs'] if e['file']==name);(d/name).write_bytes((root/name).read_bytes()+b' ');reject('frozen_source_evidence_bytes',lambda:m.checked(d/name,pin))
        reg=m.read_json(root/'research/northern-lakes-registration-facts.json');reg['projected_xy_plus_one_to_top_left_pdf_xy_matrix'][2][0]+=1;(d/'research/northern-lakes-registration-facts.json').write_text(json.dumps(reg));reject('overlay_registration_shift',lambda:m.check_registration(d))
        for f in (root/'research').glob('*.json'):(d/'research'/f.name).write_bytes(f.read_bytes())
        v=m.read_json(d/name);v['sources'][0]['acquisition']['original_body_sha256']=v['sources'][0]['acquisition']['text_extraction_sha256'];(d/name).write_text(json.dumps(v));reject('pdf_hash_replaced_by_text_hash',lambda:m.check_sources(d,pins))
        duplicate=m.read_json(root/'geometry-duplicate-check.json');duplicate['intersection_aw_ids']=[m.AWIDS[0]];reject('prior_duplicate_introduced',lambda:m.check_duplicates(duplicate,pins))
        if a.local_source_index or a.local_source_root:
            m.require(a.local_source_index and a.local_source_root,'Local source index/root pair')
            index={r['id']:r for r in m.read_json(a.local_source_index)};pin=next(x for x in pins['local_evidence_assets'] if x['kind']=='original_source_body');q=a.local_source_root/index[pin['id']]['local_file'];data=q.read_bytes();m.checked(q,pin)
            (d/'changed-source.pdf').write_bytes(data[:-1]+bytes([data[-1]^1]));reject('original_pdf_byte_changed',lambda:m.checked(d/'changed-source.pdf',pin))
    print(json.dumps(dict(status='passed',scope_aw_ids=m.AWIDS,durable_only_truthful_reporting=True,corrupt_fixtures_rejected=len(passed),fixtures=passed,local_original_byte_fixture_run=bool(a.local_source_index),network_requests=0,original_inputs_modified=False),indent=2))
if __name__=='__main__':main()
