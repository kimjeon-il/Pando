import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {prepareLSIBReplacements} from '../../tools/gis/lsib-screen-native.mjs';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const oracle=JSON.parse(await readFile(new URL('../fixtures/lsib-chain-oracle.json',import.meta.url),'utf8'));
function equivalent(actual,expected){
  for(const key of ['retained_length_degrees','source_length_degrees','replaced_length_degrees','simplification_bound_px'])
    assert.ok(Math.abs(actual[key]-expected[key])<1e-10,`${key}: ${actual[key]} vs ${expected[key]}`);
  for(const key of ['master_vertices','derived_vertices'])assert.equal(actual[key],expected[key],key);
  for(const key of ['anchors','coordinates']){
    assert.equal(actual[key].length,expected[key].length,key);
    for(let i=0;i<actual[key].length;i++)for(let j=0;j<2;j++)assert.ok(Math.abs(actual[key][i][j]-expected[key][i][j])<1e-10,`${key} ${i}/${j}`);
  }
}
test('batched LSIB replacement retains frozen Python geometry and refusal cases',{skip:!binary},async()=>{
  for(const row of oracle.cases){
    const [result]=await prepareLSIBReplacements(row.old,[row.reference],{binary});
    if(row.error)assert.match(result.error,/anchor|coverage|correspondence/i,row.name);
    else {
      equivalent(result.value,row.expected);
      for(const anchor of result.value.anchors)assert.equal(result.value.coordinates.filter(point=>Math.hypot(point[0]-anchor[0],point[1]-anchor[1])<1e-12).length,1,row.name);
    }
  }
  const first=oracle.cases[0],failed=oracle.cases[3];
  const rows=await prepareLSIBReplacements(first.old,[first.reference,failed.reference],{binary});
  equivalent(rows[0].value,first.expected);assert.ok(rows[1].error);
});
test('selected AUT-LIE replacement matches its frozen Python result',{
  skip:!binary||!process.env.PANDO_LSIB_CHAIN_ORACLE
},async()=>{
  const input=JSON.parse(await readFile(process.env.PANDO_LSIB_CHAIN_ORACLE,'utf8'));
  const [result]=await prepareLSIBReplacements(input.expected,[input.reference],{binary});
  equivalent(result.value,input.replacementExpected);
});
test('remaining untargeted Python caller surfaces native failure and withholds missing anchors',{
  skip:!binary||!process.env.PANDO_PYTHON_ORACLE
},()=>{
  const script=`import importlib.util,os\nfrom pathlib import Path\nfrom unittest.mock import patch\nfrom shapely.geometry import LineString\ns=importlib.util.spec_from_file_location('lsib','tools/supplement-lsib-boundaries.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nold=LineString([(0,0),(1,0),(2,0),(3,0),(4,0)])\nreference=LineString([(0,.2),(1,0),(2,.2),(3,0),(4,.2)])\nrows=m.replacement_chains(old,[reference,LineString([(0,.1),(4,.1)])])\nassert len(rows)==1 and rows[0]['coordinates'][0]==[0.,0.] and rows[0]['coordinates'][-1]==[4.,0.]\nassert abs(rows[0]['retained_length_degrees']-2.)<1e-10\nwith patch.dict(os.environ,{'PANDO_TERRITORIAL_RECIPE_BINARY':str(Path('missing-lsib-native').resolve())}):\n try: m.replacement_chains(old,[reference])\n except RuntimeError as error: assert 'replacement failed' in str(error)\n else: raise AssertionError('missing native executable was accepted')\nprint('ok')`;
  const result=spawnSync(process.env.PANDO_PYTHON_ORACLE,['-c',script],{encoding:'utf8',windowsHide:true,timeout:180000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'ok');
});
