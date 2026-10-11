#!/usr/bin/env python3
"""Bounded positive/corruption fixtures; read original local inputs without mutation."""
import argparse,copy,hashlib,json,pathlib,shutil,subprocess,sys,tempfile
sys.dont_write_bytecode=True

def receipt(p):b=p.read_bytes();return {'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
def write(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def main():
 if not __debug__:raise RuntimeError('Python -O disables required assertions and is unsupported.')
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parent);p.add_argument('--input-cache',type=pathlib.Path);p.add_argument('--historical-input-root',type=pathlib.Path);p.add_argument('--previous-index',type=pathlib.Path);a=p.parse_args();root=a.directory.resolve();command=[sys.executable,'-B',str(root/'validate-geometry-reference.py')];runs=[]
 def run(d,extra=None):return subprocess.run(command+['--directory',str(d)]+(extra or []),capture_output=True,text=True)
 positive=run(root);assert positive.returncode==0,positive.stderr;runs.append(json.loads(positive.stdout));extra=[]
 for option in ['input_cache','historical_input_root','previous_index']:
  if getattr(a,option):extra+=['--'+option.replace('_','-'),str(getattr(a,option).resolve())]
 if extra:
  positive=run(root,extra);assert positive.returncode==0,positive.stderr;runs.append(json.loads(positive.stdout))
 original=json.loads((root/'geometry-reference.json').read_text());cases=[];before={n:receipt(a.input_cache/n) for n in original['source_assets']} if a.input_cache else {}
 checks=[('logical_fid_changed','selected-river-metadata.json'),('core_name_changed','selected-river-metadata.json'),('detail_name_changed','selected-river-metadata.json'),('fragment_role_changed','selected-river-metadata.json'),('missing_fragment','selected-river-metadata.json'),('part_hash_changed','selected-river-metadata.json'),('part_order_reversed','selected-river-metadata.json'),('part_coordinate_count_changed','selected-river-metadata.json'),('source_render_endpoint_conflated','selected-river-metadata.json'),('source_id_order_changed','source-reach-manifest.json'),('inventory_csv_row_changed','selected-inventory-records.json'),('prior21_duplicate_list_changed','geometry-duplicate-check.json'),('pack_offset_changed','selected-pack-receipts.json'),('false_coordinate_redistribution','geometry-publication-rights.json'),('false_source_equality',None),('false_live_deployment',None),('source_asset_URL_changed',None),('group_coordinate_count_changed',None),('unexpected_public_geojson',None)]
 for case,name in checks:
  with tempfile.TemporaryDirectory() as d:
   d=pathlib.Path(d)
   for n in original['artifacts']:shutil.copyfile(root/n,d/n)
   ref=copy.deepcopy(original);expected=None
   if name:
    x=json.loads((d/name).read_text());expected='fixed artifact pin: '+name
   if case in ['logical_fid_changed','core_name_changed','detail_name_changed','fragment_role_changed','part_hash_changed','part_order_reversed','part_coordinate_count_changed','source_render_endpoint_conflated']:
    r=x['fragments'][0]
    if case=='logical_fid_changed':r['logical_fid']+=1
    elif case=='core_name_changed':r['baseline_core_metadata_exact']['name']='fabricated name'
    elif case=='detail_name_changed':r['baseline_detail_metadata_exact']['mainstemNameKo']='fabricated name'
    elif case=='fragment_role_changed':r['role']='tributary'
    elif case=='part_hash_changed':r['geometry']['ordered_parts'][0]['ordered_coordinate_sha256']='0'*64
    elif case=='part_order_reversed':r['geometry']['ordered_parts'].reverse()
    elif case=='part_coordinate_count_changed':r['geometry']['coordinate_counts_by_part'][0]+=1
    else:r['terminal']['source_endpoint']=r['terminal']['render_endpoint_before_quantization'];r['terminal']['source_endpoint_equals_render_endpoint']=True
   elif case=='missing_fragment':x['fragments'].pop()
   elif case=='source_id_order_changed':ids=x['groups'][0]['fragments'][0]['source_ids_ordered'];ids[0],ids[1]=ids[1],ids[0]
   elif case=='inventory_csv_row_changed':x['records'][0]['inventory_csv_row_exact']['logical_fid']='0'
   elif case=='prior21_duplicate_list_changed':x['previous_aw_ids_in_index_order'][0]=x['selected_aw_ids'][0]
   elif case=='pack_offset_changed':x[0]['offset']+=1;ref['selected_baseline_packs']=x
   elif case=='false_coordinate_redistribution':x['complete_coordinate_arrays_in_public_package']=True
   elif case=='false_source_equality':ref['original_hydrorivers_geometry']['coordinate_equality_verified']=True;expected='original source limit'
   elif case=='false_live_deployment':ref['baseline']['current_live_deployment_checked']=True;expected='current deployment limit'
   elif case=='source_asset_URL_changed':ref['source_assets']['worker.js']['immutable_url']=ref['source_assets']['baseline-manifest.json']['immutable_url'];expected='source asset provenance pins'
   elif case=='group_coordinate_count_changed':ref['groups'][0]['coordinate_count']+=1;expected='group pins'
   elif case=='unexpected_public_geojson':write(d/'unapproved.geojson',{'type':'FeatureCollection','features':[]});expected='raw geometry publication exclusion'
   if name:write(d/name,x);ref['artifacts'][name]=receipt(d/name)
   write(d/'geometry-reference.json',ref);r=run(d)
   assert r.returncode!=0 and 'AssertionError: '+expected in r.stderr,case+': '+r.stderr
   cases.append({'case':case,'rejected':True,'expected_check':expected,'artifact_receipt_updated':bool(name),'separate_reference_field_rebased':case=='pack_offset_changed'})
 if a.input_cache:
  with tempfile.TemporaryDirectory() as d:
   c=pathlib.Path(d)
   for path in a.input_cache.resolve().iterdir():
    if path.name!='worker.js':(c/path.name).symlink_to(path.resolve())
   (c/'worker.js').write_bytes((a.input_cache/'worker.js').read_bytes()+b'\nthrow new Error("Altered worker must never execute");\n')
   out=c/'out.geojson';r=subprocess.run(['node',str(root/'extract-baseline-geometries.mjs'),str(c),str(out)],capture_output=True,text=True)
   assert r.returncode!=0 and 'Verification failed: worker.js' in r.stderr and 'Altered worker must never execute' not in r.stderr and not out.exists()
   cases.append({'case':'altered_production_worker_rejected_before_execution','rejected':True,'decoded_output_written':False})
  assert before=={n:receipt(a.input_cache/n) for n in original['source_assets']},'Original cache changed'
 print(json.dumps({'status':'passed','validation_runs':runs,'corrupt_fixtures':cases,'corrupt_fixture_count':len(cases),'durable_corrupt_fixture_count':len(checks),'original_inputs_unchanged':True,'no_external_requests':True},indent=2))
if __name__=='__main__':main()
