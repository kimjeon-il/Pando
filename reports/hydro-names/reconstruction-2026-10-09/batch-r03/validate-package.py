#!/usr/bin/env python3
"""Offline verification of published research facts. Never acquires external data."""
import collections,hashlib,json,pathlib,subprocess,sys
P=pathlib.Path(__file__).resolve().parent
load=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
m=load(P/'manifest.json');assert m['batch']=='r03' and m['automatic_application']is False
actual={str(p.relative_to(P))for p in P.rglob('*')if p.is_file()and p.name!='manifest.json'and'__pycache__'not in str(p)}
assert actual==set(m['files']),actual^set(m['files'])
assert len(actual)==m['file_count_excluding_self']
assert sum(x['bytes']for x in m['files'].values())==m['bytes_excluding_self']
for n,pin in m['files'].items():
 p=P/n;assert p.stat().st_size==pin['bytes']and sha(p)==pin['sha256'],n
 assert p.suffix in {'.json','.md','.py','.mjs'},n
 assert not pathlib.PurePosixPath(n).is_absolute()
 assert not any(t in n for t in ['.input-cache','local-evidence','local-review'])
r=load(P/'results.json');review=load(P/r['review_file'])
assert sha(P/r['review_file'])==r['review_file_sha256']
expected=['30624681','50488324','40182409']
assert r['research_completed_targets']==r['independently_reviewed_targets']==3
assert [x['system_id']for x in r['records']]==expected==[str(x['system_id'])for x in review['findings']]
assert r['counts']==dict(collections.Counter(x['research_category']for x in r['records']))
assert r['fragment_count']==9 and r['line_part_count']==r['distinct_source_reach_count']==678 and r['rendered_coordinate_count']==4220
assert r['automatic_application']is False and r['product_changes']is False
assert r['historical504_detailed_ledger_restored']is False and r['current_live_deployment_checked']is False
assert r['original_hydrorivers_coordinate_equality_verified']is False
assert r['formal_registry_verifications']==r['whole_group_scalar_name_approvals']==r['all_reach_name_approvals']==0
for x,y in zip(r['records'],review['findings']):
 assert x['research_category']==y['research_category']
 assert x['candidate_name']==y['candidate_name']and x['supported_name_scope']==y['supported_name_scope']and x['limits']==y['limits']and x['source_keys']==y['source_keys']
 assert x['whole_group_scalar_name']is None and x['korean_name']is None and x['all_reach_names_verified']is False and x['automatic_application']is False and x['product_application']is False
assert r['records'][0]['research_category']=='candidate_representative_system_identity'
assert all(x['research_category']=='supported_representative_system_identity'for x in r['records'][1:])
idx=load(P/'reconstruction-index.json');assert len(idx['records'])==len({x['aw_id']for x in idx['records']})==idx['total_distinct_reconstructed_targets']==9
assert idx['current_batch_increment']==3 and idx['previous_batch_distinct_targets']==6 and idx['duplicate_targets']==0
assert idx['target_types']=={'lake':6,'river_group':3}
assert {x['system_id']for x in idx['records']if x['batch']=='r03'}==set(expected)
assert idx['categories']==dict(collections.Counter(x['research_category']for x in idx['records']))
assert idx['prior_commit']==r['previous_reconstruction_commit']=='d89d00bb5237d486761965762c94c96d71b7b6c7'
rights=load(P/'source-publication-rights.json')
assert rights['raw_third_party_sources_included']is False and rights['full_river_coordinates_included']is False and rights['river_geojson_or_binary_packs_included']is False
assert rights['raw_third_party_pdf_count']==rights['raw_maps_images_html_count']==0
assert rights['stand_alone_geometry_redistribution_cleared']is False
geom_rights=load(P/'geometry-publication-rights.json');assert geom_rights['complete_coordinate_arrays_in_public_package']is False and geom_rights['open_redistribution_permission_claimed']is False
# No serialized GeoJSON coordinate array or full feature collection may be published.
def no_full_geometry(x):
 if isinstance(x,dict):
  assert 'coordinates'not in x and x.get('type')!='FeatureCollection'
  for v in x.values():no_full_geometry(v)
 elif isinstance(x,list):
  for v in x:no_full_geometry(v)
for n in actual:
 if n.endswith('.json'):no_full_geometry(load(P/n))
rm=load(P/'review/review-manifest.json');pins=rm['files']
for n,v in (pins.items()if isinstance(pins,dict)else((v['file'],v)for v in pins)):
 p=P/'review'/n;assert sha(p)==(v['sha256']if isinstance(v,dict)else v),n
 if isinstance(v,dict)and'bytes'in v:assert p.stat().st_size==v['bytes']
for script in ['validate-geometry-reference.py','review/validate-independent-review.py']:
 q=subprocess.run([sys.executable,str(P/script)],capture_output=True,text=True,cwd=P)
 assert q.returncode==0,(script,q.stdout,q.stderr)
 assert json.loads(q.stdout)['status']=='passed'
print(json.dumps({'result':'PASS','batch':'r03','files_verified':len(actual),'published_input_bytes':sum(x['bytes']for x in m['files'].values()),'counts':r['counts'],'research_completed':3,'fragments':9,'line_parts':678,'recorded_rendered_positions':4220,'complete_coordinates_rechecked_by_this_package_only_run':False,'raw_originals_rechecked_by_this_package_only_run':False,'distinct_reconstruction_targets':9,'manifest_sha256':sha(P/'manifest.json'),'full_coordinates_or_raw_sources_published':False,'current_live_deployment_checked':False,'historical504_ledger_restored':False,'remote_save_verified_by_this_script':False,'network_calls':0,'automatic_application':False}))
