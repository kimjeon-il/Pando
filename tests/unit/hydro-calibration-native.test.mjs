import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {countHydroCalibrationChains} from '../../tools/gis/hydro-calibration-native.mjs';

const cases=JSON.parse(readFileSync(new URL('../fixtures/hydro-calibration-chain-oracle.json',import.meta.url),'utf8'));
test('native Hydro chain counts match the original calibration cases',async()=>{
  for(const row of cases)assert.deepEqual(await countHydroCalibrationChains(row.features),row.expected,row.name);
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
