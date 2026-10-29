import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {compareYarraVector,fetchYarraVector} from '../../tools/gis/verify-victorian-yarra-source.mjs';

const hydro=()=>({features:[{metadata:{systemId:'50798885',role:'mainstem',name:'야라강'},geometry:{type:'LineString',coordinates:[[145,-37.8],[145.01,-37.81]]}}]});
const source=()=>Buffer.from(JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{NAME:'Yarra River'},
  geometry:{type:'LineString',coordinates:[[145,-37.8],[145.01,-37.81]]}}]}));
const screen=async request=>({lineLengthsMeters:[2000],referenceLengthsMeters:[3000],referenceBoundsMeters:[300000,5800000,301000,5801000],
  hydroToReferenceMeters:Array(request.samples).fill(300),referenceToHydroMeters:Array(request.samples).fill(1200)});
test('Yarra vector screen keeps independent source and bidirectional sample summaries',async()=>{
  const data=hydro(),before=structuredClone(data),bytes=source(),calls=[];
  const result=await compareYarraVector(data,bytes,async request=>{calls.push(request);return screen(request);});
  assert.deepEqual(data,before);assert.equal(calls[0].mode,'vector');assert.equal(calls[0].crs,'EPSG:32755');assert.equal(calls[0].samples,161);
  assert.equal(result.source.sourceGeoJSONSha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(result.hydroMainstemTotalLengthKm,2);assert.equal(result.governmentRiverTotalLengthKm,3);
  assert.deepEqual(result.hydroSamplesToNamedGovernmentRiver,{samples:161,within0_5km:1,within1km:1,within2km:1,p90DistanceKm:0.3,maxDistanceKm:0.3});
  assert.equal(result.governmentSamplesToHydroMainstem.within1km,0);assert.equal(result.publishedToRuntime,false);
});
test('Yarra vector screen rejects mismatched names, invalid geometry receipts and missing mainstems',async()=>{
  const data=hydro(),bad=JSON.parse(source());bad.features[0].properties.NAME='Other River';
  await assert.rejects(compareYarraVector(data,Buffer.from(JSON.stringify(bad)),screen),/unexpected government river name/i);
  await assert.rejects(compareYarraVector({features:[]},source(),screen),/mainstem missing/i);
  await assert.rejects(compareYarraVector(data,source(),async()=>({})),/native.*result/i);
  await assert.rejects(compareYarraVector(data,source(),async request=>({...await screen(request),referenceBoundsMeters:[0,0,1,1]})),/outside Victoria/i);
});
test('Yarra source fetch retains the exact bytes and propagates cancellation',async()=>{
  const bytes=source(),received=await fetchYarraVector({fetcher:async()=>new Response(bytes,{status:200})});assert.deepEqual(received,bytes);
  const controller=new globalThis.AbortController();controller.abort();
  await assert.rejects(fetchYarraVector({signal:controller.signal}),/abort/i);
});
