import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {readTerritorialSources} from '../../tools/territorial-entity-sources.mjs';
const baseline=JSON.parse(fs.readFileSync(new URL('../fixtures/country-lineage-baseline.json',import.meta.url),'utf8'));
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('lineage migration preserves each identity, date, version, name, source and coordinate fingerprint',()=>{
 const entities=readTerritorialSources();assert.equal(entities.length,284);
 assert.equal(new Set(entities.map(e=>e.lineageId)).size,262);
 assert.equal(entities.reduce((n,e)=>n+e.geometryVersions.length,0),287);
 for(const entity of entities){const expected=baseline.entities[entity.entityId];assert.ok(expected,entity.entityId);
  assert.equal(entity.lineageId,baseline.membership[entity.entityId]);assert.deepEqual(entity.lifetime,expected.lifetime);
  assert.equal(entity.parentEntityId,expected.parentEntityId);assert.equal(sha(entity.sourceInfo),expected.sourceInfoHash);
  assert.deepEqual(entity.names,expected.names);
  assert.deepEqual(entity.alternateNames,[...new Set([...expected.alternateNames,...(!Object.values(expected.names).includes(expected.canonicalName)?[expected.canonicalName]:[])])]);
  assert.deepEqual(entity.geometryVersions.map(v=>({versionId:v.versionId,validFrom:v.validFrom,validTo:v.validTo,geometryHash:sha(v.geometry)})),expected.versions);
 }
});
