import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {buildVerifiedHydroRepair} from '../../tools/gis/hydro-repair-pipeline.mjs';

test('pinned source, repair, encoding, pack and production decoder preserve the staged Hydro result',{
  skip:!process.env.PANDO_HYDRO_ENCODING_DIRECTORY||!process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY,
},async()=>{
  const specification=JSON.parse(await readFile('tests/fixtures/hydro-source/spec.json','utf8'));
  const lines=[{fid:1,source:'101',points:[[0,0],[.999,0]],bounds:[0,0,999000,0]},
    {fid:2,source:'102',points:[[1,0],[2,0]],bounds:[1000000,0,2000000,0]},
    {fid:3,source:'103',points:[[0,1],[1,0]],bounds:[0,0,1000000,1000000]}];
  const features=lines.map(row=>({metadata:{fid:row.fid,logicalFid:row.fid+100,awId:'river:'+row.fid,name:'River '+row.fid,
    sourceId:row.source,source:'fixture',layerId:'fixture',category:'river',bounds:row.bounds,stage:0,flags:0,
    fragmentIndex:0,fragmentCount:1,width:1.25,systemId:'s'},geometry:{type:'LineString',coordinates:row.points},widths:[[1,1]]}));
  const baseline={manifest:{stages:Array.from({length:4},(_,id)=>({id,minZoom:6+id}))},features},before=structuredClone(baseline);
  const archives=[{archive:'tests/fixtures/hydro-source/fixture.zip',specification}];
  const result=await buildVerifiedHydroRepair({baseline,archives},{connectivityDirectory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY,
    encodingDirectory:process.env.PANDO_HYDRO_ENCODING_DIRECTORY});
  assert.deepEqual(baseline,before);assert.deepEqual(result.plan.changedFeatureIds,[1]);
  assert.equal(result.verification.features,3);assert.equal(result.verification.remaining,0);
  assert.equal(result.pack.stats.featureCount,3);assert(result.pack.files.has('index.bin.gz'));
  const wrong=structuredClone(specification);wrong.files[0].sha256='0'.repeat(64);
  await assert.rejects(buildVerifiedHydroRepair({baseline,archives:[{archive:archives[0].archive,specification:wrong}]},
    {connectivityDirectory:process.env.PANDO_HYDRO_CONNECTIVITY_DIRECTORY,encodingDirectory:process.env.PANDO_HYDRO_ENCODING_DIRECTORY}),/hash/i);
  assert.deepEqual(baseline,before);
  const controller=new AbortController();controller.abort();
  await assert.rejects(buildVerifiedHydroRepair({baseline,archives},{signal:controller.signal}),/abort/i);
});
