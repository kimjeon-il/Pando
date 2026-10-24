import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {readTerritorialSources} from '../../tools/territorial-entity-sources.mjs';

const baseline=JSON.parse(fs.readFileSync(new URL('../fixtures/country-lineage-baseline.json',import.meta.url),'utf8'));
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const merged={'state:IDN':'state:indonesia','state:UKR':'state:ukraine','state:SDN':'state:sudan'};
const approvedNames=new Map([
 ['state:ESB','데켈리아'],['state:ASM','미국령 사모아'],['state:PYF','프랑스령 폴리네시아'],
 ['state:UMI','미국령 군소제도'],['state:VGB','영국령 버진아일랜드'],['state:VIR','미국령 버진아일랜드'],
]);
const extended=new Map([
 ['state:UKR',{from:'2014-03-18',to:'2026-10-05',id:'state:UKR:2014-03-18-post-crimea-r1'}],
 ['state:SDN',{from:'2011-07-09',to:'2026-10-05',id:'state:SDN:2011-07-09-post-secession-r1'}],
 ['state:SDS',{from:'2011-07-09',to:'2026-10-05',id:'state:SDS:2011-07-09-independence-r1'}],
]);

test('281 identities preserve all original coordinates and 294 validated territorial geometry versions',()=>{
 const entities=readTerritorialSources();
 assert.equal(entities.length,281);
 assert.equal(new Set(entities.map(e=>e.lineageId)).size,262);
 assert.equal(entities.reduce((n,e)=>n+e.geometryVersions.length,0),294);
 for(const removed of Object.values(merged))assert.ok(!entities.some(e=>e.entityId===removed));
 for(const e of entities){
  const prior=baseline.entities[e.entityId];assert.ok(prior,e.entityId);
  assert.equal(e.lineageId,baseline.membership[e.entityId]);
  assert.equal(e.parentEntityId,prior.parentEntityId);
  if(approvedNames.has(e.entityId)){
   assert.deepEqual(e.names,{...prior.names,ko:approvedNames.get(e.entityId)});
   assert.equal(e.sourceInfo.featureProperties.name,approvedNames.get(e.entityId));
   // Keep the frozen baseline intact and prove the approved rename is the
   // only source-metadata change; geometry and identity checks below still apply.
   assert.equal(sha({...e.sourceInfo,featureProperties:{...e.sourceInfo.featureProperties,name:prior.names.ko}}),prior.sourceInfoHash);
  }else{
   assert.equal(sha(e.sourceInfo),prior.sourceInfoHash);
   assert.deepEqual(e.names,prior.names);
  }
  assert.deepEqual(e.alternateNames,[...new Set([...prior.alternateNames,...(!Object.values(prior.names).includes(prior.canonicalName)?[prior.canonicalName]:[])])]);
  if(e.entityId==='state:IDN'){
   const mask=JSON.parse(fs.readFileSync(new URL('../../tools/historical-library/sources/indonesia/west-new-guinea-component-mask-v5.1.1.json',import.meta.url),'utf8'));
   const versions=e.geometryVersions;
   assert.equal(versions.length,5);
   assert.deepEqual(e.lifetime,{validFrom:'1945-08-17',validTo:null});
   assert.deepEqual(versions.map(v=>[v.validFrom,v.validTo]),[
    ['1945-08-17','1963-04-30'],['1963-05-01','1975-12-06'],
    ['1975-12-07','1999-10-24'],['1999-10-25','2026-10-05'],
    ['2026-10-06',null]]);
   const presentHash=prior.versions[0].geometryHash;
   assert.equal(sha(versions[4].geometry),presentHash);
   assert.equal(sha(versions[3].geometry),presentHash);
   assert.equal(sha(versions[1].geometry),presentHash);
   assert.equal(sha(versions[2].geometry),baseline.entities['state:indonesia'].versions[0].geometryHash);
   assert.deepEqual(versions[2].historicalProvenance.originalInterval,{validFrom:'1945-08-17',validTo:'2002-05-19'});
   assert.equal(versions[0].geometry.type,'MultiPolygon');
   assert.equal(versions[4].geometry.coordinates.length,264);
   assert.equal(versions[0].geometry.coordinates.length,239);
   assert.equal(mask.excludedModernPolygonIndices.length,25);
   const excluded=new Set(mask.excludedModernPolygonIndices);
   assert.deepEqual(versions[0].geometry.coordinates,versions[4].geometry.coordinates.filter((_,i)=>!excluded.has(i)));
   assert.deepEqual(versions.slice(0,4).map(v=>v.certainty),Array.from({length:4},()=> 'low'));
   continue;
  }
  if(e.entityId==='state:TLS'){
   assert.deepEqual(e.lifetime,{validFrom:'2002-05-20',validTo:null});
   assert.equal(e.geometryVersions.length,2);
   assert.equal(sha(e.geometryVersions[0].geometry),prior.versions[0].geometryHash);
   assert.equal(sha(e.geometryVersions[1].geometry),prior.versions[0].geometryHash);
   assert.deepEqual(e.geometryVersions.map(v=>[v.validFrom,v.validTo]),[
    ['2002-05-20','2026-10-05'],['2026-10-06',null]]);
   assert.equal(e.geometryVersions[0].certainty,'low');
   continue;
  }
  if(e.entityId==='state:soviet-union'){
   const original=prior.versions[0];
   const version=e.geometryVersions[0];
   const reconstructed={...version.geometry,coordinates:version.geometry.coordinates.map(polygon=>
    polygon.map(ring=>[ring[0],...ring.slice(1,-1).reverse(),ring.at(-1)]))};
   assert.deepEqual(e.lifetime,prior.lifetime);
   assert.deepEqual({versionId:version.versionId,validFrom:version.validFrom,validTo:version.validTo,geometryHash:sha(reconstructed)},original);
   continue;
  }
  const previousHistoric=merged[e.entityId];
  const extension=extended.get(e.entityId);
  if(!previousHistoric&&!extension){
   assert.deepEqual(e.lifetime,prior.lifetime);
   assert.deepEqual(e.geometryVersions.map(v=>({versionId:v.versionId,validFrom:v.validFrom,validTo:v.validTo,geometryHash:sha(v.geometry)})),prior.versions);
   continue;
  }
  const historical=previousHistoric?e.geometryVersions[0]:null;
  if(historical){
   const original=baseline.entities[previousHistoric].versions[0];
   assert.deepEqual({versionId:historical.versionId,validFrom:historical.validFrom,validTo:historical.validTo,geometryHash:sha(historical.geometry)},original);
   assert.equal(historical.instantiation.mode,'territory-replacement');
   assert.equal(historical.historicalProvenance.originalEntityId,previousHistoric);
   assert.deepEqual(e.lifetime,{validFrom:baseline.entities[previousHistoric].lifetime.validFrom,validTo:null});
  }else assert.deepEqual(e.lifetime,prior.lifetime);
  const modern=e.geometryVersions.at(-1);
  assert.equal(modern.versionId,prior.versions[0].versionId);
  assert.equal(sha(modern.geometry),prior.versions[0].geometryHash);
  assert.equal(modern.validFrom,'2026-10-06');
  assert.equal(modern.validTo,null);
  if(!extension){
   assert.equal(e.geometryVersions.length,2);
   continue;
  }
  const proxy=e.geometryVersions.at(-2);
  assert.equal(proxy.versionId,extension.id);
  assert.equal(proxy.validFrom,extension.from);
  assert.equal(proxy.validTo,extension.to);
  assert.equal(Object.hasOwn(proxy,'datePrecision'),false);
  assert.equal(proxy.certainty,'low');
  assert.equal(proxy.instantiation.mode,'territory-replacement');
  assert.equal(proxy.historicalProvenance.verifiedHistoricalGeometry,false);
  assert.equal(proxy.historicalProvenance.sourceReferenceDate,'2026-10-06');
  assert.equal(sha(proxy.geometry),prior.versions[0].geometryHash);
 }
});
