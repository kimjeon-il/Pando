import assert from 'node:assert/strict';
import test from 'node:test';
import { TERRITORIAL_SCHEMA_VERSION, normalizeTerritorialFeature } from '../../assets/js/modules/territorial-units.js';

await import('../../assets/js/gis-adapters.js');
const adapters = globalThis.PandoLabGisAdapters;

const polygon = (left = 0, right = 2) => ({
  type: 'Polygon',
  coordinates: [[[left, 0], [left, 2], [right, 2], [right, 0], [left, 0]]],
});

test('territorial GIS rows keep hierarchy association dates and multipart geometry', () => {
  const geometry = { type: 'MultiPolygon', coordinates: [polygon().coordinates, polygon(4, 6).coordinates] };
  const state = {
    territorialEntities: [{
      type: 'Feature', id: 'admin-a', geometry,
      properties: {
        entityKind: 'general', name: '아티키', parentId: 'country-gr', 
        validFrom: '1900', validTo: '2000', style: { color: '#123456' }, sourceEntityId: 'lib-admin-a',
      },
    }],
  };
  const rows = adapters.territorialRows(state);
  assert.equal(rows.entities.length, 1);
  assert.deepEqual(rows.entities[0].geometry, geometry);
  assert.deepEqual(rows.entities[0], {
    ...rows.entities[0],
    id: 'admin-a', entity_kind: 'general', parent_id: 'country-gr', 
    valid_from: '1900', valid_to: '2000', source_entity_id: 'lib-admin-a',
  });
});

test('territorial distributions materialize referenced geometry only in the GIS view', () => {
  const state = {
    territorialEntities: [{ type: 'Feature', id: 'GR', properties: { entityKind:'general',name: 'GR' }, geometry: polygon() }],
    distributionLayers: [{ id: 'greek', name: '그리스어', unit: '명', valueScale: { mode: 'manual', min: -10, max: 100 }, color: '#2474c6', locked: false }],
    itemVisibility: { distributions: { greek: false } },
    distributionEntries: [
      { id: 'entry-territorial', layerId: 'greek', mode: 'territorial', territorialUnitId: 'GR', geometry: null, value: 95, certainty: 'high' },
      { id: 'entry-free', layerId: 'greek', mode: 'geometry', territorialUnitId: '', geometry: polygon(4, 5), value: -4.5, certainty: 'medium' },
    ],
  };
  const before = JSON.parse(JSON.stringify(state));
  const rows = adapters.distributionRows(state).distributions;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].geometry, polygon());
  assert.equal(rows[0].source_mode, 'territorial');
  assert.equal(rows[0].territorial_unit_id, 'GR');
  assert.equal(rows[0].value, 95);
  assert.equal(rows[0].unit, '명');
  assert.equal(rows[0].value_scale_min, -10);
  assert.equal(rows[0].layer_visible, 0);
  assert.deepEqual(rows[1].geometry, polygon(4, 5));
  assert.deepEqual(state, before);
});

test('GIS distribution import keeps stable IDs and reports collisions', () => {
  const feature = id => ({
    type: 'Feature', geometry: polygon(),
    properties: { entry_id: id, layer_id: 'greek', name: '그리스어', unit: '명', value: 80, source_mode: 'territorial', territorial_unit_id: 'GR' },
  });
  const imported = adapters.mergeDistributionFeatures([{ tableName: 'distributions', features: [feature('entry-1')] }]);
  assert.equal(imported.layers[0].id, 'greek');
  assert.deepEqual(imported.entries[0], {
    ...imported.entries[0], id: 'entry-1', layerId: 'greek', mode: 'territorial', territorialUnitId: 'GR', geometry: null, value: 80,
  });
  assert.throws(
    () => adapters.mergeDistributionFeatures([{ tableName: 'distributions', features: [feature('duplicate'), feature('duplicate')] }]),
    /ID 충돌/,
  );
  assert.throws(() => adapters.mergeDistributionFeatures([{
    tableName: 'distributions', features: [feature('a'), { ...feature('b'), properties: { ...feature('b').properties, unit: 'km²' } }],
  }]), /단위 또는 색 농도/);
  assert.throws(() => adapters.mergeDistributionFeatures([{ tableName: 'distributions',
    features: [{ ...feature('bad'), properties: { ...feature('bad').properties, value: '' } }] }]), /1행/);
});

test('the canonical general entity table imports a child with the current schema', () => {
  const source = {
    type: 'Feature', geometry: polygon(), properties: { id: 'admin-1', name: '아티키', parent_id: 'GR' },
  };
  const imported = adapters.importTerritorialFeature(source, 'entities', 0, 6);
  assert.equal(imported.properties.schemaVersion, TERRITORIAL_SCHEMA_VERSION);
  assert.equal(imported.properties.entityKind, 'general');
  assert.equal(imported.properties.parentId, 'GR');
  assert.equal(imported.properties.coverageMode, 'partition');
  const normalized = normalizeTerritorialFeature(imported);
  assert.equal(normalized.id, 'admin-1');
  assert.deepEqual(normalized.geometry, source.geometry);
  assert.equal(adapters.TERRITORIAL_TABLES.general, 'entities');
});
