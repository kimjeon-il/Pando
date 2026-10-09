#!/usr/bin/env python3
"""Offline positive and bounded corruption checks for included selected evidence only."""
import argparse,copy,hashlib,json,pathlib,shutil,subprocess,sys,tempfile
sys.dont_write_bytecode=True

def canon(v):return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def receipt(p):b=p.read_bytes();return {'bytes':len(b),'sha256':sha(b)}
def write(p,v):p.write_text(json.dumps(v,ensure_ascii=False,separators=(',',':'))+'\n')
def ring(g):return g['coordinates'][0] if g['type']=='Polygon' else g['coordinates'][0][0]

def main():
    if not __debug__:raise RuntimeError('Python -O disables required assertions and is unsupported.')
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parent);a=p.parse_args();root=a.directory.resolve();command=[sys.executable,'-B',str(root/'validate-geometry-reference.py')];runs=[]
    def positive(extra):
        run=subprocess.run(command+['--directory',str(root)]+extra,capture_output=True,text=True);assert run.returncode==0,run.stderr;runs.append(json.loads(run.stdout))
    positive([])
    original=json.loads((root/'geometry-reference.json').read_text());cases=[]
    inputs_before={name:receipt(root/name) for name in list(original['artifacts'])+['geometry-reference.json']}
    checks=[
        ('source_vertex_changed','source feature pin'),
        ('source_ring_closure_broken','source feature pin'),
        ('source_feature_id_changed','source feature pin'),
        ('source_feature_order_reversed','selected source order'),
        ('baseline_source_id_changed','selected baseline source IDs and order'),
        ('baseline_fragment_count_changed','baseline feature pin'),
        ('baseline_fragment_omitted','complete selected baseline count'),
        ('baseline_fragment_duplicated','complete selected baseline count'),
        ('inventory_category_changed','selected inventory pin'),
        ('current_batch_delta_changed','prior39 duplicate pin'),
        ('pending_access_ID_changed','prior39 duplicate pin'),
        ('scope_hold_ID_changed','prior39 duplicate pin'),
        ('source_vertex_order_reversed','source feature pin'),
        ('source_JSON_tokens_rewritten','source JSON token pin'),
        ('baseline_logical_fid_changed','baseline feature pin'),
        ('baseline_name_changed','baseline feature pin'),
        ('baseline_core_metadata_name_changed','exact core metadata pin'),
        ('baseline_detail_metadata_name_inserted','exact detail metadata pin'),
        ('actual_name_state_misreported','actual name state'),
        ('ordered_ring_hash_changed','geometry structure and ordered ring hashes'),
        ('source_original_index_changed','source index pin'),
        ('inventory_logical_fid_changed','selected inventory pin'),
        ('prior39_duplicate_list_changed','prior39 duplicate pin'),
        ('false_current_deployment_claim','current deployment limit'),
        ('omitted_dependency_scope_reintroduced','included evidence scope'),
        ('rights_fact_changed','rights pin'),
        ('public_source_URL_changed','public source provenance'),
    ]
    for case,expected in checks:
        with tempfile.TemporaryDirectory() as d:
            target=pathlib.Path(d)
            for name in original['artifacts']:shutil.copyfile(root/name,target/name)
            ref=copy.deepcopy(original);name=None
            if case.startswith('source_vertex') or case in ['source_JSON_tokens_rewritten','source_ring_closure_broken','source_feature_id_changed','source_feature_order_reversed']:
                name='selected-lake-geometries.geojson';v=json.loads((target/name).read_text())
                if case=='source_vertex_changed':ring(v['features'][0]['geometry'])[2][0]+=.001
                elif case=='source_vertex_order_reversed':ring(v['features'][0]['geometry']).reverse()
                elif case=='source_ring_closure_broken':ring(v['features'][0]['geometry'])[-1][0]+=.001
                elif case=='source_feature_id_changed':v['features'][0]['id']='lakes_base:0'
                elif case=='source_feature_order_reversed':v['features'].reverse()
                write(target/name,v)
                if case=='source_JSON_tokens_rewritten':(target/name).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
                # Rebase the editable reference field, proving the separate pin is effective.
                ref['selected_features'][0]['source_feature_canonical_sha256']=sha(canon(v['features'][0]))
            elif case in ['baseline_logical_fid_changed','baseline_name_changed','baseline_source_id_changed','baseline_fragment_count_changed','baseline_fragment_omitted','baseline_fragment_duplicated']:
                name='selected-baseline-rendered-geometries.geojson';v=json.loads((target/name).read_text());m=v['features'][0]['properties']
                if case=='baseline_logical_fid_changed':m['logicalFid']+=1
                elif case=='baseline_source_id_changed':m['sourceId']='0'
                elif case=='baseline_fragment_count_changed':m['fragmentCount']+=1
                elif case=='baseline_fragment_omitted':v['features'].pop()
                elif case=='baseline_fragment_duplicated':v['features'].append(copy.deepcopy(v['features'][0]))
                else:m['name']='fabricated name'
                write(target/name,v);ref['selected_features'][0]['baseline_metadata_exact']=m;ref['selected_features'][0]['baseline_feature_canonical_sha256']=sha(canon(v['features'][0]))
            elif case=='baseline_core_metadata_name_changed':ref['selected_features'][0]['baseline_core_metadata_exact']['name']='fabricated name'
            elif case=='baseline_detail_metadata_name_inserted':ref['selected_features'][0]['baseline_detail_metadata_exact']['name']='fabricated name'
            elif case=='actual_name_state_misreported':ref['selected_features'][0]['source_name_fields_exact']['name_en']='fabricated name'
            elif case=='ordered_ring_hash_changed':ref['selected_features'][0]['source_geometry']['ordered_parts'][0]['ordered_rings'][0]['ordered_coordinate_sha256']='0'*64
            elif case=='source_original_index_changed':ref['selected_features'][0]['source_feature_zero_based_index']+=1
            elif case in ['inventory_logical_fid_changed','inventory_category_changed']:
                name='selected-inventory-records.json';v=json.loads((target/name).read_text());v['records'][0]['logical_fid']+=1 if case=='inventory_logical_fid_changed' else 0
                if case=='inventory_category_changed':v['records'][0]['category']='river'
                write(target/name,v)
            elif case in ['pending_access_ID_changed','scope_hold_ID_changed']:
                name='geometry-duplicate-check.json';v=json.loads((target/name).read_text());key='preserved_pending_access_ids' if case=='pending_access_ID_changed' else 'preserved_scope_hold_ids';v[key][0]=v['selected_aw_ids'][0];write(target/name,v)
            elif case=='current_batch_delta_changed':
                name='geometry-duplicate-check.json';v=json.loads((target/name).read_text());v['current_batch_delta']['remaining_fresh_reconstruction_queue_after']+=1;write(target/name,v)
            elif case=='prior39_duplicate_list_changed':
                name='geometry-duplicate-check.json';v=json.loads((target/name).read_text());v['previous_aw_ids_in_index_order'][0]=v['selected_aw_ids'][0];write(target/name,v)
            elif case=='false_current_deployment_claim':ref['baseline']['current_live_deployment_checked']=True
            elif case=='public_source_URL_changed':ref['public_source_references'][0]['immutable_url']=ref['public_source_references'][1]['immutable_url']
            elif case=='omitted_dependency_scope_reintroduced':ref['source_assets']={}
            elif case=='rights_fact_changed':
                name='geometry-publication-rights.json';v=json.loads((target/name).read_text());v['public_domain_fact']='Changed terms';write(target/name,v)
            if name:ref['artifacts'][name]=receipt(target/name)
            write(target/'geometry-reference.json',ref)
            run=subprocess.run(command+['--directory',str(target)],capture_output=True,text=True)
            assert run.returncode!=0 and 'AssertionError: '+expected in run.stderr,'Unexpected corruption-fixture result: '+case+'\n'+run.stderr
            cases.append({'case':case,'rejected':True,'expected_semantic_check':expected,'artifact_receipt_updated':bool(name),'separate_reference_field_rebased':case in ['source_vertex_changed','source_vertex_order_reversed','source_JSON_tokens_rewritten','baseline_logical_fid_changed','baseline_name_changed']})
    assert inputs_before=={name:receipt(root/name) for name in inputs_before},'Included input changed'
    for script in ['validate-geometry-reference.py','test-geometry-reference.py']:
        run=subprocess.run([sys.executable,'-B',str(root/script),'--help'],capture_output=True,text=True)
        assert run.returncode==0 and not any(option in run.stdout for option in ['--input-cache','--historical-input-root','--previous-index']),'omitted-input replay interface exposed'
    print(json.dumps({'status':'passed','validation_scope':'included-selected-evidence-only','validation_runs':runs,'corrupt_fixtures':cases,'corrupt_fixture_count':len(cases),'durable_corrupt_fixture_count':len(checks),'included_input_files_unchanged':True,'omitted_input_replay_interfaces_absent':True,'no_external_requests':True},indent=2))
if __name__=='__main__':main()
