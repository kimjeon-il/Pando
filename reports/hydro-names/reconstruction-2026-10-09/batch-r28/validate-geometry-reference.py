#!/usr/bin/env python3
"""Validate included bounded river summaries only; no omitted-input replay."""
import argparse,hashlib,json,math,pathlib,sys
sys.dont_write_bytecode=True
PINS = {'files': {'selected-river-metadata.json': 'f51629c597b171384cd2ed0078330b31b80da12a520df5ff88825e4a909eabe3', 'selected-inventory-records.json': 'b313c4b6251e893e597e714e5881e48f16d89bc620cfa8548ffd4826a2b5245d', 'geometry-duplicate-check.json': '72c004b8747a63174c6dd606803b117e3dfdad8ecc8dc50108bf14edc235f4b4', 'geometry-publication-rights.json': '51f5fe8f3347871da45d1b197ba498324e9e3541a54bd46dcd920ab0688dfe92'}, 'expected_reference': {'schema': 'hydro-river-geometry-summary-public-v1', 'batch': 'r28', 'created_at_utc': '2026-10-09T21:50:06.503750Z', 'scope_system_ids': ['50691388', '50738894'], 'scope_aw_ids': ['hydro-system:50691388', 'hydro-system:50738894'], 'baseline': {'repository': 'kimjeon-il/Pando', 'git_commit': 'fd6744f5e72a0c1a107452dbde6d416ab57237db', 'hydro_version': '0.13.1', 'current_live_deployment_checked': False, 'current_live_deployment_equality_claimed': False}, 'validation_scope': 'included-summary-evidence-only', 'identity_domains': 'MAIN_RIV systemId, awId, logical_fid and individual geometry fid are distinct. FIDs apply only to the pinned baseline.', 'groups': [{'aw_id': 'hydro-system:50691388', 'system_id': '50691388', 'logical_fid': 2023, 'geometry_fids': [6979], 'role_sequence': ['mainstem'], 'part_count': 30, 'bounds': [152.691667, -29.06875, 153.592891, -28.354167], 'fragment_count': 1, 'position_count': 258, 'source_reach_count': 30, 'fragment_part_counts': [30], 'fragment_position_counts': [258], 'minimum_stage': 3}, {'aw_id': 'hydro-system:50738894', 'system_id': '50738894', 'logical_fid': 2085, 'geometry_fids': [7043], 'role_sequence': ['mainstem'], 'part_count': 29, 'bounds': [152.20625, -31.48125, 152.916629, -31.139583], 'fragment_count': 1, 'position_count': 192, 'source_reach_count': 29, 'fragment_part_counts': [29], 'fragment_position_counts': [192], 'minimum_stage': 3}], 'public_coordinate_policy': 'Full rendered coordinates, per-part paths and omitted-input fingerprints are not published.', 'original_hydrorivers_geometry': {'source_coordinate_equality_verified': False, 'reach_boundary_coordinate_mapping_verified': False}, 'name_scope': {'name_verdict_established': False, 'representative_name_automatically_applies_to_tributaries': False, 'automatic_application': False, 'historical_names_used_as_identity_evidence': False}, 'historical_private_verification': {'all_selected_fragments_decoded': True, 'ordered_baseline_positions_and_metadata_checked': True, 'original_selected_inventory_join_checked': True, 'public_validator_reproduces_these_omitted_input_checks': False}, 'limits': ['The public validator checks only included summaries, metadata and file hashes. It cannot reproduce omitted geometry, original inventory or production-decoder checks.', 'Private verification decoded the complete selected baseline groups without geometry repair, simplification, reordering or reversal.', 'Original HydroRIVERS source-coordinate equality and exact source reach-to-rendered-part mapping remain unverified.', 'A group includes only the represented baseline fragments, not an independently verified complete catchment network.', 'Placeholder names and geometry summaries do not establish geographic names. A mainstem name does not automatically cover tributaries.', 'No current deployment check or maximal topology audit was performed.']}}

def receipt(p):
 b=p.read_bytes();return {'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
def main():
 if not __debug__:raise RuntimeError('Python -O is unsupported because it disables required assertions.')
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parent);p.add_argument('--check-component-manifest',action='store_true');a=p.parse_args();root=a.directory.resolve()
 assert not list(root.glob('*.geojson')) and not list(root.glob('*.bin')) and not (root/'worker.js').exists(),'prohibited public geometry file'
 ref=json.loads((root/'geometry-reference.json').read_text())
 assert {k:v for k,v in ref.items() if k!='artifacts'}==PINS['expected_reference'],'reference summary pin'
 assert set(ref['artifacts'])==set(PINS['files']),'included file set'
 for name,digest in PINS['files'].items():
  assert pathlib.Path(name).name==name,'bounded included filename'
  actual=receipt(root/name);assert actual['sha256']==digest,'included file pin: '+name
  assert actual==ref['artifacts'][name],'included file receipt: '+name
 meta=json.loads((root/'selected-river-metadata.json').read_text());inv=json.loads((root/'selected-inventory-records.json').read_text());dup=json.loads((root/'geometry-duplicate-check.json').read_text());rights=json.loads((root/'geometry-publication-rights.json').read_text())
 awids=ref['scope_aw_ids'];ids=ref['scope_system_ids'];groups=ref['groups'];fragments=meta['fragments']
 assert meta['scope_aw_ids']==inv['scope_aw_ids']==rights['scope_aw_ids']==awids
 assert meta['scope_system_ids']==inv['scope_system_ids']==ids
 assert len(fragments)==2 and len(set(f['fid'] for f in fragments))==2,'complete included fragment summaries'
 assert [f['fid'] for f in fragments]==[fid for g in groups for fid in g['geometry_fids']],'included fragment order'
 assert len(groups)==len(inv['records'])==2,'two included existing targets'
 for group,row in zip(groups,inv['records']):
  fs=[f for f in fragments if f['aw_id']==group['aw_id']]
  assert [f['fragment_index'] for f in fs]==list(range(group['fragment_count'])),'included fragment indices'
  assert all(f['fragment_count']==group['fragment_count'] and f['logical_fid']==group['logical_fid'] and f['system_id']==group['system_id'] for f in fs),'included identifiers'
  assert [f['role'] for f in fs]==group['role_sequence'],'included role sequence'
  assert [f['part_count'] for f in fs]==group['fragment_part_counts'] and sum(group['fragment_part_counts'])==group['part_count'],'included part counts'
  assert [f['position_count'] for f in fs]==group['fragment_position_counts'] and sum(group['fragment_position_counts'])==group['position_count'],'included position counts'
  assert sum(f['source_reach_count'] for f in fs)==group['source_reach_count'],'included reach counts'
  bounds=[min(f['bounds'][0] for f in fs),min(f['bounds'][1] for f in fs),max(f['bounds'][2] for f in fs),max(f['bounds'][3] for f in fs)]
  assert bounds==group['bounds']==row['bbox'],'included group bounds'
  assert row['aw_id']==group['aw_id'] and row['logical_fid']==group['logical_fid'] and row['geometry_fids']==group['geometry_fids'] and row['geometry_count']==group['fragment_count'],'included inventory join'
  assert row['system_id']==group['system_id'] and row['source_reach_count']==group['source_reach_count'] and row['display_names']==['미명명 수계 '+group['system_id']],'included inventory name and count join'
  assert row['category']=='river' and row['classification']=='no_meaningful_name_in_deployed_data' and row['has_korean_display'] is False,'included inventory eligibility'
  assert min(f['stage'] for f in fs)==group['minimum_stage']==row['minimum_stage'],'included stages'
  for f in fs:
   assert len(f['position_counts_by_part'])==f['part_count']==f['source_reach_count'] and sum(f['position_counts_by_part'])==f['position_count'] and all(type(n) is int and n>=2 for n in f['position_counts_by_part']),'included ordered part position counts'
   assert f['baseline_detail_name_fields_exact']=={} and f['baseline_core_name_fields_exact']==f['baseline_name_fields_exact']=={'name':'미명명 수계 '+f['system_id'],'mainstemNameKo':'미명명 수계 '+f['system_id']},'included exact name state'
   assert f['geometry_type']=='MultiLineString' and f['source_label']=='HydroRIVERS 1.0' and f['terminal_class']=='sea','included fragment type and terminal'
   assert f['research_name_ko'] is None and f['automatic_application'] is False,'included name limits'
   assert len(f['bounds'])==4 and all(math.isfinite(v) for v in f['bounds']),'included finite bounds'
 prior=dup['previous_aw_ids_in_index_order'];delta=dup['current_batch_delta']
 assert len(prior)==len(set(prior))==dup['previous_target_count']==81 and dup['prior_index_duplicate_count']==0,'included prior81 uniqueness'
 assert dup['mode']=='existing_scope_hold_reassessment' and dup['selected_aw_ids']==awids and dup['selected_unique_count']==2,'included reassessment selection'
 assert [x for x in awids if x in prior]==dup['intersection_aw_ids']==awids and dup['expected_existing_membership_count']==2 and dup['existing_membership_is_index_duplicate'] is False,'expected existing membership'
 assert delta['selected_existing_targets_reassessed']==2 and delta['selected_current_target_types']=={'river_group':2} and delta['new_distinct_target_increment']==0,'zero new-ID reassessment delta'
 assert delta['initial_eligible_target_count']==4065 and delta['reconstructed_target_count_before']==delta['reconstructed_target_count_after']==81 and delta['remaining_fresh_reconstruction_queue_before']==delta['remaining_fresh_reconstruction_queue_after']==3984,'included unchanged queue counts'
 assert delta['initial_eligible_target_count']-delta['reconstructed_target_count_after']==delta['remaining_fresh_reconstruction_queue_after'],'included queue arithmetic'
 assert delta['remaining_queue_types_before']==delta['remaining_queue_types_after']=={'river_group':3412,'lake':572},'included unchanged queue types'
 pending=dup['preserved_pending_access_ids'];holds=dup['prior_scope_hold_ids'];unselected=dup['unselected_scope_hold_ids']
 assert len(pending)==len(set(pending))==2 and set(pending)<=set(prior) and not set(pending)&set(awids) and dup['pending_access_reassessment_performed'] is False,'included pending access preservation'
 assert len(holds)==len(set(holds))==24 and set(holds)<=set(prior) and set(awids)<=set(holds) and dup['selected_prior_scope_hold_ids']==awids,'included prior hold membership'
 assert unselected==[x for x in holds if x not in awids] and len(unselected)==22 and dup['unselected_target_geometry_or_naming_revalidation_performed'] is False,'included unselected hold preservation'
 assert dup['post_reassessment_name_verdicts_established_by_geometry_component'] is False,'geometry does not establish naming verdicts'
 assert rights['complete_coordinates_in_public_package'] is rights['per_part_paths_in_public_package'] is rights['source_reach_sequences_in_public_package'] is rights['binary_packs_or_worker_bodies_in_public_package'] is rights['omitted_input_fingerprints_in_public_package'] is rights['original_hydrorivers_standalone_redistribution_clearance_established'] is False,'bounded publication claims'

 if a.check_component_manifest:
  frozen=json.loads((root/'geometry-component-manifest.json').read_text());expected=set(ref['artifacts'])|{'geometry-README.md','geometry-reference.json','validate-geometry-reference.py','test-geometry-reference.py','geometry-validation.json'}
  assert frozen['schema']=='frozen-selected-river-summary-component-public-v1' and frozen['batch']=='r28' and frozen['scope_aw_ids']==awids and frozen['validation_scope']=='included-summary-evidence-only','component scope'
  assert frozen['complete_coordinates_in_public_package'] is frozen['per_part_paths_in_public_package'] is frozen['omitted_input_fingerprints_in_public_package'] is False and frozen['new_external_requests']==0,'component exclusion scope'
  assert set(frozen['files'])==expected,'component file set'
  for name,digest in frozen['files'].items():assert pathlib.Path(name).name==name and receipt(root/name)['sha256']==digest,'component frozen hash'
 print(json.dumps({'status':'passed','validation_scope':'included-summary-evidence-only','scope_aw_ids':awids,'fragment_counts':[g['fragment_count'] for g in groups],'part_counts':[g['part_count'] for g in groups],'position_counts':[g['position_count'] for g in groups],'included_identity_role_name_state_counts_and_bounds_rechecked':True,'included_selected_inventory_summary_join_rechecked':True,'included_existing_target_membership_and_zero_increment_rechecked':True,'prior_index_distinct_target_count':81,'prior_index_duplicate_count':0,'expected_existing_membership_count':2,'new_distinct_target_increment':0,'remaining_queue_count':3984,'preserved_pending_access_count':2,'prior_scope_hold_count':24,'selected_prior_scope_hold_count':2,'unselected_scope_hold_count':22,'post_reassessment_name_verdicts_established':False,'production_decoder_replayed':False,'full_coordinate_order_checks_reproduced':False,'original_hydrorivers_source_equality_verified':False,'original_inventory_or_previous_index_revalidated':False,'frozen_component_hashes_rechecked':bool(a.check_component_manifest),'current_live_deployment_checked':False,'no_external_requests':True,'validation_limit':'Only included summaries, selected metadata and file hashes are validated. Omitted source bodies, full coordinates, decoder dependencies, original inventory and prior-index bytes cannot be reconstructed or checked by this public validator.'}))
if __name__=='__main__':main()
