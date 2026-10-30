import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {encodeHydroFeatures,encodeHydroRepairPlan,prepareHydroEncodingFeatures} from '../../tools/gis/hydro-encoding-native.mjs';
import {planHydroFeatureRepairs} from '../../tools/gis/hydro-connectivity-native.mjs';

const binary=process.env.PANDO_HYDRO_ENCODING_BINARY;
const cases=JSON.parse(readFileSync('tests/fixtures/hydro-encoding-oracle.json','utf8'));
test('Hydro encoding uses original bounds except for changed geometry',()=>{
  const feature={metadata:{fid:1,logicalFid:101,awId:'fixture:1',category:'river',stage:0,flags:1,
    fragmentIndex:0,fragmentCount:1,width:1.25,bounds:[-180000000,-1,180000000,1],sourceId:'100,110,105'},
    geometry:cases[0].feature.geometry,widths:cases[0].feature.width_profile};
  const before=structuredClone(feature);
  assert.deepEqual(prepareHydroEncodingFeatures([feature],[]),[cases[0].feature]);
  const changed=prepareHydroEncodingFeatures([feature],[1]);
  assert.deepEqual(changed[0].bounds,[-179.999999,-.000001,180,.000001]);
  assert.deepEqual(feature,before);
  assert.throws(()=>prepareHydroEncodingFeatures([feature],[2]),/changed/i);
});
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
  const row=cases[0].feature,feature={metadata:{fid:row.fid,logicalFid:row.logical_fid,awId:row.pandolab_id,category:row.category,
    stage:row.stage,flags:row.flags,fragmentIndex:row.fragment_index,fragmentCount:row.fragment_count,width:row.width,
    bounds:row.bounds.map(value=>Math.round(value*1000000)),sourceId:row.source_id},geometry:row.geometry,widths:row.width_profile};
  const planned=await encodeHydroRepairPlan({features:[feature],changedFeatureIds:[],boundsPendingFor:[]},
    {directory:process.env.PANDO_HYDRO_ENCODING_DIRECTORY});
  assert.equal(planned[0].feature.toString('hex'),cases[0].featureHex);
  await assert.rejects(encodeHydroRepairPlan({features:[feature],changedFeatureIds:[1],boundsPendingFor:[]}),/bounds/i);
  await assert.rejects(encodeHydroFeatures([]),/features/i);
});
test('source-bound Hydro repair plans encode to the original Python bytes',{
  skip:!process.env.PANDO_HYDRO_ENCODING_DIRECTORY||!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY,
},async()=>{
  const selected=cases.filter(row=>[10,11].includes(row.feature.fid));
  const features=selected.map(({feature:row})=>({metadata:{fid:row.fid,logicalFid:row.logical_fid,awId:row.pandolab_id,
    category:row.category,stage:row.stage,flags:row.flags,fragmentIndex:row.fragment_index,fragmentCount:row.fragment_count,
    width:row.width,bounds:row.bounds.map(value=>Math.round(value*1000000)),sourceId:row.source_id,systemId:'fixture'},
    geometry:structuredClone(row.geometry),widths:row.width_profile}));
  features[0].geometry.coordinates[1]=[1,0];features[0].metadata.bounds=[0,0,1000000,0];
  const raw={1:{region:'eu',next:2,start:[0,0],end:[1,0]},2:{region:'eu',next:0,start:[1,0],end:[2,0]}};
  const plan=await planHydroFeatureRepairs({features,raw,sourceOrder:[1,2]},
    {directory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY});
  assert.deepEqual(plan.changedFeatureIds,[10]);
  const encoded=await encodeHydroRepairPlan(plan,{directory:process.env.PANDO_HYDRO_ENCODING_DIRECTORY});
  assert.deepEqual(encoded.map(row=>[row.feature.toString('hex'),row.sourceIds.toString('hex')]),
    selected.map(row=>[row.featureHex,row.sourceIdsHex]));
});
