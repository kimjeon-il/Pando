import assert from 'node:assert/strict';
import test from 'node:test';

await import('../../assets/js/gis-adapters.js');
const adapters = globalThis.PandoLabGisAdapters;

const polygon = (left = 0, right = 2) => ({
  type: 'Polygon',
  coordinates: [[[left, 0], [left, 2], [right, 2], [right, 0], [left, 0]]],
});

test('territorial GIS rows keep hierarchy sovereignty dates and multipart geometry', () => {
  const geometry = { type: 'MultiPolygon', coordinates: [polygon().coordinates, polygon(4, 6).coordinates] };
  const state = {
    territorialUnits: [{
      type: 'Feature', id: 'admin-a', geometry,
      properties: {
        unitType: 'subunit', name: '아티키', parentId: 'country-gr', sovereignId: 'country-gr', adminLevel: 1,
        validFrom: '1900', validTo: '2000', style: { color: '#123456' }, sourceLibraryId: 'lib-admin-a',
      },
    }],
  };
  const rows = adapters.territorialRows(state);
  assert.equal(rows.subunits.length, 1);
  assert.deepEqual(rows.subunits[0].geometry, geometry);
  assert.deepEqual(rows.subunits[0], {
    ...rows.subunits[0],
    id: 'admin-a', type: 'subunit', parent_id: 'country-gr', sovereign_id: 'country-gr',
    admin_level: 1, valid_from: '1900', valid_to: '2000', source_library_id: 'lib-admin-a',
  });
});

test('territorial distributions materialize referenced geometry only in the GIS view', () => {
  const state = {
    countriesData: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'GR', properties: { name: 'GR' }, geometry: polygon() }] },
    distributionLayers: [{ id: 'greek', type: 'language', name: '그리스어', color: '#2474c6', locked: false }],
    itemVisibility: { languages: { greek: false } },
    distributionEntries: [
      { id: 'entry-territorial', layerId: 'greek', mode: 'territorial', territorialUnitId: 'GR', geometry: null, share: 95, certainty: 'high' },
      { id: 'entry-free', layerId: 'greek', mode: 'geometry', territorialUnitId: '', geometry: polygon(4, 5), share: 40, certainty: 'medium' },
    ],
  };
  const before = JSON.parse(JSON.stringify(state));
  const rows = adapters.distributionRows(state).language_distribution;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].geometry, polygon());
  assert.equal(rows[0].source_mode, 'territorial');
  assert.equal(rows[0].territorial_unit_id, 'GR');
  assert.equal(rows[0].share, 95);
  assert.equal(rows[0].layer_visible, 0);
  assert.deepEqual(rows[1].geometry, polygon(4, 5));
  assert.deepEqual(state, before);
});

test('GIS distribution import keeps stable IDs and reports collisions', () => {
  const feature = id => ({
    type: 'Feature', geometry: polygon(),
    properties: { entry_id: id, layer_id: 'greek', name: '그리스어', share: 80, source_mode: 'territorial', territorial_unit_id: 'GR' },
  });
  const imported = adapters.mergeDistributionFeatures([{ tableName: 'language_distribution', features: [feature('entry-1')] }]);
  assert.equal(imported.layers[0].id, 'greek');
  assert.deepEqual(imported.entries[0], {
    ...imported.entries[0], id: 'entry-1', layerId: 'greek', mode: 'territorial', territorialUnitId: 'GR', geometry: null, share: 80,
  });
  assert.throws(
    () => adapters.mergeDistributionFeatures([{ tableName: 'language_distribution', features: [feature('duplicate'), feature('duplicate')] }]),
    /ID 충돌/,
  );
});

test('the canonical administrative table imports through the adapter', () => {
  const source = {
    type: 'Feature', geometry: polygon(), properties: { id: 'admin-1', name: '아티키', sovereign_id: 'GR', parent_id: 'GR', admin_level: 1 },
  };
  const imported = adapters.importTerritorialFeature(source, 'administrative');
  assert.equal(imported.properties.schemaVersion, 2);
  assert.equal(imported.properties.unitType, 'subunit');
  assert.equal(imported.properties.sovereignId, 'GR');
  assert.equal(adapters.TERRITORIAL_TABLES.subunit, 'subunits');
});
