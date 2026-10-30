import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {encodeHydroFeatures} from '../../tools/gis/hydro-encoding-native.mjs';

const binary=process.env.PANDO_HYDRO_ENCODING_BINARY;
const cases=JSON.parse(readFileSync('tests/fixtures/hydro-encoding-oracle.json','utf8'));
test('native Hydro encoder matches Python feature and source bytes', {skip:!binary},()=>{
  const result=spawnSync(binary,[],{input:JSON.stringify({features:cases.map(row=>row.feature)}),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).features,cases.map(({featureHex,sourceIdsHex})=>({featureHex,sourceIdsHex})));
});
test('native Hydro encoder refuses malformed width profiles and feature values', {skip:!binary},()=>{
  const missing=structuredClone(cases[0].feature);missing.width_profile=[[1]];
  const invalid=structuredClone(cases[0].feature);invalid.fid=-1;
  for(const feature of [missing,invalid]){
    const result=spawnSync(binary,[],{input:JSON.stringify({features:[feature]}),encoding:'utf8'});
    assert.equal(result.status,1);assert.equal(result.stdout,'');assert.ok(result.stderr.length);
  }
});
test('source-bound Hydro encoder returns verified binary payloads',{skip:!process.env.PANDO_HYDRO_ENCODING_DIRECTORY},async()=>{
  const result=await encodeHydroFeatures(cases.map(row=>row.feature),{directory:process.env.PANDO_HYDRO_ENCODING_DIRECTORY});
  assert.deepEqual(result.map(row=>[row.feature.toString('hex'),row.sourceIds.toString('hex')]),cases.map(row=>[row.featureHex,row.sourceIdsHex]));
  await assert.rejects(encodeHydroFeatures([]),/features/i);
});
