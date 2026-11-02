import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {calibrationAcceptance,calibrationResidualOverlap,calibrationStageMetrics} from '../../tools/gis/hydro-calibration-metrics.mjs';

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
