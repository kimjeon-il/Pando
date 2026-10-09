#!/usr/bin/env python3
"""Validate included river summaries and cumulative facts, without private replay."""
import collections,hashlib,json,pathlib,subprocess,sys
sys.dont_write_bytecode=True
P=pathlib.Path(__file__).resolve().parent
L=lambda p:json.loads(p.read_text());H=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
expected=['hydro-system:50517279','hydro-system:50478600','hydro-system:50464082'];part_counts=[208,112,232];position_counts=[1034,782,1544];logical=[1859,1826,1810];fids=[list(range(6789,6797)),[6740,6741],list(range(6714,6722))]
m=L(P/'manifest.json');assert m['batch']=='r19'and m['automatic_application']is False and m['full_river_coordinates_included']is False
actual={str(p.relative_to(P))for p in P.rglob('*')if p.is_file()and p.name!='manifest.json'};assert actual==set(m['files']);assert len(actual)==m['file_count_excluding_self']and sum(x['bytes']for x in m['files'].values())==m['bytes_excluding_self']
for n,v in m['files'].items():
 p=P/n;assert p.stat().st_size==v['bytes']and H(p)==v['sha256'],n
 assert p.suffix in {'.json','.md','.py'}and not pathlib.PurePosixPath(n).is_absolute()
 assert not any(x in n for x in ['__pycache__','.input-cache','local-review','local-evidence'])
 p.read_text(encoding='utf-8')
for n in actual:
 if n.endswith('.json'):
  stack=[L(P/n)]
  while stack:
   obj=stack.pop()
   if isinstance(obj,dict):
    assert not({'coordinates','coordinate_arrays','part_endpoints','private_coordinate_sha256','original_body_sha256','receipt_sha256','registration_sha256','cache_dir'}&set(obj)),n
    stack.extend(obj.values())
   elif isinstance(obj,list):stack.extend(obj)
r=L(P/'results.json');rv=L(P/r['review_file']);ref=L(P/'geometry-reference.json');groups=ref['groups'];inv=L(P/'selected-inventory-records.json')['records']
assert H(P/r['review_file'])==r['review_file_sha256']and r['batch']=='r19'
assert expected==[x['aw_id']for x in r['records']]==[x['aw_id']for x in rv['findings']]==[x['aw_id']for x in groups]==[x['aw_id']for x in inv]
assert [x['part_count']for x in groups]==part_counts and [x['position_count']for x in groups]==position_counts
assert [x['logical_fid']for x in groups]==logical and [x['geometry_fids']for x in groups]==fids
assert r['baseline_fragment_count']==sum(x['fragment_count']for x in groups)==18
assert r['river_line_part_count']==r['distinct_source_reach_count']==sum(part_counts)==552
assert r['river_rendered_coordinate_count']==sum(position_counts)==3360
assert r['part_counts_in_target_order']==part_counts and r['position_counts_in_target_order']==position_counts
assert r['fragment_part_counts_in_target_order']==[x['fragment_part_counts']for x in groups]
assert r['fragment_position_counts_in_target_order']==[x['fragment_position_counts']for x in groups]
assert r['bounded_research_attempts']==r['independently_reviewed_targets']==r['new_inventory_targets']==3
assert r['research_completed_targets']==r['independent_identity_review_completed_targets']==sum(x['full_feature_correspondence_review_completed']for x in r['records'])
assert r['source_access_limited_targets']==r['pending_source_only_targets']==sum(x['source_access_limited']for x in r['records'])
assert r['pending_full_feature_source_review_targets']==3-r['research_completed_targets']
assert r['counts']==dict(collections.Counter(x['research_category']for x in r['records']))
assert r['historical_exact_ID_lead_targets']==r['historical_name_lead_targets']==0
assert r['formal_registry_verifications']==r['whole_group_scalar_name_approvals']==r['all_reach_name_approvals']==0
assert r['immutable_reference_commit']=='fd6744f5e72a0c1a107452dbde6d416ab57237db'
assert r['original_hydrorivers_coordinate_equality_verified']is False and r['current_live_deployment_checked']is False
assert r['historical504_detailed_ledger_restored']is False and r['historical_504_is_not_added_to_reconstruction_counts']is True
assert r['automatic_application']is False and r['product_changes']is False
scope_fields=['candidate_name_role','directly_supported_name_forms','observed_name_forms','constituent_list_exhaustive','exact_name_partition_established','named_water_associations','named_tributary_associations','unassigned_region','follow_up_scope','representative_name_only','reach_name_limits']
for i,(a,b,g)in enumerate(zip(r['records'],rv['findings'],groups)):
 assert all(a[k]==b[k]for k in ['aw_id','candidate_name','research_category','supported_name_scope','source_keys','limits','source_access_limited','full_feature_correspondence_review_completed','follow_up_required'])
 assert a['independent_review_status']==b.get('review_status',b['research_category'])
 assert a['naming_scope_details']=={k:b[k]for k in scope_fields if k in b}
 assert a['category']=='river_group'and a['system_id']==expected[i].split(':')[1]
 assert a['baseline_logical_fid']==logical[i]and a['geometry_fids']==fids[i]
 assert a['korean_name']is None and a['whole_group_scalar_name']is None
 assert all(a[k]is False for k in ['all_reach_names_verified','formal_registry_verified','automatic_application','product_application','historical_verified_ID_restored'])
 assert a['selection_origin']=='new_inventory_investigation'
 assert all(isinstance(a[k],bool)for k in ['source_access_limited','full_feature_correspondence_review_completed','follow_up_required'])
 if a['source_access_limited']:assert not a['full_feature_correspondence_review_completed']and a['follow_up_required']
rights=L(P/'source-publication-rights.json');assert rights['full_river_coordinates_published']is False and rights['selected_lake_geometry_count']==0 and rights['raw_third_party_sources_published']is False and rights['raw_pdf_html_map_crop_count']==0 and rights['private_source_derivative_registration_receipt_cache_fingerprints_included']is False
idx=L(P/'reconstruction-index.json');assert len(idx['records'])==len({x['aw_id']for x in idx['records']})==idx['recorded_index_targets']==idx['total_distinct_reconstructed_targets']==57
assert idx['previous_batch_distinct_targets']==54 and idx['current_batch_increment']==3 and idx['duplicate_targets']==0
assert idx['current_batch']=='r19'and idx['target_types']=={'lake':38,'river_group':19}
assert idx['categories']==dict(collections.Counter(x['research_category']for x in idx['records']))
assert idx['prior_commit']==r['previous_reconstruction_commit']=='6badfae989089b3d54cd5ced22302ff125c61d14'
assert idx['previous_index_sha256']=='b6b1b7497cfc0a917a500cb08955238666fa64ab351d3c0afaaeab2b64a00500'
assert [x['fixed_commit']for x in idx['records']if x['batch']=='r18']==[idx['prior_commit']]*3
assert {x['aw_id']for x in idx['records']if x['batch']=='r19'}==set(expected)
for e in idx['records']:
 if e['batch']=='r19':
  a=next(x for x in r['records']if x['aw_id']==e['aw_id']);assert all(e[k]==a[k]for k in ['category','system_id','candidate_name','research_category','supported_name_scope','source_access_limited','full_feature_correspondence_review_completed','follow_up_required','naming_scope_details'])
pending=[x['aw_id']for x in idx['records']if x.get('source_access_limited')is True];holds=[x['aw_id']for x in idx['records']if x['research_category']in {'whole_polygon_scope_hold','supported_reservoir_association_geometry_hold','candidate_waterbody_identity_extent_hold','compound_feature_name_scope_hold'}and x['aw_id']not in pending]
assert idx['pending_access_ids']==pending and idx['pending_access_count']==len(pending)and {'lakes_base:1159112821','lakes_base:1159108815'}<=set(pending)
assert idx['scope_hold_ids']==holds and idx['scope_hold_count']==len(holds)
assert idx['complete_identity_review_claimed_for_all_records']is False
assert idx['current_batch_completed_source_scope_assessments']==r['research_completed_targets']and idx['current_batch_source_limited_follow_up_ids']==[x['aw_id']for x in r['records']if x['source_access_limited']]
for note in idx.get('scope_continuity_enrichments',[]):
 assert note['field']=='supported_name_scope';e=next(x for x in idx['records']if x['aw_id']==note['aw_id']);assert e[note['field']]==note['value']
 assert len(note['source_sha256'])==64 and len(note['source_commit'])==40
 assert note['source_url']=='https://github.com/kimjeon-il/Pando/blob/'+note['source_commit']+'/'+note['source_repository_path']
q=idx['remaining_queue_recovery'];assert q['initial_inventory']['sha256']=='5d1e12b1a6daa695419173dea491ff0c8c5583ed9e28ba517ba4a599bcd589db'and q['initial_inventory']['git_blob_sha']=='55a1de2ae76f09bce5e624d96ad17f7531aa3fd8'
assert q['initial_inventory']['immutable_commit']=='8213678cbfd74ecd930657eaa911f6e87ab6d2b8'and q['initial_inventory']['repository_path']=='reports/hydro-names/current-web-2026-10-08/inventory.csv.gz'
assert q['initial_inventory']['rows']==5173 and q['initial_inventory']['bytes']==441711
assert q['eligible_filter']=='classification != named_display'and q['eligible_universe_count']==4065 and q['eligible_universe_by_type']=={'river_group':3455,'lake':610}
assert q['reviewed_index_targets']==57 and q['remaining_without_reconstructed_record']==4065-57==4008 and q['remaining_without_reconstructed_record_by_type']=={'river_group':3436,'lake':572}
assert q['historical_never_reviewed_count_claimed']is False and q['all_reviewed_ids_in_eligible_universe']is True
assert q['rebuild_script']=='recover-remaining-queue.py'and q['queue_order']=='original_inventory_row_order'
for script in ['validate-geometry-reference.py','review/validate-independent-review.py']:
 out=subprocess.run([sys.executable,'-B',str(P/script)],cwd=P,capture_output=True,text=True);assert out.returncode==0,(script,out.stdout,out.stderr);assert json.loads(out.stdout)['status']=='passed'
print(json.dumps({'result':'PASS','batch':'r19','files_verified':len(actual),'published_input_bytes':m['bytes_excluding_self'],'counts':r['counts'],'research_completed':r['research_completed_targets'],'bounded_attempts':3,'independently_reviewed_verdicts':3,'source_access_limited_targets':r['source_access_limited_targets'],'cumulative_pending_access_targets':len(pending),'baseline_fragments_in_summaries':18,'line_parts_in_summaries':552,'positions_in_summaries':3360,'full_river_coordinates_included':False,'omitted_full_geometry_or_original_sources_replayed':False,'distinct_reconstruction_targets':57,'remaining_without_reconstructed_record':4008,'manifest_sha256':H(P/'manifest.json'),'raw_documents_published':False,'historical504_ledger_restored':False,'remote_save_verified_by_this_script':False,'network_calls':0,'automatic_application':False}))
