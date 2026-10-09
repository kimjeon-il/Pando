#!/usr/bin/env python3
"""Validate selected river facts offline; optional verified-cache production decoding."""
import argparse,csv,gzip,hashlib,io,json,math,pathlib,subprocess,tempfile
IDS=['30624681','50488324','40182409'];FIDS=[15165,15166,6748,6749,6750,6751,6752,3103,3104]
JOINS=[('30624681',3798,[15165,15166],['mainstem','mainstem'],255,'9b00d659a476313d724aadf3026ed084dec18398bbc6ce4a69e96aa15c2d7a27'),('50488324',1832,[6748,6749,6750,6751,6752],['mainstem','mainstem','mainstem','tributary','tributary'],168,'71a9d52473951e1a345bcaf16ba6b5cd2266036cdd34ffb365826675e7b63d1a'),('40182409',1070,[3103,3104],['mainstem','mainstem'],255,'4ded058ac025b4e65a0c6f1d3ecffdcf369373790a542507abea72ff09b9ee1e')]
COMMIT='fd6744f5e72a0c1a107452dbde6d416ab57237db'
# Frozen selected-feature pins were generated only after the complete immutable
# assets passed manifest checks and the actual production decoder was replayed.
PINS={15165: {'geometry_sha256': 'edfd37abdc993ee471cf8580ac08569e9e171d51e6f5fb7f7f58cd41c474f823', 'metadata_sha256': '3c259e93129304a6d9ecb260fdedf884bae82eae7d68d32be9fc5fa97e4c7923', 'ordered_source_id_sha256': 'fc64b71772967420336271f8de53ac73e2ec629fca620b7aeb5fcbdb9f016839', 'feature_sha256': 'de6038ae547396770d503e545a34f4be6f12d9b708895b5f5f7cd6e4c5b8175b', 'counts': 1286, 'parts': 244}, 15166: {'geometry_sha256': '8c2df3846b18b03e4304b1c7f9d761319707a4a85198e91c50c3851e00742285', 'metadata_sha256': '85abcbb637c92fcdba18eee6aad6c8fef4686b06edfdae8e67abc8d44ffaf49b', 'ordered_source_id_sha256': 'b4758d5a71bf96c3f5b2bbb02fb4a81e3269223b9011300324e1bcfb7605c08b', 'feature_sha256': '51b5272fa27ddeac99d66f23b1338c908a8b9512b8472456a7644f821188040a', 'counts': 92, 'parts': 11}, 6748: {'geometry_sha256': '0733fd279564bb4ae577c3404a746457d6a788ab51671a0c4bbecac9ba656012', 'metadata_sha256': '5689cd42cc23241fc65910906af48cab62f93ceb36ed2fb28fc03ea363de6cdb', 'ordered_source_id_sha256': 'a896dcf7832333e9b71d0d3caa049729d18a501c5d03b5f061e18ddd756f66cd', 'feature_sha256': '2501e86e42fa7dc1c17b7523ba0013a057ee1700ee9f7a254055247c5899be3d', 'counts': 693, 'parts': 76}, 6749: {'geometry_sha256': 'e18c68c8166b584a5191387ce07b9ad78e031b4881afeff348596e4396244825', 'metadata_sha256': '6bede5b543a467b43eb2fba289ea55a87324514153aec5b69ea871dade3ff707', 'ordered_source_id_sha256': 'a8317710d5907927cd42cd577e478d92e065ba0d92a02f2f8733cc4a7f559a36', 'feature_sha256': '90a02252403f91ae724605983b281db7b9ec16df7d2eb63ec66c342c6de9ff07', 'counts': 5, 'parts': 1}, 6750: {'geometry_sha256': '568d9949883da4bd8e1db2100945d4a4d75a0c82ba9af215ac44be4a8368725d', 'metadata_sha256': 'e763bd3bad52f2e25be9eeb1ef6ed13245bb97d47956745ddeeb9a41a6ccbf35', 'ordered_source_id_sha256': '422e5ffa6357e5b5049134dac133d86ed87af03d863ebaf9ddff8663175eb3e5', 'feature_sha256': 'f90f15d3323a2297c6082b3cd8c25c679d82a569c1479897a94c34789cd89e7a', 'counts': 504, 'parts': 69}, 6751: {'geometry_sha256': '4aa89cb970bb7f29c8350db374d370f47ac5f582ece237e924b3911113f1a4d5', 'metadata_sha256': '28d5e5e9d78292941ebc629720a74cc94db822e1261c259e73faf38a11558684', 'ordered_source_id_sha256': '56bf42ff033387cffde3ae96280a46c66368de028b0d1dfbf48e5effc6391384', 'feature_sha256': 'adecf98497985f19a2d1e2e72bc2f8644059cd92ee14c4bdf7f956b6afde7eab', 'counts': 211, 'parts': 20}, 6752: {'geometry_sha256': '8ebb867f0008a3e2a6fd33103729265d04969b1f4e9080ac341243723a493d83', 'metadata_sha256': '5369c0f024f5bdc412c97aa478220a752aa47e0937ae114730c887abb6e0cae7', 'ordered_source_id_sha256': '010b264c3005a471bebad5755c4ed6ec4ac3cce5772ac8746ab58392fd4015b2', 'feature_sha256': '26681c34543e1dc73b2d33ad0b1a4daff876bc40885e14de3c370114a4c8dec8', 'counts': 23, 'parts': 2}, 3103: {'geometry_sha256': '3283dcf15b82134f2be1891b8ff3bd91b653d099cc4022d9e0fda7aa1207dbac', 'metadata_sha256': 'f78e3401b4901e8d827b1d250c54fb447811a8ef1fd8434c5ba519126024b0cb', 'ordered_source_id_sha256': '064f8d8d7d9efd8ff15a8b53ed6a5507db58c2ad99d54fd58d1d06123869e36f', 'feature_sha256': '0e52fcc486bdd6cfd9d3d0fe208d9c2f96f56e40899ada4bc5c25ef260d62cca', 'counts': 934, 'parts': 176}, 3104: {'geometry_sha256': '6c89f80474d243c317e6bec70a028f0d8128a9047e127aac97a249a65d58e9e6', 'metadata_sha256': '91c479f7b80c377cccea2595df1daa4219f8f1309af5ac25eda09b4546e0fc4b', 'ordered_source_id_sha256': 'e723a494e5533c1ee39edb173a7474f07c5f44d60b94e6e2c103f71fcc9b2657', 'feature_sha256': '62ac1fee2f70d6d6540f1bb2544611ce577c0e1bb3e5dc567366b7e194fdfda5', 'counts': 472, 'parts': 79}}
PACKS=[{'id': 83, 'shard': 0, 'offset': 3007165, 'length': 30382, 'stage': 1, 'sha256': 'c2ede62933bbcd806a4224ede97833ae6ae29eafd56170765485e231a33a0dce', 'selected_fids': [6750]}, {'id': 206, 'shard': 0, 'offset': 3944502, 'length': 5320, 'stage': 2, 'sha256': '076e9da13fcf0e228b32eba2dca94afd552ac9d08dadde40aabeb5110f9a990a', 'selected_fids': [3104]}, {'id': 211, 'shard': 0, 'offset': 3965245, 'length': 9839, 'stage': 2, 'sha256': '9e8a658805ce09df0690cfc6df85ce36452a481c8137a9032365497d61a3dfe7', 'selected_fids': [15166]}, {'id': 261, 'shard': 1, 'offset': 192749, 'length': 4190, 'stage': 2, 'sha256': 'a6e6bb42c025ec068a9307617330c1fd9de7a4111d4566139f120a9d6af88db2', 'selected_fids': [6749, 6752]}, {'id': 700, 'shard': 1, 'offset': 3749425, 'length': 13893, 'stage': 3, 'sha256': 'aa82a104a04cb13f173a7914a7eb7cefb7ed52819d519d773b4ada3545a2237c', 'selected_fids': [3103, 15165]}, {'id': 861, 'shard': 2, 'offset': 984113, 'length': 13658, 'stage': 3, 'sha256': '39da97b9d32fbd00eabfcfac62a9cd3ed8e9d32a65b0d0e6f5acb5de2d52de84', 'selected_fids': [6748, 6751]}]
GROUP_PINS={'30624681': {'geometry_sha256': '54ad8ac757f7ab3c7aec9cea425f620090f0dc06abb802b748a4e0ceacca8b53', 'priority_record_sha256': '47314881a64e09244e560fc174a6beed444c9c8d2936c45ec1294073aa8875b8'}, '50488324': {'geometry_sha256': 'c53e0cf6be8dab31cad34a09d9fdf82967adc95770b31efa16fdf8fd733746b1', 'priority_record_sha256': 'e160a7d1e782ee5664c134a82b24adcf36e77d5e294ac5c0d0bee96569dab414'}, '40182409': {'geometry_sha256': '566cb65669c73251b58d8adb9a4cf58c1466dc3a219636a2884fc7c9923961d0', 'priority_record_sha256': 'e9da49cb1b228e13cb3625f20c6925c697a15bb9a0c5c08f28e8caf049efce10'}}
def canon(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def verified(p,r):
 b=p.read_bytes();assert len(b)==r['bytes'] and sha(b)==r['sha256'],p.name
 if 'git_blob_sha' in r:assert hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()==r['git_blob_sha'],p.name
 return b
def parts(g):
 assert g['type'] in ['LineString','MultiLineString'];return [g['coordinates']] if g['type']=='LineString' else g['coordinates']
def metrics(g):
 pp=parts(g);xy=[v for p in pp for v in p];assert pp and all(len(p)>=2 for p in pp)
 for x,y in xy:assert math.isfinite(x) and math.isfinite(y) and -180<=x<=180 and -90<=y<=90
 return {'type':g['type'],'part_count':len(pp),'coordinate_counts_by_part':[len(p) for p in pp],'coordinate_count':len(xy),'bounds':[min(x for x,y in xy),min(y for x,y in xy),max(x for x,y in xy),max(y for x,y in xy)],'fragment_endpoints':[pp[0][0],pp[-1][-1]],'canonical_geometry_sha256':sha(canon(g)),'coordinate_order':'Exact production decoder part and vertex order; no simplification, sorting, repair or reversal.'}
def reconstruct_metadata(r,reach):
 m={'fid':r['fid'],'logicalFid':r['logical_fid'],'awId':r['aw_id'],'name':r['baseline_placeholder_name'],'layerId':'rivers_hydro','category':'river','bounds':[round(v*1e6) for v in r['geometry']['bounds']],'stage':r['stage'],'flags':r['flags'],'fragmentIndex':r['fragment_index'],'fragmentCount':r['fragment_count'],'width':r['baseline_width'],'systemId':r['system_id'],'mainstemNameKo':r['baseline_placeholder_mainstem_name_ko'],'role':r['role'],'source':r['source'],'sourceId':','.join(reach['source_ids_ordered'])}
 if r['terminal']:
  t=r['terminal'];m['terminal']={'class':t['class'],'sourceEndpoint':t['source_endpoint'],'renderEndpoint':t['render_endpoint_before_quantization']}
 return m
def main():
 if not __debug__:raise RuntimeError('Do not disable assertions with Python -O.')
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parent);p.add_argument('--input-cache',type=pathlib.Path,help='Complete pinned immutable baseline inputs. Never fetched by this validator.');p.add_argument('--historical-input-root',type=pathlib.Path,help='Optional recovered repository root, for the three selected records only.');a=p.parse_args();root=a.directory;ref=json.loads((root/'geometry-reference.json').read_text());meta=json.loads((root/'selected-river-metadata.json').read_text());reach=json.loads((root/'source-reach-manifest.json').read_text())
 assert ref['schema']=='hydro-river-geometry-reference-v1' and ref['batch']=='r03' and ref['scope_system_ids']==IDS
 baseline=ref['baseline'];assert baseline['git_commit']==COMMIT and baseline['manifest_sha256']=='c10eaffd375d5f0d90955fa253b02ec73d9daeff261fa5cfde1f73ca89d2bd80'
 assert baseline['current_live_deployment_checked'] is baseline['current_live_deployment_equality_claimed'] is False
 assert baseline['all_selected_baseline_fragments_decoded'] is baseline['production_decoder_hash_verified'] is True
 original=ref['original_hydrorivers_geometry'];assert original['original_shapefiles_available'] is original['coordinate_equality_verified'] is original['reach_boundary_coordinate_mapping_verified'] is False
 n=ref['name_scope'];assert n['name_verdict_established'] is n['representative_name_automatically_applies_to_tributaries'] is n['automatic_application'] is False and n['research_name_ko'] is None
 for name,r in ref['artifacts'].items():assert pathlib.Path(name).name==name;verified(root/name,r)
 assert [r['fid'] for r in meta['fragments']]==FIDS and meta['scope_system_ids']==IDS
 assert [r['system_id'] for r in ref['groups']]==[r['system_id'] for r in reach['groups']]==IDS
 byfid={r['fid']:r for r in meta['fragments']};byreach={r['fid']:r for g in reach['groups'] for r in g['fragments']};assert set(byreach)==set(FIDS)
 reconstructed={}
 inventory=json.loads((root/'selected-inventory-records.json').read_text());assert inventory['scope_system_ids']==IDS and inventory['historical_names_used_as_identity_evidence'] is False
 assert [r['system_id'] for r in inventory['records']]==IDS
 selected_inventory={r['system_id']:r for r in inventory['records']}
 for g,h,(ident,logical,fids,roles,count,digest) in zip(ref['groups'],reach['groups'],JOINS):
  inv=selected_inventory[ident];assert sha(canon(inv))==g['selected_priority_record_canonical_sha256']==GROUP_PINS[ident]['priority_record_sha256']
  assert g['canonical_ordered_group_geometry_sha256']==GROUP_PINS[ident]['geometry_sha256']
  assert inv['geometry_fids']==fids and inv['logical_fid']==logical and inv['source_ids_count']==count and inv['source_ids_sha256']==digest and inv['bbox']==g['bounds']
  assert g['system_id']==h['system_id']==ident and g['aw_id']==h['aw_id']=='hydro-system:'+ident
  assert g['logical_fid']==h['logical_fid']==logical and g['geometry_fids']==h['geometry_fids']==fids
  assert [r['fid'] for r in h['fragments']]==fids and g['role_sequence']==roles and g['source_ids_count']==h['source_ids_count']==count
  ids=[v for r in h['fragments'] for v in r['source_ids_ordered']];assert len(ids)==len(set(ids))==count and h['distinct_source_ids_across_fragments'] is True
  assert all(isinstance(v,str) and len(v)==8 and v.isdecimal() for v in ids)
  assert sorted(set(ids))==h['source_ids_sorted_unique'] and sha(','.join(sorted(set(ids))).encode())==h['source_ids_sha256']==g['source_ids_sha256']==digest
  assert sum(byfid[f]['geometry']['coordinate_count'] for f in fids)==g['coordinate_count'] and min(byfid[f]['stage'] for f in fids)==g['minimum_stage']
  b=[byfid[f]['geometry']['bounds'] for f in fids];assert [min(x[0] for x in b),min(x[1] for x in b),max(x[2] for x in b),max(x[3] for x in b)]==g['bounds']
  for i,(fid,role) in enumerate(zip(fids,roles)):
   r=byfid[fid];q=byreach[fid];pin=PINS[fid];m=reconstruct_metadata(r,q);reconstructed[fid]=m
   assert r['system_id']==ident and r['logical_fid']==logical and r['aw_id']=='hydro-system:'+ident
   assert r['fragment_index']==q['fragment_index']==i and r['fragment_count']==len(fids) and r['role']==q['role']==role
   assert r['source']=='HydroRIVERS 1.0' and r['flags']==0 and r['research_name_ko'] is None and r['automatic_application'] is False
   assert r['baseline_placeholder_name']==r['baseline_placeholder_mainstem_name_ko']=='미명명 수계 '+ident
   assert len(q['source_ids_ordered'])==q['count']==r['source_reach_count']==pin['parts']
   assert sha(','.join(q['source_ids_ordered']).encode())==q['ordered_source_id_csv_sha256']==r['ordered_source_id_csv_sha256']==pin['ordered_source_id_sha256']
   assert sha(canon(m))==r['baseline_metadata_canonical_sha256']==pin['metadata_sha256']
   assert r['baseline_feature_canonical_sha256']==pin['feature_sha256']
   z=r['geometry'];assert z['canonical_geometry_sha256']==pin['geometry_sha256'] and z['coordinate_count']==pin['counts'] and z['part_count']==pin['parts']
   assert len(z['coordinate_counts_by_part'])==z['part_count'] and sum(z['coordinate_counts_by_part'])==z['coordinate_count'] and min(z['coordinate_counts_by_part'])>=2
   assert z['type']==('LineString' if fid==6749 else 'MultiLineString')
   assert len(z['fragment_endpoints'])==2
   for point in z['fragment_endpoints']:
    assert len(point)==2 and all(math.isfinite(v) for v in point) and z['bounds'][0]<=point[0]<=z['bounds'][2] and z['bounds'][1]<=point[1]<=z['bounds'][3]
   if r['terminal']:
    t=r['terminal'];assert t['render_endpoint_quantized']==[round(v,6) for v in t['render_endpoint_before_quantization']]==z['fragment_endpoints'][-1]
    assert t['decoded_last_vertex_matches_render_endpoint_quantized'] is True
    assert t['source_endpoint_equals_render_endpoint']==(t['source_endpoint']==t['render_endpoint_before_quantization'])
 assert byfid[6750]['terminal']['source_endpoint_equals_render_endpoint'] is False
 assert {f:r['terminal']['class'] for f,r in byfid.items() if r['terminal']}=={15166:'lake',6750:'sea',6752:'confluence',3104:'endorheic'}
 packs=json.loads((root/'selected-pack-receipts.json').read_text());assert packs==PACKS
 for x in packs:
  for fid in x['selected_fids']:assert byfid[fid]['pack_id']==x['id'] and byfid[fid]['stage']==x['stage']
 rights=json.loads((root/'geometry-publication-rights.json').read_text());assert rights['complete_coordinate_arrays_in_public_package'] is rights['open_redistribution_permission_claimed'] is False
 assert rights['official_license_url']=='https://data.hydrosheds.org/file/technical-documentation/HydroSHEDS_TechDoc_v1_4.pdf'
 assert not list(root.glob('*.geojson')) and not list(root.glob('*.bin'))
 requests=json.loads((root/'geometry-request-receipts.json').read_text())
 for r in requests['receipts']:
  asset=ref['source_assets'][r['asset_name']];assert r['bytes']==asset['bytes'] and r['sha256']==asset['sha256']
 if a.input_cache:
  for name,r in ref['source_assets'].items():verified(a.input_cache/name,r)
  core={r['fid']:r for r in json.loads(gzip.decompress((a.input_cache/'metadata-core.json.gz').read_bytes()))['features']};detail={r['fid']:r for r in json.loads(gzip.decompress((a.input_cache/'metadata-detail.json.gz').read_bytes()))['features']}
  for fid,m in reconstructed.items():assert m==core[fid]|detail[fid]
  for ident,logical,fids,*_ in JOINS:assert sorted(fid for fid,d in core.items() if d.get('systemId')==ident)==fids
  for r in packs:
   b=(a.input_cache/f'shard-s{r["shard"]}.bin').read_bytes();assert sha(b[r['offset']:r['offset']+r['length']])==r['sha256']
  with tempfile.TemporaryDirectory() as d:
   out=pathlib.Path(d)/'decoded.geojson';r=subprocess.run(['node',str(root/'extract-baseline-geometries.mjs'),str(a.input_cache),str(out)],capture_output=True,text=True);assert r.returncode==0,r.stderr
   verified(out,ref['non_distributed_decoded_feature_collection']);selected=json.loads(out.read_text())['features'];assert [f['properties']['fid'] for f in selected]==FIDS
   for f in selected:
    fid=f['properties']['fid'];assert f['id']==fid and f['properties']==reconstructed[fid];assert metrics(f['geometry'])==byfid[fid]['geometry'];assert sha(canon(f))==PINS[fid]['feature_sha256']
   assert json.loads((out.parent/'selected-pack-receipts.json').read_text())==packs
   for g in ref['groups']:assert sha(canon([f['geometry'] for f in selected if f['properties']['systemId']==g['system_id']]))==g['canonical_ordered_group_geometry_sha256']
 if a.historical_input_root:
  for r in ref['selected_inventory_inputs']:verified(a.historical_input_root/r['repository_path'],r)
  h=a.historical_input_root/'reports/hydro-names/current-web-2026-10-08';priority={r['system_id']:r for r in json.loads((h/'priority-candidates.json').read_text())['river']};csvrows={r['system_id']:r for r in csv.DictReader(io.StringIO(gzip.decompress((h/'inventory.csv.gz').read_bytes()).decode())) if r['system_id'] in IDS};summary=json.loads((h/'summary.json').read_text());assert summary['baseline_sha']==COMMIT and summary['manifest_sha256']==baseline['manifest_sha256']
  for ident,logical,fids,roles,count,digest in JOINS:
   inv=selected_inventory[ident];r=csvrows[ident];assert priority[ident]==inv
   assert r['aw_id']==inv['aw_id'] and int(r['logical_fid'])==logical and int(r['geometry_count'])==len(fids) and int(r['source_ids_count'])==count and r['source_ids_sha256']==digest
   assert json.loads(r['bbox'])==inv['bbox'] and int(r['minimum_stage'])==inv['minimum_stage'] and float(r['rendered_network_length_km'])==inv['rendered_network_length_km'] and float(r['rendered_mainstem_length_km'])==inv['rendered_mainstem_length_km']
 print(json.dumps({'status':'passed','system_ids':IDS,'fragment_count':9,'source_reach_counts':[255,168,255],'rendered_coordinate_counts':[1378,1436,1406],'complete_coordinates_rechecked':bool(a.input_cache),'production_decoder_replayed':bool(a.input_cache),'durable_only_limitation':'Without the external cache, unpublished complete coordinates cannot be rechecked.','original_hydrorivers_coordinate_equality_verified':False,'current_live_deployment_checked':False,'selected_inventory_originals_rechecked':bool(a.historical_input_root),'no_external_requests':True}))
if __name__=='__main__':main()
