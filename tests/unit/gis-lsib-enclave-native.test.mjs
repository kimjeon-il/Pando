import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {prepareLSIBEnclave} from '../../tools/gis/lsib-screen-native.mjs';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const oracle=JSON.parse(await readFile(new URL('../fixtures/lsib-enclave-oracle.json',import.meta.url),'utf8'));
function equivalent(actual,expected){
  assert.deepEqual(actual.geometries,expected.geometries);assert.equal(actual.sections.length,expected.sections.length);
  for(let i=0;i<actual.sections.length;i++){
    const a=actual.sections[i],b=expected.sections[i];
    for(const key of ['countries','closedRing','enclave','master_vertices','derived_vertices'])assert.deepEqual(a[key],b[key],key);
    for(const key of ['old_length_degrees','source_length_degrees','simplification_bound_px'])assert.ok(Math.abs(a[key]-b[key])<1e-10,key);
  }
}
test('native enclave repair preserves both owners and rejects unreviewed boundaries',{skip:!binary},async()=>{
  for(const row of oracle.cases){
    const {name,expected,error,...request}=row,before=structuredClone(request);
    if(error)await assert.rejects(prepareLSIBEnclave(request,{binary}),value=>value.code==='LSIB_ENCLAVE_REJECTED',name);
    else equivalent(await prepareLSIBEnclave(request,{binary}),expected);
    assert.deepEqual(request,before,name);
  }
});
test('selected IGM enclave repair matches its frozen Python output',{
  skip:!binary||!process.env.PANDO_LSIB_ENCLAVE_ORACLE
},async()=>{
  const {expected,...request}=JSON.parse(await readFile(process.env.PANDO_LSIB_ENCLAVE_ORACLE,'utf8'));
  equivalent(await prepareLSIBEnclave(request,{binary}),expected);
});
test('Python enclave caller receives the selected IGM geometry and report',{
  skip:!binary||!process.env.PANDO_PYTHON_ORACLE||!process.env.PANDO_LSIB_ENCLAVE_ORACLE
},async()=>{
  const input=await readFile(process.env.PANDO_LSIB_ENCLAVE_ORACLE,'utf8');
  const script=`import importlib.util,json,sys\nfrom shapely.geometry import LineString\ns=importlib.util.spec_from_file_location('lsib','tools/supplement-lsib-boundaries.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nx=json.load(sys.stdin)\ng,rows=m.repair_enclave_boundary(x['geometries'],LineString(x['reference']),x['pair'],x['enclave'],x['simplify'])\nassert g==x['expected']['geometries']\nfor k in ['old_length_degrees','source_length_degrees','simplification_bound_px']: assert abs(rows[0][k]-x['expected']['sections'][0][k])<1e-10\nassert list(rows[0]['countries'])==x['pair']\nprint('ok')`;
  const result=spawnSync(process.env.PANDO_PYTHON_ORACLE,['-c',script],{input,encoding:'utf8',windowsHide:true,timeout:180000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'ok');
});
