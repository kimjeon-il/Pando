import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {readTerritorialSources} from '../../tools/territorial-entity-sources.mjs';

const baseline=JSON.parse(fs.readFileSync(new URL('../fixtures/country-lineage-baseline.json',import.meta.url),'utf8'));
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const merged={'state:IDN':'state:indonesia','state:UKR':'state:ukraine','state:SDN':'state:sudan'};
const extended=new Map([
 ['state:UKR',{from:'2014-03-18',to:'2026-10-05',id:'state:UKR:2014-03-18-post-crimea-r1'}],
 ['state:SDN',{from:'2011-07-09',to:'2026-10-05',id:'state:SDN:2011-07-09-post-secession-r1'}],
 ['state:SDS',{from:'2011-07-09',to:'2026-10-05',id:'state:SDS:2011-07-09-independence-r1'}],
]);

test('281 identities preserve 287 original versions and add exactly three low-confidence period proxies',()=>{
 const entities=readTerritorialSources();
 assert.equal(entities.length,281);
 assert.equal(new Set(entities.map(e=>e.lineageId)).size,262);
 assert.equal(entities.reduce((n,e)=>n+e.geometryVersions.length,0),290);
 for(const removed of Object.values(merged))assert.ok(!entities.some(e=>e.entityId===removed));
 for(const e of entities){
  const prior=baseline.entities[e.entityId];assert.ok(prior,e.entityId);
  assert.equal(e.lineageId,baseline.membership[e.entityId]);
  assert.equal(e.parentEntityId,prior.parentEntityId);
  assert.equal(sha(e.sourceInfo),prior.sourceInfoHash);
  assert.deepEqual(e.names,prior.names);
  assert.deepEqual(e.alternateNames,[...new Set([...prior.alternateNames,...(!Object.values(prior.names).includes(prior.canonicalName)?[prior.canonicalName]:[])])]);
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
  assert.equal(proxy.datePrecision,'approximate');
  assert.equal(proxy.certainty,'low');
  assert.equal(proxy.instantiation.mode,'territory-replacement');
  assert.equal(proxy.historicalProvenance.verifiedHistoricalGeometry,false);
  assert.equal(proxy.historicalProvenance.sourceReferenceDate,'2026-10-06');
  assert.equal(sha(proxy.geometry),prior.versions[0].geometryHash);
 }
});
