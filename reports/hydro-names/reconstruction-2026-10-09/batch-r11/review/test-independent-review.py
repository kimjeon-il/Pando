#!/usr/bin/env python3
"""Bounded offline corruption fixtures. Original inputs are never modified."""
import argparse,copy,importlib.util,json,subprocess,sys,tempfile,shutil
from pathlib import Path
sys.dont_write_bytecode=True

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--package',type=Path,default=Path(__file__).resolve().parent.parent);p.add_argument('--local-source-index',type=Path);p.add_argument('--local-source-root',type=Path);a=p.parse_args();root=a.package
    spec=importlib.util.spec_from_file_location('review_validator',root/'review/validate-independent-review.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    report=json.loads(subprocess.run([sys.executable,str(root/'review/validate-independent-review.py'),'--package',str(root)],check=True,capture_output=True,text=True).stdout)
    m.require(report['mode']=='durable_only' and all(report[k] is False for k in ['independent_binary_decoder_replayed','original_inventory_rechecked','original_prior_index_rechecked','visual_inspection_repeated']) and report['local_evidence_assets_rehashed']==0 and report['geometry_component']['production_decoder_replayed'] is False,'Durable-only truthful mode')
    passed=[]
    def reject(label,fn):
        try:fn()
        except (ValueError,KeyError,IndexError):passed.append(label)
        else:raise AssertionError('Accepted corrupted fixture: '+label)
    verdict=m.read_json(root/'review/independent-review.json');m.check_verdict(verdict)
    for label,mutate in [
        ('automatic_application',lambda v:v.update(automatic_application=True)),
        ('unsupported_korean_name',lambda v:v['findings'][0].update(name_ko='unsupported')),
        ('whole_polygon_scalar_name',lambda v:v['findings'][1].update(whole_feature_scalar_name='Cold Lake')),
        ('scalar_product_clearance',lambda v:v['findings'][2].update(scalar_product_name_approved=True)),
        ('whole_polygon_clearance',lambda v:v['findings'][0].update(whole_polygon_name_application_cleared=True)),
        ('label_overlap_promoted',lambda v:v['findings'][1].update(label_overlap_alone_used_as_identity=True)),
        ('history_restoration_claim',lambda v:v.update(historical_verdicts_restored=True)),
        ('target_order_reversed',lambda v:v['findings'].reverse()),
        ('wrong_identifier_domain',lambda v:v['findings'][2].update(logical_fid=15393)),
        ('cumulative_count_inflated',lambda v:v.update(cumulative_distinct_targets=34)),
        ('formal_name_registry_claim',lambda v:v['findings'][1].update(formal_registry_verified=True)),
        ('cold_unresolved_promoted',lambda v:v['findings'][1].update(research_category='supported_generalized_water_identity')),
        ('cold_map_view_fabricated',lambda v:v['findings'][1].update(map_pixels_viewed=True)),
        ('cold_original_body_fabricated',lambda v:v['findings'][1].update(source_body_sha256='0'*64)),
        ('cold_review_completion_fabricated',lambda v:v['findings'][1].update(full_feature_correspondence_review_completed=True)),
        ('cold_follow_up_erased',lambda v:v['findings'][1].update(follow_up_required=False)),
        ('cold_access_limit_erased',lambda v:v['findings'][1].update(source_access_limited=False)),
        ('completed_count_inflated',lambda v:v.update(current_batch_full_feature_correspondence_reviews_completed=3)),
        ('adjacent_named_lakes_erased',lambda v:v['findings'][2].update(nearby_distinct_map_labels=[])),
        ('unsupported_compound_claim',lambda v:v['findings'][2].update(multiwater_extent_assessment='proven_composite'))]:
        v=copy.deepcopy(verdict);mutate(v);reject(label,lambda x=v:m.check_verdict(x))
    ref=m.read_json(root/'geometry-reference.json');pins=m.read_json(root/'review/frozen-input-pins.json')
    with tempfile.TemporaryDirectory() as tmp:
        d=Path(tmp);source='selected-lake-geometries.geojson';baseline='selected-baseline-rendered-geometries.geojson'
        for n in [source,baseline,'geometry-reference.json']:(d/n).write_bytes((root/n).read_bytes())
        for label,name,mutate in [
            ('source_ring_reversed',source,lambda g:g['features'][0]['geometry']['coordinates'][0].reverse()),
            ('source_interior_coordinate_changed',source,lambda g:g['features'][1]['geometry']['coordinates'][0][5].__setitem__(0,g['features'][1]['geometry']['coordinates'][0][5][0]+.000001)),
            ('rendered_interior_coordinate_changed',baseline,lambda g:g['features'][2]['geometry']['coordinates'][0][7].__setitem__(1,g['features'][2]['geometry']['coordinates'][0][7][1]+.000001)),
            ('source_target_dropped',source,lambda g:g['features'].pop()),
            ('rendered_source_id_changed',baseline,lambda g:g['features'][0]['properties'].update(sourceId='1159112821'))]:
            for n in [source,baseline]:(d/n).write_bytes((root/n).read_bytes())
            v=m.read_json(d/name);mutate(v);(d/name).write_text(json.dumps(v));reject(label,lambda:m.validate_lakes(d,ref))
        for n in [source,baseline]:(d/n).write_bytes((root/n).read_bytes())
        shutil.copytree(root/'research',d/'research');shutil.copytree(root/'review',d/'review')
        name='research/dauphin/source-evidence.json';pin=next(e for e in pins['package_inputs'] if e['file']==name)
        (d/name).write_bytes((root/name).read_bytes()+b' ');reject('frozen_source_evidence_bytes',lambda:m.checked(d/name,pin));(d/name).write_bytes((root/name).read_bytes())
        badpins=copy.deepcopy(pins);next(e for e in badpins['local_evidence_assets'] if e['id']=='manitoba_dauphin_iwmp-BODY')['sha256']=next(e for e in pins['local_evidence_assets'] if e['id']=='manitoba_dauphin_iwmp-TEXT')['sha256'];reject('original_pdf_hash_replaced_by_text_hash',lambda:m.check_sources(d,badpins))
        name='research/dauphin/map-scope-review.json';v=m.read_json(d/name);v['source_geometry_sha256']='0'*64;(d/name).write_text(json.dumps(v));reject('whole_shape_evidence_wrong_geometry',lambda:m.check_source_joins(d,pins));(d/name).write_bytes((root/name).read_bytes())
        name='review/source-observations.json';original=m.read_json(d/name)
        for label,mutate in [
            ('wsa_url_year_as_map_date',lambda v:v['observations'][2].update(printed_date='2025-05')),
            ('iwmp_metadata_as_publication_date',lambda v:v['observations'][0].update(printed_date='2017-12-18')),
            ('cold_text_hash_as_body_hash',lambda v:v['observations'][5].update(source_body_sha256=v['observations'][5]['text_capture_sha256'])),
            ('cold_screenshot_reference_as_pixels',lambda v:v['observations'][5].update(map_pixels_viewed=True)),
            ('failed_body_declared_acquired',lambda v:v['failed_acquisitions'][0].update(source_body_acquired=True)),
            ('unused_redirect_as_name_source',lambda v:v['observations'][3].update(counted_as_naming_source=True)),
            ('reused_original_retrieval_date_replaced',lambda v:v['observations'][2].update(request_started_at_utc='2026-10-09T15:11:20Z')),
            ('naming_body_count_inflated',lambda v:v.update(original_naming_source_bodies_rehashed=5))]:
            v=copy.deepcopy(original);mutate(v);(d/name).write_text(json.dumps(v));reject(label,lambda:m.check_sources(d,pins))
        (d/name).write_text(json.dumps(original))
        duplicate=m.read_json(root/'geometry-duplicate-check.json')
        for label,mutate in [
            ('prior_duplicate_introduced',lambda v:v.update(intersection_aw_ids=[m.AWIDS[0]])),
            ('queue_remaining_count_inflated',lambda v:v['current_batch_delta'].update(remaining_fresh_reconstruction_queue_after=4033)),
            ('queue_category_count_corrupted',lambda v:v['current_batch_delta'].update(remaining_queue_types_after={'river_group':3438,'lake':594})),
            ('prior_targets_reaudit_claimed',lambda v:v['current_batch_delta'].update(prior_target_geometry_or_naming_revalidation_performed=True))]:
            v=copy.deepcopy(duplicate);mutate(v);reject(label,lambda x=v:m.check_duplicates(x,pins))
        if a.local_source_index or a.local_source_root:
            m.require(a.local_source_index and a.local_source_root,'Local source index/root pair');index={r['id']:r for r in m.read_json(a.local_source_index)};pin=next(x for x in pins['local_evidence_assets'] if x['kind']=='original_source_body');q=a.local_source_root/index[pin['id']]['local_file'];data=q.read_bytes();m.checked(q,pin)
            (d/'changed-source.bin').write_bytes(data[:-1]+bytes([data[-1]^1]));reject('original_source_byte_changed',lambda:m.checked(d/'changed-source.bin',pin))
    print(json.dumps(dict(status='passed',scope_aw_ids=m.AWIDS,durable_only_truthful_reporting=True,corrupt_fixtures_rejected=len(passed),fixtures=passed,local_original_byte_fixture_run=bool(a.local_source_index),network_requests=0,original_inputs_modified=False),indent=2))
if __name__=='__main__':main()
