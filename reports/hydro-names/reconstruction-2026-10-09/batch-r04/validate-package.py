#!/usr/bin/env python3
"""Offline mixed-package checks; external river/source inputs are never downloaded."""
import collections,hashlib,json,pathlib,subprocess,sys
sys.dont_write_bytecode=True
P=pathlib.Path(__file__).resolve().parent
load=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
m=load(P/'manifest.json');assert m['batch']=='r04'and m['automatic_application']is False
actual={str(p.relative_to(P))for p in P.rglob('*')if p.is_file()and p.name!='manifest.json'}
assert actual==set(m['files']),actual^set(m['files'])
assert len(actual)==m['file_count_excluding_self']and sum(x['bytes']for x in m['files'].values())==m['bytes_excluding_self']
for n,h in m['files'].items():
 p=P/n;assert p.stat().st_size==h['bytes']and sha(p)==h['sha256'],n
 assert p.suffix in {'.json','.geojson','.md','.py','.mjs'}
 assert not pathlib.PurePosixPath(n).is_absolute()and not any(x in n for x in ['__pycache__','.input-cache','local-review','local-evidence'])
r=load(P/'results.json');review=load(P/r['review_file'])
assert sha(P/r['review_file'])==r['review_file_sha256']
expected=['hydro-system:70152112','lakes_base:1159123163','lakes_base:1159123567']
assert [x['aw_id']for x in r['records']]==expected==[x['aw_id']for x in review['findings']]
assert r['research_completed_targets']==r['independently_reviewed_targets']==3
assert r['counts']=={'candidate_representative_system_identity':1,'supported_generalized_water_identity':1,'candidate_waterbody_identity_extent_hold':1}
assert r['counts']==dict(collections.Counter(x['research_category']for x in r['records']))
assert r['historical_name_lead_targets']==2 and r['new_inventory_targets']==1
assert r['baseline_fragment_count']==5 and r['river_line_part_count']==188 and r['river_rendered_coordinate_count']==1279
assert r['lake_feature_count']==2 and r['lake_source_coordinate_count_including_closures']==r['lake_baseline_coordinate_count_including_closures']==300 and r['total_rendered_coordinate_count']==1579
assert r['automatic_application']is False and r['product_changes']is False and r['current_live_deployment_checked']is False
assert r['historical504_detailed_ledger_restored']is False and r['original_hydrorivers_coordinate_equality_verified']is False
assert r['formal_registry_verifications']==r['whole_feature_scalar_name_approvals']==0
for x,y in zip(r['records'],review['findings']):
 assert all(x[k]==y[k]for k in ['aw_id','candidate_name','research_category','supported_name_scope','source_keys','limits'])
 assert x['korean_name']is None and x['whole_feature_scalar_name']is None and x['automatic_application']is False and x['product_application']is False and x['historical_verified_ID_restored']is False
assert r['records'][2]['selection_origin']=='new_inventory_investigation'
sel=load(P/'new-lake-selection.json');assert sel['source_id']=='1159123567'and sel['identity_join']['ne_id_dbf_field']['value']=='1159123567'
assert sel['identity_join']['natural_earth_record']['dam_name']=='Emborcação Dam'and sel['identity_join']['natural_earth_record']['name_alt']=='Theodomiro Sampaio'
assert sel['identity_join']['source_name_field_empty']is True and sel['scalar_product_field_clearance']is False
rights=load(P/'source-publication-rights.json');assert rights['complete_river_coordinates_published']is False and rights['raw_third_party_sources_published']is False and rights['raw_pdf_html_map_crop_count']==0
assert rights['river_stand_alone_redistribution_cleared']is False
lake_ids=['1159123163','1159123567'];assert rights['lake_source_ids']==lake_ids
lake_files=['selected-lake-geometries.geojson','selected-baseline-lake-geometries.geojson'];assert sorted(x for x in actual if x.endswith('.geojson'))==sorted(lake_files)
for name in lake_files:
 d=load(P/name);assert d['type']=='FeatureCollection'and len(d['features'])==2
 assert [str(f['properties'].get('source_id',f['properties'].get('sourceId')))for f in d['features']]==lake_ids
 for f,count in zip(d['features'],[92,208]):assert f['geometry']['type']=='Polygon'and len(f['geometry']['coordinates'])==1 and len(f['geometry']['coordinates'][0])==count
idx=load(P/'reconstruction-index.json');assert len(idx['records'])==len({x['aw_id']for x in idx['records']})==idx['total_distinct_reconstructed_targets']==12
assert idx['current_batch_increment']==3 and idx['previous_batch_distinct_targets']==9 and idx['duplicate_targets']==0
assert idx['target_types']=={'lake':8,'river_group':4}
assert {x['aw_id']for x in idx['records']if x['batch']=='r04'}==set(expected)
assert idx['categories']==dict(collections.Counter(x['research_category']for x in idx['records']))
assert idx['prior_commit']==r['previous_reconstruction_commit']=='ed7bdaf154563ebdce8de6b40aff463b714a7a17'
rm=load(P/'review/review-manifest.json');pins=rm['files']
for n,v in(pins.items()if isinstance(pins,dict)else((v['file'],v)for v in pins)):
 p=P/'review'/n;assert sha(p)==(v['sha256']if isinstance(v,dict)else v),n
 if isinstance(v,dict)and'bytes'in v:assert p.stat().st_size==v['bytes']
for script in ['validate-geometry-reference.py','review/validate-independent-review.py']:
 q=subprocess.run([sys.executable,str(P/script)],capture_output=True,text=True,cwd=P)
 assert q.returncode==0,(script,q.stdout,q.stderr)
 assert json.loads(q.stdout)['status']=='passed'
print(json.dumps({'result':'PASS','batch':'r04','files_verified':len(actual),'published_input_bytes':sum(x['bytes']for x in m['files'].values()),'counts':r['counts'],'research_completed':3,'baseline_features':5,'recorded_total_positions':1579,'public_lake_positions_checked':300,'omitted_river_coordinates_rechecked_by_this_package_only_run':False,'raw_originals_rechecked_by_this_package_only_run':False,'distinct_reconstruction_targets':12,'manifest_sha256':sha(P/'manifest.json'),'full_river_coordinates_or_raw_documents_published':False,'current_live_deployment_checked':False,'historical504_ledger_restored':False,'remote_save_verified_by_this_script':False,'network_calls':0,'automatic_application':False}))
