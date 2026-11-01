import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {assignHydroCalibrationStages,countHydroCalibrationChains,optimizeHydroCalibration} from '../../tools/gis/hydro-calibration-native.mjs';

const cases=JSON.parse(readFileSync(new URL('../fixtures/hydro-calibration-chain-oracle.json',import.meta.url),'utf8'));
const optimizerCases=JSON.parse(readFileSync(new URL('../fixtures/hydro-calibration-optimizer-oracle.json',import.meta.url),'utf8'));
test('native Hydro chain counts match the original calibration cases',async()=>{
  for(const row of cases)assert.deepEqual(await countHydroCalibrationChains(row.features),row.expected,row.name);
});
test('native Hydro optimizer preserves original weight and threshold choices',async()=>{
  for(const {name,request,expected} of optimizerCases){
    const actual=await optimizeHydroCalibration(request);
    assert.deepEqual(actual.weights,expected.weights,name);assert.equal(actual.thresholds.length,expected.thresholds.length,name);
    for(let i=0;i<expected.thresholds.length;i++)assert.ok(Math.abs(actual.thresholds[i]-expected.thresholds[i])<1e-12,`${name} threshold ${i}`);
    if(expected.objective===null)assert.equal(actual.objective,null,name);
    else assert.ok(Math.abs(actual.objective-expected.objective)<1e-11,`${name} objective`);
  }
});
test('optimizer stream rejects invalid requests and supports cancellation',async()=>{
  const request=optimizerCases[0].request;
  const run=spawnSync(process.execPath,['tools/gis/hydro-calibration-native.mjs','--optimize-stream'],{
    input:JSON.stringify(request),encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout).weights,optimizerCases[0].expected.weights);
  await assert.rejects(optimizeHydroCalibration({...request,kind:'other'}),/kind/i);
  await assert.rejects(optimizeHydroCalibration({...request,stages:[]}),/stages/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(optimizeHydroCalibration(request,{signal:controller.signal}),{name:'AbortError'});
});
test('native stage assignments match the original scores, thresholds and duplicate decisions',async()=>{
  for(const row of optimizerCases.filter(row=>row.assignment)){
    assert.deepEqual(await assignHydroCalibrationStages(row.assignment.request),row.assignment.expected,row.name);
  }
  await assert.rejects(assignHydroCalibrationStages({...optimizerCases[0].assignment.request,thresholds:[1]}),/assignment/i);
});
test('calibration stream rejects invalid input and keeps coordinates unchanged',async()=>{
  const selected=cases.find(row=>row.name==='junction');
  const run=spawnSync(process.execPath,['tools/gis/hydro-calibration-native.mjs','--chain-stream'],{
    input:JSON.stringify({features:selected.features}),encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);assert.deepEqual(JSON.parse(run.stdout),selected.expected);
  await assert.rejects(countHydroCalibrationChains([{id:1,next:0,stage:6,coordinateCount:-1}]),/coordinate count/i);
  await assert.rejects(countHydroCalibrationChains([{id:1.5,next:0,stage:6,coordinateCount:2}]),/integer/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(countHydroCalibrationChains(selected.features,{signal:controller.signal}),{name:'AbortError'});
});
