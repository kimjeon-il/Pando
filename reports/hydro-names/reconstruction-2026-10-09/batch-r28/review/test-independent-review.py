#!/usr/bin/env python3
"""Bounded reassessment-record corruption tests; no omitted geographic replay."""
import copy,importlib.util,json,sys
from pathlib import Path
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
def run_tests():
 s=importlib.util.spec_from_file_location('review',HERE/'validate-independent-review.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);assert m.validate_records(m.load_records())['status']=='passed'
 cases=[('wrong_id','review',('scope_aw_ids',0),'hydro-system:0000'),('false_new_coverage','review',('current_batch_increment',),2),('inflated_total','review',('cumulative_distinct_targets',),83),('wrong_count','review',('findings',1,'part_count'),30),('path_scope_erased','source',('complete_group_observations',0,'independent_observation'),'All reaches named.'),('scalar_name','review',('findings',0,'whole_group_scalar_name'),'Richmond River'),('every_reach','review',('findings',1,'all_reach_names_verified'),True),('lost_pending','review',('preserved_pending_access_ids',),[]),('lost_prior_hold_history','review',('prior_scope_hold_ids',),[]),('edition_count_as_authorities','source',('independent_source_groups',),2),('acquisition_erased','source',('successful_new_source_edition_acquisitions',),0),('omitted_replay','review',('historical_review','historical_results_recomputed_by_public_validator'),True),('unselected_history_reaudit','review',('unselected_prior_target_source_or_geometry_reaudit_performed',),True),('private_fingerprint','source',('original_body_sha256',),'0'*64),('full_coordinates','review',('findings',0,'coordinates'),[[1,2],[3,4]]),('automatic_application','review',('automatic_application',),True)]
 rejected=[]
 for name,doc,path,val in cases:
  d=copy.deepcopy(m.load_records());t=d[doc]
  for k in path[:-1]:t=t[k]
  t[path[-1]]=val
  try:m.validate_records(d)
  except (AssertionError,KeyError,TypeError,ValueError):rejected.append(name)
  else:raise AssertionError('Corrupt record accepted: '+name)
 try:m.verify_bytes(b'changed',{'bytes':1,'sha256':'0'*64})
 except AssertionError:rejected.append('included_byte_integrity')
 else:raise AssertionError('Changed included bytes accepted')
 return {'status':'passed','semantic_and_integrity_mutations_rejected':rejected,'network_requests':0,'original_map_or_full_path_or_decoder_judgments_reproduced':False}
if __name__=='__main__':print(json.dumps(run_tests(),indent=2))
