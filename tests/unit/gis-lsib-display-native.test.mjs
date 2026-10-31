import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {selectLSIBDisplay} from '../../tools/gis/lsib-screen-native.mjs';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const oracle=JSON.parse(await readFile(new URL('../fixtures/lsib-display-section-oracle.json',import.meta.url),'utf8'));
const invoke=row=>spawnSync(binary,['--select-lsib-display','-'],{input:JSON.stringify(row),encoding:'utf8',windowsHide:true});

test('native LSIB display selection matches Python arcs, holes and closed rings',{skip:!binary},()=>{
  for(const row of oracle.cases){
    const result=invoke(row);assert.equal(result.status,0,`${row.name}: ${result.stderr}`);
    assert.deepEqual(JSON.parse(result.stdout).coordinates,row.expected,row.name);
  }
});
test('native LSIB display selection rejects missing anchors and invalid closed boundaries',{skip:!binary},()=>{
  const row=oracle.cases[0];
  for(const input of [{...row,anchors:[[99,99],[4,4]]},{...oracle.cases[4],geometry:{type:'Polygon',coordinates:[row.geometry.coordinates[0],row.geometry.coordinates[0]]}}]){
    const result=invoke(input);assert.notEqual(result.status,0);assert.ok(result.stderr);
  }
});
test('Node LSIB display adapter preserves the selected arc',{skip:!binary},async()=>{
  const row=oracle.cases[1],result=await selectLSIBDisplay(row.geometry,row.anchors,row.reference,{binary});
  assert.deepEqual(result,row.expected);
});
test('Python LSIB display caller matches the frozen cases',{skip:!process.env.PANDO_PYTHON_ORACLE},()=>{
  const script=`import importlib.util,json,sys\nfrom shapely.geometry import LineString\nspec=importlib.util.spec_from_file_location('screen','tools/verify-lsib-screen-delta.py')\nscreen=importlib.util.module_from_spec(spec);spec.loader.exec_module(screen)\nfor row in json.load(sys.stdin)['cases']:\n result=screen.display_section(row['geometry'],row['anchors'],LineString(row['reference']))\n assert [list(p) for p in result.coords]==row['expected'],row['name']\nprint('ok')`;
  const result=spawnSync(process.env.PANDO_PYTHON_ORACLE,['-c',script],{input:JSON.stringify(oracle),encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'ok');
});
