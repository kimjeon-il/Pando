#!/usr/bin/env python3
"""Check included current-three facts and bytes; omitted source judgments are not replayed."""
import hashlib,json,re,sys
from pathlib import Path
from datetime import datetime
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
PUBLIC=HERE.parent
IDS = ['lakes_base:1159109187', 'lakes_base:1159107159', 'lakes_base:1159112345']
NAMES = ['Attawapiskat Lake', 'Wunnummin Lake', 'Missisa Lake']
SOURCE_KEY = 'ogs_index_bedrock_northern_2021'
LOCATIONS = ['Northern Ontario, Canada, at the broad branching Attawapiskat Lake body east of Kabania Lake', 'Northern Ontario, Canada, at the branching Wunnummin Lake body southeast of Maria Lake and Kingfisher Lake', 'Northern Ontario, Canada, at the rounded Missisa Lake body north of the Kapiskau River']
EXTENT_LIMITS = ['The complete selected generalized ring follows the Attawapiskat Lake body, including its northward finger, western and southwestern protrusions, central neck and long southeastern reach. Detailed bays, islands, channels and branching continuations are generalized or omitted, and some coarse edges cross mapped land. The entire detailed named-lake extent and exact adjoining-water transitions are unverified.', 'The complete selected generalized ring follows the Wunnummin Lake complex across its southwestern taper, western and northwestern reach, north-central finger, northeastern lobe and southern hook. The printed label is positioned on white land just south of the pale-cyan water, not in a separate southern basin. Fine inlets, islands, channels and branching extensions are generalized or omitted; exact named-water boundaries and entire detailed lake representation are unverified.', 'The complete selected generalized ring follows the principal Missisa Lake body: northern rounded cap, long southeastern side, broad southern end and western notch with short lobe. Coarse western and southern segments cross detailed mapped shores and omit fine bays and small connected northern waters. Exact shoreline, adjoining-water transitions and the entire detailed named-lake extent remain unverified.']
OBSERVATIONS = ['Original blue Attawapiskat Lake typography and the complete 66-position outline support a generalized association with the branching lake body. All protrusions and the southeastern reach were compared with original hydrography and wider context. Nearby Kabania, Mameigwess and Fishbasket lakes remain separate contextual waters; publication index lines and graticules are not name boundaries.', 'Original typography reads Wunnummin Lake. Complete 76-position geometry, wider context and original pale-cyan water versus white land support that generalized lake association. The label sits south of the selected water on land; it does not demonstrate a missing southern basin. Maria Lake and Kingfisher Lake are separately labelled surrounding waters and are not aliases or selected named components.', 'Original blue Missisa Lake typography lies within the compact water body corresponding to the complete 23-position generalized ring. The northern cap, southeastern side, southern end and western notch were compared. Kapiskau River is distinct southern context; the red geological-publication coverage outlines do not divide named waters.']
PUBLICATION_URL = 'https://www.geologyontario.mndm.gov.on.ca/mines/ogs/indexes/pdfs/INDEX-Bedrock-Northern.pdf'
ACQUISITION = '2026-10-10T01:44:15.182007+00:00'
FIDS = [15396, 15244, 15615]
LOGICAL = [4021, 3869, 4240]
POSITIONS = [66, 76, 23]
BASELINE = 'fd6744f5e72a0c1a107452dbde6d416ab57237db'
PRIOR = '863e198060ad6d265e485cdde6a11a9aefd29e88'
GEOMETRY_FILES = {'geometry-publication-rights.json', 'geometry-README.md', 'validate-geometry-reference.py', 'geometry-component-manifest.json', 'geometry-duplicate-check.json', 'test-geometry-reference.py', 'geometry-validation.json', 'selected-inventory-records.json', 'geometry-reference.json'}
REVIEW_FILES = {'review-manifest.json', 'public-input-pins.json', 'review-validation.json', 'validate-independent-review.py', 'test-independent-review.py', 'independent-review.json', 'README.md', 'source-observations.json'}
DOCUMENTS = {'review': 'review/independent-review.json', 'source': 'review/source-observations.json', 'geometry': 'geometry-reference.json', 'inventory': 'selected-inventory-records.json', 'continuity': 'geometry-duplicate-check.json'}


def load_records():return {k:json.loads((PUBLIC/p).read_text())for k,p in DOCUMENTS.items()}
def verify_bytes(body,pin):assert len(body)==pin['bytes'] and hashlib.sha256(body).hexdigest()==pin['sha256']
def timestamp(value):
    t=datetime.fromisoformat(value.replace('Z','+00:00'));assert t.utcoffset()is not None;return t

def reject_payload(value):
    if isinstance(value,dict):
        for k,v in value.items():
            assert k not in {'coordinates','coordinate_arrays','part_endpoints','cache_dir'}
            assert not any(t in k.lower()for t in ['sha256','fingerprint','checksum'])
            reject_payload(v)
    elif isinstance(value,list):
        for v in value:reject_payload(v)
    elif isinstance(value,str):assert not re.search(r'/(?:workspace|tmp)/|(?:local-review|input-cache)/',value)

def validate_records(data):
    review,source,geometry,inventory,continuity=(data[k]for k in DOCUMENTS)
    reject_payload(review);reject_payload(source)
    for d in [review,source,geometry,continuity]:assert d['batch']=='r40'
    for d in [review,source,geometry,inventory]:assert d['scope_aw_ids']==IDS
    assert review['baseline_commit']==geometry['baseline']['git_commit']==BASELINE
    stamp=timestamp(review['reviewed_at_utc']);timestamp(geometry['created_at_utc'])
    assert review['prior_distinct_targets']==114 and review['current_batch_increment']==3 and review['cumulative_distinct_targets']==117 and review['duplicate_targets']==0
    assert review['current_batch_full_feature_correspondence_reviews_completed']==3
    for k in ['current_batch_source_limited_targets','current_batch_source_material_pending_targets','current_batch_follow_up_required_targets','current_batch_scope_hold_targets','scalar_product_name_approvals']:assert review[k]==0
    assert review['independent_source_comparison_completed']is True
    for k in ['automatic_application','product_application','geometry_modified','topology_repaired','current_live_deployment_checked','historical_verdicts_restored','pending_access_reassessment_performed','prior_target_source_or_geometry_reaudit_performed','private_original_packed_decoder_independently_replayed']:assert review[k]is False
    history=review['historical_review'];assert timestamp(history['performed_at_utc'])==stamp
    assert history['available_source_inspection_completed']is True and history['full_feature_correspondence_review_completed']is True
    assert history['full_feature_correspondence_review_completed_count']==3 and history['source_material_pending_count']==0
    for k in ['original_source_material_included','full_selected_geometry_included','historical_results_recomputed_by_public_validator']:assert history[k]is False
    assert source['new_external_requests']==4 and source['new_external_requests_by_independent_reviewer']==0 and source['backend_http_subrequest_count']is None and source['new_original_source_acquisitions_this_batch']==1
    assert source['external_request_count_unit']=='known_high_level_calls' and source['new_external_requests_scope']
    assert source['request_accounting']=={'search_tool_calls':3,'search_queries':5,'explicit_web_open_requests':0,'original_body_requests':1,'new_original_bodies_acquired':1,'new_source_access_denials':0,'new_source_availability_failures':0,'stopped_resource_requests':0,'additional_source_acquisitions_planned':False}
    assert source['distinct_reviewed_publications']==source['distinct_cartographic_identity_publications']==source['independent_source_groups']==1
    assert source['independent_review_and_source_research_agree']is True and source['registered_overlay_performed']is True
    for k in ['registration_limit','source_group_definition','source_group_limit']:assert source[k]
    for k in ['underlying_hydrographic_dataset_independence_verified','formal_registry_verified']:assert source[k]is False
    pubs=source['observations'];assert len(pubs)==1;p=pubs[0]
    assert p['source_key']==SOURCE_KEY and p['url']==PUBLICATION_URL and p['original_acquired_at_utc']==ACQUISITION and timestamp(p['original_acquired_at_utc'])<=stamp
    assert p['original_requested_at_utc']=='2026-10-10T01:44:07.664713+00:00' and timestamp(p['original_requested_at_utc'])<timestamp(p['original_acquired_at_utc'])
    assert p['acquisition_http_status']==200 and p['original_acquisition_receipt_reviewed']is True and p['original_acquisition_batch']=='r40'
    for k in ['retrieved_this_batch','reused_original','review_reused_original_acquired_earlier_this_batch','original_map_pixels_viewed','registered_overlay_performed']:assert p[k]is True
    assert p['is_formal_naming_registry']is False and p['review_reused_original_acquired_in_prior_batch']is False
    assert p['publication_date']==p['printed_copyright_year']==p['printed_bibliographic_citation_year']=='2021' and p['publication_date_precision']=='year' and p['publication_date_verified']is True
    assert p['hydrographic_base_provider']is None and p['physical_pdf_pages']==[1] and p['printed_scale']=='1:1,000,000'
    assert p['directly_read_water_labels']==NAMES and p['nearby_distinct_water_labels']==['Kabania Lake','Mameigwess Lake','Fishbasket Lake','Maria Lake','Kingfisher Lake','Kapiskau River']
    for k in ['title','publisher','own_observations','role','authority_scope','publication_date_note','cartographic_credit_observed']:assert p[k]
    columns=[review['findings'],source['complete_feature_observations'],geometry['selected_features'],inventory['records']]
    for col in columns:assert [r['aw_id']for r in col]==IDS
    for i,(f,o,g,row)in enumerate(zip(*columns)):
        for x in [f,o,g,row]:assert x['source_id']==IDS[i].split(':')[1]
        assert f['baseline_logical_fid']==g['baseline_logical_fid']==row['logical_fid']==LOGICAL[i] and g['baseline_fid']==FIDS[i]
        for x in [f,o,row]:assert x['geometry_fids']==[FIDS[i]]
        assert f['fragment_count']==g['fragment_count']==row['geometry_count']==1
        for x in [f,o]:assert x['polygon_part_count']==x['ring_count']==1 and x['position_count_including_closure']==POSITIONS[i] and x['all_selected_parts_and_rings_considered']is True
        for k in ['source_geometry','baseline_rendered_geometry']:
            s=g[k];assert s['type']=='Polygon' and s['polygon_part_count']==1 and s['ring_counts_by_part']==[1] and s['coordinate_counts_by_part_and_ring']==[[POSITIONS[i]]] and s['total_coordinates_including_closure']==POSITIONS[i] and s['all_rings_closed']is True
        assert row['bbox']==g['baseline_rendered_geometry']['bbox'] and f['category']==row['category']=='lake'
        assert f['source_keys']==o['source_keys']==[SOURCE_KEY] and f['context_source_keys']==o['context_source_keys']==[]
        assert f['full_feature_correspondence_review_completed']is True and f['source_and_rendered_full_footprints_compared']is True and o['entire_selected_source_and_rendered_polygons_viewed']is True
        assert f['source_observation_id']==o['observation_id']==f['aw_id'] and o['independent_observation']==OBSERVATIONS[i]
        assert f['supported_name_scope'] and f['limits'] and f['follow_up_scope'] and f['geographic_disambiguation']==LOCATIONS[i]
        assert f['candidate_names']==f['directly_supported_name_forms']==[NAMES[i]] and f['candidate_name']==NAMES[i]
        assert f['source_material_pending']is False and f['source_access_limited']is False and f['complete_source_map_coverage_available']is True and f['complete_geometry_inspection_performed']is True
        assert o['source_material_pending']is False and o['complete_source_map_coverage_available']is True and o['full_feature_source_identity_review_completed']is True
        assert f['research_category']=='supported_generalized_water_identity' and f['review_status']=='supported_generalized_identity_with_material_extent_limits' and f['candidate_name_role']=='generalized_research_identity_not_product_scalar'
        assert f['follow_up_required']is False and f['registered_overlay_performed']is True
        c=f['name_confidence'];assert c['direct_label_reading']==c['local_named_water_association']=='high' and c['whole_selected_single_name']=='supported_generalized_identity' and c['exact_named_extent']=='unverified' and c['basis']==OBSERVATIONS[i]
        assert f['selection_origin']=='new_inventory_investigation'
        for k in ['whole_feature_scalar_name','scalar_product_name','name_ko','korean_name','name_en','name_original']:assert f[k]is None
        for k in ['automatic_application','product_application','whole_feature_scalar_name_approved','formal_registry_verified','exact_shoreline_verified','exact_name_extent_verified','geometry_modified','bounding_box_alone_used_as_identity','historical_verified_ID_restored']:assert f[k]is False
        s=f['naming_scope_details'];assert s['selected_polygon_count']==1 and s['separately_labelled_water_names']==[NAMES[i]] and s['multiple_named_lakes_in_one_polygon']is False
        for k in ['one_named_generalized_water_identity_supported','whole_polygon_single_name_supported','supported_component_names_exhaustive']:assert s[k]is True
        for k in ['whole_polygon_scalar_application_approved','precise_name_boundary_verified','formal_registry_verified','subdivision_or_geometry_repair_performed','component_associations_are_exact_geometric_assignments','independent_cartographic_dataset_confirmed','entire_detailed_named_lake_representation_verified']:assert s[k]is False
        assert s['material_extent_limit']==EXTENT_LIMITS[i] and EXTENT_LIMITS[i]in f['supported_name_scope'] and EXTENT_LIMITS[i]in f['limits']
        assert s['unresolved_selected_parts']==s['unresolved_named_extents']==[]
        assert s['supported_component_associations']==[{'name':NAMES[i],'scope':'Complete selected generalized footprint with stated material extent limits'}]
    assert review['new_scope_hold_ids']==review['new_pending_access_ids']==review['new_pending_material_ids']==[]
    assert review['preserved_pending_material_ids']==continuity['preserved_pending_material_ids']==['lakes_base:1159109285']
    assert review['preserved_pending_access_ids']==continuity['preserved_pending_access_ids']==['lakes_base:1159112821','lakes_base:1159108815']
    assert review['preserved_scope_hold_ids']==continuity['preserved_scope_hold_ids'] and len(set(review['preserved_scope_hold_ids']))==len(review['preserved_scope_hold_ids'])==36
    previous=continuity['previous_aw_ids_in_index_order'];assert len(previous)==len(set(previous))==continuity['previous_target_count']==114
    preserved=[review[k]for k in ['preserved_scope_hold_ids','preserved_pending_access_ids','preserved_pending_material_ids']]
    assert all(set(preserved[i]).isdisjoint(preserved[j])for i in range(3)for j in range(i))
    assert set(sum(preserved,[]))<=set(previous) and set(previous).isdisjoint(IDS)
    assert continuity['selected_aw_ids']==IDS and continuity['intersection_aw_ids']==[] and continuity['prior_index_duplicate_count']==0 and continuity['selected_unique_count']==3 and continuity['prior_targets_reassessed']is False
    assert continuity['previous_index_immutable_url']=='https://github.com/kimjeon-il/Pando/blob/'+PRIOR+'/reports/hydro-names/reconstruction-2026-10-09/batch-r39/reconstruction-index.json'
    d=continuity['current_batch_delta'];assert d['new_distinct_target_increment']==3 and d['reconstructed_target_count_before']==114 and d['reconstructed_target_count_after']==117 and d['initial_eligible_target_count']==4065
    assert d['remaining_fresh_reconstruction_queue_before']==3951 and d['remaining_fresh_reconstruction_queue_after']==3948 and d['remaining_queue_types_after']=={'river_group':3412,'lake':536}
    return {'status':'passed','mode':'included_public_files_only','batch':'r40','scope_aw_ids':IDS,'recorded_fragment_count':3,'recorded_polygon_part_count':3,'recorded_ring_count':3,'recorded_position_count_including_closures':165,'recorded_full_feature_correspondence_reviews_completed':3,'new_scope_hold_ids':[],'new_pending_access_ids':[],'new_pending_material_ids':[],'generalized_water_identities_supported':3,'bounded_partial_name_associations':0,'unnamed_identity_extent_holds':0,'distinct_target_increment':3,'existing_targets_reassessed':0,'recorded_cumulative_distinct_targets':117,'recorded_target_types':{'river_group':43,'lake':74},'remaining_unrecorded_targets':3948,'cumulative_scope_hold_count':36,'pending_access_count':2,'pending_material_count':1,'pending_any_count':3,'original_source_material_reopened':False,'map_judgments_reproduced':False,'omitted_full_polygons_recomputed':False,'original_decoder_replayed':False,'network_requests':0,'automatic_application':False,'limit':'Included facts and byte consistency only. Original-map and complete-polygon judgments are recorded, not replayed. Three generalized identities are supported, including the exact printed form Wunnummin Lake. Prior access and material pending remain separate and unchanged. Exact extents and product naming remain unapproved.'}


def validate_public():
    pins = json.loads((HERE / 'public-input-pins.json').read_text())
    assert pins['batch'] == 'r40' and pins['scope'] == 'included_public_files_only' and pins['automatic_application'] is False
    assert len(pins['files']) == len(GEOMETRY_FILES) and {item['path'] for item in pins['files']} == GEOMETRY_FILES
    for item in pins['files']:
        path = PUBLIC / item['path']
        assert not path.is_symlink()
        verify_bytes(path.read_bytes(), item)
    manifest = json.loads((HERE / 'review-manifest.json').read_text())
    assert manifest['batch'] == 'r40' and manifest['scope'] == 'included_public_files_only'
    assert manifest['scope_aw_ids'] == IDS and manifest['manifest_excludes_itself'] is True
    assert manifest['review_file_count_including_manifest'] == len(REVIEW_FILES) and manifest['automatic_application'] is False
    assert {path.name for path in HERE.iterdir()} == REVIEW_FILES
    assert len(manifest['files']) == len(REVIEW_FILES) - 1
    assert {item['file'] for item in manifest['files']} == REVIEW_FILES - {'review-manifest.json'}
    for item in manifest['files']:
        path = HERE / item['file']
        assert not path.is_symlink()
        verify_bytes(path.read_bytes(), item)
    records = load_records()
    result = validate_records(records)
    validation = json.loads((HERE / 'review-validation.json').read_text())
    assert timestamp(manifest['frozen_at_utc']) >= timestamp(validation['validated_at_utc']) >= timestamp(records['review']['reviewed_at_utc'])
    assert validation['validation'] == result and validation['status'] == validation['tests']['status'] == 'passed'
    assert validation['mode'] == 'included_public_files_only' and validation['tests']['network_requests'] == 0
    assert validation['tests']['original_map_or_full_polygon_or_decoder_judgments_reproduced'] is False
    return result


if __name__ == '__main__':
    print(json.dumps(validate_public(), indent=2))
