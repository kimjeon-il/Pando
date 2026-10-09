#!/usr/bin/env python3
"""Validate included public r12 facts and selected geometry; no source replay."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
sys.dont_write_bytecode = True
SOURCE_IDS = ['1159108391', '1159112839', '1159112207']
AWIDS = ['lakes_base:' + x for x in SOURCE_IDS]
FIDS = [15334, 15650, 15604]
LOGICAL_FIDS = [3959, 4275, 4229]
COUNTS = [81, 45, 151]
NAMES = ['Montreal Lake', 'Wapawekka Lake', 'Mirond Lake']
CATEGORIES = ['supported_generalized_water_identity'] * 2 + ['compound_feature_name_scope_hold']
COLD = 'lakes_base:1159112821'
WSA_URL = 'https://wsask.ca/wp-content/uploads/2025/05/WSA_Completed_Planning_Areas_22x34-1.pdf'
ECCC_URL = 'https://wateroffice.ec.gc.ca/station_metadata/station_index_e.html?stationLike=D&type=stationName'
GEOMETRY_FILES = ['selected-lake-geometries.geojson', 'selected-baseline-rendered-geometries.geojson']
GROUPS = {'montreal-wapawekka': AWIDS[:2], 'mirond': AWIDS[2:]}
RESEARCH_NAMES = ['README.md', 'findings.json', 'source-evidence.json', 'target-identity-facts.json']
REVIEW_NAMES = ['README.md', 'public-input-pins.json', 'independent-review.json', 'review-validation.json', 'source-observations.json', 'test-independent-review.py', 'validate-independent-review.py']


def require(condition, message):
    if not condition: raise ValueError(message)


def read(root, rel):
    return json.loads((root / rel).read_text())


def checked(root, rel, pin):
    path = root / rel
    require(not path.is_symlink() and path.is_file(), 'Included regular file required: ' + rel)
    require(path.resolve().is_relative_to(root.resolve()), 'Input escapes included package')
    data = path.read_bytes()
    require(hashlib.sha256(data).hexdigest() == pin['sha256'] and len(data) == pin['bytes'], 'Included file integrity: ' + rel)


def research_paths():
    return [f'research/{group}/{name}' for group in GROUPS for name in RESEARCH_NAMES + (['map-scope-review.json'] if group == 'mirond' else []) + ['research-manifest.json']]


def check_manifest(root, folder, manifest, expected, key):
    doc = read(root, folder + '/' + manifest)
    entries = doc['files']
    require(len(entries) == len(expected) and {x[key] for x in entries} == set(expected), 'Manifest included file set: ' + folder)
    for row in entries: checked(root, folder + '/' + row[key], row)
    require(doc['automatic_application'] is False, 'Manifest application disabled')


def check_integrity(root):
    pins = read(root, 'review/public-input-pins.json')
    require(pins['scope'] == 'included_public_files_only', 'Public input scope')
    expected = GEOMETRY_FILES + research_paths()
    require(len(pins['files']) == len(expected) and {r['path'] for r in pins['files']} == set(expected), 'Only complete included input files may be pinned')
    for row in pins['files']: checked(root, row['path'], row)
    for group in GROUPS:
        names = RESEARCH_NAMES + (['map-scope-review.json'] if group == 'mirond' else [])
        check_manifest(root, 'research/' + group, 'research-manifest.json', names, 'path')
    check_manifest(root, 'review', 'review-manifest.json', REVIEW_NAMES, 'file')
    return len(expected)


def ring(geometry, count):
    require(geometry['type'] == 'Polygon' and len(geometry['coordinates']) == 1, 'Complete one-ring polygon')
    points = geometry['coordinates'][0]
    require(len(points) == count and points[0] == points[-1], 'Full ring position count and closure')
    require(all(len(p) == 2 and all(isinstance(n, (int, float)) and math.isfinite(n) for n in p) and -180 <= p[0] <= 180 and -90 <= p[1] <= 90 for p in points), 'Finite longitude/latitude positions')
    return points


def bbox(points):
    return [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points), max(p[1] for p in points)]


def check_geometry(root):
    source = read(root, GEOMETRY_FILES[0])['features']
    baseline = read(root, GEOMETRY_FILES[1])['features']
    require(len(source) == len(baseline) == 3, 'All three complete selected features')
    checks = []
    for i, (s, b) in enumerate(zip(source, baseline)):
        require(s['id'] == AWIDS[i] and b['id'] == FIDS[i], 'Distinct feature-ID domains and fixed order')
        require(str(s['properties']['source_id']) == SOURCE_IDS[i] and s['properties']['pandolab_id'] == AWIDS[i], 'Selected source identity')
        require(all(s['properties'][k] == '' for k in ('name_ko','name_en','name_original')), 'Unfilled source name forms')
        bp = b['properties']
        require((bp['sourceId'],bp['awId'],bp['fid'],bp['logicalFid']) == (SOURCE_IDS[i],AWIDS[i],FIDS[i],LOGICAL_FIDS[i]), 'Selected baseline identity')
        a, z = ring(s['geometry'],COUNTS[i]), ring(b['geometry'],COUNTS[i])
        require([[round(n,6) for n in p] for p in a] == z, 'Every ordered source/baseline position at six decimals')
        require(bp['bounds'] == [round(x*1000000) for x in bbox(z)], 'Baseline bounding box metadata')
        checks.append({'aw_id':AWIDS[i],'source_id':SOURCE_IDS[i],'geometry_fid':FIDS[i],'logical_fid':LOGICAL_FIDS[i],'position_count':COUNTS[i],'every_ordered_position_checked':True,'all_quantized_coordinates_match':True,'source_bbox':bbox(a),'baseline_bbox':bbox(z),'maximum_coordinate_rounding_error_degrees':max(abs(x-y) for p,q in zip(a,z) for x,y in zip(p,q))})
    return checks


def check_verdict(review):
    require(review['scope_aw_ids'] == AWIDS and [x['aw_id'] for x in review['findings']] == AWIDS, 'Review complete target order')
    require((review['prior_distinct_targets'],review['current_batch_increment'],review['cumulative_distinct_targets'],review['duplicate_targets']) == (33,3,36,0), 'Recorded fresh-review count arithmetic')
    require(all(review[k] is False for k in ('current_live_deployment_checked','historical_verdicts_restored','geometry_modified','automatic_application','pending_access_reassessment_performed')), 'No application, history restoration or prior reassessment')
    require(review['scalar_product_name_approvals'] == 0 and review['current_batch_full_feature_correspondence_reviews_completed'] == 3 and review['current_batch_source_limited_targets'] == 0, 'Recorded completion/access/application totals')
    require(review['preserved_pending_access_ids'] == [COLD] and review['new_scope_hold_ids'] == AWIDS[2:], 'Carried-forward Cold gap and current compound hold')
    h = review['historical_review']
    require(h['full_source_review_completed'] is True and h['original_source_material_included'] is False and h['historical_results_recomputed_by_public_validator'] is False, 'Historical assessment distinct from current public validation')
    require(h['performed_at_utc'] == review['reviewed_at_utc'], 'Historical review date')
    for i, f in enumerate(review['findings']):
        require((f['source_id'],f['logical_fid'],f['geometry_fids'],f['position_count'],f['polygon_count'],f['ring_count']) == (SOURCE_IDS[i],LOGICAL_FIDS[i],[FIDS[i]],COUNTS[i],1,1), 'Review geometry facts and identity join')
        require((f['candidate_name'],f['research_category'],f['source_research_category']) == (NAMES[i],CATEGORIES[i],CATEGORIES[i]), 'Recorded finding category')
        require(f['source_access_limited'] is False and f['full_feature_correspondence_review_completed'] is True and f['follow_up_required'] is (i == 2), 'Recorded completion/access/follow-up flags')
        require(f['compound_named_waterbody_required_by_evidence'] is (i == 2), 'Compound scope classification')
        require(all(f[k] is False for k in ('automatic_application','scalar_product_name_approved','whole_polygon_name_application_cleared','formal_registry_verified','exact_shoreline_verified','label_overlap_alone_used_as_identity')), 'Research gates remain closed')
        require(all(f[k] is None for k in ('whole_feature_scalar_name','scalar_product_name','name_ko','name_en','name_original')), 'No scalar or language-form promotion')
        require(f['actual_named_water_shapes_compared'] is True and f['source_and_rendered_ordered_coordinates_verified'] is True, 'Recorded whole-feature review scope')
    third = review['findings'][2]
    require(third['directly_supported_name_forms'] == ['Wood Lake','Mirond Lake'], 'Two supported regional names')
    require(all(third[k] is False for k in ('constituent_list_exhaustive','exact_name_partition_established','settlement_label_promoted_to_water_name')), 'Compound scope limits')
    require([x['name'] for x in third['named_water_associations']] == ['Wood Lake','Mirond Lake'] and all(x['whole_named_water_coverage_verified'] is False for x in third['named_water_associations']), 'Regional water associations only')


def check_research(root, review, geometry):
    records = []
    source_keys = ['wsa_montreal_wapawekka_map', 'wsa_wood_mirond_map']
    source_fields = {'source_key','publisher','title','publication_date','kind','independence_group','url','retrieved_at_utc','retrieved_this_batch','original_map_visually_inspected','page','scale','publication_date_note','inspection_scope','short_labels','source_limit'}
    for j, (group, ids) in enumerate(GROUPS.items()):
        prefix = 'research/' + group + '/'
        findings = read(root, prefix+'findings.json')
        require([f['aw_id'] for f in findings['records']] == ids, 'Research group identity order')
        require((findings['target_count'],findings['new_actual_inventory_targets'],findings['full_feature_correspondence_review_completed_count'],findings['source_limited_unresolved_count']) == (len(ids),len(ids),len(ids),0), 'Research completion/access counts')
        require(findings['automatic_application'] is False, 'Research application disabled')
        require(findings['compound_named_waterbody_required_by_evidence'] is (group == 'mirond'), 'Research group scope')
        evidence = read(root, prefix+'source-evidence.json')
        require(len(evidence['sources']) == evidence['independent_source_count'] == 1, 'One naming publication')
        require(evidence['new_external_request_count'] == 0 and evidence['automatic_application'] is False, 'No new acquisition or application')
        s = evidence['sources'][0]
        require(set(s) == source_fields, 'Bibliographic source field scope')
        require(s['source_key'] == source_keys[j] and s['url'] == WSA_URL and s['publication_date'] == '2014-11-25' and s['retrieved_at_utc'] == '2026-10-09T13:17:20.296694+00:00', 'Official bibliographic identity and original dates')
        require(s['retrieved_this_batch'] is False and s['original_map_visually_inspected'] is True and s['page'] == 1 and s['scale'] == '1:1,750,000 at 22 × 34 inches', 'Recorded source scope and scale')
        for f in findings['records']:
            i = AWIDS.index(f['aw_id']); r = review['findings'][i]
            require(f['source_id'] == SOURCE_IDS[i] and f['candidate_name'] == NAMES[i], 'Research candidate join')
            for field in ('research_category','source_access_limited','full_feature_correspondence_review_completed','follow_up_required','compound_named_waterbody_required_by_evidence'):
                require(f[field] == r[field], 'Review/research factual correspondence: '+field)
            require(f['source_keys'] == r['source_keys'] == [source_keys[j]], 'Research source attribution')
            require(f['directly_supported_name_forms'] == ([NAMES[i]] if i < 2 else ['Wood Lake','Mirond Lake']), 'Research supported labels')
            require(all(f[k] is False for k in ('automatic_application','product_application','formal_registry_verified','exact_shoreline_verified')), 'Research limit gates')
            require(f['korean_name'] is None and f['whole_feature_scalar_name'] is None, 'Research scalar and Korean names unset')
            if i == 2:
                require(f['constituent_list_exhaustive'] is False and f['exact_name_partition_established'] is False, 'Research compound limits')
                require([a['name'] for a in f['named_water_associations']] == ['Wood Lake','Mirond Lake'] and all(a['whole_named_water_coverage_verified'] is False for a in f['named_water_associations']), 'Research regional association scope')
            records.append(f)
        facts = read(root, prefix+'target-identity-facts.json')
        require(facts['included_geometry_files'] == GEOMETRY_FILES, 'Facts reference included geometry')
        if group == 'montreal-wapawekka':
            require([t['aw_id'] for t in facts['targets']] == ids, 'Identity-facts order')
            for i,t in enumerate(facts['targets']):
                g=geometry[i]
                require((t['source_id'],t['logical_fid'],t['baseline_fids'],t['source_geometry_type'],t['source_ring_count'],t['source_positions_including_closure']) == (SOURCE_IDS[i],LOGICAL_FIDS[i],[FIDS[i]],'Polygon',1,COUNTS[i]), 'Identity-facts geometry join')
                require(t['source_bbox'] == g['source_bbox'] and t['inventory_bbox'] == g['baseline_bbox'], 'Identity-facts full geometry bounds')
                require(t['maximum_coordinate_rounding_error_degrees'] == g['maximum_coordinate_rounding_error_degrees'] and t['complete_ordered_source_baseline_match_at_six_decimals'] is True and t['geometry_modified'] is False, 'Identity-facts ordered precision')
        else:
            require((facts['aw_id'],facts['source_id'],facts['baseline_fid'],facts['baseline_logical_fid']) == (AWIDS[2],SOURCE_IDS[2],FIDS[2],LOGICAL_FIDS[2]), 'Compound identity join')
            for key,bounds in (('source_geometry','source_bbox'),('baseline_rendered_geometry','baseline_bbox')):
                g=facts[key]
                require((g['type'],g['polygon_part_count'],g['ring_counts_by_part'],g['coordinate_counts_by_part_and_ring'],g['total_coordinates_including_closure']) == ('Polygon',1,[1],[[151]],151), 'Compound complete geometry facts')
                require(g['bbox'] == geometry[2][bounds] and g['all_rings_closed'] is True, 'Compound complete bounds and closure')
            comparison=facts['source_to_baseline_comparison']
            require(all(comparison[k] is True for k in ('same_geometry_type','same_part_ring_and_vertex_order','every_coordinate_matches_source_rounded_to_6_decimals')), 'Compound full ordered geometry agreement')
    require([r['aw_id'] for r in records] == AWIDS, 'All research targets reviewed')
    m=read(root,'research/mirond/map-scope-review.json')
    require(m['aw_id'] == AWIDS[2] and m['whole_source_geometry_reviewed'] is True and m['whole_baseline_geometry_checked'] is True, 'Recorded map review target scope')
    require(m['coordinate_positions_including_closure'] == 151 and m['ring_count'] == 1 and m['source_bbox'] == geometry[2]['source_bbox'] and m['baseline_bbox'] == geometry[2]['baseline_bbox'], 'Map scope complete-geometry facts')
    require([x['supported_water_label'] for x in m['region_checks']] == ['Wood Lake','Mirond Lake',None,None] and all(x['exact_partition_established'] is False for x in m['region_checks']), 'Map regional observations and limits')
    require(m['map_pixels_or_derived_map_vectors_published'] is False, 'Included map scope')


def check_observations(root):
    o=read(root,'review/source-observations.json')
    require(o['scope_aw_ids'] == AWIDS and o['new_external_requests'] == 0 and o['naming_publications'] == 1, 'Historical observation scope')
    require(o['shoreline_overlap_measured'] is False and o['survey_registration_verified'] is False, 'No survey or quantitative shoreline claim')
    require(len(o['observations']) == 2, 'One naming publication and one unused index observation')
    a,b=o['observations']
    require(a['source_key'] == 'wsa_map' and a['url'] == WSA_URL and a['printed_date'] == '2014-11-25' and a['scale_denominator'] == 1750000 and a['counted_as_naming_source'] is True and a['retrieved_this_batch'] is False, 'Naming observation bibliographic facts')
    require(b['source_key'] == 'unused_eccc_d_index' and b['url'] == ECCC_URL and b['counted_as_naming_source'] is False and b['target_names_present'] == [] and b['retrieved_this_batch'] is False, 'Unused station index is not corroboration')
    require([x['aw_id'] for x in o['complete_geometry_observations']] == AWIDS and [x['position_count'] for x in o['complete_geometry_observations']] == COUNTS, 'Complete geometry observation joins')
    require(all(x['entire_source_and_baseline_geometry_viewed'] is True and x['official_whole_waterbody_map_correspondence_review_completed'] is True for x in o['complete_geometry_observations']), 'Historical whole-feature completion')


def validate_content(root):
    geometry=check_geometry(root)
    review=read(root,'review/independent-review.json')
    check_verdict(review)
    check_research(root,review,geometry)
    check_observations(root)
    return {'status':'passed','mode':'included_public_files_only','scope_aw_ids':AWIDS,'lake_geometry_checks':geometry,'included_ordered_position_count':sum(COUNTS),'recorded_historical_full_feature_reviews_completed':3,'current_source_limited_targets':0,'current_scope_hold_ids':AWIDS[2:],'current_follow_up_ids':AWIDS[2:],'preserved_pending_access_ids':[COLD],'recorded_prior_target_count':33,'current_batch_increment':3,'recorded_cumulative_distinct_targets':36,'naming_publications':1,'original_source_material_reopened':False,'map_judgments_reproduced':False,'private_source_replay_supported':False,'omitted_inventory_or_prior_index_reopened':False,'prior_target_source_or_geometry_reaudit_performed':False,'formal_registry_verified':False,'automatic_application':False,'network_requests':0,'limit':'Integrity and internal factual consistency of included public evidence only. Historical source interpretations, omitted original inputs and map visual judgments are not independently reproduced.'}


def validate(root):
    root=Path(root)
    count=check_integrity(root)
    result=validate_content(root)
    result['public_input_files_checked']=count
    result['included_component_manifests_checked']=3
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',type=Path,default=Path(__file__).resolve().parent.parent,help='Root of the included public package')
    args=parser.parse_args()
    try: result=validate(args.directory)
    except (ValueError,KeyError,TypeError,IndexError,OSError) as exc:
        print(json.dumps({'status':'failed','mode':'included_public_files_only','error':str(exc)},indent=2));return 1
    print(json.dumps(result,indent=2));return 0

if __name__ == '__main__': sys.exit(main())
