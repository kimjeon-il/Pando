#!/usr/bin/env python3
"""Offline positive and bounded corruption checks; original inputs remain unchanged."""
import argparse,copy,hashlib,json,pathlib,shutil,subprocess,sys,tempfile
sys.dont_write_bytecode=True

def canon(v):return json.dumps(v,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def receipt(p):b=p.read_bytes();return {'bytes':len(b),'sha256':sha(b)}
def write(p,v):p.write_text(json.dumps(v,ensure_ascii=False,separators=(',',':'))+'\n')
def ring(g):return g['coordinates'][0] if g['type']=='Polygon' else g['coordinates'][0][0]

def main():
    if not __debug__:raise RuntimeError('Python -O disables required assertions and is unsupported.')
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parent);p.add_argument('--input-cache',type=pathlib.Path);p.add_argument('--historical-input-root',type=pathlib.Path);p.add_argument('--previous-index',type=pathlib.Path);a=p.parse_args();root=a.directory.resolve();command=[sys.executable,'-B',str(root/'validate-geometry-reference.py')];runs=[]
    def positive(extra):
        run=subprocess.run(command+['--directory',str(root)]+extra,capture_output=True,text=True);assert run.returncode==0,run.stderr;runs.append(json.loads(run.stdout))
    positive([])
    extra=[]
    for option in ['input_cache','historical_input_root','previous_index']:
        if getattr(a,option):extra+=['--'+option.replace('_','-'),str(getattr(a,option).resolve())]
    if extra:positive(extra)
    original=json.loads((root/'geometry-reference.json').read_text());cases=[]
    originals_before={n:receipt(a.input_cache/n) for n in original['source_assets']} if a.input_cache else {}
    checks=[
        ('source_vertex_changed','source feature pin'),
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
        ('prior15_duplicate_list_changed','prior15 duplicate pin'),
        ('pack_offset_changed','pack pins'),
        ('false_current_deployment_claim','current deployment limit'),
        ('source_asset_URL_changed','source asset provenance pins'),
    ]
    for case,expected in checks:
        with tempfile.TemporaryDirectory() as d:
            target=pathlib.Path(d)
            for name in original['artifacts']:shutil.copyfile(root/name,target/name)
            ref=copy.deepcopy(original);name=None
            if case.startswith('source_vertex') or case=='source_JSON_tokens_rewritten':
                name='selected-lake-geometries.geojson';v=json.loads((target/name).read_text())
                if case=='source_vertex_changed':ring(v['features'][0]['geometry'])[2][0]+=.001
                elif case=='source_vertex_order_reversed':ring(v['features'][0]['geometry']).reverse()
                write(target/name,v)
                if case=='source_JSON_tokens_rewritten':(target/name).write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
                # Rebase the editable reference field, proving the separate pin is effective.
                ref['selected_features'][0]['source_feature_canonical_sha256']=sha(canon(v['features'][0]))
            elif case in ['baseline_logical_fid_changed','baseline_name_changed']:
                name='selected-baseline-rendered-geometries.geojson';v=json.loads((target/name).read_text());m=v['features'][0]['properties']
                if case=='baseline_logical_fid_changed':m['logicalFid']+=1
                else:m['name']='fabricated name'
                write(target/name,v);ref['selected_features'][0]['baseline_metadata_exact']=m;ref['selected_features'][0]['baseline_feature_canonical_sha256']=sha(canon(v['features'][0]))
            elif case=='baseline_core_metadata_name_changed':ref['selected_features'][0]['baseline_core_metadata_exact']['name']='fabricated name'
            elif case=='baseline_detail_metadata_name_inserted':ref['selected_features'][0]['baseline_detail_metadata_exact']['name']='fabricated name'
            elif case=='actual_name_state_misreported':ref['selected_features'][0]['source_name_fields_exact']['name_en']='fabricated name'
            elif case=='ordered_ring_hash_changed':ref['selected_features'][0]['source_geometry']['ordered_parts'][0]['ordered_rings'][0]['ordered_coordinate_sha256']='0'*64
            elif case=='source_original_index_changed':ref['selected_features'][0]['source_feature_zero_based_index']+=1
            elif case=='inventory_logical_fid_changed':
                name='selected-inventory-records.json';v=json.loads((target/name).read_text());v['records'][0]['logical_fid']+=1;write(target/name,v)
            elif case=='prior15_duplicate_list_changed':
                name='geometry-duplicate-check.json';v=json.loads((target/name).read_text());v['previous_aw_ids_in_index_order'][0]=v['selected_aw_ids'][0];write(target/name,v)
            elif case=='pack_offset_changed':
                name='selected-pack-receipts.json';v=json.loads((target/name).read_text());v[0]['offset']+=1;write(target/name,v);ref['selected_baseline_packs']=v
            elif case=='false_current_deployment_claim':ref['baseline']['current_live_deployment_checked']=True
            elif case=='source_asset_URL_changed':ref['source_assets']['lakes_base.geojson']['immutable_url']=ref['source_assets']['baseline-manifest.json']['immutable_url']
            if name:ref['artifacts'][name]=receipt(target/name)
            write(target/'geometry-reference.json',ref)
            run=subprocess.run(command+['--directory',str(target)],capture_output=True,text=True)
            assert run.returncode!=0 and 'AssertionError: '+expected in run.stderr,'Unexpected corruption-fixture result: '+case+'\n'+run.stderr
            cases.append({'case':case,'rejected':True,'expected_semantic_check':expected,'artifact_receipt_updated':bool(name),'separate_reference_field_rebased':case in ['source_vertex_changed','source_vertex_order_reversed','source_JSON_tokens_rewritten','baseline_logical_fid_changed','baseline_name_changed','pack_offset_changed']})
    if a.input_cache:
        with tempfile.TemporaryDirectory() as d:
            cache=pathlib.Path(d)
            for path in a.input_cache.resolve().iterdir():
                if path.name!='worker.js':(cache/path.name).symlink_to(path.resolve())
            (cache/'worker.js').write_bytes((a.input_cache/'worker.js').read_bytes()+b'\nthrow new Error("Altered worker must never execute");\n')
            out=cache/'out.geojson';run=subprocess.run(['node',str(root/'extract-baseline-geometries.mjs'),str(cache),str(out)],capture_output=True,text=True)
            assert run.returncode!=0 and 'Verification failed: worker.js' in run.stderr and 'Altered worker must never execute' not in run.stderr and not out.exists()
            cases.append({'case':'altered_production_worker_rejected_before_execution','rejected':True,'decoded_output_written':False})
    if a.input_cache:assert originals_before=={n:receipt(a.input_cache/n) for n in original['source_assets']},'Original input changed'
    print(json.dumps({'status':'passed','validation_runs':runs,'corrupt_fixtures':cases,'corrupt_fixture_count':len(cases),'durable_corrupt_fixture_count':len(checks),'original_inputs_unchanged':True,'no_external_requests':True},indent=2))
if __name__=='__main__':main()
