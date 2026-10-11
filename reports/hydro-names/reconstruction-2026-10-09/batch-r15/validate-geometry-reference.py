#!/usr/bin/env python3
"""Offline validation of included selected-lake evidence only; no omitted-input replay."""
import argparse,hashlib,importlib.util,json,pathlib,sys
sys.dont_write_bytecode=True
PINS = {'scope_source_ids': ['1159108369', '1159109845', '1159109803'], 'scope_aw_ids': ['lakes_base:1159108369', 'lakes_base:1159109845', 'lakes_base:1159109803'], 'features': {'1159108369': {'source_feature': '6927b301b78737b08ab3b418d441f7d6425c5205ede8aba5808520ff81d4770c', 'source_json': '706b3cabb0557b495ad44ab127d36bc576dad0ab03f3c1fe8e36bf3422f11fe8', 'baseline_feature': '22475950906d5635c9e1b768e6e1e442348579dab5b69a8cc2c5700769082060', 'source_index': 140, 'fid': 15333, 'logical_fid': 3958, 'core_metadata': 'cd2ef6e7ae35d68211fead95c4586f61860bd09751800fa8e4c254e35cfb4bca', 'detail_metadata': '29e0bc85427159cdda8408890b1da73efe00fa4f4bd0ae99a6fe3c2a56557380'}, '1159109845': {'source_feature': '4526212812900c13edb54ad2b30501ad1c380c4c59d54c96d69ba75e326fd816', 'source_json': 'ca5753e014b15da1faf9726a113aaabfc43e2bbb6370f931c8c2f6e695df3682', 'baseline_feature': 'c2d27752f0d1c2d02f4e332649c82a2b6229b40764099d9c75c8ff1897093112', 'source_index': 254, 'fid': 15447, 'logical_fid': 4072, 'core_metadata': 'a41b3937ffd491569f52e210de9242cde974e528aa78c43cc83208ba35893ba7', 'detail_metadata': 'adf7cdf06d3d65b2d990363e76ad3eba4df194965c30ea5ed50f72982680ee39'}, '1159109803': {'source_feature': 'd646d797be574d19ff09e283931b6645c416aed100fe53f4ed435fce9936c98f', 'source_json': '9bfc1b1af3355c7bda64911d7032255652682e51d65bd01d04765f311926ae2a', 'baseline_feature': 'f57ff8a143fe05bbf673ecc6efe236a6aae3579e198057c23e05edc84e1b3125', 'source_index': 251, 'fid': 15444, 'logical_fid': 4069, 'core_metadata': '8f6eae253d34ab8c5778aab43d1bf597f141bbb14cb06222027f1295c2f4e903', 'detail_metadata': '202f68f3ab2195187830880d683cb53636fe895d62fea84d68b5321720a9a4e1'}}, 'inventory': {'lakes_base:1159108369': '485a9e16d356c05368a7eaa47230278910de0cd2509b37f1964c59d6489b9b15', 'lakes_base:1159109845': '330e7b748440ca7c9f27dcb13c25ff473184759c7e2fe914041f6486f1f69c2f', 'lakes_base:1159109803': 'd29368f12890526f212df80b909a35628dd7947bcb34e785fe375207bfc4e401'}, 'support_sha256': 'dd6a583181c1527cdd0646f3ce6aee207570042c14e3fa4ebc3d35a36e752d33', 'rights_sha256': 'faed2feb52c83ea2f0e12b8600afcb7be69f784ab2d79610d16283159db4b15f', 'duplicate_sha256': '184ccb20fb3dee312f1f72ce952b74bbe62d17687f1e0ab66be9067b58e876ce', 'artifact_names': ['geometry-support.py', 'selected-lake-geometries.geojson', 'selected-baseline-rendered-geometries.geojson', 'selected-inventory-records.json', 'geometry-duplicate-check.json', 'geometry-publication-rights.json'], 'public_source_references': [{'purpose': 'Original public lake source at the baseline commit', 'repository_path': 'assets/data/hydro/lakes_base.geojson', 'immutable_url': 'https://github.com/kimjeon-il/Pando/blob/fd6744f5e72a0c1a107452dbde6d416ab57237db/assets/data/hydro/lakes_base.geojson'}, {'purpose': 'Public baseline release manifest', 'repository_path': 'assets/data/hydro/v0.13.1/manifest.json', 'immutable_url': 'https://github.com/kimjeon-il/Pando/blob/fd6744f5e72a0c1a107452dbde6d416ab57237db/assets/data/hydro/v0.13.1/manifest.json'}, {'purpose': 'Already published initial inventory containing the selected rows', 'repository_path': 'reports/hydro-names/current-web-2026-10-08/inventory.csv.gz', 'immutable_url': 'https://github.com/kimjeon-il/Pando/blob/8213678cbfd74ecd930657eaa911f6e87ab6d2b8/reports/hydro-names/current-web-2026-10-08/inventory.csv.gz'}]}
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
    assert ref['schema']=='hydro-lake-geometry-reference-public-v4' and ref['batch']=='r15','reference schema'
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
    assert s.receipt(root/'geometry-duplicate-check.json')['sha256']==PINS['duplicate_sha256'],'prior42 duplicate pin'
    assert 'previous_index_receipt' not in duplicate,'included duplicate scope'
    prior=duplicate['previous_aw_ids_in_index_order'];assert duplicate['previous_target_count']==len(prior)==len(set(prior))==42
    assert duplicate['selected_aw_ids']==awids and duplicate['selected_unique_count']==len(set(awids))==3
    assert duplicate['intersection_aw_ids']==sorted(set(prior)&set(awids))==[] and duplicate['historical_names_used_as_identity_evidence'] is False
    assert duplicate['preserved_pending_access_ids']==['lakes_base:1159112821', 'lakes_base:1159108815'] and duplicate['pending_access_reassessment_performed'] is False,'preserved pending-access separation'
    assert duplicate['preserved_scope_hold_ids']==['lakes_base:1159109497', 'lakes_base:1159123531', 'lakes_base:1159123567', 'lakes_base:1159110371', 'lakes_base:1159109471', 'lakes_base:1159111751', 'lakes_base:1159112207', 'lakes_base:1159110475', 'lakes_base:1159108993'] and duplicate['scope_hold_reassessment_performed'] is False,'preserved scope-hold separation'
    delta=duplicate['current_batch_delta']
    assert delta=={'selected_current_inventory_targets': 3, 'selected_current_target_types': {'lake': 3}, 'all_current_targets_initially_eligible': True, 'initial_eligible_target_count': 4065, 'reconstructed_target_count_before': 42, 'reconstructed_target_count_after': 45, 'remaining_fresh_reconstruction_queue_before': 4023, 'remaining_fresh_reconstruction_queue_after': 4020, 'remaining_queue_types_before': {'river_group': 3439, 'lake': 584}, 'remaining_queue_types_after': {'river_group': 3439, 'lake': 581}, 'historically_never_reviewed_count_claimed': False, 'prior_target_geometry_or_naming_revalidation_performed': False},'current-three queue delta'
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
        assert frozen['schema']=='frozen-selected-lake-geometry-component-public-v2' and frozen['batch']=='r15' and frozen['scope_aw_ids']==awids
        assert frozen['validation_scope']=='included-selected-evidence-only','component validation scope'
        assert frozen['complete_selected_lake_coordinates_in_public_package'] is True and frozen['binary_packs_or_worker_bodies_in_public_package'] is False and frozen['new_external_requests']==0,'component publication scope'
        assert set(frozen['files'])==set(ref['artifacts'])|{'geometry-README.md','geometry-reference.json','validate-geometry-reference.py','test-geometry-reference.py','geometry-validation.json'}
        for name,digest in frozen['files'].items():assert pathlib.Path(name).name==name and sha((root/name).read_bytes())==digest,'component frozen hash'
    print(json.dumps({'status':'passed','validation_scope':'included-selected-evidence-only','scope_aw_ids':awids,'source_coordinate_counts_including_closure':counts,'all_complete_included_source_and_baseline_coordinates_rechecked':True,'part_ring_vertex_order_and_hashes_rechecked':True,'included_source_feature_original_JSON_tokens_rechecked':True,'included_metadata_and_name_states_rechecked':True,'prior42_duplicate_count':0,'included_selected_inventory_facts_and_eligible_status_rechecked':True,'included_current_three_queue_delta_rechecked':True,'prior42_geometry_or_naming_revalidation_performed':False,'preserved_pending_access_ids':['lakes_base:1159112821', 'lakes_base:1159108815'],'pending_access_reassessment_performed':False,'preserved_scope_hold_ids':['lakes_base:1159109497', 'lakes_base:1159123531', 'lakes_base:1159123567', 'lakes_base:1159110371', 'lakes_base:1159109471', 'lakes_base:1159111751', 'lakes_base:1159112207', 'lakes_base:1159110475', 'lakes_base:1159108993'],'scope_hold_reassessment_performed':False,'historical_source_baseline_comparison_recorded':True,'omitted_source_body_checks_replayed':False,'production_decoder_replayed':False,'original_inventory_or_previous_index_revalidated':False,'frozen_component_hashes_rechecked':bool(a.check_component_manifest),'current_live_deployment_checked':False,'no_external_requests':True,'validation_limit':'Only included selected evidence is validated; omitted source bodies, decoder dependencies, original inventory and prior-index bytes are not reconstructed or checked.'}))
if __name__=='__main__':main()
