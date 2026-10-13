import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {readTerritorialSources} from '../../tools/territorial-entity-sources.mjs';
const baseline=JSON.parse(fs.readFileSync(new URL('../fixtures/country-lineage-baseline.json',import.meta.url),'utf8'));
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const merged={'state:IDN':'state:indonesia','state:UKR':'state:ukraine','state:SDN':'state:sudan'};
test('consolidation preserves all 287 geometry versions and the three historical shape fingerprints',()=>{
 const entities=readTerritorialSources();
 assert.equal(entities.length,281);
 assert.equal(new Set(entities.map(e=>e.lineageId)).size,262);
 assert.equal(entities.reduce((n,e)=>n+e.geometryVersions.length,0),287);
 for(const removed of Object.values(merged))assert.ok(!entities.some(e=>e.entityId===removed));
 for(const entity of entities){
  const expected=baseline.entities[entity.entityId];assert.ok(expected,entity.entityId);
  assert.equal(entity.lineageId,baseline.membership[entity.entityId]);
  assert.equal(entity.parentEntityId,expected.parentEntityId);
  assert.equal(sha(entity.sourceInfo),expected.sourceInfoHash);
  assert.deepEqual(entity.names,expected.names);
  assert.deepEqual(entity.alternateNames,[...new Set([...expected.alternateNames,...(!Object.values(expected.names).includes(expected.canonicalName)?[expected.canonicalName]:[])])]);
  const old=merged[entity.entityId];
  if(!old){
   assert.deepEqual(entity.lifetime,expected.lifetime);
   assert.deepEqual(entity.geometryVersions.map(v=>({versionId:v.versionId,validFrom:v.validFrom,validTo:v.validTo,geometryHash:sha(v.geometry)})),expected.versions);
   continue;
  }
  const prior=baseline.entities[old],historical=entity.geometryVersions[0],current=entity.geometryVersions[1];
  assert.deepEqual(entity.lifetime,{validFrom:prior.lifetime.validFrom,validTo:null});
  assert.deepEqual({versionId:historical.versionId,validFrom:historical.validFrom,validTo:historical.validTo,geometryHash:sha(historical.geometry)},prior.versions[0]);
  assert.deepEqual({versionId:current.versionId,geometryHash:sha(current.geometry)},{versionId:expected.versions[0].versionId,geometryHash:expected.versions[0].geometryHash});
  assert.equal(current.validFrom,'2026-10-06');assert.equal(current.validTo,null);
  assert.equal(historical.instantiation.mode,'territory-replacement');
  assert.equal(historical.historicalProvenance.originalEntityId,old);
 }
});
