#!/usr/bin/env python3
"""Exercise durable validation, optional full-input replay, and corrupt fixtures."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False).encode()


def write_json(path, value):
    path.write_text(json.dumps(value,ensure_ascii=False,separators=(',',':'))+'\n')


def receipt(data):
    return {'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'git_blob_sha':hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',type=Path,default=Path(__file__).resolve().parent)
    parser.add_argument('--input-cache',type=Path)
    parser.add_argument('--historical-input-root',type=Path)
    args=parser.parse_args(); root=args.directory.resolve()
    command=[sys.executable,str(root/'validate-geometry-reference.py')]
    runs=[]
    def positive(extra):
        result=subprocess.run(command+['--directory',str(root)]+extra,capture_output=True,text=True)
        assert result.returncode==0,result.stderr
        runs.append(json.loads(result.stdout))
    positive([])
    if args.input_cache:
        extra=['--input-cache',str(args.input_cache.resolve())]
        if args.historical_input_root: extra+=['--historical-input-root',str(args.historical_input_root.resolve())]
        positive(extra)
    names=['selected-lake-geometries.geojson','selected-baseline-rendered-geometries.geojson','selected-pack-receipts.json','geometry-reference.json','geometry-publication-rights.json','geometry-request-receipts.json','extract-baseline-geometries.mjs']
    cases=[]
    for case in ['source_coordinate_byte_change','rendered_source_id_change','reference_logical_fid_change','pack_offset_changed_with_updated_file_receipt','open_source_ring_with_updated_hashes','false_current_deployment_claim']:
        with tempfile.TemporaryDirectory() as temporary:
            target=Path(temporary)
            for name in names: shutil.copyfile(root/name,target/name)
            ref=json.loads((target/'geometry-reference.json').read_text())
            if case=='source_coordinate_byte_change':
                name='selected-lake-geometries.geojson'; data=json.loads((target/name).read_text());data['features'][0]['geometry']['coordinates'][0][2][0]+=0.01;write_json(target/name,data)
            elif case=='rendered_source_id_change':
                name='selected-baseline-rendered-geometries.geojson'; data=json.loads((target/name).read_text());data['features'][0]['properties']['sourceId']='1159107099';write_json(target/name,data)
            elif case=='reference_logical_fid_change':
                ref['selected_features'][0]['baseline_logical_fid']+=1
            elif case=='pack_offset_changed_with_updated_file_receipt':
                name='selected-pack-receipts.json';data=json.loads((target/name).read_text());data[0]['offset']+=1;write_json(target/name,data);ref['artifacts'][name]=receipt((target/name).read_bytes())
            elif case=='open_source_ring_with_updated_hashes':
                name='selected-lake-geometries.geojson';data=json.loads((target/name).read_text());feature=data['features'][0];feature['geometry']['coordinates'][0][-1][0]+=0.0001;write_json(target/name,data)
                ref['artifacts'][name]=receipt((target/name).read_bytes());record=ref['selected_features'][0]
                record['source_feature_canonical_sha256']=hashlib.sha256(canonical(feature)).hexdigest()
                feature_text=json.dumps(feature,ensure_ascii=False,separators=(',',':')).encode();record['source_feature_original_json_bytes']=len(feature_text);record['source_feature_original_json_sha256']=hashlib.sha256(feature_text).hexdigest()
                record['source_geometry']['canonical_geometry_sha256']=hashlib.sha256(canonical(feature['geometry'])).hexdigest()
            else:
                ref['baseline']['current_live_deployment_checked']=True
            write_json(target/'geometry-reference.json',ref)
            result=subprocess.run(command+['--directory',str(target)],capture_output=True,text=True)
            assert result.returncode!=0,'Corrupt fixture was accepted: '+case
            assert 'AssertionError' in result.stderr,'Fixture failed for an unexpected reason: '+case
            cases.append({'case':case,'rejected':True,'exit_code':result.returncode})
    if args.input_cache:
        with tempfile.TemporaryDirectory() as temporary:
            target=Path(temporary); cache=args.input_cache.resolve()
            for path in cache.iterdir():
                if path.name!='worker.js': (target/path.name).symlink_to(path)
            (target/'worker.js').write_bytes((cache/'worker.js').read_bytes()+b'\n')
            result=subprocess.run(command+['--directory',str(root),'--input-cache',str(target)],capture_output=True,text=True)
            assert result.returncode!=0 and 'worker.js' in result.stderr
            cases.append({'case':'cached_decoder_byte_change','rejected':True,'exit_code':result.returncode})
            result=subprocess.run(['node',str(root/'extract-baseline-geometries.mjs'),str(target),str(target/'output.geojson')],capture_output=True,text=True)
            assert result.returncode!=0 and 'Verification failed: worker.js' in result.stderr
            assert not (target/'output.geojson').exists()
            cases.append({'case':'extractor_rejects_modified_decoder_before_execution','rejected':True,'exit_code':result.returncode})
    print(json.dumps({'status':'passed','validation_runs':runs,'corrupt_fixtures':cases,'corrupt_fixture_count':len(cases),'no_external_requests':True},indent=2))

if __name__=='__main__':
    main()
