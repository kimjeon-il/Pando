#!/usr/bin/env python3
"""Offline validation of included selected-lake evidence only; no omitted-input replay."""
import argparse,hashlib,importlib.util,json,pathlib,sys
sys.dont_write_bytecode=True
PINS = {'scope_source_ids': ['1159110463', '1159107033', '1159110475'], 'scope_aw_ids': ['lakes_base:1159110463', 'lakes_base:1159107033', 'lakes_base:1159110475'], 'features': {'1159110463': {'source_feature': '9ca0682f735ef08d9097fe541fd705def9a5f264f20e4acca2d612d11813b75f', 'source_json': '8c71c1966436a0423eead7feb73566939328dd35398278e6cf39a53889aee5f8', 'baseline_feature': '63d1e7ffa561a406977657ec24a9ee8bc0f317a737d2ec77796f78ac2c8dbb3a', 'source_index': 296, 'fid': 15489, 'logical_fid': 4114, 'core_metadata': 'ec1945ce4112b892edaaae6d0e05bc9fbd8727ac1d67e351d7debb500f903a78', 'detail_metadata': 'f49d6fce27f34ef81445bd5913d4a218e24146d1be1ac52e49494e2d73b80796'}, '1159107033': {'source_feature': '6ab2453a0d33c8b9032b73fa265e8a38c2c4deb3893fd9f8b4c1556ba2405746', 'source_json': 'c655825e210cbc3f6bc5089fb362ec8b3ea78430aaa3119fd989536c5110128d', 'baseline_feature': '0ef3926c1193b5bb6520d2684fbd15bf920baf67aec3eb86a14d1834d95af46b', 'source_index': 40, 'fid': 15233, 'logical_fid': 3858, 'core_metadata': '17d69108c24417e6d3fc5c73e3a310d4600dd82b32d3a8482ef261338262a4d1', 'detail_metadata': '58471769608fc3e66c40a2813cc495299222d805df2fc572831648d7ad68ad57'}, '1159110475': {'source_feature': 'e177d5f468b5498f0793e81d97897b004a7917800a445ecb679ebb841df0237c', 'source_json': '6f31ad6b2e8fd3edcecd87b8029b6264d421b772c3b132808fbb368132060ffb', 'baseline_feature': '4960695063988d9cafd83c32ad19aa4e6467ded6060b7909d82dcc699a9bdfbc', 'source_index': 297, 'fid': 15490, 'logical_fid': 4115, 'core_metadata': '5261bbaba35a61554c5305aefb64922039f8761e265ecb5b55229a37c1c99197', 'detail_metadata': '8cb938f500e33b26ba44be216efc800dd3e1760d3dab6909f18a09a337d3e967'}}, 'inventory': {'lakes_base:1159110463': '25e8ecfe409d8ef40834788721aca760f2de52cb0b4ee6c0e4371432909a25cd', 'lakes_base:1159107033': 'e6042849ff0400e15c847e6da4f9614bffda62e2bbe716b3e7e87b8e9247fe77', 'lakes_base:1159110475': '86f72c2ee61e428665a3465fc140c8d07b838e12c0a7f726d72d8ba2dea0b06f'}, 'support_sha256': 'dd6a583181c1527cdd0646f3ce6aee207570042c14e3fa4ebc3d35a36e752d33', 'rights_sha256': '539e73f8d4bb90b53412e3d31777190a3659b9527870e35a0229ca9663c8070b', 'duplicate_sha256': '655bc77caba1db9fb9535afe97d980eae96eb78ca70780608ead7ff11b7ca9a3', 'artifact_names': ['geometry-support.py', 'selected-lake-geometries.geojson', 'selected-baseline-rendered-geometries.geojson', 'selected-inventory-records.json', 'geometry-duplicate-check.json', 'geometry-publication-rights.json'], 'public_source_references': [{'purpose': 'Original public lake source at the baseline commit', 'repository_path': 'assets/data/hydro/lakes_base.geojson', 'immutable_url': 'https://github.com/kimjeon-il/Pando/blob/fd6744f5e72a0c1a107452dbde6d416ab57237db/assets/data/hydro/lakes_base.geojson'}, {'purpose': 'Public baseline release manifest', 'repository_path': 'assets/data/hydro/v0.13.1/manifest.json', 'immutable_url': 'https://github.com/kimjeon-il/Pando/blob/fd6744f5e72a0c1a107452dbde6d416ab57237db/assets/data/hydro/v0.13.1/manifest.json'}, {'purpose': 'Already published initial inventory containing the selected rows', 'repository_path': 'reports/hydro-names/current-web-2026-10-08/inventory.csv.gz', 'immutable_url': 'https://github.com/kimjeon-il/Pando/blob/8213678cbfd74ecd930657eaa911f6e87ab6d2b8/reports/hydro-names/current-web-2026-10-08/inventory.csv.gz'}]}
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
    assert ref['schema']=='hydro-lake-geometry-reference-public-v4' and ref['batch']=='r13','reference schema'
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
    assert s.receipt(root/'geometry-duplicate-check.json')['sha256']==PINS['duplicate_sha256'],'prior36 duplicate pin'
    assert 'previous_index_receipt' not in duplicate,'included duplicate scope'
    prior=duplicate['previous_aw_ids_in_index_order'];assert duplicate['previous_target_count']==len(prior)==len(set(prior))==36
    assert duplicate['selected_aw_ids']==awids and duplicate['selected_unique_count']==len(set(awids))==3
    assert duplicate['intersection_aw_ids']==sorted(set(prior)&set(awids))==[] and duplicate['historical_names_used_as_identity_evidence'] is False
    assert duplicate['preserved_pending_access_ids']==['lakes_base:1159112821'] and duplicate['pending_access_reassessment_performed'] is False,'preserved pending-access separation'
    assert duplicate['preserved_scope_hold_ids']==['lakes_base:1159109497', 'lakes_base:1159123531', 'lakes_base:1159123567', 'lakes_base:1159110371', 'lakes_base:1159109471', 'lakes_base:1159111751', 'lakes_base:1159112207'] and duplicate['scope_hold_reassessment_performed'] is False,'preserved scope-hold separation'
    delta=duplicate['current_batch_delta']
    assert delta=={'selected_current_inventory_targets': 3, 'selected_current_target_types': {'lake': 3}, 'all_current_targets_initially_eligible': True, 'initial_eligible_target_count': 4065, 'reconstructed_target_count_before': 36, 'reconstructed_target_count_after': 39, 'remaining_fresh_reconstruction_queue_before': 4029, 'remaining_fresh_reconstruction_queue_after': 4026, 'remaining_queue_types_before': {'river_group': 3439, 'lake': 590}, 'remaining_queue_types_after': {'river_group': 3439, 'lake': 587}, 'historically_never_reviewed_count_claimed': False, 'prior_target_geometry_or_naming_revalidation_performed': False},'current-three queue delta'
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
        assert frozen['schema']=='frozen-selected-lake-geometry-component-public-v2' and frozen['batch']=='r13' and frozen['scope_aw_ids']==awids
        assert frozen['validation_scope']=='included-selected-evidence-only','component validation scope'
        assert frozen['complete_selected_lake_coordinates_in_public_package'] is True and frozen['binary_packs_or_worker_bodies_in_public_package'] is False and frozen['new_external_requests']==0,'component publication scope'
        assert set(frozen['files'])==set(ref['artifacts'])|{'geometry-README.md','geometry-reference.json','validate-geometry-reference.py','test-geometry-reference.py','geometry-validation.json'}
        for name,digest in frozen['files'].items():assert pathlib.Path(name).name==name and sha((root/name).read_bytes())==digest,'component frozen hash'
    print(json.dumps({'status':'passed','validation_scope':'included-selected-evidence-only','scope_aw_ids':awids,'source_coordinate_counts_including_closure':counts,'all_complete_included_source_and_baseline_coordinates_rechecked':True,'part_ring_vertex_order_and_hashes_rechecked':True,'included_source_feature_original_JSON_tokens_rechecked':True,'included_metadata_and_name_states_rechecked':True,'prior36_duplicate_count':0,'included_selected_inventory_facts_and_eligible_status_rechecked':True,'included_current_three_queue_delta_rechecked':True,'prior36_geometry_or_naming_revalidation_performed':False,'preserved_pending_access_ids':['lakes_base:1159112821'],'pending_access_reassessment_performed':False,'preserved_scope_hold_ids':['lakes_base:1159109497', 'lakes_base:1159123531', 'lakes_base:1159123567', 'lakes_base:1159110371', 'lakes_base:1159109471', 'lakes_base:1159111751', 'lakes_base:1159112207'],'scope_hold_reassessment_performed':False,'historical_source_baseline_comparison_recorded':True,'omitted_source_body_checks_replayed':False,'production_decoder_replayed':False,'original_inventory_or_previous_index_revalidated':False,'frozen_component_hashes_rechecked':bool(a.check_component_manifest),'current_live_deployment_checked':False,'no_external_requests':True,'validation_limit':'Only included selected evidence is validated; omitted source bodies, decoder dependencies, original inventory and prior-index bytes are not reconstructed or checked.'}))
if __name__=='__main__':main()
