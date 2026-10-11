#!/usr/bin/env python3
"""Offline positive and semantic-corruption checks for remaining-queue recovery."""
import argparse,copy,importlib.util,json,pathlib,sys
sys.dont_write_bytecode=True
P=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('remaining_queue',P/'recover-remaining-queue.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--inventory',type=pathlib.Path,required=True);ap.add_argument('--index',type=pathlib.Path,default=P/'reconstruction-index.json');a=ap.parse_args()
 blob=a.inventory.read_bytes();index=json.loads(a.index.read_text());good=m.rebuild(blob,index,True)
 ids=good['remaining_aw_ids'];assert len(ids)==len(set(ids))==good['remaining_without_reconstructed_record']
 assert not(set(ids)&{x['aw_id']for x in index['records']})
 tests=[]
 def reject(name,mutate=None,body=None):
  bad=copy.deepcopy(index)
  if mutate:mutate(bad)
  try:m.rebuild(blob if body is None else body,bad,False)
  except (AssertionError,KeyError,ValueError,TypeError):tests.append({'case':name,'rejected':True})
  else:raise AssertionError('accepted corruption: '+name)
 reject('altered_initial_compressed_bytes',body=blob+b'\x00')
 def duplicate(d):
  d['records'].append(copy.deepcopy(d['records'][0]));d['total_distinct_reconstructed_targets']+=1
  d['remaining_queue_recovery']['reviewed_index_targets']+=1;d['remaining_queue_recovery']['remaining_without_reconstructed_record']-=1
 reject('duplicate_reviewed_ID_with_rebased_counts',duplicate)
 reject('unknown_reviewed_ID',lambda d:d['records'][0].update(aw_id='hydro-system:0'))
 reject('wrong_target_type',lambda d:d['records'][0].update(category='river_group'if d['records'][0]['category']=='lake'else'lake'))
 reject('automatic_application_enabled',lambda d:d['records'][0].update(automatic_application=True))
 reject('remaining_total_miscount',lambda d:d['remaining_queue_recovery'].update(remaining_without_reconstructed_record=0))
 reject('remaining_type_miscount',lambda d:d['remaining_queue_recovery']['remaining_without_reconstructed_record_by_type'].update(lake=0))
 reject('historically_never_reviewed_false_claim',lambda d:d['remaining_queue_recovery'].update(historical_never_reviewed_count_claimed=True))
 reject('initial_inventory_provenance_hash_changed',lambda d:d['remaining_queue_recovery']['initial_inventory'].update(sha256='0'*64))
 reject('pending_access_list_dropped',lambda d:d.update(pending_access_ids=[]))
 reject('pending_access_count_miscount',lambda d:d.update(pending_access_count=0))
 reject('pending_access_unknown_ID',lambda d:d.update(pending_access_ids=['lakes_base:0']))
 def change_pending(d,**kw):next(r for r in d['records']if r['aw_id']==d['pending_access_ids'][0]).update(kw)
 reject('pending_access_marked_complete',lambda d:change_pending(d,full_feature_correspondence_review_completed=True))
 reject('pending_access_follow_up_dropped',lambda d:change_pending(d,follow_up_required=False))
 reject('scope_hold_list_dropped',lambda d:d.update(scope_hold_ids=[]))
 reject('pending_material_list_dropped',lambda d:d.update(pending_material_ids=[]))
 reject('pending_material_count_miscount',lambda d:d.update(pending_material_count=0))
 reject('pending_any_list_dropped',lambda d:d.update(pending_any_ids=[]))
 def change_material(d,**kw):next(r for r in d['records']if r['aw_id']==d['pending_material_ids'][0]).update(kw)
 reject('pending_material_marked_complete',lambda d:change_material(d,full_feature_correspondence_review_completed=True))
 reject('pending_material_relabelled_access_failure',lambda d:change_material(d,source_access_limited=True))
 reject('pending_material_follow_up_dropped',lambda d:change_material(d,follow_up_required=False))
 print(json.dumps({'status':'passed','positive_rebuild':{k:v for k,v in good.items()if k!='remaining_aw_ids'},'complete_remaining_IDs_rebuilt':len(ids),'no_reviewed_IDs_in_remaining':True,'semantic_corrupt_fixtures':tests,'semantic_corrupt_fixture_count':len(tests),'network_calls':0,'input_files_changed':False},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
