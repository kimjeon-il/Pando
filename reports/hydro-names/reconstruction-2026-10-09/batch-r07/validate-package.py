#!/usr/bin/env python3
"""Offline public-river-package validation; omitted paths/sources are not reacquired."""
import collections,hashlib,json,pathlib,subprocess,sys
sys.dont_write_bytecode=True
P=pathlib.Path(__file__).resolve().parent;load=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
expected=['hydro-system:50668155','hydro-system:50611851','hydro-system:50552041']
m=load(P/'manifest.json');assert m['batch']=='r07'and m['automatic_application']is False
actual={str(p.relative_to(P))for p in P.rglob('*')if p.is_file()and p.name!='manifest.json'}
assert actual==set(m['files']),actual^set(m['files']);assert len(actual)==m['file_count_excluding_self']
assert sum(x['bytes']for x in m['files'].values())==m['bytes_excluding_self']
for n,h in m['files'].items():
 p=P/n;assert p.stat().st_size==h['bytes']and sha(p)==h['sha256'],n
 assert p.suffix in {'.json','.md','.py','.mjs'}
 assert not pathlib.PurePosixPath(n).is_absolute()and not any(x in n for x in ['__pycache__','.input-cache','local-review','local-evidence'])
r=load(P/'results.json');review=load(P/r['review_file']);assert sha(P/r['review_file'])==r['review_file_sha256']
assert [x['aw_id']for x in r['records']]==expected==[x['aw_id']for x in review['findings']]
assert r['research_completed_targets']==r['independently_reviewed_targets']==3
assert r['counts']==dict(collections.Counter(x['research_category']for x in r['records']))
assert r['pending_source_only_targets']==r['historical_exact_ID_lead_targets']==0 and r['new_inventory_targets']==3
assert r['baseline_fragment_count']==3 and r['river_line_part_count']==r['distinct_source_reach_count']==747
assert r['river_rendered_coordinate_count']==3681
assert r['part_counts_in_target_order']==[314,252,181]and r['position_counts_in_target_order']==[1406,1246,1029]
assert r['automatic_application']is False and r['product_changes']is False and r['current_live_deployment_checked']is False
assert r['historical504_detailed_ledger_restored']is False and r['historical_504_is_not_added_to_reconstruction_counts']is True
assert r['original_hydrorivers_coordinate_equality_verified']is False
assert r['formal_registry_verifications']==r['whole_group_scalar_name_approvals']==r['all_reach_name_approvals']==0
for x,y in zip(r['records'],review['findings']):
 assert all(x[k]==y[k]for k in ['aw_id','candidate_name','research_category','supported_name_scope','source_keys','limits'])
 assert x['whole_group_scalar_name']is None and x['korean_name']is None and x['all_reach_names_verified']is False
 assert x['automatic_application']is False and x['product_application']is False and x['historical_verified_ID_restored']is False
 assert x['selection_origin']=='new_inventory_investigation'and x['category']=='river_group'
assert [x['geometry_fids']for x in r['records']]==[[6944],[6886],[6834]]
assert [x['baseline_logical_fid']for x in r['records']]==[2000,1942,1895]
rights=load(P/'source-publication-rights.json')
for k in ['raw_third_party_sources_included','full_river_coordinates_included','river_geojson_or_binary_packs_included','per_part_endpoint_path_reconstruction_included','stand_alone_geometry_redistribution_cleared']:assert rights[k]is False,k
assert rights['raw_third_party_pdf_count']==rights['raw_maps_images_html_count']==0
# Reject serialized full paths; bounded geometry facts are covered by component checks.
def no_full_geometry(x):
 if isinstance(x,dict):
  assert 'coordinates'not in x and x.get('type')!='FeatureCollection'
  for v in x.values():no_full_geometry(v)
 elif isinstance(x,list):
  for v in x:no_full_geometry(v)
for n in actual:
 if n.endswith('.json'):no_full_geometry(load(P/n))
idx=load(P/'reconstruction-index.json');assert len(idx['records'])==len({x['aw_id']for x in idx['records']})==idx['total_distinct_reconstructed_targets']==21
assert idx['current_batch_increment']==3 and idx['previous_batch_distinct_targets']==18 and idx['duplicate_targets']==0
assert idx['target_types']=={'lake':14,'river_group':7}
assert {x['aw_id']for x in idx['records']if x['batch']=='r07'}==set(expected)
assert idx['categories']==dict(collections.Counter(x['research_category']for x in idx['records']))
assert idx['prior_commit']==r['previous_reconstruction_commit']=='9727db6a8f55a61dffed63109df5596f901f5af6'
assert idx['previous_index_sha256']=='6e003dc3176146bea5e472c2c4d2e0fdad36c54eec476dca96030fa879ba093f'
assert [x['fixed_commit']for x in idx['records']if x['batch']=='r06']==[idx['prior_commit']]*3
q=idx['remaining_queue_recovery'];assert q['initial_inventory']['sha256']=='5d1e12b1a6daa695419173dea491ff0c8c5583ed9e28ba517ba4a599bcd589db'
assert q['initial_inventory']['git_blob_sha']=='55a1de2ae76f09bce5e624d96ad17f7531aa3fd8'
assert q['initial_inventory']['immutable_commit']=='8213678cbfd74ecd930657eaa911f6e87ab6d2b8'
assert q['initial_inventory']['repository_path']=='reports/hydro-names/current-web-2026-10-08/inventory.csv.gz'
assert q['initial_inventory']['rows']==5173 and q['initial_inventory']['bytes']==441711
assert q['eligible_filter']=='classification != named_display'and q['eligible_universe_count']==4065
assert q['eligible_universe_by_type']=={'river_group':3455,'lake':610}
assert q['reviewed_index_targets']==21 and q['remaining_without_reconstructed_record']==4065-21==4044
assert q['remaining_without_reconstructed_record_by_type']=={'river_group':3455-7,'lake':610-14}
assert q['historical_never_reviewed_count_claimed']is False and q['all_reviewed_ids_in_eligible_universe']is True
assert q['rebuild_script']=='recover-remaining-queue.py'and q['queue_order']=='original_inventory_row_order'
rm=load(P/'review/review-manifest.json');pins=rm['files']
for n,v in(pins.items()if isinstance(pins,dict)else((v['file'],v)for v in pins)):
 p=P/'review'/n;assert sha(p)==(v['sha256']if isinstance(v,dict)else v),n
 if isinstance(v,dict)and'bytes'in v:assert p.stat().st_size==v['bytes']
for script in ['validate-geometry-reference.py','review/validate-independent-review.py']:
 proc=subprocess.run([sys.executable,str(P/script)],capture_output=True,text=True,cwd=P)
 assert proc.returncode==0,(script,proc.stdout,proc.stderr);assert json.loads(proc.stdout)['status']=='passed'
print(json.dumps({'result':'PASS','batch':'r07','files_verified':len(actual),'published_input_bytes':sum(x['bytes']for x in m['files'].values()),'counts':r['counts'],'research_completed':3,'baseline_fragments':3,'recorded_line_parts':747,'recorded_rendered_positions':3681,'omitted_full_coordinates_rechecked_by_this_package_only_run':False,'raw_originals_rechecked_by_this_package_only_run':False,'initial_inventory_body_rechecked_by_this_package_only_run':False,'distinct_reconstruction_targets':21,'remaining_without_reconstructed_record':4044,'manifest_sha256':sha(P/'manifest.json'),'full_river_coordinates_or_raw_documents_published':False,'current_live_deployment_checked':False,'historical504_ledger_restored':False,'remote_save_verified_by_this_script':False,'network_calls':0,'automatic_application':False}))
