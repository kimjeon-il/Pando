import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {readTerritorialSources} from '../../tools/territorial-entity-sources.mjs';
import {selectGeometryVersion} from '../../assets/js/modules/territorial-library.js';
const data = new URL('../../assets/data/',import.meta.url);
const baseline = JSON.parse(fs.readFileSync(new URL('../fixtures/territorial-entity-baseline.json',import.meta.url),'utf8'));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('all 258 source features retain their IDs, properties, types and coordinate order in one source per entity', () => {
  const raw = JSON.parse(fs.readFileSync(new URL('countries-ne-5.1.1.geojson',data),'utf8'));
  const entities = readTerritorialSources();
  const imported = entities.filter(e=>e.sourceInfo.sourceId === 'natural-earth-5.1.1');
  assert.equal(imported.length,raw.features.length);
  for(const feature of raw.features) {
    const e=imported.find(item=>item.entityId===`state:${feature.id}`);
    assert.ok(e,feature.id);
    assert.deepEqual(e.sourceInfo.featureProperties,feature.properties);
    assert.equal(e.sourceInfo.featureId,feature.id);
    assert.equal(sha(e.geometryVersions[0].geometry),baseline.countryGeometry[feature.id]);
    assert.deepEqual(e.geometryVersions[0].geometry,feature.geometry);
    assert.doesNotMatch(e.metadata.defaultFlagDataUrl || '',/^file:/);
  }
});
test('26 historical entities and all 29 production geometry versions retain their fixed baseline hashes', () => {
  const sources=readTerritorialSources();
  const migrated=sources.filter(e=>e.sourceInfo.importProvenance);
  assert.equal(migrated.length,26);
  let count=0;
  for(const e of migrated) for(const v of e.geometryVersions) {
    assert.equal(sha(v.geometry),baseline.historicalGeometry[e.sourceInfo.importProvenance.versionIds[v.id]]);
    count++;
  }
  assert.equal(count,29);
  const yugo=sources.find(e=>e.entityId==='state:yugoslavia');
  const oldVersion=selectGeometryVersion(yugo,'1992-04-26');
  const newVersion=selectGeometryVersion(yugo,'1992-04-27');
  assert.equal(oldVersion.validTo,'1992-04-26');
  assert.equal(newVersion.validFrom,'1992-04-27');
  assert.notEqual(oldVersion.id,newVersion.id);
  assert.equal(selectGeometryVersion(yugo,'1943'),null);
});
