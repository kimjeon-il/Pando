import assert from 'node:assert/strict';
import {batch01Anchors} from "../../../tools/gis/hydro-osm-batch01-anchors.mjs";
import {buildBatch01Screen} from "../../../tools/gis/verify-osm-hydro-batch01-anchors.mjs";
import test from 'node:test';
import {batch02Anchors} from "../../../tools/gis/hydro-osm-batch02-anchors.mjs";
import {buildBatch02Screen} from "../../../tools/gis/verify-osm-hydro-batch02-points.mjs";
import {batch03Anchors} from "../../../tools/gis/hydro-osm-batch03-anchors.mjs";
import {formatBatch03Receipts} from "../../../tools/gis/hydro-independent-name-policy.mjs";
import {buildBatch03Screen} from "../../../tools/gis/verify-osm-hydro-batch03-points.mjs";

function batch01Fixture(){return {manifest:{version:'0.13.2',metadata:{featureCount:16548},container:{sha256:'fixture-sha'}},
  features:batch01Anchors.batch.map(id=>({metadata:{systemId:id,role:'mainstem',name:'이름 '+id},
    geometry:{type:'LineString',coordinates:[[25,64],[25.1,64.1]]}}))};}
test('first-ten audit keeps independent station sources, groups and limits',async()=>{
  const input=batch01Fixture(),before=structuredClone(input),calls=[];
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
  const data=batch01Fixture();
  await assert.rejects(buildBatch01Screen({...data,manifest:{version:'0.13.2',metadata:{featureCount:1}}},()=>{}),/published feature set/i);
  await assert.rejects(buildBatch01Screen({...data,features:data.features.slice(1)},()=>{}),/mainstems missing/i);
  await assert.rejects(buildBatch01Screen(data,async()=>({lineLengthsMeters:[],points:[]})),/native.*result/i);
});

function batch02Fixture(){return {manifest:{version:'0.13.2',metadata:{featureCount:16548},container:{sha256:'fixture-sha'}},
  features:batch02Anchors.ids.map(id=>({metadata:{systemId:id,role:'mainstem',name:'이름 '+id},
    geometry:{type:'LineString',coordinates:[[127,37],[127.1,37.1]]}}))};}
const screen=async request=>({lineLengthsMeters:[2000],points:request.points.map(point=>({distanceMeters:1062.5,nearestLonLat:point}))});
test('second-ten screen preserves source distinctions and handles systems without anchors',async()=>{
  const input=batch02Fixture(),before=structuredClone(input),result=await buildBatch02Screen(input,{screen});
  assert.deepEqual(input,before);assert.equal(result.studyCount,10);assert.equal(result.originalBundleSha256,'fixture-sha');
  assert.equal(result.publishedRiverNameMetadataChanged,false);assert.equal(result.publishedHydroGeometryChanged,false);
  assert.equal(result.osmRelationUsedAsReference,false);assert.equal(result.externalGaugesAvailable,false);assert.equal(result.ngaResultsAvailable,false);
  assert.deepEqual(result.items.find(item=>item.systemId==='40188382').independentPoints,[]);
  assert.equal(result.items[0].independentPoints[0].distanceToPublishedMainstemKm,1.062);
  assert.match(result.caveat,/NOT a gauging site/);
});
test('live named points replace duplicate static NGA points and external gauges retain provenance',async()=>{
  const gauges={provenance:'2023-CA-discharge',gauges:[
    {candidateSystem:'40188382',code:'g1',river:'R',longitude:70,latitude:45},
    {candidateSystem:'40188382',code:'g1',river:'R',longitude:70,latitude:45},
    {candidateSystem:'20628098',code:'bad',river:'R',longitude:190,latitude:45},
  ]};
  const nga={features:[{candidateSystem:'40364680',ufi:'a',name:'Live',longitude:125,latitude:39},
    {candidateSystem:'40364680',ufi:'a',name:'duplicate',longitude:125,latitude:39}]};
  const result=await buildBatch02Screen(batch02Fixture(),{screen,gauges,nga});
  const external=result.items.find(item=>item.systemId==='40188382').independentPoints;
  assert.equal(external.length,1);assert.equal(external[0].id,'cad_g1');assert.match(external[0].independentSource,/zenodo/);
  const points=result.items.find(item=>item.systemId==='40364680').independentPoints;
  assert.equal(points.length,1);assert.equal(points[0].id,'nga_a');assert.equal(points[0].designatedName,'Live');
  assert.deepEqual(result.externalGaugeCounts,{'40188382':2});assert.deepEqual(result.ngaCounts,{'40364680':1});
});
test('second-ten screen rejects missing systems, mismatched source provenance and bad native receipts',async()=>{
  const data=batch02Fixture();
  await assert.rejects(buildBatch02Screen({...data,features:data.features.slice(1)},{screen}),/missing original mainstem/i);
  await assert.rejects(buildBatch02Screen(data,{screen,gauges:{provenance:'other',gauges:[]}}),/provenance/i);
  await assert.rejects(buildBatch02Screen(data,{screen:async()=>({lineLengthsMeters:[],points:[]})}),/native.*result/i);
});

function decoded(){return {manifest:{version:'0.13.2',metadata:{featureCount:16548},container:{sha256:'fixture-sha'}},
  features:batch03Anchors.ids.map(id=>({metadata:{systemId:id,role:'mainstem',name:'이름 '+id},
    geometry:{type:'LineString',coordinates:[[107,11],[107.1,11.1]]}}))};}
function receipts(){
  const rows=batch03Anchors.ids.map(systemId=>({systemId,kind:'name-and-competing-names',status:'not-confirmed',features:[]}));
  rows.push(...['41386179','41386700'].map(systemId=>({systemId,kind:'all-streams-in-small-bbox',status:'not-confirmed',features:[]})));
  rows.find(row=>row.systemId==='41386179').features.push({id:'nga_123',ufi:123,lon:107,lat:11,names:['Đồng Nai'],role:'NGA-GNS-named-STM-point-not-line',source:'fixture'});
  rows.find(row=>row.systemId==='41386179'&&row.kind==='all-streams-in-small-bbox').features.push({id:'nga_123',ufi:123,lon:107,lat:11,names:['Dong Nai'],role:'NGA-GNS-named-STM-point-not-line',source:'fixture'});
  return rows;
}
test('last-eleven screen retains unavailable sources, deduplicates aliases and never grants approval',async()=>{
  const data=decoded(),queries=receipts(),before=structuredClone({data,queries}),calls=[];
  const result=await buildBatch03Screen(data,{receipts:queries,screen:async request=>{
    calls.push(request);return {lineLengthsMeters:[2000],points:request.points.map(point=>({distanceMeters:1062.5,nearestLonLat:point}))};
  }});
  assert.deepEqual({data,queries},before);assert.equal(result.systemsReviewed,11);assert.equal(result.governmentQueryCount,13);
  assert.equal(result.approvalCount,0);assert.equal(result.geoDataNotChanged,true);assert.equal(result.sourceOnlyScreen,true);
  assert.ok(calls.every(call=>call.mode==='tree'));
  const row=result.items.find(item=>item.systemId==='41386179');assert.equal(row.pointCount,1);
  assert.deepEqual(row.independentPointChecks[0].names,['Đồng Nai','Dong Nai']);
  assert.equal(row.independentPointChecks[0].distanceKm,1.062);assert.equal(row.candidateIdentityConfirmed,false);
  assert.ok(result.items.some(item=>item.pointCount===0));assert.match(result.limitations[1],/unavailable queries/);
  assert.equal(formatBatch03Receipts(result)[0],'FINAL_11_RESEARCH_SCREEN_SUCCESS');
});
test('last-eleven screen rejects missing inputs and malformed native receipts',async()=>{
  const data=decoded(),queries=receipts();
  await assert.rejects(buildBatch03Screen({...data,features:data.features.slice(1)},{receipts:queries,screen:()=>{}}),/missing.*mainstem/i);
  await assert.rejects(buildBatch03Screen(data,{receipts:queries.slice(1),screen:()=>{}}),/query receipts/i);
  await assert.rejects(buildBatch03Screen(data,{receipts:queries,screen:async()=>({lineLengthsMeters:[],points:[]})}),/native.*result/i);
});
