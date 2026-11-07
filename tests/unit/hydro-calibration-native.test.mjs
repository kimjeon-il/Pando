import { describe as contractSuite } from 'node:test';
import * as __hydro_dep0 from "node:assert/strict";
import * as __hydro_dep1 from "node:child_process";
import * as __hydro_dep2 from "node:fs";
import * as __hydro_dep3 from "node:test";
import * as __hydro_dep4 from "../../tools/gis/hydro-calibration-native.mjs";
import * as __hydro_dep5 from "../../tools/gis/hydro-calibration-metrics.mjs";

// Original feature contract: hydro-calibration-native.test.mjs
contractSuite("hydro-calibration-native", () => {
const assert = __hydro_dep0.default;
const { spawnSync } = __hydro_dep1;
const { readFileSync } = __hydro_dep2;
const test = __hydro_dep3.default;
const { assignHydroCalibrationStages, compareHydroCalibrationDirections, countHydroCalibrationChains, optimizeHydroCalibration } = __hydro_dep4;






const cases=JSON.parse(readFileSync(new URL('../fixtures/hydro-calibration-chain-oracle.json',import.meta.url),'utf8'));
const optimizerCases=JSON.parse(readFileSync(new URL('../fixtures/hydro-calibration-optimizer-oracle.json',import.meta.url),'utf8'));
const directionCases=JSON.parse(readFileSync(new URL('../fixtures/hydro-calibration-direction-oracle.json',import.meta.url),'utf8'));
test('projected line direction similarity follows original longest-segment rules',async()=>{
  const actual=await compareHydroCalibrationDirections(directionCases.map(({left,right})=>({left,right})));
  assert.equal(actual.length,directionCases.length);
  for(let i=0;i<actual.length;i++)assert.ok(Math.abs(actual[i]-directionCases[i].expected)<1e-15,`case ${i}`);
  const stream=spawnSync(process.execPath,['tools/gis/hydro-calibration-native.mjs','--direction-stream'],{
    cwd:process.cwd(),input:JSON.stringify({pairs:directionCases.slice(0,3)}),encoding:'utf8'});
  assert.equal(stream.status,0,stream.stderr);
  assert.deepEqual(JSON.parse(stream.stdout),actual.slice(0,3));
  await assert.rejects(compareHydroCalibrationDirections([{left:[[0]],right:[]}]),/point|coordinate/i);
  const controller=new AbortController();controller.abort();
  await assert.rejects(compareHydroCalibrationDirections([],{signal:controller.signal}),{name:'AbortError'});
});
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
});

// Original feature contract: hydro-calibration-metrics.test.mjs
contractSuite("hydro-calibration-metrics", () => {
const assert = __hydro_dep0.default;
const { readFileSync } = __hydro_dep2;
const { spawnSync } = __hydro_dep1;
const test = __hydro_dep3.default;
const { calibrationAcceptance, calibrationRepresentativeChecks, calibrationResidualOverlap, calibrationStageMetrics, estimateCalibrationWorld } = __hydro_dep5;






const oracle=JSON.parse(readFileSync(new URL('../fixtures/hydro-calibration-metrics-oracle.json',import.meta.url),'utf8'));
test('stage measurements and residual overlap match the Python calibration',()=>{
  assert.deepEqual(calibrationStageMetrics(oracle.input,'river'),oracle.metrics.river);
  assert.deepEqual(calibrationStageMetrics(oracle.input,'lake'),oracle.metrics.lake);
  assert.equal(calibrationResidualOverlap(oracle.input.rivers,'river'),oracle.metrics.riverOverlap);
  assert.equal(calibrationResidualOverlap(oracle.input.lakes,'lake'),oracle.metrics.lakeOverlap);
  assert.equal(calibrationResidualOverlap([],'river'),0);
  const noTarget=structuredClone(oracle.input);noTarget.riverTargets['6.0'].lengthKm=0;
  assert.equal(calibrationStageMetrics(noTarget,'river')['6.0'].lengthRatio,null);
});
test('acceptance follows the original thresholds and excludes Korea',()=>{
  assert.deepEqual(calibrationAcceptance(oracle.acceptanceInput),oracle.acceptance);
  const input=structuredClone(oracle.acceptanceInput);input.regions.korea=structuredClone(input.regions.europe);
  delete input.regions.europe;assert.equal(calibrationAcceptance(input).riverFinalWithin15Percent,true);
  input.representativeChecks.missing={present:false};assert.equal(calibrationAcceptance(input).representativeFeaturesPresent,false);
  input.regions.europe=structuredClone(oracle.acceptanceInput.regions.europe);input.regions.europe.rivers['7.5'].lengthRatio=null;
  assert.throws(()=>calibrationAcceptance(input),/finite/i);
});
test('representative rivers and lakes are checked against the retained base sources',()=>{
  assert.deepEqual(calibrationRepresentativeChecks(oracle.representativeInput),oracle.representativeExpected);
  const cli=spawnSync(process.execPath,['tools/gis/hydro-calibration-metrics.mjs','--representatives-stream'],
    {input:JSON.stringify(oracle.representativeInput),encoding:'utf8'});
  assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout),oracle.representativeExpected);
  const missing=structuredClone(oracle.representativeInput);missing.lakes.pop();
  assert.equal(calibrationRepresentativeChecks(missing)['오대호'].present,false);
});
test('world estimate uses the native chain count and the original extrapolation',async()=>{
  assert.deepEqual(await estimateCalibrationWorld(oracle.worldInput),oracle.worldExpected);
  const empty=await estimateCalibrationWorld([{region:{calibrate:true},rivers:[],lakes:[]}]);
  assert.equal(empty.riverReachCount,0);assert.equal(empty.lakeFeatureCount,0);assert.equal(empty.riverChaining.objectReductionPercent,100);
  const cli=spawnSync(process.execPath,['tools/gis/hydro-calibration-metrics.mjs','--world-estimate-stream'],
    {input:JSON.stringify({regions:oracle.worldInput}),encoding:'utf8'});
  assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout),oracle.worldExpected);
  const controller=new AbortController();controller.abort();
  await assert.rejects(estimateCalibrationWorld(oracle.worldInput,{signal:controller.signal}),{name:'AbortError'});
});
});
