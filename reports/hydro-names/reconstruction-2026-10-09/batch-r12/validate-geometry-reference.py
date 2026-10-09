#!/usr/bin/env python3
"""Offline validation of included selected-lake evidence only; no omitted-input replay."""
import argparse,hashlib,importlib.util,json,pathlib,sys
sys.dont_write_bytecode=True
PINS = {'scope_source_ids': ['1159108391', '1159112839', '1159112207'], 'scope_aw_ids': ['lakes_base:1159108391', 'lakes_base:1159112839', 'lakes_base:1159112207'], 'features': {'1159108391': {'source_feature': '1c665e901e42068d7d449f541cbd7df873fe428a5d333293c013434c8f0ed8a7', 'source_json': '266021e568809d8b1650b1076e7c44b29ade75bf22c558a230db84b316737755', 'baseline_feature': '241ec9c74433e5a0ba218f502d9ea8cd6e3e7d50abc597c35ad76b7bb0c22510', 'source_index': 141, 'fid': 15334, 'logical_fid': 3959, 'core_metadata': 'ce9fb99018c726481e456dbd51b182c0ec970c41b8185edd6c515d486252963c', 'detail_metadata': '3b31b27d1621f42f60fcac321247241ec52ee83c968783fef35dc61d5b4c5c4f'}, '1159112839': {'source_feature': '136128f02ee94066f93bc5d9f689931f18289df8ead757145b7c0b26421f24fc', 'source_json': 'b969d03ec4b45fffdc9ded88fec770437b0fdd87ecd46e446da9b587ad0d8f56', 'baseline_feature': '3905d1876e2a94eb87bf14265b9e02f6eb87a2b145d55af86185a5884a531e43', 'source_index': 457, 'fid': 15650, 'logical_fid': 4275, 'core_metadata': '9e8fe3aa7527f216984dc8b44840d4de22d9703bda7d021a093a8f1869828e9d', 'detail_metadata': '842d3628f6ffde73e2817de49544700cbfafc69aec715b29dcf9036e934487a2'}, '1159112207': {'source_feature': 'ab9c44044306234ad74373da4dc6e6d469c1649e3b750105e5638617aa1c9479', 'source_json': '9a3905abf3a46ad119175d4a0d70df40fcc463d64e639d91b7e64aa8e6091262', 'baseline_feature': '447e8f7e5d3ca616a25ef6555b488ea5a9b712943341318f631ebdee7ae15864', 'source_index': 411, 'fid': 15604, 'logical_fid': 4229, 'core_metadata': 'd3a6b83eaf82f2a4af9f8b634478b3761634cd6da9c898775a3a497efa4a792a', 'detail_metadata': 'd6b5302ccb3a405e777867acbd5911f40a5de890612e50f57c341b31e04642b8'}}, 'inventory': {'lakes_base:1159108391': '10b3d4e315cd3fbf9d747f46cdb76a71cb574530ed22262c8bcc030678dc57b2', 'lakes_base:1159112839': '9b6ab802fb016caba12c7f8636e64262d9356bbb943155b313ed8e04fd8cc5d4', 'lakes_base:1159112207': '55d7a9d0fa8e3df556379b1d134877ba6e41c1ae26a2a2e3646e42f7d07b6d92'}, 'support_sha256': 'dd6a583181c1527cdd0646f3ce6aee207570042c14e3fa4ebc3d35a36e752d33', 'rights_sha256': 'b8b4516ccf71ad7b951cd73f76b9f022f920dc828e022ec5fe1f130b360d669b', 'duplicate_sha256': 'e694811cde91dcf14165123dfb5df8a6051b250b26c733e264e94452c87fd95f', 'artifact_names': ['geometry-support.py', 'selected-lake-geometries.geojson', 'selected-baseline-rendered-geometries.geojson', 'selected-inventory-records.json', 'geometry-duplicate-check.json', 'geometry-publication-rights.json'], 'public_source_references': [{'purpose': 'Original public lake source at the baseline commit', 'repository_path': 'assets/data/hydro/lakes_base.geojson', 'immutable_url': 'https://github.com/kimjeon-il/Pando/blob/fd6744f5e72a0c1a107452dbde6d416ab57237db/assets/data/hydro/lakes_base.geojson'}, {'purpose': 'Public baseline release manifest', 'repository_path': 'assets/data/hydro/v0.13.1/manifest.json', 'immutable_url': 'https://github.com/kimjeon-il/Pando/blob/fd6744f5e72a0c1a107452dbde6d416ab57237db/assets/data/hydro/v0.13.1/manifest.json'}, {'purpose': 'Already published initial inventory containing the selected rows', 'repository_path': 'reports/hydro-names/current-web-2026-10-08/inventory.csv.gz', 'immutable_url': 'https://github.com/kimjeon-il/Pando/blob/8213678cbfd74ecd930657eaa911f6e87ab6d2b8/reports/hydro-names/current-web-2026-10-08/inventory.csv.gz'}]}
COMMIT='fd6744f5e72a0c1a107452dbde6d416ab57237db'

def names(m):return {k:v for k,v in m.items() if k=='name' or k.startswith('name_') or k in ['nameKo','nameEn','nameOriginal']}

def main():
    if not __debug__:raise RuntimeError('Python -O disables required assertions and is unsupported.')
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--directory',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parent)
    p.add_argument('--check-component-manifest',action='store_true',help='Verify the final frozen geometry-component-manifest.json file list.')
    a=p.parse_args();root=a.directory
    assert hashlib.sha256((root/'geometry-support.py').read_bytes()).hexdigest()==PINS['support_sha256'],'support pin'
    spec=importlib.util.spec_from_file_location('geometry_support',root/'geometry-support.py');s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s);sha=s.sha;canon=s.canonical
    ref=json.loads((root/'geometry-reference.json').read_text())
    assert ref['schema']=='hydro-lake-geometry-reference-public-v4' and ref['batch']=='r12','reference schema'
    assert ref['scope_source_ids']==PINS['scope_source_ids'] and ref['scope_aw_ids']==PINS['scope_aw_ids'],'selected scope'
    assert len(set(PINS['scope_source_ids']))==len(PINS['scope_source_ids'])==3
    assert ref['validation_scope']=='included-selected-evidence-only','validation scope'
    assert not set(ref)&{'source_assets','selected_inventory_inputs','selected_baseline_packs','validation_modes'},'included evidence scope'
    b=ref['baseline'];assert b['git_commit']==COMMIT and b['hydro_version']=='0.13.1','baseline source commit'
    assert set(b)=={'repository','git_commit','hydro_version','current_live_deployment_checked','current_live_deployment_equality_claimed'},'baseline factual scope'
    assert b['current_live_deployment_checked'] is b['current_live_deployment_equality_claimed'] is False,'current deployment limit'
    assert ref['historical_source_baseline_comparison']['performed'] is True,'historical comparison fact'
    assert ref['public_source_references']==PINS['public_source_references'],'public source provenance'
    assert all(v is False for v in ref['name_scope'].values()),'name scope'
    assert set(ref['artifacts'])==set(PINS['artifact_names']),'artifact scope'
    for n,r in ref['artifacts'].items():assert pathlib.Path(n).name==n;s.verified(root/n,r)
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
    assert s.receipt(root/'geometry-duplicate-check.json')['sha256']==PINS['duplicate_sha256'],'prior33 duplicate pin'
    assert 'previous_index_receipt' not in duplicate,'included duplicate scope'
    prior=duplicate['previous_aw_ids_in_index_order'];assert duplicate['previous_target_count']==len(prior)==len(set(prior))==33
    assert duplicate['selected_aw_ids']==awids and duplicate['selected_unique_count']==len(set(awids))==3
    assert duplicate['intersection_aw_ids']==sorted(set(prior)&set(awids))==[] and duplicate['historical_names_used_as_identity_evidence'] is False
    assert duplicate['preserved_pending_access_ids']==['lakes_base:1159112821'] and duplicate['pending_access_reassessment_performed'] is False,'preserved pending-access separation'
    delta=duplicate['current_batch_delta']
    assert delta=={'selected_current_inventory_targets':3,'selected_current_target_types':{'lake':3},'all_current_targets_initially_eligible':True,'initial_eligible_target_count':4065,'reconstructed_target_count_before':33,'reconstructed_target_count_after':36,'remaining_fresh_reconstruction_queue_before':4032,'remaining_fresh_reconstruction_queue_after':4029,'remaining_queue_types_before':{'lake':593,'river_group':3439},'remaining_queue_types_after':{'lake':590,'river_group':3439},'historically_never_reviewed_count_claimed':False,'prior_target_geometry_or_naming_revalidation_performed':False},'current-three queue delta'
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
    rights=json.loads((root/'geometry-publication-rights.json').read_text());assert s.receipt(root/'geometry-publication-rights.json')['sha256']==PINS['rights_sha256'],'rights pin'
    assert rights['selected_source_ids']==sourceids and rights['complete_selected_lake_coordinates_in_public_package'] is True
    assert rights['complete_upstream_assets_in_public_package'] is rights['binary_packs_or_worker_bodies_in_public_package'] is rights['terms_body_in_public_package'] is False
    assert rights['official_terms_url']=='https://www.naturalearthdata.com/about/terms-of-use/'
    for geo in root.glob('*.geojson'):
        assert geo.name in ['selected-lake-geometries.geojson','selected-baseline-rendered-geometries.geojson'],'unexpected public geometry'
    assert not list(root.glob('*.bin')) and not (root/'worker.js').exists(),'raw upstream publication exclusion'
    if a.check_component_manifest:
        frozen=json.loads((root/'geometry-component-manifest.json').read_text())
        assert frozen['schema']=='frozen-selected-lake-geometry-component-public-v2' and frozen['batch']=='r12' and frozen['scope_aw_ids']==awids
        assert frozen['validation_scope']=='included-selected-evidence-only','component validation scope'
        assert frozen['complete_selected_lake_coordinates_in_public_package'] is True and frozen['binary_packs_or_worker_bodies_in_public_package'] is False and frozen['new_external_requests']==0,'component publication scope'
        assert set(frozen['files'])==set(ref['artifacts'])|{'geometry-README.md','geometry-reference.json','validate-geometry-reference.py','test-geometry-reference.py','geometry-validation.json'}
        for name,digest in frozen['files'].items():assert pathlib.Path(name).name==name and sha((root/name).read_bytes())==digest,'component frozen hash'
    print(json.dumps({'status':'passed','validation_scope':'included-selected-evidence-only','scope_aw_ids':awids,'source_coordinate_counts_including_closure':counts,'all_complete_included_source_and_baseline_coordinates_rechecked':True,'part_ring_vertex_order_and_hashes_rechecked':True,'included_source_feature_original_JSON_tokens_rechecked':True,'included_metadata_and_name_states_rechecked':True,'prior33_duplicate_count':0,'included_selected_inventory_facts_and_eligible_status_rechecked':True,'included_current_three_queue_delta_rechecked':True,'prior33_geometry_or_naming_revalidation_performed':False,'preserved_pending_access_ids':['lakes_base:1159112821'],'pending_access_reassessment_performed':False,'historical_source_baseline_comparison_recorded':True,'omitted_source_body_checks_replayed':False,'production_decoder_replayed':False,'original_inventory_or_previous_index_revalidated':False,'frozen_component_hashes_rechecked':bool(a.check_component_manifest),'current_live_deployment_checked':False,'no_external_requests':True,'validation_limit':'Only included selected evidence is validated; omitted source bodies, decoder dependencies, original inventory and prior-index bytes are not reconstructed or checked.'}))
if __name__=='__main__':main()
