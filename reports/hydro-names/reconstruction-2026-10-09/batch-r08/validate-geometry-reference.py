#!/usr/bin/env python3
"""Offline factual river checks, with optional immutable-cache production replay."""
import argparse,csv,gzip,hashlib,importlib.util,io,json,math,pathlib,subprocess,sys,tempfile
sys.dont_write_bytecode=True
PINS = {'scope_system_ids': ['50538951', '50631583', '50691033'], 'scope_aw_ids': ['hydro-system:50538951', 'hydro-system:50631583', 'hydro-system:50691033'], 'fids': [6821, 6900, 6978], 'logical_fids': [1882, 1956, 2022], 'parts': [209, 79, 88], 'coordinate_counts': [1038, 483, 522], 'artifacts': {'geometry-support.py': '5427afc9c6d1ed13947f6ca08b3fe7532dd7884717d44f691b50d0d5f479bd12', 'selected-river-metadata.json': '78768e0be1c7ce8ea859afcb6c3cf831981401704b68b077e2ff4e165f470dc3', 'source-reach-manifest.json': '87da029a9b2089db9f418c21edd35cf4dc2dc9d2bbc2e9f3e41d4d3bdd7f56d0', 'selected-inventory-records.json': 'd51d8a007ef6fa16afb16c36428c1d829d5acc4d3b3499ce9cadf8ad31da6835', 'geometry-duplicate-check.json': 'ab6c72c97563150f924a0af04b2fcf7235207a31c965ac66b665ab0b5f6d47ad', 'selected-pack-receipts.json': '122708fd3b187a0a2c7f616d3ae997d94960cca6ba908b17726dc36c7fd50e82', 'extract-baseline-geometries.mjs': 'db7a747265bd7b2aa5434883e9439a981b67a20026cfaebe91a04c38c28d9ea7', 'geometry-publication-rights.json': '5ae15707946cf638f51d77c1b710a01e0ed2e71f1a60ac0cadb723af0eec886c', 'geometry-request-receipts.json': 'c3448db32c00568bb1a254e341df1e0a386ef01b50df6cd66b052cf2aa0749f3'}, 'groups': '37255113d5925dccdb1eca9b00df0f082361436319b9ff39d34c69fb6c2821f6', 'source_asset_records': '3a16a9843a763338f2c2bc7a91e6a993923b23eeca10f7982ee1e69bf1e2c716', 'historical_inputs': [{'repository_path': 'reports/hydro-names/current-web-2026-10-08/summary.json', 'bytes': 4359, 'sha256': '4af18507bee586d97a113f903014019d8c8bffa7bf1f4329de0ce95c16d4f4fd', 'git_blob_sha': '9319efd4b3bd4c3cd17594ef9130ad1489c0b18d', 'immutable_url': 'https://github.com/kimjeon-il/Pando/blob/8213678cbfd74ecd930657eaa911f6e87ab6d2b8/reports/hydro-names/current-web-2026-10-08/summary.json', 'original_recovery_date_utc': '2026-10-09', 'original_retrieved_at_utc': None, 'retrieval_time_limit': 'Exact recovery request timestamps are not present in the retained receipts; the recovery date is known.', 'reuse_hash_checked_at_utc': '2026-10-09T14:04:22Z', 'retrieved_this_batch': False, 'in_publishable_package': False}, {'repository_path': 'reports/hydro-names/current-web-2026-10-08/inventory.csv.gz', 'bytes': 441711, 'sha256': '5d1e12b1a6daa695419173dea491ff0c8c5583ed9e28ba517ba4a599bcd589db', 'git_blob_sha': '55a1de2ae76f09bce5e624d96ad17f7531aa3fd8', 'immutable_url': 'https://github.com/kimjeon-il/Pando/blob/8213678cbfd74ecd930657eaa911f6e87ab6d2b8/reports/hydro-names/current-web-2026-10-08/inventory.csv.gz', 'original_recovery_date_utc': '2026-10-09', 'original_retrieved_at_utc': None, 'retrieval_time_limit': 'Exact recovery request timestamps are not present in the retained receipts; the recovery date is known.', 'reuse_hash_checked_at_utc': '2026-10-09T14:04:22Z', 'retrieved_this_batch': False, 'in_publishable_package': False}], 'non_distributed_decoded_feature_collection': {'bytes': 53738, 'sha256': '001cec0a5e5ce65c6c45dbe804c5a9094b388cadc676e6c668dc1ce0a6b7e368'}, 'fragments': {'6821': '4928cbd91d8228a915e5f0c0bec083b1f011385b6ffab3b031f3dbd450507e90', '6900': '02290010ac0e88c8d74709c218b5df0cb63a2d342d836d2f4bac6a2a8622afea', '6978': 'b8a6ce3072b9d85850b8935094100fc47704265b961e1bcf2f4cc3d8ac9699f2'}}
COMMIT='fd6744f5e72a0c1a107452dbde6d416ab57237db'

def main():
 if not __debug__:raise RuntimeError('Python -O disables required assertions and is unsupported.')
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parent);p.add_argument('--input-cache',type=pathlib.Path,help='Local original pinned assets only; never downloaded.');p.add_argument('--historical-input-root',type=pathlib.Path);p.add_argument('--previous-index',type=pathlib.Path);p.add_argument('--check-component-manifest',action='store_true');a=p.parse_args();root=a.directory
 assert hashlib.sha256((root/'geometry-support.py').read_bytes()).hexdigest()==PINS['artifacts']['geometry-support.py'],'support pin'
 spec=importlib.util.spec_from_file_location('geometry_support',root/'geometry-support.py');s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s);sha=s.sha;canon=s.canonical
 ref=json.loads((root/'geometry-reference.json').read_text());assert ref['schema']=='hydro-river-geometry-reference-v2' and ref['batch']=='r08','reference scope'
 ids=PINS['scope_system_ids'];awids=PINS['scope_aw_ids'];fids=PINS['fids'];assert ref['scope_system_ids']==ids and ref['scope_aw_ids']==awids and len(ids)==len(set(ids))==3,'selected scope'
 baseline=ref['baseline'];assert baseline['git_commit']==COMMIT and baseline['hydro_version']=='0.13.1' and baseline['manifest_sha256']=='c10eaffd375d5f0d90955fa253b02ec73d9daeff261fa5cfde1f73ca89d2bd80','baseline pins'
 assert baseline['all_selected_baseline_fragments_decoded'] is baseline['production_decoder_hash_verified'] is True
 assert baseline['baseline_assets_retrieved_this_batch'] is baseline['current_live_deployment_checked'] is baseline['current_live_deployment_equality_claimed'] is False,'current deployment limit'
 o=ref['original_hydrorivers_geometry'];assert o['original_shapefiles_available'] is o['coordinate_equality_verified'] is o['reach_boundary_coordinate_mapping_verified'] is False,'original source limit'
 n=ref['name_scope'];assert n['name_verdict_established'] is n['representative_name_automatically_applies_to_tributaries'] is n['automatic_application'] is n['historical_names_used_as_identity_evidence'] is False and n['research_name_ko'] is None,'name scope'
 assert set(ref['artifacts'])==set(PINS['artifacts']),'artifact roster'
 for name,receipt in ref['artifacts'].items():
  assert pathlib.Path(name).name==name;s.verified(root/name,receipt)
  data=(root/name).read_bytes();digest=sha(canon(json.loads(data))) if name.endswith('.json') else sha(data)
  assert digest==PINS['artifacts'][name],'fixed artifact pin: '+name
 assert sha(canon(ref['groups']))==PINS['groups'],'group pins'
 assert sha(canon(ref['source_assets']))==PINS['source_asset_records'],'source asset provenance pins'
 assert ref['selected_inventory_inputs']==PINS['historical_inputs'],'historical provenance pins'
 assert ref['non_distributed_decoded_feature_collection']==PINS['non_distributed_decoded_feature_collection'],'private decode receipt pin'
 for name,r in ref['source_assets'].items():
  assert r['retrieved_this_batch'] is r['in_publishable_package'] is False
  assert r['immutable_url']=='https://github.com/kimjeon-il/Pando/blob/'+COMMIT+'/'+r['repository_path']
 invfile=json.loads((root/'selected-inventory-records.json').read_text());inv=invfile['records'];meta=json.loads((root/'selected-river-metadata.json').read_text());fragments=meta['fragments'];reach=json.loads((root/'source-reach-manifest.json').read_text())
 assert invfile['scope_aw_ids']==awids and invfile['scope_system_ids']==ids and [r['aw_id'] for r in inv]==awids and invfile['all_three_selected_csv_rows_exact'] is True and invfile['historical_names_used_as_identity_evidence'] is False
 assert meta['scope_system_ids']==ids and [r['fid'] for r in fragments]==fids
 assert [r['system_id'] for r in reach['groups']]==[r['system_id'] for r in ref['groups']]==ids
 metadata={}
 for i,(r,g,h,row) in enumerate(zip(fragments,ref['groups'],reach['groups'],inv)):
  ident=ids[i];fid=fids[i];m=r['baseline_metadata_exact'];cm=r['baseline_core_metadata_exact'];dm=r['baseline_detail_metadata_exact'];z=r['geometry'];q=h['fragments'][0]
  assert sha(canon(r))==PINS['fragments'][str(fid)],'selected fragment pin'
  assert cm|dm==m and s.name_fields(cm)==r['baseline_core_name_fields_exact'] and s.name_fields(dm)==r['baseline_detail_name_fields_exact'] and s.name_fields(m)==r['baseline_name_fields_exact'],'exact metadata and name state'
  assert sha(canon(cm))==r['baseline_core_metadata_canonical_sha256'] and sha(canon(dm))==r['baseline_detail_metadata_canonical_sha256'] and sha(canon(m))==r['baseline_metadata_canonical_sha256']
  assert m['fid']==r['fid']==q['fid']==fid and m['logicalFid']==r['logical_fid']==g['logical_fid']==h['logical_fid']==row['logical_fid']==PINS['logical_fids'][i]
  assert m['awId']==r['aw_id']==g['aw_id']==h['aw_id']==row['aw_id']==awids[i]=='hydro-system:'+ident
  assert m['systemId']==r['system_id']==g['system_id']==h['system_id']==row['system_id']==ident
  assert m['category']==row['category']=='river' and m['source']==r['source']=='HydroRIVERS 1.0'
  assert m['fragmentCount']==r['fragment_count']==row['geometry_count']==1 and m['fragmentIndex']==r['fragment_index']==q['fragment_index']==0
  assert m['role']==r['role']==q['role']=='mainstem' and g['role_sequence']==['mainstem']
  assert m['name']==m['mainstemNameKo']==r['baseline_placeholder_name']==r['baseline_placeholder_mainstem_name_ko']=='미명명 수계 '+ident
  assert r['research_name_ko'] is None and r['automatic_application'] is False
  ordered=q['source_ids_ordered'];assert ordered==m['sourceId'].split(',') and len(ordered)==len(set(ordered))==q['count']==r['source_reach_count']==g['source_ids_count']==h['source_ids_count']==row['source_ids_count']==PINS['parts'][i]
  assert all(isinstance(v,str) and len(v)==8 and v.isdecimal() for v in ordered)
  assert sha(','.join(ordered).encode())==q['ordered_source_id_csv_sha256']==r['ordered_source_id_csv_sha256']
  assert h['source_ids_sorted_unique']==sorted(set(ordered)) and h['distinct_source_ids_across_fragments'] is True
  assert sha(','.join(sorted(set(ordered))).encode())==h['source_ids_sha256']==g['source_ids_sha256']==row['source_ids_sha256']
  assert z['type']=='MultiLineString' and z['part_count']==len(z['coordinate_counts_by_part'])==len(z['ordered_parts'])==PINS['parts'][i]
  assert z['coordinate_count']==sum(z['coordinate_counts_by_part'])==g['coordinate_count']==PINS['coordinate_counts'][i]
  for j,part in enumerate(z['ordered_parts']):
   assert set(part)=={'part_index','coordinate_count','ordered_coordinate_sha256'} and part['part_index']==j and part['coordinate_count']==z['coordinate_counts_by_part'][j]>=2
   assert len(part['ordered_coordinate_sha256'])==64 and all(v in '0123456789abcdef' for v in part['ordered_coordinate_sha256'])
  assert z['bounds']==g['bounds']==row['bbox']==[v/1e6 for v in m['bounds']] and m['stage']==r['stage']==g['minimum_stage']==row['minimum_stage']==3
  assert g['geometry_fids']==h['geometry_fids']==row['geometry_fids']==[fid] and g['part_count']==z['part_count']
  assert len(z['fragment_endpoints'])==2
  for x,y in z['fragment_endpoints']:assert math.isfinite(x) and math.isfinite(y) and z['bounds'][0]<=x<=z['bounds'][2] and z['bounds'][1]<=y<=z['bounds'][3]
  t=r['terminal'];assert t['class']==m['terminal']['class']=='sea' and t['source_endpoint']==m['terminal']['sourceEndpoint'] and t['render_endpoint_before_quantization']==m['terminal']['renderEndpoint']
  assert t['render_endpoint_quantized']==[round(v,6) for v in t['render_endpoint_before_quantization']]==z['fragment_endpoints'][-1]
  assert t['source_endpoint_equals_render_endpoint'] is False and t['source_endpoint']!=t['render_endpoint_before_quantization'] and t['decoded_last_vertex_matches_render_endpoint_quantized'] is True
  assert sha(canon(row))==g['selected_inventory_record_canonical_sha256'] and g['inventory_csv_and_baseline_join_verified'] is True
  c=row['inventory_csv_row_exact'];assert sha(canon(c))==row['inventory_csv_row_canonical_sha256'] and c['category']=='river' and c['system_id']==ident and c['aw_id']==awids[i]
  assert int(c['logical_fid'])==row['logical_fid'] and int(c['geometry_count'])==1 and int(c['source_ids_count'])==len(ordered) and c['source_ids_sha256']==row['source_ids_sha256'] and json.loads(c['bbox'])==z['bounds']
  assert int(c['minimum_stage'])==row['minimum_stage'] and float(c['rendered_mainstem_length_km'])==row['rendered_mainstem_length_km'] and float(c['rendered_network_length_km'])==row['rendered_network_length_km']
  metadata[fid]=m
 packs=json.loads((root/'selected-pack-receipts.json').read_text());assert packs==ref['selected_baseline_packs'],'pack/reference join'
 assert sorted(fid for r in packs for fid in r['selected_fids'])==sorted(fids)
 for pack in packs:
  for fid in pack['selected_fids']:assert metadata[fid]['stage']==pack['stage'] and next(r for r in fragments if r['fid']==fid)['pack_id']==pack['id']
 duplicate=json.loads((root/'geometry-duplicate-check.json').read_text());prior=duplicate['previous_aw_ids_in_index_order'];assert duplicate['previous_target_count']==len(prior)==len(set(prior))==21
 assert duplicate['selected_aw_ids']==awids and duplicate['selected_unique_count']==3 and duplicate['intersection_aw_ids']==sorted(set(prior)&set(awids))==[]
 assert duplicate['historical_names_used_as_identity_evidence'] is False
 rights=json.loads((root/'geometry-publication-rights.json').read_text());assert rights['selected_aw_ids']==awids and rights['batch']=='r08'
 assert rights['complete_coordinate_arrays_in_public_package'] is rights['open_redistribution_permission_claimed'] is rights['binary_packs_or_worker_bodies_in_public_package'] is rights['per_part_endpoint_arrays_in_public_package'] is rights['retrieved_this_batch'] is False
 assert not list(root.glob('*.geojson')) and not list(root.glob('*.bin')) and not (root/'worker.js').exists(),'raw geometry publication exclusion'
 request=json.loads((root/'geometry-request-receipts.json').read_text());assert request['batch']=='r08' and request['new_external_request_count']==0
 assert [r['asset_name'] for r in request['receipts']]==list(ref['source_assets'])
 for q in request['receipts']:
  asset=ref['source_assets'][q['asset_name']];assert q['new_external_request_in_r08'] is False and all(q[k]==asset[k] for k in ['bytes','sha256','original_retrieved_at_utc'])
  assert q['original_resource_url']==asset['immutable_url'] and q['reuse_hash_checked_at_utc']==asset['reuse_hash_checked_at_utc']==ref['created_at_utc']
 q=request['rights_reuse'];assert q['new_external_request_in_r08'] is False and q['bytes']==rights['official_product_original_bytes'] and q['sha256']==rights['official_product_original_sha256'] and q['original_resource_url']==rights['product_url']
 if a.input_cache:
  for name,r in ref['source_assets'].items():s.verified(a.input_cache/name,r)
  s.verified(a.input_cache/'hydrorivers-product.html',{'bytes':rights['official_product_original_bytes'],'sha256':rights['official_product_original_sha256']})
  core={r['fid']:r for r in json.loads(gzip.decompress((a.input_cache/'metadata-core.json.gz').read_bytes()))['features']};detail={r['fid']:r for r in json.loads(gzip.decompress((a.input_cache/'metadata-detail.json.gz').read_bytes()))['features']}
  for r in fragments:
   fid=r['fid'];assert core[fid]==r['baseline_core_metadata_exact'] and detail[fid]==r['baseline_detail_metadata_exact'] and core[fid]|detail[fid]==metadata[fid]
   assert sorted(k for k,m in core.items() if m.get('systemId')==r['system_id'])==[fid],'all actual matching fragments'
  for pack in packs:
   data=(a.input_cache/f'shard-s{pack["shard"]}.bin').read_bytes();assert sha(data[pack['offset']:pack['offset']+pack['length']])==pack['sha256']
  with tempfile.TemporaryDirectory() as d:
   out=pathlib.Path(d)/'selected-baseline-rendered-geometries.geojson';run=subprocess.run(['node',str(root/'extract-baseline-geometries.mjs'),str(a.input_cache),str(out)],capture_output=True,text=True);assert run.returncode==0,run.stderr
   s.verified(out,PINS['non_distributed_decoded_feature_collection']);fs=json.loads(out.read_text())['features'];assert [f['id'] for f in fs]==fids
   for f,r,g in zip(fs,fragments,ref['groups']):
    assert f['properties']==metadata[f['id']] and s.metrics(f['geometry'])==r['geometry'] and s.terminal_facts(f['properties'],f['geometry'])==r['terminal']
    assert sha(canon(f))==r['baseline_feature_canonical_sha256'] and sha(canon([f['geometry']]))==g['canonical_ordered_group_geometry_sha256']
   assert json.loads((out.parent/'selected-pack-receipts.json').read_text())==packs
 if a.historical_input_root:
  for r in ref['selected_inventory_inputs']:s.verified(a.historical_input_root/r['repository_path'],r)
  h=a.historical_input_root/'reports/hydro-names/current-web-2026-10-08';summary=json.loads((h/'summary.json').read_text());assert summary['baseline_sha']==COMMIT and summary['manifest_sha256']==baseline['manifest_sha256']
  rows=[r for r in csv.DictReader(io.StringIO(gzip.decompress((h/'inventory.csv.gz').read_bytes()).decode())) if r['aw_id'] in awids];assert len(rows)==len({r['aw_id'] for r in rows})==3;rows={r['aw_id']:r for r in rows}
  for r in inv:assert r['inventory_csv_row_exact']==rows[r['aw_id']]
 if a.previous_index:
  s.verified(a.previous_index,duplicate['previous_index_receipt']);previous=json.loads(a.previous_index.read_text());assert previous['total_distinct_reconstructed_targets']==21 and [r['aw_id'] for r in previous['records']]==prior
 if a.check_component_manifest:
  frozen=json.loads((root/'geometry-component-manifest.json').read_text());assert frozen['schema']=='frozen-selected-river-geometry-component-v2' and frozen['batch']=='r08' and frozen['scope_aw_ids']==awids
  assert frozen['full_selected_river_coordinates_in_public_package'] is frozen['binary_packs_or_worker_bodies_in_public_package'] is False and frozen['new_external_requests']==0
  assert set(frozen['files'])==set(ref['artifacts'])|{'geometry-README.md','geometry-reference.json','validate-geometry-reference.py','test-geometry-reference.py','geometry-validation.json'}
  for name,digest in frozen['files'].items():assert pathlib.Path(name).name==name and sha((root/name).read_bytes())==digest,'component frozen hash'
 print(json.dumps({'status':'passed','scope_aw_ids':awids,'fragment_count':3,'source_reach_counts':PINS['parts'],'rendered_part_counts':PINS['parts'],'rendered_coordinate_counts':PINS['coordinate_counts'],'complete_unpublished_coordinates_rechecked':bool(a.input_cache),'production_decoder_replayed':bool(a.input_cache),'actual_metadata_name_states_and_ordered_source_ids_rechecked':True,'prior21_duplicate_count':0,'original_selected_inventory_rows_rechecked':bool(a.historical_input_root),'original_previous_index_rechecked':bool(a.previous_index),'frozen_component_hashes_rechecked':bool(a.check_component_manifest),'original_hydrorivers_coordinate_equality_verified':False,'current_live_deployment_checked':False,'no_external_requests':True,'durable_only_limitation':'Published factual tables, counts and independent pins are checked; unpublished full coordinates cannot be independently recomputed without the verified input cache.'}))
if __name__=='__main__':main()
