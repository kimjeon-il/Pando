#!/usr/bin/env python3
"""Offline complete selected-lake validation; optional original-cache decoding replay."""
import argparse,csv,gzip,hashlib,html,importlib.util,io,json,pathlib,re,subprocess,sys,tempfile
sys.dont_write_bytecode=True
PINS = {'scope_source_ids': ['1159109553', '1159110303', '1159108091'], 'scope_aw_ids': ['lakes_base:1159109553', 'lakes_base:1159110303', 'lakes_base:1159108091'], 'features': {'1159109553': {'source_feature': '8966552834d4eeb2172ae4aff9857af118279d6f7cf4ca62db41dbdc2ab996f7', 'source_json': '9f03383861c70bbb8df2aef5aa93f98f98c7bbfae7e72d860fceaad6fb424f19', 'baseline_feature': '7c792c5dad4790cdf90e4790659cbbf3baf7d91da2d387c06602407e44cc3e21', 'source_index': 232, 'fid': 15425, 'logical_fid': 4050, 'core_metadata': '3d86882a862ea2075b4b3313d8d0cebde9d847c7344325be038d763427979f31', 'detail_metadata': '8ad8670ff3ea7d99f6134ff6ba019901200ed820516de1762c4eea562e893679'}, '1159110303': {'source_feature': '9bbb05e629812f519deea2aa0f19e8b63f17d04d8238efb40548d26986a3efba', 'source_json': '7db5da95fe9ec281c9bfe6cce05d0cbacbbe37712d27f857c26ff61e298dd0d5', 'baseline_feature': 'f5183c87cfa7bf01193d1c8197f397a1eabdc437c6ded5dff7bc3b7cf8a0369c', 'source_index': 287, 'fid': 15480, 'logical_fid': 4105, 'core_metadata': 'd341c6d2ba6b8af7115cbdb3aa64d863b28de6d2c2ac17fe8d7aeb5d51251183', 'detail_metadata': '85418aefe81ba321e09bbb6d0fd4e219e080c6bf15622ae6149bae132e8f2c4d'}, '1159108091': {'source_feature': 'c138bfc0758c6ac9843b9ea855865174b4b7b1841d131d3deddd89b858409f65', 'source_json': '019527530d2145b19793a9027ab65cc6d260670aaa5c6e223455b3255149c100', 'baseline_feature': '7a8439cdd0de3927f09ba1dad6bdb5256a93bfb3e8dcd6977d777e3810dc212b', 'source_index': 119, 'fid': 15312, 'logical_fid': 3937, 'core_metadata': 'ca25ac04ff8f286784414e7f5c24320484e2dcfc68b35ee55b1b49520a06ec39', 'detail_metadata': 'a0e75218a960214c8802dab9e5682df6f1b722dae3f8c8daf93dfc7a6ea4374c'}}, 'inventory': {'lakes_base:1159109553': 'b920d21680804c3ec33a634179a3a33631be3a0c153cc98b942cb36ea0b2caef', 'lakes_base:1159110303': 'f9ee6065dda4aae18ce40623dba8f0e30e62e652c243d3c51ed01c9aba5cdb26', 'lakes_base:1159108091': 'b08f8444fb0b192cc60b91784456de1ea5549b52ac0b1c4662e98b86f981af31'}, 'packs': [{'id': 0, 'shard': 0, 'offset': 0, 'length': 26736, 'stage': 0, 'sha256': 'd1cdab23da5a6303d9e9c0768478d698edeefd839814dbbb8c038ac6fb8a7e8a', 'selected_fids': [15312]}, {'id': 1, 'shard': 0, 'offset': 26736, 'length': 174465, 'stage': 0, 'sha256': '7a2efc67054d38ac0e70408474e33c91a119e5f06c4fe2c2813d4875267526f4', 'selected_fids': [15425, 15480]}], 'source_assets': {'baseline-manifest.json': {'bytes': 52975, 'sha256': 'c10eaffd375d5f0d90955fa253b02ec73d9daeff261fa5cfde1f73ca89d2bd80'}, 'lakes_base.geojson': {'bytes': 7016832, 'sha256': 'c848770c5c2177c1e1fe170e1d85faa6c804aad53fb8e8bcfc9b75f14a6a7a5c'}, 'metadata-core.json.gz': {'bytes': 729625, 'sha256': '700b886134bbc44fa7686f8f2c131be53a73a5c2ebaabb468b50ea3e4000cee5'}, 'metadata-detail.json.gz': {'bytes': 1670972, 'sha256': '1416c6932976427e9cb8140f171f4ccb54704111bce49fb8b8260819ce54b2bd'}, 'index.bin.gz': {'bytes': 32632, 'sha256': 'a68aff611d2be202dbf31ef1fbce476386e1d49b1619b68e9219279be7896906'}, 'shard-s0.bin': {'bytes': 4169624, 'sha256': '1ae657ac378ae4fb441425a8ce52c38348541717b363b3a8189d3bd7249702a8'}, 'worker.js': {'bytes': 32253, 'sha256': '14399a8454fb980fb2adc78b7c52bcd32ea5e1b1f313dcfba301886a6b9ddfec'}, 'boundary.js': {'bytes': 3928, 'sha256': 'b9017382fcc828924608c8a32ddbf2831800475a725b432cad9e6445d33bc8ea'}, 'earcut.js': {'bytes': 7131, 'sha256': '1444195270d4358ef8dd1a448074f555d7ac3c83c850f5648b611ea1d2090ff3'}}, 'rights_sha256': '5f72fc05c07abed60a14aafc4dc02061a3614f30ba9b00e0bae17415c7d826c5', 'duplicate_sha256': '2a889cacc0e7e28c9f47d9b8da6618ff63483fcc0be62e3414523d95b91b8218', 'historical_inputs': [{'repository_path': 'reports/hydro-names/current-web-2026-10-08/summary.json', 'bytes': 4359, 'sha256': '4af18507bee586d97a113f903014019d8c8bffa7bf1f4329de0ce95c16d4f4fd', 'git_blob_sha': '9319efd4b3bd4c3cd17594ef9130ad1489c0b18d', 'immutable_url': 'https://github.com/kimjeon-il/Pando/blob/8213678cbfd74ecd930657eaa911f6e87ab6d2b8/reports/hydro-names/current-web-2026-10-08/summary.json', 'original_recovery_date_utc': '2026-10-09', 'original_retrieved_at_utc': None, 'retrieval_time_limit': 'Exact recovery request timestamps are not present in the retained receipts; the recovery date is known.', 'reuse_hash_checked_at_utc': '2026-10-09T13:17:40Z', 'retrieved_this_batch': False, 'in_publishable_package': False}, {'repository_path': 'reports/hydro-names/current-web-2026-10-08/inventory.csv.gz', 'bytes': 441711, 'sha256': '5d1e12b1a6daa695419173dea491ff0c8c5583ed9e28ba517ba4a599bcd589db', 'git_blob_sha': '55a1de2ae76f09bce5e624d96ad17f7531aa3fd8', 'immutable_url': 'https://github.com/kimjeon-il/Pando/blob/8213678cbfd74ecd930657eaa911f6e87ab6d2b8/reports/hydro-names/current-web-2026-10-08/inventory.csv.gz', 'original_recovery_date_utc': '2026-10-09', 'original_retrieved_at_utc': None, 'retrieval_time_limit': 'Exact recovery request timestamps are not present in the retained receipts; the recovery date is known.', 'reuse_hash_checked_at_utc': '2026-10-09T13:17:40Z', 'retrieved_this_batch': False, 'in_publishable_package': False}], 'support_sha256': 'dd6a583181c1527cdd0646f3ce6aee207570042c14e3fa4ebc3d35a36e752d33', 'artifact_names': ['geometry-support.py', 'selected-lake-geometries.geojson', 'selected-baseline-rendered-geometries.geojson', 'selected-inventory-records.json', 'geometry-duplicate-check.json', 'selected-pack-receipts.json', 'extract-baseline-geometries.mjs', 'geometry-publication-rights.json', 'geometry-request-receipts.json'], 'source_asset_records_sha256': '7d60bdd5da6969fdc01c09ad6f13e605f116ea8e41249fb42b027e4c9f0d66de'}
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
    assert ref['schema']=='hydro-lake-geometry-reference-v3' and ref['batch']=='r06','reference schema'
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
        assert c['category']==r['category']=='lake' and c['source_id']==r['source_id'] and c['aw_id']==r['aw_id']
        assert int(c['logical_fid'])==r['logical_fid'] and int(c['geometry_count'])==r['geometry_count']==len(r['geometry_fids'])==1
        assert int(c['source_ids_count'])==r['source_ids_count']==1 and c['source_ids_sha256']==r['source_ids_sha256']==sha(r['source_id'].encode())
        assert json.loads(c['bbox'])==r['bbox'] and int(c['minimum_stage'])==r['minimum_stage'] and float(c['rendered_area_km2'])==r['rendered_area_km2']
    duplicate=json.loads((root/'geometry-duplicate-check.json').read_text())
    assert s.receipt(root/'geometry-duplicate-check.json')['sha256']==PINS['duplicate_sha256'],'prior15 duplicate pin'
    prior=duplicate['previous_aw_ids_in_index_order'];assert duplicate['previous_target_count']==len(prior)==len(set(prior))==15
    assert duplicate['selected_aw_ids']==awids and duplicate['selected_unique_count']==len(set(awids))==3
    assert duplicate['intersection_aw_ids']==sorted(set(prior)&set(awids))==[] and duplicate['historical_names_used_as_identity_evidence'] is False
    sourcecollection=json.loads((root/'selected-lake-geometries.geojson').read_text());renderedcollection=json.loads((root/'selected-baseline-rendered-geometries.geojson').read_text())
    assert sourcecollection['type']==renderedcollection['type']=='FeatureCollection'
    assert [str(f['properties']['source_id']) for f in sourcecollection['features']]==sourceids
    assert [f['properties']['sourceId'] for f in renderedcollection['features']]==sourceids
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
    request=json.loads((root/'geometry-request-receipts.json').read_text());assert request['batch']=='r06' and request['new_external_request_count']==0
    assert [r['asset_name'] for r in request['receipts']]==list(ref['source_assets'])
    for q in request['receipts']:
        asset=ref['source_assets'][q['asset_name']]
        assert q['new_external_request_in_r06'] is False and {k:q[k] for k in ['bytes','sha256']}==PINS['source_assets'][q['asset_name']]
        assert q['original_resource_url']==asset['immutable_url'] and q['original_retrieved_at_utc']==asset['original_retrieved_at_utc'] and q['reuse_hash_checked_at_utc']==asset['reuse_hash_checked_at_utc']==ref['created_at_utc']
    q=request['rights_reuse'];assert q['new_external_request_in_r06'] is False and q['bytes']==rights['original_html_bytes'] and q['sha256']==rights['original_html_sha256'] and q['original_resource_url']==rights['official_terms_url']
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
        assert original['total_distinct_reconstructed_targets']==15 and [r['aw_id'] for r in original['records']]==prior
    if a.check_component_manifest:
        frozen=json.loads((root/'geometry-component-manifest.json').read_text())
        assert frozen['schema']=='frozen-selected-lake-geometry-component-v1' and frozen['batch']=='r06' and frozen['scope_aw_ids']==awids
        assert set(frozen['files'])==set(ref['artifacts'])|{'geometry-README.md','geometry-reference.json','validate-geometry-reference.py','test-geometry-reference.py','geometry-validation.json'}
        for name,digest in frozen['files'].items():assert pathlib.Path(name).name==name and sha((root/name).read_bytes())==digest,'component frozen hash'
    print(json.dumps({'status':'passed','scope_aw_ids':awids,'source_coordinate_counts_including_closure':counts,'all_complete_source_and_baseline_coordinates_rechecked':True,'part_ring_vertex_order_and_hashes_rechecked':True,'source_feature_original_JSON_tokens_rechecked':True,'actual_metadata_and_name_states_rechecked':True,'prior15_duplicate_count':0,'original_source_cache_and_metadata_rechecked':bool(a.input_cache),'production_decoder_replayed':bool(a.input_cache),'original_selected_inventory_rows_rechecked':bool(a.historical_input_root),'original_previous_index_rechecked':bool(a.previous_index),'frozen_component_hashes_rechecked':bool(a.check_component_manifest),'current_live_deployment_checked':False,'no_external_requests':True,'durable_only_limit':'Complete selected features and independent pins are checked; omitted full upstream inputs and production decoder replay require the optional verified local cache.'}))
if __name__=='__main__':main()
