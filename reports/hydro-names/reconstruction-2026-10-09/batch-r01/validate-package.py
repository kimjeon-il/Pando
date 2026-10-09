#!/usr/bin/env python3
"""Validate this compact reconstruction package without network or product writes."""
import hashlib,json,pathlib,subprocess,sys,socket
socket.create_connection=lambda *a,**k:(_ for _ in ()).throw(RuntimeError('Network forbidden'))
P=pathlib.Path(__file__).resolve().parent
load=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
m=load(P/'manifest.json')
assert m['batch']=='r01' and m['automatic_application'] is False
actual={str(p.relative_to(P)) for p in P.rglob('*') if p.is_file() and p.name!='manifest.json' and '__pycache__'not in str(p)}
assert actual==set(m['files']),('unexpected/missing file',actual^set(m['files']))
for n,v in m['files'].items():
 p=P/n; assert p.stat().st_size==v['bytes'] and sha(p)==v['sha256'],n
assert not any('.input-cache' in n or pathlib.PurePosixPath(n).is_absolute() for n in actual)
r=load(P/'results.json'); assert r['research_completed_targets']==r['independently_reviewed_targets']==3
assert r['counts']=={'supported_generalized_water_identity':2,'whole_polygon_scope_hold':1}
assert r['historical504_detailed_ledger_restored'] is False and r['current_live_deployment_checked'] is False
assert r['automatic_application'] is False and r['product_changes'] is False and r['whole_polygon_product_name_approvals']==0
assert [x['source_id'] for x in r['records']]==['1159109497','1159106899','1159107065']
for x in r['records']:assert x['korean_name']is None and x['whole_polygon_scalar_name']is None and x['automatic_application']is False and x['product_application']is False
assert sha(P/r['review_file'])==r['review_file_sha256']
rm=load(P/'review/review-manifest.json')
for n,v in rm['files'].items():assert sha(P/'review'/n)==v['sha256'] and(P/'review'/n).stat().st_size==v['bytes']
rights=load(P/'source-publication-rights.json');pdf=P/rights['file']
assert rights['official_license_value']=='Public Domain' and sha(pdf)==rights['sha256']=='5d37dfd13f863be39cf4d1c0de30dd14476e85c2e50536ad2f6ed7d3fb54e117'
assert [n for n in actual if n.endswith('.pdf')]==[rights['file']]
for script in ['validate-geometry-reference.py','review/validate-independent-review.py']:
 q=subprocess.run([sys.executable,str(P/script)],capture_output=True,text=True,cwd=P)
 assert q.returncode==0,(script,q.stdout,q.stderr)
 assert json.loads(q.stdout)['status']=='passed'
print(json.dumps({'result':'PASS','batch':'r01','files_verified':len(actual),'published_input_bytes':sum(v['bytes']for v in m['files'].values()),'research_completed':3,'counts':r['counts'],'positions':382,'manifest_sha256':sha(P/'manifest.json'),'current_live_deployment_checked':False,'full_lost_ledger_restored':False,'remote_save_verified_by_this_script':False,'network_calls':0,'automatic_application':False}))
