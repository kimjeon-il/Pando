#!/usr/bin/env python3
"""Offline checks for this bounded research package; no source retrieval or product writes."""
import hashlib,json,pathlib,subprocess,sys
P=pathlib.Path(__file__).resolve().parent
load=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
m=load(P/'manifest.json')
assert m['batch']=='r02' and m['automatic_application'] is False
actual={str(p.relative_to(P)) for p in P.rglob('*') if p.is_file() and p.name!='manifest.json' and '__pycache__'not in str(p)}
assert actual==set(m['files']),('unexpected/missing file',actual^set(m['files']))
for n,v in m['files'].items():
 p=P/n; assert p.stat().st_size==v['bytes'] and sha(p)==v['sha256'],n
assert len(actual)==m['file_count_excluding_self']
assert sum(v['bytes']for v in m['files'].values())==m['bytes_excluding_self']
assert all(pathlib.PurePosixPath(n).suffix in {'.json','.geojson','.md','.py','.mjs'}for n in actual)
assert not any(pathlib.PurePosixPath(n).is_absolute()or'.input-cache'in n or'local-evidence'in n or'local-review'in n for n in actual)
r=load(P/'results.json');expected=['1159115267','1159123531','1159107099']
assert r['research_completed_targets']==r['independently_reviewed_targets']==3
assert r['counts']=={'supported_generalized_water_identity':2,'supported_reservoir_association_geometry_hold':1}
assert r['historical504_detailed_ledger_restored'] is False and r['current_live_deployment_checked'] is False
assert r['automatic_application'] is False and r['product_changes'] is False and r['whole_polygon_product_name_approvals']==0
assert r['source_coordinate_count_including_ring_closures']==367
assert [x['source_id']for x in r['records']]==expected
for x in r['records']:assert x['korean_name']is None and x['whole_polygon_scalar_name']is None and x['automatic_application']is False and x['product_application']is False and x['formal_current_registry_name_verified']is False and x['exact_shoreline_verified']is False
assert sha(P/r['review_file'])==r['review_file_sha256']
review=load(P/r['review_file']);assert r['prominent_geometry_warning']==review['prominent_geometry_warning']
assert review['prominent_geometry_warning']['source_id']=='1159123531' and review['prominent_geometry_warning']['severity']=='hold'
assert [f['source_id']for f in review['findings']]==expected
for x,y in zip(r['records'],review['findings']):
 assert x['candidate_name']==y['candidate_name'] and x['supported_name_scope']==y['approved_name_scope'] and x['source_keys']==y['source_keys'] and x['limits']==y['limits']
idx=load(P/'reconstruction-index.json');assert len(idx['records'])==len({x['source_id']for x in idx['records']})==idx['total_distinct_reconstructed_targets']==6
assert idx['current_batch_increment']==idx['previous_batch_distinct_targets']==3 and idx['duplicate_targets']==0
assert {x['source_id']for x in idx['records']if x['batch']=='r02'}==set(expected)
assert {x['source_id']for x in idx['records']if x['batch']=='r01'}=={'1159109497','1159106899','1159107065'}
assert idx['categories']=={'supported_generalized_water_identity':4,'whole_polygon_scope_hold':1,'supported_reservoir_association_geometry_hold':1}
assert idx['prior_commit']==r['previous_reconstruction_commit']=='4300128a1298222a430464b1899d7a1a141f1ab3'
rights=load(P/'source-publication-rights.json');assert rights['raw_third_party_sources_included']is False and rights['raw_third_party_pdf_count']==rights['raw_maps_images_html_count']==0
access=load(P/'source-access-observations.json');assert len(access['observations'])==4
for s in access['observations']:assert s['used_as_evidence']is False and s['same_publication_retried']is False and s['alternate_route_attempted']is False
rm=load(P/'review/review-manifest.json')
for v in rm['files']:
 n=v['file'];p=P/'review'/n
 assert sha(p)==v['sha256'] and p.stat().st_size==v['bytes'],n
for script in ['validate-geometry-reference.py','review/validate-independent-review.py']:
 q=subprocess.run([sys.executable,str(P/script)],capture_output=True,text=True,cwd=P)
 assert q.returncode==0,(script,q.stdout,q.stderr)
 assert json.loads(q.stdout)['status']=='passed'
print(json.dumps({'result':'PASS','batch':'r02','files_verified':len(actual),'published_input_bytes':sum(v['bytes']for v in m['files'].values()),'research_completed':3,'counts':r['counts'],'positions':367,'distinct_reconstruction_total':6,'manifest_sha256':sha(P/'manifest.json'),'raw_original_sources_included':False,'current_live_deployment_checked':False,'full_lost_ledger_restored':False,'remote_save_verified_by_this_script':False,'network_calls':0,'automatic_application':False}))
