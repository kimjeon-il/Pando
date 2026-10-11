#!/usr/bin/env python3
"""Finite included-record consistency; no omitted map/path/decoder replay."""
import hashlib
import json
from pathlib import Path
import sys
from datetime import datetime
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
PUBLIC = HERE.parent
IDS = ['hydro-system:50691388','hydro-system:50768223','hydro-system:50798628']
NAMES = ['Richmond River','Hawkesbury River','Snowy River']
LOGICAL = [2023,2125,2147]
FIDS = [[6979],[7086,7087,7088],[7137]]
PARTS = [30,80,94]
POSITIONS = [258,557,613]
FRAGMENT_PARTS = [[30],[69,4,7],[94]]
FRAGMENT_POSITIONS = [[258],[491,23,43],[613]]
STAGES = [[3],[3,2,1],[3]]
SOURCE = 'bom_australian_water_resources_assessment_2012'
STAMP = '2026-10-09T20:30:02.119152+00:00'
GEOMETRY_FILES = {'geometry-reference.json','selected-river-metadata.json','selected-inventory-records.json','geometry-duplicate-check.json','geometry-publication-rights.json','geometry-README.md','validate-geometry-reference.py','test-geometry-reference.py','geometry-validation.json','geometry-component-manifest.json'}
REVIEW_FILES = {'README.md','independent-review.json','source-observations.json','public-input-pins.json','review-validation.json','review-manifest.json','validate-independent-review.py','test-independent-review.py'}
DOCUMENTS = {'review':'review/independent-review.json','source':'review/source-observations.json','geometry':'geometry-reference.json','metadata':'selected-river-metadata.json','inventory':'selected-inventory-records.json','continuity':'geometry-duplicate-check.json'}

def equal(actual, expected):
    assert json.dumps(actual,sort_keys=True)==json.dumps(expected,sort_keys=True)

def read_json(path):
    assert path.is_file() and not path.is_symlink()
    return json.loads(path.read_text(encoding='utf-8'))

def load_records():
    return {key:read_json(PUBLIC/name) for key,name in DOCUMENTS.items()}

def verify_bytes(body,pin):
    equal(len(body),pin['bytes']);equal(hashlib.sha256(body).hexdigest(),pin['sha256'])

def timestamp(value):
    value=datetime.fromisoformat(value.replace('Z','+00:00'));assert value.utcoffset() is not None
    return value

def reject_omitted_payload(value):
    if isinstance(value,dict):
        for key,child in value.items():
            assert key not in {'coordinates','coordinate_arrays','part_endpoints','cache_dir'}
            assert not any(term in key.lower() for term in ('sha256','fingerprint','checksum'))
            reject_omitted_payload(child)
    elif isinstance(value,list):
        for child in value:reject_omitted_payload(child)

def validate_records(records):
    review,source,geometry,metadata,inventory,continuity=(records[key] for key in DOCUMENTS)
    reject_omitted_payload(review);reject_omitted_payload(source)
    equal(review['schema'],'hydro-independent-river-review-v4');equal(source['schema'],'hydro-public-source-observations-v4')
    for d in (review,source,geometry):equal(d['batch'],'r24')
    for d in (review,source,geometry,metadata,inventory):equal(d['scope_aw_ids'],IDS)
    equal(review['reviewed_at_utc'],STAMP);equal(review['baseline_commit'],geometry['baseline']['git_commit'])
    equal(review['baseline_commit'],'fd6744f5e72a0c1a107452dbde6d416ab57237db')
    for t in (geometry['created_at_utc'],review['reviewed_at_utc'],review['historical_review']['performed_at_utc']):timestamp(t)
    for key in ('automatic_application','product_application','geometry_modified','topology_repaired','current_live_deployment_checked','historical_verdicts_restored','original_hydrorivers_coordinate_equality_verified','all_reach_names_verified','pending_access_reassessment_performed','prior_target_source_or_geometry_reaudit_performed'):equal(review[key],False)
    for key,value in {'prior_distinct_targets':69,'current_batch_increment':3,'cumulative_distinct_targets':72,'duplicate_targets':0,'current_batch_full_feature_correspondence_reviews_completed':3,'current_batch_source_limited_targets':0,'current_batch_follow_up_required_targets':1,'current_batch_scope_hold_targets':1,'scalar_product_name_approvals':0}.items():equal(review[key],value)
    equal(review['new_pending_access_ids'],[]);equal(review['new_scope_hold_ids'],[IDS[0]])
    equal(review['historical_review'],{'performed_at_utc':STAMP,'available_source_inspection_completed':True,'full_feature_correspondence_review_completed':True,'original_source_material_included':False,'full_selected_geometry_included':False,'historical_results_recomputed_by_public_validator':False})
    equal(source['new_external_requests'],0)
    for key in ('distinct_supporting_publications','distinct_cartographic_identity_publications','independent_source_groups'):equal(source[key],1)
    for key in ('underlying_hydrographic_dataset_independence_verified','formal_registry_verified','registered_overlay_performed','exact_surveyed_mouth_verified'):equal(source[key],False)
    equal(len(source['observations']),1);pub=source['observations'][0]
    for key,value in {'source_key':SOURCE,'title':'Australian Water Resources Assessment 2012','publisher':'Bureau of Meteorology, Commonwealth of Australia','url':'https://www.bom.gov.au/water/awra/2012/documents/assessment-lr.pdf','assessment_year':2012,'publication_year':2013,'publication_date_precision':'year','original_acquired_at_utc':'2026-10-09T13:39:46.198340+00:00','retrieved_this_batch':False,'reused_original':True,'original_map_pixels_viewed':True,'is_formal_naming_registry':False,'supporting_text_physical_pdf_pages':[141,161,204],'tables':[]}.items():equal(pub[key],value)
    assert timestamp(pub['original_acquired_at_utc'])<=timestamp(STAMP)
    equal([[f['figure'],f['physical_pdf_page'],f['printed_chapter_page']] for f in pub['figures']],[['4.1',120,5],['4.22',142,27],['4.36',162,47],['5.1',180,5],['5.26',205,30]])
    for i,phrases in enumerate([['too indistinct','town Richmond'],['basin callouts are context only'],['Lake Burragorang/Warragamba','transfers are not natural river paths'],['Snowy and Eucumbene','river-line'],['no exact lake or reach-name boundary']]):
        for phrase in phrases:assert phrase in pub['figures'][i]['scope']
    for phrase in ('Little Wobby','Richmond-Windsor','Wollondilly and Coxs','not usable named station evidence'):assert phrase in pub['observation']
    collections=[review['findings'],source['complete_group_observations'],geometry['groups'],inventory['records']]
    for c in collections:equal([x['aw_id'] for x in c],IDS)
    fragments=metadata['fragments'];equal([x['fid'] for x in fragments],[6979,7086,7087,7088,7137])
    for i,(f,o,g,row) in enumerate(zip(*collections)):
        fs=[x for x in fragments if x['aw_id']==IDS[i]]
        for item in (f,g,row,*fs):equal(item['system_id'],IDS[i].split(':')[1]);equal(item['logical_fid'],LOGICAL[i])
        for item in (f,o,g,row):equal(item['geometry_fids'],FIDS[i])
        for item in (f,o,g):
            for k,v in [('fragment_count',len(FIDS[i])),('part_count',PARTS[i]),('position_count',POSITIONS[i])]:equal(item[k],v)
        equal(row['geometry_count'],len(FIDS[i]));equal([x['fragment_index'] for x in fs],list(range(len(FIDS[i]))))
        equal([x['part_count'] for x in fs],FRAGMENT_PARTS[i]);equal([x['position_count'] for x in fs],FRAGMENT_POSITIONS[i])
        equal([x['stage'] for x in fs],STAGES[i]);equal(f['baseline_stage_sequence'],STAGES[i]);equal(f['baseline_fragment_roles'],['mainstem']*len(fs));equal(g['role_sequence'],['mainstem']*len(fs))
        for x in fs:equal(x['fragment_count'],len(fs));equal(x['role'],'mainstem');equal(len(x['position_counts_by_part']),x['part_count']);equal(sum(x['position_counts_by_part']),x['position_count'])
        equal(g['minimum_stage'],min(STAGES[i]));equal(row['minimum_stage'],min(STAGES[i]))
        equal(f['candidate_name'],NAMES[i]);equal(f['source_keys'],[SOURCE]);equal(f['directly_supported_name_forms'],[] if i==0 else [NAMES[i]])
        equal(f['mapped_named_station_forms'],[]);equal(f['mapped_short_name_forms'],['Snowy'] if i==2 else [])
        equal(f['geographic_disambiguation'],'New South Wales and Victoria, Australia' if i==2 else 'New South Wales, Australia')
        equal(f['research_category'],'river_group_name_scope_hold' if i==0 else 'supported_representative_system_identity')
        equal(f['review_status'],'naming_scope_hold_after_complete_review' if i==0 else 'representative_system_supported_with_reach_name_limits')
        equal(f['candidate_name_role'],'geographic_candidate_only_scope_hold' if i==0 else 'bounded_representative_system_identity')
        equal(f['follow_up_required'],i==0);equal(f['supported_name_scope'],o['independent_observation'])
        for phrase in ['feeder','river/storage','coast','unassigned at reach level']:assert phrase in f['supported_name_scope']
        for phrase in [['too indistinct','basin callout','naming-scope hold'],['Little Wobby','Richmond-Windsor','Wollondilly','Lake Burragorang/Warragamba','Coxs','Nepean','Green water-transfer arrows'],['Eucumbene','Snowy Hydro','storage/lake','Victorian coast']][i]:assert phrase in f['supported_name_scope']
        for phrase in ['storage','coastal','separately authorized']:assert phrase in f['follow_up_scope']
        if i==0:assert 'legible direct river-name evidence' in f['follow_up_scope']
        else:assert 'modeled mainstem can include differently named feeder reaches' in f['supported_name_scope']
        for key in ('whole_group_scalar_name','scalar_product_name','name_ko','name_en','name_original'):equal(f[key],None)
        for key in ('source_access_limited','automatic_application','product_application','scalar_product_name_approved','whole_group_scalar_application_approved','whole_reach_name_application_cleared','all_reach_names_verified','uniform_river_name_for_group','formal_registry_verified','exact_source_reach_name_transitions_verified','exact_surveyed_mouth_verified','topology_repaired','label_overlap_alone_used_as_identity','catchment_title_alone_used_as_identity','regional_associations_are_exact_reach_assignments'):equal(f[key],False)
        for key in ('full_feature_correspondence_review_completed','reach_level_naming_follow_up_required_before_product_application','complete_baseline_group_compared','all_selected_branches_considered','private_original_pack_and_metadata_independently_decoded'):equal(f[key],True)
        for key in ('entire_selected_baseline_group_viewed','all_selected_branches_considered'):equal(o[key],True)
        equal([a['mapped_name'] for a in f['regional_distinct_channel_associations']],[[],['Wollondilly','Lake Burragorang / Warragamba'],['Eucumbene']][i])
        for a in f['regional_distinct_channel_associations']:assert 'no exact rendered-part partition' in a['scope']
        equal(f['confidence']['representative_system_association'],'not established' if i==0 else 'moderate');equal(f['confidence']['reach_level_name_assignment'],'not established')
        equal(f['confidence']['formal_naming_authority_verified'],False);equal(f['confidence']['numerical_probability_claimed'],False)
    prior=continuity['previous_aw_ids_in_index_order'];equal(continuity['previous_target_count'],69);equal(len(prior),69);equal(len(set(prior)),69);assert not set(prior).intersection(IDS)
    equal(continuity['selected_aw_ids'],IDS);equal(continuity['intersection_aw_ids'],[]);equal(continuity['selected_unique_count'],3)
    for key in ('historical_names_used_as_identity_evidence','pending_access_reassessment_performed','scope_hold_reassessment_performed'):equal(continuity[key],False)
    equal(review['preserved_pending_access_ids'],['lakes_base:1159112821','lakes_base:1159108815'])
    for key in ('preserved_pending_access_ids','preserved_scope_hold_ids'):equal(review[key],continuity[key]);assert set(review[key]).issubset(prior);equal(len(review[key]),len(set(review[key])))
    equal(len(review['preserved_scope_hold_ids']),18);assert 'hydro-system:50738894' in review['preserved_scope_hold_ids']
    for key,value in {'selected_current_inventory_targets':3,'reconstructed_target_count_before':69,'reconstructed_target_count_after':72,'initial_eligible_target_count':4065,'remaining_fresh_reconstruction_queue_before':3996,'remaining_fresh_reconstruction_queue_after':3993,'remaining_queue_types_before':{'river_group':3424,'lake':572},'remaining_queue_types_after':{'river_group':3421,'lake':572},'historically_never_reviewed_count_claimed':False,'prior_target_geometry_or_naming_revalidation_performed':False}.items():equal(continuity['current_batch_delta'][key],value)
    inherited=review['inherited_scope_continuity'];equal([x['aw_id'] for x in inherited],['lakes_base:1159109723','lakes_base:1159116675','lakes_base:1159118183','lakes_base:1159118201']);equal([x['follow_up_required'] for x in inherited],[False,True,True,True])
    equal([x['research_category'] for x in inherited],['supported_generalized_water_identity','candidate_waterbody_identity_extent_hold','candidate_waterbody_identity_extent_hold','whole_polygon_scope_hold'])
    for x in inherited[1:]:equal(x['naming_scope_details']['directly_supported_name_forms'],[])
    assert 'eastern basin' in inherited[0]['supported_name_scope']
    mitchell=review['inherited_same_name_disambiguation'];equal([x['aw_id'] for x in mitchell],['hydro-system:50798927','hydro-system:50464082']);equal([x['geographic_disambiguation'] for x in mitchell],['Victoria, Australia','Queensland, Australia'])
    for x in mitchell:equal(x['candidate_name'],'Mitchell River');equal(x['prior_source_or_geometry_reaudited'],False);assert x['aw_id'] in prior
    assert 'Mitchell River in Victoria' in mitchell[0]['supported_name_scope'];equal(mitchell[0]['regional_distinct_channel_associations'],[])
    for name in ('Palmer','Walsh'):assert name in mitchell[1]['supported_name_scope']
    equal(mitchell[1]['regional_distinct_channel_associations'],['Palmer','Walsh'])
    return {'status':'passed','mode':'included_public_files_only','scope_aw_ids':IDS,'recorded_fragment_count':5,'recorded_part_count':204,'recorded_position_count':1428,'recorded_full_feature_correspondence_reviews_completed':3,'representative_system_identities_supported':2,'current_source_limited_targets':0,'current_scope_hold_ids':[IDS[0]],'current_follow_up_ids':[IDS[0]],'recorded_prior_target_count':69,'current_batch_increment':3,'recorded_cumulative_distinct_targets':72,'remaining_unrecorded_targets':3993,'remaining_river_groups':3421,'remaining_lakes':572,'preserved_pending_access_ids':review['preserved_pending_access_ids'],'preserved_scope_hold_ids':review['preserved_scope_hold_ids'],'distinct_supporting_publications':1,'independent_source_groups':1,'original_source_material_reopened':False,'map_judgments_reproduced':False,'omitted_full_paths_recomputed':False,'original_decoder_replayed':False,'prior_target_source_or_geometry_reaudit_performed':False,'formal_registry_verified':False,'all_reach_names_verified':False,'scalar_product_name_approvals':0,'automatic_application':False,'product_application':False,'network_requests':0,'future_reach_level_naming_requires_separate_evidence':True,'limit':'Included-file consistency only. Original-map, complete-path and decoder review is recorded, not reproduced. A completed review can retain a naming hold. Representative identity does not name every reach or authorize product use.'}

def validate_public():
    pins=read_json(HERE/'public-input-pins.json');equal(pins['batch'],'r24');equal(pins['scope'],'included_public_files_only');equal(pins['automatic_application'],False)
    equal(sorted(row['path'] for row in pins['files']),sorted(GEOMETRY_FILES));equal(len(pins['files']),10)
    for row in pins['files']:
        p=PUBLIC/row['path'];assert not p.is_symlink();verify_bytes(p.read_bytes(),row)
    gm=read_json(PUBLIC/'geometry-component-manifest.json');equal(sorted(gm['files']),sorted(GEOMETRY_FILES-{'geometry-component-manifest.json'}))
    for name,digest in gm['files'].items():equal(hashlib.sha256((PUBLIC/name).read_bytes()).hexdigest(),digest)
    manifest=read_json(HERE/'review-manifest.json');equal(manifest['batch'],'r24');equal(manifest['scope'],'included_public_files_only');equal(manifest['scope_aw_ids'],IDS);timestamp(manifest['frozen_at_utc'])
    equal(manifest['review_file_count_including_manifest'],8);equal(manifest['manifest_excludes_itself'],True);equal(manifest['automatic_application'],False)
    equal(sorted(p.name for p in HERE.iterdir()),sorted(REVIEW_FILES));equal(sorted(row['file'] for row in manifest['files']),sorted(REVIEW_FILES-{'review-manifest.json'}));equal(len(manifest['files']),7)
    for row in manifest['files']:
        p=HERE/row['file'];assert not p.is_symlink();verify_bytes(p.read_bytes(),row)
    result=validate_records(load_records());recorded=read_json(HERE/'review-validation.json');equal(recorded['validation'],result);equal(recorded['status'],'passed');equal(recorded['mode'],'included_public_files_only');equal(recorded['tests']['status'],'passed');timestamp(recorded['validated_at_utc'])
    result.update(public_input_files_checked=10,review_component_files_checked=8,included_dependency_manifests_checked=1)
    return result

if __name__=='__main__':print(json.dumps(validate_public(),indent=2))
