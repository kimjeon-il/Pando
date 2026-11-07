import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { readTerritorialSources } from '../../tools/territorial-entity-sources.mjs';
import { selectGeometryVersion, territorialEntityExistsAt, normalizeTerritorialLibraryEntity } from '../../tools/gis/territorial-library.js';

const dataRoot = new URL('../../assets/data/', import.meta.url);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const currentDate = () => {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')].join('-');
};

test('current published countries preserve original attribution and explain approved changed geometry', () => {
  const original = JSON.parse(fs.readFileSync(new URL('countries-ne-5.1.1.geojson', dataRoot), 'utf8'));
  assert.equal(original.type, 'FeatureCollection');
  assert.ok(original.features.length > 0);
  const source = readTerritorialSources();
  const byFeature = new Map(source.filter(entity => entity.sourceInfo?.featureId)
    .map(entity => [entity.sourceInfo.featureId, entity]));
  assert.equal(new Set(original.features.map(f => f.id)).size, original.features.length);
  assert.equal(byFeature.size, source.filter(entity => entity.sourceInfo?.featureId).length,
    'two countries cannot claim the same original feature identity');
  assert.ok(byFeature.size >= original.features.length, 'no original country may disappear');
  const today = currentDate();
  for (const feature of original.features) {
    const entity = byFeature.get(feature.id);
    assert.ok(entity, 'missing imported country: ' + feature.id);
    assert.deepEqual(entity.sourceInfo.featureProperties, feature.properties,
      feature.id + ': original country properties changed');
    const selected = selectGeometryVersion(entity, today);
    assert.ok(selected, feature.id + ': no contemporary geometry');
    assert.equal(selected.versionId, entity.metadata.representativeGeometryVersionId,
      feature.id + ': display version differs from active source');
    const actualSha = digest(selected.geometry), originalSha = digest(feature.geometry);
    if (actualSha === originalSha) {
      assert.deepEqual(selected.geometry, feature.geometry, feature.id + ': original source must remain intact');
    } else {
      assert.equal(entity.sourceInfo.geometrySha256, actualSha,
        feature.id + ': changed geometry requires a matching current-source receipt');
      assert.ok(selected.historicalProvenance || selected.modernBoundarySupplement,
        feature.id + ': changed modern border needs attributable provenance');
    }
    assert.doesNotMatch(entity.metadata.defaultFlagDataUrl || '', /^file:/);
  }
});

test('all source versions retain valid identity, date selection and exact declared reused geometry', () => {
  const source = readTerritorialSources(), byId = new Map(source.map(entity => [entity.entityId, entity]));
  assert.ok(source.some(entity => entity.geometryVersions.length > 1), 'the historical corpus must not be empty');
  for (const entity of source) {
    const ids = new Set();
    for (const version of entity.geometryVersions) {
      assert.ok(version.versionId && !ids.has(version.versionId), entity.entityId + ': duplicate version');
      ids.add(version.versionId);
      // Exact days are useful admission boundaries. Years and months are
      // deliberately not treated as January 1: the Core uses period-end queries.
      if (/^\d{4}-\d{2}-\d{2}$/.test(version.validFrom || '') &&
          territorialEntityExistsAt(entity, version.validFrom)) {
        assert.equal(selectGeometryVersion(entity, version.validFrom)?.versionId, version.versionId,
          entity.entityId + ': incorrect active border at ' + version.validFrom);
      }
      const provenance = version.historicalProvenance;
      if (provenance?.sourceEntityId && provenance.sourceGeometryVersionId) {
        const owner = byId.get(provenance.sourceEntityId)?.geometryVersions.find(v =>
          v.versionId === provenance.sourceGeometryVersionId);
        assert.ok(owner, entity.entityId + ': missing documented source version');
        assert.deepEqual(version.geometry, owner.geometry,
          entity.entityId + ': coordinate reuse differs from recorded provenance');
      }
      for (const field of ['reviewedMasterSha256', 'displaySha256'])
        if (version[field]) assert.match(version[field], /^[a-f0-9]{64}$/,
          entity.entityId + ': invalid content receipt for ' + version.versionId);
    }
    const active = selectGeometryVersion(entity, currentDate());
    if (active) assert.ok(ids.has(active.versionId), entity.entityId + ': selected unregistered geometry');
  }
});

test('source admission rejects newly overlapping geometry even when its version ID changes', () => {
  const source = readTerritorialSources();
  const entity = structuredClone(source.find(row => row.geometryVersions.length > 0));
  const colliding = structuredClone(entity.geometryVersions[0]);
  colliding.versionId += ':unapproved-copy';
  entity.geometryVersions.push(colliding);
  assert.throws(() => normalizeTerritorialLibraryEntity(entity), /overlapping geometry versions/i);
});
