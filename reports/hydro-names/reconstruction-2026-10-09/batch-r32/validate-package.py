#!/usr/bin/env python3
"""Check included public facts and files; do not replay omitted source maps or polygons."""
import collections,hashlib,json,subprocess,sys
from pathlib import Path
sys.dont_write_bytecode=True
P=Path(__file__).resolve().parent;L=lambda p:json.loads(p.read_text());H=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
IDS=['lakes_base:1159107927','lakes_base:1159110635','lakes_base:1159107889'];PRIOR='fa2211478a6f1d0d05128faada49a6a28491519e'
m=L(P/'manifest.json');actual={str(p.relative_to(P))for p in P.rglob('*')if p.is_file()and p.name!='manifest.json'}
assert m['batch']=='r32'and m['automatic_application']is False and m['product_changes']is False and m['selected_public_domain_lake_features']==0
assert actual==set(m['files'])and len(actual)==m['file_count_excluding_self']and sum(v['bytes']for v in m['files'].values())==m['bytes_excluding_self']
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
r=L(P/'results.json');rv=L(P/r['review_file']);g=L(P/'geometry-reference.json');idx=L(P/'reconstruction-index.json')
assert H(P/r['review_file'])==r['review_file_sha256']and r['batch']==idx['current_batch']=='r32'
assert [x['aw_id']for x in r['records']]==[x['aw_id']for x in rv['findings']]==g['scope_aw_ids']==IDS
assert r['bounded_research_attempts']==r['independently_reviewed_targets']==r['research_completed_targets']==r['new_inventory_targets']==r['distinct_target_increment']==r['lake_feature_count']==r['baseline_fragment_count']==3
assert r['existing_inventory_reassessment_targets']==r['source_access_limited_targets']==0
assert r['lake_source_coordinate_count_including_closures']==r['lake_baseline_coordinate_count_including_closures']==140 and r['position_counts_in_target_order']==[84,31,25]
assert r['polygon_counts_in_target_order']==r['ring_counts_in_target_order']==[1,1,1]
assert r['counts']==dict(collections.Counter(x['research_category']for x in r['records']))=={'supported_generalized_water_identity':3}
assert r['immutable_reference_commit']=='fd6744f5e72a0c1a107452dbde6d416ab57237db'and r['previous_reconstruction_commit']==idx['prior_commit']==PRIOR
for k in ['current_live_deployment_checked','latest_live_packed_data_correspondence_verified','historical504_detailed_ledger_restored','automatic_application','product_changes']:assert r[k]is False
assert r['historical_504_is_not_added_to_reconstruction_counts']is True and r['formal_registry_verifications']==r['whole_feature_scalar_name_approvals']==0
assert len(idx['records'])==len({x['aw_id']for x in idx['records']})==idx['recorded_index_targets']==idx['total_distinct_reconstructed_targets']==93
assert idx['previous_batch_distinct_targets']==90 and idx['current_batch_increment']==3 and idx['current_batch_reassessed_existing_targets']==0 and idx['current_batch_reassessed_ids']==[]and idx['current_batch_new_distinct_ids']==IDS and idx['duplicate_targets']==0
assert idx['target_types']=={'lake':50,'river_group':43}and idx['categories']==dict(collections.Counter(x['research_category']for x in idx['records']))
assert [e['aw_id']for e in idx['records']if e['batch']=='r32']==IDS and [e['fixed_commit']for e in idx['records']if e['batch']=='r31']==[PRIOR]*3
by={e['aw_id']:e for e in idx['records']}
for a,f in zip(r['records'],rv['findings']):
 e=by[a['aw_id']]
 for k in ['candidate_name','research_category','supported_name_scope','source_access_limited','full_feature_correspondence_review_completed','follow_up_required']:assert a[k]==f[k]==e[k]
 assert a['source_keys']==f['source_keys']and a['limits']==f['limits']and e['naming_scope_details']==a['naming_scope_details']
 assert a['candidate_names']==f['candidate_names']==e['candidate_names'] and a['naming_scope_details']['geographic_disambiguation']==f['geographic_disambiguation']
 for k in f['naming_scope_details']:assert a['naming_scope_details'][k]==f['naming_scope_details'][k]
 assert a['selection_origin']==e['selection_origin']=='new_inventory_investigation'
 assert a['category']=='lake'and a['source_id']==a['aw_id'].split(':')[1]and a['korean_name']is None and a['whole_feature_scalar_name']is None
 for k in ['formal_registry_verified','automatic_application','product_application','historical_verified_ID_restored']:assert a[k]is False
 assert e['automatic_application']is False and e['fixed_commit']is None
pending=[e['aw_id']for e in idx['records']if e.get('source_access_limited')is True]
holds=[e['aw_id']for e in idx['records']if e['research_category']in {'whole_polygon_scope_hold','supported_reservoir_association_geometry_hold','candidate_waterbody_identity_extent_hold','compound_feature_name_scope_hold','river_group_name_scope_hold'}and e['aw_id']not in pending]
assert idx['pending_access_ids']==pending==['lakes_base:1159112821','lakes_base:1159108815']and idx['pending_access_count']==2
assert idx['scope_hold_ids']==holds and idx['scope_hold_count']==len(holds)==26 and idx['complete_identity_review_claimed_for_all_records']is False
assert idx['current_batch_completed_source_scope_assessments']==3 and idx['current_batch_source_limited_follow_up_ids']==[]
q=idx['remaining_queue_recovery'];assert q['eligible_universe_count']==4065 and q['eligible_universe_by_type']=={'river_group':3455,'lake':610}
assert q['reviewed_index_targets']==93 and q['remaining_without_reconstructed_record']==3972 and q['remaining_without_reconstructed_record_by_type']=={'river_group':3412,'lake':560}
assert q['initial_inventory']['sha256']=='5d1e12b1a6daa695419173dea491ff0c8c5583ed9e28ba517ba4a599bcd589db'and q['historical_never_reviewed_count_claimed']is False
rights=L(P/'source-publication-rights.json')
assert rights['batch']=='r32'and rights['selected_lake_feature_count']==3 and rights['raw_pdf_html_map_crop_count']==0
for k in ['full_lake_coordinates_published','full_river_coordinates_published','raw_third_party_sources_published','private_source_derivative_coordinate_registration_receipt_cache_fingerprints_included','automatic_application','product_application']:assert rights[k]is False
assert r['published_payload_correspondence_note_url']=='https://github.com/kimjeon-il/Pando/blob/1a3b4b3437000b4bcf3913a287316d1ab5f65897/reports/hydro-names/reconstruction-2026-10-09/batch-r30/packed-payload-correspondence.json'
for script in ['validate-geometry-reference.py','review/validate-independent-review.py']:
 out=subprocess.run([sys.executable,'-B',str(P/script)],cwd=P,capture_output=True,text=True);assert out.returncode==0,(script,out.stdout,out.stderr);assert json.loads(out.stdout)['status']=='passed'
print(json.dumps({'result':'PASS','batch':'r32','files_verified':len(actual),'counts':r['counts'],'new_distinct_targets':3,'distinct_reconstruction_targets':93,'scope_holds':26,'source_access_pending':2,'remaining_without_reconstructed_record':3972,'complete_lake_coordinates_included':False,'omitted_full_geometry_or_original_sources_replayed':False,'manifest_sha256':H(P/'manifest.json'),'remote_save_verified_by_this_script':False,'network_calls':0,'automatic_application':False}))
