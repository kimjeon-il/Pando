#!/usr/bin/env python3
"""Bounded current-delta corruption checks; no source or geographic replay."""
import copy, importlib.util, json, sys
from pathlib import Path
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
def run_tests():
 spec=importlib.util.spec_from_file_location('r26_review_validator',HERE/'validate-independent-review.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 assert m.validate_records(m.load_records())['status']=='passed'
 cases=[
 ('wrong_target','review',('scope_aw_ids',0),'hydro-system:0000'),
 ('missing_fragment','geometry',('groups',0,'fragment_count'),1),
 ('wrong_parts','review',('findings',1,'part_count'),63),
 ('wrong_positions','source',('complete_group_observations',2,'position_count'),310),
 ('unverified_scalar','review',('findings',0,'whole_group_scalar_name'),'Unapproved River'),
 ('unverified_korean','review',('findings',1,'name_ko'),'unverified'),
 ('all_reach_upgrade','review',('findings',2,'all_reach_names_verified'),True),
 ('geometry_scope_mismatch','source',('complete_group_observations',0,'independent_observation'),'Every reach is approved.'),
 ('access_pending_misclassified','review',('findings',0,'source_access_limited'),True),
 ('pending_erased','review',('preserved_pending_access_ids',),[]),
 ('hold_erased','review',('preserved_scope_hold_ids',),[]),
 ('region_conflated','review',('findings',1,'geographic_disambiguation'),'Queensland, Australia'),
 ('new_acquisition_invented','source',('observations',0,'retrieved_this_batch'),True),
 ('maps_counted_as_independent','source',('distinct_supporting_publications',),3),
 ('private_fingerprint_added','source',('original_body_sha256',),'0'*64),
 ('full_coordinates_added','review',('findings',0,'coordinates'),[[1,2],[3,4]]),
 ('omitted_replay_claimed','review',('historical_review','historical_results_recomputed_by_public_validator'),True),
 ('invalid_timestamp','review',('reviewed_at_utc',),'2026-10-09T20:99:00Z'),
 ('duplicate_prior_id','continuity',('previous_aw_ids_in_index_order',0),'hydro-system:50442438'),
 ('automatic_application','review',('automatic_application',),True)]
 rejected=[]
 for name,doc,path,value in cases:
  d=copy.deepcopy(m.load_records());target=d[doc]
  for k in path[:-1]:target=target[k]
  target[path[-1]]=value
  try:m.validate_records(d)
  except (AssertionError,KeyError,TypeError,ValueError):rejected.append(name)
  else:raise AssertionError('Accepted corrupt current record: '+name)
 try:m.verify_bytes(b'changed',{'bytes':1,'sha256':'0'*64})
 except AssertionError:rejected.append('included_bytes_changed')
 else:raise AssertionError('Accepted changed included bytes')
 return {'status':'passed','semantic_and_integrity_mutations_rejected':rejected,'network_requests':0,'original_map_or_full_path_or_decoder_judgments_reproduced':False}
if __name__=='__main__':print(json.dumps(run_tests(),indent=2))
