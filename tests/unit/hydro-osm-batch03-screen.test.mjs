import assert from 'node:assert/strict';
import test from 'node:test';
import {batch03Anchors} from '../../tools/gis/hydro-osm-batch03-anchors.mjs';
import {formatBatch03Receipts} from '../../tools/gis/hydro-independent-name-policy.mjs';
import {buildBatch03Screen} from '../../tools/gis/verify-osm-hydro-batch03-points.mjs';

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
