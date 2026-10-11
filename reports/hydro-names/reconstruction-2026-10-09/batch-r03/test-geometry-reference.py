#!/usr/bin/env python3
"""Targeted durable checks, optional cache replay, and selected corrupt fixtures."""
import argparse,hashlib,json,pathlib,shutil,subprocess,sys,tempfile

def receipt(data): return {'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
def write(p,v): p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parent);p.add_argument('--input-cache',type=pathlib.Path);a=p.parse_args();root=a.directory.resolve();validator=root/'validate-geometry-reference.py'
 assert validator.exists(),'River durable validation has not been implemented.'
 def run(d,extra=[]):return subprocess.run([sys.executable,str(validator),'--directory',str(d)]+extra,capture_output=True,text=True)
 positive=run(root);assert positive.returncode==0,positive.stderr;passes=[json.loads(positive.stdout)]
 if a.input_cache:
  replay=run(root,['--input-cache',str(a.input_cache.resolve())]);assert replay.returncode==0,replay.stderr;passes.append(json.loads(replay.stdout))
 cases=[]
 for case in ['incorrect_join','lost_tributary','changed_geometry_hash','source_order_changed','missing_fragment','pack_offset_changed','invented_original_equality','invented_live_equality','false_coordinate_redistribution']:
  with tempfile.TemporaryDirectory() as d:
   d=pathlib.Path(d)
   for name in ['geometry-reference.json','selected-river-metadata.json','selected-inventory-records.json','source-reach-manifest.json','selected-pack-receipts.json','geometry-publication-rights.json','geometry-request-receipts.json','extract-baseline-geometries.mjs']:
    shutil.copyfile(root/name,d/name)
   ref=json.loads((d/'geometry-reference.json').read_text());name=None
   if case in ['incorrect_join','lost_tributary']:
    name='selected-river-metadata.json';x=json.loads((d/name).read_text());x['fragments'][0]['logical_fid']+=1 if case=='incorrect_join' else 0
    if case=='lost_tributary':x['fragments'][5]['role']='mainstem'
   elif case=='changed_geometry_hash':
    name='selected-river-metadata.json';x=json.loads((d/name).read_text());x['fragments'][0]['geometry']['canonical_geometry_sha256']='0'*64
   elif case=='source_order_changed':
    name='source-reach-manifest.json';x=json.loads((d/name).read_text());ids=x['groups'][0]['fragments'][0]['source_ids_ordered'];ids[0],ids[1]=ids[1],ids[0]
   elif case=='missing_fragment':
    name='selected-river-metadata.json';x=json.loads((d/name).read_text());x['fragments'].pop()
   elif case=='pack_offset_changed':
    name='selected-pack-receipts.json';x=json.loads((d/name).read_text());x[0]['offset']+=1
   elif case=='invented_original_equality':ref['original_hydrorivers_geometry']['coordinate_equality_verified']=True
   elif case=='invented_live_equality':ref['baseline']['current_live_deployment_checked']=True
   else:
    name='geometry-publication-rights.json';x=json.loads((d/name).read_text());x['complete_coordinate_arrays_in_public_package']=True
   if name:
    write(d/name,x);ref['artifacts'][name]=receipt((d/name).read_bytes())
   write(d/'geometry-reference.json',ref)
   r=run(d);assert r.returncode!=0 and 'AssertionError' in r.stderr,case+': '+r.stderr;cases.append({'case':case,'rejected':True})
 if a.input_cache:
  with tempfile.TemporaryDirectory() as d:
   d=pathlib.Path(d)
   for f in a.input_cache.resolve().iterdir():
    if f.name!='worker.js':(d/f.name).symlink_to(f)
   (d/'worker.js').write_bytes((a.input_cache/'worker.js').read_bytes()+b'\n')
   r=run(root,['--input-cache',str(d)]);assert r.returncode!=0 and 'worker.js' in r.stderr;cases.append({'case':'modified_cached_decoder','rejected':True})
 print(json.dumps({'status':'passed','validation_runs':passes,'corrupt_fixtures':cases,'no_external_requests':True},indent=2))
if __name__=='__main__':main()
