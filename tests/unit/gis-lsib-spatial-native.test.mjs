import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {classifyLSIBSpatial} from '../../tools/gis/lsib-screen-native.mjs';

const fixture=JSON.parse(await readFile(new URL('../fixtures/lsib-spatial-oracle.json',import.meta.url),'utf8'));
function compare(actual,expected){
  assert.deepEqual(actual.disputed,expected.disputed);assert.equal(actual.chains.length,expected.chains.length);
  for(let i=0;i<actual.chains.length;i++){
    assert.equal(actual.chains[i].isRing,expected.chains[i].isRing);
    assert.ok(Math.abs(actual.chains[i].length-expected.chains[i].length)<1e-10);
    assert.deepEqual(actual.chains[i].nearby,expected.chains[i].nearby);
  }
}
test('spatial classification matches frozen Python buffer, ring and distance rules',async()=>{
  const input=structuredClone(fixture);compare(await classifyLSIBSpatial(input),fixture.expected);assert.deepEqual(input,fixture);
});
test('spatial classification surfaces native failures',async()=>{
  await assert.rejects(classifyLSIBSpatial(fixture,{binary:'missing-lsib-native'}),/native.*failed/i);
});
test('untargeted caller batches disputed-source flags and surfaces native failures',{
  skip:!process.env.PANDO_PYTHON_ORACLE||!process.env.PANDO_TERRITORIAL_RECIPE_BINARY
},()=>{
  const script=`import importlib.util,json,os,sys\nfrom pathlib import Path\nfrom shapely.geometry import shape\nfrom unittest.mock import patch\ns=importlib.util.spec_from_file_location('lsib','tools/supplement-lsib-boundaries.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nx=json.load(sys.stdin);disputes=[{'line':shape(g)} for g in x['disputes']];records=[{'line':shape(g)} for g in x['sources']]\nflags=m.disputed_source_flags(disputes,records)\nassert [flags[id(row)] for row in records]==x['expected']['disputed']\nwith patch.dict(os.environ,{'PANDO_TERRITORIAL_RECIPE_BINARY':str(Path('missing-lsib-native').resolve())}):\n try: m.disputed_source_flags(disputes,records)\n except RuntimeError as error: assert 'classification failed' in str(error)\n else: raise AssertionError('missing native executable was accepted')\nprint('ok')`;
  const result=spawnSync(process.env.PANDO_PYTHON_ORACLE,['-c',script],{input:JSON.stringify(fixture),encoding:'utf8',windowsHide:true,timeout:180000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'ok');
});
test('selected AUT/LIE and Natural Earth disputes match the Python result',{skip:!process.env.PANDO_LSIB_SPATIAL_ORACLE},async()=>{
  const fixture=JSON.parse(await readFile(process.env.PANDO_LSIB_SPATIAL_ORACLE,'utf8'));
  compare(await classifyLSIBSpatial(fixture),fixture.expected);
});
