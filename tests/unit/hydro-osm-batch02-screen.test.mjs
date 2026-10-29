import assert from 'node:assert/strict';
import test from 'node:test';
import {batch02Anchors} from '../../tools/gis/hydro-osm-batch02-anchors.mjs';
import {buildBatch02Screen} from '../../tools/gis/verify-osm-hydro-batch02-points.mjs';

function fixture(){return {manifest:{version:'0.13.2',metadata:{featureCount:16548},container:{sha256:'fixture-sha'}},
  features:batch02Anchors.ids.map(id=>({metadata:{systemId:id,role:'mainstem',name:'이름 '+id},
    geometry:{type:'LineString',coordinates:[[127,37],[127.1,37.1]]}}))};}
const screen=async request=>({lineLengthsMeters:[2000],points:request.points.map(point=>({distanceMeters:1062.5,nearestLonLat:point}))});
test('second-ten screen preserves source distinctions and handles systems without anchors',async()=>{
  const input=fixture(),before=structuredClone(input),result=await buildBatch02Screen(input,{screen});
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
  const result=await buildBatch02Screen(fixture(),{screen,gauges,nga});
  const external=result.items.find(item=>item.systemId==='40188382').independentPoints;
  assert.equal(external.length,1);assert.equal(external[0].id,'cad_g1');assert.match(external[0].independentSource,/zenodo/);
  const points=result.items.find(item=>item.systemId==='40364680').independentPoints;
  assert.equal(points.length,1);assert.equal(points[0].id,'nga_a');assert.equal(points[0].designatedName,'Live');
  assert.deepEqual(result.externalGaugeCounts,{'40188382':2});assert.deepEqual(result.ngaCounts,{'40364680':1});
});
test('second-ten screen rejects missing systems, mismatched source provenance and bad native receipts',async()=>{
  const data=fixture();
  await assert.rejects(buildBatch02Screen({...data,features:data.features.slice(1)},{screen}),/missing original mainstem/i);
  await assert.rejects(buildBatch02Screen(data,{screen,gauges:{provenance:'other',gauges:[]}}),/provenance/i);
  await assert.rejects(buildBatch02Screen(data,{screen:async()=>({lineLengthsMeters:[],points:[]})}),/native.*result/i);
});
