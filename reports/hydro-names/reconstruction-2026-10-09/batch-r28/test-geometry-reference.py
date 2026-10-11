#!/usr/bin/env python3
"""Offline corruption tests for the included r28 two-target reassessment summaries only."""
import argparse,copy,hashlib,json,pathlib,shutil,subprocess,sys,tempfile
sys.dont_write_bytecode=True

def receipt(p):b=p.read_bytes();return {'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
def write(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def change(v,path,value):
 for k in path[:-1]:v=v[k]
 v[path[-1]]=value

def main():
 if not __debug__:raise RuntimeError('Python -O is unsupported because it disables required assertions.')
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parent);a=p.parse_args();root=a.directory.resolve();cmd=[sys.executable,'-B',str(root/'validate-geometry-reference.py')]
 assert (root/'validate-geometry-reference.py').is_file(),'public summary validator is missing'
 ref=json.loads((root/'geometry-reference.json').read_text());names=list(ref['artifacts'])+['geometry-reference.json'];before={n:receipt(root/n) for n in names}
 run=subprocess.run(cmd+['--directory',str(root)],capture_output=True,text=True);assert run.returncode==0,run.stderr;positive=json.loads(run.stdout)
 meta='selected-river-metadata.json';inv='selected-inventory-records.json';dup='geometry-duplicate-check.json';rights='geometry-publication-rights.json';reference='geometry-reference.json'
 cases=[
 ('fragment_fid_changed',meta,['fragments',0,'fid'],0),
 ('one_fragment_count_changed',meta,['fragments',0,'fragment_count'],2),
 ('mainstem_role_changed',meta,['fragments',0,'role'],'tributary'),
 ('ordered_part_position_count_changed',meta,['fragments',0,'position_counts_by_part',0],1),
 ('bounds_changed',meta,['fragments',1,'bounds',0],0),
 ('detail_absent_name_inserted',meta,['fragments',1,'baseline_detail_name_fields_exact'],{'name':'fabricated'}),
 ('inventory_logical_fid_changed',inv,['records',1,'logical_fid'],0),
 ('inventory_placeholder_display_changed',inv,['records',0,'display_names'],['fabricated']),
 ('expected_existing_overlap_removed',dup,['intersection_aw_ids'],[]),
 ('prior_index_duplicate_inserted',dup,['previous_aw_ids_in_index_order',0],'hydro-system:50691388'),
 ('false_new_distinct_increment',dup,['current_batch_delta','new_distinct_target_increment'],2),
 ('remaining_queue_changed',dup,['current_batch_delta','remaining_fresh_reconstruction_queue_after'],3982),
 ('pending_access_ID_changed',dup,['preserved_pending_access_ids',0],'hydro-system:50691388'),
 ('unselected_hold_ID_changed',dup,['unselected_scope_hold_ids',0],'hydro-system:50738894'),
 ('group_position_count_changed',reference,['groups',1,'position_count'],191),
 ('false_public_decoder_replay_claim',reference,['historical_private_verification','public_validator_reproduces_these_omitted_input_checks'],True),
 ('rights_clearance_claim_changed',rights,['original_hydrorivers_standalone_redistribution_clearance_established'],True),
 ('fragment_omitted',meta,None,'omit'),
 ('fragment_duplicated',meta,None,'duplicate'),
 ('raw_coordinate_file_added',None,None,None),
 ]
 results=[]
 for label,name,path,value in cases:
  with tempfile.TemporaryDirectory() as temp:
   target=pathlib.Path(temp)
   for n in names:shutil.copyfile(root/n,target/n)
   r=copy.deepcopy(ref)
   if name:
    v=r if name==reference else json.loads((target/name).read_text())
    if path:
     original=copy.deepcopy(v);change(v,path,value);assert v!=original,'no-op mutation: '+label
    elif value=='omit':v['fragments'].pop()
    elif value=='duplicate':v['fragments'].append(copy.deepcopy(v['fragments'][0]))
    elif value=='reverse':v['fragments'].reverse()
    if name!=reference:write(target/name,v);r['artifacts'][name]=receipt(target/name)
   else:(target/'selected-baseline-rendered-geometries.geojson').write_text('{"type":"FeatureCollection","features":[]}')
   write(target/reference,r)
   run=subprocess.run(cmd+['--directory',str(target)],capture_output=True,text=True)
   expected='prohibited public geometry file' if not name else ('reference summary pin' if name==reference else 'included file pin: '+name)
   assert run.returncode!=0 and 'AssertionError: '+expected in run.stderr,'Unexpected corruption result '+label+'\n'+run.stderr
   results.append({'case':label,'rejected':True,'expected_check':expected,'editable_artifact_receipt_rebased':bool(name and name!=reference)})
 assert before=={n:receipt(root/n) for n in names},'included inputs changed'
 for script in ['validate-geometry-reference.py','test-geometry-reference.py']:
  run=subprocess.run([sys.executable,'-B',str(root/script),'--help'],capture_output=True,text=True)
  assert run.returncode==0 and not any(x in run.stdout for x in ['--input-cache','--previous-index','--historical-input-root']),'private replay interface exposed'
 print(json.dumps({'status':'passed','validation_scope':'included-summary-evidence-only','validation_runs':[positive],'corrupt_fixtures':results,'corrupt_fixture_count':len(results),'durable_corrupt_fixture_count':len(results),'corruption_test_scope':'Included summary changes rejected by independent fixed pins, plus prohibited raw-coordinate filename; no omitted-input replay.','included_input_files_unchanged':True,'omitted_input_replay_interfaces_absent':True,'full_coordinate_checks_reproduced':False,'no_external_requests':True},indent=2))
if __name__=='__main__':main()
