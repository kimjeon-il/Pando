import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {readTerritorialSources} from '../../tools/territorial-entity-sources.mjs';
import {selectGeometryVersion} from "../../apps/editor/frontend/js/modules/territorial-library.js";
const data = new URL('../../assets/data/',import.meta.url);
const baseline = JSON.parse(fs.readFileSync(new URL('../fixtures/territorial-entity-baseline.json',import.meta.url),'utf8'));
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('all 258 source features retain identity and properties; uncurated geometries retain exact coordinate order', () => {
  const raw = JSON.parse(fs.readFileSync(new URL('countries-ne-5.1.1.geojson',data),'utf8'));
  const entities = readTerritorialSources();
  const imported = entities.filter(e=>e.sourceInfo.featureId);
  assert.equal(imported.length,raw.features.length);
  for(const feature of raw.features) {
    const e=imported.find(item=>item.entityId===`state:${feature.id}`);
    assert.ok(e,feature.id);
    assert.deepEqual(e.sourceInfo.featureProperties,feature.properties);
    assert.equal(e.sourceInfo.featureId,feature.id);
    if(['KOR','PRK','CHN'].includes(feature.id)){
      const current=selectGeometryVersion(e,'2026-10-06');
      assert.ok(current.historicalProvenance.sourceIds.includes('dos-lsib-11.4'));
      assert.equal(sha(current.geometry),e.sourceInfo.geometrySha256);
      assert.notEqual(sha(current.geometry),baseline.countryGeometry[feature.id]);
      continue;
    }
    const sourceVersion=['IDN','SDN','UKR'].includes(feature.id)?e.geometryVersions.at(-1):e.geometryVersions[0];
    assert.equal(sha(sourceVersion.geometry),baseline.countryGeometry[feature.id]);
    assert.deepEqual(sourceVersion.geometry,feature.geometry);
    assert.doesNotMatch(e.metadata.defaultFlagDataUrl || '',/^file:/);
  }
});
test('historical geometry retains frozen baseline coordinates; the documented USSR fix changes only ring order', () => {
  const sources=readTerritorialSources();
  const migrated=sources.filter(e=>e.sourceInfo.importProvenance);
  assert.equal(migrated.length,23);
  let count=0;
  for(const e of migrated) for(const v of e.geometryVersions) {
    const expected = baseline.historicalGeometry[e.sourceInfo.importProvenance.versionIds[v.versionId]];
    if (e.entityId === 'state:soviet-union' && v.versionId === 'state:soviet-union:1922-1991-baikonur-r1') {
      assert.equal(v.geometry.type, 'MultiPolygon');
      assert.equal(v.geometry.coordinates.length, 231);
      // Inverting the documented spherical orientation repair must reconstruct
      // exactly the immutable pre-repair source without moving any vertices.
      const reconstructed = { ...v.geometry, coordinates: v.geometry.coordinates.map(polygon =>
        polygon.map(ring => [ring[0], ...ring.slice(1, -1).reverse(), ring.at(-1)])) };
      assert.equal(sha(reconstructed), expected, 'USSR coordinates differ beyond the reviewed winding fix');
      assert.notEqual(sha(v.geometry), expected, 'the legacy complement winding must no longer be used');
    } else assert.equal(sha(v.geometry), expected);
    count++;
  }
  assert.equal(count,26);
  const yugo=sources.find(e=>e.entityId==='state:yugoslavia');
  const oldVersion=selectGeometryVersion(yugo,'1992-04-26');
  const newVersion=selectGeometryVersion(yugo,'1992-04-27');
  assert.equal(oldVersion.validTo,'1992-04-26');
  assert.equal(newVersion.validFrom,'1992-04-27');
  assert.notEqual(oldVersion.versionId,newVersion.versionId);
  assert.equal(selectGeometryVersion(yugo,'1943'),null);
});
