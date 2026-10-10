#!/usr/bin/env python3
"""Offline corruption tests of included r39 lake metadata; no full-geometry replay."""
import argparse,copy,hashlib,json,pathlib,shutil,subprocess,sys,tempfile
sys.dont_write_bytecode=True

def receipt(p):
 b=p.read_bytes();return {'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
def write(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def change(v,path,value):
 for k in path[:-1]:v=v[k]
 v[path[-1]]=value

def main():
 if not __debug__:raise RuntimeError('Python -O is unsupported because it disables required assertions.')
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parent);a=p.parse_args();root=a.directory.resolve();cmd=[sys.executable,'-B',str(root/'validate-geometry-reference.py')]
 assert (root/'validate-geometry-reference.py').is_file(),'public metadata validator is missing'
 ref=json.loads((root/'geometry-reference.json').read_text());names=list(ref['artifacts'])+['geometry-reference.json'];before={n:receipt(root/n) for n in names}
 run=subprocess.run(cmd+['--directory',str(root)],capture_output=True,text=True);assert run.returncode==0,run.stderr;positive=json.loads(run.stdout)
 inv='selected-inventory-records.json';dup='geometry-duplicate-check.json';rights='geometry-publication-rights.json';reference='geometry-reference.json'
 cases=[
 ('source_identifier_changed',reference,['selected_features',0,'source_id'],'0'),
 ('baseline_fid_changed',reference,['selected_features',0,'baseline_fid'],0),
 ('polygon_part_count_changed',reference,['selected_features',0,'source_geometry','polygon_part_count'],3),
 ('ring_count_changed',reference,['selected_features',1,'baseline_rendered_geometry','ring_counts_by_part'],[2]),
 ('ordered_ring_position_count_changed',reference,['selected_features',1,'baseline_rendered_geometry','coordinate_counts_by_part_and_ring',0,0],35),
 ('bounds_changed',reference,['selected_features',2,'baseline_rendered_geometry','bbox',0],0),
 ('blank_source_name_filled',reference,['selected_features',0,'source_name_fields_exact','name_ko'],'fabricated'),
 ('absent_detail_name_inserted',reference,['selected_features',2,'baseline_detail_name_fields_exact'],{'name':'fabricated'}),
 ('false_public_replay_claim',reference,['historical_private_verification','public_validator_reproduces_these_omitted_input_checks'],True),
 ('inventory_logical_fid_changed',inv,['records',1,'logical_fid'],0),
 ('inventory_placeholder_display_changed',inv,['records',0,'display_names'],['fabricated']),
 ('false_prior_overlap_inserted',dup,['intersection_aw_ids'],['lakes_base:1159109819']),
 ('prior_ID_duplicated',dup,['previous_aw_ids_in_index_order',0],'lakes_base:1159108993'),
 ('new_target_increment_changed',dup,['current_batch_delta','new_distinct_target_increment'],2),
 ('remaining_queue_changed',dup,['current_batch_delta','remaining_fresh_reconstruction_queue_after'],3982),
 ('pending_access_ID_changed',dup,['preserved_pending_access_ids',0],'lakes_base:1159109819'),
 ('prior_hold_ID_changed',dup,['preserved_scope_hold_ids',0],'lakes_base:1159111345'),
 ('false_public_coordinates_claim',rights,['complete_coordinates_in_public_package'],True),
 ('lake_omitted',reference,None,'omit'),
 ('lake_order_reversed',reference,None,'reverse'),
 ('raw_coordinate_file_added',None,None,None),
 ]
 results=[]
 for label,name,path,value in cases:
  with tempfile.TemporaryDirectory() as temp:
   target=pathlib.Path(temp)
   for n in names:shutil.copyfile(root/n,target/n)
   r=copy.deepcopy(ref)
   if name:
    v=r if name==reference else json.loads((target/name).read_text());original=copy.deepcopy(v)
    if path:change(v,path,value)
    elif value=='omit':v['selected_features'].pop()
    elif value=='reverse':v['selected_features'].reverse()
    assert v!=original,'no-op mutation: '+label
    if name!=reference:write(target/name,v);r['artifacts'][name]=receipt(target/name)
   else:(target/'selected-baseline-rendered-geometries.geojson').write_text('{"type":"FeatureCollection","features":[]}')
   write(target/reference,r)
   run=subprocess.run(cmd+['--directory',str(target)],capture_output=True,text=True)
   expected='prohibited public geometry file' if not name else ('reference metadata pin' if name==reference else 'included file pin: '+name)
   assert run.returncode!=0 and 'AssertionError: '+expected in run.stderr,'Unexpected corruption result '+label+'\n'+run.stderr
   results.append({'case':label,'rejected':True,'expected_check':expected,'editable_artifact_receipt_rebased':bool(name and name!=reference)})
 assert before=={n:receipt(root/n) for n in names},'included inputs changed'
 for script in ['validate-geometry-reference.py','test-geometry-reference.py']:
  run=subprocess.run([sys.executable,'-B',str(root/script),'--help'],capture_output=True,text=True)
  assert run.returncode==0 and not any(x in run.stdout for x in ['--input-cache','--previous-index','--historical-input-root']),'private replay interface exposed'
 print(json.dumps({'status':'passed','validation_scope':'included-summary-evidence-only','validation_runs':[positive],'corrupt_fixtures':results,'corrupt_fixture_count':len(results),'durable_corrupt_fixture_count':len(results),'corruption_test_scope':'Independent fixed pins reject included metadata changes; one prohibited raw-coordinate filename is tested. No omitted-input replay.','included_input_files_unchanged':True,'omitted_input_replay_interfaces_absent':True,'full_coordinate_checks_reproduced':False,'no_external_requests':True},indent=2))
if __name__=='__main__':main()
