import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {mkdtempSync,readFileSync,rmdirSync,unlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {sampledLSIBDistance} from '../../tools/gis/lsib-screen-native.mjs';

const binary=process.env.PANDO_TERRITORIAL_RECIPE_BINARY;
const oracle=JSON.parse(await readFile(new URL('../fixtures/lsib-screen-distance-oracle.json',import.meta.url),'utf8'));
function invoke(source,target){return spawnSync(binary,['--sampled-lsib-screen','-'],{
  input:JSON.stringify({source,target}),encoding:'utf8',windowsHide:true});}
test('native LSIB screen sampling matches the frozen GEOS reference in both directions',{skip:!binary},()=>{
  for(const row of oracle.cases)for(const [source,target,distance,count] of [
    [row.source,row.target,row.forward,row.forwardSamples],[row.target,row.source,row.reverse,row.reverseSamples]]){
    const result=invoke(source,target);assert.equal(result.status,0,`${row.name}: ${result.stderr}`);
    const actual=JSON.parse(result.stdout);assert.equal(actual.samples,count,row.name);
    assert.ok(Math.abs(actual.sampledMaximumCssPx-distance)<1e-10,`${row.name}: ${actual.sampledMaximumCssPx} vs ${distance}`);
  }
});
test('native LSIB screen sampling rejects malformed coordinates',{skip:!binary},()=>{
  for(const [source,target] of [[[],[[0,0],[1,1]]],[[[0,0],[1,1]],[[0,0]]],[[[0,0],[1,'bad']],[[0,0],[1,1]]]]){
    const result=invoke(source,target);assert.notEqual(result.status,0);assert.ok(result.stderr);
  }
});
test('Node LSIB adapter rejects invalid input before launching native code',async()=>{
  await assert.rejects(sampledLSIBDistance([[0,0]],[[0,0],[1,1]]),/coordinates/i);
  await assert.rejects(sampledLSIBDistance([[0,0],[1,NaN]],[[0,0],[1,1]]),/coordinates/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(sampledLSIBDistance([[0,0],[1,1]],[[0,0],[1,1]],{signal:controller.signal}),{name:'AbortError'});
});
test('Node LSIB adapter preserves sampled distance and sample count',{skip:!binary},async()=>{
  const row=oracle.cases[0],result=await sampledLSIBDistance(row.source,row.target,{binary});
  assert.equal(result.samples,row.forwardSamples);
  assert.ok(Math.abs(result.sampledMaximumCssPx-row.forward)<1e-10);
});
test('Python LSIB caller preserves the frozen distance contract',{skip:!process.env.PANDO_PYTHON_ORACLE},()=>{
  const script=`import importlib.util,json,sys\nfrom shapely.geometry import LineString\nspec=importlib.util.spec_from_file_location('screen','tools/verify-lsib-screen-delta.py')\nscreen=importlib.util.module_from_spec(spec);spec.loader.exec_module(screen)\nfor row in json.load(sys.stdin)['cases']:\n d,n=screen.sampled_distance(LineString(row['source']),LineString(row['target']))\n assert n==row['forwardSamples'] and abs(d-row['forward'])<1e-10,row['name']\nprint('ok')`;
  const result=spawnSync(process.env.PANDO_PYTHON_ORACLE,['-c',script],{input:JSON.stringify(oracle),encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'ok');
});
test('LSIB CLI refuses an existing output before reading inputs',{skip:!process.env.PANDO_PYTHON_ORACLE},t=>{
  const folder=mkdtempSync(join(tmpdir(),'pando-lsib-output-')),path=join(folder,'existing.json');
  writeFileSync(path,'existing evidence');t.after(()=>{unlinkSync(path);rmdirSync(folder);});
  const result=spawnSync(process.env.PANDO_PYTHON_ORACLE,['tools/verify-lsib-screen-delta.py','--candidate','missing-candidate',
    '--archive','missing-archive','--output',path],{encoding:'utf8',windowsHide:true,
    env:{...process.env,PANDO_TERRITORIAL_RECIPE_BINARY:process.execPath}});
  assert.notEqual(result.status,0);assert.match(result.stderr,/exist/i);
  assert.equal(readFileSync(path,'utf8'),'existing evidence');
});
