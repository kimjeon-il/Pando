#!/usr/bin/env python3
"""Compact current-batch corruption tests. Retained originals remain unchanged."""
import argparse,copy,importlib.util,json,subprocess,sys,tempfile,shutil
from pathlib import Path
sys.dont_write_bytecode=True

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--package',type=Path,default=Path(__file__).resolve().parent.parent);p.add_argument('--local-geometry',type=Path);p.add_argument('--local-source-index',type=Path);p.add_argument('--local-source-root',type=Path);a=p.parse_args();root=a.package
 spec=importlib.util.spec_from_file_location('independent',root/'review/validate-independent-review.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
 report=json.loads(subprocess.run([sys.executable,str(root/'review/validate-independent-review.py'),'--package',str(root)],check=True,capture_output=True,text=True).stdout)
 m.require(report['mode']=='durable_only' and all(report[k] is False for k in ['independent_binary_decoder_replayed','omitted_full_coordinates_rechecked','original_inventory_rechecked','original_prior_index_rechecked','visual_inspection_repeated']) and report['local_evidence_assets_rehashed']==0 and report['geometry_component']['production_decoder_replayed'] is False,'Truthful durable-only scope')
 passed=[]
 def reject(label,fn):
  try:fn()
  except (ValueError,KeyError,IndexError):passed.append(label)
  else:raise AssertionError('Accepted corrupt fixture: '+label)
 v=m.read_json(root/'review/independent-review.json');m.check_verdict(v)
 for label,mutate in [
  ('automatic_application',lambda x:x.update(automatic_application=True)),
  ('whole_group_clearance',lambda x:x['findings'][0].update(whole_group_scalar_application_approved=True)),
  ('per_reach_clearance',lambda x:x['findings'][1].update(whole_reach_name_application_cleared=True)),
  ('unsupported_korean',lambda x:x['findings'][2].update(name_ko='unverified')),
  ('wrong_identifier_domain',lambda x:x['findings'][0].update(logical_fid=7081)),
  ('target_order_reversed',lambda x:x['findings'].reverse()),
  ('historical_verdict_restoration',lambda x:x.update(historical_verdicts_restored=True)),
  ('false_original_coordinate_equality',lambda x:x.update(original_hydrorivers_coordinate_equality_verified=True)),
  ('unsupported_registry_claim',lambda x:x['findings'][1].update(formal_registry_verified=True)),
  ('tributary_distinctions_erased',lambda x:x['findings'][0].update(associated_distinct_river_names=[])),
  ('source_reach_name_boundary_claim',lambda x:x['findings'][2].update(exact_source_reach_name_transitions_verified=True)),
  ('unsupported_continuous_flow',lambda x:x['findings'][0].update(continuous_hydrological_flow_established=True)),
  ('collie_east_name_overstated',lambda x:x['findings'][0].update(eastern_continuation_name_verified=True)),
  ('collie_reservoir_parts_named',lambda x:x['findings'][0].update(reservoir_passage_name_assignment_verified=True)),
  ('warren_tone_distinction_erased',lambda x:x['findings'][1].update(upstream_name_distinction='Warren River')),
  ('tone_warren_part_boundary_invented',lambda x:x['findings'][1].update(tone_warren_transition_verified=True)),
  ('kalgan_tidal_length_projected',lambda x:x['findings'][2].update(tidal_length_applied_to_geometry=True)),
  ('kalgan_harbour_boundary_invented',lambda x:x['findings'][2].update(exact_river_harbour_transition_verified=True)),
  ('uniform_river_name',lambda x:x['findings'][2].update(uniform_river_name_for_group=True)),
  ('invented_system_suffix',lambda x:x['findings'][2].update(candidate_name='Kalgan River system')),
  ('connector_name_inheritance',lambda x:x['findings'][2].update(estuary_or_inlet_connectors_individually_named=True)),
  ('actual_stage_changed',lambda x:x['findings'][1].update(baseline_stage_sequence=[2])),
  ('cumulative_count_inflated',lambda x:x.update(cumulative_distinct_targets=31))]:
  x=copy.deepcopy(v);mutate(x);reject(label,lambda:m.check_verdict(x))
 pins=m.read_json(root/'review/frozen-input-pins.json');ref=m.read_json(root/'geometry-reference.json');d=m.read_json(root/'geometry-duplicate-check.json');d['intersection_aw_ids']=[m.AWIDS[0]];reject('prior_duplicate_added',lambda:m.check_duplicates(d,pins))
 with tempfile.TemporaryDirectory() as tmp:
  tmp=Path(tmp);shutil.copytree(root/'research',tmp/'research');shutil.copytree(root/'review',tmp/'review')
  for n in ['selected-river-metadata.json','geometry-reference.json']:(tmp/n).write_bytes((root/n).read_bytes())
  name='review/source-observations.json';original=(root/name).read_bytes()
  for label,mutate in [
   ('body_hash_replaced_by_derivative',lambda x:x['observations'][0].update(source_body_sha256='0'*64)),
   ('printed_date_replaced_by_upload_year',lambda x:x['observations'][1].update(printed_date='2023-03')),
   ('reused_acquisition_time_overwritten',lambda x:x['observations'][0].update(original_requested_at_utc='2026-10-09T14:00:00+00:00')),
   ('whole_path_geometry_hash_changed',lambda x:x['complete_path_observations'][1].update(geometry_canonical_sha256='0'*64)),
   ('text_page_counted_as_map',lambda x:x['observations'][5].update(map_pixels_viewed=True)),
   ('kalgan_report_year_used_as_publication',lambda x:x['observations'][4].update(printed_date='2019')),
   ('supplement_inflates_support_count',lambda x:x.update(original_naming_source_bodies_rehashed=7)),
   ('supplement_classed_as_supporting_publication',lambda x:x['observations'][-1].update(counted_as_supporting_publication=True)),
   ('registered_overlay_invented',lambda x:x.update(independent_registered_overlay_claimed=True))]:
   x=json.loads(original);mutate(x);(tmp/name).write_text(json.dumps(x));reject(label,lambda:m.check_sources(tmp,pins))
  (tmp/name).write_bytes(original)
  name='research/collie-warren/source-evidence.json';x=m.read_json(tmp/name);x['sources'][1]['retrieved_again_this_batch']=True;(tmp/name).write_text(json.dumps(x));reject('cached_source_falsely_reacquired',lambda:m.check_research(tmp,pins));(tmp/name).write_bytes((root/name).read_bytes())
  pin=next(e for e in pins['package_inputs'] if e['file']==name);(tmp/name).write_bytes((root/name).read_bytes()+b' ');reject('frozen_source_bytes_changed',lambda:m.checked(tmp/name,pin))
  if a.local_geometry:
   fs=m.read_json(a.local_geometry)['features'];m.validate_features(fs,root,ref)
   for label,mutate in [
    ('local_fragment_missing',lambda x:x.pop(2)),
    ('local_role_changed',lambda x:x[0]['properties'].update(role='lake_passage')),
    ('local_terminal_removed',lambda x:x[1]['properties'].pop('terminal')),
    ('local_part_order_reversed',lambda x:x[0]['geometry']['coordinates'].reverse()),
    ('local_interior_coordinate_changed',lambda x:x[1]['geometry']['coordinates'][10][1].__setitem__(0,x[1]['geometry']['coordinates'][10][1][0]+0.000001)),
    ('local_source_ids_reversed',lambda x:x[2]['properties'].update(sourceId=','.join(reversed(x[2]['properties']['sourceId'].split(',')))) )]:
    x=copy.deepcopy(fs);mutate(x);reject(label,lambda:m.validate_features(x,root,ref))
  if a.local_source_index or a.local_source_root:
   m.require(a.local_source_index and a.local_source_root,'Local source pair');index={e['id']:e for e in m.read_json(a.local_source_index)};pin=next(e for e in pins['local_evidence_assets'] if e['kind']=='original_source_body');q=a.local_source_root/index[pin['id']]['local_file'];data=m.checked(q,pin);(tmp/'altered.bin').write_bytes(data[:-1]+bytes([data[-1]^1]));reject('local_original_body_byte_changed',lambda:m.checked(tmp/'altered.bin',pin))
 print(json.dumps(dict(status='passed',scope_aw_ids=m.AWIDS,durable_only_scope_truthful=True,corrupt_fixtures_rejected=len(passed),fixtures=passed,local_geometry_fixtures_run=bool(a.local_geometry),local_original_byte_fixture_run=bool(a.local_source_index),network_requests=0,original_inputs_modified=False),indent=2))
if __name__=='__main__':main()
