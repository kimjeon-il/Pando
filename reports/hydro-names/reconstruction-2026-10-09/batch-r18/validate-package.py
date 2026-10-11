#!/usr/bin/env python3
"""Verify the complete durable lake-research package without network access."""
import collections,hashlib,json,pathlib,subprocess,sys
sys.dont_write_bytecode=True
P=pathlib.Path(__file__).resolve().parent
load=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
expected=['lakes_base:1159116675','lakes_base:1159118183','lakes_base:1159118201']
source_ids=[x.split(':')[1]for x in expected];counts_expected=[38,58,24]
m=load(P/'manifest.json');assert m['batch']=='r18'and m['automatic_application']is False
actual={str(p.relative_to(P))for p in P.rglob('*')if p.is_file()and p.name!='manifest.json'}
assert actual==set(m['files']),actual^set(m['files'])
assert len(actual)==m['file_count_excluding_self']and sum(x['bytes']for x in m['files'].values())==m['bytes_excluding_self']
for n,h in m['files'].items():
 p=P/n;assert p.stat().st_size==h['bytes']and sha(p)==h['sha256'],n
 assert p.suffix in {'.json','.geojson','.md','.py','.mjs'}
 assert not pathlib.PurePosixPath(n).is_absolute()and not any(x in n for x in ['__pycache__','.input-cache','local-review','local-evidence'])
r=load(P/'results.json');review=load(P/r['review_file'])
assert sha(P/r['review_file'])==r['review_file_sha256']
assert [x['aw_id']for x in r['records']]==expected==[x['aw_id']for x in review['findings']]
assert r['research_completed_targets']==sum(x['full_feature_correspondence_review_completed']for x in r['records']) and r['independently_reviewed_targets']==r['bounded_research_attempts']==3
assert r['independent_identity_review_completed_targets']==r['research_completed_targets']
assert r['source_access_limited_targets']==sum(x['source_access_limited']for x in r['records'])
assert r['pending_full_feature_source_review_targets']==3-r['research_completed_targets']
assert r['counts']==dict(collections.Counter(x['research_category']for x in r['records']))
assert r['pending_source_only_targets']==r['source_access_limited_targets'] and r['historical_exact_ID_lead_targets']==0 and r['historical_name_lead_targets']==0 and r['new_inventory_targets']==3
assert r['baseline_fragment_count']==r['lake_feature_count']==3
assert r['lake_source_coordinate_count_including_closures']==r['lake_baseline_coordinate_count_including_closures']==120
assert r['position_counts_in_target_order']==counts_expected
assert r['automatic_application']is False and r['product_changes']is False and r['current_live_deployment_checked']is False
assert r['historical504_detailed_ledger_restored']is False and r['historical_504_is_not_added_to_reconstruction_counts']is True
assert r['formal_registry_verifications']==r['whole_feature_scalar_name_approvals']==0
for x,y in zip(r['records'],review['findings']):
 assert all(x[k]==y[k]for k in ['aw_id','candidate_name','research_category','supported_name_scope','source_keys','limits','source_access_limited','full_feature_correspondence_review_completed','follow_up_required'])
 assert x['independent_review_status']==y.get('review_status',y['research_category'])
 assert x['naming_scope_details']=={k:y[k]for k in ['candidate_name_role','directly_supported_name_forms','constituent_list_exhaustive','exact_name_partition_established','named_water_associations','unassigned_region','follow_up_scope']if k in y}
 assert x['korean_name']is None and x['whole_feature_scalar_name']is None
 assert x['automatic_application']is False and x['product_application']is False and x['historical_verified_ID_restored']is False
 assert x['selection_origin']=='new_inventory_investigation'and x['category']=='lake'
 assert x['formal_registry_verified']is False and x['exact_shoreline_verified']is False
assert all(isinstance(x['source_access_limited'],bool)for x in r['records'])
assert all(isinstance(x['full_feature_correspondence_review_completed'],bool)for x in r['records'])
assert all(not x['full_feature_correspondence_review_completed']and x['follow_up_required']for x in r['records']if x['source_access_limited'])
assert all(isinstance(x['follow_up_required'],bool)for x in r['records'])
assert [x['geometry_fids']for x in r['records']]==[[15858],[15945],[15946]]
assert [x['baseline_logical_fid']for x in r['records']]==[4483,4570,4571]
rights=load(P/'source-publication-rights.json');assert rights['raw_third_party_sources_published']is False and rights['raw_pdf_html_map_crop_count']==0
assert rights['lake_source_ids']==source_ids
lake_files=['selected-lake-geometries.geojson','selected-baseline-rendered-geometries.geojson']
assert sorted(x for x in actual if x.endswith('.geojson'))==sorted(lake_files)
for name in lake_files:
 d=load(P/name);assert d['type']=='FeatureCollection'and len(d['features'])==3
 assert [str(f['properties'].get('source_id',f['properties'].get('sourceId')))for f in d['features']]==source_ids
 for f,count in zip(d['features'],counts_expected):
  assert f['geometry']['type']=='Polygon'and len(f['geometry']['coordinates'])==1
  assert len(f['geometry']['coordinates'][0])==count
  assert f['geometry']['coordinates'][0][0]==f['geometry']['coordinates'][0][-1]
idx=load(P/'reconstruction-index.json')
assert len(idx['records'])==len({x['aw_id']for x in idx['records']})==idx['total_distinct_reconstructed_targets']==54
assert idx['current_batch_increment']==3 and idx['previous_batch_distinct_targets']==51 and idx['duplicate_targets']==0
assert idx['target_types']=={'lake':38,'river_group':16}
assert {x['aw_id']for x in idx['records']if x['batch']=='r18'}==set(expected)
assert idx['categories']==dict(collections.Counter(x['research_category']for x in idx['records']))
assert idx['prior_commit']==r['previous_reconstruction_commit']=='3df3f9a6eb749d2562ef7c6c324f92355fb0d81d'
assert idx['previous_index_sha256']=='ce6819ae0e3a3b668b6b1bd9ce39bb8b0f60543dbc2196d0765c935396f8e601'
assert [x['fixed_commit']for x in idx['records']if x['batch']=='r17']==[idx['prior_commit']]*3
assert idx['recorded_index_targets']==54 and {'lakes_base:1159112821','lakes_base:1159108815'}<=set(idx['pending_access_ids'])and idx['pending_access_count']==len(idx['pending_access_ids'])
assert idx['complete_identity_review_claimed_for_all_records']is False
assert idx['pending_access_ids']==[x['aw_id']for x in idx['records']if x.get('source_access_limited')is True]
assert idx['scope_hold_ids']==[x['aw_id']for x in idx['records']if x['research_category']in {'whole_polygon_scope_hold','supported_reservoir_association_geometry_hold','candidate_waterbody_identity_extent_hold','compound_feature_name_scope_hold'}and x['aw_id']not in idx['pending_access_ids']]
assert idx['scope_hold_count']==len(idx['scope_hold_ids'])
assert idx['current_batch_source_limited_follow_up_ids']==[x['aw_id']for x in r['records']if x['source_access_limited']]and idx['current_batch_completed_source_scope_assessments']==r['research_completed_targets']
for x in idx['records']:
 if x['batch']=='r18':
  match=next(v for v in r['records']if v['aw_id']==x['aw_id']);assert all(x[k]==match[k]for k in ['source_access_limited','full_feature_correspondence_review_completed','follow_up_required','naming_scope_details','supported_name_scope'])
for note in idx.get('scope_continuity_enrichments',[]):
 assert note['field']=='supported_name_scope'
 match=next(x for x in idx['records']if x['aw_id']==note['aw_id']);assert match[note['field']]==note['value']
 assert len(note['source_sha256'])==64 and len(note['source_commit'])==40
 assert note['source_url']=='https://github.com/kimjeon-il/Pando/blob/'+note['source_commit']+'/'+note['source_repository_path']
 assert note['source_repository_path'].startswith('reports/hydro-names/reconstruction-2026-10-09/')
q=idx['remaining_queue_recovery'];assert q['initial_inventory']['sha256']=='5d1e12b1a6daa695419173dea491ff0c8c5583ed9e28ba517ba4a599bcd589db'
assert q['initial_inventory']['git_blob_sha']=='55a1de2ae76f09bce5e624d96ad17f7531aa3fd8'
assert q['initial_inventory']['immutable_commit']=='8213678cbfd74ecd930657eaa911f6e87ab6d2b8'
assert q['initial_inventory']['repository_path']=='reports/hydro-names/current-web-2026-10-08/inventory.csv.gz'
assert q['initial_inventory']['rows']==5173 and q['initial_inventory']['bytes']==441711
assert q['eligible_filter']=='classification != named_display'and q['eligible_universe_count']==4065
assert q['eligible_universe_by_type']=={'river_group':3455,'lake':610}
assert q['reviewed_index_targets']==54 and q['remaining_without_reconstructed_record']==4065-54==4011
assert q['remaining_without_reconstructed_record_by_type']=={'river_group':3455-16,'lake':610-38}
assert q['historical_never_reviewed_count_claimed']is False and q['all_reviewed_ids_in_eligible_universe']is True
assert q['rebuild_script']=='recover-remaining-queue.py'and q['queue_order']=='original_inventory_row_order'
rm=load(P/'review/review-manifest.json');pins=rm['files']
for n,v in(pins.items()if isinstance(pins,dict)else((v['file'],v)for v in pins)):
 p=P/'review'/n;assert sha(p)==(v['sha256']if isinstance(v,dict)else v),n
 if isinstance(v,dict)and'bytes'in v:assert p.stat().st_size==v['bytes']
for script in ['validate-geometry-reference.py','review/validate-independent-review.py']:
 q=subprocess.run([sys.executable,str(P/script)],capture_output=True,text=True,cwd=P)
 assert q.returncode==0,(script,q.stdout,q.stderr)
 assert json.loads(q.stdout)['status']=='passed'
print(json.dumps({'result':'PASS','batch':'r18','files_verified':len(actual),'published_input_bytes':sum(x['bytes']for x in m['files'].values()),'counts':r['counts'],'research_completed':r['research_completed_targets'],'bounded_attempts':3,'independently_reviewed_verdicts':3,'source_access_limited_targets':r['source_access_limited_targets'],'cumulative_pending_access_targets':idx['pending_access_count'],'baseline_features':3,'public_lake_positions_checked':120,'raw_originals_rechecked_by_this_package_only_run':False,'distinct_reconstruction_targets':idx['total_distinct_reconstructed_targets'],'remaining_without_reconstructed_record':4011,'manifest_sha256':sha(P/'manifest.json'),'raw_documents_published':False,'current_live_deployment_checked':False,'historical504_ledger_restored':False,'remote_save_verified_by_this_script':False,'network_calls':0,'automatic_application':False}))
