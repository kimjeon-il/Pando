#!/usr/bin/env python3
"""Offline factual river checks, with optional immutable-cache production replay."""
import argparse,csv,gzip,hashlib,importlib.util,io,json,math,pathlib,subprocess,sys,tempfile
sys.dont_write_bytecode=True
PINS = {'scope_system_ids': ['50737565', '50756799', '50782475'], 'scope_aw_ids': ['hydro-system:50737565', 'hydro-system:50756799', 'hydro-system:50782475'], 'fids': [7039, 7072, 7073, 7099], 'logical_fids': [2081, 2112, 2112, 2136], 'group_fids': [[7039], [7072, 7073], [7099]], 'group_parts': [103, 71, 66], 'group_coordinate_counts': [561, 423, 412], 'parts': [103, 70, 1, 66], 'coordinate_counts': [561, 418, 5, 412], 'artifacts': {'geometry-support.py': '5427afc9c6d1ed13947f6ca08b3fe7532dd7884717d44f691b50d0d5f479bd12', 'selected-river-metadata.json': '982cbe7d0e686695d833126f7553b96b9adc494c9023ad1e9e4f029f7b0079a3', 'source-reach-manifest.json': '67da92e662f3e4c7c598be350c1d12e471b31022b423a83570a8de17c1e7cf4f', 'selected-inventory-records.json': '02abbcc0103204a94cdf4b4c041247ea239bef1a4af6d04acf12740f10c6ec27', 'geometry-duplicate-check.json': 'e9efdc5d82e11515efd7fd7bc630b39153d21d8bea6c0467aae35ff4878e4b80', 'selected-pack-receipts.json': '2155cc78c07a8348f8a7f548101a1f6d05c21603e6341d89c346e7fbe10f0a10', 'extract-baseline-geometries.mjs': 'a8a9deb652bd54d3c289d9546f6c9795bfd2ef28e8ea6f1e480a446f85459699', 'geometry-publication-rights.json': '01891118c65d514c55b050653c2ba76fb803785f59830c24d27ab847028bf6d1', 'geometry-request-receipts.json': '53d5bfa2b21a90ffbea9282cf7029e3567048e70fb4140b6292cb5a4e94b3eed'}, 'groups': '63b221ce0390d79c06a5b372b88270c64eea3a1d0f3c3adaff5cd6ec26613d47', 'source_asset_records': '406b742c7605fce7db49e62d538d928a5fec6ccfa55e537029a001ba14377929', 'historical_inputs': [{'repository_path': 'reports/hydro-names/current-web-2026-10-08/summary.json', 'bytes': 4359, 'sha256': '4af18507bee586d97a113f903014019d8c8bffa7bf1f4329de0ce95c16d4f4fd', 'git_blob_sha': '9319efd4b3bd4c3cd17594ef9130ad1489c0b18d', 'immutable_url': 'https://github.com/kimjeon-il/Pando/blob/8213678cbfd74ecd930657eaa911f6e87ab6d2b8/reports/hydro-names/current-web-2026-10-08/summary.json', 'original_recovery_date_utc': '2026-10-09', 'original_retrieved_at_utc': None, 'retrieval_time_limit': 'Exact recovery request timestamps are not present in the retained receipts; the recovery date is known.', 'reuse_hash_checked_at_utc': '2026-10-09T14:27:10Z', 'retrieved_this_batch': False, 'in_publishable_package': False}, {'repository_path': 'reports/hydro-names/current-web-2026-10-08/inventory.csv.gz', 'bytes': 441711, 'sha256': '5d1e12b1a6daa695419173dea491ff0c8c5583ed9e28ba517ba4a599bcd589db', 'git_blob_sha': '55a1de2ae76f09bce5e624d96ad17f7531aa3fd8', 'immutable_url': 'https://github.com/kimjeon-il/Pando/blob/8213678cbfd74ecd930657eaa911f6e87ab6d2b8/reports/hydro-names/current-web-2026-10-08/inventory.csv.gz', 'original_recovery_date_utc': '2026-10-09', 'original_retrieved_at_utc': None, 'retrieval_time_limit': 'Exact recovery request timestamps are not present in the retained receipts; the recovery date is known.', 'reuse_hash_checked_at_utc': '2026-10-09T14:27:10Z', 'retrieved_this_batch': False, 'in_publishable_package': False}], 'non_distributed_decoded_feature_collection': {'bytes': 37637, 'sha256': '5e5567fc57e221808cf53488b6d090a309a8edd63301f7b54935cd275dc7b837'}, 'fragments': {'7039': 'db31d41982c4b4af1b70364f209c5d2a6cf0608ad322ecea4162f39b8ef6f05c', '7072': 'ea11982f42109602a07df84ce55acbfc3a668d7447cbfef1bdddf5b555804d92', '7073': '42254630e231ae93d9740934a95396294b85e1c43d729ecc9e44977f41a5b998', '7099': '8895b7c943c93d7c77346de883d350d16b8c64fa7df347f01fe9ed83836079fe'}}
COMMIT='fd6744f5e72a0c1a107452dbde6d416ab57237db'

def main():
 if not __debug__:raise RuntimeError('Python -O disables required assertions and is unsupported.')
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parent);p.add_argument('--input-cache',type=pathlib.Path,help='Local original pinned assets only; never downloaded.');p.add_argument('--historical-input-root',type=pathlib.Path);p.add_argument('--previous-index',type=pathlib.Path);p.add_argument('--check-component-manifest',action='store_true');a=p.parse_args();root=a.directory
 assert hashlib.sha256((root/'geometry-support.py').read_bytes()).hexdigest()==PINS['artifacts']['geometry-support.py'],'support pin'
 spec=importlib.util.spec_from_file_location('geometry_support',root/'geometry-support.py');s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s);sha=s.sha;canon=s.canonical
 ref=json.loads((root/'geometry-reference.json').read_text());assert ref['schema']=='hydro-river-geometry-reference-v2' and ref['batch']=='r09','reference scope'
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
 metadata={};byfid={r['fid']:r for r in fragments}
 assert len(fragments)==len(set(byfid))==4 and [g['geometry_fids'] for g in ref['groups']]==PINS['group_fids'],'complete fragment grouping'
 for i,(g,h,row) in enumerate(zip(ref['groups'],reach['groups'],inv)):
  ident=ids[i];gfids=PINS['group_fids'][i];rr=[byfid[fid] for fid in gfids];qq=h['fragments']
  assert g['geometry_fids']==h['geometry_fids']==row['geometry_fids']==gfids and [q['fid'] for q in qq]==gfids
  assert g['aw_id']==h['aw_id']==row['aw_id']==awids[i]=='hydro-system:'+ident and g['system_id']==h['system_id']==row['system_id']==ident
  assert g['logical_fid']==h['logical_fid']==row['logical_fid'] and row['category']=='river' and row['geometry_count']==len(gfids)
  assert g['role_sequence']==[r['role'] for r in rr]==['mainstem']*len(gfids)
  flat=[v for q in qq for v in q['source_ids_ordered']];union=sorted(set(flat))
  assert len(flat)==len(union)==g['source_ids_count']==h['source_ids_count']==row['source_ids_count']==PINS['group_parts'][i]
  assert h['source_ids_sorted_unique']==union and h['distinct_source_ids_across_fragments'] is True
  assert sha(','.join(union).encode())==h['source_ids_sha256']==g['source_ids_sha256']==row['source_ids_sha256']
  gg=[r['geometry'] for r in rr];bounds=[min(z['bounds'][0] for z in gg),min(z['bounds'][1] for z in gg),max(z['bounds'][2] for z in gg),max(z['bounds'][3] for z in gg)]
  assert g['bounds']==row['bbox']==bounds and g['minimum_stage']==row['minimum_stage']==min(r['stage'] for r in rr)
  assert g['part_count']==sum(z['part_count'] for z in gg)==PINS['group_parts'][i]
  assert g['coordinate_count']==sum(z['coordinate_count'] for z in gg)==PINS['group_coordinate_counts'][i]
  for j,(r,q) in enumerate(zip(rr,qq)):
   fid=gfids[j];k=fids.index(fid);m=r['baseline_metadata_exact'];cm=r['baseline_core_metadata_exact'];dm=r['baseline_detail_metadata_exact'];z=r['geometry']
   assert sha(canon(r))==PINS['fragments'][str(fid)],'selected fragment pin'
   assert cm|dm==m and s.name_fields(cm)==r['baseline_core_name_fields_exact'] and s.name_fields(dm)==r['baseline_detail_name_fields_exact'] and s.name_fields(m)==r['baseline_name_fields_exact'],'exact metadata and name state'
   assert sha(canon(cm))==r['baseline_core_metadata_canonical_sha256'] and sha(canon(dm))==r['baseline_detail_metadata_canonical_sha256'] and sha(canon(m))==r['baseline_metadata_canonical_sha256']
   assert m['fid']==r['fid']==q['fid']==fid and m['logicalFid']==r['logical_fid']==g['logical_fid']==PINS['logical_fids'][k]
   assert m['awId']==r['aw_id']==awids[i] and m['systemId']==r['system_id']==ident and m['category']=='river' and m['source']==r['source']=='HydroRIVERS 1.0'
   assert m['fragmentCount']==r['fragment_count']==len(gfids) and m['fragmentIndex']==r['fragment_index']==q['fragment_index']==j
   assert m['role']==r['role']==q['role']=='mainstem' and m['stage']==r['stage']
   assert m['name']==m['mainstemNameKo']==r['baseline_placeholder_name']==r['baseline_placeholder_mainstem_name_ko']=='미명명 수계 '+ident
   assert r['research_name_ko'] is None and r['automatic_application'] is False
   ordered=q['source_ids_ordered'];assert ordered==m['sourceId'].split(',') and len(ordered)==len(set(ordered))==q['count']==r['source_reach_count']==PINS['parts'][k]
   assert all(isinstance(v,str) and len(v)==8 and v.isdecimal() for v in ordered)
   assert sha(','.join(ordered).encode())==q['ordered_source_id_csv_sha256']==r['ordered_source_id_csv_sha256']
   assert z['type'] in ['MultiLineString','LineString'] and z['part_count']==len(z['coordinate_counts_by_part'])==len(z['ordered_parts'])==PINS['parts'][k]
   assert z['coordinate_count']==sum(z['coordinate_counts_by_part'])==PINS['coordinate_counts'][k]
   for pi,part in enumerate(z['ordered_parts']):
    assert set(part)=={'part_index','coordinate_count','ordered_coordinate_sha256'} and part['part_index']==pi and part['coordinate_count']==z['coordinate_counts_by_part'][pi]>=2
    assert len(part['ordered_coordinate_sha256'])==64 and all(v in '0123456789abcdef' for v in part['ordered_coordinate_sha256'])
   assert z['bounds']==[v/1e6 for v in m['bounds']] and len(z['fragment_endpoints'])==2
   for x,y in z['fragment_endpoints']:assert math.isfinite(x) and math.isfinite(y) and z['bounds'][0]<=x<=z['bounds'][2] and z['bounds'][1]<=y<=z['bounds'][3]
   t=r['terminal']
   if fid==7072:assert t is None and 'terminal' not in m and 'terminal' not in cm and 'terminal' not in dm,'nonterminal fragment absence'
   else:
    assert t['class']==m['terminal']['class']=='sea' and t['source_endpoint']==m['terminal']['sourceEndpoint'] and t['render_endpoint_before_quantization']==m['terminal']['renderEndpoint']
    assert t['render_endpoint_quantized']==[round(v,6) for v in t['render_endpoint_before_quantization']]==z['fragment_endpoints'][-1]
    assert t['source_endpoint_equals_render_endpoint'] is False and t['source_endpoint']!=t['render_endpoint_before_quantization'] and t['decoded_last_vertex_matches_render_endpoint_quantized'] is True
   metadata[fid]=m
  assert sha(canon(row))==g['selected_inventory_record_canonical_sha256'] and g['inventory_csv_and_baseline_join_verified'] is True
  c=row['inventory_csv_row_exact'];assert sha(canon(c))==row['inventory_csv_row_canonical_sha256'] and c['category']=='river' and c['system_id']==ident and c['aw_id']==awids[i]
  assert int(c['logical_fid'])==row['logical_fid'] and int(c['geometry_count'])==len(gfids) and int(c['source_ids_count'])==len(union) and c['source_ids_sha256']==row['source_ids_sha256'] and json.loads(c['bbox'])==bounds
  assert int(c['minimum_stage'])==row['minimum_stage'] and float(c['rendered_mainstem_length_km'])==row['rendered_mainstem_length_km'] and float(c['rendered_network_length_km'])==row['rendered_network_length_km']
 assert byfid[7072]['geometry']['fragment_endpoints'][-1]==byfid[7073]['geometry']['fragment_endpoints'][0],'adjacent rendered fragment endpoint equality'
 packs=json.loads((root/'selected-pack-receipts.json').read_text());assert packs==ref['selected_baseline_packs'],'pack/reference join'
 assert sorted(fid for r in packs for fid in r['selected_fids'])==sorted(fids)
 for pack in packs:
  for fid in pack['selected_fids']:assert metadata[fid]['stage']==pack['stage'] and next(r for r in fragments if r['fid']==fid)['pack_id']==pack['id']
 duplicate=json.loads((root/'geometry-duplicate-check.json').read_text());prior=duplicate['previous_aw_ids_in_index_order'];assert duplicate['previous_target_count']==len(prior)==len(set(prior))==24
 assert duplicate['selected_aw_ids']==awids and duplicate['selected_unique_count']==3 and duplicate['intersection_aw_ids']==sorted(set(prior)&set(awids))==[]
 assert duplicate['historical_names_used_as_identity_evidence'] is False
 rights=json.loads((root/'geometry-publication-rights.json').read_text());assert rights['selected_aw_ids']==awids and rights['batch']=='r09'
 assert rights['complete_coordinate_arrays_in_public_package'] is rights['open_redistribution_permission_claimed'] is rights['binary_packs_or_worker_bodies_in_public_package'] is rights['per_part_endpoint_arrays_in_public_package'] is rights['retrieved_this_batch'] is False
 assert not list(root.glob('*.geojson')) and not list(root.glob('*.bin')) and not (root/'worker.js').exists(),'raw geometry publication exclusion'
 request=json.loads((root/'geometry-request-receipts.json').read_text());assert request['batch']=='r09' and request['new_external_request_count']==0
 assert [r['asset_name'] for r in request['receipts']]==list(ref['source_assets'])
 for q in request['receipts']:
  asset=ref['source_assets'][q['asset_name']];assert q['new_external_request_in_r09'] is False and all(q[k]==asset[k] for k in ['bytes','sha256','original_retrieved_at_utc'])
  assert q['original_resource_url']==asset['immutable_url'] and q['reuse_hash_checked_at_utc']==asset['reuse_hash_checked_at_utc']==ref['created_at_utc']
 q=request['rights_reuse'];assert q['new_external_request_in_r09'] is False and q['bytes']==rights['official_product_original_bytes'] and q['sha256']==rights['official_product_original_sha256'] and q['original_resource_url']==rights['product_url']
 if a.input_cache:
  for name,r in ref['source_assets'].items():s.verified(a.input_cache/name,r)
  s.verified(a.input_cache/'hydrorivers-product.html',{'bytes':rights['official_product_original_bytes'],'sha256':rights['official_product_original_sha256']})
  core={r['fid']:r for r in json.loads(gzip.decompress((a.input_cache/'metadata-core.json.gz').read_bytes()))['features']};detail={r['fid']:r for r in json.loads(gzip.decompress((a.input_cache/'metadata-detail.json.gz').read_bytes()))['features']}
  for r in fragments:
   fid=r['fid'];assert core[fid]==r['baseline_core_metadata_exact'] and detail[fid]==r['baseline_detail_metadata_exact'] and core[fid]|detail[fid]==metadata[fid]
   assert sorted((k for k,m in core.items() if m.get('systemId')==r['system_id']),key=lambda k:core[k]['fragmentIndex'])==PINS['group_fids'][ids.index(r['system_id'])],'all actual matching fragments'
  for pack in packs:
   data=(a.input_cache/f'shard-s{pack["shard"]}.bin').read_bytes();assert sha(data[pack['offset']:pack['offset']+pack['length']])==pack['sha256']
  with tempfile.TemporaryDirectory() as d:
   out=pathlib.Path(d)/'selected-baseline-rendered-geometries.geojson';run=subprocess.run(['node',str(root/'extract-baseline-geometries.mjs'),str(a.input_cache),str(out)],capture_output=True,text=True);assert run.returncode==0,run.stderr
   s.verified(out,PINS['non_distributed_decoded_feature_collection']);fs=json.loads(out.read_text())['features'];assert [f['id'] for f in fs]==fids
   for f,r in zip(fs,fragments):
    assert f['properties']==metadata[f['id']] and s.metrics(f['geometry'])==r['geometry'] and s.terminal_facts(f['properties'],f['geometry'])==r['terminal']
    assert sha(canon(f))==r['baseline_feature_canonical_sha256']
   for g in ref['groups']:
    assert sha(canon([f['geometry'] for f in fs if f['id'] in g['geometry_fids']]))==g['canonical_ordered_group_geometry_sha256']
   assert json.loads((out.parent/'selected-pack-receipts.json').read_text())==packs
 if a.historical_input_root:
  for r in ref['selected_inventory_inputs']:s.verified(a.historical_input_root/r['repository_path'],r)
  h=a.historical_input_root/'reports/hydro-names/current-web-2026-10-08';summary=json.loads((h/'summary.json').read_text());assert summary['baseline_sha']==COMMIT and summary['manifest_sha256']==baseline['manifest_sha256']
  rows=[r for r in csv.DictReader(io.StringIO(gzip.decompress((h/'inventory.csv.gz').read_bytes()).decode())) if r['aw_id'] in awids];assert len(rows)==len({r['aw_id'] for r in rows})==3;rows={r['aw_id']:r for r in rows}
  for r in inv:assert r['inventory_csv_row_exact']==rows[r['aw_id']]
 if a.previous_index:
  s.verified(a.previous_index,duplicate['previous_index_receipt']);previous=json.loads(a.previous_index.read_text());assert previous['total_distinct_reconstructed_targets']==24 and [r['aw_id'] for r in previous['records']]==prior
 if a.check_component_manifest:
  frozen=json.loads((root/'geometry-component-manifest.json').read_text());assert frozen['schema']=='frozen-selected-river-geometry-component-v2' and frozen['batch']=='r09' and frozen['scope_aw_ids']==awids
  assert frozen['full_selected_river_coordinates_in_public_package'] is frozen['binary_packs_or_worker_bodies_in_public_package'] is False and frozen['new_external_requests']==0
  assert set(frozen['files'])==set(ref['artifacts'])|{'geometry-README.md','geometry-reference.json','validate-geometry-reference.py','test-geometry-reference.py','geometry-validation.json'}
  for name,digest in frozen['files'].items():assert pathlib.Path(name).name==name and sha((root/name).read_bytes())==digest,'component frozen hash'
 print(json.dumps({'status':'passed','scope_aw_ids':awids,'group_count':3,'fragment_count':4,'fragment_counts_by_group':[len(v) for v in PINS['group_fids']],'source_reach_counts':PINS['group_parts'],'rendered_part_counts':PINS['group_parts'],'rendered_coordinate_counts':PINS['group_coordinate_counts'],'rendered_part_counts_by_fragment':PINS['parts'],'rendered_coordinate_counts_by_fragment':PINS['coordinate_counts'],'complete_unpublished_coordinates_rechecked':bool(a.input_cache),'production_decoder_replayed':bool(a.input_cache),'actual_metadata_name_states_and_ordered_source_ids_rechecked':True,'prior24_duplicate_count':0,'original_selected_inventory_rows_rechecked':bool(a.historical_input_root),'original_previous_index_rechecked':bool(a.previous_index),'frozen_component_hashes_rechecked':bool(a.check_component_manifest),'original_hydrorivers_coordinate_equality_verified':False,'current_live_deployment_checked':False,'no_external_requests':True,'durable_only_limitation':'Published factual tables, counts and independent pins are checked; unpublished full coordinates cannot be independently recomputed without the verified input cache.'}))
if __name__=='__main__':main()
