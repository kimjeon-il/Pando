#!/usr/bin/env python3
"""Verify the complete durable lake-research package without network access."""
import collections,hashlib,json,pathlib,subprocess,sys
sys.dont_write_bytecode=True
P=pathlib.Path(__file__).resolve().parent
load=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
expected=['lakes_base:1159110371','lakes_base:1159109471','lakes_base:1159111751']
source_ids=[x.split(':')[1]for x in expected];counts_expected=[114,205,104]
m=load(P/'manifest.json');assert m['batch']=='r05'and m['automatic_application']is False
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
assert r['research_completed_targets']==r['independently_reviewed_targets']==3
assert r['counts']==dict(collections.Counter(x['research_category']for x in r['records']))
assert r['pending_source_only_targets']==r['historical_name_lead_targets']==0 and r['new_inventory_targets']==3
assert r['baseline_fragment_count']==r['lake_feature_count']==3
assert r['lake_source_coordinate_count_including_closures']==r['lake_baseline_coordinate_count_including_closures']==423
assert r['position_counts_in_target_order']==counts_expected
assert r['automatic_application']is False and r['product_changes']is False and r['current_live_deployment_checked']is False
assert r['historical504_detailed_ledger_restored']is False and r['historical_504_is_not_added_to_reconstruction_counts']is True
assert r['formal_registry_verifications']==r['whole_feature_scalar_name_approvals']==0
for x,y in zip(r['records'],review['findings']):
 assert all(x[k]==y[k]for k in ['aw_id','candidate_name','research_category','supported_name_scope','source_keys','limits'])
 assert x['korean_name']is None and x['whole_feature_scalar_name']is None
 assert x['automatic_application']is False and x['product_application']is False and x['historical_verified_ID_restored']is False
 assert x['selection_origin']=='new_inventory_investigation'and x['category']=='lake'
 assert x['formal_registry_verified']is False and x['exact_shoreline_verified']is False
assert [x['geometry_fids']for x in r['records']]==[[15485],[15419],[15571]]
assert [x['baseline_logical_fid']for x in r['records']]==[4110,4044,4196]
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
assert len(idx['records'])==len({x['aw_id']for x in idx['records']})==idx['total_distinct_reconstructed_targets']==15
assert idx['current_batch_increment']==3 and idx['previous_batch_distinct_targets']==12 and idx['duplicate_targets']==0
assert idx['target_types']=={'lake':11,'river_group':4}
assert {x['aw_id']for x in idx['records']if x['batch']=='r05'}==set(expected)
assert idx['categories']==dict(collections.Counter(x['research_category']for x in idx['records']))
assert idx['prior_commit']==r['previous_reconstruction_commit']=='0bc30a0477862be8249b9504e8425de781c36721'
assert idx['previous_index_sha256']=='11dc1276e7191d049d9572be0732b549ccdd99699fbd2fbf557f62605a5dafb2'
assert [x['fixed_commit']for x in idx['records']if x['batch']=='r04']==[idx['prior_commit']]*3
rm=load(P/'review/review-manifest.json');pins=rm['files']
for n,v in(pins.items()if isinstance(pins,dict)else((v['file'],v)for v in pins)):
 p=P/'review'/n;assert sha(p)==(v['sha256']if isinstance(v,dict)else v),n
 if isinstance(v,dict)and'bytes'in v:assert p.stat().st_size==v['bytes']
for script in ['validate-geometry-reference.py','review/validate-independent-review.py']:
 q=subprocess.run([sys.executable,str(P/script)],capture_output=True,text=True,cwd=P)
 assert q.returncode==0,(script,q.stdout,q.stderr)
 assert json.loads(q.stdout)['status']=='passed'
print(json.dumps({'result':'PASS','batch':'r05','files_verified':len(actual),'published_input_bytes':sum(x['bytes']for x in m['files'].values()),'counts':r['counts'],'research_completed':3,'baseline_features':3,'public_lake_positions_checked':423,'raw_originals_rechecked_by_this_package_only_run':False,'distinct_reconstruction_targets':15,'manifest_sha256':sha(P/'manifest.json'),'raw_documents_published':False,'current_live_deployment_checked':False,'historical504_ledger_restored':False,'remote_save_verified_by_this_script':False,'network_calls':0,'automatic_application':False}))
