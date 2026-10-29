import assert from 'node:assert/strict';
import {batch01Anchors} from '../../tools/gis/hydro-osm-batch01-anchors.mjs';
import {buildBatch01Screen} from '../../tools/gis/verify-osm-hydro-batch01-anchors.mjs';
import test from 'node:test';

function fixture(){return {manifest:{version:'0.13.2',metadata:{featureCount:16548},container:{sha256:'fixture-sha'}},
  features:batch01Anchors.batch.map(id=>({metadata:{systemId:id,role:'mainstem',name:'이름 '+id},
    geometry:{type:'LineString',coordinates:[[25,64],[25.1,64.1]]}}))};}
test('first-ten audit keeps independent station sources, groups and limits',async()=>{
  const input=fixture(),before=structuredClone(input),calls=[];
  const result=await buildBatch01Screen(input,async request=>{
    calls.push(request);return {lineLengthsMeters:[2000],points:request.points.map((point,index)=>({distanceMeters:(index+1)*1000,nearestLonLat:point}))};
  });
  assert.deepEqual(input,before);assert.deepEqual(result.items.map(row=>row.systemId),batch01Anchors.batch);
  assert.equal(result.baselineHydroVersion,'v0.13.2');assert.equal(result.publishedHydroBundleSha256,'fixture-sha');
  assert.equal(result.metadataNotModified,true);assert.equal(result.osmSourcesNotUsed,true);
  assert.equal(calls.length,10);assert.ok(calls.every(call=>call.mode==='parts'));
  assert.equal(result.items[0].publishedNameKo,'이름 10521208');assert.equal(result.items[0].linePartCount,1);
  assert.equal(result.items[0].mainstemLengthKm,2);assert.equal(result.items[0].independentStations[0].distanceToMainstemKm,1);
  assert.match(result.items[0].independentStations[0].independentSource,/ird\.fr/);
  assert.match(result.limits.at(-1),/Bahr Sara/);assert.equal(result.items[0].minDistanceKmByRiver.Chari,1);
});
test('first-ten audit rejects a changed baseline, missing systems and invalid native receipts',async()=>{
  const data=fixture();
  await assert.rejects(buildBatch01Screen({...data,manifest:{version:'0.13.2',metadata:{featureCount:1}}},()=>{}),/published feature set/i);
  await assert.rejects(buildBatch01Screen({...data,features:data.features.slice(1)},()=>{}),/mainstems missing/i);
  await assert.rejects(buildBatch01Screen(data,async()=>({lineLengthsMeters:[],points:[]})),/native.*result/i);
});
