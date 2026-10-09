#!/usr/bin/env python3
"""Offline validation of included selected-lake evidence only; no omitted-input replay."""
import argparse,hashlib,importlib.util,json,pathlib,sys
sys.dont_write_bytecode=True
PINS = {'scope_source_ids': ['1159108453', '1159108469', '1159109723'], 'scope_aw_ids': ['lakes_base:1159108453', 'lakes_base:1159108469', 'lakes_base:1159109723'], 'features': {'1159108453': {'source_feature': '2ae01a35872173dfe060c330a0dec6252cb733acf4b30ba6a48a666ec49120b0', 'source_json': '73e97fc47746f66e4515087ae6a812ec8e3902c91278746ff1bfa6e4813cd465', 'baseline_feature': '8311fa2385c39dbb416fac33ebb49ed10dc7623f7943359a307b4130d270955f', 'source_index': 146, 'fid': 15339, 'logical_fid': 3964, 'core_metadata': '05b617cccd6aeb59cc65f2623921ca8839efa79cbaa1a9cb8004a613a8da78b0', 'detail_metadata': '8a3ac8ffdd3b1668e8998352587f8876bbcfecfe23e9d0262e655c667df22ee8'}, '1159108469': {'source_feature': '8dc9b7c896a3f6cecf73e4e1a975f6df66f693d02d0374b358fff2a4b470dd47', 'source_json': 'd500be20579fcc169a19f19348bb9feb1bade440a182259f45fcaeaf8beedc15', 'baseline_feature': '695f38e29d7db0e2fea46bfbd518fd8adf90001c1a6858ca8edcdd262360141d', 'source_index': 147, 'fid': 15340, 'logical_fid': 3965, 'core_metadata': '7f22f8994f705d715811870a21db522eec014e347e0341fc404a1d04f30f8d27', 'detail_metadata': '8d34691e6fde6c9a6643a167085ffb87109222eda02d52d2c6a495e73ec354a1'}, '1159109723': {'source_feature': 'e7a449a3e59d466f9bf5099549cacce7ac9371f7efa3f0b7ff9a2dc048a42751', 'source_json': '552a21ae6041135ac79f4a55016d224acb8b26ecf9c25e1423b42146b5448bae', 'baseline_feature': 'bdbb080de0381f0aff3c24baca4b272ebead04b377a815a65ad65346c5f847b9', 'source_index': 245, 'fid': 15438, 'logical_fid': 4063, 'core_metadata': 'd573e77965ecd416a7d75f18b24448d45a9e1fa9d962d08e281ba0ddda5a88fa', 'detail_metadata': '04dfe63bf7a47698895b6ebbb5bf429aae844082ff498d4be1cf8c634b81a930'}}, 'inventory': {'lakes_base:1159108453': '30c7a77f08f9bd11f3701966b27ed712bb9b091dafac729dd8483648ac655a62', 'lakes_base:1159108469': '9b98718c46788c1a9d11a28c9441d5f45a0a35067b58fb9458aad33e00fbd34f', 'lakes_base:1159109723': '70db6e517df406b0d1874684cd8993d0a9eb75a60fb74b6c93868a6647385b18'}, 'support_sha256': 'dd6a583181c1527cdd0646f3ce6aee207570042c14e3fa4ebc3d35a36e752d33', 'rights_sha256': '95acd1f37b2c96566df7210294783a1ec8713babe3bf7e9af366de635085dbeb', 'duplicate_sha256': '597c2847a629a290c87916e95f649766e32ee3300521f25605de7de08ab0ea3f', 'artifact_names': ['geometry-support.py', 'selected-lake-geometries.geojson', 'selected-baseline-rendered-geometries.geojson', 'selected-inventory-records.json', 'geometry-duplicate-check.json', 'geometry-publication-rights.json'], 'public_source_references': [{'purpose': 'Original public lake source at the baseline commit', 'repository_path': 'assets/data/hydro/lakes_base.geojson', 'immutable_url': 'https://github.com/kimjeon-il/Pando/blob/fd6744f5e72a0c1a107452dbde6d416ab57237db/assets/data/hydro/lakes_base.geojson'}, {'purpose': 'Public baseline release manifest', 'repository_path': 'assets/data/hydro/v0.13.1/manifest.json', 'immutable_url': 'https://github.com/kimjeon-il/Pando/blob/fd6744f5e72a0c1a107452dbde6d416ab57237db/assets/data/hydro/v0.13.1/manifest.json'}, {'purpose': 'Already published initial inventory containing the selected rows', 'repository_path': 'reports/hydro-names/current-web-2026-10-08/inventory.csv.gz', 'immutable_url': 'https://github.com/kimjeon-il/Pando/blob/8213678cbfd74ecd930657eaa911f6e87ab6d2b8/reports/hydro-names/current-web-2026-10-08/inventory.csv.gz'}]}
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
    assert ref['schema']=='hydro-lake-geometry-reference-public-v4' and ref['batch']=='r16','reference schema'
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
    assert s.receipt(root/'geometry-duplicate-check.json')['sha256']==PINS['duplicate_sha256'],'prior45 duplicate pin'
    assert 'previous_index_receipt' not in duplicate,'included duplicate scope'
    prior=duplicate['previous_aw_ids_in_index_order'];assert duplicate['previous_target_count']==len(prior)==len(set(prior))==45
    assert duplicate['selected_aw_ids']==awids and duplicate['selected_unique_count']==len(set(awids))==3
    assert duplicate['intersection_aw_ids']==sorted(set(prior)&set(awids))==[] and duplicate['historical_names_used_as_identity_evidence'] is False
    assert duplicate['preserved_pending_access_ids']==['lakes_base:1159112821', 'lakes_base:1159108815'] and duplicate['pending_access_reassessment_performed'] is False,'preserved pending-access separation'
    assert duplicate['preserved_scope_hold_ids']==['lakes_base:1159109497', 'lakes_base:1159123531', 'lakes_base:1159123567', 'lakes_base:1159110371', 'lakes_base:1159109471', 'lakes_base:1159111751', 'lakes_base:1159112207', 'lakes_base:1159110475', 'lakes_base:1159108993', 'lakes_base:1159109803'] and duplicate['scope_hold_reassessment_performed'] is False,'preserved scope-hold separation'
    delta=duplicate['current_batch_delta']
    assert delta=={'selected_current_inventory_targets': 3, 'selected_current_target_types': {'lake': 3}, 'all_current_targets_initially_eligible': True, 'initial_eligible_target_count': 4065, 'reconstructed_target_count_before': 45, 'reconstructed_target_count_after': 48, 'remaining_fresh_reconstruction_queue_before': 4020, 'remaining_fresh_reconstruction_queue_after': 4017, 'remaining_queue_types_before': {'river_group': 3439, 'lake': 581}, 'remaining_queue_types_after': {'river_group': 3439, 'lake': 578}, 'historically_never_reviewed_count_claimed': False, 'prior_target_geometry_or_naming_revalidation_performed': False},'current-three queue delta'
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
        assert frozen['schema']=='frozen-selected-lake-geometry-component-public-v2' and frozen['batch']=='r16' and frozen['scope_aw_ids']==awids
        assert frozen['validation_scope']=='included-selected-evidence-only','component validation scope'
        assert frozen['complete_selected_lake_coordinates_in_public_package'] is True and frozen['binary_packs_or_worker_bodies_in_public_package'] is False and frozen['new_external_requests']==0,'component publication scope'
        assert set(frozen['files'])==set(ref['artifacts'])|{'geometry-README.md','geometry-reference.json','validate-geometry-reference.py','test-geometry-reference.py','geometry-validation.json'}
        for name,digest in frozen['files'].items():assert pathlib.Path(name).name==name and sha((root/name).read_bytes())==digest,'component frozen hash'
    print(json.dumps({'status':'passed','validation_scope':'included-selected-evidence-only','scope_aw_ids':awids,'source_coordinate_counts_including_closure':counts,'all_complete_included_source_and_baseline_coordinates_rechecked':True,'part_ring_vertex_order_and_hashes_rechecked':True,'included_source_feature_original_JSON_tokens_rechecked':True,'included_metadata_and_name_states_rechecked':True,'prior45_duplicate_count':0,'included_selected_inventory_facts_and_eligible_status_rechecked':True,'included_current_three_queue_delta_rechecked':True,'prior45_geometry_or_naming_revalidation_performed':False,'preserved_pending_access_ids':['lakes_base:1159112821', 'lakes_base:1159108815'],'pending_access_reassessment_performed':False,'preserved_scope_hold_ids':['lakes_base:1159109497', 'lakes_base:1159123531', 'lakes_base:1159123567', 'lakes_base:1159110371', 'lakes_base:1159109471', 'lakes_base:1159111751', 'lakes_base:1159112207', 'lakes_base:1159110475', 'lakes_base:1159108993', 'lakes_base:1159109803'],'scope_hold_reassessment_performed':False,'historical_source_baseline_comparison_recorded':True,'omitted_source_body_checks_replayed':False,'production_decoder_replayed':False,'original_inventory_or_previous_index_revalidated':False,'frozen_component_hashes_rechecked':bool(a.check_component_manifest),'current_live_deployment_checked':False,'no_external_requests':True,'validation_limit':'Only included selected evidence is validated; omitted source bodies, decoder dependencies, original inventory and prior-index bytes are not reconstructed or checked.'}))
if __name__=='__main__':main()
