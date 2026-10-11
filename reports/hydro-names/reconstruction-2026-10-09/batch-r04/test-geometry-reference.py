#!/usr/bin/env python3
"""Bounded positive and corruption checks; no network or original-cache mutation."""
import argparse,hashlib,json,pathlib,shutil,subprocess,sys,tempfile

def receipt(p):
    b=p.read_bytes();return {'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}

def write(p,v):p.write_text(json.dumps(v,ensure_ascii=False,separators=(',',':'))+'\n')

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--directory',type=pathlib.Path,default=pathlib.Path(__file__).resolve().parent);p.add_argument('--input-cache',type=pathlib.Path);p.add_argument('--historical-input-root',type=pathlib.Path);a=p.parse_args();root=a.directory.resolve();command=[sys.executable,str(root/'validate-geometry-reference.py')];runs=[]
    def positive(extra):
        r=subprocess.run(command+['--directory',str(root)]+extra,capture_output=True,text=True);assert r.returncode==0,r.stderr;runs.append(json.loads(r.stdout))
    positive([])
    if a.input_cache:
        extra=['--input-cache',str(a.input_cache.resolve())]
        if a.historical_input_root:extra+=['--historical-input-root',str(a.historical_input_root.resolve())]
        positive(extra)
    original=json.loads((root/'geometry-reference.json').read_text());cases=[]
    for case in ['included_lake_vertex_changed','river_role_changed','river_source_reach_order_changed','pack_offset_changed','false_current_deployment_claim']:
        with tempfile.TemporaryDirectory() as d:
            target=pathlib.Path(d)
            for name in original['artifacts']:shutil.copyfile(root/name,target/name)
            ref=json.loads((root/'geometry-reference.json').read_text());name=None
            if case=='included_lake_vertex_changed':
                name='selected-lake-geometries.geojson';v=json.loads((target/name).read_text());g=v['features'][0]['geometry'];ring=g['coordinates'][0] if g['type']=='Polygon' else g['coordinates'][0][0];ring[2][0]+=.001;write(target/name,v)
            elif case=='river_role_changed':
                name='selected-river-metadata.json';v=json.loads((target/name).read_text());v['fragments'][0]['role']='tributary';v['fragments'][0]['baseline_metadata_exact']['role']='tributary';write(target/name,v)
            elif case=='river_source_reach_order_changed':
                name='source-reach-manifest.json';v=json.loads((target/name).read_text());ids=v['groups'][0]['fragments'][0]['source_ids_ordered'];ids[0],ids[1]=ids[1],ids[0];write(target/name,v)
            elif case=='pack_offset_changed':
                name='selected-pack-receipts.json';v=json.loads((target/name).read_text());v[0]['offset']+=1;write(target/name,v)
            else:ref['baseline']['current_live_deployment_checked']=True
            if name:ref['artifacts'][name]=receipt(target/name)
            write(target/'geometry-reference.json',ref);r=subprocess.run(command+['--directory',str(target)],capture_output=True,text=True);assert r.returncode!=0 and 'AssertionError' in r.stderr,'Unexpected fixture result: '+case
            cases.append({'case':case,'rejected':True,'artifact_receipt_updated':bool(name)})
    if a.input_cache:
        with tempfile.TemporaryDirectory() as d:
            cache=pathlib.Path(d)
            for p in a.input_cache.resolve().iterdir():
                if p.name!='worker.js':(cache/p.name).symlink_to(p)
            (cache/'worker.js').write_bytes((a.input_cache/'worker.js').read_bytes()+b'\n')
            r=subprocess.run(['node',str(root/'extract-baseline-geometries.mjs'),str(cache),str(cache/'out.geojson')],capture_output=True,text=True);assert r.returncode!=0 and 'Verification failed: worker.js' in r.stderr and not (cache/'out.geojson').exists()
            cases.append({'case':'changed_decoder_rejected_before_execution','rejected':True})
    print(json.dumps({'status':'passed','validation_runs':runs,'corrupt_fixtures':cases,'corrupt_fixture_count':len(cases),'no_external_requests':True},indent=2))
if __name__=='__main__':main()
