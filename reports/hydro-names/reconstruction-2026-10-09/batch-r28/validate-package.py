#!/usr/bin/env python3
"""Validate included reassessment package; never replay omitted original source/path inputs."""
import collections,hashlib,json,subprocess,sys
from pathlib import Path
sys.dont_write_bytecode=True
P=Path(__file__).resolve().parent;L=lambda p:json.loads(p.read_text());H=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
IDS=['hydro-system:50691388','hydro-system:50738894'];PRIOR='8ff940cb87682f11c61aac2370b50a0db1a584ab'
m=L(P/'manifest.json');actual={str(p.relative_to(P))for p in P.rglob('*')if p.is_file()and p.name!='manifest.json'}
assert m['batch']=='r28'and m['automatic_application']is False and m['product_changes']is False and m['full_river_coordinates_included']is False
assert actual==set(m['files'])and len(actual)==m['file_count_excluding_self']==26 and sum(x['bytes']for x in m['files'].values())==m['bytes_excluding_self']
for n,pin in m['files'].items():
 p=P/n;assert not p.is_symlink()and p.suffix in {'.json','.md','.py'}and p.stat().st_size==pin['bytes']and H(p)==pin['sha256']
 assert not any(x in n for x in ['__pycache__','.input-cache','local-review','local-evidence']);p.read_text()
for n in actual:
 if n.endswith('.json'):
  stack=[L(P/n)]
  while stack:
   o=stack.pop()
   if isinstance(o,dict):assert not({'coordinates','coordinate_arrays','part_endpoints','original_body_sha256','private_coordinate_sha256','receipt_sha256','registration_sha256','cache_dir'}&set(o));stack.extend(o.values())
   elif isinstance(o,list):stack.extend(o)
r=L(P/'results.json');rv=L(P/r['review_file']);geom=L(P/'geometry-reference.json');idx=L(P/'reconstruction-index.json')
assert H(P/r['review_file'])==r['review_file_sha256']and r['batch']==idx['current_batch']=='r28'
assert [x['aw_id']for x in r['records']]==[x['aw_id']for x in rv['findings']]==geom['scope_aw_ids']==IDS
assert r['bounded_research_attempts']==r['independently_reviewed_targets']==r['existing_inventory_reassessment_targets']==r['research_completed_targets']==2
assert r['new_inventory_targets']==r['distinct_target_increment']==r['source_access_limited_targets']==0
assert r['baseline_fragment_count']==2 and r['river_line_part_count']==r['distinct_source_reach_count']==59 and r['river_rendered_coordinate_count']==450
assert r['part_counts_in_target_order']==[30,29]and r['position_counts_in_target_order']==[258,192]
assert r['counts']==dict(collections.Counter(x['research_category']for x in r['records']))
assert r['immutable_reference_commit']=='fd6744f5e72a0c1a107452dbde6d416ab57237db'and r['previous_reconstruction_commit']==idx['prior_commit']==PRIOR
for k in ['current_live_deployment_checked','original_hydrorivers_coordinate_equality_verified','historical504_detailed_ledger_restored','automatic_application','product_changes']:assert r[k]is False
assert r['historical_504_is_not_added_to_reconstruction_counts']is True
for k in ['formal_registry_verifications','whole_group_scalar_name_approvals','all_reach_name_approvals']:assert r[k]==0
assert len(idx['records'])==len({x['aw_id']for x in idx['records']})==idx['recorded_index_targets']==idx['total_distinct_reconstructed_targets']==idx['previous_batch_distinct_targets']==81
assert idx['current_batch_increment']==0 and idx['current_batch_reassessed_existing_targets']==2 and idx['current_batch_reassessed_ids']==IDS and idx['current_batch_new_distinct_ids']==[]and idx['duplicate_targets']==0
assert idx['target_types']=={'lake':38,'river_group':43}and idx['categories']==dict(collections.Counter(x['research_category']for x in idx['records']))
assert {e['aw_id']for e in idx['records']if e['batch']=='r28'}==set(IDS)
assert [e['fixed_commit']for e in idx['records']if e['batch']=='r27']==[PRIOR]*3
by={e['aw_id']:e for e in idx['records']}
for a,f in zip(r['records'],rv['findings']):
 e=by[a['aw_id']];old=a['prior_public_assessment'];assert old['aw_id']==a['aw_id']and old['research_category']=='river_group_name_scope_hold'
 assert e['assessment_history'][-1]==old and e['first_reconstruction_batch']==old.get('first_reconstruction_batch',old['batch'])
 assert old['fixed_commit']is not None and len(old['fixed_commit'])==40 and old['evidence_locator'].endswith('/batch-'+old['batch']+'/results.json')
 for k in ['candidate_name','research_category','supported_name_scope','source_access_limited','full_feature_correspondence_review_completed','follow_up_required']:assert a[k]==f[k]==e[k]
 assert a['source_keys']==f['source_keys']and a['limits']==f['limits']and e['naming_scope_details']==a['naming_scope_details']
 assert a['selection_origin']==e['selection_origin']=='existing_inventory_scope_hold_reassessment'and a['distinct_target_increment']==0
 assert a['korean_name']is None and a['whole_group_scalar_name']is None
 for k in ['all_reach_names_verified','formal_registry_verified','automatic_application','product_application','historical_verified_ID_restored']:assert a[k]is False
 assert e['automatic_application']is False
pending=[e['aw_id']for e in idx['records']if e.get('source_access_limited')is True]
holds=[e['aw_id']for e in idx['records']if e['research_category']in {'whole_polygon_scope_hold','supported_reservoir_association_geometry_hold','candidate_waterbody_identity_extent_hold','compound_feature_name_scope_hold','river_group_name_scope_hold'}and e['aw_id']not in pending]
assert idx['pending_access_ids']==pending==['lakes_base:1159112821','lakes_base:1159108815']and idx['pending_access_count']==2
assert idx['scope_hold_ids']==holds and idx['scope_hold_count']==len(holds)and idx['complete_identity_review_claimed_for_all_records']is False
assert idx['current_batch_completed_source_scope_assessments']==2 and idx['current_batch_source_limited_follow_up_ids']==[]
q=idx['remaining_queue_recovery'];assert q['eligible_universe_count']==4065 and q['eligible_universe_by_type']=={'river_group':3455,'lake':610}
assert q['reviewed_index_targets']==81 and q['remaining_without_reconstructed_record']==3984 and q['remaining_without_reconstructed_record_by_type']=={'river_group':3412,'lake':572}
assert q['initial_inventory']['sha256']=='5d1e12b1a6daa695419173dea491ff0c8c5583ed9e28ba517ba4a599bcd589db'and q['historical_never_reviewed_count_claimed']is False
rights=L(P/'source-publication-rights.json')
for k in ['full_river_coordinates_published','raw_third_party_sources_published','private_source_derivative_registration_receipt_cache_fingerprints_included','automatic_application']:assert rights[k]is False
assert rights['selected_lake_geometry_count']==rights['raw_pdf_html_map_crop_count']==0
for script in ['validate-geometry-reference.py','review/validate-independent-review.py']:
 out=subprocess.run([sys.executable,'-B',str(P/script)],cwd=P,capture_output=True,text=True);assert out.returncode==0,(script,out.stdout,out.stderr);assert json.loads(out.stdout)['status']=='passed'
print(json.dumps({'result':'PASS','batch':'r28','files_verified':len(actual),'counts':r['counts'],'existing_targets_reassessed':2,'new_distinct_targets':0,'distinct_reconstruction_targets':81,'scope_holds':len(holds),'source_access_pending':2,'remaining_without_reconstructed_record':3984,'full_river_coordinates_included':False,'omitted_full_geometry_or_original_sources_replayed':False,'earlier_selected_assessments_preserved':True,'manifest_sha256':H(P/'manifest.json'),'remote_save_verified_by_this_script':False,'network_calls':0,'automatic_application':False}))
