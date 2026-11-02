import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {calibrationAcceptance,calibrationRepresentativeChecks,calibrationResidualOverlap,calibrationStageMetrics,estimateCalibrationWorld} from '../../tools/gis/hydro-calibration-metrics.mjs';

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
