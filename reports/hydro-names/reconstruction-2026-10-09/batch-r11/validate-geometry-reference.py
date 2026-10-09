#!/usr/bin/env python3
"""Offline complete selected-lake validation; optional original-cache decoding replay."""
import argparse,csv,gzip,hashlib,html,importlib.util,io,json,pathlib,re,subprocess,sys,tempfile
sys.dont_write_bytecode=True
PINS = {'scope_source_ids': ['1159112291', '1159112821', '1159109155'], 'scope_aw_ids': ['lakes_base:1159112291', 'lakes_base:1159112821', 'lakes_base:1159109155'], 'features': {'1159112291': {'source_feature': '1065bde406dca68145281f8023e31d7cbec13e36154bfb2666c7a6121cf1f2ce', 'source_json': 'ed08fb361cf62cb194863efeb660b123df6e7381cc475897e66f2a26bc0b2ac7', 'baseline_feature': 'bec5663a74e84058138085f08368ef40a2ec05e97d245aa9201a03c6e7f3d620', 'source_index': 418, 'fid': 15611, 'logical_fid': 4236, 'core_metadata': 'c404e35e4abd8869e16130c104d2d6297629d51c8f650a02d573767032f1b0bc', 'detail_metadata': 'bb3620c75d4787406f88445085f9505113bba8af436e2384376dc5e71a64e23a'}, '1159112821': {'source_feature': '716f2e9086df39174d9331cd6e64d50be32d2c11d73caab0926f2fe96b632a40', 'source_json': 'f55966174209bb106a26ef737d33eb6a71584771dc5a1c76d3c5f2d4ab5d011d', 'baseline_feature': '4f4caff3f9eb901efc35f526abb7f94efec35e8babd06547fc28ca64782fec0f', 'source_index': 456, 'fid': 15649, 'logical_fid': 4274, 'core_metadata': '80f8195f9db95d6d4f054847604f81bda1819ec60bde24b970891d59b485d395', 'detail_metadata': '47608a9fd2b0ed1b15043e4597ae6db7797e15caeb10ac3e165734493fa67093'}, '1159109155': {'source_feature': 'f654017743516e400e1c7bcca4a75136a4129eb9a88ce06c1055df3971fe2865', 'source_json': '7fc93330dffe45f9c76c1bb76751e6501fea6c877cb76a31c515b6f00bf6a561', 'baseline_feature': 'ecb68751b58fdc563620a4a92772b9d42f6785ec8add7167ad7e683d9f891b56', 'source_index': 200, 'fid': 15393, 'logical_fid': 4018, 'core_metadata': '64b84a1633cfa680f21b49ae21266f655fd53eb78e66340fe07394fe3643ec60', 'detail_metadata': '4ad0deee759ec4531e607ead6a4ad39c231abcfc54a46b6796bf462e21d1975d'}}, 'inventory': {'lakes_base:1159112291': '326dbfc19e296e2b162b562d9135885817d2268c631a9662eac2a4ac601889b8', 'lakes_base:1159112821': '36879822baf72533de35baed6ddd3049cbe60fa67f8c046de8c1abf514616ac7', 'lakes_base:1159109155': '97a0d9daf70d70dffd31dfdbfa28a0eacfc5c4052be0fbb4a9a0c4058cdf5e16'}, 'packs': [{'id': 1, 'shard': 0, 'offset': 26736, 'length': 174465, 'stage': 0, 'sha256': '7a2efc67054d38ac0e70408474e33c91a119e5f06c4fe2c2813d4875267526f4', 'selected_fids': [15393]}, {'id': 107, 'shard': 0, 'offset': 3144203, 'length': 4478, 'stage': 2, 'sha256': '30cc904d634636747a0fcbad8365ee993983782b3d6f7315e4dea3511c4b6e16', 'selected_fids': [15649]}, {'id': 113, 'shard': 0, 'offset': 3166303, 'length': 8924, 'stage': 2, 'sha256': 'c4e3bb7e10dc2719a528c565e3942b36eb4d4ba7b565708a4efbc1b3fee23cb3', 'selected_fids': [15611]}], 'source_assets': {'baseline-manifest.json': {'bytes': 52975, 'sha256': 'c10eaffd375d5f0d90955fa253b02ec73d9daeff261fa5cfde1f73ca89d2bd80'}, 'lakes_base.geojson': {'bytes': 7016832, 'sha256': 'c848770c5c2177c1e1fe170e1d85faa6c804aad53fb8e8bcfc9b75f14a6a7a5c'}, 'metadata-core.json.gz': {'bytes': 729625, 'sha256': '700b886134bbc44fa7686f8f2c131be53a73a5c2ebaabb468b50ea3e4000cee5'}, 'metadata-detail.json.gz': {'bytes': 1670972, 'sha256': '1416c6932976427e9cb8140f171f4ccb54704111bce49fb8b8260819ce54b2bd'}, 'index.bin.gz': {'bytes': 32632, 'sha256': 'a68aff611d2be202dbf31ef1fbce476386e1d49b1619b68e9219279be7896906'}, 'shard-s0.bin': {'bytes': 4169624, 'sha256': '1ae657ac378ae4fb441425a8ce52c38348541717b363b3a8189d3bd7249702a8'}, 'worker.js': {'bytes': 32253, 'sha256': '14399a8454fb980fb2adc78b7c52bcd32ea5e1b1f313dcfba301886a6b9ddfec'}, 'boundary.js': {'bytes': 3928, 'sha256': 'b9017382fcc828924608c8a32ddbf2831800475a725b432cad9e6445d33bc8ea'}, 'earcut.js': {'bytes': 7131, 'sha256': '1444195270d4358ef8dd1a448074f555d7ac3c83c850f5648b611ea1d2090ff3'}}, 'rights_sha256': '8635d5a3edd8e7b17e112332464f335b860b6d1a4cf42b3fb929a4fc7b18488a', 'duplicate_sha256': '4a48ffb107df221d2e80c878412d98468ecc09ac999bacdfb9e0e8b637d2b7da', 'historical_inputs': [{'repository_path': 'reports/hydro-names/current-web-2026-10-08/summary.json', 'bytes': 4359, 'sha256': '4af18507bee586d97a113f903014019d8c8bffa7bf1f4329de0ce95c16d4f4fd', 'git_blob_sha': '9319efd4b3bd4c3cd17594ef9130ad1489c0b18d', 'immutable_url': 'https://github.com/kimjeon-il/Pando/blob/8213678cbfd74ecd930657eaa911f6e87ab6d2b8/reports/hydro-names/current-web-2026-10-08/summary.json', 'original_recovery_date_utc': '2026-10-09', 'original_retrieved_at_utc': None, 'retrieval_time_limit': 'Exact recovery request timestamps are not present in the retained receipts; the recovery date is known.', 'reuse_hash_checked_at_utc': '2026-10-09T15:04:45Z', 'retrieved_this_batch': False, 'in_publishable_package': False}, {'repository_path': 'reports/hydro-names/current-web-2026-10-08/inventory.csv.gz', 'bytes': 441711, 'sha256': '5d1e12b1a6daa695419173dea491ff0c8c5583ed9e28ba517ba4a599bcd589db', 'git_blob_sha': '55a1de2ae76f09bce5e624d96ad17f7531aa3fd8', 'immutable_url': 'https://github.com/kimjeon-il/Pando/blob/8213678cbfd74ecd930657eaa911f6e87ab6d2b8/reports/hydro-names/current-web-2026-10-08/inventory.csv.gz', 'original_recovery_date_utc': '2026-10-09', 'original_retrieved_at_utc': None, 'retrieval_time_limit': 'Exact recovery request timestamps are not present in the retained receipts; the recovery date is known.', 'reuse_hash_checked_at_utc': '2026-10-09T15:04:45Z', 'retrieved_this_batch': False, 'in_publishable_package': False}], 'support_sha256': 'dd6a583181c1527cdd0646f3ce6aee207570042c14e3fa4ebc3d35a36e752d33', 'artifact_names': ['geometry-support.py', 'selected-lake-geometries.geojson', 'selected-baseline-rendered-geometries.geojson', 'selected-inventory-records.json', 'geometry-duplicate-check.json', 'selected-pack-receipts.json', 'extract-baseline-geometries.mjs', 'geometry-publication-rights.json', 'geometry-request-receipts.json'], 'source_asset_records_sha256': '2c19de276df44bcc10b2dc65d95b6352cf2b534dace08eb7028cf49c08834312'}
COMMIT='fd6744f5e72a0c1a107452dbde6d416ab57237db'

def names(m):return {k:v for k,v in m.items() if k=='name' or k.startswith('name_') or k in ['nameKo','nameEn','nameOriginal']}

def main():
    if not __debug__:raise RuntimeError('Python -O disables required assertions and is unsupported.')
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--directory',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parent)
    p.add_argument('--input-cache',type=pathlib.Path,help='Optional immutable source, metadata, decoder and pack inputs; read locally only.')
    p.add_argument('--historical-input-root',type=pathlib.Path,help='Optional recovered repository root for original selected CSV rows.')
    p.add_argument('--previous-index',type=pathlib.Path,help='Optional original previous index for byte-for-byte duplicate-list verification.')
    p.add_argument('--check-component-manifest',action='store_true',help='Verify the final frozen geometry-component-manifest.json file list.')
    a=p.parse_args();root=a.directory
    assert hashlib.sha256((root/'geometry-support.py').read_bytes()).hexdigest()==PINS['support_sha256'],'support pin'
    spec=importlib.util.spec_from_file_location('geometry_support',root/'geometry-support.py');s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s);sha=s.sha;canon=s.canonical
    ref=json.loads((root/'geometry-reference.json').read_text())
    assert ref['schema']=='hydro-lake-geometry-reference-v3' and ref['batch']=='r11','reference schema'
    assert ref['scope_source_ids']==PINS['scope_source_ids'] and ref['scope_aw_ids']==PINS['scope_aw_ids'],'selected scope'
    assert len(set(PINS['scope_source_ids']))==len(PINS['scope_source_ids'])==3
    b=ref['baseline'];assert b['git_commit']==COMMIT and b['hydro_version']=='0.13.1' and b['manifest_sha256']==PINS['source_assets']['baseline-manifest.json']['sha256'],'baseline pins'
    assert b['all_selected_baseline_fragments_decoded'] is b['production_decoder_hash_verified'] is True
    assert b['baseline_assets_retrieved_this_batch'] is b['current_live_deployment_checked'] is b['current_live_deployment_equality_claimed'] is False,'current deployment limit'
    assert all(v is False for v in ref['name_scope'].values()),'name scope'
    assert set(ref['artifacts'])==set(PINS['artifact_names']),'artifact scope'
    for n,r in ref['artifacts'].items():assert pathlib.Path(n).name==n;s.verified(root/n,r)
    assert set(ref['source_assets'])==set(PINS['source_assets'])
    assert sha(canon(ref['source_assets']))==PINS['source_asset_records_sha256'],'source asset provenance pins'
    for n,r in ref['source_assets'].items():
        assert {k:r[k] for k in ['bytes','sha256']}==PINS['source_assets'][n]
        assert r['retrieved_this_batch'] is r['in_publishable_package'] is False
        assert r['immutable_url']=='https://github.com/kimjeon-il/Pando/blob/'+COMMIT+'/'+r['repository_path']
    assert ref['selected_inventory_inputs']==PINS['historical_inputs'],'historical provenance pins'
    invfile=json.loads((root/'selected-inventory-records.json').read_text());inv=invfile['records'];sourceids=PINS['scope_source_ids'];awids=PINS['scope_aw_ids']
    assert invfile['scope_aw_ids']==awids and [r['aw_id'] for r in inv]==awids and invfile['historical_names_used_as_identity_evidence'] is False and invfile['all_three_selected_csv_rows_exact'] is True
    for r in inv:
        assert sha(canon(r))==PINS['inventory'][r['aw_id']],'selected inventory pin'
        c=r['inventory_csv_row_exact'];assert sha(canon(c))==r['inventory_csv_row_canonical_sha256']
        assert c['classification']!='named_display','current selected initially eligible'
        assert c['category']==r['category']=='lake' and c['source_id']==r['source_id'] and c['aw_id']==r['aw_id']
        assert int(c['logical_fid'])==r['logical_fid'] and int(c['geometry_count'])==r['geometry_count']==len(r['geometry_fids'])==1
        assert int(c['source_ids_count'])==r['source_ids_count']==1 and c['source_ids_sha256']==r['source_ids_sha256']==sha(r['source_id'].encode())
        assert json.loads(c['bbox'])==r['bbox'] and int(c['minimum_stage'])==r['minimum_stage'] and float(c['rendered_area_km2'])==r['rendered_area_km2']
    duplicate=json.loads((root/'geometry-duplicate-check.json').read_text())
    assert s.receipt(root/'geometry-duplicate-check.json')['sha256']==PINS['duplicate_sha256'],'prior30 duplicate pin'
    prior=duplicate['previous_aw_ids_in_index_order'];assert duplicate['previous_target_count']==len(prior)==len(set(prior))==30
    assert duplicate['selected_aw_ids']==awids and duplicate['selected_unique_count']==len(set(awids))==3
    assert duplicate['intersection_aw_ids']==sorted(set(prior)&set(awids))==[] and duplicate['historical_names_used_as_identity_evidence'] is False
    delta=duplicate['current_batch_delta']
    assert delta=={'selected_current_inventory_targets':3,'selected_current_target_types':{'lake':3},'all_current_targets_initially_eligible':True,'initial_eligible_target_count':4065,'reconstructed_target_count_before':30,'reconstructed_target_count_after':33,'remaining_fresh_reconstruction_queue_before':4035,'remaining_fresh_reconstruction_queue_after':4032,'remaining_queue_types_before':{'lake':596,'river_group':3439},'remaining_queue_types_after':{'lake':593,'river_group':3439},'historically_never_reviewed_count_claimed':False,'prior_target_geometry_or_naming_revalidation_performed':False},'current-three queue delta'
    sourcecollection=json.loads((root/'selected-lake-geometries.geojson').read_text());renderedcollection=json.loads((root/'selected-baseline-rendered-geometries.geojson').read_text())
    assert sourcecollection['type']==renderedcollection['type']=='FeatureCollection'
    assert [str(f['properties']['source_id']) for f in sourcecollection['features']]==sourceids,'selected source order'
    assert len(renderedcollection['features'])==len(PINS['features'])==3,'complete selected baseline count'
    assert [f['properties']['sourceId'] for f in renderedcollection['features']]==sourceids,'selected baseline source IDs and order'
    assert [r['source_id'] for r in ref['selected_features']]==sourceids
    source=s.source_features((root/'selected-lake-geometries.geojson').read_bytes(),sourceids)
    metadata={};counts=[]
    for invrow,r,f in zip(inv,ref['selected_features'],renderedcollection['features']):
        ident=r['source_id'];pin=PINS['features'][ident];_,src,raw=source[ident];m=f['properties']
        assert sha(canon(src))==r['source_feature_canonical_sha256']==pin['source_feature'],'source feature pin'
        assert sha(raw)==r['source_feature_original_json_sha256']==pin['source_json'] and len(raw)==r['source_feature_original_json_bytes'],'source JSON token pin'
        assert r['source_feature_zero_based_index']==pin['source_index'],'source index pin'
        assert sha(canon(f))==r['baseline_feature_canonical_sha256']==pin['baseline_feature'],'baseline feature pin'
        assert sha(canon(r['baseline_core_metadata_exact']))==pin['core_metadata'],'exact core metadata pin'
        assert sha(canon(r['baseline_detail_metadata_exact']))==pin['detail_metadata'],'exact detail metadata pin'
        assert r['baseline_core_metadata_exact']|r['baseline_detail_metadata_exact']==m,'exact core/detail metadata join'
        assert names(r['baseline_core_metadata_exact'])==r['baseline_core_name_fields_exact'] and names(r['baseline_detail_metadata_exact'])==r['baseline_detail_name_fields_exact'],'separate core/detail name states'
        assert m==r['baseline_metadata_exact'] and m['sourceId']==ident and m['awId']==src['id']==src['properties']['pandolab_id']==r['aw_id']==invrow['aw_id']
        assert m['fid']==f['id']==r['baseline_fid']==invrow['geometry_fids'][0]==pin['fid'] and m['logicalFid']==r['baseline_logical_fid']==invrow['logical_fid']==pin['logical_fid']
        assert m['fragmentCount']==1 and m['fragmentIndex']==0 and m['category']=='lake'
        assert names(src['properties'])==r['source_name_fields_exact'] and names(m)==r['baseline_name_fields_exact'],'actual name state'
        assert r['name_verdict_established'] is False
        assert sha(ident.encode())==r['source_ids_sha256']==invrow['source_ids_sha256']
        assert s.lake_metrics(src['geometry'])==r['source_geometry'] and s.lake_metrics(f['geometry'])==r['baseline_rendered_geometry'],'geometry structure and ordered ring hashes'
        assert r['baseline_rendered_geometry']['bbox']==invrow['bbox']==[v/1e6 for v in m['bounds']] and m['stage']==invrow['minimum_stage']
        assert r['historical_rendered_area_km2']==invrow['rendered_area_km2']
        aa=s.polygon_parts(src['geometry']);bb=s.polygon_parts(f['geometry']);assert [[len(ring) for ring in part] for part in aa]==[[len(ring) for ring in part] for part in bb]
        x=[v for part in aa for ring in part for v in ring];y=[v for part in bb for ring in part for v in ring]
        assert [[round(v,6) for v in point] for point in x]==y,'source to baseline ordered coordinates'
        assert r['source_to_baseline_comparison']=={'same_geometry_type':src['geometry']['type']==f['geometry']['type'],'same_part_ring_and_vertex_order':True,'every_coordinate_matches_source_rounded_to_6_decimals':True,'maximum_absolute_coordinate_difference_degrees':max(abs(v-w) for p,q in zip(x,y) for v,w in zip(p,q))}
        metadata[m['fid']]=m;counts.append(len(x))
    packs=json.loads((root/'selected-pack-receipts.json').read_text());assert packs==ref['selected_baseline_packs']==PINS['packs'],'pack pins'
    assert sorted(fid for p in packs for fid in p['selected_fids'])==sorted(metadata)
    for pack in packs:
        for fid in pack['selected_fids']:assert metadata[fid]['stage']==pack['stage']
    rights=json.loads((root/'geometry-publication-rights.json').read_text());assert s.receipt(root/'geometry-publication-rights.json')['sha256']==PINS['rights_sha256'],'rights pin'
    assert rights['selected_source_ids']==sourceids and rights['complete_selected_lake_coordinates_in_public_package'] is True
    assert rights['retrieved_this_batch'] is rights['complete_upstream_assets_in_public_package'] is rights['binary_packs_or_worker_bodies_in_public_package'] is False
    request=json.loads((root/'geometry-request-receipts.json').read_text());assert request['batch']=='r11' and request['new_external_request_count']==0
    assert [r['asset_name'] for r in request['receipts']]==list(ref['source_assets'])
    for q in request['receipts']:
        asset=ref['source_assets'][q['asset_name']]
        assert q['new_external_request_in_r11'] is False and {k:q[k] for k in ['bytes','sha256']}==PINS['source_assets'][q['asset_name']]
        assert q['original_resource_url']==asset['immutable_url'] and q['original_retrieved_at_utc']==asset['original_retrieved_at_utc'] and q['reuse_hash_checked_at_utc']==asset['reuse_hash_checked_at_utc']==ref['created_at_utc']
    q=request['rights_reuse'];assert q['new_external_request_in_r11'] is False and q['bytes']==rights['original_html_bytes'] and q['sha256']==rights['original_html_sha256'] and q['original_resource_url']==rights['official_terms_url']
    for geo in root.glob('*.geojson'):
        assert geo.name in ['selected-lake-geometries.geojson','selected-baseline-rendered-geometries.geojson'],'unexpected public geometry'
    assert not list(root.glob('*.bin')) and not (root/'worker.js').exists(),'raw upstream publication exclusion'
    if a.input_cache:
        for n,r in ref['source_assets'].items():s.verified(a.input_cache/n,r)
        terms=s.verified(a.input_cache/'naturalearth-terms.html',{'bytes':rights['original_html_bytes'],'sha256':rights['original_html_sha256']})
        assert rights['short_excerpt'] in ' '.join(html.unescape(re.sub('<[^>]+>',' ',terms.decode())).split())
        fullsource=s.source_features((a.input_cache/'lakes_base.geojson').read_bytes(),sourceids)
        for r in ref['selected_features']:
            index,f,raw=fullsource[r['source_id']];assert index==r['source_feature_zero_based_index'] and raw==source[r['source_id']][2]
        core={r['fid']:r for r in json.loads(gzip.decompress((a.input_cache/'metadata-core.json.gz').read_bytes()))['features']};detail={r['fid']:r for r in json.loads(gzip.decompress((a.input_cache/'metadata-detail.json.gz').read_bytes()))['features']}
        for r in ref['selected_features']:
            fid=r['baseline_fid'];assert core[fid]==r['baseline_core_metadata_exact'] and detail[fid]==r['baseline_detail_metadata_exact'] and core[fid]|detail[fid]==metadata[fid]
        for r in inv:assert sorted(fid for fid,m in core.items() if m['awId']==r['aw_id'])==r['geometry_fids']
        with tempfile.TemporaryDirectory() as d:
            out=pathlib.Path(d)/'selected-baseline-rendered-geometries.geojson';run=subprocess.run(['node',str(root/'extract-baseline-geometries.mjs'),str(a.input_cache),str(out)],capture_output=True,text=True)
            assert run.returncode==0,run.stderr
            assert out.read_bytes()==(root/out.name).read_bytes(),'exact production decode bytes'
            assert json.loads((out.parent/'selected-pack-receipts.json').read_text())==packs
    if a.historical_input_root:
        for r in ref['selected_inventory_inputs']:s.verified(a.historical_input_root/r['repository_path'],r)
        h=a.historical_input_root/'reports/hydro-names/current-web-2026-10-08';summary=json.loads((h/'summary.json').read_text())
        assert summary['baseline_sha']==COMMIT and summary['manifest_sha256']==b['manifest_sha256']
        selected=[r for r in csv.DictReader(io.StringIO(gzip.decompress((h/'inventory.csv.gz').read_bytes()).decode())) if r['aw_id'] in awids]
        assert len(selected)==3 and len({r['aw_id'] for r in selected})==3
        selected={r['aw_id']:r for r in selected}
        for r in inv:assert r['inventory_csv_row_exact']==selected[r['aw_id']]
    if a.previous_index:
        s.verified(a.previous_index,duplicate['previous_index_receipt']);original=json.loads(a.previous_index.read_text())
        assert original['total_distinct_reconstructed_targets']==30 and [r['aw_id'] for r in original['records']]==prior
        assert original['remaining_queue_recovery']['remaining_without_reconstructed_record']==delta['remaining_fresh_reconstruction_queue_before'] and original['remaining_queue_recovery']['remaining_without_reconstructed_record_by_type']==delta['remaining_queue_types_before']
    if a.check_component_manifest:
        frozen=json.loads((root/'geometry-component-manifest.json').read_text())
        assert frozen['schema']=='frozen-selected-lake-geometry-component-v1' and frozen['batch']=='r11' and frozen['scope_aw_ids']==awids
        assert frozen['complete_selected_lake_coordinates_in_public_package'] is True and frozen['binary_packs_or_worker_bodies_in_public_package'] is False and frozen['new_external_requests']==0,'component publication scope'
        assert set(frozen['files'])==set(ref['artifacts'])|{'geometry-README.md','geometry-reference.json','validate-geometry-reference.py','test-geometry-reference.py','geometry-validation.json'}
        for name,digest in frozen['files'].items():assert pathlib.Path(name).name==name and sha((root/name).read_bytes())==digest,'component frozen hash'
    print(json.dumps({'status':'passed','scope_aw_ids':awids,'source_coordinate_counts_including_closure':counts,'all_complete_source_and_baseline_coordinates_rechecked':True,'part_ring_vertex_order_and_hashes_rechecked':True,'source_feature_original_JSON_tokens_rechecked':True,'actual_metadata_and_name_states_rechecked':True,'prior30_duplicate_count':0,'current_three_initial_inventory_membership_and_eligible_status_rechecked':True,'current_three_queue_delta_rechecked':True,'prior30_geometry_or_naming_revalidation_performed':False,'original_source_cache_and_metadata_rechecked':bool(a.input_cache),'production_decoder_replayed':bool(a.input_cache),'original_selected_inventory_rows_rechecked':bool(a.historical_input_root),'original_previous_index_rechecked':bool(a.previous_index),'frozen_component_hashes_rechecked':bool(a.check_component_manifest),'current_live_deployment_checked':False,'no_external_requests':True,'durable_only_limit':'Complete selected features and independent pins are checked; omitted full upstream inputs and production decoder replay require the optional verified local cache.'}))
if __name__=='__main__':main()
